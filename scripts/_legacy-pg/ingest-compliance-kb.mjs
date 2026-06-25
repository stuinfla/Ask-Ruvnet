#!/usr/bin/env node
/**
 * Ingest kb-industry-compliance-ai.json into ask_ruvnet.architecture_docs
 *
 * Fields ingested:
 *   title, content, summary (first 200 chars), category,
 *   source_authority ('expert-curated'), knowledge_type,
 *   concepts (postgres array), expertise_level, quality_score,
 *   triage_tier (gold/silver/bronze), is_duplicate, embedding
 *
 * Embedding: Xenova/all-MiniLM-L6-v2 via @xenova/transformers (384 dims)
 * ON CONFLICT (doc_id): update content, embedding, quality_score
 */

import pg from 'pg';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JSON_PATH = path.join(__dirname, '..', 'docs', 'kb-industry-compliance-ai.json');

const pool = new pg.Pool({
  host: 'localhost',
  port: 5435,
  user: 'postgres',
  password: '',
  database: 'postgres',
  max: 3,
});

// ---------------------------------------------------------------------------
// Embedder (lazy singleton via @xenova/transformers)
// ---------------------------------------------------------------------------
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
  const truncated = text.slice(0, 512);
  const out = await e(truncated, { pooling: 'mean', normalize: true });
  return '[' + Array.from(out.data).join(',') + ']';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function strip(s) {
  // Remove non-ASCII characters that can cause DB encoding errors
  return s.replace(/[^\x00-\x7F]/g, '');
}

function hash(s) {
  return crypto
    .createHash('sha256')
    .update(s.toLowerCase().replace(/\s+/g, ' ').trim())
    .digest('hex');
}

// Map knowledge_type values from JSON to the values allowed by the DB check constraint.
// Allowed: concept, procedure, decision, reference, troubleshooting,
//          pattern, example, overview, unknown
const KNOWLEDGE_TYPE_MAP = {
  'how-to': 'procedure',
  'howto': 'procedure',
  'tutorial': 'procedure',
  'guide': 'procedure',
  'best-practice': 'pattern',
  'best-practices': 'pattern',
  'faq': 'troubleshooting',
};

function normalizeKnowledgeType(raw) {
  if (!raw) return 'unknown';
  const lower = raw.toLowerCase();
  return KNOWLEDGE_TYPE_MAP[lower] || lower;
}

function triageTier(qualityScore) {
  if (qualityScore >= 80) return 'gold';
  if (qualityScore >= 50) return 'silver';
  return 'bronze';
}

// ---------------------------------------------------------------------------
// Main ingestion
// ---------------------------------------------------------------------------

async function ingest() {
  console.log('Industry Compliance AI KB Ingestion');
  console.log('=====================================');
  console.log(`Source: ${JSON_PATH}`);
  console.log('Target: ask_ruvnet.architecture_docs\n');

  // Load JSON
  let entries;
  try {
    const raw = readFileSync(JSON_PATH, 'utf-8');
    entries = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to read JSON file:', err.message);
    process.exit(1);
  }

  console.log(`Loaded ${entries.length} entries from JSON\n`);

  const client = await pool.connect();
  let inserted = 0;
  let updated = 0;
  let errors = 0;

  try {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      const titleStr = strip(entry.title || '');
      const contentStr = strip(entry.content || '');
      const category = entry.category || 'healthcare-ai';
      const knowledgeType = normalizeKnowledgeType(entry.knowledge_type);
      const concepts = Array.isArray(entry.concepts) ? entry.concepts : [];
      const expertiseLevel = entry.expertise_level || 'intermediate';
      const qualityScore = typeof entry.quality_score === 'number' ? entry.quality_score : 0;

      const summary = contentStr.slice(0, 200);
      const tier = triageTier(qualityScore);
      const docId = `compliance-ai-${hash(titleStr)}`;
      const fileHash = hash(contentStr);
      const filePath = `knowledge/compliance-ai/${docId}`;

      try {
        // Generate embedding from title + content (truncated to 512 chars)
        const embeddingText = `${titleStr} ${contentStr}`;
        const embeddingVec = await embed(embeddingText);

        // Upsert: insert or update on doc_id conflict
        const result = await client.query(
          `INSERT INTO ask_ruvnet.architecture_docs
            (doc_id, title, content, summary, file_path, file_hash, category,
             source_authority, knowledge_type, concepts, expertise_level,
             quality_score, triage_tier, is_duplicate, embedding)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::ruvector)
           ON CONFLICT (doc_id) DO UPDATE SET
             content        = EXCLUDED.content,
             summary        = EXCLUDED.summary,
             embedding      = EXCLUDED.embedding::ruvector,
             quality_score  = EXCLUDED.quality_score,
             triage_tier    = EXCLUDED.triage_tier,
             updated_at     = now()
           RETURNING (xmax = 0) AS was_inserted`,
          [
            docId,
            titleStr,
            contentStr,
            summary,
            filePath,
            fileHash,
            category,
            'expert-curated',   // source_authority (check constraint value)
            knowledgeType,
            concepts,           // pg will cast text[] correctly
            expertiseLevel,
            qualityScore,
            tier,
            false,              // is_duplicate
            embeddingVec,
          ]
        );

        const wasInserted = result.rows[0]?.was_inserted;
        if (wasInserted) {
          inserted++;
        } else {
          updated++;
        }

        console.log(
          `Ingested ${i + 1}/${entries.length}: [${tier.toUpperCase()}] ${titleStr.slice(0, 70)}`
        );
      } catch (err) {
        errors++;
        console.error(`  ERROR on entry ${i + 1} ("${titleStr.slice(0, 50)}"): ${err.message}`);
      }
    }
  } finally {
    client.release();
  }

  // Final count in DB (before pool.end())
  let dbCount = 'N/A';
  try {
    const countClient2 = await pool.connect();
    try {
      const countResult = await countClient2.query(
        `SELECT COUNT(*) AS total FROM ask_ruvnet.architecture_docs
         WHERE doc_id LIKE 'compliance-ai-%'`
      );
      dbCount = countResult.rows[0].total;
    } finally {
      countClient2.release();
    }
  } catch (err) {
    // non-fatal
  }

  await pool.end();

  // Summary
  console.log('\n=====================================');
  console.log('Ingestion complete');
  console.log(`  Total entries in JSON : ${entries.length}`);
  console.log(`  Inserted (new)        : ${inserted}`);
  console.log(`  Updated (existing)    : ${updated}`);
  console.log(`  Errors                : ${errors}`);
  console.log(`  Successfully ingested : ${inserted + updated}`);
  console.log(`  DB rows (compliance-ai-*): ${dbCount}`);
}

ingest().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
