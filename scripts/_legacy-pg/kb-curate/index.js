#!/usr/bin/env node
/**
 * KB Curation Pipeline — Main Entry Point
 *
 * Usage:
 *   node index.js                    # Run full pipeline (resume if existing run)
 *   node index.js --stage 0          # Run only Stage 0 (prefilter)
 *   node index.js --stage 1          # Run only Stage 1 (cluster)
 *   node index.js --stage 2          # Run only Stage 2 (triage)
 *   node index.js --stage 3          # Run only Stage 3 (rewrite)
 *   node index.js --stage 4          # Run only Stage 4 (embed)
 *   node index.js --dry-run          # Preview without making changes
 *   node index.js --new-run          # Force new run (don't resume)
 *   node index.js --test             # Run in test mode (5 items per stage)
 *   node index.js --limit N          # Limit items processed
 */
const { pool } = require('./config');
const { stage00_prefilter } = require('./stages/00-prefilter');
const { stage01_cluster } = require('./stages/01-cluster');
const { stage02_triage } = require('./stages/02-triage');
const { stage03_rewrite } = require('./stages/03-rewrite');
const { stage04_embed } = require('./stages/04-embed');

async function getOrCreateRun(forceNew = false) {
  const client = await pool.connect();
  try {
    if (!forceNew) {
      const res = await client.query(`
        SELECT DISTINCT run_id FROM ask_ruvnet.curation_pipeline
        WHERE status = 'completed'
        ORDER BY run_id DESC LIMIT 1
      `);
      if (res.rows.length > 0) {
        const runId = res.rows[0].run_id;
        console.log(`[Pipeline] Resuming run: ${runId}`);
        return runId;
      }
    }
    const res = await client.query("SELECT gen_random_uuid() as id");
    const runId = res.rows[0].id;
    console.log(`[Pipeline] Starting new run: ${runId}`);
    return runId;
  } finally {
    client.release();
  }
}

async function getLastCompletedStage(runId) {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT stage FROM ask_ruvnet.curation_pipeline
      WHERE run_id = $1 AND status = 'completed'
      ORDER BY id DESC LIMIT 1
    `, [runId]);
    if (res.rows.length === 0) return -1;
    const stageMap = { prefilter: 0, cluster: 1, triage: 2, rewrite: 3, embed: 4, audit: 5 };
    return stageMap[res.rows[0].stage] ?? -1;
  } finally {
    client.release();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const stageOnly = args.includes('--stage') ? parseInt(args[args.indexOf('--stage') + 1]) : null;
  const dryRun = args.includes('--dry-run');
  const forceNew = args.includes('--new-run');
  const testMode = args.includes('--test');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : null;

  if (dryRun) console.log('[Pipeline] DRY RUN — no changes will be made\n');
  if (testMode) console.log('[Pipeline] TEST MODE — limited processing\n');

  try {
    const runId = await getOrCreateRun(forceNew);
    const lastStage = await getLastCompletedStage(runId);

    const opts = { dryRun, limit, testMode };

    if (stageOnly !== null) {
      switch (stageOnly) {
        case 0: await stage00_prefilter(runId, opts); break;
        case 1: await stage01_cluster(runId, opts); break;
        case 2: await stage02_triage(runId, opts); break;
        case 3: await stage03_rewrite(runId, opts); break;
        case 4: await stage04_embed(runId, opts); break;
        default: console.log(`[Pipeline] Stage ${stageOnly} not implemented`);
      }
    } else {
      // Run all stages sequentially, skipping completed ones
      if (lastStage < 0) {
        console.log('\n=== STAGE 0: PRE-FILTER ===\n');
        await stage00_prefilter(runId, opts);
      }
      if (lastStage < 1) {
        console.log('\n=== STAGE 1: CLUSTER ===\n');
        await stage01_cluster(runId, opts);
      }
      if (lastStage < 2) {
        console.log('\n=== STAGE 2: TRIAGE ===\n');
        await stage02_triage(runId, opts);
      }
      if (lastStage < 3) {
        console.log('\n=== STAGE 3: REWRITE ===\n');
        await stage03_rewrite(runId, opts);
      }
      if (lastStage < 4) {
        console.log('\n=== STAGE 4: EMBED ===\n');
        await stage04_embed(runId, opts);
      }
    }
  } catch (err) {
    console.error('[Pipeline] Fatal error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
