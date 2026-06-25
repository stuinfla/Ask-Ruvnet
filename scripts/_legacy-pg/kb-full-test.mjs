#!/usr/bin/env node
/**
 * Full KB Validation Test Suite
 * Tests: embedding diversity, semantic search accuracy, coverage, edge cases
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

async function semanticSearch(query, limit = 5) {
  const vec = await embed(query);
  const { rows } = await pool.query(
    `SELECT id, title, category, quality_score,
            embedding <=> '${vec}'::ruvector as distance
     FROM ask_ruvnet.kb_complete
     ORDER BY distance ASC LIMIT ${limit}`
  );
  return rows;
}

let passed = 0;
let failed = 0;
let warnings = 0;

function test(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function warn(name, detail) {
  console.log(`  ⚠️  ${name} — ${detail}`);
  warnings++;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       ASK RUVNET KNOWLEDGE BASE — FULL VALIDATION TEST     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // ──────────────────────────────────────────
  // TEST 1: Database connectivity & entry count
  // ──────────────────────────────────────────
  console.log('━━━ TEST 1: Database Health ━━━');
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) as total,
            COUNT(embedding) as with_embed,
            COUNT(DISTINCT category) as categories,
            MIN(quality_score) as min_quality,
            MAX(quality_score) as max_quality,
            ROUND(AVG(quality_score)) as avg_quality
     FROM ask_ruvnet.kb_complete`
  );
  const stats = countRows[0];
  console.log(`  Total entries: ${stats.total}`);
  console.log(`  With embeddings: ${stats.with_embed}`);
  console.log(`  Categories: ${stats.categories}`);
  console.log(`  Quality: min=${stats.min_quality} avg=${stats.avg_quality} max=${stats.max_quality}`);
  test('Has entries', parseInt(stats.total) > 50);
  test('All entries have embeddings', stats.total === stats.with_embed);
  test('Multiple categories', parseInt(stats.categories) >= 5);

  // ──────────────────────────────────────────
  // TEST 2: Embedding diversity
  // ──────────────────────────────────────────
  console.log('\n━━━ TEST 2: Embedding Diversity ━━━');
  const { rows: divRows } = await pool.query(
    `SELECT COUNT(DISTINCT LEFT(embedding::text, 50)) as unique_prefixes,
            COUNT(*) as total
     FROM ask_ruvnet.kb_complete WHERE embedding IS NOT NULL`
  );
  const uniquePct = (parseInt(divRows[0].unique_prefixes) / parseInt(divRows[0].total) * 100).toFixed(1);
  console.log(`  Unique embedding prefixes: ${divRows[0].unique_prefixes} / ${divRows[0].total} (${uniquePct}%)`);
  test('100% unique embeddings', divRows[0].unique_prefixes === divRows[0].total);

  // ──────────────────────────────────────────
  // TEST 3: Category distribution
  // ──────────────────────────────────────────
  console.log('\n━━━ TEST 3: Category Distribution ━━━');
  const { rows: catRows } = await pool.query(
    `SELECT category, COUNT(*) as cnt, ROUND(AVG(quality_score)) as avg_q
     FROM ask_ruvnet.kb_complete GROUP BY category ORDER BY cnt DESC`
  );
  catRows.forEach(r => console.log(`  ${r.category.padEnd(22)} ${String(r.cnt).padStart(3)} entries  (avg quality: ${r.avg_q})`));
  test('No empty categories', catRows.every(r => parseInt(r.cnt) > 0));

  // ──────────────────────────────────────────
  // TEST 4: Semantic Search Accuracy
  // ──────────────────────────────────────────
  console.log('\n━━━ TEST 4: Semantic Search Accuracy (10 queries) ━━━');

  const searchTests = [
    {
      query: 'How to prevent corporate data leakage with offline AI',
      expectTitle: /corporate.safe|data.leak|air.gap|offline/i,
      expectCategory: 'security',
      label: 'Corporate data safety'
    },
    {
      query: 'WASM browser-based vector search knowledge base',
      expectTitle: /wasm|browser|knowledge.base/i,
      expectCategory: null,
      label: 'WASM KB apps'
    },
    {
      query: 'multi-agent swarm coordination hive mind consensus',
      expectTitle: /swarm|hive|consensus|agent.*coord|agent.*ref/i,
      expectCategory: null,
      label: 'Swarm coordination'
    },
    {
      query: 'cryptographic witness chain audit trail tamper proof',
      expectTitle: /witness|crypto|security|merkle/i,
      expectCategory: null,
      label: 'Cryptographic security'
    },
    {
      query: 'progressive HNSW indexing three layer recall performance',
      expectTitle: /progressive|index|performance|hnsw/i,
      expectCategory: null,
      label: 'Progressive indexing'
    },
    {
      query: 'copy on write branching for vector databases git-like',
      expectTitle: /cow|branch|copy.on.write/i,
      expectCategory: null,
      label: 'COW branching'
    },
    {
      query: 'self-booting Linux kernel microservice Firecracker eBPF',
      expectTitle: /self.boot|kernel|cognitive.container|compute/i,
      expectCategory: null,
      label: 'Self-booting containers'
    },
    {
      query: 'AGI container agent runtime packaging authority levels',
      expectTitle: /agi|agent.*runtime|container/i,
      expectCategory: null,
      label: 'AGI containers'
    },
    {
      query: 'reinforcement learning experience replay Q-learning',
      expectTitle: /reinforcement|experience.replay|q.learn/i,
      expectCategory: null,
      label: 'Reinforcement learning'
    },
    {
      query: 'RAG pipeline retrieval augmented generation semantic search',
      expectTitle: /rag|retrieval|semantic|search|hybrid/i,
      expectCategory: null,
      label: 'RAG patterns'
    }
  ];

  for (const t of searchTests) {
    const results = await semanticSearch(t.query, 3);
    const top = results[0];
    const topDist = parseFloat(top.distance).toFixed(3);
    const titleMatch = t.expectTitle.test(top.title);
    const catMatch = !t.expectCategory || top.category === t.expectCategory;

    console.log(`\n  Query: "${t.label}"`);
    results.forEach((r, i) => {
      const d = parseFloat(r.distance).toFixed(3);
      const marker = i === 0 ? (titleMatch ? '→' : '✗') : ' ';
      console.log(`    ${marker} [${r.id}] d=${d} | ${r.title.substring(0, 65)}`);
    });

    test(`${t.label}: top result is relevant (d=${topDist})`, titleMatch,
      titleMatch ? '' : `Expected ${t.expectTitle}, got "${top.title}"`);

    // Check that top result distance is reasonable (< 0.8 means meaningful)
    if (parseFloat(topDist) > 0.8) {
      warn(`${t.label}: distance is high`, `d=${topDist} — may indicate weak match`);
    }
  }

  // ──────────────────────────────────────────
  // TEST 5: RVF-specific knowledge retrieval
  // ──────────────────────────────────────────
  console.log('\n\n━━━ TEST 5: RVF Knowledge Depth (can it teach?) ━━━');

  const depthTests = [
    { query: 'What segment types does an RVF file contain?', expectId: 75, label: 'Segment types' },
    { query: 'How to install RVF npm packages for Node.js', expectId: 76, label: 'SDK/npm packages' },
    { query: 'What are the performance benchmarks for RVF?', expectId: 79, label: 'Performance data' },
    { query: 'How does ruflo v3 integrate with RVF for WASM apps?', expectId: 82, label: 'CF+RVF integration' },
  ];

  for (const t of depthTests) {
    const results = await semanticSearch(t.query, 3);
    const found = results.some(r => r.id === t.expectId);
    const top = results[0];
    console.log(`  Query: "${t.label}" → top=[${top.id}] d=${parseFloat(top.distance).toFixed(3)} | ${top.title.substring(0, 55)}`);
    test(`${t.label}: correct entry in top-3`, found,
      found ? '' : `Expected id=${t.expectId} in results`);
  }

  // ──────────────────────────────────────────
  // TEST 6: Cross-domain relevance (no false positives)
  // ──────────────────────────────────────────
  console.log('\n━━━ TEST 6: No False Positives ━━━');
  const irrelevantTests = [
    { query: 'chocolate cake recipe baking instructions', label: 'Unrelated: cooking' },
    { query: 'basketball game scores NBA playoffs', label: 'Unrelated: sports' },
  ];

  for (const t of irrelevantTests) {
    const results = await semanticSearch(t.query, 1);
    const dist = parseFloat(results[0].distance);
    console.log(`  Query: "${t.label}" → d=${dist.toFixed(3)} | ${results[0].title.substring(0, 50)}`);
    test(`${t.label}: high distance (d > 0.8)`, dist > 0.80,
      `Distance ${dist.toFixed(3)} — should be > 0.80 for irrelevant queries`);
  }

  // ──────────────────────────────────────────
  // TEST 7: Content integrity
  // ──────────────────────────────────────────
  console.log('\n━━━ TEST 7: Content Integrity ━━━');
  const { rows: contentRows } = await pool.query(
    `SELECT id, title, LENGTH(content) as len, quality_score
     FROM ask_ruvnet.kb_complete
     WHERE LENGTH(content) < 100 OR quality_score < 50
     ORDER BY len ASC LIMIT 5`
  );
  test('No very short entries (< 100 chars)', contentRows.length === 0,
    contentRows.length > 0 ? `Found ${contentRows.length} short entries` : '');

  const { rows: nullRows } = await pool.query(
    `SELECT COUNT(*) as cnt FROM ask_ruvnet.kb_complete
     WHERE title IS NULL OR content IS NULL OR category IS NULL`
  );
  test('No NULL titles/content/categories', parseInt(nullRows[0].cnt) === 0);

  // ──────────────────────────────────────────
  // TEST 8: RVF entries completeness
  // ──────────────────────────────────────────
  console.log('\n━━━ TEST 8: RVF Knowledge Coverage ━━━');
  const rvfTopics = [
    { pattern: '%Cognitive Container%Core%', label: 'RVF Core Concepts' },
    { pattern: '%WASM%Browser%', label: 'WASM Runtime' },
    { pattern: '%24-Segment%', label: 'Architecture/Segments' },
    { pattern: '%SDK%Package%', label: 'SDK & Packages' },
    { pattern: '%COW%Branch%', label: 'COW Branching' },
    { pattern: '%Witness%Post-Quantum%', label: 'Security/Crypto' },
    { pattern: '%Progressive%Performance%', label: 'Progressive Indexing' },
    { pattern: '%Self-Boot%Three-Tier%', label: 'Self-Booting Containers' },
    { pattern: '%AGI%Agent Runtime%', label: 'AGI Containers' },
    { pattern: '%Ruflo%WASM%Knowledge%', label: 'CF+RVF Integration' },
    { pattern: '%Corporate-Safe%Zero Data Leak%', label: 'Corporate Safety' },
  ];

  for (const t of rvfTopics) {
    const { rows } = await pool.query(
      `SELECT id, title FROM ask_ruvnet.kb_complete WHERE title LIKE $1`, [t.pattern]
    );
    test(`${t.label} entry exists`, rows.length > 0,
      rows.length > 0 ? `[${rows[0].id}]` : 'MISSING');
  }

  // ──────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  RESULTS: ${passed} passed, ${failed} failed, ${warnings} warnings`);
  console.log(`║  Score: ${passed}/${passed + failed} (${((passed / (passed + failed)) * 100).toFixed(0)}%)`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  if (failed === 0) {
    console.log('\n🟢 KNOWLEDGE BASE IS FULLY OPERATIONAL');
  } else {
    console.log('\n🔴 KNOWLEDGE BASE HAS ISSUES — SEE FAILURES ABOVE');
  }

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
