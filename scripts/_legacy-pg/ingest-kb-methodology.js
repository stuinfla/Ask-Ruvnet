#!/usr/bin/env node
/**
 * Ingest KB Creation Methodology — the "how to build a real knowledge base" entry
 * This is meta-knowledge: teaches Ruflo how to create proper KBs
 */
const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost', port: 5435, database: 'postgres', user: 'postgres',
});

const entries = [
  {
    path: 'methodology/kb-creation-proven-methodology.md',
    title: 'Proven Methodology: Building Intelligent Knowledge Bases (Data to Knowledge Pipeline)',
    category: 'architecture',
    quality: 99,
    content: `## The Problem: Most "Knowledge Bases" Are Just Data Dumps

Most AI knowledge bases fail because they store raw data -- README files, API docs, changelogs -- without transforming it into teachable knowledge. The result: semantic search returns documents but cannot answer questions. A user asks "how do I prevent data leakage?" and gets back a raw configuration file instead of an architectural explanation.

This document captures the proven methodology for building knowledge bases that actually work, validated with a 30/30 test suite across 5 layers of verification.

## The 7-Step Pipeline: Data to Knowledge

### Step 1: Source Acquisition (Get the Raw Material)
- Fetch from authoritative sources (GitHub API, official docs, verified READMEs)
- Use \`gh api repos/org/repo/contents/path --jq '.content' | base64 -d\` for GitHub
- Never use cached/stale copies -- always fetch fresh
- Record the source URL, commit hash, and fetch timestamp

### Step 2: Deep Comprehension (Read Everything)
- Read the ENTIRE source document, not just headers
- For large docs (>25K tokens), read in chunks with overlap
- Identify: core concepts, architectural decisions, specific numbers/benchmarks, API surfaces, integration points, comparison data
- Ask: "What questions would a developer/architect/business person ask about this?"

### Step 3: Knowledge Decomposition (Break Into Teachable Units)
- Split into 8-12 semantically distinct entries per major source
- Each entry covers ONE concept deeply (2,000-7,000 chars)
- Every entry must be self-contained -- a reader should understand it without reading others
- Categories should match the knowledge type: architecture, security, performance, agents, vector-db, deployment, etc.

The decomposition taxonomy that works:
1. Core Concepts & Philosophy (what is it, why does it matter)
2. Architecture & Format (how is it structured internally)
3. SDK & Package Ecosystem (how to install and use it)
4. Key Feature Deep Dives (one entry per major capability)
5. Performance & Benchmarks (specific numbers, comparisons)
6. Security & Trust (crypto, audit, compliance)
7. Integration Patterns (how it connects to other tools)
8. Use Case Entries (specific problem -> solution, e.g., corporate data safety)

### Step 4: Knowledge Transformation (Data Becomes Teaching)
This is the critical step most people skip. For each entry:

BAD (raw data dump):
  "WASM_SEG (0x10) - WebAssembly segment for browser deployment"

GOOD (teachable knowledge):
  "RVF compiles to a 46 KB WASM binary that runs entirely in a browser tab
   with zero backend. The WasmRvfStore API provides create, ingest, and query
   operations all running on the client device. This means a corporate knowledge
   base can be deployed as a static file on an intranet -- no server, no cloud,
   no API keys. The WASM binary sizes are: 5.5 KB for the tile microkernel
   (Cognitum) or 46 KB for the full control plane with in-memory store."

Rules for transformation:
- Lead with WHAT it enables, not what it is
- Include specific numbers (sizes, latencies, recall percentages)
- Include code examples for developer-facing features
- Include comparison tables for architectural decisions
- Explain WHY each design choice matters
- Write for the question "how do I use this?" not "what does this do?"

### Step 5: Embedding with Real Vectors
CRITICAL: The embedding model MUST produce unique, semantically meaningful vectors.

What works:
- Local ONNX model (Xenova/all-MiniLM-L6-v2) via @xenova/transformers
- 384 dimensions, normalized, pooled with mean pooling
- Embed: title + first 1400 chars of content (total 1500 char limit)
- Store as ruvector type in PostgreSQL

What FAILS:
- ruvector_embed() SQL function -- returns constant vectors (placeholder model)
- Any embedding that produces identical vectors for different inputs
- Truncating content to just the title (loses semantic specificity)

Verification: After embedding, run:
  SELECT COUNT(DISTINCT LEFT(embedding::text, 50)) = COUNT(*)
  FROM ask_ruvnet.kb_complete WHERE embedding IS NOT NULL;
Must return TRUE (100% unique embeddings).

### Step 6: Content Integrity
- Strip non-ASCII characters that break PostgreSQL UTF8 encoding
- Replace em-dashes, smart quotes, etc. with ASCII equivalents BEFORE inserting
- Verify: SELECT COUNT(*) FROM table WHERE octet_length(content) != length(content) should return 0
- Ensure no NULL titles, content, or categories
- Quality scores: 95+ for deep knowledge, 85-94 for good docs, <85 for basic reference

### Step 7: Validation (The 30-Point Test Suite)
Run the 5-layer validation test (scripts/kb-prove-it.mjs):

Layer A - Search Precision (15 tests):
  Ask 15 real-world questions covering every major topic
  Each must return the correct entry as #1 result
  Distance should be < 0.65 for a good match

Layer B - Knowledge Depth (6 tests):
  For each key entry, verify specific technical terms exist in the content
  e.g., entry about WASM must contain "5.5 KB", "46 KB", "WasmRvfStore", "browser"
  This proves the content teaches, not just labels

Layer C - Baseline Comparison (1 test):
  Document what the KB adds that the LLM does NOT already know
  If the KB only contains information the LLM already has, it adds no value
  Target: 10+ topics the KB uniquely provides

Layer D - Cross-Domain Integration (3 tests):
  Queries that span old + new entries must return results from BOTH
  Proves new knowledge integrates with existing KB, not just sits beside it

Layer E - Edge Cases (5 tests):
  Typo resilience (misspelled queries still find correct entry)
  Synonym matching (different words, same concept)
  Business language (non-technical phrasing)
  Technical jargon (very specific terms)
  Irrelevant rejection (unrelated queries score distance > 0.80)

## The PostgreSQL Schema That Works

Table: ask_ruvnet.kb_complete
  id SERIAL PRIMARY KEY
  file_path TEXT NOT NULL UNIQUE
  title TEXT NOT NULL
  content TEXT NOT NULL
  category TEXT NOT NULL
  quality_score INTEGER NOT NULL
  chunk_count INTEGER
  original_chars INTEGER
  created_at TIMESTAMP DEFAULT NOW()
  updated_at TIMESTAMP DEFAULT NOW()
  embedding ruvector(384)  -- real ONNX embeddings, NOT ruvector_embed()

Search query pattern:
  SELECT id, title, content, embedding <=> $1::ruvector as distance
  FROM ask_ruvnet.kb_complete
  ORDER BY distance ASC LIMIT 5

## Common Failures and How to Avoid Them

| Failure | Symptom | Fix |
|---------|---------|-----|
| Constant embeddings | All distances identical | Use ONNX model, not ruvector_embed() |
| Raw data dumps | Search finds docs but can't answer questions | Transform data into teaching (Step 4) |
| Missing specifics | "It supports WASM" but no sizes/APIs | Include exact numbers, code, APIs |
| UTF8 encoding errors | pg driver crashes on content retrieval | Strip non-ASCII before insert |
| No cross-domain | New entries don't connect to old ones | Use consistent terminology across entries |
| No validation | "It's in the DB" but search doesn't work | Run 30-point test suite (Step 7) |
| Too many small chunks | Low-quality fragments dilute search | 2,000-7,000 char entries, not 200-char chunks |

## Template: The Ingestion Script Pattern

\`\`\`javascript
const { Pool } = require('pg');
const pool = new Pool({ host:'localhost', port:5435, user:'postgres', database:'postgres' });

async function ingest(entry) {
  // Step 1: Get real ONNX embedding
  const { pipeline } = await import('@xenova/transformers');
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  const text = (entry.title + ' ' + entry.content).substring(0, 1500);
  const out = await embedder(text, { pooling: 'mean', normalize: true });
  const vec = '[' + Array.from(out.data).join(',') + ']';

  // Step 2: Insert with real embedding
  await pool.query(
    \\\`INSERT INTO ask_ruvnet.kb_complete
     (file_path, title, content, category, quality_score, chunk_count, original_chars, embedding)
     VALUES ($1, $2, $3, $4, $5, 1, $6, $7::ruvector)\\\`,
    [entry.path, entry.title, entry.content, entry.category,
     entry.quality, entry.content.length, vec]
  );
}
\`\`\`

## Quality Checklist (Run Before Declaring "Done")

- [ ] All entries have unique ONNX embeddings (100% unique prefixes)
- [ ] No UTF8 encoding issues (octet_length = length for all rows)
- [ ] No NULL fields (title, content, category all populated)
- [ ] Quality scores assigned (95+ for deep knowledge)
- [ ] Semantic search returns correct top-1 for 15+ test queries
- [ ] Content contains specific numbers, code examples, comparison tables
- [ ] Irrelevant queries score distance > 0.80
- [ ] Cross-domain queries return results from multiple entry groups
- [ ] Typos and synonyms still find correct entries
- [ ] Documentation: what the KB adds that the LLM doesn't already know`
  },
  {
    path: 'methodology/kb-quality-scoring-rubric.md',
    title: 'Knowledge Base Quality Scoring Rubric: How to Rate KB Entries 0-100',
    category: 'architecture',
    quality: 97,
    content: `## KB Entry Quality Scoring Rubric

Every entry in a knowledge base should be scored on a 0-100 scale. This rubric defines what each score range means and how to calculate it.

### Score Calculation

Start at 0. Add points for each criterion met:

| Criterion | Points | How to Check |
|-----------|--------|-------------|
| Content length > 500 chars | +20 | len(content) > 500 |
| Contains code examples | +25 | Has triple-backtick blocks |
| Has structured headers | +15 | Matches /^#+ /m |
| Has comparison tables | +10 | Contains pipe characters in table format |
| Has bullet lists | +10 | Matches /^[-*] /m |
| Title is descriptive (>10 chars) | +10 | len(title) > 10 |
| Contains specific numbers/metrics | +5 | Has quantities like "5.5 KB", "28 ns", "384-dim" |
| Explains WHY not just WHAT | +5 | Subjective: does it teach reasoning? |

### Score Ranges

95-100: Deep Knowledge (Gold Standard)
  - Self-contained teaching document
  - Specific numbers, benchmarks, code examples
  - Explains architectural decisions and tradeoffs
  - Can answer "how do I..." and "why does it..." questions
  - Example: Corporate-Safe AI entry with 3 deployment tiers, comparison table, code patterns

85-94: Good Documentation
  - Well-structured with examples
  - Covers the topic thoroughly
  - May lack some specific numbers or comparisons
  - Example: API reference with code examples but no benchmarks

70-84: Adequate Reference
  - Covers the basics
  - Missing depth, examples, or specific data
  - Answers "what is it" but not "how do I use it"
  - Example: Package listing with descriptions but no code

50-69: Minimal Data
  - Basic information only
  - No examples, no structure
  - Essentially a data dump with a title
  - Should be rewritten to reach 85+

Below 50: Reject and Rewrite
  - Too short, too vague, or incorrect
  - Provides no teaching value
  - Delete and recreate from scratch

### Quality Gates for KB Operations

| Operation | Minimum Score |
|-----------|--------------|
| Insert new entry | 85 |
| Keep existing entry | 70 |
| Flag for rewrite | Below 70 |
| Delete | Below 50 or duplicate |

### Automated Quality Check

\`\`\`sql
-- Find entries that need improvement
SELECT id, title, quality_score, LENGTH(content) as chars,
  CASE
    WHEN quality_score >= 95 THEN 'GOLD'
    WHEN quality_score >= 85 THEN 'GOOD'
    WHEN quality_score >= 70 THEN 'ADEQUATE'
    WHEN quality_score >= 50 THEN 'REWRITE'
    ELSE 'DELETE'
  END as rating
FROM ask_ruvnet.kb_complete
ORDER BY quality_score ASC;
\`\`\`

### The "Can It Answer?" Test

The ultimate quality check: take a real question a user might ask, find the top entry via semantic search, and read the content. Can it ANSWER the question with specific, actionable information?

If the answer is "it mentions the topic but doesn't actually tell me what to do" -- the entry needs to be rewritten at a higher quality level.

Examples of questions that should be answerable:
- "How do I deploy a knowledge base that never touches the cloud?" -> Corporate Safety entry should give 3 deployment tiers with commands
- "What WASM binary size should I expect?" -> WASM entry should say "5.5 KB tile, 46 KB control plane"
- "What crypto does RVF use?" -> Security entry should list SHAKE-256, Ed25519, ML-DSA-65, SLH-DSA-128s
- "How fast is COW branching?" -> COW entry should say "2.6ms for 10K vectors, 28ns CowMap lookup"`
  },
  {
    path: 'methodology/kb-embedding-fix-procedure.md',
    title: 'KB Embedding Fix Procedure: Replacing Broken ruvector_embed() with Real ONNX Vectors',
    category: 'vector-db',
    quality: 96,
    content: `## The Problem: ruvector_embed() Returns Constant Vectors

The PostgreSQL function ruvector_embed() is a placeholder that returns the same 384-dimensional vector for ALL inputs. This means semantic search returns random results because every entry has identical distance to every query.

Symptoms:
- All embedding prefixes are identical: SELECT COUNT(DISTINCT LEFT(embedding::text, 50)) FROM table returns 1 or 2
- Semantic search returns seemingly random results
- Distance between any two entries is approximately 0.0

## The Fix: Local ONNX Embeddings

### Prerequisites
- Node.js 18+
- @xenova/transformers package (npm install @xenova/transformers)
- Model: Xenova/all-MiniLM-L6-v2 (384 dimensions, downloads automatically on first use)

### The Embedding Script Pattern

\`\`\`javascript
import pg from 'pg';
const pool = new pg.Pool({ host:'localhost', port:5435, user:'postgres', database:'postgres' });

async function main() {
  const { pipeline } = await import('@xenova/transformers');
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  const { rows } = await pool.query(
    'SELECT id, title, LEFT(content, 1400) as content FROM ask_ruvnet.kb_complete ORDER BY id'
  );

  for (const row of rows) {
    const text = (row.title + ' ' + row.content).substring(0, 1500);
    const out = await embedder(text, { pooling: 'mean', normalize: true });
    const vec = '[' + Array.from(out.data).join(',') + ']';

    await pool.query(
      'UPDATE ask_ruvnet.kb_complete SET embedding = $1::ruvector, updated_at = NOW() WHERE id = $2',
      [vec, row.id]
    );
  }
  await pool.end();
}
\`\`\`

### Key Details
- Text input: title + first 1400 chars of content (total max 1500)
- Pooling: mean (averages all token embeddings)
- Normalize: true (L2 normalization for cosine similarity)
- Output: 384-dimensional float32 array
- Cast: $1::ruvector (parameterized query avoids UTF8 issues)
- Speed: approximately 10-13 entries/second on M3 Max

### Verification

After re-embedding, run:
\`\`\`sql
SELECT COUNT(DISTINCT LEFT(embedding::text, 50)) as unique_prefixes,
       COUNT(*) as total
FROM ask_ruvnet.kb_complete WHERE embedding IS NOT NULL;
\`\`\`

unique_prefixes MUST equal total. If not, the embedding model is still returning duplicates.

### Common Pitfalls
- DO NOT use string interpolation for vectors in SQL (causes UTF8 encoding errors)
- DO use parameterized queries: $1::ruvector
- DO NOT cast via ::real[] -- the column type is ruvector, not real[]
- The correct cast chain if needed: ('[' || array_to_string(embed_array, ',') || ']')::ruvector
- Strip non-ASCII from content BEFORE embedding to avoid encoding issues

### UTF8 Content Cleanup

Run before embedding to prevent encoding errors:
\`\`\`sql
-- Replace smart quotes and em-dashes
UPDATE table SET content = regexp_replace(
  regexp_replace(
    regexp_replace(content, E'\\u2014', '--', 'g'),
    E'\\u2018|\\u2019', '''', 'g'),
  E'\\u201C|\\u201D', '"', 'g')
WHERE octet_length(content) != length(content);

-- Nuclear option: strip ALL non-ASCII
UPDATE table SET content = regexp_replace(content, E'[^\\x20-\\x7E\\n\\r\\t]', '', 'g')
WHERE octet_length(content) != length(content);
\`\`\`

Verify: SELECT COUNT(*) FROM table WHERE octet_length(content) != length(content) should return 0.`
  }
];

async function main() {
  // Load ONNX
  const { pipeline } = await import('@xenova/transformers');
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  for (const entry of entries) {
    try {
      const text = (entry.title + ' ' + entry.content).substring(0, 1500);
      const out = await embedder(text, { pooling: 'mean', normalize: true });
      const vec = '[' + Array.from(out.data).join(',') + ']';

      // Clean content of any non-ASCII
      const cleanContent = entry.content.replace(/[^\x20-\x7E\n\r\t]/g, '');

      const result = await pool.query(
        `INSERT INTO ask_ruvnet.kb_complete
         (file_path, title, content, category, quality_score, chunk_count, original_chars, embedding)
         VALUES ($1, $2, $3, $4, $5, 1, $6, $7::ruvector)
         ON CONFLICT (file_path) DO UPDATE SET
           content = EXCLUDED.content,
           embedding = EXCLUDED.embedding,
           updated_at = NOW()
         RETURNING id`,
        [entry.path, entry.title, cleanContent, entry.category,
         entry.quality, cleanContent.length, vec]
      );
      console.log(`[${result.rows[0].id}] ${entry.title.substring(0, 60)}... (${cleanContent.length} chars)`);
    } catch (err) {
      console.error(`ERROR: ${entry.title.substring(0, 40)}: ${err.message}`);
    }
  }

  // Verify
  const { rows } = await pool.query(
    `SELECT COUNT(DISTINCT LEFT(embedding::text, 50)) as unique_prefixes,
            COUNT(*) as total
     FROM ask_ruvnet.kb_complete WHERE embedding IS NOT NULL`
  );
  console.log(`\nEmbedding diversity: ${rows[0].unique_prefixes}/${rows[0].total} unique`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
