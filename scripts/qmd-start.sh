#!/bin/bash
# NanoClaw — qmd memory server startup
# Registers group collections, embeds new/changed files, starts HTTP MCP daemon.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJ_DIR="$(dirname "$SCRIPT_DIR")"
GROUPS_DIR="$PROJ_DIR/groups"

# Resolve qmd binary from project node_modules
QMD="$PROJ_DIR/node_modules/.bin/qmd"
if [ ! -x "$QMD" ]; then
  echo "qmd not found at $QMD — run 'npm install' first"
  exit 1
fi

# Register each group folder as a qmd collection
for dir in "$GROUPS_DIR"/*/; do
  [ -d "$dir" ] || continue
  name=$(basename "$dir")
  "$QMD" collection add "$dir" --name "$name" 2>/dev/null || true
done

# Discover new/changed files, then create vector embeddings
"$QMD" update
"$QMD" embed

# Warm up search models by running a test query
# First run downloads reranker (~640MB) and query expansion (~1.3GB) models — may take a few minutes
echo "Warming up search models (first run downloads ~1.9GB, this may take a few minutes)..."
"$QMD" query --json "test" >/dev/null 2>&1 || true
echo "Search models ready."

# Start HTTP MCP daemon (used by WebUI search test)
"$QMD" mcp --http --daemon --port 8181
echo "qmd memory server started on port 8181"
