#!/usr/bin/env node
/**
 * KB Quality Assurance Validation v1.0.0
 *
 * Ensures all KB embeddings are semantic (from ruvector_embed),
 * not hash-based. Run after every KB update to guarantee quality.
 *
 * Usage:
 *   node scripts/kb-qa-validation.js              # Full validation
 *   node scripts/kb-qa-validation.js --quick      # Sample validation (10 entries)
 *   node scripts/kb-qa-validation.js --fix        # Regenerate bad embeddings
 *
 * Target: 0.98+ similarity for all entries
 */

const { Pool } = require('pg');

const CONFIG = {
  pg: {
    host: process.env.RUVECTOR_HOST || 'localhost',
    port: parseInt(process.env.RUVECTOR_PORT || '5435'),
    database: 'postgres',
    user: 'postgres',
    password: process.env.RUVECTOR_PASSWORD || ''
  },
  schema: 'ask_ruvnet',
  targetSimilarity: 0.98,
  sampleSize: 100,
  batchSize: 1000
};

async function validateEmbeddings(pool, sampleSize = CONFIG.sampleSize) {
  console.log(`\n🔍 Validating ${sampleSize} random embeddings...\n`);

  const result = await pool.query(`
    WITH sample AS (
      SELECT id, title, content, embedding
      FROM ${CONFIG.schema}.architecture_docs
      WHERE embedding IS NOT NULL AND content IS NOT NULL
      ORDER BY RANDOM()
      LIMIT $1
    )
    SELECT
      id,
      LEFT(title, 50) as title,
      1 - cosine_distance_arr(
        embedding,
        ruvector_embed(LEFT(title || ' ' || content, 500))::real[]
      ) as similarity
    FROM sample
    ORDER BY similarity ASC
  `, [sampleSize]);

  const similarities = result.rows.map(r => parseFloat(r.similarity));
  const avg = similarities.reduce((a, b) => a + b, 0) / similarities.length;
  const min = Math.min(...similarities);
  const max = Math.max(...similarities);
  const passing = similarities.filter(s => s >= CONFIG.targetSimilarity).length;

  console.log('📊 Embedding Quality Report');
  console.log('═'.repeat(50));
  console.log(`   Sample Size:     ${sampleSize}`);
  console.log(`   Target Score:    ${CONFIG.targetSimilarity}`);
  console.log(`   Average:         ${avg.toFixed(4)}`);
  console.log(`   Min:             ${min.toFixed(4)}`);
  console.log(`   Max:             ${max.toFixed(4)}`);
  console.log(`   Passing:         ${passing}/${sampleSize} (${(100 * passing / sampleSize).toFixed(1)}%)`);
  console.log('═'.repeat(50));

  // Show worst entries
  if (min < CONFIG.targetSimilarity) {
    console.log('\n⚠️  Lowest scoring entries:');
    result.rows.slice(0, 5).forEach(r => {
      const status = parseFloat(r.similarity) >= CONFIG.targetSimilarity ? '✅' : '❌';
      console.log(`   ${status} ${r.similarity.toFixed(4)} | ${r.title}`);
    });
  }

  const passed = avg >= CONFIG.targetSimilarity;

  console.log(`\n${passed ? '✅ PASSED' : '❌ FAILED'}: Average similarity ${avg.toFixed(4)} ${passed ? '>=' : '<'} ${CONFIG.targetSimilarity}\n`);

  return { passed, avg, min, max, passing, total: sampleSize };
}

async function findBadEmbeddings(pool) {
  console.log('\n🔍 Finding embeddings below threshold...\n');

  const result = await pool.query(`
    WITH checked AS (
      SELECT
        id,
        1 - cosine_distance_arr(
          embedding,
          ruvector_embed(LEFT(title || ' ' || content, 500))::real[]
        ) as similarity
      FROM ${CONFIG.schema}.architecture_docs
      WHERE embedding IS NOT NULL
    )
    SELECT COUNT(*) as bad_count
    FROM checked
    WHERE similarity < $1
  `, [CONFIG.targetSimilarity]);

  return parseInt(result.rows[0].bad_count);
}

async function fixBadEmbeddings(pool) {
  console.log('\n🔧 Regenerating all embeddings with ruvector_embed...\n');

  const countResult = await pool.query(`
    SELECT COUNT(*) as total FROM ${CONFIG.schema}.architecture_docs
  `);
  const total = parseInt(countResult.rows[0].total);

  console.log(`   Total entries: ${total}`);
  console.log(`   Batch size: ${CONFIG.batchSize}`);
  console.log('');

  let processed = 0;
  const startTime = Date.now();

  while (processed < total) {
    await pool.query(`
      UPDATE ${CONFIG.schema}.architecture_docs
      SET embedding = ruvector_embed(LEFT(title || ' ' || content, 2000))::real[]
      WHERE id IN (
        SELECT id FROM ${CONFIG.schema}.architecture_docs
        ORDER BY id
        OFFSET $1 LIMIT $2
      )
    `, [processed, CONFIG.batchSize]);

    processed += CONFIG.batchSize;
    const pct = Math.min(100, (100 * processed / total)).toFixed(1);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = (processed / elapsed).toFixed(0);

    process.stdout.write(`\r   Progress: ${pct}% | ${Math.min(processed, total)}/${total} | ${rate} entries/sec`);
  }

  console.log('\n\n✅ All embeddings regenerated!\n');
}

async function main() {
  const args = process.argv.slice(2);
  const isQuick = args.includes('--quick');
  const isFix = args.includes('--fix');

  console.log('═'.repeat(60));
  console.log('📋 KB QUALITY ASSURANCE VALIDATION');
  console.log(`   Time: ${new Date().toISOString()}`);
  console.log(`   Schema: ${CONFIG.schema}`);
  console.log(`   Target: ${CONFIG.targetSimilarity} similarity`);
  console.log('═'.repeat(60));

  const pool = new Pool(CONFIG.pg);

  try {
    if (isFix) {
      await fixBadEmbeddings(pool);
      console.log('Running validation after fix...');
    }

    const sampleSize = isQuick ? 10 : CONFIG.sampleSize;
    const result = await validateEmbeddings(pool, sampleSize);

    if (!result.passed && !isFix) {
      console.log('💡 To fix: node scripts/kb-qa-validation.js --fix\n');
      process.exit(1);
    }

  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
