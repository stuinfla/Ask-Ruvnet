#!/usr/bin/env node
/**
 * kb-sync-verify.mjs -- Verify KB sync integrity
 *
 * Ensures the deployed RuvectorStore matches PostgreSQL exactly.
 * Exits 0 if in sync, exits 1 if stale, exits 2 on error.
 * Run after every export pipeline or as a standalone health check.
 *
 * Usage: node scripts/kb-sync-verify.mjs [--fix]
 *   --fix   Automatically run the export pipeline if stale
 *
 * Updated: 2026-03-12 15:40:00 EST | Version 1.0.0
 * Created: 2026-03-12
 */

import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(PROJECT_ROOT, '.ruvector', 'knowledge-base', 'manifest.json');
const RVF_PATH = path.join(PROJECT_ROOT, 'knowledge.rvf');
const FIX = process.argv.includes('--fix');

const DB_CONFIG = {
  host: 'localhost', port: 5435, user: 'postgres', database: 'postgres',
  max: 2, idleTimeoutMillis: 5000, connectionTimeoutMillis: 5000,
};

function fail(msg) {
  console.error(`SYNC FAIL: ${msg}`);
  process.exit(1);
}

async function main() {
  console.log('=== KB Sync Verification ===\n');

  // 1. Check PostgreSQL is reachable
  let pgCount;
  let pgLatest;
  const pool = new pg.Pool(DB_CONFIG);
  try {
    const countResult = await pool.query(`
      SELECT
        (SELECT count(*) FROM ask_ruvnet.architecture_docs
         WHERE is_duplicate = false AND embedding IS NOT NULL) +
        (SELECT count(*) FROM ask_ruvnet.kb_complete
         WHERE embedding IS NOT NULL) AS total
    `);
    pgCount = parseInt(countResult.rows[0].total, 10);

    const latestResult = await pool.query(`
      SELECT GREATEST(
        (SELECT max(updated_at) FROM ask_ruvnet.kb_complete),
        (SELECT max(created_at) FROM ask_ruvnet.architecture_docs)
      ) AS latest
    `);
    pgLatest = latestResult.rows[0].latest;
  } catch (err) {
    console.error(`ERROR: Cannot reach PostgreSQL — ${err.message}`);
    process.exit(2);
  } finally {
    await pool.end();
  }

  console.log(`PostgreSQL: ${pgCount.toLocaleString()} entries (latest: ${pgLatest})`);

  // 2. Check manifest
  if (!fs.existsSync(MANIFEST_PATH)) {
    fail('Manifest not found at ' + MANIFEST_PATH);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const manifestCount = manifest.vectorCount;
  const manifestDate = manifest.savedAt;
  console.log(`Manifest:   ${manifestCount.toLocaleString()} vectors (saved: ${manifestDate})`);

  // 3. Check RVF file
  if (!fs.existsSync(RVF_PATH)) {
    fail('knowledge.rvf not found');
  }
  const rvfSize = fs.statSync(RVF_PATH).size;
  const rvfModified = fs.statSync(RVF_PATH).mtime.toISOString();
  console.log(`RVF:        ${(rvfSize / 1024 / 1024).toFixed(1)} MB (modified: ${rvfModified})`);

  // 4. Compare counts
  const issues = [];

  if (pgCount !== manifestCount) {
    issues.push(`COUNT MISMATCH: PG=${pgCount}, Manifest=${manifestCount} (delta: ${pgCount - manifestCount})`);
  }

  // 5. Check staleness (manifest older than latest PG entry by more than 24 hours)
  if (pgLatest && manifestDate) {
    const pgTime = new Date(pgLatest).getTime();
    const manifestTime = new Date(manifestDate).getTime();
    const hoursBehind = (pgTime - manifestTime) / (1000 * 60 * 60);
    if (hoursBehind > 24) {
      issues.push(`STALE: Manifest is ${hoursBehind.toFixed(0)} hours behind latest PG entry`);
    }
  }

  // 6. Check browser assets exist
  const assetDir = path.join(PROJECT_ROOT, 'src', 'ui', 'public', 'assets');
  const requiredAssets = ['knowledge-sq8.bin.gz', 'knowledge-sq8-params.bin.gz', 'knowledge-meta.json.gz'];
  for (const asset of requiredAssets) {
    if (!fs.existsSync(path.join(assetDir, asset))) {
      issues.push(`MISSING ASSET: ${asset}`);
    }
  }

  // 7. Report
  console.log('');
  if (issues.length === 0) {
    console.log('SYNC OK: PostgreSQL, Manifest, RVF, and browser assets are all in sync.');
    process.exit(0);
  }

  for (const issue of issues) {
    console.error(`  ${issue}`);
  }
  console.error(`\n${issues.length} issue(s) found.`);

  if (FIX) {
    console.log('\n--fix flag set. Running export pipeline...');
    try {
      execFileSync('/usr/local/bin/node', [
        path.join(PROJECT_ROOT, 'scripts', 'kb-export-pipeline.mjs'),
        '--force', '--verbose',
      ], { cwd: PROJECT_ROOT, stdio: 'inherit', timeout: 900_000 });
      console.log('Fix applied. Run this script again to verify.');
    } catch (err) {
      console.error('Fix FAILED:', err.message);
      process.exit(2);
    }
  }

  process.exit(1);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(2); });
