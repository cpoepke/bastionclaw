#!/bin/bash
# NanoClaw Hard Shell — Clean restart
# Stops all orphaned containers, kills stale processes, rebuilds, and restarts the service.
#
# Usage:
#   ./scripts/restart.sh          # Restart service only
#   ./scripts/restart.sh --build  # Rebuild host + container, then restart

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

BUILD=false
if [ "$1" = "--build" ]; then
  BUILD=true
fi

echo "=== NanoClaw Clean Restart ==="

# 1. Stop the launchd service
echo "[1/6] Stopping service..."
launchctl bootout gui/$(id -u)/com.nanoclaw 2>/dev/null || true
sleep 1

# 2. Kill any orphaned nanoclaw Node processes
echo "[2/6] Killing orphaned processes..."
pkill -f "node.*dist/index.js" 2>/dev/null || true
pkill -f "node.*nanoclaw" 2>/dev/null || true

# 3. Free port 3100 (WebUI)
echo "[3/6] Freeing port 3100..."
lsof -ti :3100 2>/dev/null | xargs kill -9 2>/dev/null || true

# 4. Stop all nanoclaw containers
echo "[4/6] Stopping orphaned containers..."
for c in $(container ls -a --format '{{.Names}}' 2>/dev/null | grep nanoclaw || true); do
  echo "  Stopping: $c"
  container stop "$c" 2>/dev/null || true
  container rm "$c" 2>/dev/null || true
done

# 5. Rebuild if requested
if [ "$BUILD" = true ]; then
  echo "[5/6] Rebuilding..."
  echo "  Host TypeScript..."
  npm run build

  echo "  Container image (clean)..."
  container builder stop 2>/dev/null; container builder rm 2>/dev/null; container builder start 2>/dev/null
  ./container/build.sh

  echo "  Verifying container..."
  container run --rm --entrypoint ls nanoclaw-agent:latest /app/src/
else
  echo "[5/6] Skipping build (use --build to rebuild)"
fi

# 6. Start the service
echo "[6/6] Starting service..."
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nanoclaw.plist 2>/dev/null || true
launchctl kickstart gui/$(id -u)/com.nanoclaw 2>/dev/null || true
sleep 2

# Verify
PID=$(launchctl list | grep com.nanoclaw | awk '{print $1}')
if [ "$PID" != "-" ] && [ -n "$PID" ]; then
  echo ""
  echo "=== NanoClaw running (PID: $PID) ==="
  echo "Logs: tail -f logs/nanoclaw.log"
else
  echo ""
  echo "=== WARNING: Service may not have started ==="
  echo "Check: launchctl list | grep nanoclaw"
  echo "Logs:  cat logs/nanoclaw.error.log"
fi
