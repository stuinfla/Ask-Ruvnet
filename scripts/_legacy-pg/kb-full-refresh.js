#!/usr/bin/env node
/**
 * KB Full Refresh - Comprehensive RuvNet Knowledge Base Refresh
 *
 * This script makes Ask-Ruvnet the AUTHORITATIVE knowledge base for:
 * - All RuvNet packages (agentic-flow, ruflo, ruflo legacy, ruv-swarm, ruvector, etc.)
 * - All RuvNet architecture patterns
 * - All agent types, swarm topologies, consensus protocols
 * - Cross-repo accessible via PostgreSQL
 *
 * Storage: PostgreSQL (ruvector-kb:5435) - optimized for:
 * - 384-dimensional ONNX embeddings (all-MiniLM-L6-v2)
 * - HNSW indexing for <1.2ms semantic search
 * - Cross-session persistence
 * - Multi-repo access via schema isolation
 *
 * Usage:
 *   node scripts/kb-full-refresh.js                    # Full refresh
 *   node scripts/kb-full-refresh.js --packages-only    # Just npm packages
 *   node scripts/kb-full-refresh.js --docs-only        # Just local docs
 *   node scripts/kb-full-refresh.js --status           # Show KB status
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// PostgreSQL connection (ruvector-kb container)
const pool = new Pool({
  host: 'localhost',
  port: 5435,
  user: 'postgres',
  password: process.env.RUVECTOR_PASSWORD || '',
  database: 'postgres'
});

// Schema for this project
const SCHEMA = 'ask_ruvnet';

// RuvNet packages to ingest
const RUVNET_PACKAGES = [
  'agentic-flow',
  'ruflo',
  'ruflo',
  'ruv-swarm',
  'ruvector',
  '@ruvector/ruvllm',
  '@ruvector/agentic-synth'
];

// Documentation sources
const DOC_SOURCES = [
  './docs',
  './node_modules/agentic-flow',
  './node_modules/ruflo',
  './node_modules/ruflo',
  './node_modules/ruv-swarm',
  './node_modules/ruvector'
];

// Try to load ONNX embedder
let embedder = null;
try {
  const ruvector = require('ruvector');
  if (ruvector.embeddingService) {
    embedder = ruvector.embeddingService;
  } else if (ruvector.ONNXEmbedder) {
    embedder = new ruvector.ONNXEmbedder();
  }
} catch (e) {
  console.log('Warning: ruvector embedder not available');
}

// Parse arguments
const args = process.argv.slice(2);
const flags = {
  packagesOnly: args.includes('--packages-only'),
  docsOnly: args.includes('--docs-only'),
  status: args.includes('--status'),
  force: args.includes('--force'),
  verbose: args.includes('--verbose') || args.includes('-v')
};

/**
 * Generate embedding for text using ONNX (384d)
 */
async function generateEmbedding(text) {
  if (!embedder) {
    // Fallback: hash-based embedding (not semantic, but consistent)
    return hashToVector(text, 384);
  }

  try {
    if (embedder.embed) {
      return await embedder.embed(text);
    } else if (embedder.encode) {
      return await embedder.encode(text);
    }
  } catch (e) {
    console.warn('Embedding failed, using hash fallback');
    return hashToVector(text, 384);
  }
}

/**
 * Hash-based vector (fallback)
 */
function hashToVector(text, dim = 384) {
  const vector = new Float32Array(dim);
  for (let i = 0; i < text.length; i++) {
    const idx = i % dim;
    vector[idx] = (vector[idx] * 31 + text.charCodeAt(i)) % 1000 / 1000;
  }
  // Normalize
  let mag = 0;
  for (let i = 0; i < dim; i++) mag += vector[i] * vector[i];
  mag = Math.sqrt(mag) || 1;
  for (let i = 0; i < dim; i++) vector[i] /= mag;
  return Array.from(vector);
}

/**
 * Chunk text for embedding
 */
function chunkText(text, maxSize = 500) {
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

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

/**
 * Get MD5 hash for file change detection
 */
function getFileHash(content) {
  const crypto = require('crypto');
  return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Ensure schema and tables exist
 */
async function ensureSchema() {
  const client = await pool.connect();
  try {
    // Create schema
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);

    // Create architecture_docs table with proper structure
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.architecture_docs (
        id SERIAL PRIMARY KEY,
        doc_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        file_path TEXT NOT NULL,
        section_header TEXT,
        section_index INTEGER DEFAULT 0,
        file_hash TEXT NOT NULL,
        package_name TEXT,
        package_version TEXT,
        doc_type TEXT DEFAULT 'documentation',
        topics TEXT[],
        embedding real[],
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create indexes for fast search
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_${SCHEMA}_embedding
      ON ${SCHEMA}.architecture_docs USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
    `).catch(() => {
      // IVFFlat might not be available, try btree
      return client.query(`
        CREATE INDEX IF NOT EXISTS idx_${SCHEMA}_file_path
        ON ${SCHEMA}.architecture_docs (file_path)
      `);
    });

    // Create file tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.file_tracking (
        id SERIAL PRIMARY KEY,
        file_path TEXT NOT NULL UNIQUE,
        file_hash TEXT NOT NULL,
        last_ingested TIMESTAMP DEFAULT NOW(),
        chunk_count INTEGER DEFAULT 0
      )
    `);

    console.log(`Schema ${SCHEMA} initialized`);
  } finally {
    client.release();
  }
}

/**
 * Check if file needs re-ingestion
 */
async function needsReingestion(filePath, hash) {
  if (flags.force) return true;

  const result = await pool.query(
    `SELECT file_hash FROM ${SCHEMA}.file_tracking WHERE file_path = $1`,
    [filePath]
  );

  return result.rows.length === 0 || result.rows[0].file_hash !== hash;
}

/**
 * Update file tracking
 */
async function updateFileTracking(filePath, hash, chunkCount) {
  await pool.query(`
    INSERT INTO ${SCHEMA}.file_tracking (file_path, file_hash, last_ingested, chunk_count)
    VALUES ($1, $2, NOW(), $3)
    ON CONFLICT (file_path) DO UPDATE
    SET file_hash = $2, last_ingested = NOW(), chunk_count = $3
  `, [filePath, hash, chunkCount]);
}

/**
 * Ingest a single document
 */
async function ingestDocument(filePath, options = {}) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const hash = getFileHash(content);
  const filename = path.basename(filePath);

  // Skip if unchanged
  if (!await needsReingestion(filePath, hash)) {
    if (flags.verbose) console.log(`  Skipping (unchanged): ${filename}`);
    return { skipped: true };
  }

  // Delete old entries for this file
  await pool.query(
    `DELETE FROM ${SCHEMA}.architecture_docs WHERE file_path = $1`,
    [filePath]
  );

  // Chunk and embed
  const chunks = chunkText(content);
  let ingested = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    // Make doc_id unique by including file path hash and package name
    const pathHash = getFileHash(filePath).substring(0, 8);
    const pkgPrefix = options.packageName ? `${options.packageName}-` : '';
    const docId = `${pkgPrefix}${pathHash}-${filename}-${i}`;

    // Extract title from first line or header
    const titleMatch = chunk.match(/^#\s+(.+)/m) || chunk.match(/^(.{1,50})/);
    const title = titleMatch ? titleMatch[1].trim() : filename;

    // Generate embedding
    const embedding = await generateEmbedding(chunk);

    // Insert into Postgres
    await pool.query(`
      INSERT INTO ${SCHEMA}.architecture_docs
      (doc_id, title, content, file_path, section_index, file_hash, package_name, package_version, doc_type, embedding)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      docId,
      title,
      chunk,
      filePath,
      i,
      hash,
      options.packageName || null,
      options.packageVersion || null,
      options.docType || 'documentation',
      embedding
    ]);

    ingested++;
  }

  // Update tracking
  await updateFileTracking(filePath, hash, ingested);

  if (flags.verbose) {
    console.log(`  Ingested: ${filename} (${ingested} chunks)`);
  }

  return { ingested };
}

/**
 * Ingest all docs from a directory
 */
async function ingestDirectory(dir, options = {}) {
  if (!fs.existsSync(dir)) {
    console.log(`  Directory not found: ${dir}`);
    return { total: 0, ingested: 0 };
  }

  const files = [];
  const extensions = new Set(['.md', '.txt', '.rst', '.json']);

  function findFiles(d) {
    const items = fs.readdirSync(d);
    for (const item of items) {
      const fullPath = path.join(d, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory() && !['node_modules', '.git', 'dist', 'coverage'].includes(item)) {
        findFiles(fullPath);
      } else if (stat.isFile() && extensions.has(path.extname(item).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }

  findFiles(dir);

  let ingested = 0;
  let skipped = 0;

  for (const file of files) {
    const result = await ingestDocument(file, options);
    if (result.skipped) {
      skipped++;
    } else {
      ingested += result.ingested || 0;
    }
  }

  return { total: files.length, ingested, skipped };
}

/**
 * Ingest npm package documentation
 */
async function ingestPackage(packageName) {
  const packagePath = path.join('node_modules', packageName);

  if (!fs.existsSync(packagePath)) {
    console.log(`  Package not installed: ${packageName}`);
    return { total: 0, ingested: 0 };
  }

  // Get package version
  let version = 'unknown';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(packagePath, 'package.json'), 'utf-8'));
    version = pkg.version;
  } catch {}

  console.log(`  ${packageName}@${version}`);

  return await ingestDirectory(packagePath, {
    packageName,
    packageVersion: version,
    docType: 'package-documentation'
  });
}

/**
 * Show KB status
 */
async function showStatus() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  ASK-RUVNET KNOWLEDGE BASE STATUS');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const client = await pool.connect();
  try {
    // Total entries
    const countResult = await client.query(
      `SELECT COUNT(*) as total FROM ${SCHEMA}.architecture_docs`
    );
    console.log(`  Total entries:        ${countResult.rows[0].total}`);

    // By doc_type
    const typeResult = await client.query(`
      SELECT doc_type, COUNT(*) as count
      FROM ${SCHEMA}.architecture_docs
      GROUP BY doc_type
      ORDER BY count DESC
    `);
    console.log('\n  By Type:');
    for (const row of typeResult.rows) {
      console.log(`    ${(row.doc_type || 'unknown').padEnd(25)} ${row.count}`);
    }

    // By package
    const pkgResult = await client.query(`
      SELECT package_name, package_version, COUNT(*) as count
      FROM ${SCHEMA}.architecture_docs
      WHERE package_name IS NOT NULL
      GROUP BY package_name, package_version
      ORDER BY count DESC
    `);
    if (pkgResult.rows.length > 0) {
      console.log('\n  By Package:');
      for (const row of pkgResult.rows) {
        console.log(`    ${row.package_name}@${row.package_version}: ${row.count} entries`);
      }
    }

    // File tracking
    const trackResult = await client.query(
      `SELECT COUNT(*) as files, SUM(chunk_count) as chunks FROM ${SCHEMA}.file_tracking`
    );
    console.log(`\n  Tracked files:        ${trackResult.rows[0].files}`);
    console.log(`  Total chunks:         ${trackResult.rows[0].chunks}`);

    // Embedding status
    const embResult = await client.query(`
      SELECT COUNT(*) as with_embedding
      FROM ${SCHEMA}.architecture_docs
      WHERE embedding IS NOT NULL
    `);
    console.log(`  With embeddings:      ${embResult.rows[0].with_embedding}`);

  } finally {
    client.release();
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════');
}

/**
 * Main refresh process
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  ASK-RUVNET KB FULL REFRESH');
  console.log('  Making this the AUTHORITATIVE RuvNet Knowledge Base');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  if (flags.status) {
    await showStatus();
    await pool.end();
    return;
  }

  // Initialize
  console.log('Initializing...');
  await ensureSchema();

  if (embedder) {
    console.log('  ONNX embedder: ready (384d)');
  } else {
    console.log('  ONNX embedder: not available (using hash fallback)');
  }

  let totalIngested = 0;

  // Ingest npm packages
  if (!flags.docsOnly) {
    console.log('\n--- INGESTING RUVNET PACKAGES ---\n');

    for (const pkg of RUVNET_PACKAGES) {
      const result = await ingestPackage(pkg);
      totalIngested += result.ingested;
    }
  }

  // Ingest local docs
  if (!flags.packagesOnly) {
    console.log('\n--- INGESTING LOCAL DOCUMENTATION ---\n');

    for (const docPath of DOC_SOURCES) {
      if (docPath.startsWith('./docs')) {
        console.log(`  ${docPath}`);
        const result = await ingestDirectory(docPath, { docType: 'project-documentation' });
        totalIngested += result.ingested;
        console.log(`    Files: ${result.total}, Chunks: ${result.ingested}, Skipped: ${result.skipped}`);
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('  REFRESH COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`  New chunks ingested:  ${totalIngested}`);

  // Show final status
  await showStatus();

  await pool.end();
}

main().catch(e => {
  console.error('Error:', e.message);
  pool.end();
  process.exit(1);
});
