#!/usr/bin/env node
/**
 * KB Native Embedding Regeneration v1.0.0
 *
 * Uses ruvector's Rust/WASM ONNX embeddings (native approach)
 * Requires: node --experimental-wasm-modules
 *
 * Usage:
 *   node --experimental-wasm-modules scripts/kb-regenerate-native.js
 */

const { Pool } = require('pg');
const ruvector = require('ruvector');

const CONFIG = {
  pg: {
    host: process.env.RUVECTOR_HOST || 'localhost',
    port: parseInt(process.env.RUVECTOR_PORT || '5435'),
    database: 'postgres',
    user: 'postgres',
    password: process.env.RUVECTOR_PASSWORD || ''
  },
  schema: 'ask_ruvnet',
  batchSize: 100,
  maxTextLength: 1500
};

let embedder = null;
let totalProcessed = 0;
let startTime;

function formatTime(ms) {
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) return `${hrs}h ${mins % 60}m`;
  if (mins > 0) return `${mins}m ${secs % 60}s`;
  return `${secs}s`;
}

async function initEmbedder() {
  console.log('🧠 Initializing ruvector ONNX embedder...');
  const result = await ruvector.embed('warmup');
  if (!result || !result.embedding) {
    throw new Error('Failed to initialize embedder');
  }
  console.log(`   ✅ Ready: ${result.dimension}d, ${result.timeMs}ms warmup\n`);
}

async function generateEmbedding(text) {
  const result = await ruvector.embed(text);
  return result.embedding;
}

async function regenerateBatch(pool, offset) {
  const fetchResult = await pool.query(`
    SELECT id, title, content
    FROM ${CONFIG.schema}.architecture_docs
    WHERE content IS NOT NULL
    ORDER BY id
    OFFSET $1 LIMIT $2
  `, [offset, CONFIG.batchSize]);

  if (fetchResult.rows.length === 0) return 0;

  const updates = [];
  for (const row of fetchResult.rows) {
    const text = (row.title + ' ' + row.content).slice(0, CONFIG.maxTextLength);
    const embedding = await generateEmbedding(text);
    updates.push({ id: row.id, embedding });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const { id, embedding } of updates) {
      await client.query(`
        UPDATE ${CONFIG.schema}.architecture_docs
        SET embedding = $1::real[]
        WHERE id = $2
      `, [embedding, id]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return fetchResult.rows.length;
}

async function main() {
  console.log('═'.repeat(60));
  console.log('⚡ KB NATIVE EMBEDDING REGENERATION (ruvector ONNX)');
  console.log(`   Time: ${new Date().toISOString()}`);
  console.log(`   Schema: ${CONFIG.schema}`);
  console.log(`   Batch Size: ${CONFIG.batchSize}`);
  console.log('═'.repeat(60));

  const pool = new Pool(CONFIG.pg);
  startTime = Date.now();

  try {
    const countResult = await pool.query(`
      SELECT COUNT(*) as total FROM ${CONFIG.schema}.architecture_docs WHERE content IS NOT NULL
    `);
    const total = parseInt(countResult.rows[0].total);
    console.log(`\n📊 Total entries: ${total.toLocaleString()}\n`);

    await initEmbedder();

    let offset = 0;
    while (true) {
      const processed = await regenerateBatch(pool, offset);
      if (processed === 0) break;

      totalProcessed += processed;
      offset += CONFIG.batchSize;

      const elapsed = Date.now() - startTime;
      const rate = (totalProcessed / (elapsed / 1000)).toFixed(1);
      const pct = ((totalProcessed / total) * 100).toFixed(1);
      const eta = ((elapsed / totalProcessed) * (total - totalProcessed));

      process.stdout.write(`\r   Progress: ${pct}% | ${totalProcessed.toLocaleString()}/${total.toLocaleString()} | ${rate}/sec | ETA: ${formatTime(eta)}   `);
    }

    const totalTime = Date.now() - startTime;
    console.log(`\n\n✅ COMPLETE!`);
    console.log(`   Processed: ${totalProcessed.toLocaleString()} entries`);
    console.log(`   Time: ${formatTime(totalTime)}`);
    console.log(`   Rate: ${(totalProcessed / (totalTime / 1000)).toFixed(1)} entries/sec\n`);

  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
