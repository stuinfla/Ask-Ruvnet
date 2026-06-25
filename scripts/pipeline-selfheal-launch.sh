#!/bin/bash
# pipeline-selfheal-launch.sh — wrapper for the 7:00 AM self-heal supervisor.
# Sources OPENROUTER_API_KEY (for curate re-runs) + alert keys from .env so they
# stay out of the plaintext plist. Mirrors the kb-curate-launch.sh pattern.
cd /Users/stuartkerr/Code/Ask-Ruvnet/Ask-Ruvnet || exit 1
if [ -f .env ]; then
  for k in OPENROUTER_API_KEY NTFY_TOPIC SLACK_WEBHOOK_URL PERSONAL_GMAIL_USER PERSONAL_GMAIL_APP_PASSWORD; do
    v="$(grep -E "^${k}=" .env | head -1 | cut -d= -f2- || true)"
    v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
    [ -n "$v" ] && export "$k=$v"
  done
fi
exec /usr/local/bin/node scripts/kb-self-heal.mjs "$@"
