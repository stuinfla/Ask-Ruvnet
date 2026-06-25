#!/usr/bin/env node
/**
 * pipeline-health-check.mjs — Dead man's switch + watchdog for the nightly KB pipeline.
 *
 * Asserts that every stage ran AND SUCCEEDED, that the artifacts the MCP server
 * serves are fresh and queryable, and that the installed LaunchAgents match the
 * repo mirror. Alerts loudly on failure (Gmail SMTP + macOS notification) and
 * writes a machine-readable status file the SessionStart hook injects into Claude.
 *
 * Severity model:
 *   CRITICAL → email + macOS notify + exit 1   (pipeline is actually broken)
 *   WARN     → macOS notify only + exit 0       (degraded, not down — avoid alert fatigue)
 *
 * Modes:
 *   node scripts/pipeline-health-check.mjs            full run (alerts)
 *   node scripts/pipeline-health-check.mjs --quiet    machine output only, no alerts
 *                                                     (used by the SessionStart hook)
 *
 * Updated: 2026-06-19 | Version 2.0.0  (was 1.0.0: added severity, curate-success
 *   check, entryCount non-decreasing, rvf/kb-data freshness, MCP canary, plist
 *   drift, --quiet, status.json, recipient fix)
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runCanary } from './lib/kb-canary.mjs';
import { alert } from './lib/alert.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOGS = path.join(ROOT, 'logs');
const STATUS_FILE = path.join(LOGS, 'pipeline-health-status.json');
const NOW = Date.now();
const QUIET = process.argv.includes('--quiet');

const STALE_HOURS = 28;   // a stage must have run within ~last day (+slack)
const FRESH_HOURS = 48;   // artifacts must be fresh within 2 days

// --- alerting (macOS + ntfy + slack + email) is centralized in scripts/lib/alert.mjs ---

const CRITICAL = 'CRITICAL';
const WARN = 'WARN';
const issues = [];
const add = (severity, id, msg) => issues.push({ severity, id, msg });

function hoursAgo(isoDate) {
  if (!isoDate) return Infinity;
  return (NOW - new Date(isoDate).getTime()) / 3600000;
}
function fileHoursAgo(p) {
  try { return (NOW - fs.statSync(p).mtimeMs) / 3600000; } catch { return Infinity; }
}
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function lastJsonlEntry(p) {
  try {
    const lines = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
    return lines.length ? JSON.parse(lines[lines.length - 1]) : null;
  } catch { return null; }
}

// ── 1/2. Evergreen ran + no errors ──────────────────────────────────────────
const evHb = readJson(path.join(LOGS, 'kb-evergreen-heartbeat.json'));
const evJsonl = lastJsonlEntry(path.join(LOGS, 'kb-evergreen.jsonl'));
const evWhen = evHb?.lastAttempt || evJsonl?.timestamp;
const evErrors = evHb?.errors ?? evJsonl?.errors ?? 0;
if (!evWhen) add(CRITICAL, 'evergreen-ran', 'Evergreen: no heartbeat or audit log');
else if (hoursAgo(evWhen) > STALE_HOURS) add(CRITICAL, 'evergreen-ran', `Evergreen: last run ${hoursAgo(evWhen).toFixed(0)}h ago (max ${STALE_HOURS}h)`);
if (evErrors > 0) add(WARN, 'evergreen-errors', `Evergreen: ${evErrors} errors in last run`);

// ── 3. Raw manifest fresh + has repos ───────────────────────────────────────
const rawManifest = readJson(path.join(ROOT, '.ruvector', 'raw', 'manifest.json'));
if (!rawManifest) add(CRITICAL, 'raw-manifest', 'Raw manifest: .ruvector/raw/manifest.json not found');
else {
  if (hoursAgo(rawManifest.lastRun) > STALE_HOURS) add(CRITICAL, 'raw-manifest', `Raw manifest: lastRun ${hoursAgo(rawManifest.lastRun).toFixed(0)}h ago`);
  const repoCount = Object.keys(rawManifest.repos || {}).length;
  if (repoCount < 15) add(WARN, 'raw-repos', `Raw manifest: only ${repoCount} repos (expected 15+)`);
}

// ── 5/6. Curate ran AND SUCCEEDED (the check that would've caught the outage) ─
const curHb = readJson(path.join(LOGS, 'kb-curate-heartbeat.json'));
const curJsonl = lastJsonlEntry(path.join(LOGS, 'kb-curate.jsonl'));
const curWhen = curHb?.lastAttempt || curJsonl?.timestamp;
if (!curWhen) add(CRITICAL, 'curate-ran', 'Curate: no heartbeat or audit log');
else if (hoursAgo(curWhen) > STALE_HOURS) add(CRITICAL, 'curate-ran', `Curate: last attempt ${hoursAgo(curWhen).toFixed(0)}h ago`);
if (curHb) {
  const curErrors = curHb.errors ?? 0;
  const created = curHb.counts?.created ?? 0;
  const succeeded = curHb.status === 'ok' && curHb.lastSuccess != null;
  if (!succeeded) add(CRITICAL, 'curate-success',
    `Curate: last run did NOT succeed (status=${curHb.status}, created=${created}, errors=${curErrors}, lastSuccess=${curHb.lastSuccess ?? 'null'})`);
  if (succeeded && curErrors > created) add(WARN, 'curate-errors',
    `Curate: high synthesis error rate (${curErrors} errors vs ${created} created) — check LLM/JSON output`);
}

// ── 7/8. kb-master.json fresh + entryCount sane & non-decreasing ─────────────
const master = readJson(path.join(ROOT, 'kb-master.json'));
const prevStatus = readJson(STATUS_FILE);
let entryCount = 0;
if (!master) add(CRITICAL, 'kb-master', 'kb-master.json: NOT FOUND');
else {
  entryCount = master.entryCount ?? (Array.isArray(master.entries) ? master.entries.length : 0);
  if (entryCount < 100) add(CRITICAL, 'kb-master-count', `kb-master.json: only ${entryCount} entries (expected 100+)`);
  if (prevStatus?.entryCount && entryCount < prevStatus.entryCount)
    add(CRITICAL, 'kb-master-shrink', `kb-master.json: entryCount dropped ${prevStatus.entryCount} → ${entryCount}`);
  if (fileHoursAgo(path.join(ROOT, 'kb-master.json')) > FRESH_HOURS)
    add(WARN, 'kb-master-stale', `kb-master.json: not updated in ${fileHoursAgo(path.join(ROOT, 'kb-master.json')).toFixed(0)}h`);
}

// ── 9. Export ran ────────────────────────────────────────────────────────────
const exHb = readJson(path.join(LOGS, 'kb-export-heartbeat.json'));
const exJsonl = lastJsonlEntry(path.join(LOGS, 'kb-export-pipeline.jsonl'));
const exWhen = exHb?.lastAttempt || exJsonl?.timestamp;
if (!exWhen) add(CRITICAL, 'export-ran', 'Export: no heartbeat or audit log');
else if (hoursAgo(exWhen) > STALE_HOURS) add(CRITICAL, 'export-ran', `Export: last run ${hoursAgo(exWhen).toFixed(0)}h ago`);

// ── 10/11. knowledge.rvf rebuilt recently + sane size ────────────────────────
const rvf = path.join(ROOT, 'knowledge.rvf');
if (!fs.existsSync(rvf)) add(CRITICAL, 'rvf-exists', 'knowledge.rvf: NOT FOUND');
else {
  if (fileHoursAgo(rvf) > FRESH_HOURS) add(CRITICAL, 'rvf-stale', `knowledge.rvf: not rebuilt in ${fileHoursAgo(rvf).toFixed(0)}h`);
  const mb = fs.statSync(rvf).size / 1048576;
  if (mb > 1.5) add(CRITICAL, 'rvf-size', `knowledge.rvf: ${mb.toFixed(1)}MB (>1.5MB ⇒ wrong build script ran)`);
  if (mb === 0) add(CRITICAL, 'rvf-empty', 'knowledge.rvf: 0 bytes');
}

// ── 12. kb-data fresh ────────────────────────────────────────────────────────
const kbData = path.join(ROOT, 'kb-data', 'kb-entries.json.gz');
if (fs.existsSync(kbData) && fileHoursAgo(kbData) > FRESH_HOURS)
  add(WARN, 'kb-data-stale', `kb-data/: not rebuilt in ${fileHoursAgo(kbData).toFixed(0)}h (MCP serves stale data)`);

// ── 16. Plist drift (installed vs mirror) — optional, only if install.sh exists ─
const installSh = path.join(ROOT, 'scripts', 'launchd', 'install.sh');
if (fs.existsSync(installSh)) {
  try {
    execFileSync('bash', [installSh, '--check'], { timeout: 15000, stdio: 'pipe' });
  } catch (e) {
    const out = ((e.stdout || '').toString() + (e.stderr || '').toString()).trim().split('\n').filter(Boolean).join('; ');
    add(WARN, 'plist-drift', `LaunchAgent drift: ${out || 'installed plists differ from scripts/launchd mirror'}`);
  }
}

// ── 15. Production health (kept from v1) ─────────────────────────────────────
try {
  const res = execFileSync('curl', ['-s', '--max-time', '10', 'https://ask-ruvnet.up.railway.app/health'], { timeout: 15000 }).toString();
  const health = JSON.parse(res);
  if (health.status !== 'ok') add(WARN, 'prod-status', `Production: status=${health.status}`);
  if (health.checks?.vectorStore?.vectorCount < 100) add(WARN, 'prod-vectors', `Production: only ${health.checks.vectorStore.vectorCount} vectors`);
} catch (e) {
  add(WARN, 'prod-health', `Production: health check failed (${(e.message || '').slice(0, 50)})`);
}

// ── 14. MCP canary — served KB is loadable & queryable ───────────────────────
const canary = await runCanary('what is HNSW');
if (!canary.ok) add(CRITICAL, 'mcp-canary', `MCP canary: KB not queryable — ${canary.error}`);

// ── Report + alert + status.json ─────────────────────────────────────────────
const criticals = issues.filter((i) => i.severity === CRITICAL);
const warns = issues.filter((i) => i.severity === WARN);

const status = {
  time: new Date().toISOString(),
  ok: issues.length === 0,
  critical: criticals.length,
  warn: warns.length,
  entryCount: entryCount || prevStatus?.entryCount || 0,
  issues,
};
try { fs.mkdirSync(LOGS, { recursive: true }); fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2)); } catch {}

// alert delivery (macOS + ntfy + slack + email) is centralized in scripts/lib/alert.mjs

if (QUIET) {
  // Machine mode for the SessionStart hook — no alerts, just status + exit code.
  console.log(JSON.stringify({ ok: status.ok, critical: status.critical, warn: status.warn, entryCount: status.entryCount }));
  process.exit(criticals.length ? 1 : 0);
}

console.log('=== Pipeline Health Check (v2) ===');
console.log('Time: ' + status.time);
console.log(`entries: ${status.entryCount} | CRITICAL: ${criticals.length} | WARN: ${warns.length}\n`);
if (issues.length === 0) {
  console.log('ALL OK — no issues detected');
  process.exit(0);
}
criticals.forEach((i) => console.log('  [CRITICAL] ' + i.msg));
warns.forEach((i) => console.log('  [WARN]     ' + i.msg));
const body = 'Ask-RuvNet Nightly Pipeline Health Check\nTime: ' + status.time + '\n\n' +
  'CRITICAL:\n' + (criticals.map((i) => '  - ' + i.msg).join('\n') || '  (none)') + '\n\n' +
  'WARN:\n' + (warns.map((i) => '  - ' + i.msg).join('\n') || '  (none)') + '\n\n' +
  'Action: cd ~/Code/Ask-Ruvnet/Ask-Ruvnet && node scripts/pipeline-health-check.mjs\n';
// critical -> macOS+ntfy+slack+email ; warn-only -> macOS only (avoid fatigue) — all via the shared module
if (criticals.length) alert('critical', `[Ask-RuvNet] Pipeline ${criticals.length} CRITICAL`, body);
else alert('warn', `[Ask-RuvNet] Pipeline ${warns.length} warning(s)`, body);
process.exit(criticals.length ? 1 : 0);
