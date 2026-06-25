#!/usr/bin/env node
/**
 * KB Decision Guides v2.0 — Curated decision-framework entries for kb_complete.
 * These fill gaps: Ruflo needs clear IF/THEN decision trees when building apps.
 *
 * Targets: ask_ruvnet.kb_complete (curated, quality 99)
 * Embedding: ONNX Xenova/all-MiniLM-L6-v2 (384-dim) — never ruvector_embed()
 *
 * Usage: node scripts/kb-decision-guides-v2.mjs
 */
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host: 'localhost', port: 5435, user: 'postgres',
  database: 'postgres', max: 2
});

let embedder = null;
async function getEmbedder() {
  if (!embedder) {
    const { pipeline } = await import('@xenova/transformers');
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('ONNX embedding ready');
  }
  return embedder;
}

async function embed(text) {
  const e = await getEmbedder();
  const r = await e(text, { pooling: 'mean', normalize: true });
  return Array.from(r.data);
}

function sanitize(text) {
  return text.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim();
}

const entries = [
  {
    file_path: 'knowledge/decisions/rvf-wasm-vs-ruvector-wasm',
    title: 'RVF WASM vs RuVector-WASM: Which One Do I Use?',
    category: 'teaching',
    quality_score: 99,
    content: `## The One-Sentence Answer

RuVector-WASM is a browser vector DATABASE for search. RVF WASM is a cognitive CONTAINER for packaging and running AI knowledge. They solve completely different problems.

## The Analogy

Think of a filing cabinet vs a shipping container.

A FILING CABINET (RuVector-WASM) stores documents so you can search and retrieve them quickly. You put documents in, you search by topic, you get documents out. It lives in one place and does one job: fast search.

A SHIPPING CONTAINER (RVF WASM) packages everything needed to transport and run a complete system somewhere else. It holds documents, search indexes, code, metadata, and security credentials -- all in one portable file. You can ship it anywhere and it boots up ready to work.

## Decision Tree

START HERE: What are you building?

IF you need a browser app where users search knowledge:
  -> USE RuVector-WASM (@ruvector/wasm)
  -> Example: A documentation search tool, a Q&A widget, an offline knowledge browser
  -> What you get: Vector insert, HNSW search, IndexedDB persistence, <400KB

IF you need to package knowledge to move, share, or deploy it:
  -> USE RVF WASM (@ruvector/rvf-wasm)
  -> Example: Exporting a KB for backup, shipping knowledge to another system, deploying an AI agent with built-in knowledge
  -> What you get: 24-segment binary format, self-booting runtime, witnesses, COW branching, TEE attestation

IF you need BOTH search AND portability:
  -> Use RuVector-WASM for the live search experience
  -> Use RVF to package and distribute the knowledge that feeds it
  -> They are complementary, not competing

## When People Get Confused

The confusion happens because both have "WASM" in the name and both deal with vectors. But:

RuVector-WASM is a TOOL you use at runtime (insert vectors, search vectors, get results).
RVF WASM is a FORMAT you use for packaging (wrap knowledge into a portable binary).

You would never use RVF WASM to power a live search interface. You would never use RuVector-WASM to create a portable knowledge package.

## Technical Comparison

| Feature | RuVector-WASM | RVF WASM |
|---------|---------------|----------|
| npm package | @ruvector/wasm | @ruvector/rvf-wasm |
| Size | <400KB gzipped | 5.5KB runtime |
| Purpose | Browser vector search | Cognitive container runtime |
| HNSW search | Yes (built-in) | No (not a search engine) |
| IndexedDB | Yes (persistence) | No |
| Web Workers | Yes (parallel ops) | No |
| 24-segment format | No | Yes |
| Self-booting | No | Yes |
| TEE attestation | No | Yes |
| COW branching | No | Yes |
| Security witnesses | No | Yes |

## For Ruflo Building Apps

When Ruflo is building a browser search app: use RuVector-WASM.
When Ruflo is packaging knowledge for deployment: use RVF.
When Ruflo is building a complete offline AI system: use both -- RVF for the knowledge package, RuVector-WASM for the search layer.
Never confuse them. They are filing cabinet vs shipping container.`
  },
  {
    file_path: 'knowledge/decisions/aimds-detection-levels',
    title: 'AIMDS Detection Levels: Quick Scan vs Full Detection -- When to Use Each',
    category: 'teaching',
    quality_score: 99,
    content: `## The Decision

AIMDS has three detection modes. Choosing wrong either leaves you vulnerable or wastes processing time.

## The Airport Security Analogy

QUICK SCAN (<5ms) = Walk-through metal detector. Catches guns and knives (obvious attacks). Misses ceramic weapons (subtle attacks). Fast, cheap, catches 80% of threats.

FULL DETECTION (<10ms) = Full body scanner + bag X-ray. Catches everything the metal detector catches PLUS hidden items. Slightly slower, much more thorough.

LEARNING MODE (continuous) = Security team that studies every incident and updates the playbook. Does not add latency to individual checks but makes future checks smarter.

## Decision Tree

START HERE: How sensitive is this endpoint?

HIGH SENSITIVITY (financial, admin, data access):
  -> FULL DETECTION + LEARNING
  -> Example: Payment processing, user data APIs, admin panels, KB write operations
  -> Why: The cost of a missed attack (data breach, financial loss) far exceeds the extra 5ms
  -> Code: createAIDefence({ enableLearning: true })

MEDIUM SENSITIVITY (general chat, search, read-only):
  -> FULL DETECTION, learning optional
  -> Example: Chat endpoints, search queries, public content serving
  -> Why: Attacks are possible but impact is limited. Full detection catches social engineering and prompt injection
  -> Code: createAIDefence({ enableLearning: false })

LOW SENSITIVITY (health checks, static content, metrics):
  -> QUICK SCAN ONLY or skip AIMDS entirely
  -> Example: /health endpoint, static file serving, monitoring pings
  -> Why: No AI interaction means no prompt injection risk. Quick scan catches automated attacks
  -> Code: defender.quickScan(input)

REAL-TIME / HIGH-THROUGHPUT (1000+ requests/sec):
  -> QUICK SCAN for all, FULL DETECTION on flagged only
  -> Example: Real-time chat with many users, streaming data pipelines
  -> Why: Full detection on every request at high volume adds up. Quick scan first, escalate suspicious inputs
  -> Code: const quick = await defender.quickScan(input); if (!quick.safe) { await defender.detect(input); }

## The Two-Stage Pattern (Recommended Default)

For most applications, use this pattern:

1. Quick scan EVERY input (catches 80% of attacks in <5ms)
2. Full detection ONLY when quick scan flags something OR when the endpoint is high-sensitivity
3. Enable learning on production to improve over time

This gives you the speed of quick scan with the thoroughness of full detection where it matters.

## Common Mistakes

MISTAKE 1: Running full detection on health checks and static routes. Wastes CPU.
MISTAKE 2: Using quick scan only on payment endpoints. Misses subtle attacks.
MISTAKE 3: Disabling learning in production. You lose the self-improving benefit.
MISTAKE 4: Scanning BOTH directions on read-only endpoints. Inbound scan is enough if the AI is not generating dynamic responses.

## Inbound vs Outbound: When to Scan Each Direction

INBOUND (user -> AI): Scan ALWAYS. Every user input is potentially hostile.
OUTBOUND (AI -> user): Scan when the AI generates dynamic responses using external data. Skip for static or templated responses.

Both directions when: Chat systems, agent outputs, any endpoint where the AI constructs responses from KB data or user context.
Inbound only when: Search endpoints, classification, read-only queries where the response is a direct KB lookup.

## For Ruflo Building Apps

Default middleware setup: createAIDefence({ enableLearning: true }) with blockThreshold: 'medium'.
Always scan inbound. Scan outbound on chat/agent endpoints.
Use the two-stage pattern (quick scan all, full detect flagged) for high-traffic apps.
Log blocked requests so Stuart can review patterns.
EVERY app Stuart builds MUST have AIMDS middleware -- this is a standing instruction, not optional.`
  },
  {
    file_path: 'knowledge/decisions/client-vs-server-embedding',
    title: 'Client-Side vs Server-Side Embedding: Where Should the AI Brain Run?',
    category: 'teaching',
    quality_score: 99,
    content: `## The Core Question

When your app converts text into vectors (embeddings), that computation can happen in the user's BROWSER or on your SERVER. The choice affects privacy, speed, cost, and architecture.

## The Restaurant Analogy

CLIENT-SIDE embedding = a food truck that cooks at the customer's location. The customer sees everything being made (transparent), the food never travels (fresh/private), but the truck has limited equipment (limited compute).

SERVER-SIDE embedding = a restaurant kitchen. Professional equipment (powerful hardware), consistent quality, but the ingredients travel to the kitchen and the finished dish travels back (data moves over the network).

## Decision Tree

START HERE: What matters most for this app?

PRIVACY IS PARAMOUNT (medical, legal, corporate, personal data):
  -> CLIENT-SIDE embedding with ONNX
  -> User's text NEVER leaves their device
  -> Package: @xenova/transformers in browser, @ruvector/wasm for search
  -> Tradeoff: Slower on weak devices, larger initial download (~80MB model)

SPEED IS PARAMOUNT (real-time search, low latency):
  -> SERVER-SIDE embedding with ONNX on your server
  -> Embed once, cache the vector, serve instantly
  -> Package: @xenova/transformers on Node.js, PostgreSQL for storage
  -> Tradeoff: Text travels to server (privacy concern)

SCALE IS PARAMOUNT (millions of embeddings, batch processing):
  -> SERVER-SIDE embedding, batch pipeline
  -> Process thousands of texts in parallel with GPU/multi-core
  -> Package: ONNX on server with worker threads or queue
  -> Tradeoff: Higher server costs, more infrastructure

OFFLINE SUPPORT REQUIRED (works without internet):
  -> CLIENT-SIDE embedding, mandatory
  -> If the user has no internet, only their device can run the model
  -> Package: Service Worker + cached ONNX model + RuVector-WASM
  -> Tradeoff: First load downloads ~80MB, then cached forever

PROTOTYPE / DEMO (speed of development matters most):
  -> SERVER-SIDE embedding (simpler architecture)
  -> One ONNX instance on server serves all users
  -> Upgrade to client-side later if privacy matters
  -> Tradeoff: Not production-ready for sensitive data

## The Hybrid Pattern (Best of Both Worlds)

For production apps that need both privacy and performance:

1. FIRST LOAD: Server provides pre-embedded KB entries (vectors already computed)
2. USER QUERIES: Client-side ONNX embeds the user's search query locally
3. SEARCH: RuVector-WASM compares client-embedded query against pre-embedded KB
4. RESULT: User's query never leaves the browser. KB vectors are public anyway.

This is the sweet spot: the sensitive data (what the user is asking) stays private, while the non-sensitive data (KB content embeddings) is pre-computed server-side for speed.

## Technical Comparison

| Factor | Client-Side | Server-Side |
|--------|------------|-------------|
| Privacy | Maximum -- text stays on device | Text travels to server |
| First load | Slow (~80MB model download) | Instant (no model needed on client) |
| Per-query speed | 50-200ms (depends on device) | 10-50ms (consistent server hardware) |
| Offline works | Yes | No |
| Cost per query | $0 (user's device pays) | $0 (ONNX is free) but server costs |
| Weak devices | Slow or fails | No impact (server handles it) |
| Batch embedding | Not practical | Excellent |
| Model updates | Must push to all clients | Update once on server |

## The Model: all-MiniLM-L6-v2

Whether client or server, use the SAME model (Xenova/all-MiniLM-L6-v2, 384 dimensions). This guarantees that client-embedded queries match server-embedded documents. NEVER mix different embedding models -- a query embedded with model A will not match documents embedded with model B.

## Common Mistakes

MISTAKE 1: Embedding with different models on client vs server. Vectors will not match.
MISTAKE 2: Re-embedding the entire KB client-side on every page load. Pre-compute and cache.
MISTAKE 3: Using cloud embedding APIs (OpenAI, etc.) when ONNX does the same job for free locally.
MISTAKE 4: Forgetting that the ONNX model download is ~80MB. Use a loading indicator.

## For Ruflo Building Apps

Default: Server-side ONNX for KB ingestion, client-side ONNX for user queries (hybrid pattern).
Privacy-critical: Full client-side with RuVector-WASM.
Prototype: Server-side only, simplest architecture.
Always use Xenova/all-MiniLM-L6-v2 on both sides. Never mix models.`
  },
  {
    file_path: 'knowledge/decisions/hnsw-vs-sequential-scan',
    title: 'HNSW Index vs Sequential Scan: When Is the Index Worth It?',
    category: 'teaching',
    quality_score: 99,
    content: `## The Decision

Adding an HNSW index to a vector column makes search faster. But it is not always worth the cost. Here is how to decide.

## The Library Analogy

SEQUENTIAL SCAN = Walking through every shelf in a small library to find a book. If the library has 20 shelves, this takes seconds. Fine.

HNSW INDEX = Building a card catalog system for the library. Takes hours to set up, costs money to maintain, but finding any book takes seconds even if the library has 20,000 shelves.

For a 20-shelf library, the card catalog is overkill. For a 20,000-shelf library, walking every shelf is madness.

## Decision Tree

START HERE: How many rows does your table have?

UNDER 1,000 ROWS:
  -> SKIP THE INDEX. Sequential scan is sub-millisecond.
  -> Your kb_complete table (269 rows) falls here. 0.2ms per search with no index.
  -> Adding HNSW actually risks Bug #171 (returns fewer results than requested on small tables).
  -> Example: Curated KB, config tables, small reference sets.

1,000 TO 10,000 ROWS:
  -> INDEX IS OPTIONAL. Sequential scan takes 1-5ms, HNSW takes <1ms.
  -> Worth adding if you search frequently (>100 searches/minute) or need consistent sub-ms latency.
  -> Example: Mid-size knowledge bases, product catalogs, FAQ collections.

10,000 TO 100,000 ROWS:
  -> INDEX IS RECOMMENDED. Sequential scan takes 5-50ms, HNSW takes <1ms.
  -> The performance difference is noticeable. Add the index.
  -> Example: architecture_docs table (54K rows), large content libraries.

OVER 100,000 ROWS:
  -> INDEX IS MANDATORY. Sequential scan takes 50ms-5s, HNSW takes <1ms.
  -> Without the index, every search blocks for perceptible time.
  -> Example: Large-scale document stores, embedding caches, log search.

## The Numbers

| Rows | Sequential Scan | HNSW Search | Improvement |
|------|----------------|-------------|-------------|
| 100 | 0.1ms | 0.1ms | 1x (no gain) |
| 1,000 | 1ms | 0.2ms | 5x |
| 10,000 | 10ms | 0.3ms | 33x |
| 50,000 | 45ms | 0.4ms | 112x |
| 100,000 | 90ms | 0.5ms | 180x |
| 1,000,000 | 900ms | 0.8ms | 1,125x |

## Bug #171: The Small Table Problem

CRITICAL: HNSW indexes in ruvector-postgres have a known bug (Bug #171) where they return fewer results than requested on tables with fewer than ~500 rows. A LIMIT 5 query might return only 1 result.

WORKAROUND: Do not create HNSW indexes on tables under 1,000 rows. Sequential scan returns correct results every time.

This is why kb_complete (269 rows) has NO HNSW index but architecture_docs (54K rows) does.

## Build Time and Memory Cost

HNSW indexes are not free to create:

| Rows | Build Time | Index Size (approx) |
|------|-----------|---------------------|
| 1,000 | <1 second | ~1 MB |
| 10,000 | 2-5 seconds | ~10 MB |
| 50,000 | 15-30 seconds | ~50 MB |
| 100,000 | 30-60 seconds | ~100 MB |
| 1,000,000 | 5-10 minutes | ~1 GB |

## Tuning Parameters

ef_construction (build-time accuracy): Default 64. Higher = more accurate index, slower to build. For most KBs, default is fine. Set to 200 for mission-critical search.

ef_search (query-time accuracy): Default 40. Higher = more accurate results, slower per query. Set higher (100-200) when you need guaranteed top-k accuracy.

m (connections per node): Default 16. Higher = more memory, better recall. For 384-dim vectors, 16-32 is the sweet spot.

## For Ruflo Building Apps

Under 1,000 rows: No index. Sequential scan. Done.
1K-10K rows: Add index if search is a hot path.
Over 10K rows: Always add index.
Always verify with EXPLAIN ANALYZE that the index is actually being used.
Never create HNSW on tables under 500 rows (Bug #171).
SQL: CREATE INDEX ON schema.table USING hnsw (embedding ruvector_cosine_ops);`
  },
  {
    file_path: 'knowledge/decisions/curated-kb-vs-bulk-corpus',
    title: 'Curated KB vs Bulk Corpus: When to Hand-Write vs Auto-Ingest Knowledge',
    category: 'teaching',
    quality_score: 99,
    content: `## The Decision

You can build a knowledge base two ways: hand-write expert entries (curated) or auto-import thousands of documents (bulk). Most real systems need both, but knowing WHEN to use each is critical.

## The Textbook vs Library Analogy

CURATED KB = A textbook written by an expert professor. Every chapter is designed to teach. Examples are chosen carefully. Explanations build on each other. Quality is consistently high.

BULK CORPUS = A university library. Thousands of books, papers, and documents. Some are brilliant, some are mediocre, some are outdated. But the sheer coverage means you can find SOMETHING on almost any topic.

You want the textbook for learning. You want the library for reference. You want both for a complete education.

## Decision Tree

START HERE: What is the purpose of this knowledge?

TEACHING (users need to UNDERSTAND concepts):
  -> CURATED entries, always
  -> Hand-written with analogies, examples, progressive explanation
  -> Quality score 95-100
  -> Category: teaching
  -> Why: Auto-generated content does not teach. It dumps facts. Teaching requires deliberate structure.

REFERENCE (users need to LOOK UP specific details):
  -> BULK corpus is fine
  -> Auto-ingest documentation, API specs, changelogs
  -> Quality score 70-90
  -> Category: reference
  -> Why: Reference material does not need analogies. It needs coverage and accuracy.

DECISION SUPPORT (users need to CHOOSE between options):
  -> CURATED entries with decision trees
  -> Hand-written with clear IF/THEN logic, comparison tables, tradeoff analysis
  -> Quality score 95-100
  -> Category: teaching or decision
  -> Why: Decisions require nuance that auto-generated content cannot provide.

COVERAGE / FALLBACK (users might ask about anything):
  -> BULK corpus as a safety net
  -> Auto-ingest broadly, accept lower quality
  -> Quality score 60-85
  -> Why: Better to return a mediocre answer than no answer. Curated entries handle the top 80% of queries; bulk handles the long tail.

## The Ask Ruvnet Strategy (What We Actually Do)

1. kb_complete (269 curated entries, avg quality 98): The textbook. Hand-written teaching, decision guides, and core concepts. Searched FIRST for every query.

2. architecture_docs (54K bulk entries, avg quality 75): The library. Auto-ingested from docs, repos, and changelogs. Searched as AUGMENTATION when curated results are weak.

3. Curated-first search: The MCP server checks kb_complete first. Only falls through to architecture_docs when curated distance > 0.45 (moderate confidence) or > 0.65 (low confidence).

This is the right pattern for most knowledge-intensive applications.

## How to Decide What to Curate

Not everything deserves hand-curation. Use this filter:

CURATE if:
- Users ask about this topic repeatedly (high demand)
- The topic requires explanation, not just facts (teaching value)
- Getting it wrong has consequences (decision support)
- The topic is unique to your system (not in any LLM's training data)
- An expert could write a significantly better entry than auto-generation

BULK INGEST if:
- The content is factual and self-explanatory (API docs, specs)
- There are too many entries to hand-write (thousands of pages)
- The content changes frequently (changelogs, release notes)
- Coverage matters more than quality (fallback/safety net)
- The content already exists in good form (official documentation)

## Quality Score Guidelines

| Score | Meaning | Typical Source |
|-------|---------|---------------|
| 95-100 | Expert-curated teaching with analogies and examples | Hand-written |
| 85-94 | Well-written reference material | Official docs, carefully edited |
| 70-84 | Acceptable reference | Auto-generated from quality sources |
| 50-69 | Low-quality filler | Auto-generated from mixed sources |
| Below 50 | Should not be in the KB | Noise, duplicates, outdated |

## The 80/20 Rule for KB Building

Curate the top 20% of topics that handle 80% of queries. Bulk-ingest the remaining 80% as a safety net. Your 269 curated entries probably answer 80% of real questions. The 54K bulk entries catch the remaining 20%.

## Common Mistakes

MISTAKE 1: Bulk-ingesting everything and calling it done. Users get mediocre results.
MISTAKE 2: Trying to curate everything. You run out of time at entry 50.
MISTAKE 3: Not differentiating curated from bulk in search. Curated should ALWAYS rank higher.
MISTAKE 4: Auto-generating "teaching" entries. AI-written teaching lacks deliberate structure.
MISTAKE 5: Setting all quality scores to 100. Score inflation makes ranking useless.

## For Ruflo Building Apps

When building a KB for a new app: Start with 20-30 curated entries covering core concepts. Bulk-ingest everything else. Use curated-first search (like the Ask Ruvnet MCP v4.0.0 pattern). Teaching entries should be hand-written or heavily human-edited. Reference entries can be auto-ingested. Decision guides must be hand-written -- the nuance matters.`
  }
];

async function ingest() {
  console.log(`Ingesting ${entries.length} decision-guide entries into kb_complete...`);
  const client = await pool.connect();

  try {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const cleanTitle = sanitize(entry.title);
      const cleanContent = sanitize(entry.content);
      const embeddingInput = cleanTitle + ' ' + cleanContent.substring(0, 1400);
      const vector = await embed(embeddingInput);
      const label = `[${i+1}/${entries.length}]`;

      // Check for existing entry with same file_path
      const existing = await client.query(
        'SELECT id FROM ask_ruvnet.kb_complete WHERE file_path = $1',
        [entry.file_path]
      );

      if (existing.rows.length > 0) {
        await client.query(`
          UPDATE ask_ruvnet.kb_complete
          SET title = $1, content = $2, category = $3, quality_score = $4,
              chunk_count = 1, original_chars = $5, embedding = $6::ruvector,
              updated_at = NOW()
          WHERE file_path = $7
        `, [cleanTitle, cleanContent, entry.category, entry.quality_score,
            cleanContent.length, `[${vector.join(',')}]`, entry.file_path]);
        console.log(`  ${label} Updated: ${cleanTitle} (id: ${existing.rows[0].id})`);
      } else {
        const result = await client.query(`
          INSERT INTO ask_ruvnet.kb_complete
            (file_path, title, content, category, quality_score, chunk_count, original_chars, embedding)
          VALUES ($1, $2, $3, $4, $5, 1, $6, $7::ruvector)
          RETURNING id
        `, [entry.file_path, cleanTitle, cleanContent, entry.category, entry.quality_score,
            cleanContent.length, `[${vector.join(',')}]`]);
        console.log(`  ${label} Inserted: ${cleanTitle} (id: ${result.rows[0].id})`);
      }
    }

    // Verify embeddings are unique
    const check = await client.query(`
      SELECT COUNT(*) AS total,
             COUNT(DISTINCT LEFT(embedding::text, 50)) AS unique_prefixes
      FROM ask_ruvnet.kb_complete
      WHERE file_path LIKE 'knowledge/decisions/%'
    `);
    const { total, unique_prefixes } = check.rows[0];
    console.log(`\nVerification: ${total} decision entries, ${unique_prefixes} unique embeddings`);
    if (total === unique_prefixes) {
      console.log('ALL EMBEDDINGS UNIQUE');
    } else {
      console.log('WARNING: Duplicate embeddings detected!');
    }

    const countResult = await client.query('SELECT COUNT(*) AS cnt FROM ask_ruvnet.kb_complete');
    console.log(`Total KB entries: ${countResult.rows[0].cnt}`);
  } finally {
    client.release();
    await pool.end();
  }
}

ingest().catch(e => { console.error(e); process.exit(1); });
