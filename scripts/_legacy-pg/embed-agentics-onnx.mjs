#!/usr/bin/env node
/**
 * ONNX Embedding for Agentics Knowledge Entries
 * Uses @claude-flow/embeddings (~930 embeds/sec) instead of ruvector_embed (~17/sec)
 */
import pg from 'pg';

const pool = new pg.Pool({
  host: 'localhost', port: 5435, user: 'postgres', password: '', database: 'postgres', max: 2
});

const EMBED_PATH = process.env.CLAUDE_FLOW_EMBEDDINGS_PATH ||
  '/Users/stuartkerr/.npm-global/lib/node_modules/@claude-flow/cli/node_modules/@claude-flow/embeddings/dist/index.js';

async function main() {
  console.log('Loading ONNX embedding service...');

  let embedService;
  try {
    const mod = await import(EMBED_PATH);
    const createFn = mod.createEmbeddingServiceAsync || mod.default?.createEmbeddingServiceAsync;
    if (!createFn) throw new Error('createEmbeddingServiceAsync not found');
    embedService = await createFn({ provider: 'transformers', model: 'Xenova/all-MiniLM-L6-v2', dimensions: 384 });
    await embedService.embed('warmup');
    console.log('ONNX service loaded successfully (~930 embeds/sec)');
  } catch (e) {
    console.error('Failed to load ONNX:', e.message);
    process.exit(1);
  }

  // Get all agentics-knowledge entries without embeddings
  const res = await pool.query(`
    SELECT id, title, LEFT(title || ' ' || content, 2000) as text
    FROM openclaw_memory.operational_knowledge
    WHERE tags @> ARRAY['agentics-knowledge'] AND embedding IS NULL
    ORDER BY id
  `);

  console.log(`Found ${res.rows.length} entries needing embeddings`);

  let done = 0;
  for (const row of res.rows) {
    try {
      const result = await embedService.embed(row.text);
      // Debug first row to understand structure
      if (done === 0) console.log('  Embed result type:', typeof result, 'constructor:', result?.constructor?.name, 'keys:', result ? Object.keys(result).slice(0, 5) : 'null');
      // Handle Float32Array, typed arrays, nested arrays, or objects with data property
      let vec;
      if (result?.data) vec = Array.from(result.data);
      else if (result?.embedding) vec = Array.from(result.embedding);
      else if (ArrayBuffer.isView(result)) vec = Array.from(result);
      else if (Array.isArray(result) && Array.isArray(result[0])) vec = Array.from(result[0]);
      else if (Array.isArray(result)) vec = result;
      else vec = Array.from(Object.values(result));
      const vecStr = '[' + vec.join(',') + ']';

      await pool.query(
        `UPDATE openclaw_memory.operational_knowledge SET embedding = $1::ruvector WHERE id = $2`,
        [vecStr, row.id]
      );
      done++;
      console.log(`  [${done}/${res.rows.length}] ${row.title.substring(0, 50)}`);
    } catch (e) {
      console.error(`  FAILED ${row.id}: ${e.message}`);
    }
  }

  // Verify
  const verify = await pool.query(`
    SELECT count(*) as total, count(embedding) as embedded
    FROM openclaw_memory.operational_knowledge
    WHERE tags @> ARRAY['agentics-knowledge']
  `);
  console.log(`\nResult: ${verify.rows[0].embedded}/${verify.rows[0].total} entries have embeddings`);

  // Test a search
  if (parseInt(verify.rows[0].embedded) > 0) {
    console.log('\nTesting semantic search for "Ruflo architecture"...');
    const testEmbed = await embedService.embed('Ruflo architecture');
    const testVec = Array.isArray(testEmbed) ? (Array.isArray(testEmbed[0]) ? testEmbed[0] : testEmbed) : testEmbed;
    const testVecStr = '[' + testVec.join(',') + ']';

    const searchRes = await pool.query(`
      SELECT title, 1 - (embedding <=> $1::ruvector) as similarity
      FROM openclaw_memory.operational_knowledge
      WHERE tags @> ARRAY['agentics-knowledge'] AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::ruvector
      LIMIT 5
    `, [testVecStr]);

    console.log('Top 5 results:');
    for (const r of searchRes.rows) {
      console.log(`  ${(r.similarity * 100).toFixed(1)}% - ${r.title}`);
    }
  }

  await pool.end();
  console.log('\nDone!');
}

main().catch(e => { console.error(e); process.exit(1); });
