/**
 * preflight.mjs — shared resilience helpers for the nightly KB pipeline.
 *
 * Two jobs, one place:
 *   1. preflight()      — verify a stage's environment BEFORE it runs and
 *                         auto-remediate (npm ci) so a wiped node_modules can
 *                         never again silently kill a stage.
 *   2. writeHeartbeat() — record stage status on SUCCESS *and* FAILURE so the
 *                         watchdog (and the SessionStart hook) can see a dead
 *                         stage. The old pipeline only wrote on success, so a
 *                         thrown error left no signal — that was the 80-day
 *                         silent-failure mechanism (kb-curate dead since
 *                         2026-03-31 with lastSuccess:null and zero alerts).
 *
 * Created: 2026-06-19 | Version 1.0.0
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..'); // repo root (scripts/lib -> repo)
const LOGS = path.join(ROOT, 'logs');

function ts() { return new Date().toISOString(); }

/**
 * Write/merge a stage heartbeat to logs/<stage>-heartbeat.json.
 * Always updates lastAttempt; sets lastSuccess only on status==='ok'.
 * Backward-compatible with the existing {lastAttempt,lastSuccess,errors} shape.
 */
export function writeHeartbeat(stage, fields = {}) {
  try { fs.mkdirSync(LOGS, { recursive: true }); } catch {}
  const file = path.join(LOGS, `${stage}-heartbeat.json`);
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const now = ts();
  const status = fields.status || 'ok';
  const errors = (fields.counts && typeof fields.counts.errors === 'number')
    ? fields.counts.errors
    : (typeof fields.errors === 'number' ? fields.errors : 0);
  const hb = {
    stage,
    status, // caller decides ok/failed — a stage can make partial progress with some errors
    exitCode: fields.exitCode ?? (status === 'ok' ? 0 : 1),
    lastAttempt: now,
    lastSuccess: status === 'ok' ? now : (prev.lastSuccess ?? null),
    finishedAt: fields.finishedAt || now,
    durationMs: fields.durationMs ?? null,
    stagePhase: fields.stagePhase || 'complete',
    counts: fields.counts || prev.counts || {},
    errors,
    error: fields.error ?? null,
  };
  try { fs.writeFileSync(file, JSON.stringify(hb, null, 2)); } catch (e) {
    console.error(`[heartbeat:${stage}] could not write heartbeat: ${e.message}`);
  }
  return hb;
}

/** EX_CONFIG-style loud abort that ALSO leaves a failure heartbeat. */
function abort(stage, reason) {
  writeHeartbeat(stage, { status: 'failed', stagePhase: 'preflight', error: reason, exitCode: 78 });
  console.error(`[preflight:${stage}] ABORT — ${reason}`);
  process.exit(78);
}

/** True if a dependency is installed (checks its package.json). */
function moduleInstalled(mod) {
  return fs.existsSync(path.join(ROOT, 'node_modules', mod, 'package.json'));
}

/**
 * Verify env for a stage and auto-heal. Call as the FIRST line of main().
 *   preflight({ stage, requireModules:[], requireFiles:[], autoRemediate:true })
 */
export function preflight({ stage, requireModules = [], requireFiles = [], autoRemediate = true }) {
  const nmMissing = !fs.existsSync(path.join(ROOT, 'node_modules'));
  const modMissing = requireModules.filter((m) => !moduleInstalled(m));

  if (nmMissing || modMissing.length) {
    const why = nmMissing ? 'node_modules absent' : `missing modules: ${modMissing.join(', ')}`;
    if (!autoRemediate) abort(stage, why);
    console.error(`[preflight:${stage}] ${why} — running 'npm ci' to self-heal`);
    try {
      execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit', timeout: 600000 });
    } catch (e) {
      // npm ci can fail without a lockfile; fall back to npm install before giving up
      try {
        execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit', timeout: 600000 });
      } catch (e2) {
        abort(stage, `dependency self-heal failed: ${(e2.message || e.message || '').slice(0, 200)}`);
      }
    }
    const stillMissing = requireModules.filter((m) => !moduleInstalled(m));
    if (stillMissing.length) abort(stage, `modules still missing after self-heal: ${stillMissing.join(', ')}`);
  }

  for (const f of requireFiles) {
    if (!fs.existsSync(path.join(ROOT, f))) abort(stage, `required input missing: ${f}`);
  }
  console.error(`[preflight:${stage}] OK`);
}
