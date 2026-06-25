#!/usr/bin/env node
/**
 * KB Ingestion Template v1.0.0
 *
 * USE THIS for ALL future KB ingestion.
 * Guarantees: deduplication, categorization, quality scoring, semantic embeddings
 *
 * Usage:
 *   node scripts/kb-ingest-template.js --source ./docs --schema my_project
 */

const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  pg: {
    host: process.env.RUVECTOR_HOST || 'localhost',
    port: parseInt(process.env.RUVECTOR_PORT || '5435'),
    database: 'postgres',
    user: 'postgres',
    password: process.env.RUVECTOR_PASSWORD || ''
  }
};

// Category detection rules
const CATEGORY_RULES = [
  { pattern: /agent/i, category: 'agents' },
  { pattern: /swarm|hive/i, category: 'swarms' },
  { pattern: /memory|reasoning.?bank/i, category: 'memory' },
  { pattern: /deploy|docker|railway|k8s/i, category: 'deployment' },
  { pattern: /consensus|byzantine|raft|crdt/i, category: 'consensus' },
  { pattern: /neural|fann/i, category: 'neural' },
  { pattern: /vector|ruvector|embedding/i, category: 'vector-db' },
  { pattern: /mcp|model.?context/i, category: 'mcp' },
  { pattern: /sparc/i, category: 'sparc' },
  { pattern: /security|auth|encrypt/i, category: 'security' },
  { pattern: /github|pull.?request/i, category: 'github' },
  { pattern: /wasm|simd|performance/i, category: 'performance' },
  { pattern: /llm|ruvllm/i, category: 'llm' },
  { pattern: /reinforcement|q.?learning/i, category: 'reinforcement-learning' },
];

function detectCategory(title, content, filePath) {
  const text = `${title} ${filePath}`.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(text)) return rule.category;
  }
  return 'general';
}

function calculateQuality(title, content) {
  let score = 0;
  if (content.length > 500) score += 20;
  else score += Math.floor(content.length / 25);
  if (content.includes('```')) score += 25;
  if (/^#+ /m.test(content)) score += 15;
  if (content.includes('|') && content.split('|').length > 4) score += 10;
  if (/^[-*] /m.test(content)) score += 10;
  if (title.length > 10) score += 10;
  return Math.min(100, score);
}

function contentHash(content) {
  return crypto.createHash('sha256')
    .update(content.toLowerCase().replace(/\s+/g, ' ').trim())
    .digest('hex');
}

async function createSchema(pool, schema) {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.architecture_docs (
      id SERIAL PRIMARY KEY,
      doc_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      embedding real[],
      category TEXT NOT NULL,
      quality_score INTEGER NOT NULL,
      is_duplicate BOOLEAN DEFAULT FALSE,
      canonical_id INTEGER,
      topics TEXT[],
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(file_hash)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_${schema}_category
    ON ${schema}.architecture_docs(category, quality_score DESC)
    WHERE is_duplicate = FALSE
  `);

  // Create optimized view
  await pool.query(`
    CREATE OR REPLACE VIEW ${schema}.kb AS
    SELECT id, title, content, file_path, embedding, category, quality_score, topics
    FROM ${schema}.architecture_docs
    WHERE is_duplicate = FALSE AND quality_score >= 50
    ORDER BY quality_score DESC
  `);

  console.log(`✅ Schema ${schema} ready with optimized structure`);
}

async function ingestDocument(pool, schema, doc) {
  const hash = contentHash(doc.content);
  const category = detectCategory(doc.title, doc.content, doc.filePath);
  const quality = calculateQuality(doc.title, doc.content);

  // Check for duplicate
  const existing = await pool.query(
    `SELECT id, quality_score FROM ${schema}.architecture_docs WHERE file_hash = $1`,
    [hash]
  );

  if (existing.rows.length > 0) {
    // Duplicate found - keep higher quality
    if (quality > existing.rows[0].quality_score) {
      // New one is better - update
      await pool.query(`
        UPDATE ${schema}.architecture_docs
        SET title = $1, content = $2, file_path = $3, category = $4,
            quality_score = $5, updated_at = NOW(),
            embedding = ruvector_embed(LEFT($1 || ' ' || $2, 1500))::real[]
        WHERE id = $6
      `, [doc.title, doc.content, doc.filePath, category, quality, existing.rows[0].id]);
      return { status: 'updated', id: existing.rows[0].id };
    }
    return { status: 'duplicate', id: existing.rows[0].id };
  }

  // New document - insert with embedding
  const result = await pool.query(`
    INSERT INTO ${schema}.architecture_docs
    (doc_id, title, content, file_path, file_hash, category, quality_score, embedding)
    VALUES ($1, $2, $3, $4, $5, $6, $7, ruvector_embed(LEFT($2 || ' ' || $3, 1500))::real[])
    RETURNING id
  `, [doc.id || hash.slice(0, 8), doc.title, doc.content, doc.filePath, hash, category, quality]);

  return { status: 'inserted', id: result.rows[0].id };
}

async function ingestDirectory(pool, schema, dirPath) {
  const stats = { inserted: 0, updated: 0, duplicate: 0 };

  function walkDir(dir) {
    const files = fs.readdirSync(dir);
    const results = [];
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        results.push(...walkDir(filePath));
      } else if (/\.(md|txt|js|ts|py|rs|go)$/.test(file)) {
        results.push(filePath);
      }
    }
    return results;
  }

  const files = walkDir(dirPath);
  console.log(`📁 Found ${files.length} files to ingest`);

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const content = fs.readFileSync(filePath, 'utf-8');
    const title = path.basename(filePath, path.extname(filePath));

    const result = await ingestDocument(pool, schema, {
      title,
      content,
      filePath: filePath.replace(dirPath, '')
    });

    stats[result.status]++;
    process.stdout.write(`\r   Progress: ${i + 1}/${files.length} | Inserted: ${stats.inserted} | Duplicates: ${stats.duplicate}`);
  }

  console.log('\n');
  return stats;
}

async function main() {
  const args = process.argv.slice(2);
  const sourceIdx = args.indexOf('--source');
  const schemaIdx = args.indexOf('--schema');

  if (sourceIdx === -1 || schemaIdx === -1) {
    console.log('Usage: node kb-ingest-template.js --source ./docs --schema my_project');
    process.exit(1);
  }

  const source = args[sourceIdx + 1];
  const schema = args[schemaIdx + 1];

  console.log('═'.repeat(60));
  console.log('📚 KB OPTIMIZED INGESTION');
  console.log(`   Source: ${source}`);
  console.log(`   Schema: ${schema}`);
  console.log('═'.repeat(60));

  const pool = new Pool(CONFIG.pg);

  try {
    await createSchema(pool, schema);
    const stats = await ingestDirectory(pool, schema, source);

    // Final report
    const count = await pool.query(`SELECT COUNT(*) FROM ${schema}.kb`);

    console.log('═'.repeat(60));
    console.log('✅ INGESTION COMPLETE');
    console.log(`   Inserted: ${stats.inserted}`);
    console.log(`   Updated: ${stats.updated}`);
    console.log(`   Duplicates skipped: ${stats.duplicate}`);
    console.log(`   High-quality entries in view: ${count.rows[0].count}`);
    console.log('═'.repeat(60));

  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
