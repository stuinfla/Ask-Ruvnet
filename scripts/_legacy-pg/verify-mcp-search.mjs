#!/usr/bin/env node
/**
 * Verify that knowledge_search() (used by MCP) finds our expert-curated entries
 */
import pg from 'pg';

const pool = new pg.Pool({
  host: 'localhost', port: 5435, user: 'postgres', password: '', database: 'postgres', max: 2
});

let embedder;
async function getEmbedder() {
  if (!embedder) {
    const { pipeline } = await import('@xenova/transformers');
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return embedder;
}

async function embed(text) {
  const e = await getEmbedder();
  const out = await e(text, { pooling: 'mean', normalize: true });
  return '[' + Array.from(out.data).join(',') + ']';
}

async function mcpSearch(query, limit = 5) {
  const vec = await embed(query);
  const { rows } = await pool.query(
    `SELECT id, title, knowledge_type, source_authority, quality, relevance_score
     FROM ask_ruvnet.knowledge_search($1::ruvector(384), $2, 'general', NULL, NULL, 0, 'expert', $3)`,
    [vec, query, limit]
  );
  return rows;
}

async function main() {
  console.log('Loading ONNX...');
  await getEmbedder();

  console.log('\n========================================');
  console.log('  MCP knowledge_search() VERIFICATION');
  console.log('========================================\n');

  const tests = [
    // AIMDS entries
    { q: 'AIMDS prompt injection defense AI manipulation', tag: 'AIMDS Architecture' },
    { q: '25 level meta-learning strange loop recursive optimization', tag: 'Meta-Learning' },
    { q: 'Lyapunov chaos detection adversarial behavior anomaly', tag: 'Behavioral Analysis' },
    { q: 'security agents guardian injection analyst PII swarm', tag: 'Security Agents' },
    { q: 'HNSW threat pattern memory ReasoningBank self-learning', tag: 'ReasoningBank Integration' },
    { q: 'RuvBot 5 layer protection stack production AI security', tag: 'RuvBot Stack' },
    // Original KB entries (should still work)
    { q: 'RVF cognitive container not a database', tag: 'RVF Core' },
    { q: 'WASM browser vector database offline zero backend', tag: 'WASM Browser' },
    { q: 'corporate data leakage zero cloud AI offline', tag: 'Corporate Safety' },
    { q: 'MinCut dynamic graph partitioning self-healing', tag: 'MinCut' },
    { q: 'SONA self-optimizing neural real-time learning', tag: 'SONA' },
    { q: 'building WASM knowledge base step by step tutorial', tag: 'KB Tutorial' },
  ];

  let passed = 0, failed = 0;

  for (const t of tests) {
    const results = await mcpSearch(t.q, 3);
    if (results.length === 0) {
      console.log(`  FAIL ${t.tag}: NO RESULTS`);
      failed++;
      continue;
    }

    const top = results[0];
    const score = parseFloat(top.relevance_score).toFixed(4);

    console.log(`  ${t.tag}:`);
    results.forEach((r, i) => {
      const s = parseFloat(r.relevance_score).toFixed(4);
      const marker = r.source_authority === 'expert-curated' ? '*' : ' ';
      console.log(`    ${marker}${i + 1}. [${r.id}] score=${s} ${r.source_authority} q=${r.quality} | ${r.title.substring(0, 55)}`);
    });

    // Check if ANY of top 3 is expert-curated from our KB
    const hasExpert = results.some(r => r.source_authority === 'expert-curated');
    if (hasExpert) {
      console.log(`    -> OK (expert-curated in top 3)`);
      passed++;
    } else {
      console.log(`    -> WARN (no expert-curated in top 3)`);
      failed++;
    }
    console.log('');
  }

  console.log('========================================');
  console.log(`  RESULT: ${passed}/${passed + failed} queries found expert KB entries in top 3`);
  console.log('========================================');

  // Summary stats
  const { rows: [stats] } = await pool.query(`
    SELECT COUNT(*) as total_searchable,
           COUNT(CASE WHEN source_authority = 'expert-curated' THEN 1 END) as expert,
           COUNT(CASE WHEN triage_tier = 'gold' THEN 1 END) as gold,
           COUNT(CASE WHEN doc_id LIKE 'kb-complete-%' THEN 1 END) as from_kb
    FROM ask_ruvnet.architecture_docs
    WHERE is_duplicate = false AND triage_tier != 'garbage'
  `);
  console.log(`\nMCP searchable: ${stats.total_searchable} | Expert-curated: ${stats.expert} | Gold: ${stats.gold} | From KB: ${stats.from_kb}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
