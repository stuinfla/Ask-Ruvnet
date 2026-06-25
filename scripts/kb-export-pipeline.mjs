#!/usr/bin/env node
/**
 * kb-export-pipeline.mjs — KB rebuild pipeline (PG-FREE, v3.0.0)
 *
 * Detects when kb-master.json has changed and triggers a multi-stage rebuild:
 *   Stage 1: kb-master.json -> .ruvector/ + knowledge.rvf + sidecar
 *   Stage 2: .ruvector/ -> browser SQ8 assets
 *   Stage 3: .ruvector/ -> MCP KB format (kb-data/)
 *
 * NO PostgreSQL dependency. Reads kb-master.json as sole source of truth.
 *
 * LaunchAgent: ai.openclaw.kb-export (6:00 AM daily)
 * Usage: node scripts/kb-export-pipeline.mjs [--force] [--check]
 *
 * Updated: 2026-03-30 | Version 3.0.0 (ADR-001: PG eliminated)
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { preflight, writeHeartbeat } from './lib/preflight.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MASTER_PATH = path.join(ROOT, 'kb-master.json');
const MANIFEST_PATH = path.join(ROOT, '.ruvector', 'knowledge-base', 'manifest.json');
const LOG_DIR = path.join(ROOT, 'logs');
const LOG_PATH = path.join(LOG_DIR, 'kb-export-pipeline.jsonl');
const NODE_BIN = '/usr/local/bin/node';

const FORCE = process.argv.includes('--force');
const CHECK = process.argv.includes('--check');

function log(msg) { console.log('[' + new Date().toISOString() + '] ' + msg); }

function appendLog(entry) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');
}

function readManifestCount() {
  if (!fs.existsSync(MANIFEST_PATH)) return 0;
  try { return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')).vectorCount || 0; } catch { return 0; }
}

function readMasterCount() {
  if (!fs.existsSync(MASTER_PATH)) { log('ERROR: kb-master.json not found'); process.exit(2); }
  try { return JSON.parse(fs.readFileSync(MASTER_PATH, 'utf8')).entryCount || 0; } catch { return 0; }
}

function runStage(label, scriptName, timeoutMs, extraArgs = []) {
  log('Stage: ' + label + ' -- running ' + scriptName);
  execFileSync(NODE_BIN, [path.join(ROOT, 'scripts', scriptName), ...extraArgs], { cwd: ROOT, stdio: 'inherit', timeout: timeoutMs });
  log('Stage: ' + label + ' -- complete');
}

async function main() {
  const startTime = Date.now();
  log('=== KB Export Pipeline v3.0.0 (PG-FREE) ===');
  preflight({ stage: 'kb-export', requireFiles: ['kb-master.json'] });

  const masterCount = readMasterCount();
  const manifestCount = readManifestCount();

  // Predecessor check: verify kb-master.json is fresh
  const masterStat = fs.statSync(MASTER_PATH);
  const masterHoursAgo = (Date.now() - masterStat.mtimeMs) / 3600000;
  if (masterHoursAgo > 72) log('WARNING: kb-master.json last modified ' + masterHoursAgo.toFixed(0) + 'h ago. Curate may not be running.');

  log('kb-master.json entries: ' + masterCount);
  log('Manifest vectorCount:   ' + manifestCount);

  // Rebuild when counts differ OR kb-master.json is newer than the built manifest
  // (catches in-place content updates that don't change the entry count).
  let masterNewer = false;
  try { masterNewer = masterStat.mtimeMs > fs.statSync(MANIFEST_PATH).mtimeMs; } catch { masterNewer = true; }
  const isStale = masterCount !== manifestCount || masterNewer;

  if (CHECK) {
    log(isStale ? 'STALE: master=' + masterCount + ' vs manifest=' + manifestCount : 'UP TO DATE');
    process.exit(isStale ? 1 : 0);
  }

  if (!FORCE && !isStale) {
    log('Counts match. Use --force to re-export anyway.');
    appendLog({ timestamp: new Date().toISOString(), action: 'skip', masterCount, manifestCount, durationMs: Date.now() - startTime });
    writeHeartbeat('kb-export', { status: 'ok', counts: { masterCount, manifestCount, action: 'skip' }, durationMs: Date.now() - startTime });
    return;
  }

  // Stage 1: kb-master.json -> binary + RVF
  log('Rebuilding from kb-master.json (' + masterCount + ' entries)...');
  runStage('1 (kb-master.json -> RVF)', 'build-lean-rvf.mjs', 300000);

  // Stage 2: binary -> browser assets
  runStage('2 (binary -> browser assets)', 'build-quantized-rvf.mjs', 120000);

  // Stage 3: binary -> MCP KB
  try {
    runStage('3 (binary -> MCP KB)', 'export-mcp-kb.mjs', 120000, ['--output', 'kb-data/']);
  } catch (err) {
    log('WARNING: MCP export failed: ' + err.message);
  }

  // Verify
  const newCount = readManifestCount();
  log('New manifest vectorCount: ' + newCount);

  if (newCount > 1000) {
    log('CRITICAL: Manifest shows ' + newCount + ' vectors -- NOT the gold KB! Aborting.');
    process.exit(3);
  }

  if (newCount !== manifestCount) {
    log('SUCCESS: Updated ' + manifestCount + ' -> ' + newCount);
  }

  appendLog({ timestamp: new Date().toISOString(), action: 'export', masterCount, oldManifest: manifestCount, newManifest: newCount, durationMs: Date.now() - startTime });
  writeHeartbeat('kb-export', { status: 'ok', counts: { masterCount, newManifest: newCount, action: 'export' }, durationMs: Date.now() - startTime });
  log('Pipeline finished in ' + ((Date.now() - startTime) / 1000).toFixed(1) + 's');
}

main().catch(err => {
  log('FATAL: ' + err.message);
  writeHeartbeat('kb-export', { status: 'failed', error: String(err.message) });
  process.exit(1);
});
