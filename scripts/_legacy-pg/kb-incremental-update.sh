#!/bin/bash
# KB Incremental Update - Only processes CHANGED repos
# Runs every 12 hours via launchd
# Version: 1.0.0 | Created: 2026-01-02

set -e

REPO_DIR="$HOME/.ruvector/repos"
LAST_RUN_FILE="$HOME/.ruvector/kb-last-update.timestamp"
LOG_FILE="$HOME/.ruvector/kb-update.log"
SCHEMA="ask_ruvnet"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"; }

log "═══════════════════════════════════════════════════"
log "KB INCREMENTAL UPDATE - Changed repos only"
log "═══════════════════════════════════════════════════"

# Get last run time (or 24h ago if first run)
if [ -f "$LAST_RUN_FILE" ]; then
  LAST_RUN=$(cat "$LAST_RUN_FILE")
else
  LAST_RUN=$(date -v-24H '+%Y-%m-%d %H:%M:%S')
fi
log "Last update: $LAST_RUN"

CHANGED_FILES=()
NEW_REPOS=0

# Ensure persistent repo directory exists
mkdir -p "$REPO_DIR"
cd "$REPO_DIR"

# Clone repos if directory is empty (first run after migration from /tmp)
if [ -z "$(ls -A "$REPO_DIR" 2>/dev/null)" ]; then
  log "📦 First run - cloning RuvNet repos..."
  RUVNET_REPOS=(
    "ruvnet/ruvector"
    "ruvnet/claude-flow"
    "ruvnet/agentic-flow"
    "ruvnet/ruv-swarm"
    "ruvnet/bot-generator"
    "ruvnet/agenticsjs"
    "ruvnet/viral-social"
    "ruvnet/scaling-up"
    "ruvnet/appeal-armor"
    "ruvnet/site-master"
    "ruvnet/bricksmith"
  )
  for repo_url in "${RUVNET_REPOS[@]}"; do
    repo_name="${repo_url#*/}"
    if ! git clone --depth 1 "https://github.com/$repo_url.git" "$REPO_DIR/$repo_name" 2>/dev/null; then
      log "⚠️ Failed to clone $repo_url (may be private or renamed)"
    fi
  done
fi

for repo in */; do
  repo_name="${repo%/}"
  cd "$REPO_DIR/$repo_name"

  # Check if repo has remote changes
  git fetch origin --quiet 2>/dev/null || continue

  LOCAL=$(git rev-parse HEAD 2>/dev/null)
  REMOTE=$(git rev-parse origin/main 2>/dev/null || git rev-parse origin/master 2>/dev/null)

  if [ "$LOCAL" != "$REMOTE" ]; then
    log "📥 Updating: $repo_name"
    git pull --quiet 2>/dev/null

    # Find changed markdown files
    while IFS= read -r file; do
      if [ -f "$file" ]; then
        CHANGED_FILES+=("$REPO_DIR/$repo_name/$file")
      fi
    done < <(git diff --name-only "$LOCAL" "$REMOTE" 2>/dev/null | grep '\.md$')

    ((NEW_REPOS++))
  fi
done

log "Repos with changes: $NEW_REPOS"
log "Changed files: ${#CHANGED_FILES[@]}"

if [ ${#CHANGED_FILES[@]} -eq 0 ]; then
  log "✅ No changes detected. KB is current."
  date '+%Y-%m-%d %H:%M:%S' > "$LAST_RUN_FILE"
  exit 0
fi

# Process only changed files with Python
log "⚡ Processing ${#CHANGED_FILES[@]} changed files..."

python3 << PYTHON
import psycopg2
from psycopg2.extras import execute_values
import hashlib
import re
import os

files = """${CHANGED_FILES[*]}""".split()
print(f"   Processing {len(files)} files...")

conn = psycopg2.connect(host='localhost', port=5435, database='postgres',
                        user='postgres', passfile=os.path.expanduser('~/.pgpass'))
cur = conn.cursor()

def content_hash(c):
    return hashlib.sha256(re.sub(r'\s+', ' ', c.lower()).strip().encode()).hexdigest()

batch = []
for fp in files:
    try:
        with open(fp, 'r') as f:
            content = f.read()
        if len(content) < 50:
            continue
        h = content_hash(content)
        title = os.path.basename(fp)[:-3]
        rel_path = fp.replace(os.path.expanduser('~/.ruvector/repos/'), '')
        batch.append((h[:8], title, content[:50000], rel_path, h, 'general', 50))
    except:
        pass

if batch:
    execute_values(cur, '''
        INSERT INTO $SCHEMA.architecture_docs
        (doc_id, title, content, file_path, file_hash, category, quality_score)
        VALUES %s ON CONFLICT (file_hash) DO UPDATE SET
        content = EXCLUDED.content, updated_at = NOW()
    ''', batch)

    # Generate embeddings for new/updated entries
    cur.execute('''
        UPDATE $SCHEMA.architecture_docs
        SET embedding = ('[' || array_to_string(ruvector_embed(LEFT(title || ' ' || content, 1500)), ',') || ']')::ruvector
        WHERE file_hash IN (SELECT file_hash FROM (VALUES %s) AS v(a,b,c,d,file_hash,e,f))
        AND (embedding IS NULL OR updated_at > NOW() - INTERVAL '1 minute')
    '''.replace('%s', ','.join(["('%s','%s','%s','%s','%s','%s',%s)" % b for b in batch])))

    conn.commit()
    print(f"   ✅ Inserted/updated {len(batch)} entries")

# Update version
cur.execute('''
    INSERT INTO $SCHEMA.kb_version (version, entries_count, high_quality_count, notes)
    SELECT
        (SELECT version FROM $SCHEMA.kb_version ORDER BY created_at DESC LIMIT 1)::text,
        (SELECT COUNT(*) FROM $SCHEMA.architecture_docs),
        (SELECT COUNT(*) FROM $SCHEMA.kb),
        'Incremental update: ${#CHANGED_FILES[@]} files'
''')
conn.commit()
cur.close()
conn.close()
PYTHON

date '+%Y-%m-%d %H:%M:%S' > "$LAST_RUN_FILE"
log "✅ Incremental update complete"
