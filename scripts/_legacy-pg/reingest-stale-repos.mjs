#!/usr/bin/env node
/**
 * Re-ingest Stale GitHub Repos v1.0
 *
 * Targeted re-ingestion of repos that have been updated since the KB snapshot.
 * Uses ONNX embeddings (not hash fallback), overlapping chunks, and
 * upsert (ON CONFLICT) to safely update existing entries.
 *
 * Process:
 * 1. Clone/pull the 3 stale repos (ruflo, ruvector, agentic-flow)
 * 2. Find all markdown/text/rst files
 * 3. Chunk with overlap (800 chars, 100 char overlap)
 * 4. ONNX embed in batches of 100
 * 5. Upsert into ask_ruvnet.architecture_docs
 * 6. Delete orphaned entries (files that no longer exist)
 *
 * Usage: node scripts/reingest-stale-repos.mjs [--dry-run] [--repo <name>]
 */
import fs from 'fs/promises';
import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import crypto from 'crypto';
import pg from 'pg';

const DRY_RUN = process.argv.includes('--dry-run');
const SINGLE_REPO = process.argv.includes('--repo')
  ? process.argv[process.argv.indexOf('--repo') + 1]
  : null;

const SCHEMA = 'ask_ruvnet';
const TABLE = 'architecture_docs';
const TEMP_DIR = '/tmp/ruvnet-repos';
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;
const ONNX_BATCH = 100;
const DB_BATCH = 200;

// Repos to re-ingest (verified stale via GitHub API)
const STALE_REPOS = SINGLE_REPO
  ? [SINGLE_REPO]
  : ['ruflo', 'ruvector', 'agentic-flow'];

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
}

// --- Chunking with overlap ---
function chunkText(text, maxSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  const paragraphs = text.split(/\n\n+/);
  let current = '';

  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length > maxSize && current.length > 50) {
      chunks.push(current.trim());
      // Overlap: keep last `overlap` chars as prefix for next chunk
      const overlapText = current.slice(-overlap);
      current = overlapText + '\n\n' + para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }
  if (current.trim().length > 30) chunks.push(current.trim());
  return chunks;
}

function md5(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

// --- File discovery ---
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '__pycache__',
  'venv', '.venv', '.next', '.cache', 'target', '.tox', '.mypy_cache'
]);

function findFiles(dir, files = []) {
  if (!existsSync(dir)) return files;
  const items = readdirSync(dir);
  for (const item of items) {
    if (SKIP_DIRS.has(item)) continue;
    const fullPath = path.join(dir, item);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        findFiles(fullPath, files);
      } else if (stat.isFile() && /\.(md|txt|rst)$/i.test(item) && stat.size < 500_000) {
        files.push(fullPath);
      }
    } catch {}
  }
  return files;
}

// --- Git operations ---
function cloneOrPull(repoName) {
  const repoPath = path.join(TEMP_DIR, repoName);
  const repoUrl = `https://github.com/ruvnet/${repoName}.git`;

  if (existsSync(path.join(repoPath, '.git'))) {
    console.log(`  Pulling latest for ${repoName}...`);
    const result = spawnSync('git', ['pull', '--quiet'], {
      cwd: repoPath, timeout: 120000, encoding: 'utf-8'
    });
    if (result.status === 0) {
      // Also fetch latest commit info
      const logResult = spawnSync('git', ['log', '-1', '--format=%H %ai'], {
        cwd: repoPath, timeout: 10000, encoding: 'utf-8'
      });
      if (logResult.stdout) console.log(`  Latest: ${logResult.stdout.trim()}`);
      return repoPath;
    }
    // Pull failed, nuke and re-clone
    console.log(`  Pull failed, re-cloning...`);
    spawnSync('rm', ['-rf', repoPath], { timeout: 30000 });
  }

  console.log(`  Cloning ${repoName}...`);
  try {
    execFileSync('git', ['clone', '--depth', '1', '--quiet', repoUrl, repoPath], {
      timeout: 180000
    });
    return repoPath;
  } catch (e) {
    console.error(`  Failed to clone ${repoName}: ${e.message}`);
    return null;
  }
}

// --- Category detection ---
function detectCategory(repoName, content) {
  const text = content.toLowerCase();
  if (repoName === 'ruflo') {
    if (/swarm|hive|queen|worker|mesh/i.test(text)) return 'swarms';
    if (/neural|sona|ewc|moe|pattern/i.test(text)) return 'neural';
    if (/hnsw|vector|embed|ruvector/i.test(text)) return 'vector-db';
    if (/mcp|server|tool|transport/i.test(text)) return 'mcp';
    if (/security|cve|audit|injection/i.test(text)) return 'security';
    if (/sparc|specification|pseudocode|architecture|refinement/i.test(text)) return 'sparc';
    if (/memory|agentdb|persist|cache/i.test(text)) return 'memory';
    if (/performance|benchmark|profile|optimize/i.test(text)) return 'performance';
    if (/github|pr|issue|workflow|release/i.test(text)) return 'github';
    if (/deploy|docker|cloud|railway/i.test(text)) return 'deployment';
    return 'agents';
  }
  if (repoName === 'ruvector') {
    if (/hnsw|index|graph/i.test(text)) return 'vector-db';
    if (/neural|gnn|layer/i.test(text)) return 'neural';
    if (/wasm|npm|browser/i.test(text)) return 'vector-db';
    return 'vector-db';
  }
  if (repoName === 'agentic-flow') {
    if (/agent|spawn|orchestrat/i.test(text)) return 'agents';
    if (/vector|embed/i.test(text)) return 'vector-db';
    if (/neural|ml/i.test(text)) return 'neural';
    return 'agents';
  }
  return 'general';
}

function detectTopics(repoName, content) {
  const topics = ['github-repo', repoName];
  const text = content.toLowerCase();
  if (/agent|swarm|orchestrat/i.test(text)) topics.push('agents');
  if (/vector|embed|hnsw/i.test(text)) topics.push('vectors');
  if (/neural|ml|ai|model/i.test(text)) topics.push('ai');
  if (/api|endpoint|rest|graphql/i.test(text)) topics.push('api');
  if (/docker|deploy|cloud|railway/i.test(text)) topics.push('deployment');
  if (/mcp|server|tool/i.test(text)) topics.push('mcp');
  if (/security|auth|cve/i.test(text)) topics.push('security');
  if (/test|spec|coverage/i.test(text)) topics.push('testing');
  return topics;
}

// --- Main ---
async function main() {
  console.log(`=== Re-ingest Stale Repos v1.0 ${DRY_RUN ? '(DRY RUN)' : ''} ===`);
  console.log(`Repos: ${STALE_REPOS.join(', ')}`);
  console.log(`Chunk: ${CHUNK_SIZE} chars, ${CHUNK_OVERLAP} overlap`);
  console.log(`Embedding: ONNX (Xenova/all-MiniLM-L6-v2, 384-dim)\n`);

  // Ensure temp dir exists
  if (!existsSync(TEMP_DIR)) {
    await fs.mkdir(TEMP_DIR, { recursive: true });
  }

  // Init ONNX
  if (!DRY_RUN) {
    console.log('Loading ONNX model...');
    await initOnnx();
    console.log('ONNX ready.\n');
  }

  const globalStart = Date.now();
  let globalChunks = 0;
  let globalFiles = 0;
  let globalDeleted = 0;

  for (const repoName of STALE_REPOS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${repoName}`);
    console.log(`${'='.repeat(60)}`);

    // 1. Clone/pull
    const repoPath = cloneOrPull(repoName);
    if (!repoPath) continue;

    // 2. Find files
    const files = findFiles(repoPath);
    console.log(`  Found ${files.length} markdown/text files`);
    if (files.length === 0) continue;

    // 3. Track which doc_ids we create (for orphan cleanup)
    const liveDocIds = new Set();

    // 4. Process each file: chunk → embed → upsert
    let repoChunks = 0;
    let repoFiles = 0;

    // Collect all chunks first for batch embedding
    const allChunks = [];

    for (const filePath of files) {
      const content = readFileSync(filePath, 'utf-8');
      if (content.trim().length < 50) continue;

      const hash = md5(content);
      const pathHash = hash.substring(0, 8);
      const chunks = chunkText(content);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const docId = `github-${repoName}-${pathHash}-${i}`;
        const titleMatch = chunk.match(/^#\s+(.+)/m) || chunk.match(/^(.{1,80})/);
        const title = titleMatch ? titleMatch[1].trim() : path.basename(filePath);
        const category = detectCategory(repoName, chunk);
        const topics = detectTopics(repoName, chunk);

        allChunks.push({
          docId, title, content: chunk, filePath,
          sectionIndex: i, fileHash: hash,
          repoName, category, topics
        });
        liveDocIds.add(docId);
      }
      repoFiles++;
    }

    console.log(`  ${repoFiles} files → ${allChunks.length} chunks`);

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would upsert ${allChunks.length} chunks`);
      globalChunks += allChunks.length;
      globalFiles += repoFiles;
      continue;
    }

    // 5. Embed in batches
    console.log(`  Embedding ${allChunks.length} chunks...`);
    const embedStart = Date.now();
    const embeddings = [];

    for (let i = 0; i < allChunks.length; i += ONNX_BATCH) {
      const batch = allChunks.slice(i, i + ONNX_BATCH);
      const texts = batch.map(c => (c.title + '\n' + c.content).slice(0, 2000));
      const result = await svc.embedBatch(texts);
      for (const item of result.embeddings) {
        embeddings.push(item.embedding || item);
      }
      if ((i + ONNX_BATCH) % 500 === 0 || i + ONNX_BATCH >= allChunks.length) {
        const done = Math.min(i + ONNX_BATCH, allChunks.length);
        console.log(`    Embedded ${done}/${allChunks.length}`);
      }
    }
    const embedTime = ((Date.now() - embedStart) / 1000).toFixed(1);
    console.log(`  Embedding done in ${embedTime}s`);

    // 6. Upsert in batches
    console.log(`  Upserting to DB...`);
    let upserted = 0;
    let errors = 0;

    for (let i = 0; i < allChunks.length; i += DB_BATCH) {
      const batch = allChunks.slice(i, i + DB_BATCH);

      for (let j = 0; j < batch.length; j++) {
        const c = batch[j];
        const vec = embeddings[i + j];
        if (!vec || vec.length !== 384) { errors++; continue; }

        const vecStr = '[' + Array.from(vec).join(',') + ']';

        try {
          await pool.query(`
            INSERT INTO ${SCHEMA}.${TABLE}
            (doc_id, title, content, file_path, section_index, file_hash,
             package_name, package_version, doc_type, category, topics,
             embedding, quality_score, is_duplicate)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                    $12::ruvector(384), 85, false)
            ON CONFLICT (doc_id) DO UPDATE SET
              title = EXCLUDED.title,
              content = EXCLUDED.content,
              file_path = EXCLUDED.file_path,
              file_hash = EXCLUDED.file_hash,
              category = EXCLUDED.category,
              topics = EXCLUDED.topics,
              embedding = EXCLUDED.embedding,
              updated_at = NOW()
          `, [
            c.docId, c.title, c.content, c.filePath, c.sectionIndex, c.fileHash,
            c.repoName, 'github', 'github-repository', c.category, c.topics,
            vecStr
          ]);
          upserted++;
        } catch (err) {
          errors++;
          if (errors <= 3) console.error(`    Error: ${err.message.slice(0, 100)}`);
        }
      }

      const done = Math.min(i + DB_BATCH, allChunks.length);
      const rate = Math.round(upserted / ((Date.now() - embedStart) / 1000));
      console.log(`    Upserted ${upserted}/${done} (${errors} errors, ${rate}/sec)`);
    }

    // 7. Delete orphaned entries (old file paths no longer in repo)
    const oldRes = await pool.query(`
      SELECT doc_id FROM ${SCHEMA}.${TABLE}
      WHERE doc_type = 'github-repository'
        AND package_name = $1
        AND doc_id NOT IN (${[...liveDocIds].map((_, i) => `$${i + 2}`).join(',')})
    `, [repoName, ...liveDocIds]);

    const orphanCount = oldRes.rows.length;
    if (orphanCount > 0) {
      const orphanIds = oldRes.rows.map(r => r.doc_id);
      // Delete in batches of 500
      for (let i = 0; i < orphanIds.length; i += 500) {
        const batch = orphanIds.slice(i, i + 500);
        await pool.query(
          `DELETE FROM ${SCHEMA}.${TABLE} WHERE doc_id = ANY($1)`,
          [batch]
        );
      }
      console.log(`  Deleted ${orphanCount} orphaned entries`);
      globalDeleted += orphanCount;
    }

    console.log(`  ✓ ${repoName}: ${upserted} upserted, ${orphanCount} deleted, ${errors} errors`);
    repoChunks = upserted;
    globalChunks += repoChunks;
    globalFiles += repoFiles;
  }

  // Final stats
  const totalTime = ((Date.now() - globalStart) / 1000).toFixed(1);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  COMPLETE`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Files processed: ${globalFiles}`);
  console.log(`  Chunks upserted: ${globalChunks}`);
  console.log(`  Orphans deleted: ${globalDeleted}`);
  console.log(`  Time: ${totalTime}s`);

  if (!DRY_RUN) {
    const countRes = await pool.query(`
      SELECT doc_type, COUNT(*) as cnt
      FROM ${SCHEMA}.${TABLE}
      GROUP BY doc_type ORDER BY cnt DESC
    `);
    console.log('\n  KB by doc_type:');
    for (const row of countRes.rows) {
      console.log(`    ${(row.doc_type || 'unknown').padEnd(25)} ${row.cnt}`);
    }
  }

  await pool.end();
}

main().catch(e => {
  console.error('Fatal:', e.message);
  pool.end().catch(() => {});
  process.exit(1);
});
