#!/usr/bin/env node
/**
 * kb-self-heal.mjs — AUTONOMOUS remediation for the nightly KB pipeline.
 *
 * Runs the watchdog; for each auto-fixable CRITICAL, re-runs the responsible
 * stage. Re-checks. Alerts the human ONLY if it could not self-heal — so you
 * stop getting "it broke" pages and only get "it broke AND I couldn't fix it."
 *
 * Guards against runaway loops:
 *   - max 2 remediation attempts per stage per day (logs/self-heal-state.json)
 *   - skips a stage that is already running
 *   - NEVER auto-fixes dangerous states (oversized RVF, shrinking entry count)
 *
 * Schedule: 7:00 AM (after 6 AM export, before the 8:15 watchdog backstop).
 * Manual:   node scripts/kb-self-heal.mjs
 *
 * Created: 2026-06-19 | Version 1.0.0
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { alert } from './lib/alert.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOGS = path.join(ROOT, 'logs');
const STATUS = path.join(LOGS, 'pipeline-health-status.json');
const STATE = path.join(LOGS, 'self-heal-state.json');
const NODE = '/usr/local/bin/node';
const MAX_ATTEMPTS_PER_DAY = 2;
// Alert channel (ntfy topic, email, macOS) is centralized in scripts/lib/alert.mjs

const log = (m) => console.log('[' + new Date().toLocaleTimeString() + '] ' + m);
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const today = () => new Date().toISOString().slice(0, 10);

function runWatchdog() {
  spawnSync(NODE, [path.join(ROOT, 'scripts/pipeline-health-check.mjs'), '--quiet'], { cwd: ROOT, stdio: 'ignore', timeout: 120000 });
  return readJson(STATUS) || { critical: 0, warn: 0, issues: [] };
}

function stageRunning(stage) {
  const pat = { evergreen: 'kb-evergreen.mjs', curate: 'kb-auto-curate.mjs', export: 'kb-export-pipeline.mjs' }[stage];
  return spawnSync('pgrep', ['-f', pat]).status === 0;
}

function loadState() {
  const s = readJson(STATE);
  return (s && s.date === today()) ? s : { date: today(), attempts: {} };
}
const saveState = (s) => { try { fs.writeFileSync(STATE, JSON.stringify(s, null, 2)); } catch {} };

// Map CRITICAL ids -> the stage that fixes them. Some are deliberately NOT auto-fixable.
function plan(issues) {
  const stages = new Set();
  const noFix = [];
  for (const i of (issues || [])) {
    if (i.severity !== 'CRITICAL') continue;
    switch (i.id) {
      case 'evergreen-ran': case 'raw-manifest': stages.add('evergreen'); break;
      case 'curate-ran': case 'curate-success': stages.add('curate'); break;
      case 'export-ran': case 'rvf-stale': case 'rvf-exists': case 'rvf-empty': case 'mcp-canary': stages.add('export'); break;
      // Dangerous — a human must look (wrong build script / data loss). Never auto-rerun.
      case 'rvf-size': case 'kb-master-shrink': case 'kb-master': case 'kb-master-count': noFix.push(i.id); break;
      default: noFix.push(i.id);
    }
  }
  return { stages: [...stages], noFix };
}

function remediate(stage) {
  log('AUTO-FIX → re-running ' + stage);
  let r;
  if (stage === 'curate') {
    // curate needs OPENROUTER_API_KEY — the launch wrapper sources it from .env
    r = spawnSync('bash', [path.join(ROOT, 'scripts/kb-curate-launch.sh')], { cwd: ROOT, stdio: 'inherit', timeout: 3600000 });
  } else {
    const cmd = {
      evergreen: [path.join(ROOT, 'scripts/kb-evergreen.mjs')],
      export: [path.join(ROOT, 'scripts/kb-export-pipeline.mjs'), '--force'],
    }[stage];
    r = spawnSync(NODE, cmd, { cwd: ROOT, stdio: 'inherit', timeout: 3600000 });
  }
  return r.status === 0;
}

function alertHuman(title, body, severity = 'critical') {
  const r = alert(severity, title, body);
  log(`  alert sent (ntfy=${r.ntfy} email=${r.email})`);
}

async function main() {
  log('=== KB Self-Heal ===');
  let status = runWatchdog();
  if (!status.critical) { log(`Healthy (${status.warn || 0} warn). Nothing to heal.`); return; }

  log(`${status.critical} CRITICAL detected — attempting autonomous repair.`);
  const { stages, noFix } = plan(status.issues);
  const state = loadState();
  const healed = [], failed = [], skipped = [];

  for (const stage of ['evergreen', 'curate', 'export']) { // dependency order
    if (!stages.includes(stage)) continue;
    const n = state.attempts[stage] || 0;
    if (n >= MAX_ATTEMPTS_PER_DAY) { log(`SKIP ${stage}: daily attempt cap (${n}) reached`); skipped.push(stage); continue; }
    if (stageRunning(stage)) { log(`SKIP ${stage}: already running`); skipped.push(stage); continue; }
    state.attempts[stage] = n + 1; saveState(state);
    (remediate(stage) ? healed : failed).push(stage);
  }

  status = runWatchdog(); // re-check after repair
  if (!status.critical) {
    log(`✅ AUTO-HEALED — re-ran [${healed.join(', ') || 'none'}]; now healthy (${status.warn || 0} warn).`);
    alertHuman('Ask-RuvNet: auto-healed ✅', `Self-heal re-ran [${healed.join(', ')}] — pipeline healthy again.`, 'info');
    return;
  }

  const remaining = (status.issues || []).filter((i) => i.severity === 'CRITICAL').map((i) => i.msg).join(' | ');
  const noFixNote = noFix.length ? ` Un-auto-fixable (needs eyes): ${noFix.join(', ')}.` : '';
  log('🔴 AUTO-FIX INSUFFICIENT — escalating to human.');
  alertHuman('Ask-RuvNet: AUTO-FIX FAILED — needs you 🔴',
    `Tried [${healed.concat(failed).join(', ') || 'nothing'}], ${status.critical} CRITICAL remain: ${remaining}.${noFixNote}`);
  process.exit(1);
}
main().catch((e) => { log('FATAL: ' + e.message); alertHuman('Ask-RuvNet: self-heal crashed 🔴', String(e.message).slice(0, 200)); process.exit(1); });
