#!/usr/bin/env node
/**
 * KB Fast Embedding Regeneration v1.0.0
 *
 * Uses Node.js + ruvector npm package to regenerate embeddings
 * MUCH faster than PostgreSQL because model stays loaded in memory.
 *
 * Target: 0.98+ similarity on all entries
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
  batchSize: 500, // Process 500 at a time
  maxTextLength: 1500
};

let totalProcessed = 0;
let startTime;

async function initEmbedder() {
  console.log('🧠 Initializing embedding model...');
  // Pre-warm the model by generating a test embedding
  await ruvector.embed('test initialization');
  console.log('✅ Model loaded and ready\n');
}

async function regenerateBatch(pool, offset) {
  // Fetch batch
  const fetchResult = await pool.query(`
    SELECT id, title, content
    FROM ${CONFIG.schema}.architecture_docs
    WHERE content IS NOT NULL
    ORDER BY id
    OFFSET $1 LIMIT $2
  `, [offset, CONFIG.batchSize]);

  if (fetchResult.rows.length === 0) return 0;

  // Generate embeddings in parallel using ruvector
  const updates = await Promise.all(fetchResult.rows.map(async (row) => {
    const text = (row.title + ' ' + row.content).slice(0, CONFIG.maxTextLength);
    const embedding = await ruvector.embed(text);
    return { id: row.id, embedding };
  }));

  // Batch update - use a transaction for speed
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

function formatTime(ms) {
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) return `${hrs}h ${mins % 60}m`;
  if (mins > 0) return `${mins}m ${secs % 60}s`;
  return `${secs}s`;
}

async function main() {
  console.log('═'.repeat(60));
  console.log('⚡ KB FAST EMBEDDING REGENERATION');
  console.log(`   Time: ${new Date().toISOString()}`);
  console.log(`   Schema: ${CONFIG.schema}`);
  console.log(`   Batch Size: ${CONFIG.batchSize}`);
  console.log('═'.repeat(60));

  const pool = new Pool(CONFIG.pg);
  startTime = Date.now();

  try {
    // Get total count
    const countResult = await pool.query(`
      SELECT COUNT(*) as total FROM ${CONFIG.schema}.architecture_docs WHERE content IS NOT NULL
    `);
    const total = parseInt(countResult.rows[0].total);
    console.log(`\n📊 Total entries to process: ${total.toLocaleString()}\n`);

    // Initialize embedder
    await initEmbedder();

    // Process in batches
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
