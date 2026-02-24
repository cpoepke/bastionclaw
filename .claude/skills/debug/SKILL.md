---
name: debug
description: Debug container agent issues. Use when things aren't working, container fails, authentication problems, or to understand how the container system works. Covers logs, environment variables, mounts, and common issues.
---

# BastionClaw Container Debugging

This guide covers debugging the containerized agent execution system.

## Architecture Overview

```
Host (macOS/Linux)                    Container (Linux VM)
─────────────────────────────────────────────────────────────
src/container-runner.ts               container/agent-runner/
    │                                      │
    │ spawns container (auto-detects       │ runs Claude Agent SDK
    │ Apple Container or Docker)           │ with MCP servers
    │                                      │
    ├── groups/{folder} ───────────> /workspace/group
    ├── data/ipc/{folder} ────────> /workspace/ipc
    ├── data/sessions/{folder}/.claude/ ──> /home/node/.claude/ (isolated per-group)
    └── (main only) project root ──> /workspace/project
```

**Important:** The container runs as user `node` with `HOME=/home/node`. Session files must be mounted to `/home/node/.claude/` (not `/root/.claude/`) for session resumption to work.

## Log Locations

| Log | Location | Content |
|-----|----------|---------|
| **Main app logs** | `logs/bastionclaw.log` | Host-side WhatsApp, routing, container spawning |
| **Main app errors** | `logs/bastionclaw.error.log` | Host-side errors |
| **Container run logs** | `groups/{folder}/logs/container-*.log` | Per-run: live-streamed stderr/stdout, completion summary |
| **Container live log** | `groups/{folder}/logs/latest.log` | Symlink to current/most-recent container log (tail -f) |
| **Claude sessions** | `~/.claude/projects/` | Claude Code session history |

## Enabling Debug Logging

Set `LOG_LEVEL=debug` for verbose output:

```bash
# For development
LOG_LEVEL=debug npm run dev

# For launchd service, add to plist EnvironmentVariables:
<key>LOG_LEVEL</key>
<string>debug</string>
```

Debug level shows:
- Full mount configurations
- Container command arguments
- Real-time container stderr

## Common Issues

### 1. "Claude Code process exited with code 1"

**Check the container log file** in `groups/{folder}/logs/container-*.log`

Common causes:

#### Missing Authentication
```
Invalid API key · Please run /login
```
**Fix:** Ensure `.env` file exists with either OAuth token or API key:
```bash
cat .env  # Should show one of:
# CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...  (subscription)
# ANTHROPIC_API_KEY=sk-ant-api03-...        (pay-per-use)
```

#### Root User Restriction
```
--dangerously-skip-permissions cannot be used with root/sudo privileges
```
**Fix:** Container must run as non-root user. Check Dockerfile has `USER node`.

### 2. Environment Variables / Secrets

Secrets (CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY) are passed via stdin JSON, not as env vars or mounted files. The container deletes the temp input file immediately after reading it.

To verify secrets are being read correctly, check the container logs for authentication errors.

### 3. Mount Issues

**Runtime differences:**
- **Apple Container:** Only mounts directories, not individual files. Uses `--mount` for readonly, `-v` for read-write.
- **Docker:** Supports both files and directories. Uses `-v path:path:ro` for readonly.

BastionClaw auto-detects which runtime you're using and applies the correct mount syntax.

To check what's mounted inside a container, first detect your runtime:
```bash
RUNTIME=$(command -v container &>/dev/null && echo "container" || echo "docker")
$RUNTIME run --rm --entrypoint /bin/bash bastionclaw-agent:latest -c 'ls -la /workspace/'
```

Expected structure:
```
/workspace/
├── group/                # Current group folder (cwd)
├── project/              # Project root (main channel only)
├── global/               # Global CLAUDE.md (non-main only)
├── ipc/                  # Inter-process communication
│   ├── messages/         # Outgoing WhatsApp messages
│   ├── tasks/            # Scheduled task commands
│   ├── current_tasks.json    # Read-only: scheduled tasks visible to this group
│   └── available_groups.json # Read-only: WhatsApp groups for activation (main only)
└── extra/                # Additional custom mounts
```

### 4. Permission Issues

The container runs as user `node` (uid 1000). Check ownership:
```bash
RUNTIME=$(command -v container &>/dev/null && echo "container" || echo "docker")
$RUNTIME run --rm --entrypoint /bin/bash bastionclaw-agent:latest -c '
  whoami
  ls -la /workspace/
  ls -la /app/
'
```

All of `/workspace/` and `/app/` should be owned by `node`.

### 5. Session Not Resuming / "Claude Code process exited with code 1"

If sessions aren't being resumed (new session ID every time), or Claude Code exits with code 1 when resuming:

**Root cause:** The SDK looks for sessions at `$HOME/.claude/projects/`. Inside the container, `HOME=/home/node`, so it looks at `/home/node/.claude/projects/`.

**Check the mount path:**
```bash
# In container-runner.ts, verify mount is to /home/node/.claude/, NOT /root/.claude/
grep -A3 "Claude sessions" src/container-runner.ts
```

**Verify sessions are accessible:**
```bash
RUNTIME=$(command -v container &>/dev/null && echo "container" || echo "docker")
$RUNTIME run --rm --entrypoint /bin/bash \
  -v ~/.claude:/home/node/.claude \
  bastionclaw-agent:latest -c '
echo "HOME=$HOME"
ls -la $HOME/.claude/projects/ 2>&1 | head -5
'
```

**Fix:** Ensure `container-runner.ts` mounts to `/home/node/.claude/`:
```typescript
mounts.push({
  hostPath: claudeDir,
  containerPath: '/home/node/.claude',  // NOT /root/.claude
  readonly: false
});
```

### 6. MCP Server Failures

If an MCP server fails to start, the agent may exit. Check the container logs for MCP initialization errors.

## Manual Container Testing

For all commands below, first detect your runtime:
```bash
RUNTIME=$(command -v container &>/dev/null && echo "container" || echo "docker")
```

### Test the full agent flow:
```bash
mkdir -p groups/test
echo '{"prompt":"What is 2+2?","groupFolder":"test","chatJid":"test@g.us","isMain":false}' | \
  $RUNTIME run -i \
  -v $(pwd)/groups/test:/workspace/group \
  -v $(pwd)/data/ipc:/workspace/ipc \
  bastionclaw-agent:latest
```

### Interactive shell in container:
```bash
$RUNTIME run --rm -it --entrypoint /bin/bash bastionclaw-agent:latest
```

## SDK Options Reference

The agent-runner uses these Claude Agent SDK options:

```typescript
query({
  prompt: input.prompt,
  options: {
    cwd: '/workspace/group',
    allowedTools: ['Bash', 'Read', 'Write', ...],
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,  // Required with bypassPermissions
    settingSources: ['project'],
    mcpServers: { ... }
  }
})
```

**Important:** `allowDangerouslySkipPermissions: true` is required when using `permissionMode: 'bypassPermissions'`. Without it, Claude Code exits with code 1.

## Rebuilding After Changes

```bash
# Full rebuild (host + UI + container) and restart
./scripts/restart.sh --build

# Or manually:
npm run build                      # Host TypeScript
cd ui && npm install && npm run build && cd ..  # WebUI frontend
./container/build.sh               # Container image (auto-detects runtime)
```

## Checking Container Image

```bash
RUNTIME=$(command -v container &>/dev/null && echo "container" || echo "docker")

# List images
$RUNTIME images | grep bastionclaw

# Check what's in the image
$RUNTIME run --rm --entrypoint /bin/bash bastionclaw-agent:latest -c '
  echo "=== Node version ==="
  node --version

  echo "=== Installed packages ==="
  ls /app/node_modules/
'
```

## Session Persistence

Claude sessions are stored per-group in `data/sessions/{group}/.claude/` for security isolation. Each group has its own session directory, preventing cross-group access to conversation history.

**Critical:** The mount path must match the container user's HOME directory:
- Container user: `node`
- Container HOME: `/home/node`
- Mount target: `/home/node/.claude/` (NOT `/root/.claude/`)

To clear sessions:

```bash
# Clear all sessions for all groups
rm -rf data/sessions/

# Clear sessions for a specific group
rm -rf data/sessions/{groupFolder}/.claude/

# Also clear the session ID from BastionClaw's tracking (stored in SQLite)
sqlite3 store/messages.db "DELETE FROM sessions WHERE group_folder = '{groupFolder}'"
```

To verify session resumption is working, check the logs for the same session ID across messages:
```bash
grep "Session initialized" logs/bastionclaw.log | tail -5
# Should show the SAME session ID for consecutive messages in the same group
```

## IPC Debugging

The container communicates back to the host via files in `/workspace/ipc/`:

```bash
# Check pending messages
ls -la data/ipc/messages/

# Check pending task operations
ls -la data/ipc/tasks/

# Read a specific IPC file
cat data/ipc/messages/*.json

# Check available groups (main channel only)
cat data/ipc/main/available_groups.json

# Check current tasks snapshot
cat data/ipc/{groupFolder}/current_tasks.json
```

**IPC file types:**
- `messages/*.json` - Agent writes: outgoing WhatsApp messages
- `tasks/*.json` - Agent writes: task operations (schedule, pause, resume, cancel, refresh_groups)
- `current_tasks.json` - Host writes: read-only snapshot of scheduled tasks
- `available_groups.json` - Host writes: read-only list of WhatsApp groups (main only)

## Monitoring Running Container Agents

When an agent is actively running (e.g. during a scheduled task like refresh-insights), use these steps to check progress:

### 1. Verify container is running
```bash
RUNTIME=$(command -v container &>/dev/null && echo "container" || echo "docker")
$RUNTIME list 2>/dev/null || $RUNTIME ps 2>/dev/null
# Look for containers named bastionclaw-{group}-{timestamp}
```

### 2. Tail real-time container logs
```bash
# Follow live output from the running agent (fastest way to monitor)
tail -f groups/{group_folder}/logs/latest.log

# Or find a specific log file
ls -lt groups/{group_folder}/logs/container-*.log | head -3
```
The `latest.log` symlink points to the current container's log file, created at spawn time. Shows stderr from the agent in real-time and a completion summary when the container exits.

### 3. Check processes inside the container
```bash
$RUNTIME exec bastionclaw-main-{timestamp} ps aux
# Key processes: claude (the agent), node /tmp/dist/index.js (runner)
```

### 4. Check IPC activity from inside the container
```bash
# Current task state visible to the agent
$RUNTIME exec bastionclaw-main-{timestamp} cat /workspace/ipc/current_tasks.json

# Outbound messages (files appear briefly then get consumed by host)
ls -lt data/ipc/{group_folder}/messages/
```

### 5. Check task execution status in DB
```bash
# Current task state
sqlite3 store/messages.db "SELECT id, status, last_run, substr(last_result,1,200) FROM scheduled_tasks WHERE id = 'TASK_ID'"

# Detailed run history
sqlite3 store/messages.db "SELECT run_at, duration_ms, status, substr(result,1,200) FROM task_run_logs WHERE task_id = 'TASK_ID' ORDER BY run_at DESC LIMIT 5"
```

### 6. Check for new data being written (e.g. insight pipeline)
```bash
# New insight sources since a timestamp
sqlite3 store/messages.db "SELECT title, indexed_at FROM insight_sources WHERE indexed_at >= '2026-02-22T01:00' ORDER BY indexed_at DESC"

# New insights since a timestamp
sqlite3 store/messages.db "SELECT substr(text,1,80), category, first_seen FROM insights WHERE first_seen >= '2026-02-22T01:00' ORDER BY first_seen DESC LIMIT 20"
```


## Quick Diagnostic Script

Run this to check common issues:

```bash
echo "=== Checking BastionClaw Container Setup ==="

RUNTIME=$(command -v container &>/dev/null && echo "container" || echo "docker")
echo "Runtime: $RUNTIME"

echo -e "\n1. Authentication configured?"
[ -f .env ] && (grep -q "CLAUDE_CODE_OAUTH_TOKEN=sk-" .env || grep -q "ANTHROPIC_API_KEY=sk-" .env) && echo "OK" || echo "MISSING - add CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY to .env"

echo -e "\n2. Container runtime running?"
if [ "$RUNTIME" = "container" ]; then
  container system status &>/dev/null && echo "OK" || echo "NOT RUNNING - run: container system start"
else
  docker info &>/dev/null && echo "OK" || echo "NOT RUNNING - start Docker Desktop or: sudo systemctl start docker"
fi

echo -e "\n3. Container image exists?"
$RUNTIME images bastionclaw-agent:latest --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -q bastionclaw && echo "OK" || echo "MISSING - run ./container/build.sh"

echo -e "\n4. Session mount path correct?"
grep -q "/home/node/.claude" src/container-runner.ts 2>/dev/null && echo "OK" || echo "WRONG - should mount to /home/node/.claude/, not /root/.claude/"

echo -e "\n5. Groups directory?"
ls -la groups/ 2>/dev/null || echo "MISSING - run setup"

echo -e "\n6. WebUI built?"
[ -f ui/dist/index.html ] && echo "OK" || echo "MISSING - run: cd ui && npm install && npm run build"

echo -e "\n7. Recent container logs?"
ls -t groups/*/logs/container-*.log 2>/dev/null | head -3 || echo "No container logs yet"

echo -e "\n8. Session continuity working?"
SESSIONS=$(grep "Session initialized" logs/bastionclaw.log 2>/dev/null | tail -5 | awk '{print $NF}' | sort -u | wc -l)
[ "$SESSIONS" -le 2 ] && echo "OK (recent sessions reusing IDs)" || echo "CHECK - multiple different session IDs, may indicate resumption issues"
```
