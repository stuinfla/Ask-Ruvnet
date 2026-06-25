#!/bin/bash
# kb-health-statusline.sh — one-line KB pipeline health for the Claude Code
# SessionStart hook. Fast + non-blocking: reads the cached status.json written
# by the 8:15 AM watchdog; only re-runs the watchdog (quiet) if the cache is
# stale > 6h. This is how Claude becomes AWARE of a broken pipeline at session
# start instead of finding out only when asked.
cd /Users/stuartkerr/Code/Ask-Ruvnet/Ask-Ruvnet || exit 0

STATUS=logs/pipeline-health-status.json
fresh=0
if [ -f "$STATUS" ]; then
  age=$(( $(date +%s) - $(stat -f %m "$STATUS" 2>/dev/null || echo 0) ))
  [ "$age" -lt 21600 ] && fresh=1   # < 6h
fi
if [ "$fresh" -eq 0 ]; then
  /usr/local/bin/node scripts/pipeline-health-check.mjs --quiet >/dev/null 2>&1 || true
fi

/usr/local/bin/node -e '
  try {
    const s = require("./logs/pipeline-health-status.json");
    const c = s.critical || 0, w = s.warn || 0, n = s.entryCount || "?";
    if (c)      console.log(`[KB-PIPELINE] 🔴 ${c} CRITICAL, ${w} warn — KB self-update is BROKEN. Run: node scripts/pipeline-health-check.mjs`);
    else if (w) console.log(`[KB-PIPELINE] 🟡 ${w} warning(s); core healthy — ${n} entries`);
    else        console.log(`[KB-PIPELINE] 🟢 healthy — ${n} entries, artifacts fresh`);
  } catch (e) {
    console.log("[KB-PIPELINE] ⚪ status unknown — run: node scripts/pipeline-health-check.mjs");
  }
' 2>/dev/null || echo "[KB-PIPELINE] ⚪ status check unavailable"
