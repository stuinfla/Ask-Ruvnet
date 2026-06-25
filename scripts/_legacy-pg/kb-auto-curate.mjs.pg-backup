#!/usr/bin/env node
/**
 * kb-auto-curate.mjs — Automated Knowledge Base Curation Pipeline
 *
 * Detects stale/missing gold entries by comparing architecture_docs (raw)
 * against kb_complete (curated). Synthesizes new teaching-quality entries
 * from raw chunks using LLM, embeds with ONNX, and upserts to kb_complete.
 *
 * Designed to run after kb-evergreen.mjs (which refreshes architecture_docs).
 * Schedule: daily at 6:00 AM (after evergreen at 4 AM, after export at 5 AM).
 *
 * Usage:
 *   node scripts/kb-auto-curate.mjs              # Auto-detect stale/gaps
 *   node scripts/kb-auto-curate.mjs --dry-run    # Show what would change
 *   node scripts/kb-auto-curate.mjs --force      # Re-curate all repos
 *   node scripts/kb-auto-curate.mjs --repo X     # Single repo only
 *   node scripts/kb-auto-curate.mjs --rebuild    # Also trigger RVF rebuild after curation
 *
 * Updated: 2026-03-19 12:00:00 EST | Version 1.0.0
 * Created: 2026-03-19
 */

import pg from 'pg';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const REBUILD = process.argv.includes('--rebuild');
const SINGLE_REPO = process.argv.includes('--repo')
  ? process.argv[process.argv.indexOf('--repo') + 1]
  : null;

const DB_CONFIG = {
  host: 'localhost', port: 5435, user: 'postgres', database: 'postgres',
  max: 4, idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000,
};

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const LLM_MODEL = 'anthropic/claude-sonnet-4-6';
const MIN_CHUNKS_FOR_ENTRY = 10; // Repos with fewer chunks aren't worth a gold entry
const MAX_NEW_ENTRIES_PER_RUN = 20; // Safety cap
const QUALITY_THRESHOLD = 85; // Minimum score for gold entry

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

// --- ONNX Embedding ---
let onnxSvc = null;
async function initOnnx() {
  import('os').then(() => {});
  const os = await import('os');
  const embPath = path.join(
    os.default.homedir(),
    '.npm-global/lib/node_modules/@claude-flow/cli/node_modules/@claude-flow/embeddings/dist/index.js'
  );
  const mod = await import(embPath);
  onnxSvc = await mod.createEmbeddingServiceAsync({
    provider: 'transformers', model: 'Xenova/all-MiniLM-L6-v2', dimensions: 384
  });
  await onnxSvc.embed('warmup');
  log('ONNX embedding model ready');
}

// --- LLM: Synthesize teaching-quality entry from raw chunks ---
async function synthesizeGoldEntry(repoName, chunks, existingTitles) {
  if (!OPENROUTER_KEY) {
    log('WARNING: OPENROUTER_API_KEY not set, cannot synthesize entries');
    return null;
  }

  // Sample representative chunks (first, middle, last — plus any with README/overview)
  const sorted = chunks.sort((a, b) => (b.content?.length || 0) - (a.content?.length || 0));
  const readmeChunks = sorted.filter(c => /readme|overview|getting.started/i.test(c.file_path || ''));
  const sample = [
    ...readmeChunks.slice(0, 3),
    ...sorted.filter(c => !readmeChunks.includes(c)).slice(0, 5)
  ].slice(0, 8);

  const context = sample.map((c, i) =>
    `--- Chunk ${i + 1} (${c.category || 'general'}) ---\n${(c.content || '').substring(0, 1500)}`
  ).join('\n\n');

  const existingList = existingTitles.length > 0
    ? `\nExisting gold entries about ${repoName}:\n${existingTitles.map(t => `- ${t}`).join('\n')}\nDo NOT duplicate these. Write about NEW aspects not already covered.`
    : '';

  const prompt = `You are creating a gold-standard knowledge base entry for the RuVector ecosystem.

Repository: ${repoName}
Raw documentation chunks from this repo:

${context}
${existingList}

Analyze the chunks and identify DISTINCT sub-components, crates, or major features.
For EACH distinct component, create a separate teaching entry. For small repos, 1 entry is fine.
For large monorepos with many crates/modules, create up to 5 entries covering the most important ones.

Each entry MUST:
1. Have a clear, specific title (not just the repo name — name the specific component)
2. Explain what it does, why it matters, how it fits in the RuVector/Ruflo ecosystem
3. Answer: "What is this? Why should I care? How do I use it? What can it do that alternatives can't?"
4. Use plain English analogies — the reader is learning agentic AI, not a Rust expert
5. Include specific numbers, commands, or code examples from the chunks
6. Be 500-2000 words each
7. Mention honest limitations or tradeoffs

Respond ONLY with valid JSON — an ARRAY of entries:
[
  {
    "title": "...",
    "content": "...",
    "category": "one of: agents, vector-db, architecture, security, neural, swarms, deployment, performance, teaching, general, wasm-local-llm, memory, algorithms",
    "quality_score": 85-100
  }
]
If only one entry is appropriate, still return an array with one element.`;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 4096,
      }),
      signal: AbortSignal.timeout(60000),
    });

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';

    // Extract JSON from response (handle markdown code blocks, arrays or objects)
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    const objMatch = text.match(/\{[\s\S]*\}/);
    let entries;
    if (arrayMatch) {
      entries = JSON.parse(arrayMatch[0]);
    } else if (objMatch) {
      entries = [JSON.parse(objMatch[0])];
    } else {
      log(`  WARNING: LLM response for ${repoName} was not valid JSON`);
      return null;
    }

    if (!Array.isArray(entries)) entries = [entries];

    // Filter valid entries
    const valid = entries.filter(e => e.title && e.content && e.content.length >= 200);
    if (valid.length === 0) {
      log(`  WARNING: All entries for ${repoName} failed quality gate`);
      return null;
    }

    log(`  Synthesized ${valid.length} entries for ${repoName}`);
    return valid;
  } catch (err) {
    log(`  ERROR synthesizing ${repoName}: ${err.message}`);
    return null;
  }
}

// --- Main Pipeline ---
async function main() {
  const startTime = Date.now();
  log(`=== KB Auto-Curation Pipeline ${DRY_RUN ? '(DRY RUN)' : FORCE ? '(FORCE)' : '(Auto)'} ===`);

  const pool = new pg.Pool(DB_CONFIG);

  // 1. Find repos with stale or missing gold entries
  log('Step 1: Detecting stale and missing gold entries...');

  const { rows: gaps } = await pool.query(`
    WITH arch_repos AS (
      SELECT package_name, MAX(updated_at) as arch_date, COUNT(*) as chunk_count
      FROM ask_ruvnet.architecture_docs
      WHERE package_name IS NOT NULL AND is_duplicate = false AND embedding IS NOT NULL
      GROUP BY package_name
      HAVING COUNT(*) >= ${MIN_CHUNKS_FOR_ENTRY}
    ),
    gold_dates AS (
      SELECT package_name, MAX(updated_at) as gold_date
      FROM (
        SELECT unnest(ARRAY[
          CASE WHEN title ILIKE '%' || a.package_name || '%' THEN a.package_name END
        ]) as package_name, updated_at
        FROM ask_ruvnet.kb_complete, arch_repos a
        WHERE title ILIKE '%' || a.package_name || '%'
           OR content ILIKE '%' || a.package_name || '%'
      ) sub
      WHERE package_name IS NOT NULL
      GROUP BY package_name
    )
    SELECT
      a.package_name,
      a.chunk_count,
      a.arch_date,
      g.gold_date,
      CASE
        WHEN g.gold_date IS NULL THEN 'GAP'
        WHEN a.arch_date > g.gold_date THEN 'STALE'
        ELSE 'FRESH'
      END as status
    FROM arch_repos a
    LEFT JOIN gold_dates g ON g.package_name = a.package_name
    WHERE ${FORCE ? 'true' : SINGLE_REPO ? `a.package_name = '${SINGLE_REPO}'` : "(g.gold_date IS NULL OR a.arch_date > g.gold_date)"}
    ORDER BY
      CASE WHEN g.gold_date IS NULL THEN 0 ELSE 1 END,
      a.arch_date DESC
    LIMIT ${MAX_NEW_ENTRIES_PER_RUN}
  `);

  if (gaps.length === 0) {
    log('All gold entries are up to date. Nothing to curate.');
    await pool.end();
    return;
  }

  log(`Found ${gaps.length} repos needing curation:`);
  for (const g of gaps) {
    log(`  ${g.status}: ${g.package_name} (${g.chunk_count} chunks, repo updated ${g.arch_date?.toISOString()?.split('T')[0] || '?'}, gold ${g.gold_date?.toISOString()?.split('T')[0] || 'NONE'})`);
  }

  if (DRY_RUN) {
    log('DRY RUN — no changes made.');
    await pool.end();
    return;
  }

  // 2. Initialize ONNX for embeddings
  log('Step 2: Loading ONNX model...');
  await initOnnx();

  // 3. Process each repo
  let created = 0, updated = 0, errors = 0;

  for (const gap of gaps) {
    log(`\nProcessing: ${gap.package_name} (${gap.status})...`);

    // Get raw chunks for this repo
    const { rows: chunks } = await pool.query(`
      SELECT title, content, file_path, category
      FROM ask_ruvnet.architecture_docs
      WHERE package_name = $1 AND is_duplicate = false AND embedding IS NOT NULL
      ORDER BY quality_score DESC, updated_at DESC
      LIMIT 100
    `, [gap.package_name]);

    if (chunks.length < MIN_CHUNKS_FOR_ENTRY) {
      log(`  Skipping — only ${chunks.length} chunks (need ${MIN_CHUNKS_FOR_ENTRY})`);
      continue;
    }

    // Get existing gold titles for this repo to avoid duplication
    const { rows: existingGold } = await pool.query(`
      SELECT title FROM ask_ruvnet.kb_complete
      WHERE title ILIKE $1 OR content ILIKE $1
    `, [`%${gap.package_name}%`]);
    const existingTitles = existingGold.map(r => r.title);

    // Synthesize gold entries (may return multiple for monorepos)
    const result = await synthesizeGoldEntry(gap.package_name, chunks, existingTitles);
    if (!result) { errors++; continue; }

    // Handle both single entry and array of entries
    const entries = Array.isArray(result) ? result : [result];

    for (const entry of entries) {
      if (entry.quality_score < QUALITY_THRESHOLD) {
        log(`  Skipping "${entry.title}" — quality score ${entry.quality_score} below threshold ${QUALITY_THRESHOLD}`);
        continue;
      }

      log(`  Synthesized: "${entry.title}" (${entry.content.length} chars, quality: ${entry.quality_score})`);

      // Embed
      const text = (entry.title + '\n' + entry.content).substring(0, 2000);
      const embResult = await onnxSvc.embed(text);
      const vecStr = '[' + Array.from(embResult.embedding).join(',') + ']';

      // Upsert into kb_complete (use title-based slug for file_path uniqueness)
      const slug = entry.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
      try {
        await pool.query(`
          INSERT INTO ask_ruvnet.kb_complete
          (title, content, category, quality_score, embedding, file_path)
          VALUES ($1, $2, $3, $4, $5::ruvector(384), $6)
          ON CONFLICT (file_path) DO UPDATE SET
            content = EXCLUDED.content,
            quality_score = EXCLUDED.quality_score,
            embedding = EXCLUDED.embedding,
            updated_at = now()
        `, [
          entry.title,
          entry.content,
          entry.category,
          entry.quality_score,
          vecStr,
          `auto-curated/${gap.package_name}/${slug}`
        ]);
        created++;
        log(`  CREATED gold entry: "${entry.title}"`);
      } catch (err) {
        log(`  ERROR inserting: ${err.message}`);
        errors++;
      }
    }
  }

  // 4. Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`\n=== Curation Complete ===`);
  log(`  New entries created: ${created}`);
  log(`  Entries updated: ${updated}`);
  log(`  Errors: ${errors}`);
  log(`  Time: ${elapsed}s`);

  // 5. Trigger rebuild if requested and entries were added
  if (REBUILD && (created > 0 || updated > 0)) {
    log('\nTriggering RVF rebuild...');
    try {
      execFileSync('/usr/local/bin/node', [path.join(ROOT, 'scripts/build-lean-rvf.mjs')], {
        cwd: ROOT, stdio: 'inherit', timeout: 300000
      });
      execFileSync('/usr/local/bin/node', [path.join(ROOT, 'scripts/build-quantized-rvf.mjs')], {
        cwd: ROOT, stdio: 'inherit', timeout: 120000
      });
      // Also export to MCP kb-data format
      execFileSync('/usr/local/bin/node', [path.join(ROOT, 'scripts/export-mcp-kb.mjs'), '--output', 'kb-data/'], {
        cwd: ROOT, stdio: 'inherit', timeout: 120000
      });
      log('RVF rebuild + MCP export complete.');
    } catch (err) {
      log(`WARNING: RVF rebuild failed: ${err.message}`);
    }
  } else if (created > 0 || updated > 0) {
    log('\nNew entries added. Run the following to rebuild:');
    log('  node scripts/build-lean-rvf.mjs && node scripts/build-quantized-rvf.mjs');
  }

  await pool.end();
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
