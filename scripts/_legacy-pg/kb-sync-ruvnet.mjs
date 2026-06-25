#!/usr/bin/env node
/**
 * kb-sync-ruvnet.mjs
 *
 * Orchestrates the full RuvNet KB auto-sync pipeline:
 *
 *   1. Run the repo monitor to detect new content (releases, commits, npm versions)
 *   2. Chunk long content into manageable KB entry sizes
 *   3. Embed each chunk using @xenova/transformers (all-MiniLM-L6-v2, 384d)
 *      with automatic fallback to PostgreSQL ruvector_embed()
 *   4. Upsert into ask_ruvnet.architecture_docs on the Neon / local PG instance
 *
 * Connection priority (matches PostgresKnowledgeBase.js):
 *   DATABASE_URL env var  → Neon production
 *   RUVECTOR_HOST etc.    → local ruvector-postgres (port 5435)
 *
 * Usage:
 *   node scripts/kb-sync-ruvnet.mjs                  # incremental (default)
 *   node scripts/kb-sync-ruvnet.mjs --force          # re-check all, ingest new only
 *   node scripts/kb-sync-ruvnet.mjs --dry-run        # detect but don't write to DB
 *   node scripts/kb-sync-ruvnet.mjs --target ruflo          # single repo only (use ruflo for legacy)
 *   node scripts/kb-sync-ruvnet.mjs --verbose        # extra logging
 */

import pg from 'pg';
import crypto from 'crypto';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

import { runMonitor } from './monitor-ruvnet-repos.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const FORCE    = argv.includes('--force');
const DRY_RUN  = argv.includes('--dry-run');
const VERBOSE  = argv.includes('--verbose');
const TARGET   = (() => {
  const idx = argv.indexOf('--target');
  return idx !== -1 ? [argv[idx + 1]] : null;
})();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCHEMA = 'ask_ruvnet';
const TABLE  = 'architecture_docs';
const QUALITY_SCORE    = 88;
const SOURCE_AUTHORITY = 'official-docs';
const TRIAGE_TIER      = 'gold';
const EXPERTISE_LEVEL  = 'expert';
const CHUNK_SIZE    = 900;   // chars per KB chunk
const CHUNK_OVERLAP = 120;   // overlap between chunks

// Map monitor event types to KB doc_type values
const DOC_TYPE_MAP = {
  'github-release':    'developer-changelog',
  'changelog-update':  'developer-changelog',
  'npm-version':       'developer-changelog',
  'doc-added':         'architecture-doc',
};

// Map monitor event types to KB category values
const CATEGORY_MAP = {
  'github-release':   'releases',
  'changelog-update': 'releases',
  'npm-version':      'releases',
  'doc-added':        'documentation',
};

// ---------------------------------------------------------------------------
// Database connection
// ---------------------------------------------------------------------------

function createPool() {
  if (process.env.DATABASE_URL) {
    if (VERBOSE) console.log('[sync] Using DATABASE_URL (Neon/production)');
    return new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 4,
      idleTimeoutMillis: 30000,
    });
  }

  if (VERBOSE) console.log('[sync] Using local ruvector-postgres (port 5435)');
  return new pg.Pool({
    host:     process.env.RUVECTOR_HOST || 'localhost',
    port:     parseInt(process.env.RUVECTOR_PORT || '5435'),
    user:     process.env.RUVECTOR_USER || 'postgres',
    password: process.env.RUVECTOR_PASSWORD || '',
    database: 'postgres',
    max: 4,
    idleTimeoutMillis: 30000,
  });
}

// ---------------------------------------------------------------------------
// Embedding service — mirrors pattern in kb-embed.js
// ---------------------------------------------------------------------------

let onnxService = null;
let onnxAvailable = null;
let xenovaEmbedder = null;

/**
 * Try to initialize the ONNX embedding service from @claude-flow/embeddings.
 * Falls back to @xenova/transformers if that path is unavailable.
 * Returns true if any ONNX path succeeded.
 */
async function initEmbedding() {
  // Path 1: @claude-flow/embeddings (fastest — ~930 embeds/sec)
  // Note: this NPM package path is @claude-flow/embeddings and is NOT renamed on npm
  const rufloEmbeddingsPath = process.env.RUFLO_EMBEDDINGS_PATH ||
    process.env.CLAUDE_FLOW_EMBEDDINGS_PATH ||
    path.join(os.homedir(), '.npm-global/lib/node_modules/@claude-flow/cli/node_modules/@claude-flow/embeddings/dist/index.js');

  try {
    const mod = await import(rufloEmbeddingsPath);
    const createFn = mod.createEmbeddingServiceAsync || mod.default?.createEmbeddingServiceAsync;
    if (!createFn) throw new Error('createEmbeddingServiceAsync not found');

    onnxService = await createFn({
      provider: 'transformers',
      model: 'Xenova/all-MiniLM-L6-v2',
      dimensions: 384,
    });
    await onnxService.embed('warmup');
    onnxAvailable = 'ruflo-embeddings';
    console.log('[sync] ONNX embedding via @claude-flow/embeddings ready (~930 embeds/sec)');
    return true;
  } catch {
    // intentional — try next path
  }

  // Path 2: @xenova/transformers directly (available as project dep)
  try {
    const { pipeline } = await import('@xenova/transformers');
    xenovaEmbedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    await xenovaEmbedder('warmup', { pooling: 'mean', normalize: true });
    onnxAvailable = 'xenova-transformers';
    console.log('[sync] ONNX embedding via @xenova/transformers ready');
    return true;
  } catch (err) {
    console.warn(`[sync] @xenova/transformers unavailable: ${err.message}`);
  }

  onnxAvailable = false;
  console.warn('[sync] No ONNX available — will use PostgreSQL ruvector_embed() fallback');
  return false;
}

/**
 * Generate a 384-dimensional embedding for a text string.
 * Returns number[] or null (if both ONNX paths and PG fallback fail).
 */
async function embed(text, pool) {
  const truncated = text.slice(0, 2000);

  // Path 1: @claude-flow/embeddings (via ruflo-embeddings path)
  if (onnxAvailable === 'ruflo-embeddings' && onnxService) {
    try {
      const result = await onnxService.embed(truncated);
      const vec = result.embedding || result;
      return Array.from(vec);
    } catch (err) {
      if (VERBOSE) console.warn(`[sync] ONNX embed error: ${err.message}`);
    }
  }

  // Path 2: @xenova/transformers
  if (onnxAvailable === 'xenova-transformers' && xenovaEmbedder) {
    try {
      const out = await xenovaEmbedder(truncated, { pooling: 'mean', normalize: true });
      return Array.from(out.data);
    } catch (err) {
      if (VERBOSE) console.warn(`[sync] xenova embed error: ${err.message}`);
    }
  }

  // Path 3: PostgreSQL ruvector_embed() fallback
  if (pool) {
    try {
      const res = await pool.query('SELECT ruvector_embed($1) as embedding', [truncated]);
      return res.rows[0].embedding;
    } catch (err) {
      if (VERBOSE) console.warn(`[sync] PG ruvector_embed error: ${err.message}`);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Text chunking
// ---------------------------------------------------------------------------

function chunkText(text, maxSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  if (!text) return [''];
  if (text.length <= maxSize) return [text];

  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + maxSize, text.length);
    chunks.push(text.slice(start, end));
    const next = end - overlap;
    if (next <= start) break; // prevent infinite loop on tiny overlap configs
    start = next;
    if (start >= text.length - overlap) break;
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Sanitization helpers
// ---------------------------------------------------------------------------

function sanitize(str) {
  if (!str) return '';
  // Remove null bytes (PostgreSQL rejects them)
  return String(str).replace(/\x00/g, '').trim();
}

function md5(text) {
  return crypto.createHash('md5').update(String(text)).digest('hex');
}

/**
 * Build a stable doc_id from event type + target + version + chunk index.
 * ON CONFLICT (doc_id) DO NOTHING means re-runs are always idempotent.
 */
function buildDocId(event, chunkIndex) {
  const base = [
    'ruvnet-monitor',
    event.type,
    event.targetId,
    event.version || 'no-version',
    chunkIndex,
  ].join('-');
  // Normalize to valid identifier characters
  return base.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
}

// ---------------------------------------------------------------------------
// DB insertion
// ---------------------------------------------------------------------------

/**
 * Upsert a single KB chunk into ask_ruvnet.architecture_docs.
 * Returns true if a new row was inserted, false if it already existed.
 */
async function upsertChunk(client, event, chunk, chunkIndex, totalChunks, pool) {
  const docId = buildDocId(event, chunkIndex);
  const chunkSuffix = totalChunks > 1 ? ` (part ${chunkIndex + 1}/${totalChunks})` : '';
  const title = sanitize(`${event.title}${chunkSuffix}`);
  const content = sanitize(chunk);
  const fileHash = md5(content);
  const docType = DOC_TYPE_MAP[event.type] || 'architecture-doc';
  const category = CATEGORY_MAP[event.type] || 'releases';
  const filePath = sanitize(event.source);
  const packageName = event.label;
  const packageVersion = sanitize(event.version || '');

  // Concepts extracted from event tags
  const concepts = [event.targetId, event.type, event.knowledge_type].filter(Boolean);

  // Generate embedding
  const embeddingInput = `${title} ${content}`.slice(0, 2000);
  const vec = await embed(embeddingInput, pool);
  const vecSql = vec ? `'[${vec.join(',')}]'::ruvector(384)` : 'NULL';

  const sql = `
    INSERT INTO ${SCHEMA}.${TABLE} (
      doc_id,
      title,
      content,
      file_path,
      file_hash,
      package_name,
      package_version,
      doc_type,
      category,
      quality_score,
      knowledge_type,
      concepts,
      expertise_level,
      source_authority,
      triage_tier,
      is_duplicate,
      embedding
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9,
      ${QUALITY_SCORE},
      $10,
      $11::text[],
      '${EXPERTISE_LEVEL}',
      '${SOURCE_AUTHORITY}',
      '${TRIAGE_TIER}',
      false,
      ${vecSql}
    )
    ON CONFLICT (doc_id) DO NOTHING
  `;

  const params = [
    docId,
    title,
    content,
    filePath,
    fileHash,
    packageName,
    packageVersion,
    docType,
    category,
    event.knowledge_type || 'reference',
    concepts,
  ];

  const result = await client.query(sql, params);
  return result.rowCount > 0;
}

// ---------------------------------------------------------------------------
// Core sync logic
// ---------------------------------------------------------------------------

/**
 * Process one ChangeEvent: chunk → embed → upsert.
 * Returns { inserted, skipped } counts.
 */
async function processEvent(client, event, pool) {
  const chunks = chunkText(event.content);
  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < chunks.length; i++) {
    try {
      const wasInserted = await upsertChunk(client, event, chunks[i], i, chunks.length, pool);
      if (wasInserted) {
        inserted++;
        if (VERBOSE) {
          const suffix = chunks.length > 1 ? ` [chunk ${i + 1}/${chunks.length}]` : '';
          console.log(`    + Inserted: ${event.title}${suffix}`);
        }
      } else {
        skipped++;
        if (VERBOSE) console.log(`    ~ Already exists: ${buildDocId(event, i)}`);
      }
    } catch (err) {
      console.error(`    ! Insert error for ${event.title} chunk ${i}: ${err.message}`);
      skipped++;
    }
  }

  return { inserted, skipped };
}

// ---------------------------------------------------------------------------
// Statistics helper
// ---------------------------------------------------------------------------

async function fetchStats(pool) {
  try {
    const res = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE source_authority = '${SOURCE_AUTHORITY}') as monitor_total,
        COUNT(*) FILTER (WHERE doc_type = 'developer-changelog') as changelog_total,
        MAX(created_at) as latest_insert
      FROM ${SCHEMA}.${TABLE}
      WHERE is_duplicate = false
    `);
    return res.rows[0];
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== AskRuvNet KB Auto-Sync ===');
  console.log(`Mode: ${FORCE ? 'FORCE' : 'incremental'} | ${DRY_RUN ? 'DRY RUN (no DB writes)' : 'live'}`);
  if (TARGET) console.log(`Target filter: ${TARGET.join(', ')}`);
  console.log('');

  // Step 1: Run the monitor
  console.log('[sync] Running repo monitor...');
  const { events, summary } = await runMonitor({
    force: FORCE,
    dryRun: DRY_RUN,   // if dry-run, monitor also skips state save
    targets: TARGET,
  });

  console.log(`\n[sync] Monitor complete: ${summary.totalEvents} new event(s) detected`);
  if (summary.totalEvents === 0) {
    console.log('[sync] Nothing to ingest. KB is up to date.');
    return;
  }

  console.log('[sync] Events by type:');
  for (const [type, count] of Object.entries(summary.byType)) {
    console.log(`  ${type}: ${count}`);
  }

  if (DRY_RUN) {
    console.log('\n[sync] DRY RUN — skipping embedding and DB ingestion.');
    console.log('[sync] Events that would be ingested:');
    for (const ev of events) {
      const chunks = chunkText(ev.content);
      console.log(`  [${ev.type}] ${ev.title} (${chunks.length} chunk(s))`);
    }
    return;
  }

  // Step 2: Initialize embedding
  console.log('\n[sync] Initializing embedding service...');
  await initEmbedding();

  // Step 3: Connect to database
  const pool = createPool();
  let client;
  try {
    client = await pool.connect();
    console.log('[sync] Database connected.\n');
  } catch (err) {
    console.error(`[sync] Could not connect to database: ${err.message}`);
    console.error('[sync] Set DATABASE_URL or RUVECTOR_HOST/PORT env vars and retry.');
    await pool.end();
    process.exit(1);
  }

  // Step 4: Ingest each event
  let totalInserted = 0;
  let totalSkipped = 0;

  try {
    for (const event of events) {
      const chunks = chunkText(event.content);
      if (VERBOSE) {
        console.log(`[sync] Processing: ${event.title} (${chunks.length} chunk(s))`);
      } else {
        process.stdout.write(`  [${event.type}] ${event.title.slice(0, 60)}... `);
      }

      const { inserted, skipped } = await processEvent(client, event, pool);
      totalInserted += inserted;
      totalSkipped += skipped;

      if (!VERBOSE) {
        console.log(`${inserted} inserted, ${skipped} skipped`);
      }
    }
  } finally {
    client.release();
  }

  // Step 5: Report
  console.log('\n=== Sync Complete ===');
  console.log(`  Inserted: ${totalInserted} KB chunks`);
  console.log(`  Skipped:  ${totalSkipped} (already existed)`);

  const stats = await fetchStats(pool);
  if (stats) {
    console.log(`\n  KB totals (official-docs source):`);
    console.log(`    Monitor-sourced entries: ${stats.monitor_total}`);
    console.log(`    Total changelog entries: ${stats.changelog_total}`);
    if (stats.latest_insert) {
      console.log(`    Latest insert:          ${new Date(stats.latest_insert).toISOString()}`);
    }
  }

  await pool.end();
}

main().catch(err => {
  console.error('\n[sync] Fatal error:', err.message);
  if (VERBOSE) console.error(err.stack);
  process.exit(1);
});
