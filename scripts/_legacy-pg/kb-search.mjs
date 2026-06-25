#!/usr/bin/env node
/**
 * KB Knowledge Search CLI v3.0 - Intent-aware ONNX semantic search
 *
 * Uses ONNX (Xenova/all-MiniLM-L6-v2) for query embedding,
 * knowledge_search() for intent-aware, authority-weighted retrieval.
 *
 * The search understands WHAT you're asking:
 *   "how do I deploy?" → boosts procedure entries
 *   "what is HNSW?"    → boosts concept entries
 *   "why PostgreSQL?"   → boosts decision entries
 *
 * Usage:
 *   node scripts/kb-search.mjs "your search query"
 *   node scripts/kb-search.mjs "how do I set up HNSW?" --limit 10
 *   node scripts/kb-search.mjs "swarm topology" --category swarms
 *   node scripts/kb-search.mjs "agent types" --min-quality 80
 *   node scripts/kb-search.mjs "topology" --raw  (skip knowledge ranking)
 *   node scripts/kb-search.mjs "deploy" --intent how-to
 *   node scripts/kb-search.mjs "basics" --level beginner
 */
import pg from 'pg';

const query = process.argv.find((a, i) => i >= 2 && !a.startsWith('--'));
const limit = process.argv.includes('--limit')
  ? parseInt(process.argv[process.argv.indexOf('--limit') + 1]) || 10
  : 10;
const category = process.argv.includes('--category')
  ? process.argv[process.argv.indexOf('--category') + 1]
  : null;
const minQuality = process.argv.includes('--min-quality')
  ? parseInt(process.argv[process.argv.indexOf('--min-quality') + 1]) || 0
  : 0;
const intentOverride = process.argv.includes('--intent')
  ? process.argv[process.argv.indexOf('--intent') + 1]
  : null;
const level = process.argv.includes('--level')
  ? process.argv[process.argv.indexOf('--level') + 1]
  : 'expert';
const raw = process.argv.includes('--raw');

if (!query) {
  console.error('Usage: node scripts/kb-search.mjs "search query" [options]');
  console.error('Options:');
  console.error('  --limit N         Max results (default: 10)');
  console.error('  --category NAME   Filter by category');
  console.error('  --min-quality N   Min quality score');
  console.error('  --intent TYPE     Force intent: how-to, what-is, why, troubleshoot, example, general');
  console.error('  --level LEVEL     Max expertise: beginner, intermediate, advanced, expert');
  console.error('  --raw             Raw distance search (skip knowledge ranking)');
  process.exit(1);
}

const pool = new pg.Pool({
  host: 'localhost', port: 5435, user: 'postgres', password: '', database: 'postgres', max: 2
});

// Load ONNX embedding service (same model as ingestion)
const embeddingsPath = '/Users/stuartkerr/.npm-global/lib/node_modules/@claude-flow/cli/node_modules/@claude-flow/embeddings/dist/index.js';
const mod = await import(embeddingsPath);
const svc = await mod.createEmbeddingServiceAsync({
  provider: 'transformers',
  model: 'Xenova/all-MiniLM-L6-v2',
  dimensions: 384
});

// Embed the query
const start = Date.now();
const result = await svc.embed(query);
const vec = result.embedding || result;
const vecStr = '[' + Array.from(vec).join(',') + ']';
const embedMs = Date.now() - start;

// Detect intent (or use override)
let intent = intentOverride;
if (!intent) {
  const intentRes = await pool.query(
    `SELECT ask_ruvnet.detect_intent($1) as intent`, [query]
  );
  intent = intentRes.rows[0].intent;
}

// Search
const searchStart = Date.now();
let rows;

if (raw) {
  const res = await pool.query(
    `SELECT d.id, d.title, left(d.content, 200) as snippet, d.category,
            d.knowledge_type, d.source_authority,
            (d.embedding <-> $1::ruvector(384))::FLOAT as distance,
            d.quality_score as quality
     FROM ask_ruvnet.architecture_docs d
     WHERE d.embedding IS NOT NULL AND d.is_duplicate = false
     ORDER BY d.embedding <-> $1::ruvector(384)
     LIMIT $2`,
    [vecStr, limit]
  );
  rows = res.rows;
} else {
  const res = await pool.query(
    `SELECT id, title, COALESCE(summary, left(content, 200)) as snippet,
            category, knowledge_type, concepts, expertise_level,
            round(distance::numeric, 4) as dist,
            quality, source_authority,
            round(relevance_score::numeric, 4) as score,
            relationship_context
     FROM ask_ruvnet.knowledge_search($1::ruvector(384), $2, $3, $4, $5, $6, $7, $8)`,
    [vecStr, query, intent, null, category, minQuality, level, limit]
  );
  rows = res.rows;
}

const searchMs = Date.now() - searchStart;

// Display results
console.log(`\nKB Knowledge Search: "${query}"`);
console.log(`Intent: ${intent} | Embed: ${embedMs}ms | Search: ${searchMs}ms | Results: ${rows.length}`);
if (category) console.log(`Category filter: ${category}`);
if (minQuality > 0) console.log(`Min quality: ${minQuality}`);
if (level !== 'expert') console.log(`Max expertise: ${level}`);
console.log();

for (const [i, row] of rows.entries()) {
  const qual = row.quality || '?';
  const type = row.knowledge_type || '?';
  const auth = row.source_authority || '?';

  if (raw) {
    console.log(`${i + 1}. [${row.category || 'general'}] ${row.title}`);
    console.log(`   Distance: ${parseFloat(row.distance).toFixed(4)} | Quality: ${qual} | Type: ${type} | Source: ${auth}`);
  } else {
    console.log(`${i + 1}. [${row.category || 'general'}] ${row.title}`);
    console.log(`   Score: ${row.score} | Dist: ${row.dist} | Quality: ${qual} | Type: ${type} | Source: ${auth}`);
    if (row.concepts?.length > 0) console.log(`   Concepts: ${row.concepts.join(', ')}`);
    const edges = row.relationship_context;
    if (edges && edges.length > 0 && edges !== '[]') {
      const edgeStrs = (typeof edges === 'string' ? JSON.parse(edges) : edges)
        .map(e => `${e.edge_type}(${e.direction})`);
      if (edgeStrs.length > 0) console.log(`   Relations: ${edgeStrs.join(', ')}`);
    }
  }
  console.log(`   ${row.snippet?.replace(/\n/g, ' ').slice(0, 140)}...`);
  console.log();
}

await pool.end();
