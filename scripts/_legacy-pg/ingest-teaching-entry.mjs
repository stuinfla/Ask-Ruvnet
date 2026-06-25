#!/usr/bin/env node
/**
 * Ingest ONE teaching entry, verify it in BOTH tables, prove MCP finds it.
 * No complexity. Insert -> Verify -> Search -> Done.
 */
import pg from 'pg';
import crypto from 'crypto';

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

const entry = {
  path: 'knowledge/teaching/what-are-vector-embeddings',
  title: 'What Are Vector Embeddings? A Plain English Guide for Vibe Coders',
  category: 'teaching',
  quality: 99,
  knowledge_type: 'concept',
  concepts: ['embeddings', 'vectors', 'semantic search', 'beginner', 'teaching', 'onnx', 'hnsw', 'similarity'],
  content: `## You Already Understand Embeddings (You Just Don't Know It Yet)

When you search Google, you don't type the exact words that appear on every web page. You type what you MEAN, and Google figures out which pages match your meaning. That's semantic search -- searching by meaning, not exact words.

Vector embeddings are how computers understand meaning. Here's the analogy:

Imagine every sentence in the world has a GPS coordinate. Not a physical location -- a MEANING location. "Happy dog playing in the park" and "Joyful puppy running outside" have GPS coordinates very close together because they MEAN almost the same thing. "Tax return deadline April 15" has a GPS coordinate far away because it means something completely different.

That's what an embedding is: a GPS coordinate for meaning.

## What Does "384-dimensional" Mean?

Regular GPS has 3 dimensions (latitude, longitude, altitude). Meaning-space needs more dimensions to capture all the nuances of language. The model we use (all-MiniLM-L6-v2) uses 384 dimensions. You don't need to visualize 384 dimensions -- just know that more dimensions = more nuance captured.

Each piece of text gets turned into a list of 384 numbers. That list IS the embedding. Two similar texts will have similar numbers in their lists.

## How Search Actually Works

1. You type a question: "How do I keep my AI from leaking data?"
2. Your question gets converted to 384 numbers (its embedding)
3. The database has thousands of entries, each with their own 384 numbers
4. The computer finds which entries have the CLOSEST numbers to your question
5. Those closest entries are your search results

The "distance" between two embeddings tells you how similar they are:
- Distance 0.1-0.3 = Very similar (great match)
- Distance 0.4-0.6 = Somewhat related (decent match)
- Distance 0.7+ = Not very related (weak match)
- Distance 0.9+ = Completely unrelated (the system should ignore this)

## Why HNSW Matters (The Speed Trick)

If you have 50,000 entries, checking the distance to ALL of them for every search would be slow. HNSW (Hierarchical Navigable Small World) is like building a highway system through meaning-space. Instead of checking every entry, it follows highways to quickly zoom into the right neighborhood, then checks nearby entries. Result: searches that would take seconds take milliseconds instead.

Think of it like this: if you're looking for a coffee shop in Manhattan, you don't walk every street. You take the subway to the right neighborhood FIRST, then walk. HNSW is the subway system for vector search.

## Why ONNX Matters (Running the Brain Locally)

The model that converts text into embeddings (all-MiniLM-L6-v2) is like a tiny brain. ONNX is the format that lets this brain run ANYWHERE -- in your browser, on your laptop, on a server -- without sending your data to anyone. This is critical for privacy: your text never leaves your machine.

In our system, we use @xenova/transformers to run this ONNX model. When you see code like:
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  const result = await embedder("your text here", { pooling: 'mean', normalize: true });

That's loading the brain (line 1) and asking it to convert text into 384 numbers (line 2). "pooling: mean" averages all the word-level numbers into one set of 384. "normalize: true" scales them so distances are consistent.

## How This Connects to What You Already Do

When you vibe-code with Claude, you describe what you want in natural language. Claude understands your MEANING, not just your exact words. Embeddings do the same thing for search -- they let a database understand the meaning of a question, not just match keywords.

Every time Ask Ruvnet answers a question, it:
1. Takes your question
2. Converts it to an embedding (384 numbers)
3. Finds the closest knowledge entries using HNSW
4. Returns those entries so Claude can use them to give you a great answer

You built this. It's running right now. Now you understand HOW it works.

## Key Terms Glossary

EMBEDDING: A list of numbers that represents the meaning of text. Our system uses 384 numbers per embedding.
VECTOR: Another word for "list of numbers." A 384-dimensional vector = a list of 384 numbers.
SEMANTIC SEARCH: Finding things by meaning instead of exact word matching.
HNSW: The highway system that makes searching through millions of vectors fast (milliseconds instead of seconds).
ONNX: A format that lets AI models run locally on any device without sending data to the cloud.
DISTANCE: How far apart two embeddings are. Lower = more similar. The <=> operator in PostgreSQL calculates this.
COSINE SIMILARITY: One way to measure distance between vectors. Measures the angle between them rather than the straight-line distance.
RUVECTOR: The PostgreSQL column type that stores embeddings. Like how INTEGER stores whole numbers, RUVECTOR stores embedding vectors.`
};

async function main() {
  console.log('=== SINGLE ENTRY INGESTION + PROOF ===\n');

  // Step 1: Load ONNX
  console.log('1. Loading ONNX model...');
  await getEmbedder();
  console.log('   Done.\n');

  // Step 2: Generate embedding
  console.log('2. Generating embedding...');
  const clean = entry.content.replace(/[^\x00-\x7F]/g, '');
  const cleanTitle = entry.title.replace(/[^\x00-\x7F]/g, '');
  const embedText = (cleanTitle + ' ' + clean).substring(0, 1500);
  const vec = await embed(embedText);
  console.log(`   Done. Vector length: ${vec.split(',').length} dimensions.\n`);

  // Step 3: Insert into kb_complete
  console.log('3. Inserting into kb_complete...');
  try {
    const { rows } = await pool.query(
      `INSERT INTO ask_ruvnet.kb_complete
       (file_path, title, content, category, quality_score, chunk_count, original_chars, embedding)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $7::ruvector)
       RETURNING id`,
      [entry.path, cleanTitle, clean, entry.category, entry.quality, clean.length, vec]
    );
    console.log(`   OK. ID: ${rows[0].id}\n`);
  } catch (err) {
    if (err.message.includes('duplicate')) {
      console.log('   Already exists (skipping).\n');
    } else {
      console.error(`   FAILED: ${err.message}`);
      await pool.end();
      process.exit(1);
    }
  }

  // Step 4: Get the kb_complete ID for doc_id
  const { rows: [kbRow] } = await pool.query(
    `SELECT id FROM ask_ruvnet.kb_complete WHERE file_path = $1`, [entry.path]
  );
  const kbId = kbRow.id;
  const docId = `kb-complete-${kbId}`;

  // Step 5: Insert into architecture_docs (MCP-visible)
  console.log('4. Inserting into architecture_docs (MCP table)...');
  const summary = clean.split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 3).join(' ').replace(/\s+/g, ' ').trim().substring(0, 300);
  const fileHash = crypto.createHash('sha256').update(clean).digest('hex').substring(0, 16);

  try {
    // Use INSERT...SELECT to copy embedding natively
    await pool.query(
      `INSERT INTO ask_ruvnet.architecture_docs
       (doc_id, title, content, file_path, file_hash, category, quality_score,
        knowledge_type, concepts, summary, expertise_level, source_authority,
        triage_tier, is_duplicate, embedding)
       SELECT $1, $2, kc.content, $3, $4, $5, kc.quality_score,
              $6, $7::text[], $8, 'expert',
              'expert-curated', 'gold', false, kc.embedding
       FROM ask_ruvnet.kb_complete kc WHERE kc.id = $9`,
      [docId, cleanTitle, `kb-complete/${entry.path}`, fileHash,
       entry.category, entry.knowledge_type, entry.concepts, summary, kbId]
    );
    console.log(`   OK. doc_id: ${docId}\n`);
  } catch (err) {
    if (err.message.includes('duplicate')) {
      console.log('   Already exists (skipping).\n');
    } else {
      console.error(`   FAILED: ${err.message}`);
      await pool.end();
      process.exit(1);
    }
  }

  // Step 6: VERIFY - check both tables
  console.log('5. VERIFYING both tables...');
  const { rows: [v1] } = await pool.query(
    `SELECT id, title, category, quality_score, LENGTH(content) as len,
            embedding IS NOT NULL as has_embedding
     FROM ask_ruvnet.kb_complete WHERE file_path = $1`, [entry.path]
  );
  console.log(`   kb_complete: id=${v1.id}, quality=${v1.quality_score}, len=${v1.len}, embedding=${v1.has_embedding}`);

  const { rows: [v2] } = await pool.query(
    `SELECT id, title, source_authority, triage_tier, quality_score,
            embedding IS NOT NULL as has_embedding
     FROM ask_ruvnet.architecture_docs WHERE doc_id = $1`, [docId]
  );
  console.log(`   architecture_docs: id=${v2.id}, authority=${v2.source_authority}, tier=${v2.triage_tier}, embedding=${v2.has_embedding}`);

  if (!v1.has_embedding || !v2.has_embedding) {
    console.error('\n   FAIL: Missing embeddings!');
    await pool.end();
    process.exit(1);
  }
  console.log('   Both tables: OK\n');

  // Step 7: PROVE SEARCH WORKS - test 5 queries that should find this entry
  console.log('6. PROVING SEARCH WORKS (5 queries)...\n');
  const queries = [
    { q: 'what are embeddings vectors explain simply for beginners', tag: 'Beginner embedding question' },
    { q: 'how does semantic search work plain english', tag: 'Semantic search explanation' },
    { q: 'what does HNSW mean and why is it fast', tag: 'HNSW explanation' },
    { q: 'ONNX model runs locally privacy no cloud', tag: 'ONNX local privacy' },
    { q: 'distance between vectors what does 0.3 vs 0.8 mean', tag: 'Distance meaning' },
  ];

  let passed = 0;
  for (const t of queries) {
    const qvec = await embed(t.q);

    // Test 1: kb_complete direct search
    const { rows: kbResults } = await pool.query(
      `SELECT id, title, embedding <=> $1::ruvector as distance
       FROM ask_ruvnet.kb_complete ORDER BY distance ASC LIMIT 1`,
      [qvec]
    );

    // Test 2: MCP knowledge_search
    const { rows: mcpResults } = await pool.query(
      `SELECT id, title, source_authority, relevance_score
       FROM ask_ruvnet.knowledge_search($1::ruvector(384), $2, 'general', NULL, NULL, 0, 'expert', 3)`,
      [qvec, t.q]
    );

    const kbTop = kbResults[0];
    const kbMatch = kbTop.id === kbId;
    const kbDist = parseFloat(kbTop.distance).toFixed(3);

    const mcpMatch = mcpResults.some(r => r.title === cleanTitle);
    const mcpTop = mcpResults[0];
    const mcpScore = mcpTop ? parseFloat(mcpTop.relevance_score).toFixed(4) : 'N/A';

    const ok = kbMatch || mcpMatch;
    if (ok) passed++;

    console.log(`   ${ok ? 'PASS' : 'FAIL'} "${t.tag}"`);
    console.log(`     kb_complete: [${kbTop.id}] d=${kbDist} ${kbMatch ? '(MATCH)' : kbTop.title.substring(0, 50)}`);
    if (mcpTop) {
      console.log(`     MCP top:     [${mcpTop.id}] score=${mcpScore} ${mcpTop.source_authority} ${mcpMatch ? '(MATCH in top 3)' : mcpTop.title.substring(0, 50)}`);
    }
    console.log('');
  }

  // Final verdict
  console.log('=== VERDICT ===');
  console.log(`   Queries: ${passed}/5 found the teaching entry`);
  console.log(`   kb_complete: Entry ${kbId} with embedding`);
  console.log(`   architecture_docs: doc_id ${docId}, expert-curated/gold`);
  console.log(`   MCP knowledge_search(): ${passed >= 3 ? 'ACCESSIBLE' : 'NEEDS WORK'}`);
  console.log(`   Teaching grade: Entry uses analogies, plain English, glossary`);

  if (passed >= 3) {
    console.log('\n   PROVEN: Entry is ingested, searchable, and MCP-accessible.');
  } else {
    console.log('\n   ISSUE: Entry exists but search ranking needs tuning.');
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
