/**
 * Stage 4: Embed — Generate embeddings for new/rewritten entries
 *
 * Uses ONNX Xenova/all-MiniLM-L6-v2 locally (no API cost).
 * Only processes entries with source_authority = 'llm-generated'
 * that don't have embeddings yet.
 */
const { pool } = require('../config');

let embedPipeline = null;

async function getEmbedPipeline() {
  if (embedPipeline) return embedPipeline;
  const { pipeline } = await import('@xenova/transformers');
  embedPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log('[Stage 4] ONNX pipeline loaded');
  return embedPipeline;
}

async function generateEmbedding(text) {
  const pipe = await getEmbedPipeline();
  const output = await pipe(String(text).slice(0, 512), { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

async function stage04_embed(runId, { dryRun = false, batchSize = 32 } = {}) {
  const client = await pool.connect();

  try {
    // Find entries that need embeddings
    const needEmbedRes = await client.query(`
      SELECT id, title, LEFT(content, 512) as content_preview
      FROM ask_ruvnet.architecture_docs
      WHERE source_authority = 'llm-generated'
        AND is_duplicate = false
        AND embedding IS NULL
      ORDER BY id ASC
    `);

    const entries = needEmbedRes.rows;
    console.log(`[Stage 4] ${entries.length} entries need embeddings`);

    if (entries.length === 0) {
      console.log('[Stage 4] Nothing to embed');
      return { embedded: 0 };
    }

    let embedded = 0;

    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);

      for (const entry of batch) {
        try {
          const text = `${entry.title} ${entry.content_preview}`;
          const embedding = await generateEmbedding(text);

          if (!dryRun) {
            const vectorLiteral = `[${embedding.join(',')}]`;
            await client.query(
              `UPDATE ask_ruvnet.architecture_docs SET embedding = $1::vector WHERE id = $2`,
              [vectorLiteral, entry.id]
            );
          }
          embedded++;
        } catch (err) {
          console.error(`[Stage 4] Failed to embed entry ${entry.id}: ${err.message}`);
        }
      }

      console.log(`[Stage 4] Embedded ${embedded}/${entries.length}`);
    }

    if (!dryRun) {
      await client.query(`
        INSERT INTO ask_ruvnet.curation_pipeline (run_id, stage, status, entries_processed, entries_total)
        VALUES ($1, 'embed', 'completed', $2, $3)
      `, [runId, embedded, entries.length]);
    }

    console.log(`[Stage 4] DONE: ${embedded} entries embedded`);
    return { embedded };
  } finally {
    client.release();
  }
}

module.exports = { stage04_embed };
