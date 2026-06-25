#!/usr/bin/env node
/**
 * KB Ingestion System — Single entry point for ALL data entering Ask RuvNet
 *
 * This replaces all ad-hoc ingestion scripts. Every source (GitHub repos,
 * local files, raw text, directories) goes through the same pipeline:
 *
 *   1. Fetch content from source
 *   2. Smart-chunk by markdown headers (NOT fixed-size)
 *   3. Rewrite each chunk via the v3.0 rewrite prompt (Anthropic Haiku)
 *   4. Score via the quality gate (7.0+/10 to pass)
 *   5. Deduplicate against existing entries
 *   6. Store with proper metadata
 *   7. Generate embeddings
 *
 * Usage:
 *   node ingest.js --source github --repo ruvnet/ruflo --branch main
 *   node ingest.js --source file --path ./docs/feature.md
 *   node ingest.js --source text --title "ADR-017" --content "..."
 *   node ingest.js --source dir --path ./repos/ruvector/docs/
 *   node ingest.js --source file --path ./doc.md --dry-run
 *   node ingest.js --source dir --path ./docs/ --skip-rewrite
 *   node ingest.js --source dir --path ./docs/ --package my-package
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pool, ANTHROPIC_API_KEY, HAIKU_MODEL } = require('./config');
const { buildRewritePrompt } = require('./prompts/rewrite');
const { RateLimiter } = require('./utils/rate-limiter');
const { smartChunk } = require('./utils/smart-chunker');
const { scoreRewrite } = require('./utils/quality-gate');

// ─────────────────────────────────────────────────────────────────────
// CLI argument parsing
// ─────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--source') opts.source = args[++i];
    else if (arg === '--repo') opts.repo = args[++i];
    else if (arg === '--branch') opts.branch = args[++i] || 'main';
    else if (arg === '--path') opts.path = args[++i];
    else if (arg === '--title') opts.title = args[++i];
    else if (arg === '--content') opts.content = args[++i];
    else if (arg === '--package') opts.packageName = args[++i];
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--skip-rewrite') opts.skipRewrite = true;
    else if (arg === '--limit') opts.limit = parseInt(args[++i]);
    else if (arg === '--verbose') opts.verbose = true;
  }

  if (!opts.source) {
    console.error('[Ingest] ERROR: --source is required (github | file | text | dir)');
    console.error('');
    console.error('Usage:');
    console.error('  node ingest.js --source github --repo owner/name [--branch main]');
    console.error('  node ingest.js --source file --path ./doc.md');
    console.error('  node ingest.js --source text --title "Title" --content "..."');
    console.error('  node ingest.js --source dir --path ./docs/');
    console.error('');
    console.error('Options:');
    console.error('  --dry-run        Preview without writing to DB');
    console.error('  --skip-rewrite   Store raw content (skip LLM rewrite)');
    console.error('  --package NAME   Override package_name metadata');
    console.error('  --limit N        Max chunks to process');
    console.error('  --verbose        Detailed logging');
    process.exit(1);
  }

  return opts;
}

// ─────────────────────────────────────────────────────────────────────
// Input validation
// ─────────────────────────────────────────────────────────────────────

/**
 * Validate a GitHub repo identifier (owner/name format).
 * Prevents path traversal and injection via repo argument.
 */
function validateRepoName(repo) {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
    throw new Error(`Invalid repo format: "${repo}". Expected owner/name (e.g., ruvnet/ruflo)`);
  }
  return repo;
}

/**
 * Validate a git branch name.
 */
function validateBranch(branch) {
  if (!/^[a-zA-Z0-9_.\/-]+$/.test(branch)) {
    throw new Error(`Invalid branch name: "${branch}"`);
  }
  return branch;
}

// ─────────────────────────────────────────────────────────────────────
// Source fetchers — each returns [{ title, content, filePath, sourcePath }]
// ─────────────────────────────────────────────────────────────────────

async function fetchGitHub(repo, branch = 'main') {
  const safeRepo = validateRepoName(repo);
  const safeBranch = validateBranch(branch);

  console.log(`[Ingest] Cloning ${safeRepo} (branch: ${safeBranch})...`);

  const tmpDir = path.join('/tmp', `ingest-${Date.now()}-${safeRepo.replace('/', '-')}`);
  try {
    execFileSync('git', [
      'clone', '--depth', '1', '--branch', safeBranch,
      `https://github.com/${safeRepo}.git`, tmpDir,
    ], { stdio: 'pipe', timeout: 120000 });
  } catch (err) {
    throw new Error(`Failed to clone ${safeRepo}: ${err.message}`);
  }

  const files = collectMarkdownFiles(tmpDir);
  console.log(`[Ingest] Found ${files.length} markdown files in ${safeRepo}`);

  const results = files.map(f => ({
    title: path.basename(f, path.extname(f)),
    content: fs.readFileSync(f, 'utf-8'),
    filePath: path.relative(tmpDir, f),
    sourcePath: `github:${safeRepo}/${path.relative(tmpDir, f)}`,
  }));

  // Cleanup cloned repo
  try {
    execFileSync('rm', ['-rf', tmpDir], { stdio: 'pipe' });
  } catch (_) { /* best-effort cleanup */ }

  return results;
}

function fetchFile(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const content = fs.readFileSync(resolved, 'utf-8');
  return [{
    title: path.basename(resolved, path.extname(resolved)),
    content,
    filePath: path.basename(resolved),
    sourcePath: `file:${resolved}`,
  }];
}

function fetchText(title, content) {
  if (!title || !content) {
    throw new Error('--title and --content are required for --source text');
  }
  return [{
    title,
    content,
    filePath: `text/${title.replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 80)}`,
    sourcePath: 'text:inline',
  }];
}

function fetchDir(dirPath) {
  const resolved = path.resolve(dirPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Directory not found: ${resolved}`);
  }
  const files = collectMarkdownFiles(resolved);
  console.log(`[Ingest] Found ${files.length} markdown files in ${resolved}`);

  return files.map(f => ({
    title: path.basename(f, path.extname(f)),
    content: fs.readFileSync(f, 'utf-8'),
    filePath: path.relative(resolved, f),
    sourcePath: `dir:${path.relative(resolved, f)}`,
  }));
}

function collectMarkdownFiles(dir) {
  const results = [];
  const walk = (d) => {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        // Skip hidden dirs, node_modules, .git
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        walk(full);
      } else if (/\.(md|mdx|markdown|txt|rst)$/i.test(entry.name)) {
        results.push(full);
      }
    }
  };
  walk(dir);
  return results;
}

// ─────────────────────────────────────────────────────────────────────
// Metadata inference
// ─────────────────────────────────────────────────────────────────────

function inferDocType(filePath) {
  const lower = (filePath || '').toLowerCase();
  if (/\badr[s]?\b/.test(lower) || /decision/.test(lower)) return 'adr';
  if (/changelog/i.test(lower)) return 'changelog';
  if (/release/i.test(lower)) return 'releases';
  if (/readme/i.test(lower)) return 'readme';
  if (/api/i.test(lower)) return 'api-reference';
  if (/guide/i.test(lower) || /tutorial/i.test(lower)) return 'guide';
  return 'documentation';
}

function inferKnowledgeType(content) {
  const lower = (content || '').toLowerCase();

  // ADR detection
  if (/\b(decision|adr-?\d|architectural decision)\b/.test(lower) &&
      /\b(status|context|decision|consequences)\b/.test(lower)) {
    return 'adr';
  }

  // Procedure: step-by-step instructions
  const stepIndicators = (lower.match(/\b(step \d|first,|then,|finally,|npm install|pip install|run the)\b/g) || []).length;
  if (stepIndicators >= 2) return 'procedure';

  // Troubleshooting
  if (/\b(error|fix|issue|problem|debug|workaround|troubleshoot)\b/.test(lower) &&
      /\b(solution|resolve|cause|because)\b/.test(lower)) {
    return 'troubleshooting';
  }

  // Reference: tables, parameter lists, API docs
  const pipeCount = (content.match(/\|/g) || []).length;
  if (pipeCount > 10) return 'reference';

  return 'concept';
}

function inferPackageName(opts, sourcePath) {
  if (opts.packageName) return opts.packageName;
  if (opts.repo) return opts.repo.split('/').pop();
  if (opts.path) {
    // Try to extract from path: look for a package-like directory name
    const parts = path.resolve(opts.path).split(path.sep);
    // Walk up looking for a dir that isn't generic
    const genericDirs = new Set(['docs', 'doc', 'documentation', 'src', 'lib', 'scripts', 'content']);
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i] && !genericDirs.has(parts[i].toLowerCase())) {
        return parts[i];
      }
    }
  }
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────
// Deduplication
// ─────────────────────────────────────────────────────────────────────

async function findDuplicate(client, title, docId) {
  // Extract the core topic from the title (strip suffixes like ": What It Is...")
  const topic = title.replace(/:\s+What It Is.*$/i, '').trim();

  const res = await client.query(`
    SELECT id, title, doc_id FROM ask_ruvnet.architecture_docs
    WHERE is_duplicate = false
      AND (title ILIKE '%' || $1 || '%' OR doc_id = $2)
    LIMIT 5
  `, [topic, docId]);

  if (res.rows.length === 0) return null;

  // Return the best match (exact doc_id match preferred, then title match)
  const exactDocId = res.rows.find(r => r.doc_id === docId);
  if (exactDocId) return exactDocId;

  // Title match: return the first one
  return res.rows[0];
}

// ─────────────────────────────────────────────────────────────────────
// LLM rewrite
// ─────────────────────────────────────────────────────────────────────

async function rewriteChunk(chunk, packageName, limiter) {
  const fragments = [{
    title: chunk.header,
    content: chunk.content,
  }];

  // Extract key facts from the content for the prompt
  const facts = extractFacts(chunk.content);

  const prompt = buildRewritePrompt(fragments, chunk.header, facts);

  await limiter.wait();

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 429) {
      // Rate limited — signal caller to retry
      throw Object.assign(new Error('Rate limited'), { retryable: true });
    }
    throw new Error(`Anthropic API ${response.status}: ${errText.substring(0, 200)}`);
  }

  const data = await response.json();
  const newContent = data.content?.[0]?.text;

  if (!newContent || newContent.length < 100) {
    throw new Error('Empty or too-short rewrite response');
  }

  // Check for LLM refusal
  const refusalPatterns = /cannot produce|cannot create|I can't make|not enough.*content|does not contain.*explanation/i;
  if (refusalPatterns.test(newContent) && !newContent.match(/^#\s+/m)) {
    throw new Error('LLM refused: insufficient source content for teaching doc');
  }

  return newContent;
}

function extractFacts(content) {
  const facts = [];
  const lines = content.split('\n');
  for (const line of lines) {
    if (/\d+[\.,]?\d*\s*(ms|seconds?|bytes?|KB|MB|GB|%|x faster|RPM|dims?)/.test(line)) {
      facts.push(line.trim().substring(0, 200));
    }
    if (/`[^`]{5,}`/.test(line)) {
      facts.push(line.trim().substring(0, 200));
    }
  }
  if (facts.length === 0) {
    facts.push('No specific quantitative facts found in source - focus on conceptual accuracy');
  }
  return facts.slice(0, 10); // Cap at 10 facts to keep prompt size reasonable
}

// ─────────────────────────────────────────────────────────────────────
// Embedding (reuses pattern from stages/04-embed.js)
// ─────────────────────────────────────────────────────────────────────

let embedPipeline = null;

async function getEmbedPipeline() {
  if (embedPipeline) return embedPipeline;
  try {
    const { pipeline } = await import('@xenova/transformers');
    embedPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('[Ingest] ONNX embedding pipeline loaded');
    return embedPipeline;
  } catch (err) {
    console.warn(`[Ingest] WARNING: Could not load ONNX pipeline (${err.message}). Embeddings will be skipped.`);
    return null;
  }
}

async function generateEmbedding(text) {
  const pipe = await getEmbedPipeline();
  if (!pipe) return null;
  const output = await pipe(String(text).slice(0, 512), { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

// ─────────────────────────────────────────────────────────────────────
// Main ingestion pipeline
// ─────────────────────────────────────────────────────────────────────

async function ingest(opts) {
  console.log(`[Ingest] Source: ${opts.source}`);
  if (opts.dryRun) console.log('[Ingest] DRY RUN — no changes will be written\n');

  // Step 1: Fetch source content
  let sourceFiles;
  switch (opts.source) {
    case 'github':
      if (!opts.repo) { console.error('[Ingest] ERROR: --repo required for github source'); process.exit(1); }
      sourceFiles = await fetchGitHub(opts.repo, opts.branch || 'main');
      break;
    case 'file':
      if (!opts.path) { console.error('[Ingest] ERROR: --path required for file source'); process.exit(1); }
      sourceFiles = fetchFile(opts.path);
      break;
    case 'text':
      sourceFiles = fetchText(opts.title, opts.content);
      break;
    case 'dir':
      if (!opts.path) { console.error('[Ingest] ERROR: --path required for dir source'); process.exit(1); }
      sourceFiles = fetchDir(opts.path);
      break;
    default:
      console.error(`[Ingest] ERROR: Unknown source "${opts.source}". Use: github, file, text, dir`);
      process.exit(1);
  }

  console.log(`[Ingest] ${sourceFiles.length} source file(s) fetched`);

  // Step 2: Smart-chunk all files
  let allChunks = [];
  for (const file of sourceFiles) {
    const chunks = smartChunk(file.content);
    for (const chunk of chunks) {
      allChunks.push({
        ...chunk,
        filePath: file.filePath,
        sourcePath: file.sourcePath,
        sourceTitle: file.title,
      });
    }
  }

  console.log(`[Ingest] ${allChunks.length} chunks after smart-chunking`);

  if (opts.limit && allChunks.length > opts.limit) {
    allChunks = allChunks.slice(0, opts.limit);
    console.log(`[Ingest] Limited to ${opts.limit} chunks`);
  }

  if (allChunks.length === 0) {
    console.log('[Ingest] No content to ingest. Exiting.');
    return;
  }

  // Step 3: Create run_id and start processing
  const client = await pool.connect();
  const limiter = new RateLimiter(50); // Haiku supports high RPM
  const packageName = inferPackageName(opts, '');

  const runIdRes = await client.query("SELECT gen_random_uuid() as id");
  const runId = runIdRes.rows[0].id;
  console.log(`[Ingest] Run ID: ${runId}`);
  console.log(`[Ingest] Package: ${packageName}`);
  console.log('');

  const stats = {
    total: allChunks.length,
    rewritten: 0,
    stored: 0,
    updated: 0,
    qualityRejected: 0,
    llmRefusals: 0,
    errors: 0,
    skippedTrivial: 0,
    embedded: 0,
  };

  try {
    // Log pipeline start
    if (!opts.dryRun) {
      await client.query(`
        INSERT INTO ask_ruvnet.curation_pipeline (run_id, stage, status, entries_processed, entries_total)
        VALUES ($1, 'ingest-start', 'running', 0, $2)
      `, [runId, allChunks.length]);
    }

    for (let i = 0; i < allChunks.length; i++) {
      const chunk = allChunks[i];
      const chunkLabel = `[${i + 1}/${allChunks.length}]`;

      try {
        const docType = inferDocType(chunk.filePath);
        const knowledgeType = inferKnowledgeType(chunk.content);

        let finalContent = chunk.content;
        let finalTitle = chunk.header;
        let sourceAuthority = 'github-scrape';

        // Step 4: Rewrite through LLM (unless skipped)
        if (!opts.skipRewrite) {
          if (!ANTHROPIC_API_KEY) {
            console.error('[Ingest] ERROR: ANTHROPIC_API_KEY not set. Use --skip-rewrite to store raw content.');
            process.exit(1);
          }

          console.log(`${chunkLabel} Rewriting: ${chunk.header.substring(0, 60)}...`);

          let rewriteAttempts = 0;
          let rewritten = false;

          while (rewriteAttempts < 3 && !rewritten) {
            try {
              finalContent = await rewriteChunk(chunk, packageName, limiter);
              rewritten = true;
            } catch (err) {
              if (err.retryable && rewriteAttempts < 2) {
                rewriteAttempts++;
                console.log(`${chunkLabel} Rate limited, waiting 30s (attempt ${rewriteAttempts}/3)...`);
                await new Promise(r => setTimeout(r, 30000));
              } else if (err.message.startsWith('LLM refused')) {
                console.log(`${chunkLabel} SKIPPED: ${err.message}`);
                stats.llmRefusals++;
                await logDecision(client, runId, null, 'ingest', 'LLM_REFUSED', err.message, chunk.header, opts.dryRun);
                break;
              } else {
                throw err;
              }
            }
          }

          if (!rewritten) continue;

          // Extract title from rewritten content
          const titleMatch = finalContent.match(/^#\s+(.+)/m);
          if (titleMatch) finalTitle = titleMatch[1].trim();
          sourceAuthority = 'llm-generated';

          // Step 5: Quality gate
          const quality = scoreRewrite(finalContent, [{ content: chunk.content }]);
          if (!quality.pass) {
            console.log(`${chunkLabel} QUALITY REJECTED (${quality.score}/10): ${finalTitle.substring(0, 50)}`);
            if (opts.verbose) {
              for (const f of quality.failures) console.log(`  - ${f}`);
            }
            stats.qualityRejected++;
            await logDecision(client, runId, null, 'ingest', 'QUALITY_REJECTED',
              `Score ${quality.score}/10. ${quality.failures.join('; ')}`, chunk.header, opts.dryRun);
            continue;
          }
          console.log(`${chunkLabel} PASSED (${quality.score}/10): ${finalTitle.substring(0, 50)}`);
          stats.rewritten++;
        } else {
          console.log(`${chunkLabel} Storing raw: ${chunk.header.substring(0, 60)}`);
        }

        if (opts.dryRun) {
          stats.stored++;
          continue;
        }

        // Step 6: Deduplication check
        const docId = `ingest-${runId}-${i}`;
        const existing = await findDuplicate(client, finalTitle, docId);

        if (existing) {
          // Update existing entry instead of creating duplicate
          console.log(`${chunkLabel} UPDATING existing entry ${existing.id}: ${existing.title.substring(0, 50)}`);
          await client.query(`
            UPDATE ask_ruvnet.architecture_docs
            SET content = $1,
                title = $2,
                file_hash = md5($1),
                source_authority = $3,
                quality_score = 90,
                triage_tier = 'gold',
                updated_at = NOW()
            WHERE id = $4
          `, [finalContent, finalTitle, sourceAuthority, existing.id]);

          // Clear embedding so it gets regenerated
          await client.query(
            `UPDATE ask_ruvnet.architecture_docs SET embedding = NULL WHERE id = $1`,
            [existing.id]
          );

          stats.updated++;
          await logDecision(client, runId, existing.id, 'ingest', 'UPDATED',
            `Updated existing entry (was: ${existing.title})`, finalTitle, opts.dryRun);
        } else {
          // Insert new entry
          const insertRes = await client.query(`
            INSERT INTO ask_ruvnet.architecture_docs
              (doc_id, title, content, file_path, file_hash, package_name, doc_type,
               category, knowledge_type, quality_score, triage_tier, source_authority,
               expertise_level, is_duplicate, topics, concepts, summary)
            VALUES ($1, $2, $3, $4, md5($3), $5, $6,
                    'general', $7, 90, 'gold', $8,
                    'intermediate', false, ARRAY[$9], ARRAY[$9], LEFT($3, 300))
            RETURNING id
          `, [docId, finalTitle, finalContent, chunk.filePath, packageName, docType,
              knowledgeType, sourceAuthority, chunk.header]);

          const newId = insertRes.rows[0].id;
          stats.stored++;
          await logDecision(client, runId, newId, 'ingest', 'INSERTED',
            `New entry from ${chunk.sourcePath}`, finalTitle, opts.dryRun);
        }

        // Step 7: Generate embedding
        const embedding = await generateEmbedding(`${finalTitle} ${finalContent.substring(0, 400)}`);
        if (embedding) {
          const entryToEmbed = existing ? existing.id :
            (await client.query(
              `SELECT id FROM ask_ruvnet.architecture_docs WHERE doc_id = $1`, [docId]
            )).rows[0]?.id;

          if (entryToEmbed) {
            const vectorLiteral = `[${embedding.join(',')}]`;
            await client.query(
              `UPDATE ask_ruvnet.architecture_docs SET embedding = $1::vector WHERE id = $2`,
              [vectorLiteral, entryToEmbed]
            );
            stats.embedded++;
          }
        }

      } catch (err) {
        console.error(`${chunkLabel} ERROR: ${err.message}`);
        stats.errors++;
        await logDecision(client, runId, null, 'ingest', 'ERROR', err.message, chunk.header, opts.dryRun);
      }

      // Progress report every 10 chunks
      if ((i + 1) % 10 === 0) {
        console.log(`\n[Ingest] Progress: ${i + 1}/${allChunks.length} | ` +
          `stored=${stats.stored} updated=${stats.updated} rejected=${stats.qualityRejected} errors=${stats.errors}\n`);
      }
    }

    // Log pipeline completion
    if (!opts.dryRun) {
      await client.query(`
        INSERT INTO ask_ruvnet.curation_pipeline (run_id, stage, status, entries_processed, entries_total)
        VALUES ($1, 'ingest-complete', 'completed', $2, $3)
      `, [runId, stats.stored + stats.updated, allChunks.length]);
    }

  } finally {
    client.release();
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('[Ingest] SUMMARY');
  console.log('='.repeat(60));
  console.log(`  Run ID:           ${runId}`);
  console.log(`  Source:            ${opts.source} (${opts.repo || opts.path || 'inline'})`);
  console.log(`  Package:           ${packageName}`);
  console.log(`  Total chunks:      ${stats.total}`);
  console.log(`  Rewritten by LLM:  ${stats.rewritten}`);
  console.log(`  Stored (new):      ${stats.stored}`);
  console.log(`  Updated (dedup):   ${stats.updated}`);
  console.log(`  Quality rejected:  ${stats.qualityRejected}`);
  console.log(`  LLM refusals:      ${stats.llmRefusals}`);
  console.log(`  Embeddings:        ${stats.embedded}`);
  console.log(`  Errors:            ${stats.errors}`);
  if (opts.dryRun) console.log(`  (DRY RUN - nothing was written)`);
  console.log('='.repeat(60));

  return stats;
}

// ─────────────────────────────────────────────────────────────────────
// Decision logging — mirrors the curation_decisions pattern
// ─────────────────────────────────────────────────────────────────────

async function logDecision(client, runId, entryId, stage, action, reason, title, dryRun) {
  if (dryRun) return;
  try {
    await client.query(`
      INSERT INTO ask_ruvnet.curation_decisions
        (run_id, entry_id, stage, action, reason, merge_group_id)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [runId, entryId, stage, action, reason.substring(0, 500), `ingest:${title.substring(0, 100)}`]);
  } catch (err) {
    // Non-fatal: log decisions are best-effort
    if (err.message.includes('null value') && !entryId) {
      // entry_id might be NOT NULL — skip silently for pre-insert decisions
    } else {
      console.warn(`[Ingest] Warning: could not log decision: ${err.message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  try {
    await ingest(opts);
  } catch (err) {
    console.error(`[Ingest] Fatal error: ${err.message}`);
    if (opts.verbose) console.error(err.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
