#!/bin/bash
# BastionClaw Hard Shell — Clean restart
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

# Auto-detect container runtime
if command -v container &>/dev/null; then
  RUNTIME="container"
elif command -v docker &>/dev/null && docker info &>/dev/null; then
  RUNTIME="docker"
else
  RUNTIME=""
fi

# Auto-detect service manager
if [ "$(uname)" = "Darwin" ]; then
  SERVICE_MGR="launchd"
elif command -v systemctl &>/dev/null; then
  SERVICE_MGR="systemd"
else
  SERVICE_MGR="none"
fi

echo "=== BastionClaw Clean Restart ==="
echo "  Runtime: ${RUNTIME:-none detected}"
echo "  Service: ${SERVICE_MGR}"

# 1. Stop the service
echo "[1/6] Stopping service..."
if [ "$SERVICE_MGR" = "launchd" ]; then
  launchctl bootout gui/$(id -u)/com.bastionclaw 2>/dev/null || true
elif [ "$SERVICE_MGR" = "systemd" ]; then
  systemctl --user stop bastionclaw 2>/dev/null || true
fi
sleep 1

# 2. Kill any orphaned bastionclaw Node processes
echo "[2/6] Killing orphaned processes..."
pkill -f "node.*dist/index.js" 2>/dev/null || true
pkill -f "node.*bastionclaw" 2>/dev/null || true

# 3. Free port 3100 (WebUI)
echo "[3/6] Freeing port 3100..."
lsof -ti :3100 2>/dev/null | xargs kill -9 2>/dev/null || true

# 4. Stop all bastionclaw containers (with timeout to avoid hangs)
echo "[4/6] Stopping orphaned containers..."
if [ -n "$RUNTIME" ]; then
  if [ "$RUNTIME" = "container" ]; then
    BASTIONCLAW_CONTAINERS=$(container ls --format json 2>/dev/null \
      | python3 -c "import sys,json; cs=json.load(sys.stdin); print('\n'.join(c['configuration']['id'] for c in cs if c['configuration']['id'].startswith('bastionclaw-')))" 2>/dev/null || true)
    for c in $BASTIONCLAW_CONTAINERS; do
      echo "  Stopping: $c (timeout 10s)..."
      # `container stop` hangs on stuck containers — use timeout + force kill
      timeout 10 container stop "$c" 2>/dev/null || {
        echo "  Stop hung, force killing via launchctl..."
        LPID=$(launchctl list 2>/dev/null | grep "$c" | awk '{print $1}')
        if [ -n "$LPID" ] && [ "$LPID" != "-" ]; then
          kill -9 "$LPID" 2>/dev/null || true
        fi
      }
    done
  else
    for c in $(docker ps -a --format '{{.Names}}' --filter "name=bastionclaw-" 2>/dev/null || true); do
      echo "  Stopping: $c"
      docker stop -t 5 "$c" 2>/dev/null || true
      docker rm -f "$c" 2>/dev/null || true
    done
  fi
fi

# 5a. Stop qmd memory server
QMD="$PROJECT_DIR/node_modules/.bin/qmd"
if [ -x "$QMD" ]; then
  echo "[5a] Stopping qmd memory server..."
  "$QMD" mcp stop 2>/dev/null || true
else
  echo "[5a] qmd not installed yet, skipping stop"
fi

# 5. Rebuild if requested
if [ "$BUILD" = true ]; then
  echo "[5/6] Rebuilding..."
  echo "  Host TypeScript..."
  npm run build

  echo "  UI frontend..."
  (cd ui && npm install && npm run build)

  echo "  Container image (clean)..."
  if [ "$RUNTIME" = "container" ]; then
    container builder stop 2>/dev/null; container builder rm 2>/dev/null; container builder start 2>/dev/null
  elif [ "$RUNTIME" = "docker" ]; then
    docker builder prune -f 2>/dev/null || true
  fi
  ./container/build.sh

  if [ "$RUNTIME" = "container" ]; then
    echo "  Verifying container..."
    container run --rm --entrypoint ls bastionclaw-agent:latest /app/src/
  elif [ "$RUNTIME" = "docker" ]; then
    echo "  Verifying container..."
    docker run --rm --entrypoint ls bastionclaw-agent:latest /app/src/
  fi
else
  echo "[5/6] Skipping build (use --build to rebuild)"
fi

# 5b. Start qmd memory server
echo "[5b] Starting qmd memory server..."
if [ -x "$QMD" ]; then
  "$SCRIPT_DIR/qmd-start.sh" || echo "  WARNING: qmd failed to start (non-fatal)"
else
  echo "  qmd not found, skipping (run 'npm install' to install dependencies)"
fi

# 6. Start the service
echo "[6/6] Starting service..."
if [ "$SERVICE_MGR" = "launchd" ]; then
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.bastionclaw.plist 2>/dev/null || true
  launchctl kickstart gui/$(id -u)/com.bastionclaw 2>/dev/null || true
  sleep 2

  # Verify
  PID=$(launchctl list | grep com.bastionclaw | awk '{print $1}')
  if [ "$PID" != "-" ] && [ -n "$PID" ]; then
    echo ""
    echo "=== BastionClaw running (PID: $PID) ==="
    echo "Logs: tail -f logs/bastionclaw.log"
  else
    echo ""
    echo "=== WARNING: Service may not have started ==="
    echo "Check: launchctl list | grep bastionclaw"
    echo "Logs:  cat logs/bastionclaw.error.log"
  fi
elif [ "$SERVICE_MGR" = "systemd" ]; then
  systemctl --user start bastionclaw 2>/dev/null || true
  sleep 2

  if systemctl --user is-active bastionclaw &>/dev/null; then
    echo ""
    echo "=== BastionClaw running ==="
    echo "Logs: journalctl --user -u bastionclaw -f"
  else
    echo ""
    echo "=== WARNING: Service may not have started ==="
    echo "Check: systemctl --user status bastionclaw"
  fi
else
  echo ""
  echo "No service manager detected. Start manually:"
  echo "  npm run start"
fi
