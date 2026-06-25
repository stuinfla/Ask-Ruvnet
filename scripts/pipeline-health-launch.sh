#!/bin/bash
# pipeline-health-launch.sh — wrapper for the 8:15 AM watchdog LaunchAgent.
# Sources the Gmail app password (+ optional push keys) from .env so secrets
# stay OUT of the plaintext plist. Mirrors the kb-curate-launch.sh pattern.
cd /Users/stuartkerr/Code/Ask-Ruvnet/Ask-Ruvnet || exit 1

if [ -f .env ]; then
  for k in PERSONAL_GMAIL_APP_PASSWORD PERSONAL_GMAIL_USER NTFY_TOPIC SLACK_WEBHOOK_URL; do
    v="$(grep -E "^${k}=" .env | head -1 | cut -d= -f2- || true)"
    v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
    [ -n "$v" ] && export "$k=$v"
  done
fi

exec /usr/local/bin/node scripts/pipeline-health-check.mjs "$@"
