#!/usr/bin/env node
/**
 * ONNX Batch Embedding Pipeline v4.0
 * Uses staging table + JOIN UPDATE for maximum DB throughput
 *
 * Strategy:
 * 1. ONNX embeds texts in batches of 100 (~930/sec)
 * 2. INSERT embeddings into staging table (fast, no indexes)
 * 3. Bulk UPDATE main table FROM staging table (single JOIN)
 * 4. TRUNCATE staging table, repeat
 *
 * Expected: ~200-300 rows/sec end-to-end
 */
import pg from 'pg';

const ONNX_BATCH = 100;
const DB_BATCH = 1000;  // larger batches since staging is fast
const SCHEMA = 'ask_ruvnet';
const TABLE = 'architecture_docs';
const CONTENT_COL = 'content';
const EMBED_COL = 'embedding';
const MAX_TEXT_LEN = 2000;
const STAGING_TABLE = 'ask_ruvnet._embed_staging';

const pool = new pg.Pool({
  host: 'localhost',
  port: 5435,
  user: 'postgres',
  password: '',
  database: 'postgres',
  max: 4
});

async function main() {
  console.log('=== ONNX Batch Embedding Pipeline v4.0 (Staging Table) ===');
  console.log(`Target: ${SCHEMA}.${TABLE}`);
  console.log(`ONNX batch: ${ONNX_BATCH}, DB batch: ${DB_BATCH}\n`);

  // Create staging table (unlogged for speed, no indexes)
  await pool.query(`
    CREATE UNLOGGED TABLE IF NOT EXISTS ${STAGING_TABLE} (
      id INT PRIMARY KEY,
      vec TEXT NOT NULL
    )
  `);
  await pool.query(`TRUNCATE ${STAGING_TABLE}`);

  const countRes = await pool.query(`
    SELECT COUNT(*) as total, COUNT(${EMBED_COL}) as with_emb
    FROM ${SCHEMA}.${TABLE}
  `);
  const total = parseInt(countRes.rows[0].total);
  const done = parseInt(countRes.rows[0].with_emb);
  const remaining = total - done;
  console.log(`Progress: ${done}/${total} done, ${remaining} remaining`);

  if (remaining === 0) {
    console.log('All embeddings complete!');
    await cleanup();
    return;
  }

  // Load ONNX
  const embeddingsPath = '/Users/stuartkerr/.npm-global/lib/node_modules/@claude-flow/cli/node_modules/@claude-flow/embeddings/dist/index.js';
  const mod = await import(embeddingsPath);
  console.log('Creating ONNX embedding service...');
  const svc = await mod.createEmbeddingServiceAsync({
    provider: 'transformers',
    model: 'Xenova/all-MiniLM-L6-v2',
    dimensions: 384
  });
  console.log('Warming up ONNX model...');
  await svc.embed('warmup');
  console.log('Ready.\n');

  let processed = 0;
  const startTime = Date.now();

  while (processed < remaining) {
    // Fetch batch of NULL-embedding rows
    const fetchRes = await pool.query(`
      SELECT id, LEFT(${CONTENT_COL}, ${MAX_TEXT_LEN}) as txt
      FROM ${SCHEMA}.${TABLE}
      WHERE ${EMBED_COL} IS NULL
      ORDER BY id LIMIT ${DB_BATCH}
    `);
    if (fetchRes.rows.length === 0) break;
    const items = fetchRes.rows;

    // ONNX batch embed
    const allEmbeddings = [];
    for (let i = 0; i < items.length; i += ONNX_BATCH) {
      const batchTexts = items.slice(i, i + ONNX_BATCH).map(r => r.txt || 'empty');
      const result = await svc.embedBatch(batchTexts);
      for (const item of result.embeddings) {
        allEmbeddings.push(item.embedding || item);
      }
    }

    // Stage: bulk INSERT into unlogged staging table
    await pool.query(`TRUNCATE ${STAGING_TABLE}`);

    // Build multi-row INSERT (much faster than individual inserts)
    const values = [];
    const params = [];
    let paramIdx = 1;
    for (let i = 0; i < items.length; i++) {
      const vec = allEmbeddings[i];
      if (!vec || vec.length !== 384) continue;
      values.push(`($${paramIdx}, $${paramIdx + 1})`);
      params.push(items[i].id);
      params.push('[' + Array.from(vec).join(',') + ']');
      paramIdx += 2;
    }

    if (values.length > 0) {
      // Batch insert into staging
      await pool.query(
        `INSERT INTO ${STAGING_TABLE} (id, vec) VALUES ${values.join(',')}`,
        params
      );

      // Single bulk UPDATE from staging
      await pool.query(`
        UPDATE ${SCHEMA}.${TABLE} t
        SET ${EMBED_COL} = s.vec::ruvector(384)
        FROM ${STAGING_TABLE} s
        WHERE t.id = s.id
      `);
    }

    processed += items.length;
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = Math.round(processed / elapsed);
    const eta = remaining - processed > 0 ? Math.round((remaining - processed) / rate) : 0;
    console.log(`[${new Date().toLocaleTimeString()}] ${done + processed}/${total} (${Math.round((done + processed) / total * 100)}%) | ${rate} rows/sec | ETA: ${Math.round(eta / 60)}m`);
  }

  const totalTime = Math.round((Date.now() - startTime) / 1000);
  console.log(`\nComplete! ${processed} rows in ${totalTime}s (${Math.round(processed / totalTime)} rows/sec)`);

  const verifyRes = await pool.query(`SELECT COUNT(*) FROM ${SCHEMA}.${TABLE} WHERE ${EMBED_COL} IS NOT NULL`);
  console.log(`Final: ${verifyRes.rows[0].count}/${total} embedded`);

  await cleanup();
}

async function cleanup() {
  try { await pool.query(`DROP TABLE IF EXISTS ${STAGING_TABLE}`); } catch {}
  await pool.end();
}

main().catch(e => {
  console.error('Fatal:', e.message);
  cleanup().catch(() => {});
  process.exit(1);
});
