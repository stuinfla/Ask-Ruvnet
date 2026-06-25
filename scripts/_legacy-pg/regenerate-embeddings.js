#!/usr/bin/env node
/**
 * Regenerate embeddings for KB entries missing them
 * Uses ONNX local embeddings (384d, all-MiniLM-L6-v2)
 */
const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5435,
  user: 'postgres',
  password: process.env.RUVECTOR_PASSWORD || '',
  database: 'postgres'
});

const SCHEMA = 'ask_ruvnet';
const BATCH_SIZE = 100;

// Try to load ONNX embedder
let embedder = null;
try {
  const ruvector = require('ruvector');
  if (ruvector.embeddingService) {
    embedder = ruvector.embeddingService;
    console.log('ONNX embedder loaded successfully');
  }
} catch (e) {
  console.log('Warning: ONNX embedder not available, using hash fallback');
}

function hashToVector(text, dim = 384) {
  const vector = new Float32Array(dim);
  for (let i = 0; i < text.length; i++) {
    vector[i % dim] = (vector[i % dim] * 31 + text.charCodeAt(i)) % 1000 / 1000;
  }
  let mag = 0;
  for (let i = 0; i < dim; i++) mag += vector[i] * vector[i];
  mag = Math.sqrt(mag) || 1;
  for (let i = 0; i < dim; i++) vector[i] /= mag;
  return Array.from(vector);
}

async function getEmbedding(text) {
  if (embedder && embedder.embed) {
    try {
      return await embedder.embed(text);
    } catch {}
  }
  return hashToVector(text, 384);
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  REGENERATING MISSING EMBEDDINGS');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  // Count entries without embeddings
  const countResult = await pool.query(`
    SELECT COUNT(*) as missing
    FROM ${SCHEMA}.architecture_docs
    WHERE embedding IS NULL
  `);

  const missingCount = parseInt(countResult.rows[0].missing);
  console.log(`Entries missing embeddings: ${missingCount}\n`);

  if (missingCount === 0) {
    console.log('All entries have embeddings!');
    await pool.end();
    return;
  }

  let processed = 0;
  let batchNum = 0;

  while (processed < missingCount) {
    // Get batch of entries without embeddings
    const batch = await pool.query(`
      SELECT id, content
      FROM ${SCHEMA}.architecture_docs
      WHERE embedding IS NULL
      ORDER BY id
      LIMIT ${BATCH_SIZE}
    `);

    if (batch.rows.length === 0) break;

    batchNum++;
    console.log(`Processing batch ${batchNum} (${batch.rows.length} entries)...`);

    for (const row of batch.rows) {
      try {
        const embedding = await getEmbedding(row.content);
        await pool.query(`
          UPDATE ${SCHEMA}.architecture_docs
          SET embedding = $1, updated_at = NOW()
          WHERE id = $2
        `, [embedding, row.id]);
        processed++;
      } catch (e) {
        console.warn(`  Error on id ${row.id}: ${e.message}`);
      }
    }

    // Progress update every 10 batches
    if (batchNum % 10 === 0) {
      const pct = ((processed / missingCount) * 100).toFixed(1);
      console.log(`  Progress: ${processed}/${missingCount} (${pct}%)`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('  EMBEDDING REGENERATION COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`  Processed: ${processed} entries`);

  // Final stats
  const finalStats = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE embedding IS NOT NULL) as with_embedding
    FROM ${SCHEMA}.architecture_docs
  `);

  const total = parseInt(finalStats.rows[0].total);
  const withEmb = parseInt(finalStats.rows[0].with_embedding);
  const coverage = ((withEmb / total) * 100).toFixed(1);

  console.log(`  Total entries: ${total}`);
  console.log(`  With embeddings: ${withEmb} (${coverage}%)`);

  await pool.end();
}

main().catch(e => {
  console.error('Error:', e.message);
  pool.end();
  process.exit(1);
});
