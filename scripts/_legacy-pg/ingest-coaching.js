#!/usr/bin/env node
/**
 * Ingest Ruv Coaching content to KB
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  host: 'localhost',
  port: 5435,
  user: 'postgres',
  password: process.env.RUVECTOR_PASSWORD || '',
  database: 'postgres'
});

const SCHEMA = 'ask_ruvnet';

// Try to load ONNX embedder
let embedder = null;
try {
  const ruvector = require('ruvector');
  if (ruvector.embeddingService) embedder = ruvector.embeddingService;
} catch {}

function hashToVector(text, dim = 384) {
  const vector = new Float32Array(dim);
  for (let i = 0; i < text.length; i++) {
    vector[i % dim] = (vector[i % dim] * 31 + text.charCodeAt(i)) % 1000 / 1000;
  }
  let mag = 0;
  for (let i = 0; i < dim; i++) mag += vector[i] * vector[i];
  mag = Math.sqrt(mag) || 1;
  for (let i = 0; i < dim; i++) vector[i] /= mag;
  return Array.from(vector);
}

async function getEmbedding(text) {
  if (embedder && embedder.embed) {
    try { return await embedder.embed(text); } catch {}
  }
  return hashToVector(text, 384);
}

function getHash(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

function chunkText(text, maxSize = 600) {
  const chunks = [];
  const paragraphs = text.split(/\n\n+/);
  let current = '';
  for (const para of paragraphs) {
    if ((current + para).length > maxSize && current) {
      chunks.push(current.trim());
      current = para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function ingestFile(filePath, docType) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const filename = path.basename(filePath);
  const hash = getHash(content);
  
  await pool.query(`DELETE FROM ${SCHEMA}.architecture_docs WHERE file_path = $1`, [filePath]);
  
  const chunks = chunkText(content, 600);
  let ingested = 0;
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const pathHash = hash.substring(0, 8);
    const docId = `coaching-${pathHash}-${i}`;
    const titleMatch = chunk.match(/^(.{1,80})/);
    const title = titleMatch ? titleMatch[1].trim() : filename;
    
    const embedding = await getEmbedding(chunk);
    
    await pool.query(`
      INSERT INTO ${SCHEMA}.architecture_docs
      (doc_id, title, content, file_path, section_index, file_hash, package_name, package_version, doc_type, topics, embedding)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (doc_id) DO UPDATE SET content = $3, embedding = $11, updated_at = NOW()
    `, [
      docId, title, chunk, filePath, i, hash,
      'ruv-coaching', '2026-01-01', docType,
      ['ruv-coaching', 'knowledge-base', 'hyperbolic-space', 'federated-learning', 'financial-ai', 'edge-computing', 'zk-proofs'],
      embedding
    ]);
    ingested++;
  }
  
  console.log('Ingested:', filename, '(' + ingested + ' chunks)');
  return ingested;
}

async function main() {
  console.log('=== INGESTING RUV COACHING DATA ===\n');
  
  const basePath = './data_ingestion_ruv_coaching/Ruv Coaching/2026-01-01 Ruv Coaching';
  
  let total = 0;
  total += await ingestFile(basePath + '/Ruv Vibecast Summary.txt', 'coaching-summary');
  total += await ingestFile(basePath + '/Ruv Vibecast Transcript (1).txt', 'coaching-transcript');
  
  console.log('\nTotal coaching chunks ingested:', total);
  await pool.end();
}

main().catch(e => { console.error('Error:', e.message); pool.end(); process.exit(1); });
