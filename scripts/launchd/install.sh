#!/bin/bash
# install.sh — single source of truth for the KB pipeline LaunchAgents.
#
#   bash scripts/launchd/install.sh          (re)install all agents from this mirror
#   bash scripts/launchd/install.sh --check   exit 1 + print drift if installed != mirror
#
# Fixes the class of bug where the migration updated docs/code but never the
# installed cron: now the mirror in this dir IS the source, and --check (run by
# the watchdog, invariant #16) surfaces any drift in the daily alert.
set -uo pipefail
ROOT=/Users/stuartkerr/Code/Ask-Ruvnet/Ask-Ruvnet
MIRROR="$ROOT/scripts/launchd"
LA="$HOME/Library/LaunchAgents"
UID_NUM="$(id -u)"

# Canonical set (labels match what `launchctl list` actually loads).
PLISTS=(com.ruvnet.kb-evergreen ai.askruvnet.kb-curate ai.askruvnet.kb-export ai.askruvnet.pipeline-selfheal ai.askruvnet.pipeline-health)
# Retired labels to unload + remove if still present.
LEGACY=(ai.openclaw.kb-curate ai.openclaw.kb-export)

cmd="${1:-install}"

if [ "$cmd" = "--check" ]; then
  drift=0
  for p in "${PLISTS[@]}"; do
    if [ ! -f "$MIRROR/$p.plist" ]; then echo "MIRROR MISSING: $p"; drift=1; continue; fi
    if [ ! -f "$LA/$p.plist" ]; then echo "NOT INSTALLED: $p"; drift=1; continue; fi
    if ! diff -q "$LA/$p.plist" "$MIRROR/$p.plist" >/dev/null 2>&1; then echo "DRIFT: $p"; drift=1; fi
  done
  for p in "${LEGACY[@]}"; do
    [ -f "$LA/$p.plist" ] && { echo "LEGACY present: $p"; drift=1; }
  done
  exit $drift
fi

echo "Installing ${#PLISTS[@]} LaunchAgents from mirror..."
for p in "${LEGACY[@]}"; do
  launchctl bootout "gui/$UID_NUM/$p" 2>/dev/null || true
  rm -f "$LA/$p.plist" && echo "  removed legacy $p" || true
done
for p in "${PLISTS[@]}"; do
  if [ ! -f "$MIRROR/$p.plist" ]; then echo "  SKIP $p (no mirror file)"; continue; fi
  cp "$MIRROR/$p.plist" "$LA/$p.plist"
  plutil -lint "$LA/$p.plist" >/dev/null || { echo "  BAD PLIST: $p"; continue; }
  launchctl bootout "gui/$UID_NUM/$p" 2>/dev/null || true
  launchctl bootstrap "gui/$UID_NUM" "$LA/$p.plist" 2>/dev/null || launchctl load "$LA/$p.plist" 2>/dev/null || true
  echo "  installed $p"
done
echo "Done. Verify: launchctl list | grep -E 'ruvnet|askruvnet'"
