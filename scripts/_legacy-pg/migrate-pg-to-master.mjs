#!/usr/bin/env node
/**
 * migrate-pg-to-master.mjs — One-time export from PostgreSQL → kb-master.json
 *
 * Exports all gold entries from kb_complete WITH their embeddings into a single
 * flat JSON file that becomes the new source of truth. After this, PostgreSQL
 * is no longer needed for the Ask-RuvNet KB pipeline.
 *
 * Usage: node scripts/migrate-pg-to-master.mjs
 */

import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MASTER_PATH = path.join(ROOT, 'kb-master.json');
const DIMENSIONS = 384;

const pool = new pg.Pool({
  host: 'localhost', port: 5435, user: 'postgres', database: 'postgres',
  max: 2, idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000,
});

console.log('=== PostgreSQL → kb-master.json Migration ===\n');

const { rows } = await pool.query(`
  SELECT id, title, content, category, quality_score, file_path, embedding::text,
         created_at, updated_at
  FROM ask_ruvnet.kb_complete
  WHERE embedding IS NOT NULL
  ORDER BY id
`);
await pool.end();

console.log(`Exported ${rows.length} entries from PostgreSQL`);

function parseEmbedding(str) {
  if (!str) return null;
  const vals = str.replace(/^\[/, '').replace(/\]$/, '').split(',').map(Number);
  if (vals.some(isNaN) || vals.length !== DIMENSIONS) return null;
  return vals;
}

const master = {
  version: '1.0.0',
  format: 'ask-ruvnet-kb-master',
  dimensions: DIMENSIONS,
  distanceMetric: 'cosine',
  migratedFrom: 'postgresql:ask_ruvnet.kb_complete',
  migratedAt: new Date().toISOString(),
  entryCount: 0,
  entries: [],
};

let skipped = 0;
for (const row of rows) {
  const embedding = parseEmbedding(row.embedding);
  if (!embedding) {
    console.warn(`  Skipping id=${row.id} — invalid embedding`);
    skipped++;
    continue;
  }

  master.entries.push({
    id: `kb_${row.id}`,
    title: row.title,
    content: row.content,
    category: row.category,
    quality_score: row.quality_score,
    file_path: row.file_path,
    embedding: embedding,
    created_at: row.created_at?.toISOString() || null,
    updated_at: row.updated_at?.toISOString() || null,
  });
}

master.entryCount = master.entries.length;

fs.writeFileSync(MASTER_PATH, JSON.stringify(master, null, 2));

const sizeKB = (fs.statSync(MASTER_PATH).size / 1024).toFixed(0);
console.log(`\nWritten: ${MASTER_PATH}`);
console.log(`  Entries: ${master.entryCount}`);
console.log(`  Skipped: ${skipped}`);
console.log(`  Size: ${sizeKB} KB`);
console.log(`\n✅ Migration complete. PostgreSQL is no longer needed for KB builds.`);
