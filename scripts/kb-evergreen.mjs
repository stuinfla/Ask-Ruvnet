#!/usr/bin/env node
/**
 * kb-evergreen.mjs — Nightly repo scanner (PG-FREE, v3.0.0)
 *
 * Scans all ruvnet GitHub repos for changes, clones/pulls, chunks content,
 * generates ONNX embeddings, and writes raw chunks to .ruvector/raw/<repo>.ndjson.gz
 *
 * NO PostgreSQL dependency. Flat NDJSON files replace architecture_docs table.
 *
 * LaunchAgent: com.ruvnet.kb-evergreen (4:00 AM daily)
 * Usage: node scripts/kb-evergreen.mjs [--force] [--repo <name>] [--dry-run]
 *
 * Updated: 2026-03-30 | Version 3.0.0 (ADR-001: PG eliminated)
 */

import { execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { preflight, writeHeartbeat } from './lib/preflight.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const RAW_DIR = path.join(ROOT, '.ruvector', 'raw');
const MANIFEST_PATH = path.join(RAW_DIR, 'manifest.json');
const TEMP_DIR = '/tmp/ruvnet-repos';
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;
const ONNX_BATCH = 100;
const MIN_FILE_CHARS = 50;
const MAX_FILE_KB = 500;

const FORCE = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry-run');
const SINGLE_REPO = process.argv.includes('--repo') ? process.argv[process.argv.indexOf('--repo') + 1] : null;

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', 'target', '.next', 'vendor', '.ruvector', 'archive']);
const FILE_EXTS = new Set(['.md', '.txt', '.rst', '.toml']);

let svc = null;
const startTime = Date.now();

function log(msg) { console.log('[' + new Date().toLocaleTimeString() + '] ' + msg); }
function md5(str) { return crypto.createHash('md5').update(str).digest('hex'); }

async function initOnnx() {
  const embPath = path.join(os.homedir(), '.npm-global/lib/node_modules/@claude-flow/cli/node_modules/@claude-flow/embeddings/dist/index.js');
  const mod = await import(embPath);
  svc = await mod.createEmbeddingServiceAsync({ provider: 'transformers', model: 'Xenova/all-MiniLM-L6-v2', dimensions: 384 });
  await svc.embed('warmup');
}

function loadManifest() {
  if (fs.existsSync(MANIFEST_PATH)) return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  return { repos: {}, lastRun: null };
}

function saveManifest(manifest) {
  manifest.lastRun = new Date().toISOString();
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

function findFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { findFiles(full, files); continue; }
    if (!FILE_EXTS.has(path.extname(entry.name).toLowerCase())) continue;
    try { if (fs.statSync(full).size <= MAX_FILE_KB * 1024) files.push(full); } catch {}
  }
  return files;
}

function chunkText(text, maxSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  const paragraphs = text.split(/\n\n+/);
  let current = '';
  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length > maxSize && current.length > 50) {
      chunks.push(current.trim());
      current = current.slice(-overlap) + '\n\n' + para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }
  if (current.trim().length > 30) chunks.push(current.trim());
  return chunks;
}

function detectCategory(text) {
  const lower = text.toLowerCase();
  if (/security|auth|encrypt|vuln/i.test(lower)) return 'security';
  if (/agent|swarm|orchestrat/i.test(lower)) return 'agents';
  if (/vector|hnsw|embed|search/i.test(lower)) return 'vector-db';
  if (/wasm|browser|edge/i.test(lower)) return 'wasm-local-llm';
  if (/neural|attention|learning/i.test(lower)) return 'neural';
  if (/deploy|docker|railway/i.test(lower)) return 'deployment';
  return 'general';
}

function cloneOrPull(repoName) {
  const repoPath = path.join(TEMP_DIR, repoName);
  try {
    // Always do a FRESH shallow clone. 'git pull --ff-only' refuses to reconcile a
    // force-pushed / diverged / renamed-default-branch repo (that was the source of the
    // recurring "Command failed: git pull --ff-only" errors). A fresh --depth 1 clone
    // eliminates that failure class entirely and stays fast (latest snapshot only).
    fs.rmSync(repoPath, { recursive: true, force: true });
    execFileSync('git', ['clone', '--depth', '1', 'https://github.com/ruvnet/' + repoName + '.git', repoPath], { stdio: 'pipe', timeout: 180000 });
    return repoPath;
  } catch (e) {
    log('  Git error for ' + repoName + ': ' + (e.message || '').substring(0, 80));
    return null;
  }
}

async function getStaleRepos(manifest) {
  if (SINGLE_REPO) return [SINGLE_REPO];
  let ghRepos;
  try {
    // Skip empty + archived repos at the source — they have no clonable content and
    // would fail every night. Auto-covers any future empty/archived repo (no blocklist).
    const out = execFileSync('gh', ['repo', 'list', 'ruvnet', '--limit', '300', '--json', 'name,pushedAt,isEmpty,isArchived', '--jq', '.[] | select(.isEmpty == false and .isArchived == false) | [.name, .pushedAt] | @tsv'], { stdio: 'pipe', timeout: 30000 }).toString();
    ghRepos = out.trim().split('\n').filter(Boolean).map(line => {
      const [name, pushedAt] = line.split('\t');
      return { name, pushedAt: new Date(pushedAt) };
    });
  } catch (e) {
    log('ERROR: Could not list repos: ' + e.message);
    return [];
  }
  const stale = [];
  for (const { name, pushedAt } of ghRepos) {
    const entry = manifest.repos[name];
    if (FORCE || !entry || new Date(entry.lastUpdated) < pushedAt) {
      stale.push({ name, pushedAt, daysBehind: entry ? Math.round((pushedAt - new Date(entry.lastUpdated)) / 86400000) : -1 });
    }
  }
  stale.sort((a, b) => (b.daysBehind || 999) - (a.daysBehind || 999));
  log('Found ' + stale.length + ' stale repos out of ' + ghRepos.length + ' total');
  return stale.map(r => r.name);
}

async function ingestRepo(repoName, manifest) {
  const repoPath = cloneOrPull(repoName);
  if (!repoPath) return { chunks: 0, files: 0, errors: 1 };
  const files = findFiles(repoPath);
  if (files.length === 0) { log('  No indexable files in ' + repoName); return { chunks: 0, files: 0, errors: 0 }; }

  const allChunks = [];
  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.length < MIN_FILE_CHARS) continue;
      const relPath = path.relative(repoPath, filePath);
      const fileHash = md5(content).substring(0, 8);
      const chunks = chunkText(content);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (chunk.length < 200) continue;
        const titleMatch = chunk.match(/^#+ (.+)/m);
        const title = titleMatch ? titleMatch[1].trim().substring(0, 120) : chunk.substring(0, 80).trim();
        if (title.length < 10) continue;
        allChunks.push({ docId: 'github-' + repoName + '-' + fileHash + '-' + i, title, content: chunk.startsWith('## ') ? chunk : '## ' + title + '\n\n' + chunk, path: relPath, sectionIndex: i, category: detectCategory(chunk) });
      }
    } catch {}
  }
  if (allChunks.length === 0) { log('  No valid chunks from ' + repoName); return { chunks: 0, files: files.length, errors: 0 }; }

  if (!DRY_RUN && svc) {
    for (let i = 0; i < allChunks.length; i += ONNX_BATCH) {
      const batch = allChunks.slice(i, i + ONNX_BATCH);
      const texts = batch.map(c => (c.title + '\n' + c.content).slice(0, 2000));
      try {
        const result = await svc.embedBatch(texts);
        for (let j = 0; j < batch.length; j++) batch[j].embedding = Array.from(result.embeddings[j].embedding || result.embeddings[j]);
      } catch (e) { log('  Embedding error: ' + e.message); }
      if ((i + ONNX_BATCH) % 1000 === 0) log('    Embedded ' + Math.min(i + ONNX_BATCH, allChunks.length) + '/' + allChunks.length);
    }
  }

  if (!DRY_RUN) {
    fs.mkdirSync(RAW_DIR, { recursive: true });
    const ndjson = allChunks.map(c => JSON.stringify(c)).join('\n');
    fs.writeFileSync(path.join(RAW_DIR, repoName + '.ndjson.gz'), zlib.gzipSync(Buffer.from(ndjson), { level: 6 }));
    manifest.repos[repoName] = { chunkCount: allChunks.length, fileCount: files.length, lastUpdated: new Date().toISOString(), firstSeen: manifest.repos[repoName]?.firstSeen || new Date().toISOString() };
  }

  log('  ' + repoName + ': ' + allChunks.length + ' chunks from ' + files.length + ' files');
  return { chunks: allChunks.length, files: files.length, errors: 0 };
}

async function main() {
  log('==================================================');
  log('KB Evergreen v3.0.0 (PG-FREE)');
  log('==================================================\n');
  preflight({ stage: 'kb-evergreen', requireFiles: [] });
  const manifest = loadManifest();
  const staleRepos = await getStaleRepos(manifest);
  const newRepos = staleRepos.filter(n => !manifest.repos[n]); // repos never ingested before this run
  if (newRepos.length) log('🆕 NEW repos discovered: ' + newRepos.join(', '));
  if (staleRepos.length === 0) { log('All repos up to date.'); writeHeartbeat('kb-evergreen', { status: 'ok', counts: { repos: 0, chunks: 0, errors: 0, newRepos: 0 }, durationMs: Date.now() - startTime }); return; }
  log('Processing ' + staleRepos.length + ' repos...\n');
  if (!fs.existsSync(TEMP_DIR)) await fsp.mkdir(TEMP_DIR, { recursive: true });
  if (!DRY_RUN) { log('Loading ONNX...'); await initOnnx(); log('ONNX ready.\n'); }

  let totalChunks = 0, totalErrors = 0;
  for (const repoName of staleRepos) {
    log('\n--- ' + repoName + ' ---');
    const r = await ingestRepo(repoName, manifest);
    totalChunks += r.chunks; totalErrors += r.errors;
  }

  if (!DRY_RUN) {
    saveManifest(manifest);
    fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
    fs.appendFileSync(path.join(ROOT, 'logs', 'kb-evergreen.jsonl'), JSON.stringify({ timestamp: new Date().toISOString(), repos: staleRepos.length, chunks: totalChunks, errors: totalErrors, newRepos: newRepos.length, newRepoNames: newRepos, sec: Math.round((Date.now() - startTime) / 1000) }) + '\n');
    writeHeartbeat('kb-evergreen', { status: 'ok', counts: { repos: staleRepos.length, chunks: totalChunks, errors: totalErrors, newRepos: newRepos.length, newRepoNames: newRepos }, durationMs: Date.now() - startTime });
  }

  log('\n==================================================');
  log('KB Evergreen Complete — ' + staleRepos.length + ' repos, ' + totalChunks + ' chunks, ' + totalErrors + ' errors, ' + ((Date.now() - startTime) / 1000).toFixed(1) + 's');
  log('==================================================');
}

main().catch(err => {
  log('FATAL: ' + err.message);
  writeHeartbeat('kb-evergreen', { status: 'failed', error: String(err.message) });
  process.exit(1);
});
