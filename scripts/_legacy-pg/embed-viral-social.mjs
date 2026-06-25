#!/usr/bin/env node
/**
 * embed-viral-social.mjs
 * Generates ONNX embeddings for viral_social.knowledge entries
 * Uses @claude-flow/embeddings with Xenova/all-MiniLM-L6-v2 (384 dimensions)
 */

import pg from 'pg';

const BATCH_SIZE = 100;
const DIMENSIONS = 384;
const PG_CONFIG = {
  host: 'localhost',
  port: 5435,
  user: 'postgres',
  database: 'postgres',
};

async function main() {
  // Dynamic import of the embeddings module
  const embeddingsModule = await import(
    '/Users/stuartkerr/.npm-global/lib/node_modules/@claude-flow/cli/node_modules/@claude-flow/embeddings/dist/index.js'
  );

  const { createEmbeddingServiceAsync, TransformersEmbeddingService } = embeddingsModule;

  console.log('Initializing embedding service...');
  let embeddingService;
  try {
    embeddingService = await createEmbeddingServiceAsync({
      provider: 'transformers',
      model: 'Xenova/all-MiniLM-L6-v2',
      dimensions: DIMENSIONS,
    });
  } catch (e) {
    console.log('createEmbeddingServiceAsync failed, trying TransformersEmbeddingService directly...');
    embeddingService = new TransformersEmbeddingService({
      model: 'Xenova/all-MiniLM-L6-v2',
      dimensions: DIMENSIONS,
    });
    if (embeddingService.initialize) await embeddingService.initialize();
  }
  console.log('Embedding service ready.');

  const pool = new pg.Pool(PG_CONFIG);

  try {
    // Count entries needing embeddings
    const countResult = await pool.query(
      'SELECT COUNT(*) as cnt FROM viral_social.knowledge WHERE embedding IS NULL'
    );
    const totalNeeding = parseInt(countResult.rows[0].cnt, 10);
    console.log(`${totalNeeding} entries need embeddings.`);

    if (totalNeeding === 0) {
      console.log('All entries already have embeddings. Done.');
      return;
    }

    let processed = 0;
    let batchNum = 0;

    while (processed < totalNeeding) {
      batchNum++;
      const batchResult = await pool.query(
        `SELECT id, title, content FROM viral_social.knowledge
         WHERE embedding IS NULL
         ORDER BY id
         LIMIT $1`,
        [BATCH_SIZE]
      );

      if (batchResult.rows.length === 0) break;

      const texts = batchResult.rows.map((row) => {
        const combined = `${row.title || ''}\n${row.content || ''}`.trim();
        return combined.substring(0, 2000); // Limit input length
      });

      console.log(
        `Batch ${batchNum}: embedding ${batchResult.rows.length} entries (${processed + batchResult.rows.length}/${totalNeeding})...`
      );

      // Embed all texts in this batch - one at a time (embedBatch may not work for all)
      const embeddings = [];
      for (const text of texts) {
        const result = await embeddingService.embed(text);
        // Result is { embedding: {0: val, 1: val, ...} } - convert to array
        let vec;
        if (Array.isArray(result)) {
          vec = result;
        } else if (result && result.embedding) {
          vec = Array.from({ length: DIMENSIONS }, (_, i) => result.embedding[i] || 0);
        } else if (result && typeof result === 'object') {
          vec = Array.from({ length: DIMENSIONS }, (_, i) => result[i] || 0);
        } else {
          throw new Error('Unexpected embedding result format: ' + typeof result);
        }
        embeddings.push(vec);
      }

      // Update each row with its embedding
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (let i = 0; i < batchResult.rows.length; i++) {
          const id = batchResult.rows[i].id;
          const vec = embeddings[i];
          // Format as PostgreSQL vector literal: [0.1,0.2,...]
          const vecStr = `[${vec.join(',')}]`;
          await client.query(
            `UPDATE viral_social.knowledge SET embedding = $1::ruvector(384) WHERE id = $2`,
            [vecStr, id]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      processed += batchResult.rows.length;
    }

    // Verify
    const verifyResult = await pool.query(
      'SELECT COUNT(*) as with_emb FROM viral_social.knowledge WHERE embedding IS NOT NULL'
    );
    console.log(
      `\nDone! ${verifyResult.rows[0].with_emb} entries now have embeddings.`
    );

    const nullResult = await pool.query(
      'SELECT COUNT(*) as without_emb FROM viral_social.knowledge WHERE embedding IS NULL'
    );
    console.log(`${nullResult.rows[0].without_emb} entries still missing embeddings.`);
  } finally {
    await pool.end();
    // Force exit since ONNX runtime may keep the process alive
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
