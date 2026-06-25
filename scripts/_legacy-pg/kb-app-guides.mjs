#!/usr/bin/env node
/**
 * KB Application Architecture Guides - 30 curated guides
 * for building intelligent knowledge-based applications
 * with RuVector and Ruflo V3.
 *
 * Updated: 2026-02-18 00:00:00 EST | Version 1.0.0
 * Created: 2026-02-18 00:00:00 EST
 */
import pg from 'pg';
import crypto from 'crypto';

const SCHEMA = 'ask_ruvnet';
const TABLE = 'architecture_docs';

const pool = new pg.Pool({
  host: 'localhost',
  port: 5435,
  user: 'postgres',
  password: '',
  database: 'postgres',
  max: 4
});

// --- ONNX Embedding ---
let svc = null;

async function initOnnx() {
  const embeddingsPath = '/Users/stuartkerr/.npm-global/lib/node_modules/@claude-flow/cli/node_modules/@claude-flow/embeddings/dist/index.js';
  const mod = await import(embeddingsPath);
  svc = await mod.createEmbeddingServiceAsync({
    provider: 'transformers',
    model: 'Xenova/all-MiniLM-L6-v2',
    dimensions: 384
  });
  await svc.embed('warmup');
  console.log('[ONNX] Embedding service ready (384 dimensions)');
}

function md5(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

// ============================================================
// 30 Application Architecture Guides
// ============================================================

const guides = [

// --- 1 ---
{
  title: 'Knowledge Base Architecture: Customer Support Bot',
  content: `A customer support bot lives or dies by how well its knowledge base is organized. Think of it like a well-run help desk: every ticket category has a playbook, every common question has a tested answer, and edge cases get escalated with context.

WHEN TO USE THIS PATTERN: You have a product or service with recurring customer questions, and you want an AI that resolves tickets faster than human agents scanning through wiki pages.

HOW TO STRUCTURE THE KB:

1. Category Layer: Organize entries by support domain -- billing, technical, onboarding, account management. Each category gets its own topic tag in the architecture_docs table:
   INSERT INTO ask_ruvnet.architecture_docs (doc_id, title, content, topics, category)
   VALUES ('support-billing-refund', 'Refund Policy', '...', ARRAY['billing','refund','policy'], 'customer-support');

2. Intent Mapping Layer: Map natural language questions to resolution patterns. "I want my money back" and "how do I get a refund" should both match the refund resolution entry. This is where vector embeddings shine -- they understand semantic similarity without you manually listing every synonym.

3. Resolution Pattern Layer: Each entry should contain: the problem description, the step-by-step resolution, common variations, and escalation criteria. Think of it as a recipe card -- not just the answer, but the complete procedure.

WHAT TO AVOID:
- Do not dump your entire FAQ page as one giant entry. Chunk by individual question-answer pairs so vector search can find the right one.
- Do not mix internal process docs with customer-facing answers. The AI will confuse "how we handle refunds internally" with "what to tell the customer about refunds."
- Do not skip quality scoring. A wrong answer from your bot is worse than no answer. Set quality_score high (95+) only for verified, tested resolutions.

CONCRETE EXAMPLE: A SaaS company with 500 support articles structures their KB like this: 50 billing entries (quality_score 98), 200 technical troubleshooting entries (quality_score 90), 150 how-to guides (quality_score 85), 100 product feature explanations (quality_score 80). When a customer asks "my payment failed," the vector search finds the top 3 billing entries, re-ranks by quality score, and the AI synthesizes a specific answer with steps.

The key insight: your KB is not a document archive. It is a decision tree encoded as searchable knowledge. Every entry should answer one question completely, with enough context that the AI can adapt it to variations.`
},

// --- 2 ---
{
  title: 'Knowledge Base Architecture: Legal Document Analyzer',
  content: `Legal knowledge is hierarchical, jurisdictional, and precedent-driven. Building a KB for legal analysis means respecting that structure -- not flattening law into a bag of paragraphs.

WHEN TO USE THIS PATTERN: You need an AI that can analyze contracts, identify clause types, flag risks, or retrieve relevant legal precedent. Law firms, compliance teams, and contract review workflows benefit most.

HOW TO STRUCTURE THE KB:

1. Clause Type Library: Create entries for each standard clause type -- indemnification, limitation of liability, force majeure, termination, confidentiality. Each entry explains what the clause does, what good versions look like, and what red flags to watch for.

2. Precedent Linking via Topics: Use the topics[] array to create implicit links between related legal concepts:
   topics: ARRAY['contract-law', 'indemnification', 'liability-cap', 'delaware']
   When searching for indemnification issues, the vector search naturally surfaces related limitation of liability entries because their embeddings are semantically close.

3. Jurisdiction Awareness: Tag every entry with its jurisdiction. A non-compete clause valid in Texas may be unenforceable in California. Use both the category field (e.g., 'employment-law') and topics (e.g., ARRAY['california', 'non-compete', 'enforceability']).

WHAT TO AVOID:
- Never present legal KB results as legal advice. Always include confidence calibration -- "this entry matches your query with high semantic similarity, but legal applicability depends on jurisdiction and specific facts."
- Do not embed entire case opinions as single entries. Break them into: holding, reasoning, key facts, and dissent (if relevant). Each chunk should be independently searchable.
- Do not mix primary sources (statutes, regulations) with secondary sources (commentary, analysis) without tagging the doc_type differently. The AI needs to know the authority level of what it is citing.

CONCRETE EXAMPLE: A contract review system with 2,000 KB entries organized as: 200 clause templates (quality_score 98), 500 risk flag patterns (quality_score 95), 800 precedent summaries (quality_score 85), 500 regulatory requirements by jurisdiction (quality_score 90). When a user uploads a contract, the system identifies each clause type via vector similarity to the template library, then cross-references risk patterns and jurisdiction-specific rules to generate a review summary.

The architecture secret: legal knowledge has a tree structure (statute > regulation > case law > practice). Your KB should reflect that hierarchy through consistent topic tagging so the AI can traverse from general principle to specific application.`
},

// --- 3 ---
{
  title: 'Knowledge Base Architecture: Medical Reference System',
  content: `Medical knowledge bases deal with life-affecting information. The architecture must prioritize accuracy, currency, and the ability to surface interactions and contraindications that a simple search would miss.

WHEN TO USE THIS PATTERN: Clinical decision support, drug interaction checking, symptom-to-diagnosis mapping, or medical education tools. Any application where the AI assists (never replaces) medical professionals.

HOW TO STRUCTURE THE KB:

1. Drug Interaction Matrix: Each drug gets its own entry with: indications, contraindications, common interactions, and dosage guidelines. Critical: create CROSS-REFERENCE entries for known dangerous interactions:
   INSERT INTO ask_ruvnet.architecture_docs (doc_id, title, content, topics, quality_score)
   VALUES ('drug-interaction-warfarin-aspirin', 'Warfarin-Aspirin Interaction Risk', '...', ARRAY['drug-interaction','warfarin','aspirin','bleeding-risk','anticoagulant'], 99);

2. Symptom-Diagnosis Mapping: Structure entries as symptom clusters, not individual symptoms. "Chest pain + shortness of breath + left arm numbness" is a pattern that should map to cardiac entries, while "chest pain + fever + cough" maps to respiratory entries. The embedding captures these clusters naturally.

3. Protocol Retrieval: Clinical protocols are step-by-step and version-sensitive. Each protocol entry needs: the condition, the protocol steps, the evidence level, and the last-reviewed date. Use updated_at aggressively -- stale medical protocols are dangerous.

WHAT TO AVOID:
- Never allow the system to present results without confidence levels. A 0.6 cosine similarity match for a drug interaction is not the same as a 0.95 match.
- Do not embed patient data into the KB. The KB holds reference knowledge; patient data stays in the EHR system. Your application queries the KB with anonymized symptoms/conditions.
- Do not skip the quality_score stratification. Evidence-based guidelines (quality_score 99) must outrank anecdotal case reports (quality_score 60) in every retrieval.

CONCRETE EXAMPLE: A clinical decision support tool with 10,000 entries: 3,000 drug monographs, 2,000 interaction pairs, 1,500 symptom-diagnosis patterns, 2,000 clinical protocols, 1,500 differential diagnosis guides. When a physician enters a patient's medication list, the system performs multi-hop retrieval: first finding each drug's profile, then cross-searching for pairwise interactions, then checking against the patient's condition-specific protocols. Results are ranked by evidence level (quality_score) and recency (updated_at).

The critical architectural principle: medical KBs must be CONSERVATIVE. When in doubt, surface more information rather than less. A false negative (missing an interaction) is far more dangerous than a false positive (flagging a non-issue).`
},

// --- 4 ---
{
  title: 'Knowledge Base Architecture: Educational Tutor',
  content: `An educational tutor KB is fundamentally different from a reference KB. It does not just store answers -- it stores learning paths, misconceptions, and progressive complexity levels. Think of it as encoding a great teacher's knowledge of both the subject AND how students learn it.

WHEN TO USE THIS PATTERN: Adaptive learning platforms, homework help systems, tutoring bots, or any application that needs to explain concepts at different levels and detect when a student is stuck.

HOW TO STRUCTURE THE KB:

1. Progressive Knowledge Layers: For each concept, create entries at multiple difficulty levels. Tag them with a difficulty progression:
   topics: ARRAY['algebra', 'quadratic-equations', 'level-1-introduction']
   topics: ARRAY['algebra', 'quadratic-equations', 'level-2-practice']
   topics: ARRAY['algebra', 'quadratic-equations', 'level-3-advanced']
   The AI selects the appropriate level based on the student's demonstrated understanding.

2. Misconception Library: This is the secret weapon. Create explicit entries for COMMON WRONG ANSWERS and why they are wrong:
   Title: "Common Misconception: Multiplying Negatives"
   Content: "Students often think (-3) x (-2) = -6. The correct answer is +6 because... [explanation]. When a student gives -6, redirect to the sign rule visualization..."
   This lets the AI recognize incorrect reasoning patterns, not just correct answers.

3. Prerequisite Chains: Use topics to encode "you need to understand X before Y." When a student struggles with quadratic equations, the system can trace back to: factoring > polynomial basics > order of operations.

WHAT TO AVOID:
- Do not just store textbook content. Textbooks explain concepts for readers; tutoring explains concepts for confused learners. The tone, examples, and structure are different.
- Do not create one-size-fits-all explanations. A visual learner needs "think of it as a parabola on a graph" while a procedural learner needs "step 1: identify a, b, c coefficients."
- Do not forget to include WORKED EXAMPLES with explicit step-by-step reasoning. Students learn more from seeing a problem solved than from reading a definition.

CONCRETE EXAMPLE: A math tutoring system with 5,000 entries: 1,000 concept explanations (3 levels each = 3,000 entries), 500 misconception patterns, 1,000 worked examples, 500 practice problem templates. When a student asks "how do I solve x^2 + 5x + 6 = 0", the system first checks their level (based on conversation history), retrieves the appropriate-level explanation, includes a worked example, and preloads the common misconception entries in case the student makes a typical error. The quality_score reflects pedagogical effectiveness, not just accuracy.

The architectural insight: a tutor KB encodes two types of knowledge -- WHAT to teach (subject matter) and HOW to teach it (pedagogical strategy). Both must be searchable.`
},

// --- 5 ---
{
  title: 'Knowledge Base Architecture: Code Documentation Assistant',
  content: `A code documentation assistant needs to bridge the gap between "what does this API do" and "show me how to actually use it." Developers ask questions at different levels -- from high-level architecture overviews to specific parameter types -- and your KB must handle all of them.

WHEN TO USE THIS PATTERN: Developer tools, internal documentation portals, API reference assistants, or any system where users need to find and understand code documentation quickly.

HOW TO STRUCTURE THE KB:

1. API Reference Layer: Each API endpoint or function gets its own entry with: signature, parameters, return type, description, and error cases. Keep these precise and machine-parseable:
   doc_id: 'api-ref-user-create'
   title: 'POST /api/users - Create User'
   topics: ARRAY['api', 'users', 'create', 'authentication', 'v2.3']

2. Example Linking Layer: For every API reference entry, create companion entries with working code examples. Link them through shared topic tags. The example entry should show: the setup, the call, the expected response, and common error handling:
   doc_id: 'example-user-create-nodejs'
   title: 'Example: Create User with Node.js'
   topics: ARRAY['api', 'users', 'create', 'example', 'nodejs', 'v2.3']

3. Version-Aware Retrieval: This is critical for code docs. When someone searches for "how to create a user," the results must reflect the CURRENT version. Use the package_version field and boost recent entries:
   SELECT * FROM ask_ruvnet.architecture_docs
   WHERE embedding <=> $1::ruvector(384) < 0.3
   AND package_version = '2.3'
   ORDER BY quality_score DESC, updated_at DESC LIMIT 5;

WHAT TO AVOID:
- Do not embed auto-generated JSDoc or Swagger output without cleaning it. Raw generated docs are full of noise (type signatures without context). Add human-written summaries.
- Do not store code examples without testing them. A broken code example in your KB will generate broken code suggestions. Set quality_score to 98+ only for verified, runnable examples.
- Do not forget migration guides. When APIs change between versions, create explicit "migrating from v1 to v2" entries. These are among the most searched-for docs.

CONCRETE EXAMPLE: A developer documentation system for an API with 300 endpoints: 300 API reference entries, 300 example entries (one per endpoint minimum), 50 conceptual guides (authentication flow, pagination, rate limiting), 30 migration guides, 20 troubleshooting entries. When a developer asks "how do I paginate results," the vector search finds the pagination conceptual guide, the relevant API reference entries that support pagination, and a code example -- all ranked by version match and quality score.

The key principle: code documentation KBs serve three query types -- "what" (reference), "how" (examples), and "why" (conceptual). Each needs its own entry type, and the AI combines them for complete answers.`
},

// --- 6 ---
{
  title: 'The 5 Levels of KB Intelligence',
  content: `Not all knowledge bases are created equal. There is a spectrum from "barely useful text dump" to "self-improving knowledge system." Understanding where you are on this spectrum tells you exactly what to build next.

LEVEL 1 -- TEXT DUMP: You have documents stored as plain text. Retrieval is keyword-based (LIKE '%search term%'). This is what most people start with. It works for exact matches but fails completely when someone phrases their question differently than how the document was written.

LEVEL 2 -- CHUNKED AND EMBEDDED: You have split documents into chunks, generated vector embeddings, and can do semantic search. This is a massive leap -- now "how do I authenticate" finds entries about "login," "OAuth," and "session management" even though those words were not in the query. RuVector HNSW indexing makes this search sub-millisecond:
  CREATE INDEX idx_hnsw ON ask_ruvnet.architecture_docs
  USING hnsw (embedding ruvector_cosine_ops) WITH (m=16, ef_construction=200);

LEVEL 3 -- QUALITY-SCORED AND CATEGORIZED: You have added metadata -- quality_score, category, topics[], doc_type. Now retrieval is not just "most similar" but "most similar AND highest quality AND correct category." This is where the ask_ruvnet KB currently sits. You can run queries like:
  WHERE embedding <=> query_vec < 0.3 AND quality_score >= 80 AND category = 'agents'
  ORDER BY quality_score DESC

LEVEL 4 -- RELATIONSHIP-AWARE: Entries know about each other. When you retrieve a concept, the system automatically finds prerequisites, examples, and related concepts. This uses the topics[] array as implicit graph edges and multi-hop retrieval to chain related entries.

LEVEL 5 -- SELF-IMPROVING WITH FEEDBACK LOOPS: The KB gets smarter over time. User interactions feed back into quality scores. Ruflo V3 neural training captures successful retrieval patterns. Entries that consistently help users get quality boosts; entries that confuse users get flagged for review:
  npx ruflo@latest neural train --pattern-type retrieval --epochs 10

WHERE YOU ARE NOW: If you have followed the ask_ruvnet pattern, you are solidly at Level 3. The path to Level 4 requires building explicit relationship queries (multi-hop search). Level 5 requires instrumenting your application to capture feedback and pipe it back into the KB.

WHAT TO AVOID: Do not try to jump from Level 1 to Level 5. Each level builds on the previous one. The embedding quality at Level 2 determines the ceiling for everything above it. Get your chunking, embedding, and quality scoring rock-solid before adding complexity.`
},

// --- 7 ---
{
  title: 'From Text Dump to Knowledge System',
  content: `Turning raw documents into a useful knowledge system is a six-step transformation. Each step adds a layer of intelligence. Think of it like refining crude oil -- you start with raw material and progressively extract more valuable products.

STEP 1 -- RAW TEXT COLLECTION: Gather everything: documentation, README files, conversation logs, wiki pages, code comments. Do not filter yet. The goal is completeness. Use scripts like ingest-docs-to-kb.js to pull from multiple sources.

STEP 2 -- STRUCTURED CHUNKING: Split raw text into meaningful units. The key word is "meaningful" -- not just splitting every 500 characters. Split on: paragraph boundaries, section headers, function boundaries (for code), or Q&A pairs. Add overlap (100-150 characters) so context is not lost at boundaries:
  // Good: chunk by logical sections with overlap
  chunkText(rawText, { maxSize: 800, overlap: 100, splitOn: 'paragraph' })
  // Bad: chunk by fixed character count with no overlap
  rawText.match(/.{1,500}/g)

STEP 3 -- SEMANTIC EMBEDDING: Transform each chunk into a 384-dimensional vector using ONNX inference. This is where text becomes searchable by meaning rather than keywords:
  const result = await svc.embed(chunkText);
  const vector = '[' + Array.from(result.embedding).join(',') + ']';

STEP 4 -- QUALITY SCORING: Not all chunks are equal. Rate each entry on: completeness (does it answer a question fully?), clarity (is it well-written?), authority (is the source reliable?), and currency (is it up to date?). Assign quality_score from 0-100.

STEP 5 -- RELATIONSHIP MAPPING: Tag each entry with topics[] to create an implicit knowledge graph. When entries share topics, they are implicitly related. The more specific and consistent your topic vocabulary, the stronger the implicit graph:
  topics: ARRAY['ruflo', 'swarm', 'hierarchical', 'anti-drift']

STEP 6 -- CONTINUOUS REFINEMENT: Set up the evergreen pattern to keep knowledge fresh. Monitor which entries get retrieved but produce poor results (low user satisfaction). Flag stale entries. Re-ingest updated sources. This is the step most people skip, and it is the difference between a KB that decays and one that improves.

THE TRANSFORMATION IN NUMBERS: A typical project starts with 50 raw documents (Level 1). Chunking produces ~2,000 entries (Level 2). Quality scoring eliminates ~400 low-value entries and promotes ~200 to high quality (Level 3). Topic tagging creates ~5,000 implicit relationships (Level 4). After 3 months of feedback, retrieval accuracy improves 30-40% (Level 5).

WHAT TO AVOID: Do not skip Step 4. Without quality scoring, your vector search returns "most semantically similar" which is often not "most useful." A well-structured mediocre answer can outrank a poorly-structured perfect answer in pure vector search. Quality scoring fixes this.`
},

// --- 8 ---
{
  title: 'Query Expansion: Making Search Understand Intent',
  content: `When a user types "how do I fix auth," they mean one of dozens of things: authentication failures, authorization errors, OAuth configuration, JWT expiry, session management, or login page bugs. Pure vector search helps (the embedding of "fix auth" is close to "authentication troubleshooting"), but query expansion makes it dramatically better.

WHAT IS QUERY EXPANSION: Taking a user's original query and generating multiple related queries that capture different aspects of their intent. Instead of one search, you run 3-5 searches and merge the results.

HOW TO IMPLEMENT IT:

1. Synonym Expansion: Maintain a mapping of common terms to their alternatives. "auth" expands to ["authentication", "authorization", "login", "OAuth", "JWT", "session"]. This can be a simple lookup table or (better) use the AI itself to generate synonyms.

2. Concept Broadening: "fix auth" could mean troubleshooting OR configuration OR implementation. Generate queries at different specificity levels:
   - Specific: "fix authentication error"
   - Medium: "authentication troubleshooting guide"
   - Broad: "authentication architecture overview"

3. Multi-Query Fusion: Run all expanded queries against the KB, collect results, and deduplicate by doc_id. Score each result by how many expanded queries found it (a result that appears in 4 out of 5 queries is almost certainly relevant):

   async function expandedSearch(originalQuery) {
     const expansions = await generateExpansions(originalQuery); // AI-generated
     const allResults = new Map();
     for (const q of [originalQuery, ...expansions]) {
       const vec = await svc.embed(q);
       const results = await pool.query(
         'SELECT doc_id, title, quality_score, embedding <=> $1::ruvector(384) as dist ' +
         'FROM ask_ruvnet.architecture_docs WHERE is_duplicate = false ' +
         'ORDER BY dist LIMIT 10', [formatVec(vec)]
       );
       for (const r of results.rows) {
         const existing = allResults.get(r.doc_id);
         if (existing) existing.queryCount++;
         else allResults.set(r.doc_id, { ...r, queryCount: 1 });
       }
     }
     return [...allResults.values()]
       .sort((a, b) => (b.queryCount * 10 + b.quality_score) - (a.queryCount * 10 + a.quality_score));
   }

WHEN TO USE THIS: Always, for user-facing queries. The overhead is small (3-5 vector searches take <50ms with HNSW) and the quality improvement is substantial. Skip it only for programmatic queries where you already know the exact search terms.

WHAT TO AVOID:
- Do not expand into unrelated domains. "auth" should not expand to "author" or "authority" in a technical KB.
- Do not use more than 5 expanded queries. Diminishing returns set in fast, and you start pulling in noise.
- Do not weight all expansions equally. The original query should always be the primary signal.

The result: instead of finding 3 relevant entries for "fix auth," expanded search finds 8-10 relevant entries covering authentication, authorization, and session management -- giving the AI enough context to provide a comprehensive answer.`
},

// --- 9 ---
{
  title: 'Re-Ranking: Why the First Results Are Not Always Best',
  content: `Vector search with HNSW is fast and semantically aware, but it has a blind spot: it ranks by embedding similarity alone. The entry most semantically similar to your query is not always the most USEFUL result. Re-ranking adds intelligence on top of raw similarity.

THE PROBLEM: You search for "how to configure Ruflo swarms." HNSW returns 10 results ranked by cosine distance. Result #1 is a brief mention of swarms in a changelog (distance 0.15). Result #4 is a comprehensive swarm configuration guide (distance 0.22). Pure vector search picks #1, but #4 is what the user actually needs.

HOW RE-RANKING WORKS: After vector search returns candidates, apply a composite score that considers multiple factors:

  SELECT doc_id, title,
    (1 - (embedding <=> $1::ruvector(384))) * 0.4  -- semantic similarity (40%)
    + (quality_score / 100.0) * 0.3                  -- quality score (30%)
    + CASE WHEN updated_at > NOW() - INTERVAL '30 days' THEN 0.15 ELSE 0 END  -- recency (15%)
    + CASE WHEN category = $2 THEN 0.15 ELSE 0 END   -- category match (15%)
    AS composite_score
  FROM ask_ruvnet.architecture_docs
  WHERE embedding <=> $1::ruvector(384) < 0.4
    AND is_duplicate = false
  ORDER BY composite_score DESC
  LIMIT 10;

THE FOUR RE-RANKING SIGNALS:

1. Quality Score (30% weight): Your quality_score field is a pre-computed relevance indicator. A 98-quality entry about the right topic beats a 60-quality entry that happens to be slightly closer in embedding space.

2. Recency (15% weight): For technical documentation, newer is usually more relevant. A 2026 guide to Ruflo V3 should outrank a 2024 guide to V1, even if the V1 guide has a slightly better embedding match.

3. Source Authority (15% weight): Not all sources are equal. Official documentation (doc_type = 'curated') should outrank auto-generated summaries (doc_type = 'generated'). Use the doc_type field for this.

4. Result Diversity (bonus): After scoring, check that your top 5 results are not all from the same source or about the same sub-topic. If results 1-5 all discuss the same aspect, swap in result 6 or 7 that covers a different angle.

WHEN TO USE THIS: Always for user-facing search. The SQL-based re-ranking shown above adds negligible overhead (the database is already computing the vector distance; adding arithmetic over indexed columns is nearly free).

WHAT TO AVOID:
- Do not make similarity weight less than 30%. It is still the primary signal -- re-ranking adjusts, it does not replace vector search.
- Do not hard-code weights. Start with the 40/30/15/15 split, then adjust based on what your users actually find useful.
- Do not ignore diversity. Five results saying the same thing is worse than three results covering different aspects.`
},

// --- 10 ---
{
  title: 'Multi-Hop Retrieval: When One Search Is Not Enough',
  content: `Some questions cannot be answered by a single KB lookup. "How do I set up a self-healing swarm with authentication?" requires understanding swarms, self-healing patterns, AND authentication -- three separate knowledge domains that must be combined into one coherent answer.

WHAT IS MULTI-HOP RETRIEVAL: Running a sequence of searches where each search is informed by the results of the previous one. It is like a research process: you find a concept, that concept mentions a related technique, you search for that technique, and the technique references a specific implementation.

THE THREE-HOP PATTERN:

Hop 1 -- Find the Concept: Search for the user's primary question. This finds the broad topic entries.
  Query: "self-healing swarm with authentication"
  Finds: "Swarm Architecture Overview", "Self-Healing Patterns in Ruflo"

Hop 2 -- Find the Implementation: Extract key terms from Hop 1 results and search for implementation details.
  From Hop 1 results, extract: "hierarchical topology", "health checks", "claims-based auth"
  Query: "hierarchical swarm health check implementation"
  Finds: "Configuring Hierarchical Swarms", "Health Check Protocol"

Hop 3 -- Find the Example: Use Hop 2 results to search for concrete examples and code.
  Query: "swarm init hierarchical with claims authentication example"
  Finds: "Example: Production Swarm Setup", "Claims-Based Auth Configuration"

HOW TO IMPLEMENT IT:

  async function multiHopSearch(userQuery, maxHops = 3) {
    let allResults = [];
    let currentQuery = userQuery;

    for (let hop = 0; hop < maxHops; hop++) {
      const vec = await svc.embed(currentQuery);
      const results = await pool.query(
        'SELECT doc_id, title, content, quality_score FROM ask_ruvnet.architecture_docs ' +
        'WHERE embedding <=> $1::ruvector(384) < 0.35 AND is_duplicate = false ' +
        'ORDER BY quality_score DESC LIMIT 5',
        ['[' + Array.from(vec.embedding).join(',') + ']']
      );
      allResults.push(...results.rows);
      // Extract key terms from results for next hop
      const topContent = results.rows.slice(0, 2).map(r => r.title).join(' ');
      currentQuery = topContent; // Next hop searches based on what we found
    }
    // Deduplicate and rank
    const unique = new Map();
    for (const r of allResults) {
      if (!unique.has(r.doc_id) || unique.get(r.doc_id).quality_score < r.quality_score)
        unique.set(r.doc_id, r);
    }
    return [...unique.values()].sort((a, b) => b.quality_score - a.quality_score);
  }

WHEN TO USE THIS: Complex questions that span multiple concepts. Architecture questions ("how do X and Y work together"), troubleshooting ("why does X fail when Y is configured"), and design questions ("what is the best approach for X given Y constraints").

WHAT TO AVOID:
- Do not run more than 3-4 hops. Each hop adds latency and the quality gains diminish rapidly after hop 3.
- Do not let each hop return too many results. 3-5 per hop is enough; more creates noise in subsequent hops.
- Do not forget to deduplicate. The same high-quality entry may appear in multiple hops (which is actually a good signal of relevance).`
},

// --- 11 ---
{
  title: 'Building Memory Systems: Short-term, Long-term, Episodic',
  content: `Humans have three types of memory, and intelligent AI applications need all three. Short-term memory holds your current conversation. Long-term memory holds everything you have ever learned. Episodic memory holds specific experiences. Ruflo V3 implements each differently.

SHORT-TERM MEMORY -- THE CONVERSATION CONTEXT: This is the AI's awareness of what has been discussed in the current session. It includes the user's previous questions, the AI's previous answers, and any context that has been established. In Ruflo V3, this is managed through session state:

  npx ruflo@latest session restore --latest
  // Restores the most recent session context so the AI remembers previous interactions

Without short-term memory, every question is asked in isolation. The AI cannot follow up, cannot reference "the thing we discussed earlier," and cannot build on previous answers.

LONG-TERM MEMORY -- THE KNOWLEDGE BASE: This is the ask_ruvnet.architecture_docs table -- your persistent, searchable knowledge that survives across sessions and users. It is the foundation of everything: facts, procedures, patterns, and reference material. Long-term memory is shared across all conversations.

  // Storing long-term knowledge
  npx ruflo@latest memory store --key "pattern-swarm-anti-drift" \\
    --value "Use hierarchical topology with max 8 agents for anti-drift" \\
    --namespace patterns

EPISODIC MEMORY -- SPECIFIC INTERACTION MEMORIES: This is the most underused and most powerful type. Episodic memory records WHAT HAPPENED in specific interactions: "Last time Stuart asked about swarm configuration, the hierarchical approach worked but mesh caused drift." These are stored as memories in Ruflo V3:

  npx ruflo@latest memory store --key "episode-2026-02-18-swarm" \\
    --value "Stuart needed anti-drift config. Hierarchical with max-agents 8 solved it. Mesh topology was tried first and caused agent drift after 5 minutes." \\
    --namespace episodes

HOW THEY WORK TOGETHER: When a new question arrives: (1) Check episodic memory for similar past interactions ("have we solved this before?"). (2) Search long-term memory for relevant knowledge. (3) Combine with short-term context from the current conversation. The AI gets a complete picture: what it knows (long-term), what has been tried (episodic), and what is being discussed now (short-term).

WHAT TO AVOID:
- Do not put everything in long-term memory. Specific interaction details ("Stuart prefers hierarchical topologies") belong in episodic memory.
- Do not neglect session restore. If short-term memory is lost between conversations, the AI cannot continue where it left off.
- Do not store episodic memories without timestamps and outcomes. An episodic memory without "this worked" or "this failed" is just noise.

The architectural insight: most KB-powered applications only implement long-term memory (the knowledge base). Adding episodic memory (what worked before) and proper short-term memory (session context) transforms a search engine into a learning assistant.`
},

// --- 12 ---
{
  title: 'Knowledge Base Quality Metrics',
  content: `How do you know if your KB is actually working? Not "does it return results" but "does it return the RIGHT results?" You need measurable metrics, not gut feelings.

THE FIVE KEY METRICS:

1. Precision@k (Are the top results relevant?): Run a test query. Look at the top 5 results. Count how many are actually relevant. If 4 out of 5 are relevant, your Precision@5 is 0.80. Target: 0.70 or higher.

  Test: "how do I configure HNSW indexes"
  Result 1: HNSW Configuration Guide ✓
  Result 2: Vector Search Overview ✓
  Result 3: PostgreSQL Index Types ✓
  Result 4: Unrelated Agent Config ✗
  Result 5: HNSW Performance Tuning ✓
  Precision@5 = 4/5 = 0.80 ✓

2. Mean Reciprocal Rank (How quickly is the BEST result found?): For each test query, find the rank of the first highly relevant result. MRR is the average of 1/rank across all test queries. If the best result is always #1, MRR = 1.0. If it is usually #2 or #3, MRR drops. Target: 0.70 or higher.

3. Recall (Are ALL relevant entries found?): Out of all relevant entries in your KB for a given query, how many appear in the results? If you have 10 entries about HNSW but your search only returns 6 of them, recall is 0.60. Target: depends on use case, but 0.50+ for broad queries.

4. Answer Relevance (Does the AI response actually help?): This is the end-to-end metric. After the AI synthesizes a response from KB results, score it 1-5 on: accuracy, completeness, and usefulness. This requires human evaluation (or a separate AI evaluator).

5. Freshness Score: What percentage of your top-retrieved entries were updated in the last 30 days? For technical documentation, you want 40%+ freshness. For stable reference material, 10% is fine.

HOW TO TEST (THE 5-QUERY METHOD):
1. Choose 5 representative queries that span different categories
2. Run each query against your KB
3. Score each result set: Precision@5, rank of best result, relevance 1-5
4. Average the scores
5. Interpret: Average relevance 4.0+ = KB is genuinely useful. 3.0-3.9 = needs work. Below 3.0 = fundamental problems with chunking, embedding, or content quality.

PRACTICAL TESTING WITH RUVECTOR:

  -- Quick quality check: what percentage of entries have quality_score >= 80?
  SELECT
    COUNT(*) FILTER (WHERE quality_score >= 80) * 100.0 / COUNT(*) AS high_quality_pct,
    COUNT(*) FILTER (WHERE quality_score < 40) AS low_quality_count,
    AVG(quality_score) AS avg_score
  FROM ask_ruvnet.architecture_docs WHERE is_duplicate = false;

WHAT TO AVOID:
- Do not measure only retrieval metrics. A KB with perfect retrieval but terrible content is still useless.
- Do not test with only easy queries. Include ambiguous, multi-concept, and edge-case queries in your test set.
- Do not measure once and forget. Run the 5-query test monthly. KB quality drifts as content ages and new entries are added.`
},

// --- 13 ---
{
  title: 'Application Pattern: AI That Gets Smarter Over Time',
  content: `The most powerful knowledge-based applications are not static -- they learn from every interaction. This is the self-improving KB pattern: user interactions generate feedback, feedback adjusts quality scores, and adjusted scores improve future retrieval.

THE FEEDBACK LOOP:

1. User Asks Question -> AI retrieves entries from KB -> AI generates response
2. User Reacts (explicit: thumbs up/down, implicit: follows up vs asks differently)
3. System Updates: helpful entries get quality_score boost, unhelpful entries get penalty
4. Next time a similar question is asked, better entries are ranked higher

HOW TO IMPLEMENT THIS WITH CLAUDE FLOW V3:

Step 1 -- Instrument Retrieval: Log which entries were retrieved for each query:
  INSERT INTO ask_ruvnet.retrieval_log (query, retrieved_doc_ids, timestamp)
  VALUES ($1, $2, NOW());

Step 2 -- Capture Feedback: After the user rates a response (or you detect engagement signals), update the entries:
  -- User found response helpful
  UPDATE ask_ruvnet.architecture_docs
  SET quality_score = LEAST(quality_score + 2, 100)
  WHERE doc_id = ANY($1::text[]);  -- all retrieved entries get a small boost

  -- User said response was wrong/unhelpful
  UPDATE ask_ruvnet.architecture_docs
  SET quality_score = GREATEST(quality_score - 5, 0)
  WHERE doc_id = ANY($1::text[]);  -- penalty is larger than reward (conservative)

Step 3 -- Neural Pattern Training: Periodically train Ruflo V3's neural system on the successful retrieval patterns:
  npx ruflo@latest neural train --pattern-type retrieval --epochs 10
  This captures which entry combinations tend to produce good answers.

Step 4 -- Re-Embedding Improved Content: When entries accumulate enough feedback data, regenerate their embeddings to reflect updated content:
  npx ruflo@latest embeddings batch --source ask_ruvnet --filter "quality_score > 80"

THE COMPOUND EFFECT: After 1,000 interactions, the quality scores in your KB have been calibrated by real user behavior. Entries that consistently help users have scores of 95-100. Entries that were retrieved but did not help have dropped to 40-60. Your retrieval is now personalized by collective usage patterns.

WHAT TO AVOID:
- Do not let a single negative interaction tank an entry. Use moving averages: quality_score = (old_score * 0.9 + new_signal * 0.1).
- Do not auto-delete low-scoring entries. They may be relevant for rare queries. Instead, lower their retrieval priority.
- Do not skip the neural training step. Quality score adjustments are the minimum. Neural pattern training captures WHICH COMBINATIONS of entries work well together, which is much harder to encode manually.

CONCRETE EXAMPLE: After 3 months of operation, a support bot's KB shows: 200 entries improved from quality_score 80 to 95+ (validated by user feedback), 50 entries dropped below 40 (flagged for human review), 30 new entries were created based on questions the KB could not answer. Overall retrieval relevance improved from 3.2 to 4.4 on the 5-point scale.

This is Level 5 intelligence: a knowledge base that learns from its own usage.`
},

// --- 14 ---
{
  title: 'Vector Search vs Full-Text vs Hybrid',
  content: `Three search approaches exist for knowledge bases, and each has a blind spot. Understanding when each fails tells you when to use which -- and why hybrid search is usually the right answer.

VECTOR SEARCH (SEMANTIC):
How it works: Converts your query into an embedding vector and finds the nearest entries in embedding space using HNSW indexing.
Strengths: Understands meaning. "How do I log in" finds entries about "authentication," "session management," and "OAuth" even though none of those words appear in the query.
Blind spot: Terrible at exact matches. If you search for "error code E-4521," vector search might return entries about error handling in general but miss the specific entry about E-4521 because error codes are not semantically meaningful in embedding space.

FULL-TEXT SEARCH (KEYWORD):
How it works: Traditional text matching using PostgreSQL's to_tsvector and to_tsquery.
Strengths: Perfect for exact terms, error codes, version numbers, and proper nouns. "Ruflo V3.0.0-alpha.118" will find that exact version reliably.
Blind spot: No semantic understanding. "How do I log in" will not find an entry titled "Authentication Guide" because the words do not overlap.

HYBRID SEARCH -- THE BEST OF BOTH:
Combine vector and full-text results using a weighted union:

  WITH vector_results AS (
    SELECT doc_id, title, content, quality_score,
      1 - (embedding <=> $1::ruvector(384)) AS semantic_score
    FROM ask_ruvnet.architecture_docs
    WHERE is_duplicate = false
    ORDER BY embedding <=> $1::ruvector(384) LIMIT 20
  ),
  text_results AS (
    SELECT doc_id, title, content, quality_score,
      ts_rank(to_tsvector('english', title || ' ' || content), plainto_tsquery($2)) AS text_score
    FROM ask_ruvnet.architecture_docs
    WHERE to_tsvector('english', title || ' ' || content) @@ plainto_tsquery($2)
      AND is_duplicate = false
    LIMIT 20
  )
  SELECT DISTINCT ON (doc_id) doc_id, title, content, quality_score,
    COALESCE(v.semantic_score, 0) * 0.6 + COALESCE(t.text_score, 0) * 0.4 AS hybrid_score
  FROM vector_results v FULL OUTER JOIN text_results t USING (doc_id, title, content, quality_score)
  ORDER BY doc_id, hybrid_score DESC;

The 60/40 semantic/keyword split works for most cases. Increase keyword weight for technical reference queries; increase semantic weight for conceptual questions.

WHEN TO USE EACH:
- Pure vector: Conceptual questions, "how do I" questions, exploratory queries
- Pure keyword: Error codes, version numbers, exact identifiers, API endpoint names
- Hybrid: User-facing search (you do not know what type of query is coming)

WHAT TO AVOID:
- Do not use pure vector search for a technical reference system. Developers searching for "ECONNREFUSED" need the exact match, not semantically similar network error entries.
- Do not skip vector search for a customer-facing product. Customers rarely use the exact terminology your documentation uses.
- Do not set equal weights. Start with 60/40 favoring semantic, then adjust based on your query logs.`
},

// --- 15 ---
{
  title: 'Structuring Domain Knowledge for AI Comprehension',
  content: `There is a difference between storing information and storing it in a way that AI can USE effectively. Most knowledge bases fail not because they lack content, but because their content is structured for human reading, not AI comprehension.

THE DIFFERENCE: A human reading a document understands context from headers, layout, surrounding text, and their own background knowledge. An AI receives a chunk of text with none of that context. If your chunk says "Use the configure command with the --flag option" without explaining WHAT is being configured or WHEN to use it, the AI cannot provide a useful answer.

THE FIVE ELEMENTS OF AI-COMPREHENSIBLE KNOWLEDGE:

1. Concept Definition (WHAT): Every entry should start with a clear definition. Not "HNSW is an algorithm" but "HNSW (Hierarchical Navigable Small World) is a graph-based algorithm for approximate nearest neighbor search. It works by building layers of connected nodes, where higher layers have fewer nodes but longer-range connections, allowing fast traversal from any starting point to the nearest neighbor."

2. Relationships (HOW IT CONNECTS): Explicitly state how this concept relates to others. "HNSW is used by RuVector to index the embedding column in architecture_docs. It replaces brute-force cosine distance computation with graph traversal, reducing search from O(n) to O(log n)."

3. Examples (SHOW IT): Include a concrete, runnable example. Not "you can create an HNSW index" but:
   CREATE INDEX idx_hnsw ON ask_ruvnet.architecture_docs
   USING hnsw (embedding ruvector_cosine_ops) WITH (m=16, ef_construction=200);

4. Counter-Examples (WHAT NOT TO DO): These are invaluable for AI. "Do NOT use hnsw with L2 distance for normalized embeddings. Use ruvector_cosine_ops instead because the embeddings from Xenova/all-MiniLM-L6-v2 are pre-normalized."

5. Decision Criteria (WHEN TO USE): "Use HNSW when your table has more than 1,000 rows. Below 1,000 rows, brute-force scan is fast enough and HNSW's index-building overhead is not justified."

RESTRUCTURING EXISTING CONTENT: If you have documentation that is written for humans, transform it by adding the five elements. Take each section and ask: Does a standalone reader understand WHAT this is, HOW it connects, WHAT it looks like in practice, WHAT to avoid, and WHEN to use it?

WHAT TO AVOID:
- Do not store fragments. "See the configuration section" is useless as a standalone KB entry because the AI has no access to "the configuration section."
- Do not assume background knowledge. Every entry should be self-contained enough that the AI can use it without reading the surrounding document.
- Do not mix multiple concepts in one entry. "HNSW and IVFFlat comparison" should be two entries (one per algorithm) plus a third comparison entry, not one entry trying to cover both.

The test: if you give a KB entry to someone with zero context, can they understand and act on it? If yes, the AI can too.`
},

// --- 16 ---
{
  title: 'Chunk Overlap Strategy: The Hidden Quality Multiplier',
  content: `Chunk overlap is the most underappreciated setting in knowledge base construction. It is the difference between entries that lose critical context at boundaries and entries that preserve it. Getting overlap right can improve retrieval quality by 15-25% with zero additional content.

WHAT IS CHUNK OVERLAP: When you split a document into chunks, overlap means the last N characters of chunk A also appear at the beginning of chunk B. If your document says "Configure HNSW with m=16. This setting controls the number of connections per node. Higher values improve recall but increase memory usage," and you split at 50 characters with no overlap, you might get:
  Chunk 1: "Configure HNSW with m=16. This setting controls"
  Chunk 2: "the number of connections per node. Higher values"
  Both chunks are incomplete and unhelpful.

With 30-character overlap:
  Chunk 1: "Configure HNSW with m=16. This setting controls the number of"
  Chunk 2: "This setting controls the number of connections per node. Higher values improve recall"
  Now Chunk 2 has enough context to be independently useful.

THE OVERLAP GUIDELINES:

Narrative Content (blog posts, guides, explanations): 100-150 characters overlap. These texts have flowing arguments where context from the previous paragraph matters.

Structured Data (API references, configuration options): 30-50 characters overlap. Each entry is relatively self-contained, so less overlap is needed.

Code and Examples: 0-20 characters overlap OR split by logical boundaries (function boundaries, class boundaries) instead of character count. Code chunks should be syntactically complete.

Conversations/Q&A: Overlap by one full Q&A pair. If a conversation has questions 1-5, chunk as: Q1-Q3, Q2-Q4, Q3-Q5. Each chunk has full context for the middle question.

HOW TO IMPLEMENT IN RUVECTOR INGESTION:

  function chunkWithOverlap(text, maxSize = 800, overlap = 100) {
    const paragraphs = text.split(/\\n\\n+/);
    const chunks = [];
    let current = '';
    for (const para of paragraphs) {
      if ((current + '\\n\\n' + para).length > maxSize && current.length > 50) {
        chunks.push(current.trim());
        current = current.slice(-overlap) + '\\n\\n' + para;
      } else {
        current += (current ? '\\n\\n' : '') + para;
      }
    }
    if (current.trim().length > 30) chunks.push(current.trim());
    return chunks;
  }

THE TRADEOFF: More overlap means more entries (increasing storage and HNSW index size) but better context preservation. The sweet spot for most KB applications is 100 characters of overlap with 800-character chunks, which adds roughly 12% more entries but improves retrieval relevance measurably.

WHAT TO AVOID:
- Do not use zero overlap. Context loss at chunk boundaries is the #1 cause of "the AI found a relevant entry but the answer was incomplete."
- Do not use overlap larger than 25% of chunk size. At that point, you are duplicating too much content and the embeddings of adjacent chunks become nearly identical, wasting HNSW index space.
- Do not use the same overlap for all content types. Adjust based on how self-contained each paragraph is.`
},

// --- 17 ---
{
  title: 'Knowledge Graph Patterns in RuVector',
  content: `You do not need a dedicated graph database to build knowledge graph functionality. RuVector's architecture_docs table already has the ingredients: topics[], category, quality_score, and embeddings. Together, they create an implicit knowledge graph that can answer relationship queries.

WHAT IS AN IMPLICIT KNOWLEDGE GRAPH: Instead of explicit edges ("Node A is-related-to Node B"), relationships are implied by shared attributes. Two entries that share 3 topics are more related than two entries that share 1 topic. An entry with quality_score 98 is more authoritative than one with quality_score 60. The "graph" is never stored explicitly -- it is computed at query time.

HOW TO QUERY IMPLICIT RELATIONSHIPS:

1. Find Related Concepts (shared topics):
  SELECT b.doc_id, b.title, b.quality_score,
    array_length(ARRAY(SELECT unnest(a.topics) INTERSECT SELECT unnest(b.topics)), 1) AS shared_topics
  FROM ask_ruvnet.architecture_docs a, ask_ruvnet.architecture_docs b
  WHERE a.doc_id = 'my-entry-id'
    AND b.doc_id != a.doc_id
    AND a.topics && b.topics  -- array overlap operator
    AND b.is_duplicate = false
  ORDER BY shared_topics DESC, b.quality_score DESC
  LIMIT 10;

2. Find Authoritative Sources for a Topic:
  SELECT doc_id, title, quality_score, topics
  FROM ask_ruvnet.architecture_docs
  WHERE 'swarms' = ANY(topics)
    AND is_duplicate = false
  ORDER BY quality_score DESC
  LIMIT 5;

3. Find Semantically Close but Topically Different (bridging concepts):
  SELECT b.doc_id, b.title, b.category,
    1 - (a.embedding <=> b.embedding) AS similarity
  FROM ask_ruvnet.architecture_docs a, ask_ruvnet.architecture_docs b
  WHERE a.doc_id = 'my-entry-id'
    AND b.category != a.category
    AND b.is_duplicate = false
  ORDER BY a.embedding <=> b.embedding
  LIMIT 5;
  These are entries that are semantically similar but in a different category -- perfect for cross-domain insights.

BUILDING A TOPIC VOCABULARY: The quality of your implicit graph depends entirely on consistent topic tagging. Create a controlled vocabulary:
- Core concepts: 'agents', 'swarms', 'memory', 'vector-db', 'mcp', 'neural'
- Sub-concepts: 'hnsw', 'hierarchical', 'anti-drift', 'quality-scoring'
- Meta-tags: 'example', 'guide', 'reference', 'troubleshooting'

WHAT TO AVOID:
- Do not use free-form topics. If one entry uses "vector-search" and another uses "vector-db" and a third uses "vectors," your implicit graph has three disconnected nodes instead of one connected cluster. Standardize.
- Do not create too many topics per entry. 3-7 topics per entry is the sweet spot. More than 10 creates weak, noisy connections.
- Do not skip the shared-topics query when building response context. If the user asks about Topic X and you return 5 entries, also check what other topics those entries share -- that reveals the "neighborhood" of concepts the user might need next.`
},

// --- 18 ---
{
  title: 'Building a Recommendation Engine with Vector Search',
  content: `Vector search is not just for answering questions -- it is a natural recommendation engine. If you can embed content, you can find similar content. If you can embed user preferences, you can recommend content that matches those preferences.

THE CORE INSIGHT: Two pieces of content are "similar" if their embeddings are close in vector space. This means that if a user liked Entry A, entries near Entry A in embedding space are good recommendations. No collaborative filtering algorithms needed -- the embeddings encode the relationships.

PATTERN 1 -- CONTENT-BASED RECOMMENDATIONS ("More Like This"):

  -- Given an entry the user found helpful, find similar entries
  SELECT doc_id, title, quality_score,
    1 - (embedding <=> (SELECT embedding FROM ask_ruvnet.architecture_docs WHERE doc_id = $1)) AS similarity
  FROM ask_ruvnet.architecture_docs
  WHERE doc_id != $1
    AND is_duplicate = false
    AND quality_score >= 70
  ORDER BY embedding <=> (SELECT embedding FROM ask_ruvnet.architecture_docs WHERE doc_id = $1)
  LIMIT 5;

This finds the 5 most semantically similar entries to one the user already engaged with. Simple, fast (HNSW makes it sub-millisecond), and surprisingly effective.

PATTERN 2 -- PREFERENCE-BASED RECOMMENDATIONS (User Profile Embedding):
Instead of embedding a single entry, embed the user's aggregated interests. Take all entries the user has engaged with, average their embeddings, and search for entries near that centroid:

  async function getUserRecommendations(userId) {
    // Get embeddings of all entries this user engaged with
    const engaged = await pool.query(
      'SELECT a.embedding FROM ask_ruvnet.architecture_docs a ' +
      'JOIN user_interactions ui ON ui.doc_id = a.doc_id ' +
      'WHERE ui.user_id = $1 AND ui.rating >= 4', [userId]
    );
    // Average the embeddings to create a "preference vector"
    const avgVec = averageVectors(engaged.rows.map(r => r.embedding));
    // Find entries near the preference vector
    return pool.query(
      'SELECT doc_id, title FROM ask_ruvnet.architecture_docs ' +
      'WHERE is_duplicate = false ORDER BY embedding <=> $1::ruvector(384) LIMIT 10',
      [formatVec(avgVec)]
    );
  }

PATTERN 3 -- DIVERSITY-AWARE RECOMMENDATIONS: Pure similarity can create a "filter bubble." Add diversity by ensuring recommended entries span multiple categories:

  After getting top 20 by similarity, select the top 5 that maximize category diversity:
  At least one entry from each of the user's top 3 engaged categories, plus 2 from categories they have not explored yet.

WHEN TO USE THIS: Any application where users consume content from your KB -- documentation portals, learning platforms, research tools, or exploration interfaces.

WHAT TO AVOID:
- Do not recommend entries the user has already seen. Track engagement and filter.
- Do not rely solely on similarity. A user who read 5 entries about swarms probably does not need a 6th. Inject diversity.
- Do not skip the quality_score filter. Recommending low-quality entries degrades trust in the entire system.`
},

// --- 19 ---
{
  title: 'Context Window Management: Feeding the Right Knowledge to AI',
  content: `Modern AI models have large context windows (200K+ tokens for Claude), but your KB might have 55,000 entries. You cannot feed everything in. The art of context window management is selecting, compressing, and prioritizing the right knowledge for each query.

THE PROBLEM: You retrieve 10 relevant entries from the KB. Each entry is 500 words. That is 5,000 words (~6,500 tokens) of context. Add the system prompt, conversation history, and user query, and you are using 10-15K tokens per interaction. That seems fine -- but multiply by 100 interactions per hour and token costs add up fast. More importantly, cramming too much context can actually REDUCE answer quality because the AI has to sift through noise.

THE SELECTION FUNNEL:

Step 1 -- Broad Retrieval (20-30 candidates): Use vector search with a generous distance threshold to cast a wide net.

Step 2 -- Re-Ranking (top 10): Apply quality_score, recency, and category matching to narrow down.

Step 3 -- Diversity Filter (top 5-7): Ensure you are not sending 5 entries that all say the same thing. Keep the most representative entry from each sub-topic.

Step 4 -- Compression: For each remaining entry, trim to the most relevant portion. If the user asked about "configuring HNSW" and the entry covers HNSW configuration in paragraphs 3-4 of a 6-paragraph entry, send only those paragraphs with a one-line summary header.

THE CONTEXT BUDGET APPROACH:

  const CONTEXT_BUDGET = 8000; // tokens
  let usedTokens = 0;
  const selectedEntries = [];

  for (const entry of rankedResults) {
    const entryTokens = estimateTokens(entry.content);
    if (usedTokens + entryTokens > CONTEXT_BUDGET) {
      // Try to compress the entry
      const compressed = compressEntry(entry, CONTEXT_BUDGET - usedTokens);
      if (compressed) { selectedEntries.push(compressed); break; }
      else continue;
    }
    selectedEntries.push(entry);
    usedTokens += entryTokens;
  }

COMPRESSION STRATEGIES:
1. Extractive: Pull out only the sentences most relevant to the query (use embedding similarity at the sentence level).
2. Abstractive: Use a smaller/faster model to summarize the entry in fewer tokens.
3. Structured: Convert prose into bullet points or key-value pairs, which convey the same information in fewer tokens.

WHAT TO AVOID:
- Do not blindly send the top N results regardless of token count. One extremely relevant 2,000-word entry is better than ten mediocre 200-word entries.
- Do not cut entries in the middle. Either include enough of an entry to be useful or skip it entirely.
- Do not forget conversation history tokens. On turn 10 of a conversation, the history alone might be 5,000 tokens, leaving less budget for KB context.
- Do not over-compress. If you summarize a code example into prose, you lose the actual code the user needs.`
},

// --- 20 ---
{
  title: 'The Semantic Gap Problem',
  content: `The semantic gap is the distance between how users describe what they want and how your KB stores the knowledge. A user asks "why is my app slow?" but your KB has entries about "performance optimization," "database query profiling," and "network latency diagnosis." The embeddings help bridge this gap, but they do not eliminate it.

WHY IT HAPPENS:
- Users speak in SYMPTOMS ("my app is slow"). KB stores SOLUTIONS ("optimize database indexes").
- Users use INFORMAL language ("the thing broke"). KB uses TECHNICAL terms ("null reference exception in the authentication middleware").
- Users describe GOALS ("I want to build a chatbot"). KB stores TOOLS ("embeddings, vector search, prompt engineering").

THREE BRIDGE STRATEGIES:

Strategy 1 -- Synonym Layers: Create explicit mapping entries that connect user language to technical language:
  doc_id: 'bridge-slow-app-performance'
  title: 'When Your App Feels Slow: Performance Troubleshooting'
  content: "If your application feels slow, sluggish, or takes too long to respond, the root cause is usually in one of three areas: database queries, network calls, or computation. This guide maps common symptoms to technical solutions..."
  topics: ARRAY['performance', 'slow', 'latency', 'optimization', 'troubleshooting']

This entry acts as a BRIDGE: it will match the user's informal query AND link to the technical entries through shared topics.

Strategy 2 -- Multiple Abstraction Levels: For important concepts, create entries at different abstraction levels:
  High-level: "What is Vector Search?" (matches "how does AI find stuff")
  Mid-level: "Vector Search Architecture in RuVector" (matches "how to set up semantic search")
  Low-level: "HNSW Index Configuration Parameters" (matches "what should m and ef_construction be")

Strategy 3 -- Multiple Embedding Representations: Embed the same content with different phrasings. The entry about HNSW configuration can have its primary embedding generated from the full technical content, but you can also store bridge entries with embeddings generated from simplified descriptions:
  // Primary entry: embedded from technical content
  // Bridge entry: embedded from "how to make vector search faster and more accurate"

HOW TO DETECT THE GAP: Run your 5-query test (see Quality Metrics guide) using queries phrased as a non-expert would ask them. If Precision@5 drops below 0.5, you have a significant semantic gap. Compare this to the same test with expert-phrased queries -- the difference is your gap measurement.

WHAT TO AVOID:
- Do not assume users know your terminology. The biggest semantic gaps are between domain experts who write KB content and domain novices who search it.
- Do not create bridge entries without quality scoring. A vague bridge entry with quality_score 50 should not outrank a precise technical entry with quality_score 95.
- Do not over-simplify. Bridge entries should CONNECT user language to technical content, not replace it. The technical depth must still be searchable for expert users.`
},

// --- 21 ---
{
  title: 'Knowledge Base Entry Design Patterns',
  content: `The quality of individual KB entries determines the ceiling of your entire system. A perfectly configured vector search with HNSW indexing and hybrid re-ranking will still produce bad results if the underlying entries are poorly written. Here are the patterns that make entries effective.

PATTERN 1 -- THE COMPLETE ANSWER: Every entry should answer at least one question completely, without requiring the reader to look elsewhere.

BAD entry:
  Title: "HNSW"
  Content: "HNSW is used for indexing. See configuration docs."
  -- This tells the AI nothing useful. It cannot answer any question from this.

GOOD entry:
  Title: "HNSW Index Configuration for RuVector"
  Content: "HNSW (Hierarchical Navigable Small World) is the recommended index type for the embedding column in ask_ruvnet.architecture_docs. Create it with: CREATE INDEX idx_hnsw ON ask_ruvnet.architecture_docs USING hnsw (embedding ruvector_cosine_ops) WITH (m=16, ef_construction=200). The m parameter controls connections per node (higher = better recall, more memory). ef_construction controls build-time accuracy (200 is a good default). For tables under 1,000 rows, skip the index -- brute force is faster."

PATTERN 2 -- THE STRUCTURED ENTRY: Use a consistent internal structure. Every entry benefits from:
  - One-sentence summary (what this is about)
  - Context (when/why you would use this)
  - Details (how it works or how to do it)
  - Example (concrete code or command)
  - Pitfalls (what to avoid)

PATTERN 3 -- APPROPRIATE GRANULARITY: One concept per entry. Do not combine "HNSW configuration AND IVFFlat comparison AND embedding strategies" into one entry. The AI cannot extract the relevant portion from a kitchen-sink entry. Split it into three entries with shared topics for cross-referencing.

PATTERN 4 -- EXPLICIT METADATA:
  topics: ARRAY['hnsw', 'vector-db', 'indexing', 'ruvector', 'configuration']
  category: 'vector-db'
  quality_score: 95
  doc_type: 'curated'
Good metadata makes the difference between "retrieved but not useful" and "retrieved and precisely relevant."

PATTERN 5 -- TITLE AS QUERY MATCH: Your title should match how someone would search for this information. "HNSW Index Configuration for RuVector" is searchable. "Section 3.2: Indexing" is not.

THE QUALITY CHECKLIST:
1. Can this entry answer a question on its own? (completeness)
2. Is the title searchable? (discoverability)
3. Is there a concrete example? (actionability)
4. Are there 3-7 relevant topics? (connectedness)
5. Is it one concept, not three? (granularity)

WHAT TO AVOID:
- Fragment titles: "Overview," "Introduction," "Getting Started" -- these match everything and help nothing.
- Context-dependent content: "As mentioned above..." has no "above" in a KB chunk.
- Wall of text: If your entry is over 1,000 words, it probably covers multiple concepts and should be split.`
},

// --- 22 ---
{
  title: 'Evaluation Framework: Is Your KB Actually Helping?',
  content: `Most KB builders never systematically evaluate whether their knowledge base is actually improving outcomes. They add entries, run a few test searches, and assume it works. Here is a structured evaluation framework that takes 30 minutes and gives you a clear score.

THE 5-QUERY TEST (Do This Monthly):

Step 1: Choose 5 queries that represent real usage. One easy (you know the answer exists), one medium (the answer exists but requires combining entries), one hard (the answer requires inference from related entries), one edge case (unusual phrasing or rare topic), and one adversarial (a query that SHOULD return no results because the KB does not cover it).

Step 2: Run each query against your KB. Record the top 5 results for each.

Step 3: Score each result on a 1-5 scale:
  5 = Perfectly relevant, directly answers the question
  4 = Relevant, partially answers or provides key context
  3 = Tangentially related, might help with additional context
  2 = Slightly related, would not help answer the question
  1 = Completely irrelevant

Step 4: Calculate your metrics:
  Average Relevance = sum of all scores / 25 (5 queries x 5 results)
  Precision@5 = (scores of 4 or 5) / 25
  Hit Rate = queries where at least one result scored 4+ / 5

Step 5: Interpret:
  Average Relevance 4.0+ = Excellent KB, minor refinements only
  3.5-3.9 = Good KB, focus on gap areas
  3.0-3.4 = Needs work, identify weakest categories
  Below 3.0 = Fundamental problems with content, chunking, or embedding quality

THE AUTOMATED VERSION: For continuous monitoring, build this into your application:

  CREATE TABLE ask_ruvnet.kb_evaluations (
    id SERIAL PRIMARY KEY,
    eval_date TIMESTAMP DEFAULT NOW(),
    query TEXT NOT NULL,
    top_results JSONB NOT NULL,
    avg_relevance NUMERIC(3,2),
    precision_at_5 NUMERIC(3,2),
    notes TEXT
  );

Run the evaluation weekly via a script or LaunchAgent. Track the metrics over time. If average relevance trends downward, your KB is decaying (stale content, new topics not covered).

WHAT TO DO WITH RESULTS:
- If easy queries score low: Your basic content is missing or poorly embedded. Fix chunking and embedding.
- If medium queries score low: Your entries are too isolated. Add relationship links via topics[].
- If hard queries score low: You need multi-hop retrieval or query expansion.
- If edge cases score low: Your topic coverage has gaps. Add bridge entries.
- If adversarial queries return high-confidence wrong results: Your quality scoring is not aggressive enough. Lower scores on vague or overly broad entries.

WHAT TO AVOID:
- Do not evaluate only with queries you know will work. Include failures intentionally.
- Do not skip the adversarial query. Knowing when your KB correctly returns "I do not have information about this" is as important as returning good results.
- Do not evaluate once and declare victory. KB quality is a moving target -- new content, new user needs, and content decay all affect it.`
},

// --- 23 ---
{
  title: 'Application Pattern: Domain Expert Assistant',
  content: `A domain expert assistant is an AI that knows one field deeply rather than many fields broadly. Think of it as a specialist consultant: it should know more about its domain than the person asking, provide authoritative answers, and clearly state when a question falls outside its expertise.

WHEN TO USE THIS PATTERN: You have a specific domain (cybersecurity, tax law, mechanical engineering, wine selection) and you want an AI that provides expert-level guidance within that domain. The key difference from a general chatbot is DEPTH over BREADTH.

HOW TO BUILD IT:

1. Knowledge Curation (The Foundation): Start by identifying every authoritative source in your domain. For cybersecurity: NIST frameworks, OWASP guidelines, CVE databases, security vendor documentation, incident response playbooks. Ingest and curate:
  node scripts/ingest-docs-to-kb.js --source ./security-docs --category cybersecurity --quality-floor 80

The quality floor is critical. A domain expert assistant should NEVER return low-quality entries. Set quality_score minimum to 80 for all ingested content and manually review anything auto-scored below 90.

2. Authority Weighting: Not all sources are equal. NIST frameworks should outweigh blog posts. Use quality_score to encode authority:
  - Primary sources (standards, specifications): quality_score 95-100
  - Secondary sources (official documentation): quality_score 85-94
  - Tertiary sources (tutorials, guides): quality_score 70-84
  - Commentary (blog posts, opinions): quality_score 50-69

3. Confidence Calibration: The expert assistant must communicate confidence levels. When retrieval returns entries with quality_score 95+ and high semantic similarity (distance < 0.15), the response can be assertive. When the best match has quality_score 70 and distance 0.30, the response should hedge: "Based on available information, the recommended approach appears to be..."

4. Boundary Awareness: Equally important as answering questions is recognizing when a question falls outside the KB's coverage. If the best retrieval result has distance > 0.40, the assistant should say: "This question appears to be outside my area of expertise in [domain]. I recommend consulting..."

CONCRETE EXAMPLE: A cybersecurity expert assistant with 8,000 curated entries: 2,000 from NIST/OWASP (quality_score 98), 3,000 from vendor docs (quality_score 88), 2,000 from security guides (quality_score 78), 1,000 from incident case studies (quality_score 72, doc_type 'episodic'). When asked "how should we handle a suspected data breach," the system retrieves the NIST incident response framework (top authority), relevant case studies (episodic knowledge), and vendor-specific tools (practical implementation).

WHAT TO AVOID:
- Do not let the assistant answer outside its domain. A security expert giving medical advice destroys credibility.
- Do not mix authority levels without signaling it. The user should know whether the answer comes from an international standard or a blog post.
- Do not skip the confidence calibration. An expert who is equally confident about everything is not an expert.`
},

// --- 24 ---
{
  title: 'Application Pattern: Research Assistant',
  content: `A research assistant AI helps users synthesize information from multiple sources, track citations, detect contradictions, and identify gaps in their understanding. Unlike a simple search tool, it CONNECTS information across entries to generate insights.

WHEN TO USE THIS PATTERN: Literature reviews, competitive analysis, technical due diligence, market research, or any task where the value is not in finding ONE answer but in synthesizing MANY related pieces of information.

HOW TO BUILD IT:

1. Multi-Source Synthesis: The research assistant must search across multiple categories and combine results. A query about "serverless architecture tradeoffs" should pull from: architecture guides, performance benchmarks, cost analyses, and case studies. Use multi-hop retrieval:
  Hop 1: "serverless architecture" -> finds architecture overview entries
  Hop 2: Key terms from Hop 1 -> "Lambda cold start", "event-driven patterns"
  Hop 3: Implementation specifics -> "AWS Lambda configuration", "cost optimization"

2. Citation Tracking: Every claim in the synthesized response should trace back to a specific KB entry. Structure your response generation to include references:
  "Serverless architectures reduce operational overhead [ref: doc_id 'arch-serverless-overview', quality_score 95] but introduce cold-start latency of 100-500ms [ref: doc_id 'perf-lambda-cold-start', quality_score 88]."

The AI can generate these citations by tracking which entries contributed to each part of its response.

3. Contradiction Detection: When multiple entries provide conflicting information, the research assistant should FLAG it rather than silently picking one. This happens when:
  - Entry A says "use approach X" and Entry B says "approach X is deprecated"
  - Entry A cites performance of 100ms and Entry B cites 500ms for the same operation

  Implement by comparing entries retrieved for the same sub-topic:
  If two high-quality entries (quality_score > 80) provide different answers to the same question, surface both with a note: "Sources disagree on this point."

4. Gap Identification: After synthesizing available information, the assistant should identify what is MISSING. "Your KB has detailed information about Lambda architecture but no entries about Step Functions orchestration, which is typically used alongside Lambda for complex workflows."

  -- Find topic gaps
  SELECT DISTINCT unnest(topics) AS topic, COUNT(*) AS entry_count
  FROM ask_ruvnet.architecture_docs WHERE category = 'serverless'
  GROUP BY topic ORDER BY entry_count ASC LIMIT 10;

WHAT TO AVOID:
- Do not present synthesized information without citations. The whole point of a research assistant is traceability.
- Do not ignore contradictions. Silently choosing one source over another is how research assistants generate false confidence.
- Do not synthesize across quality levels without noting it. "According to a high-confidence source [quality 98]... however a lower-confidence source [quality 65] suggests..." gives the user calibrated information.`
},

// --- 25 ---
{
  title: 'Application Pattern: Decision Support System',
  content: `A decision support system does not make decisions for the user -- it presents options with tradeoffs, retrieves relevant historical precedents, and quantifies risks. Think of it as a well-organized briefing rather than an order.

WHEN TO USE THIS PATTERN: Technology selection, architecture decisions, vendor evaluation, strategic planning, or any situation where multiple valid options exist and the choice depends on context-specific constraints.

HOW TO BUILD IT:

1. Options Framework: For each decision domain, structure your KB entries as OPTIONS with TRADEOFFS:
  doc_id: 'decision-db-postgresql'
  title: 'Database Option: PostgreSQL'
  content: "STRENGTHS: ACID compliance, extensibility (RuVector, PostGIS), mature ecosystem, strong community. WEAKNESSES: Vertical scaling limits, complex replication setup, slower than purpose-built NoSQL for document-heavy workloads. BEST FOR: Applications requiring relational integrity, vector search, and complex queries. COST PROFILE: Free open-source, hosting costs $50-500/month depending on scale."
  topics: ARRAY['decision', 'database', 'postgresql', 'relational']

Create parallel entries for each alternative (MySQL, MongoDB, DynamoDB) with the same structure. The AI can then retrieve all options for a decision and present them comparatively.

2. Historical Precedent Lookup: Store past decisions and their outcomes:
  doc_id: 'precedent-2025-db-migration'
  title: 'Precedent: Database Migration from MongoDB to PostgreSQL (2025)'
  content: "CONTEXT: 500K documents, 10M vector embeddings, need for ACID transactions. DECISION: Migrate to PostgreSQL with RuVector. OUTCOME: 3x faster vector search, 50% reduction in data inconsistency bugs, 2-week migration effort. LESSONS: Plan for schema mapping early; MongoDB's flexible schema hides implicit schema assumptions."
  topics: ARRAY['precedent', 'database', 'migration', 'postgresql', 'mongodb']

3. Risk Assessment: For each option, include risk factors with severity:
  "RISK: PostgreSQL single-node write bottleneck at >10K writes/second (severity: medium, mitigation: connection pooling with PgBouncer, or horizontal partitioning with Citus)"

4. Constraint Matching: The decision support system should filter options based on user constraints:
  User: "I need a database that supports vector search, costs under $100/month, and runs on Railway"
  System: Filters options by topics containing 'vector-search', cost < $100, and deployment compatibility with Railway. Returns ranked options.

HOW TO QUERY FOR DECISIONS:
  SELECT doc_id, title, content, quality_score
  FROM ask_ruvnet.architecture_docs
  WHERE 'decision' = ANY(topics) AND 'database' = ANY(topics)
    AND is_duplicate = false
  ORDER BY quality_score DESC;

WHAT TO AVOID:
- Do not present a single recommendation without alternatives. Decision support means presenting OPTIONS, not making the choice.
- Do not skip precedents. Historical decisions and their outcomes are the most valuable inputs to new decisions.
- Do not quantify risks without mitigation strategies. "This might fail" is not useful. "This might fail, and here is how to prevent/recover from that failure" is.
- Do not forget to update precedent entries with long-term outcomes. A decision that looked good at month 1 might have been problematic at month 6.`
},

// --- 26 ---
{
  title: 'Embedding Strategy: One Size Does NOT Fit All',
  content: `Using the same chunking and embedding strategy for all content types is like using the same knife for bread and sushi. Different content has different structure, and your embedding strategy should respect that.

CODE CONTENT -- SMALLER, PRECISE CHUNKS:
Code is dense with meaning. A single function can answer a question completely. Chunk by logical boundaries (function, class, module), not character count. Keep chunks small (200-500 characters) because code is precise -- a user searching for "how to format a vector for PostgreSQL" needs the exact function, not the surrounding context.

  // Good: one function per chunk
  "function formatVec(vec) { return '[' + Array.from(vec).join(',') + ']'; }"

  // Bad: half a function
  "function formatVec(vec) { return '[' + Array.from(vec)."

For code, use 0-20 character overlap because code boundaries are natural break points.

DOCUMENTATION -- LARGER, CONTEXTUAL CHUNKS:
Documentation is narrative. Ideas build across paragraphs. Chunk at 600-1000 characters with 100-150 character overlap. Split on paragraph or section boundaries, never mid-sentence.

  // Good: complete concept with context
  "HNSW indexes use a multi-layered graph structure for fast approximate nearest neighbor search. The m parameter controls how many connections each node has. Higher m values (16-32) improve recall but use more memory. For most use cases, m=16 provides the best balance. Create the index with: CREATE INDEX ... USING hnsw ... WITH (m=16)."

CONVERSATIONS AND Q&A -- TURN-BASED CHUNKS:
Conversations have a natural unit: the question-answer pair. Each chunk should contain at least one complete Q&A exchange, with overlap of one turn for context.

  // Good: complete Q&A pair
  "Q: How do I check if my HNSW index is working? A: Run EXPLAIN ANALYZE on a vector similarity query. If you see 'Index Scan using idx_hnsw', the index is being used. If you see 'Seq Scan', the planner chose a sequential scan, which means either your table is too small or the ef_search parameter needs adjustment."

STRUCTURED DATA -- FIELD-BASED CHUNKS:
Configuration files, API responses, and database schemas should be chunked by logical units (one config block, one API endpoint, one table definition). Include the field names and their descriptions together -- never separate a field name from its description.

TABULAR DATA -- ROW OR GROUP-BASED:
Tables should be chunked as complete rows or logical row groups, with the column headers included in every chunk as context.

THE EMBEDDING ITSELF: For all content types, embed the TITLE + CONTENT combined (but weighted toward content). This ensures the title's searchability is captured in the vector:
  const textToEmbed = (entry.title + '\\n' + entry.content).slice(0, 2000);
  const result = await svc.embed(textToEmbed);

WHAT TO AVOID:
- Do not use 800-character chunks for code. You will split functions in half.
- Do not use 200-character chunks for documentation. You will lose all context.
- Do not embed titles and content separately. Combined embedding captures the relationship between what-it-is (title) and what-it-says (content).
- Do not forget that the embedding model has a token limit. Xenova/all-MiniLM-L6-v2 handles up to ~512 tokens effectively. Content beyond that gets diminished attention.`
},

// --- 27 ---
{
  title: 'The Cold Start Problem: Building a KB From Scratch',
  content: `Every knowledge base starts empty, and the first 100 entries determine whether it becomes useful or becomes a graveyard of random documents. The cold start problem is real: with too few entries, vector search returns irrelevant results because there is nothing relevant TO return. With too many low-quality entries, search returns plausible but unhelpful results.

THE MINIMUM VIABLE KB:

For most applications, you need approximately 200-500 high-quality entries before vector search becomes reliably useful. Below 200, the embedding space is too sparse -- there are not enough neighbors for HNSW to find meaningful matches. Think of it like a library: a library with 10 books can only answer 10 questions, no matter how good the catalog system is.

WHAT TO INGEST FIRST (Priority Order):

1. Core Concepts (50-100 entries): Define the fundamental concepts of your domain. These are the entries that EVERY query will eventually reference. For a technical KB: what is each technology, how does it work, when do you use it.

2. Frequently Asked Questions (50-100 entries): Mine your support tickets, Slack channels, or forum posts for the questions that come up repeatedly. These represent actual demand.

3. Procedures and How-Tos (50-100 entries): Step-by-step guides for common tasks. These are what users actually need when they ask questions.

4. Reference Material (100-200 entries): API docs, configuration references, specifications. Important but less frequently queried.

HOW TO BOOTSTRAP QUALITY:
- Start with CURATED entries (doc_type 'curated', quality_score 90+). Write or carefully edit the first 100 entries by hand. This is the nucleus that trains your intuition about what good entries look like.
- Use the RuVector ingestion scripts to batch-import from authoritative sources:
  node scripts/ingest-docs-to-kb.js --source ./curated-docs --quality-floor 85
- After the first 200 curated entries, begin auto-ingesting from secondary sources with lower quality scores (60-80).

WHEN RAW QUANTITY HELPS: After you have 500+ curated entries, adding MORE entries (even lower-quality ones) improves recall. The embedding space becomes denser, HNSW has more neighbors to traverse, and edge-case queries find something relevant. But quantity without the curated core is noise.

WHEN RAW QUANTITY HURTS: If you dump 10,000 auto-generated entries with quality_score 50 into an empty KB, your search results will be consistently mediocre. The vector space is dense but the content is thin. Every query returns "kind of related" results but nothing truly helpful.

THE BOOTSTRAPPING TIMELINE:
  Week 1: 100 hand-curated core concept entries. Test with 5-query method. Target: relevance 3.0+.
  Week 2-3: 200 more entries from authoritative sources. Test again. Target: relevance 3.5+.
  Month 2: 500 total entries. Enable auto-ingestion. Test. Target: relevance 4.0+.
  Month 3+: Continuous ingestion + feedback loops. Target: relevance 4.0+ sustained.

WHAT TO AVOID:
- Do not auto-ingest everything on day one. Start curated, expand gradually.
- Do not skip the 5-query test at each milestone. You need to know if adding entries is helping or hurting.
- Do not compare your 200-entry KB to a 55,000-entry one. They serve different stages of maturity.`
},

// --- 28 ---
{
  title: 'Cross-Domain Knowledge Linking',
  content: `Real-world questions rarely fit neatly into one domain. "How do I secure my vector database?" spans security AND database AND vector-search domains. Cross-domain linking is how your KB handles questions that bridge multiple areas of knowledge.

THE CHALLENGE: If your KB is organized into strict categories (security, database, vector-db), a cross-domain question might only find results from one category. The security entries mention "database encryption" but not "HNSW indexes." The vector-db entries mention "index configuration" but not "access control." Neither domain alone has the complete answer.

THE ASK_RUVNET PATTERN AS A UNIVERSAL KNOWLEDGE STORE:

The ask_ruvnet.architecture_docs table is a single schema that stores ALL knowledge regardless of domain. This is intentional. Cross-domain queries work because:

1. Embeddings are domain-agnostic: The vector for "secure my vector database" is close to BOTH security entries about database protection AND vector-db entries about access patterns. HNSW does not respect category boundaries.

2. Topics enable cross-referencing: An entry can have topics from multiple domains:
  topics: ARRAY['security', 'vector-db', 'access-control', 'hnsw', 'postgresql']
  This entry lives in the intersection of security and vector-db.

3. Category is for filtering, not isolation: Use category in WHERE clauses only when the user explicitly wants a single domain. For open-ended queries, search across all categories:

  -- Cross-domain search (no category filter)
  SELECT doc_id, title, category, quality_score
  FROM ask_ruvnet.architecture_docs
  WHERE embedding <=> $1::ruvector(384) < 0.3
    AND is_duplicate = false
  ORDER BY quality_score DESC LIMIT 10;

  -- The results naturally span multiple categories if the query is cross-domain

HOW TO CREATE BRIDGE ENTRIES: For known intersections between domains, create explicit bridge entries:
  doc_id: 'bridge-security-vector-db'
  title: 'Security Considerations for Vector Database Deployments'
  content: "Vector databases like RuVector store embeddings that encode semantic meaning. This creates unique security considerations: 1) Embedding inversion attacks can reconstruct source text from vectors. 2) HNSW indexes should be access-controlled at the PostgreSQL role level. 3) Query patterns can reveal user intent. Mitigations: row-level security, connection encryption, query audit logging."
  topics: ARRAY['security', 'vector-db', 'hnsw', 'access-control', 'bridge']
  category: 'cross-domain'

HOW TO CONNECT DIFFERENT SCHEMAS/PROJECTS: If you have knowledge in multiple PostgreSQL schemas (ask_ruvnet, openclaw_memory, etc.), create a cross-schema view or use federated queries:

  -- Cross-schema knowledge search
  SELECT doc_id, title, content, 'ask_ruvnet' AS source FROM ask_ruvnet.architecture_docs
  WHERE embedding <=> $1::ruvector(384) < 0.3
  UNION ALL
  SELECT key AS doc_id, key AS title, value AS content, 'openclaw' AS source
  FROM openclaw_memory.operational_knowledge
  WHERE tags @> ARRAY['relevant-tag']
  ORDER BY quality_score DESC LIMIT 10;

WHAT TO AVOID:
- Do not create separate databases for separate domains. The power of vector search is finding unexpected connections. Domain separation prevents this.
- Do not over-categorize. An entry can legitimately belong to 2-3 categories. Use topics for multi-membership.
- Do not forget bridge entries for known intersections. These are the highest-value entries in a cross-domain KB because they answer questions that no single-domain entry can.`
},

// --- 29 ---
{
  title: 'Real-Time KB Updates: Keeping Knowledge Fresh',
  content: `A knowledge base that is not updated becomes a liability. Users trust that the information is current. When they find outdated content, they stop trusting ALL content -- even the entries that are still accurate. Freshness is a quality dimension.

THE STALENESS PROBLEM: Technical knowledge decays fast. API documentation becomes stale with every release. Best practices evolve. Configuration examples break when dependencies update. If your KB was last updated 3 months ago, some percentage of entries are now wrong.

THREE UPDATE PATTERNS:

Pattern 1 -- Event-Driven Ingestion (Best for Source Code/Docs):
When a source document changes, automatically re-ingest it. Use GitHub webhooks or file system watchers:

  // GitHub webhook handler (simplified)
  app.post('/webhook/github', async (req, res) => {
    const { repository, commits } = req.body;
    const changedFiles = commits.flatMap(c => [...c.added, ...c.modified]);
    const docFiles = changedFiles.filter(f => /\\.(md|txt|rst)$/.test(f));
    if (docFiles.length > 0) {
      await reingestRepo(repository.name, docFiles);
    }
    res.sendStatus(200);
  });

Pattern 2 -- Scheduled Refresh (Best for External Sources):
Run periodic checks for updates. The kb-evergreen.mjs pattern checks GitHub repos for new commits since last ingest:

  node scripts/kb-evergreen.mjs  # Checks all repos, re-ingests only changed ones

Set this up as a LaunchAgent (macOS) or cron job for automatic daily freshness:
  <!-- ~/Library/LaunchAgents/com.ruvnet.kb-evergreen.plist -->
  Run daily at 3 AM, log results, alert on failure.

Pattern 3 -- Staleness Detection (Best for Curated Content):
Entries that have not been updated in N days get flagged for review:

  -- Find entries that may be stale
  SELECT doc_id, title, category, updated_at,
    NOW() - updated_at AS age,
    CASE
      WHEN category IN ('api-reference', 'configuration') THEN INTERVAL '30 days'
      WHEN category IN ('architecture', 'patterns') THEN INTERVAL '90 days'
      ELSE INTERVAL '180 days'
    END AS max_age
  FROM ask_ruvnet.architecture_docs
  WHERE is_duplicate = false
  HAVING NOW() - updated_at > CASE
    WHEN category IN ('api-reference', 'configuration') THEN INTERVAL '30 days'
    WHEN category IN ('architecture', 'patterns') THEN INTERVAL '90 days'
    ELSE INTERVAL '180 days'
  END
  ORDER BY age DESC;

Different categories decay at different rates. API references go stale in weeks. Architectural patterns stay relevant for months. Foundational concepts may be evergreen.

THE FRESHNESS WORKFLOW:
1. Detect stale entries (automated query above)
2. Prioritize by category and quality_score (high-quality stale entries are the most dangerous)
3. Update or archive (re-ingest from source, or mark as archived if source no longer exists)
4. Re-embed updated entries (the embedding must reflect the new content)
5. Log the refresh for audit trail

WHAT TO AVOID:
- Do not update the content but forget to re-generate the embedding. A stale embedding on fresh content means the entry will not be found by the right queries.
- Do not treat all categories with the same freshness threshold. A 6-month-old math tutorial is fine. A 6-month-old API endpoint description is probably wrong.
- Do not auto-delete stale entries. Archive them (is_duplicate = true) so they do not appear in search but remain available for historical queries.`
},

// --- 30 ---
{
  title: 'Measuring ROI: Is Your Knowledge Base Worth the Investment?',
  content: `Building and maintaining a knowledge base costs time, compute, and attention. The question is not "is this cool" but "is this saving more than it costs?" Here is how to measure the return on investment for a knowledge-based application.

THE FOUR ROI DIMENSIONS:

1. Time Saved Per Query:
Before the KB, answering a technical question required: searching docs manually (5 min), reading multiple pages (10 min), synthesizing an answer (5 min) = 20 minutes average.
With the KB-powered AI: ask the question, get a synthesized answer with sources (30 seconds).
Time saved per query: ~19 minutes. At 50 queries per day, that is 15+ hours saved daily.

Measure it: Track average response time and compare to historical support ticket resolution times or documented manual research times.

2. Decision Quality Improvement:
Harder to measure but equally valuable. With a KB, decisions are informed by: all relevant historical precedents (not just the ones someone remembers), quantified tradeoffs (not gut feelings), and cross-domain insights (connections a single person might miss).

Measure it: Track decision outcomes over time. Before the KB, what percentage of architecture decisions needed to be reversed? After the KB? Reducing decision reversals from 30% to 10% is enormous ROI in engineering time.

3. Error Prevention:
A well-maintained KB prevents repeated mistakes. When someone encounters "error X with configuration Y," the resolution is captured. Next time error X appears, the KB provides the fix immediately instead of requiring another debugging session.

Measure it: Count "known issue" resolutions (questions where the KB had the answer) versus "novel issue" investigations (questions requiring new research). As your KB matures, the ratio should shift toward known issues:
  SELECT
    COUNT(*) FILTER (WHERE retrieval_confidence > 0.8) AS known_issues,
    COUNT(*) FILTER (WHERE retrieval_confidence < 0.5) AS novel_issues
  FROM query_log WHERE date > NOW() - INTERVAL '30 days';

4. Compound Knowledge Value:
Knowledge accumulates. Entry #5,000 is not just 1/5000th of the value -- it strengthens the entire graph by creating new connections. A KB with 10,000 well-connected entries can answer questions that no individual entry addresses by combining multiple entries.

THE COST SIDE:
- Compute: ONNX embedding generation, PostgreSQL hosting, HNSW index maintenance. For a 55K-entry KB on a single PostgreSQL instance: approximately $50-100/month.
- Maintenance: Staleness detection, quality scoring, re-ingestion. Approximately 2-4 hours per week.
- Initial build: Content curation, chunking strategy, evaluation. Approximately 40-80 hours one-time.

THE BREAK-EVEN CALCULATION:
If your KB saves 15 hours per day across a team, and costs 4 hours per week to maintain plus $100/month in compute:
  Weekly savings: 75 hours of team time
  Weekly costs: 4 hours maintenance + ~$25 compute
  ROI: ~18x return on time investment

WHAT TO AVOID:
- Do not measure ROI only in cost savings. The qualitative improvements (better decisions, fewer errors, faster onboarding) often exceed the direct time savings.
- Do not ignore maintenance costs. An unmaintained KB decays and eventually produces negative ROI (wrong answers waste more time than they save).
- Do not expect immediate returns. The first month is investment-heavy (building the KB). Positive ROI typically appears in month 2-3 as the KB reaches critical mass (~500 high-quality entries).`
}

];

// ============================================================
// Insertion Logic
// ============================================================

async function main() {
  console.log('=== KB Application Architecture Guides Ingestion ===');
  console.log(`Guides to insert: ${guides.length}`);

  // Initialize ONNX
  await initOnnx();

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < guides.length; i++) {
    const guide = guides[i];
    const docId = 'app-guide-' + slugify(guide.title);
    const filePath = 'app-guides/' + docId;
    const fileHash = md5(guide.content);
    const embText = (guide.title + '\n' + guide.content).slice(0, 2000);

    try {
      // Generate embedding
      const result = await svc.embed(embText);
      const vec = result.embedding || result;
      if (!vec || vec.length !== 384) {
        console.error(`[${i + 1}] Bad embedding for: ${guide.title}`);
        errors++;
        continue;
      }
      const vecStr = '[' + Array.from(vec).join(',') + ']';

      // Derive topics from title
      const titleWords = guide.title.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3 && !['knowledge', 'base', 'architecture', 'pattern', 'application', 'building', 'when', 'your', 'that', 'from', 'with', 'what', 'does', 'always', 'this', 'than', 'first', 'size', 'making', 'search'].includes(w));
      const topics = [...new Set(['application-architecture', 'kb-guide', ...titleWords.slice(0, 5)])];

      const res = await pool.query(`
        INSERT INTO ${SCHEMA}.${TABLE}
        (doc_id, title, content, file_path, file_hash, doc_type, category,
         quality_score, is_duplicate, topics, embedding)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::ruvector(384))
        ON CONFLICT (doc_id) DO NOTHING
        RETURNING doc_id
      `, [
        docId,
        guide.title,
        guide.content,
        filePath,
        fileHash,
        'curated',
        'application-architecture',
        98,
        false,
        topics,
        vecStr
      ]);

      if (res.rowCount > 0) {
        inserted++;
        console.log(`[${i + 1}/30] Inserted: ${guide.title}`);
      } else {
        skipped++;
        console.log(`[${i + 1}/30] Skipped (exists): ${guide.title}`);
      }
    } catch (err) {
      errors++;
      console.error(`[${i + 1}/30] Error: ${guide.title} - ${err.message}`);
    }
  }

  console.log('\n=== Results ===');
  console.log(`Inserted: ${inserted}`);
  console.log(`Skipped:  ${skipped}`);
  console.log(`Errors:   ${errors}`);
  console.log(`Total:    ${guides.length}`);

  // Verify
  const verify = await pool.query(
    `SELECT COUNT(*) AS cnt FROM ${SCHEMA}.${TABLE} WHERE doc_id LIKE 'app-guide-%'`
  );
  console.log(`\nVerification: ${verify.rows[0].cnt} app-guide entries in database`);

  await pool.end();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
