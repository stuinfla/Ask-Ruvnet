#!/usr/bin/env node
/**
 * Ingest deployment runbooks + client-facing materials into ask_ruvnet.architecture_docs
 *
 * Sources: docs/kb-deployment-client-materials*.json (all parts)
 * Fields: title, content, summary, category, knowledge_type, concepts,
 *         expertise_level, quality_score, triage_tier, embedding
 *
 * Embedding: Xenova/all-MiniLM-L6-v2 (384 dims) via @xenova/transformers
 * ON CONFLICT (doc_id): update content, embedding, quality_score
 */

import pg from 'pg';
import crypto from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.join(__dirname, '..', 'docs');

// Find all kb-deployment-client-materials*.json files
const jsonFiles = readdirSync(DOCS_DIR)
  .filter(f => f.startsWith('kb-deployment-client-materials') && f.endsWith('.json'))
  .sort()
  .map(f => path.join(DOCS_DIR, f));

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
  return s.replace(/[^\x00-\x7F]/g, '');
}

function hash(s) {
  return crypto
    .createHash('sha256')
    .update(s.toLowerCase().replace(/\s+/g, ' ').trim())
    .digest('hex');
}

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
  console.log('Deployment + Client Materials KB Ingestion');
  console.log('===========================================');
  console.log(`Found ${jsonFiles.length} source file(s):`);
  jsonFiles.forEach(f => console.log(`  - ${path.basename(f)}`));
  console.log('Target: ask_ruvnet.architecture_docs\n');

  // Load and combine all JSON files
  let allEntries = [];
  for (const jsonPath of jsonFiles) {
    try {
      const raw = readFileSync(jsonPath, 'utf-8');
      const entries = JSON.parse(raw);
      console.log(`Loaded ${entries.length} entries from ${path.basename(jsonPath)}`);
      allEntries = allEntries.concat(entries);
    } catch (err) {
      console.error(`Failed to read ${path.basename(jsonPath)}: ${err.message}`);
    }
  }

  console.log(`\nTotal entries to ingest: ${allEntries.length}\n`);

  const client = await pool.connect();
  let inserted = 0;
  let updated = 0;
  let errors = 0;

  try {
    for (let i = 0; i < allEntries.length; i++) {
      const entry = allEntries[i];

      const titleStr = strip(entry.title || '');
      const contentStr = strip(entry.content || '');
      const category = entry.category || 'deployment-runbook';
      const knowledgeType = normalizeKnowledgeType(entry.knowledge_type);
      const concepts = Array.isArray(entry.concepts) ? entry.concepts : [];
      const expertiseLevel = entry.expertise_level || 'intermediate';
      const qualityScore = typeof entry.quality_score === 'number' ? entry.quality_score : 0;

      const summary = contentStr.slice(0, 200);
      const tier = triageTier(qualityScore);
      const docId = `deployment-client-${hash(titleStr)}`;
      const fileHash = hash(contentStr);
      const filePath = `knowledge/deployment-client/${docId}`;

      try {
        const embeddingText = `${titleStr} ${contentStr}`;
        const embeddingVec = await embed(embeddingText);

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
            'expert-curated',
            knowledgeType,
            concepts,
            expertiseLevel,
            qualityScore,
            tier,
            false,
            embeddingVec,
          ]
        );

        const wasInserted = result.rows[0]?.was_inserted;
        if (wasInserted) inserted++;
        else updated++;

        console.log(
          `[${i + 1}/${allEntries.length}] [${tier.toUpperCase()}] ${titleStr.slice(0, 70)}`
        );
      } catch (err) {
        errors++;
        console.error(`  ERROR on entry ${i + 1} ("${titleStr.slice(0, 50)}"): ${err.message}`);
      }
    }
  } finally {
    client.release();
  }

  // Final count in DB
  let dbCount = 'N/A';
  try {
    const countClient = await pool.connect();
    try {
      const countResult = await countClient.query(
        `SELECT COUNT(*) AS total FROM ask_ruvnet.architecture_docs
         WHERE doc_id LIKE 'deployment-client-%'`
      );
      dbCount = countResult.rows[0].total;
    } finally {
      countClient.release();
    }
  } catch {}

  await pool.end();

  console.log('\n===========================================');
  console.log('Ingestion complete');
  console.log(`  Total entries in JSON : ${allEntries.length}`);
  console.log(`  Inserted (new)        : ${inserted}`);
  console.log(`  Updated (existing)    : ${updated}`);
  console.log(`  Errors                : ${errors}`);
  console.log(`  Successfully ingested : ${inserted + updated}`);
  console.log(`  DB rows (deployment-client-*): ${dbCount}`);
}

ingest().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
