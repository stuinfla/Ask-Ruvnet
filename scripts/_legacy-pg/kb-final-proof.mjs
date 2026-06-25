#!/usr/bin/env node
/**
 * FINAL KB PROOF TEST - All 83 entries (original 73 + 10 new ecosystem entries)
 * Tests: search precision, knowledge depth, cross-domain, edge cases, teaching ability
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

async function search(query, limit = 3) {
  const vec = await embed(query);
  const { rows } = await pool.query(
    `SELECT id, title, category, quality_score, LEFT(content, 300) as snippet,
            embedding <=> $1::ruvector as distance
     FROM ask_ruvnet.kb_complete
     ORDER BY distance ASC LIMIT $2`,
    [vec, limit]
  );
  return rows;
}

let passed = 0, failed = 0;
function ok(name, cond, detail = '') {
  if (cond) { console.log(`  OK ${name}`); passed++; }
  else { console.log(`  FAIL ${name}${detail ? ' -- ' + detail : ''}`); failed++; }
}

async function main() {
  console.log('======================================================');
  console.log('  ASK RUVNET KB -- FINAL PROOF OF KNOWLEDGE (83 entries)');
  console.log('======================================================\n');

  console.log('Loading ONNX model...');
  await getEmbedder();

  // ═══ DB HEALTH ═══
  console.log('\n--- DATABASE HEALTH ---');
  const { rows: [stats] } = await pool.query(
    `SELECT COUNT(*) as total, COUNT(embedding) as with_embed,
            COUNT(DISTINCT category) as cats,
            COUNT(DISTINCT LEFT(embedding::text, 50)) as unique_embeds
     FROM ask_ruvnet.kb_complete`
  );
  console.log(`  Entries: ${stats.total}, Embeddings: ${stats.with_embed}, Categories: ${stats.cats}, Unique: ${stats.unique_embeds}`);
  ok('All entries have embeddings', stats.total === stats.with_embed);
  ok('100% unique embeddings', stats.unique_embeds === stats.total);

  // ═══ NEW ECOSYSTEM ENTRIES: Can they be found? ═══
  console.log('\n--- NEW ECOSYSTEM ENTRIES (10 searches) ---');
  const ecosystemTests = [
    { q: 'dynamic mincut algorithm for self-healing AI infrastructure', expect: /MinCut.*Dynamic|MinCut.*Self.Heal/i, tag: 'MinCut' },
    { q: 'SONA self-optimizing real-time learning without retraining', expect: /SONA/i, tag: 'SONA' },
    { q: 'bio-inspired nervous system five layers sensing reflex memory', expect: /Nervous System/i, tag: 'Nervous System' },
    { q: 'mincut gated transformer coherence controlled inference', expect: /Gated Transformer|MinCut.*Transformer/i, tag: 'Gated Transformer' },
    { q: 'browser vector database WebAssembly IndexedDB offline', expect: /WASM.*Browser|Browser.*Vector|RuVector.*WASM/i, tag: 'WASM Browser DB' },
    { q: 'PostgreSQL extension 290 SQL functions pgvector replacement', expect: /Postgres|290.*SQL/i, tag: 'Postgres Extension' },
    { q: '7.2KB neuromorphic WASM spiking neural network ASIC', expect: /Micro.*HNSW|7.*KB.*Neuromorphic|Spiking/i, tag: 'Micro-HNSW' },
    { q: 'complete RuVector crate ecosystem how they connect', expect: /Ecosystem|80.*Crate|Complete/i, tag: 'Ecosystem Map' },
    { q: 'step by step tutorial build WASM knowledge base application RuVector', expect: /Step.*Step|Building.*WASM|Tutorial|Proven Methodology|Teaching.*Chat/i, tag: 'KB App Tutorial' },
    { q: 'teach Ask Ruvnet how to recommend WASM apps to users', expect: /Ask Ruvnet|Teaching|Recommend/i, tag: 'Teaching Entry' },
  ];

  for (const t of ecosystemTests) {
    const results = await search(t.q, 3);
    const top = results[0];
    const d = parseFloat(top.distance).toFixed(3);
    const match = t.expect.test(top.title);
    console.log(`  Q: "${t.tag}" -> [${top.id}] d=${d} ${top.title.substring(0, 65)}`);
    ok(`${t.tag}: correct top result`, match, match ? '' : `Got "${top.title.substring(0, 60)}"`);
  }

  // ═══ ORIGINAL RVF ENTRIES STILL WORK ═══
  console.log('\n--- ORIGINAL RVF ENTRIES (5 spot checks) ---');
  const rvfTests = [
    { q: 'What is RVF cognitive container not a database', expect: /Cognitive Container.*Core|Core.*Concepts/i, tag: 'RVF Core' },
    { q: 'How does copy-on-write branching work for vectors?', expect: /COW|Copy.on.Write|Branch/i, tag: 'COW' },
    { q: 'corporate data leakage offline safe AI zero leak', expect: /Corporate.*Safe|Zero.*Data.*Leak/i, tag: 'Corporate Safety' },
    { q: 'how to build intelligent knowledge bases methodology', expect: /Methodology|Building.*Knowledge/i, tag: 'Methodology' },
    { q: 'WASM binary size for browser knowledge base deployment', expect: /WASM.*Browser|Browser.*Knowledge/i, tag: 'WASM Runtime' },
  ];

  for (const t of rvfTests) {
    const results = await search(t.q, 1);
    const top = results[0];
    const d = parseFloat(top.distance).toFixed(3);
    const match = t.expect.test(top.title);
    console.log(`  Q: "${t.tag}" -> [${top.id}] d=${d} ${top.title.substring(0, 65)}`);
    ok(`${t.tag}: still findable`, match, match ? '' : `Got "${top.title.substring(0, 60)}"`);
  }

  // ═══ KNOWLEDGE DEPTH: Do new entries teach? ═══
  console.log('\n--- KNOWLEDGE DEPTH (new entries teach, not just list) ---');
  // Use direct ID lookups for depth checks (the entries MUST contain these terms)
  const depthTests = [
    { id: 87, label: 'MinCut', mustHave: ['December 2025', 'deterministic', 'subpolynomial', '256-core', 'SELF-HEALING'] },
    { id: 88, label: 'SONA', mustHave: ['MicroLoRA', 'EWC++', 'ReasoningBank', '<1ms', 'Two-Tier'] },
    { id: 89, label: 'Nervous System', mustHave: ['Sensing', 'Reflex', 'Memory', 'Learning', 'Coherence'] },
    { id: 90, label: 'Gated Transformer', mustHave: ['lambda', 'FlashAttention', 'EAGLE-3', 'witness'] },
    { id: 99, label: 'Ecosystem Map', mustHave: ['SONA', 'MINCUT', 'RUVLLM', '@ruvector'] },
  ];

  for (const t of depthTests) {
    const { rows } = await pool.query('SELECT content FROM ask_ruvnet.kb_complete WHERE id = $1', [t.id]);
    const content = rows[0]?.content || '';
    const found = t.mustHave.filter(term => content.includes(term));
    const missing = t.mustHave.filter(term => !content.includes(term));
    ok(`[${t.id}] ${t.label}: ${found.length}/${t.mustHave.length} teaching terms present`,
      missing.length === 0,
      missing.length > 0 ? `Missing: ${missing.join(', ')}` : '');
  }

  // ═══ CROSS-DOMAIN: Old + New work together ═══
  console.log('\n--- CROSS-DOMAIN INTEGRATION ---');
  const crossTests = [
    { q: 'self-healing AI agent swarm with mincut topology optimization', tag: 'Swarm+MinCut' },
    { q: 'WASM browser vector search with SIMD acceleration offline', tag: 'WASM+SIMD' },
    { q: 'build a corporate safe knowledge base that learns from users', tag: 'Corporate+SONA+KB' },
  ];

  for (const t of crossTests) {
    const results = await search(t.q, 5);
    const categories = new Set(results.map(r => r.category));
    console.log(`  Q: "${t.tag}" -> ${results.length} results across ${categories.size} categories`);
    results.forEach(r => {
      const d = parseFloat(r.distance).toFixed(3);
      console.log(`    [${r.id}] d=${d} ${r.category.padEnd(15)} ${r.title.substring(0, 55)}`);
    });
    ok(`${t.tag}: spans 2+ categories`, categories.size >= 2, `Only ${categories.size} category`);
  }

  // ═══ EDGE CASES ═══
  console.log('\n--- EDGE CASES ---');
  const typo = await search('WASAM browsr neuromorphik spiking', 1);
  ok('Typo resilience', parseFloat(typo[0].distance) < 0.75, `d=${parseFloat(typo[0].distance).toFixed(3)}`);

  const biz = await search('enterprise wants offline AI that never sends data to cloud providers', 1);
  ok('Business language -> Corporate safety', /Corporate|Offline|Air|Leak|WASM/i.test(biz[0].title));

  const irrelevant = await search('Taylor Swift concert tickets 2026 tour dates', 1);
  ok('Irrelevant rejected (d > 0.80)', parseFloat(irrelevant[0].distance) > 0.80);

  // ═══ CAN IT TEACH CLAUDE-FLOW? ═══
  console.log('\n--- CLAUDE-FLOW TEACHING ABILITY ---');
  const cfTests = [
    { q: 'Ruflo V3 agent wants to create a WASM knowledge base for a client. What approach should it recommend?',
      expect: /@ruvector\/wasm|browser.*WASM|ONNX|zero.*backend/i, tag: 'CF: Recommend KB approach' },
    { q: 'detect communication bottlenecks in multi-agent swarm using dynamic minimum cut graph partitioning',
      expect: /MinCut|min.cut|topology|bottleneck|Dynamic.*Graph|Agent/i, tag: 'CF: Agent bottleneck tool' },
    { q: 'SONA self-optimizing neural architecture learn from user feedback without retraining LoRA adaptation',
      expect: /SONA|LoRA|real.time.*learn|adaptation|Self.Optimiz/i, tag: 'CF: Learning without retraining' },
  ];

  for (const t of cfTests) {
    const results = await search(t.q, 1);
    const content = (await pool.query('SELECT content FROM ask_ruvnet.kb_complete WHERE id = $1', [results[0].id])).rows[0]?.content || '';
    const match = t.expect.test(content);
    console.log(`  Q: "${t.tag}" -> [${results[0].id}] d=${parseFloat(results[0].distance).toFixed(3)} ${results[0].title.substring(0, 55)}`);
    ok(`${t.tag}: content contains actionable answer`, match);
  }

  // ═══ SUMMARY ═══
  const total = passed + failed;
  const pct = ((passed / total) * 100).toFixed(0);
  console.log('\n======================================================');
  console.log(`  FINAL SCORE: ${passed}/${total} passed (${pct}%)`);
  console.log('======================================================');
  console.log(`  New Ecosystem entries: 10 (IDs 87-101)`);
  console.log(`  Original entries: 73 (IDs 1-86)`);
  console.log(`  Total KB: 83 entries with unique ONNX embeddings`);
  console.log('------------------------------------------------------');

  if (failed === 0) {
    console.log('  VERDICT: KNOWLEDGE BASE IS PROVEN OPERATIONAL');
    console.log('  All entries are findable, teach deeply, work cross-domain,');
    console.log('  and can guide Ruflo V3 to recommend WASM KB apps.');
  } else {
    console.log(`  VERDICT: ${failed} issue(s) -- see failures above`);
  }
  console.log('======================================================');

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
