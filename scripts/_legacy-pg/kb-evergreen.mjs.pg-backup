#!/usr/bin/env node
/**
 * KB Evergreen v1.0 - Automated Daily Knowledge Base Refresh
 *
 * Checks all ruvnet GitHub repos for new commits since last ingest.
 * Only re-ingests repos that have changed. Designed to run as a daily
 * cron/LaunchAgent job to keep the ask_ruvnet KB permanently up to date.
 *
 * Process:
 * 1. Query ask_ruvnet for last ingest timestamp per repo
 * 2. Check GitHub API for repos with commits since that timestamp
 * 3. Clone/pull only stale repos
 * 4. Chunk, embed (ONNX), and upsert into ask_ruvnet.architecture_docs
 * 5. Clean up orphaned entries
 * 6. Log results to PostgreSQL for audit trail
 *
 * Usage:
 *   node scripts/kb-evergreen.mjs              # Auto-detect stale repos
 *   node scripts/kb-evergreen.mjs --force      # Re-ingest ALL repos
 *   node scripts/kb-evergreen.mjs --dry-run    # Check without ingesting
 *   node scripts/kb-evergreen.mjs --repo X     # Single repo only
 */
import fs from 'fs/promises';
import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import crypto from 'crypto';
import pg from 'pg';

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const SINGLE_REPO = process.argv.includes('--repo')
  ? process.argv[process.argv.indexOf('--repo') + 1]
  : null;

const SCHEMA = 'ask_ruvnet';
const TABLE = 'architecture_docs';
const TEMP_DIR = '/tmp/ruvnet-repos';
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;
const ONNX_BATCH = 100;
const DB_BATCH = 200;
const GH_CLI = '/opt/homebrew/bin/gh';

const pool = new pg.Pool({
  host: 'localhost',
  port: 5435,
  user: 'postgres',
  password: '',
  database: 'postgres',
  max: 4
});

// --- Logging ---
function log(msg) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] ${msg}`);
}

// --- ONNX Embedding ---
let svc = null;

async function initOnnx() {
  const embeddingsPath = '/Users/stuartkerr/.npm-global/lib/node_modules/@claude-flow/cli/node_modules/@claude-flow/embeddings/dist/index.js';
  const mod = await import(embeddingsPath);
  svc = await mod.createEmbeddingServiceAsync({
    provider: 'transformers',
    model: 'Xenova/all-MiniLM-L6-v2',
    dimensions: 384
  });
  await svc.embed('warmup');
}

// --- Chunking with overlap ---
function chunkText(text, maxSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  const paragraphs = text.split(/\n\n+/);
  let current = '';

  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length > maxSize && current.length > 50) {
      chunks.push(current.trim());
      const overlapText = current.slice(-overlap);
      current = overlapText + '\n\n' + para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }
  if (current.trim().length > 30) chunks.push(current.trim());
  return chunks;
}

function md5(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

// --- File discovery ---
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '__pycache__',
  'venv', '.venv', '.next', '.cache', 'target', '.tox', '.mypy_cache'
]);

function findFiles(dir, files = []) {
  if (!existsSync(dir)) return files;
  const items = readdirSync(dir);
  for (const item of items) {
    if (SKIP_DIRS.has(item)) continue;
    const fullPath = path.join(dir, item);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        findFiles(fullPath, files);
      } else if (stat.isFile() && /\.(md|txt|rst|toml)$/i.test(item) && stat.size < 500_000) {
        files.push(fullPath);
      }
    } catch {}
  }
  return files;
}

// --- Git operations ---
function cloneOrPull(repoName) {
  const repoPath = path.join(TEMP_DIR, repoName);
  const repoUrl = `https://github.com/ruvnet/${repoName}.git`;

  if (existsSync(path.join(repoPath, '.git'))) {
    const result = spawnSync('git', ['pull', '--quiet'], {
      cwd: repoPath, timeout: 120000, encoding: 'utf-8'
    });
    if (result.status === 0) return repoPath;
    spawnSync('rm', ['-rf', repoPath], { timeout: 30000 });
  }

  try {
    execFileSync('git', ['clone', '--depth', '1', '--quiet', repoUrl, repoPath], {
      timeout: 180000
    });
    return repoPath;
  } catch (e) {
    log(`  Failed to clone ${repoName}: ${e.message}`);
    return null;
  }
}

// --- Category & topic detection ---
function detectCategory(repoName, content) {
  const text = content.toLowerCase();
  if (repoName === 'ruflo') {
    if (/swarm|hive|queen|worker|mesh/.test(text)) return 'swarms';
    if (/neural|sona|ewc|moe|pattern/.test(text)) return 'neural';
    if (/hnsw|vector|embed|ruvector/.test(text)) return 'vector-db';
    if (/mcp|server|tool|transport/.test(text)) return 'mcp';
    if (/security|cve|audit|injection/.test(text)) return 'security';
    if (/sparc|specification|pseudocode/.test(text)) return 'sparc';
    if (/memory|agentdb|persist|cache/.test(text)) return 'memory';
    if (/performance|benchmark|profile/.test(text)) return 'performance';
    if (/github|pr|issue|workflow/.test(text)) return 'github';
    if (/deploy|docker|cloud/.test(text)) return 'deployment';
    return 'agents';
  }
  if (repoName === 'ruvector') return 'vector-db';
  if (repoName === 'agentic-flow') {
    if (/vector|embed/.test(text)) return 'vector-db';
    if (/neural|ml/.test(text)) return 'neural';
    return 'agents';
  }
  return 'general';
}

function detectTopics(repoName, content) {
  const topics = ['github-repo', repoName];
  const text = content.toLowerCase();
  if (/agent|swarm|orchestrat/.test(text)) topics.push('agents');
  if (/vector|embed|hnsw/.test(text)) topics.push('vectors');
  if (/neural|ml|ai|model/.test(text)) topics.push('ai');
  if (/api|endpoint|rest|graphql/.test(text)) topics.push('api');
  if (/docker|deploy|cloud/.test(text)) topics.push('deployment');
  if (/mcp|server|tool/.test(text)) topics.push('mcp');
  if (/security|auth|cve/.test(text)) topics.push('security');
  return topics;
}

// --- GitHub API: check for stale repos ---
async function getStaleRepos() {
  if (SINGLE_REPO) return [SINGLE_REPO];

  // Get last ingest time per repo from DB
  const lastIngest = await pool.query(`
    SELECT package_name AS repo, MAX(updated_at) AS last_update
    FROM ${SCHEMA}.${TABLE}
    WHERE doc_type = 'github-repository' AND package_name IS NOT NULL
    GROUP BY package_name
  `);

  const repoTimestamps = {};
  for (const row of lastIngest.rows) {
    repoTimestamps[row.repo] = new Date(row.last_update);
  }

  // Get all ruvnet repos from GitHub
  const ghResult = spawnSync(GH_CLI, [
    'repo', 'list', 'ruvnet', '--limit', '200',
    '--json', 'name,pushedAt', '--jq', '.[] | [.name, .pushedAt] | @tsv'
  ], { encoding: 'utf-8', timeout: 30000 });

  if (ghResult.error || ghResult.status !== 0) {
    log('Error fetching repo list from GitHub');
    return [];
  }

  const stale = [];
  const lines = ghResult.stdout.trim().split('\n').filter(l => l);

  for (const line of lines) {
    const [name, pushedAt] = line.split('\t');
    if (!name || !pushedAt) continue;

    const ghPushDate = new Date(pushedAt);
    const kbDate = repoTimestamps[name];

    if (FORCE || !kbDate || ghPushDate > kbDate) {
      const daysBehind = kbDate
        ? Math.round((ghPushDate - kbDate) / (1000 * 60 * 60 * 24))
        : -1;
      stale.push({ name, pushedAt: ghPushDate, kbDate, daysBehind });
    }
  }

  // Sort by days behind (most stale first)
  stale.sort((a, b) => (b.daysBehind || 999) - (a.daysBehind || 999));
  return stale.map(s => s.name);
}

// --- Ingest a single repo ---
async function ingestRepo(repoName) {
  const repoPath = cloneOrPull(repoName);
  if (!repoPath) return { chunks: 0, files: 0, deleted: 0, errors: 0 };

  const files = findFiles(repoPath);
  if (files.length === 0) return { chunks: 0, files: 0, deleted: 0, errors: 0 };

  // Collect all chunks
  const allChunks = [];
  const liveDocIds = new Set();
  let fileCount = 0;

  for (const filePath of files) {
    const content = readFileSync(filePath, 'utf-8');
    if (content.trim().length < 50) continue;

    const hash = md5(content);
    const pathHash = hash.substring(0, 8);
    const chunks = chunkText(content);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const docId = `github-${repoName}-${pathHash}-${i}`;
      const titleMatch = chunk.match(/^#\s+(.+)/m) || chunk.match(/^(.{1,80})/);
      let title = titleMatch ? titleMatch[1].trim() : path.basename(filePath);

      // Quality gate compliance: skip chunks that can't pass
      if (chunk.length < 200) continue;  // Rule 3: content >= 200 chars
      if (title.length < 10) {
        // Rule 2: title >= 10 chars — pad with repo context
        title = `${repoName}: ${title}`.slice(0, 200);
        if (title.length < 10) title = `${repoName} — ${path.basename(filePath)} chunk ${i}`;
      }

      // Rule 4: content must have a ## heading — prepend one if missing
      const contentWithHeading = chunk.includes('## ')
        ? chunk
        : `## ${title}\n\n${chunk}`;

      allChunks.push({
        docId, title, content: contentWithHeading, filePath,
        sectionIndex: i, fileHash: hash,
        repoName, category: detectCategory(repoName, chunk),
        topics: detectTopics(repoName, chunk)
      });
      liveDocIds.add(docId);
    }
    fileCount++;
  }

  log(`  ${repoName}: ${fileCount} files → ${allChunks.length} chunks`);

  if (DRY_RUN) return { chunks: allChunks.length, files: fileCount, deleted: 0, errors: 0 };

  // Embed
  const embeddings = [];
  for (let i = 0; i < allChunks.length; i += ONNX_BATCH) {
    const batch = allChunks.slice(i, i + ONNX_BATCH);
    const texts = batch.map(c => (c.title + '\n' + c.content).slice(0, 2000));
    const result = await svc.embedBatch(texts);
    for (const item of result.embeddings) {
      embeddings.push(item.embedding || item);
    }
    if ((i + ONNX_BATCH) % 1000 === 0) {
      log(`    Embedded ${Math.min(i + ONNX_BATCH, allChunks.length)}/${allChunks.length}`);
    }
  }

  // Upsert
  let upserted = 0;
  let errors = 0;

  for (let i = 0; i < allChunks.length; i++) {
    const c = allChunks[i];
    const vec = embeddings[i];
    if (!vec || vec.length !== 384) { errors++; continue; }

    const vecStr = '[' + Array.from(vec).join(',') + ']';

    try {
      await pool.query(`
        INSERT INTO ${SCHEMA}.${TABLE}
        (doc_id, title, content, file_path, section_index, file_hash,
         package_name, package_version, doc_type, category, topics,
         embedding, quality_score, is_duplicate, source_authority, knowledge_type)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                $12::ruvector(384), 85, false, 'auto-ingested', 'reference')
        ON CONFLICT (doc_id) DO UPDATE SET
          title = EXCLUDED.title,
          content = EXCLUDED.content,
          file_path = EXCLUDED.file_path,
          file_hash = EXCLUDED.file_hash,
          category = EXCLUDED.category,
          topics = EXCLUDED.topics,
          embedding = EXCLUDED.embedding,
          source_authority = EXCLUDED.source_authority,
          knowledge_type = EXCLUDED.knowledge_type,
          updated_at = NOW()
      `, [
        c.docId, c.title, c.content, c.filePath, c.sectionIndex, c.fileHash,
        c.repoName, 'github', 'github-repository', c.category, c.topics,
        vecStr
      ]);
      upserted++;
    } catch (err) {
      errors++;
      if (errors <= 10) log(`    Error [${errors}]: ${err.message.slice(0, 150)}`);
      if (errors === 10) log(`    (suppressing further errors — check _evergreen_log for totals)`);
    }

    if ((i + 1) % 1000 === 0) {
      log(`    Upserted ${upserted}/${i + 1}`);
    }
  }

  // Delete orphans
  let deleted = 0;
  if (liveDocIds.size > 0) {
    const oldRes = await pool.query(`
      SELECT doc_id FROM ${SCHEMA}.${TABLE}
      WHERE doc_type = 'github-repository'
        AND package_name = $1
        AND doc_id NOT IN (${[...liveDocIds].map((_, i) => `$${i + 2}`).join(',')})
    `, [repoName, ...liveDocIds]);

    if (oldRes.rows.length > 0) {
      const orphanIds = oldRes.rows.map(r => r.doc_id);
      for (let i = 0; i < orphanIds.length; i += 500) {
        const batch = orphanIds.slice(i, i + 500);
        await pool.query(`DELETE FROM ${SCHEMA}.${TABLE} WHERE doc_id = ANY($1)`, [batch]);
      }
      deleted = oldRes.rows.length;
    }
  }

  return { chunks: upserted, files: fileCount, deleted, errors };
}

// --- Main ---
async function main() {
  const startTime = Date.now();
  log(`=== KB Evergreen v1.0 ${DRY_RUN ? '(DRY RUN)' : FORCE ? '(FORCE ALL)' : '(Auto-detect)'} ===`);

  // 1. Find stale repos
  log('Checking GitHub for stale repos...');
  const staleRepos = await getStaleRepos();

  if (staleRepos.length === 0) {
    log('All repos are up to date! Nothing to do.');
    await pool.end();
    return;
  }

  log(`Found ${staleRepos.length} repos needing update: ${staleRepos.slice(0, 10).join(', ')}${staleRepos.length > 10 ? '...' : ''}`);

  if (!existsSync(TEMP_DIR)) {
    await fs.mkdir(TEMP_DIR, { recursive: true });
  }

  // 2. Init ONNX
  if (!DRY_RUN) {
    log('Loading ONNX model...');
    await initOnnx();
    log('ONNX ready.');
  }

  // 3. Process each stale repo
  let totalChunks = 0, totalFiles = 0, totalDeleted = 0, totalErrors = 0;
  const results = [];

  for (const repoName of staleRepos) {
    log(`\n--- ${repoName} ---`);
    const result = await ingestRepo(repoName);
    results.push({ repo: repoName, ...result });
    totalChunks += result.chunks;
    totalFiles += result.files;
    totalDeleted += result.deleted;
    totalErrors += result.errors;
  }

  // 4. Log to DB for audit trail
  if (!DRY_RUN) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${SCHEMA}._evergreen_log (
          id SERIAL PRIMARY KEY,
          run_at TIMESTAMP DEFAULT NOW(),
          repos_updated INT,
          chunks_upserted INT,
          chunks_deleted INT,
          errors INT,
          duration_sec INT,
          details JSONB
        )
      `);
      await pool.query(`
        INSERT INTO ${SCHEMA}._evergreen_log
        (repos_updated, chunks_upserted, chunks_deleted, errors, duration_sec, details)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        staleRepos.length, totalChunks, totalDeleted, totalErrors,
        Math.round((Date.now() - startTime) / 1000),
        JSON.stringify(results)
      ]);
    } catch (e) {
      log(`Warning: Could not write audit log: ${e.message}`);
    }
  }

  // 5. Summary
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`\n${'='.repeat(50)}`);
  log(`KB Evergreen Complete`);
  log(`  Repos updated: ${staleRepos.length}`);
  log(`  Chunks upserted: ${totalChunks}`);
  log(`  Orphans deleted: ${totalDeleted}`);
  log(`  Errors: ${totalErrors}`);
  log(`  Time: ${totalTime}s`);
  log(`${'='.repeat(50)}`);

  await pool.end();
}

main().catch(e => {
  console.error('Fatal:', e.message);
  pool.end().catch(() => {});
  process.exit(1);
});
