#!/bin/bash
# kb-curate-launch.sh — 5 AM PG-free KB curation launcher.
#
# Replaces the retired Postgres curator (scripts/kb-curate/index.js) with the
# PG-free scripts/kb-auto-curate.mjs (ADR-001: PG eliminated). Sources only
# OPENROUTER_API_KEY from the repo .env so the secret stays OUT of the plaintext
# LaunchAgent plist — mirrors the ruvnet-kb-mcp.sh wrapper pattern.
#
# Installed by: ai.askruvnet.kb-curate.plist (StartCalendarInterval 5:00 AM)
cd /Users/stuartkerr/Code/Ask-Ruvnet/Ask-Ruvnet || exit 1

if [ -f .env ]; then
  key="$(grep -E '^OPENROUTER_API_KEY=' .env | head -1 | cut -d= -f2- || true)"
  key="${key%\"}"; key="${key#\"}"   # strip surrounding double quotes if present
  key="${key%\'}"; key="${key#\'}"   # strip surrounding single quotes if present
  [ -n "$key" ] && export OPENROUTER_API_KEY="$key"
fi

# Defense-in-depth: if node dies abnormally (signal/OOM/kill) without writing its
# own heartbeat, the EXIT trap records a failure so the watchdog still sees it.
# Only fires on non-zero exit so it never clobbers the script's rich success heartbeat.
trap 'code=$?; [ "$code" -ne 0 ] && /usr/local/bin/node scripts/lib/heartbeat-cli.mjs kb-curate "$code" "wrapper-trap" 2>/dev/null; true' EXIT
/usr/local/bin/node scripts/kb-auto-curate.mjs --rebuild "$@"
