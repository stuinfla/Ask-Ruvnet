#!/usr/bin/env node
/**
 * Parallel Stage 3 Launcher
 *
 * Spawns N concurrent workers, each processing a deterministic slice
 * of REWRITE groups using hash-based partitioning. Every worker shares
 * the same quality gate — nothing slips through.
 *
 * Usage:
 *   node parallel-rewrite.js --workers 4 --run-id <uuid>
 *   node parallel-rewrite.js --workers 4               # uses RUN_ID env var
 *
 * Each worker gets groups where: abs(hashtext(group_id)) % N == worker_id
 * This guarantees non-overlapping, deterministic assignment with no coordination.
 */
const { spawn } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
let numWorkers = 4;
let runId = process.env.RUN_ID;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--workers' && args[i + 1]) numWorkers = parseInt(args[i + 1], 10);
  if (args[i] === '--run-id' && args[i + 1]) runId = args[i + 1];
}

if (!runId) {
  console.error('ERROR: --run-id <uuid> or RUN_ID env var required');
  process.exit(1);
}

if (numWorkers < 1 || numWorkers > 10) {
  console.error('ERROR: --workers must be 1-10');
  process.exit(1);
}

console.log(`\n=== Parallel Stage 3 Rewrite ===`);
console.log(`Workers: ${numWorkers}`);
console.log(`Run ID:  ${runId}`);
console.log(`Each worker gets ~1/${numWorkers} of groups via hash partitioning\n`);

// Inline worker script that imports and runs stage03_rewrite with partition params
const workerScript = (wId, total, rid) => `
  const { stage03_rewrite } = require('./stages/03-rewrite');
  stage03_rewrite('${rid}', { workerId: ${wId}, totalWorkers: ${total} })
    .then(stats => {
      console.log('[Worker ${wId + 1}] DONE:', JSON.stringify(stats));
      process.exit(0);
    })
    .catch(err => {
      console.error('[Worker ${wId + 1}] FATAL:', err.message);
      process.exit(1);
    });
`;

const workers = [];
const results = new Map();

for (let i = 0; i < numWorkers; i++) {
  const child = spawn('node', ['-e', workerScript(i, numWorkers, runId)], {
    cwd: path.resolve(__dirname),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  const label = `Worker ${i + 1}/${numWorkers}`;

  child.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    for (const line of lines) {
      console.log(`[${label}] ${line}`);
    }
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    for (const line of lines) {
      console.error(`[${label}] ${line}`);
    }
  });

  child.on('exit', (code) => {
    results.set(i, code);
    console.log(`[${label}] exited with code ${code}`);

    if (results.size === numWorkers) {
      const failed = [...results.values()].filter(c => c !== 0).length;
      console.log(`\n=== All ${numWorkers} workers finished ===`);
      console.log(`  Succeeded: ${numWorkers - failed}`);
      console.log(`  Failed:    ${failed}`);
      process.exit(failed > 0 ? 1 : 0);
    }
  });

  workers.push(child);
}

// Handle Ctrl+C gracefully — kill all workers
process.on('SIGINT', () => {
  console.log('\nStopping all workers...');
  for (const w of workers) w.kill('SIGTERM');
  setTimeout(() => process.exit(1), 3000);
});
