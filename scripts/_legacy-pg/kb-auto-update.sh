#!/bin/bash
# Knowledge Base Auto-Update Hook
# Runs on session start to check for and ingest new documentation
#
# Usage: Add to ~/.claude/hooks/ as session-start hook
# Or run manually: ./scripts/kb-auto-update.sh

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KB_DIR="$PROJECT_DIR/.ruvector/knowledge-base"
EXTRACTION_DIR="/tmp/ruvnet-kb-extraction"
LAST_UPDATE_FILE="$KB_DIR/.last-update"

echo "🧠 Knowledge Base Auto-Update Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check if knowledge base exists
if [ ! -f "$KB_DIR/manifest.json" ]; then
    echo "⚠️  No knowledge base found. Run ingestion first."
    exit 0
fi

# Get current vector count
VECTOR_COUNT=$(grep -o '"vectorCount": [0-9]*' "$KB_DIR/manifest.json" | grep -o '[0-9]*')
echo "📊 Current vectors: $VECTOR_COUNT"

# Check last update time
if [ -f "$LAST_UPDATE_FILE" ]; then
    LAST_UPDATE=$(cat "$LAST_UPDATE_FILE")
    echo "📅 Last update: $LAST_UPDATE"
else
    echo "📅 Last update: Never recorded"
fi

# Check if extraction files exist and are newer
if [ -d "$EXTRACTION_DIR" ]; then
    EXTRACTION_FILES=$(find "$EXTRACTION_DIR" -name "*.md" -newer "$LAST_UPDATE_FILE" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$EXTRACTION_FILES" -gt 0 ]; then
        echo "🔄 Found $EXTRACTION_FILES updated extraction files"
        echo "   Run: node scripts/ingest-knowledge-base.js"
    else
        echo "✅ Knowledge base is up to date"
    fi
else
    echo "ℹ️  No extraction directory found"
fi

# Update timestamp
echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" > "$LAST_UPDATE_FILE"

echo ""
echo "📁 Knowledge Base: $KB_DIR"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
