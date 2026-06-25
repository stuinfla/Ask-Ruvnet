#!/usr/bin/env node
/**
 * build-lean-rvf.mjs — Build production RVF from kb-master.json
 *
 * Reads the flat-file master KB (no PostgreSQL needed) and produces:
 *   .ruvector/knowledge-base/  — vectors.bin + metadata.json + manifest.json
 *   content-sidecar.json.gz    — text content keyed by ID (runtime lookup)
 *   knowledge.rvf              — HNSW-indexed RVF container (with embedded payloads)
 *
 * Usage: node scripts/build-lean-rvf.mjs
 */

import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const DIMENSIONS = 384;
const BYTES_PER_VECTOR = DIMENSIONS * 4;
const MASTER_PATH = path.join(ROOT, 'kb-master.json');

console.log('=== RVF Build (from kb-master.json) ===\n');

// ── Step 1: Read kb-master.json ─────────────────────────────────────
console.log('[1/4] Reading kb-master.json...');

if (!fs.existsSync(MASTER_PATH)) {
  console.error('❌ kb-master.json not found. It is the source of truth — restore it from the repo root.');
  process.exit(1);
}

const master = JSON.parse(fs.readFileSync(MASTER_PATH, 'utf8'));
const entries = master.entries.filter(e => e.embedding && e.embedding.length === DIMENSIONS);
console.log(`      Found ${entries.length} entries with embeddings (of ${master.entryCount} total)`);

// ── Step 2: Write .ruvector/ binary format ──────────────────────────
console.log('[2/4] Writing .ruvector/ binary format...');

const outDir = path.join(ROOT, '.ruvector', 'knowledge-base');
fs.mkdirSync(outDir, { recursive: true });

const vectorsBuf = Buffer.alloc(entries.length * BYTES_PER_VECTOR);
const idIndex = {};
const sidecar = {};

let written = 0;
for (const entry of entries) {
  const emb = new Float32Array(entry.embedding);
  const id = entry.id;
  const offset = written * BYTES_PER_VECTOR;
  Buffer.from(emb.buffer).copy(vectorsBuf, offset);

  idIndex[written] = id;
  sidecar[id] = {
    title: entry.title,
    content: entry.content,
    category: entry.category,
    quality_score: entry.quality_score,
    is_curated: true,
    source: 'kb-master',
    knowledge_type: 'teaching',
  };
  written++;
}

const finalVectors = vectorsBuf.subarray(0, written * BYTES_PER_VECTOR);

fs.writeFileSync(path.join(outDir, 'vectors.bin'), finalVectors);
console.log(`      vectors.bin: ${(finalVectors.length / 1024).toFixed(0)} KB (${written} vectors)`);

const metadata = { idIndex, metadataIndex: {} };
for (const [idx, id] of Object.entries(idIndex)) {
  metadata.metadataIndex[idx] = sidecar[id];
}
fs.writeFileSync(path.join(outDir, 'metadata.json'), JSON.stringify(metadata));
console.log(`      metadata.json written`);

const manifest = {
  vectorCount: written,
  dimensions: DIMENSIONS,
  distanceMetric: 'Cosine',
  createdAt: new Date().toISOString(),
  source: 'kb-master.json',
};
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`      manifest.json: ${written} vectors, ${DIMENSIONS}D`);

// ── Step 3: Write content-sidecar.json.gz ───────────────────────────
console.log('[3/4] Writing content-sidecar.json.gz...');
const sidecarJson = JSON.stringify(sidecar);
const sidecarGz = zlib.gzipSync(Buffer.from(sidecarJson), { level: 9 });
fs.writeFileSync(path.join(ROOT, 'content-sidecar.json.gz'), sidecarGz);
console.log(`      content-sidecar.json.gz: ${(sidecarGz.length / 1024).toFixed(0)} KB (${written} entries)`);

// ── Step 4: Convert to RVF ──────────────────────────────────────────
console.log('[4/4] Converting to knowledge.rvf...');

try {
  const { RvfDatabase } = await import('@ruvector/rvf');
  const rvfPath = path.join(ROOT, 'knowledge.rvf');

  if (fs.existsSync(rvfPath)) fs.unlinkSync(rvfPath);

  const db = await RvfDatabase.create(rvfPath, {
    dimensions: DIMENSIONS,
    metric: 'cosine',
  });

  const encoder = new TextEncoder();
  const BATCH = 100;
  for (let i = 0; i < written; i += BATCH) {
    const end = Math.min(i + BATCH, written);
    const batch = [];
    for (let j = i; j < end; j++) {
      const id = idIndex[j];
      const vecStart = j * BYTES_PER_VECTOR;
      const vec = new Float32Array(finalVectors.buffer, finalVectors.byteOffset + vecStart, DIMENSIONS);
      const payload = encoder.encode(JSON.stringify(sidecar[id]));
      batch.push({ id, vector: Array.from(vec), payload });
    }
    await db.ingestBatch(batch);
  }

  const fid = await db.fileId();
  console.log(`      File ID: ${fid}`);
  console.log(`      Lineage depth: ${await db.lineageDepth()}`);

  await db.close();

  const rvfSize = fs.statSync(rvfPath).size;
  console.log(`      knowledge.rvf: ${(rvfSize / 1024 / 1024).toFixed(1)} MB`);
} catch (err) {
  console.error(`      RVF conversion failed: ${err.message}`);
}

// ── Summary ─────────────────────────────────────────────────────────
const rvfSize = fs.existsSync(path.join(ROOT, 'knowledge.rvf'))
  ? fs.statSync(path.join(ROOT, 'knowledge.rvf')).size : 0;

console.log('\n=== RVF Build Complete ===');
console.log(`  Source:            kb-master.json (no PostgreSQL)`);
console.log(`  Gold entries:      ${written}`);
console.log(`  Vectors:           ${(finalVectors.length / 1024).toFixed(0)} KB`);
console.log(`  Content sidecar:   ${(sidecarGz.length / 1024).toFixed(0)} KB (gzipped)`);
console.log(`  knowledge.rvf:     ${rvfSize > 0 ? (rvfSize / 1024 / 1024).toFixed(1) + ' MB' : 'not built'}`);
