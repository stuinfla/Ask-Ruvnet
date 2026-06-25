#!/usr/bin/env node
/**
 * Test Agentics Knowledge Base Search
 * Uses ONNX for query embedding to match stored ONNX embeddings
 */
import pg from 'pg';

const pool = new pg.Pool({
  host: 'localhost', port: 5435, user: 'postgres', password: '', database: 'postgres', max: 2
});

async function main() {
  // Load ONNX
  const embPath = '/Users/stuartkerr/.npm-global/lib/node_modules/@claude-flow/cli/node_modules/@claude-flow/embeddings/dist/index.js';
  const mod = await import(embPath);
  const createFn = mod.createEmbeddingServiceAsync || mod.default?.createEmbeddingServiceAsync;
  const svc = await createFn({ provider: 'transformers', model: 'Xenova/all-MiniLM-L6-v2', dimensions: 384 });
  await svc.embed('warmup');

  async function search(query) {
    let vec = await svc.embed(query);
    if (vec && vec[0] && typeof vec[0] !== 'number') vec = vec[0];
    // Debug vector structure
    if (!global._debugged) {
      console.log(`  Vec type: ${typeof vec}, constructor: ${vec?.constructor?.name}`);
      console.log(`  Keys: ${Object.keys(vec || {}).slice(0,5)}`);
      console.log(`  Is array: ${Array.isArray(vec)}, has data: ${!!vec?.data}`);
      if (vec?.data) console.log(`  .data type: ${vec.data.constructor?.name}, len: ${vec.data.length}`);
      if (vec?.[0]) console.log(`  [0] type: ${typeof vec[0]}, is arr: ${Array.isArray(vec[0])}, len: ${vec[0]?.length}`);
      global._debugged = true;
    }
    let emb = vec?.embedding || vec;
    if (emb && emb[0] && Array.isArray(emb[0])) emb = emb[0];
    const arr = Array.from(emb).slice(0, 384);
    const vecStr = '[' + arr.join(',') + ']';

    const res = await pool.query(
      `SELECT title, left(content, 200) as excerpt,
              1 - (embedding <=> $1::ruvector) as similarity
       FROM openclaw_memory.operational_knowledge
       WHERE tags @> ARRAY['agentics-knowledge'] AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::ruvector LIMIT 3`, [vecStr]
    );
    console.log(`\nQ: "${query}"`);
    for (const r of res.rows) {
      console.log(`  ${(r.similarity * 100).toFixed(1)}% | ${r.title}`);
      console.log(`         ${r.excerpt.substring(0, 120)}...`);
    }
  }

  // Count
  const cnt = await pool.query(`SELECT count(*) as c FROM openclaw_memory.operational_knowledge WHERE tags @> ARRAY['agentics-knowledge']`);
  console.log(`=== Agentics KB: ${cnt.rows[0].c} knowledge entries ===`);

  await search('What is Ruflo V3 and how does its architecture work?');
  await search('What is the RVF cognitive container format?');
  await search('How does the mincut algorithm work in RuVector?');
  await search('What is the Prime Radiant anti-hallucination engine?');
  await search('Tell me about SONA self-optimizing neural architecture');
  await search('What happened at the Global AI Hackathon?');
  await search('How does the Beacon disaster rescue system detect life?');
  await search('What is the hive mind distributed intelligence system?');

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
