#!/usr/bin/env node
/**
 * heartbeat-cli.mjs — tiny shim so a bash trap can emit a heartbeat.
 * Usage: node scripts/lib/heartbeat-cli.mjs <stage> <exitCode> [note]
 * Used by stage wrappers' EXIT trap so even a node segfault/OOM/kill leaves
 * a signal the watchdog can see.
 */
import { writeHeartbeat } from './preflight.mjs';

const [, , stage, exitCodeRaw, note] = process.argv;
if (!stage) { console.error('usage: heartbeat-cli.mjs <stage> <exitCode> [note]'); process.exit(2); }
const exitCode = parseInt(exitCodeRaw || '0', 10);
writeHeartbeat(stage, {
  status: exitCode === 0 ? 'ok' : 'failed',
  exitCode,
  stagePhase: note || 'wrapper-trap',
  error: exitCode === 0 ? null : `non-zero exit (${exitCode}) ${note || ''}`.trim(),
});
