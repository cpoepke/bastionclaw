# NanoClaw Debug Checklist

## Known Issues (2026-02-08)

### 1. [FIXED] Resume branches from stale tree position
When agent teams spawns subagent CLI processes, they write to the same session JSONL. On subsequent `query()` resumes, the CLI reads the JSONL but may pick a stale branch tip (from before the subagent activity), causing the agent's response to land on a branch the host never receives a `result` for. **Fix**: pass `resumeSessionAt` with the last assistant message UUID to explicitly anchor each resume.

### 2. IDLE_TIMEOUT == CONTAINER_TIMEOUT (both 30 min)
Both timers fire at the same time, so containers always exit via hard SIGKILL (code 137) instead of graceful `_close` sentinel shutdown. The idle timeout should be shorter (e.g., 5 min) so containers wind down between messages, while container timeout stays at 30 min as a safety net for stuck agents.

### 3. Cursor advanced before agent succeeds
`processGroupMessages` advances `lastAgentTimestamp` before the agent runs. If the container times out, retries find no messages (cursor already past them). Messages are permanently lost on timeout.

## Quick Status Check

```bash
# 1. Is the service running?
launchctl list | grep nanoclaw
# Expected: PID  0  com.nanoclaw (PID = running, "-" = not running, non-zero exit = crashed)

# 2. Detect runtime
RUNTIME=$(command -v container &>/dev/null && echo "container" || echo "docker")
echo "Runtime: $RUNTIME"

# 3. Any running/orphaned containers?
if [ "$RUNTIME" = "container" ]; then
  container ls -a --format '{{.Names}} {{.Status}}' 2>/dev/null | grep nanoclaw
else
  docker ps -a --format '{{.Names}} {{.Status}}' --filter "name=nanoclaw-" 2>/dev/null
fi

# 4. Recent errors in service log?
grep -E 'ERROR|WARN' logs/nanoclaw.log | tail -20

# 5. Is Telegram bot connected? (look for last connection event)
grep -E 'Telegram bot connected|Telegram bot error|bot.*connected' logs/nanoclaw.log | tail -5

# 6. Are groups loaded?
grep 'groupCount' logs/nanoclaw.log | tail -3
```

## Session Transcript Branching

```bash
# Check for concurrent CLI processes in session debug logs
ls -la data/sessions/<group>/.claude/debug/

# Count unique SDK processes that handled messages
# Each .txt file = one CLI subprocess. Multiple = concurrent queries.

# Check parentUuid branching in transcript
python3 -c "
import json, sys
lines = open('data/sessions/<group>/.claude/projects/-workspace-group/<session>.jsonl').read().strip().split('\n')
for i, line in enumerate(lines):
  try:
    d = json.loads(line)
    if d.get('type') == 'user' and d.get('message'):
      parent = d.get('parentUuid', 'ROOT')[:8]
      content = str(d['message'].get('content', ''))[:60]
      print(f'L{i+1} parent={parent} {content}')
  except: pass
"
```

## Container Timeout Investigation

```bash
# Check for recent timeouts
grep -E 'Container timeout|timed out' logs/nanoclaw.log | tail -10

# Check container log files for the timed-out container
ls -lt groups/*/logs/container-*.log | head -10

# Read the most recent container log (replace path)
cat groups/<group>/logs/container-<timestamp>.log

# Check if retries were scheduled and what happened
grep -E 'Scheduling retry|retry|Max retries' logs/nanoclaw.log | tail -10
```

## Agent Not Responding

```bash
# Check if messages are being received from Telegram
grep -E 'New messages|Telegram message stored' logs/nanoclaw.log | tail -10

# Check if messages are being processed (container spawned)
grep -E 'Processing messages|Spawning container' logs/nanoclaw.log | tail -10

# Check if messages are being piped to active container
grep -E 'Piped messages|sendMessage' logs/nanoclaw.log | tail -10

# Check the queue state — any active containers?
grep -E 'Starting container|Container active|concurrency limit' logs/nanoclaw.log | tail -10

# Check lastAgentTimestamp vs latest message timestamp
sqlite3 store/messages.db "SELECT chat_jid, MAX(timestamp) as latest FROM messages GROUP BY chat_jid ORDER BY latest DESC LIMIT 5;"
```

## Container Mount Issues

```bash
# Check mount validation logs (shows on container spawn)
grep -E 'Mount validated|Mount.*REJECTED|mount' logs/nanoclaw.log | tail -10

# Verify the mount allowlist is readable
cat ~/.config/nanoclaw/mount-allowlist.json

# Check group's container_config in DB
sqlite3 store/messages.db "SELECT name, container_config FROM registered_groups;"

# Test-run a container to check mounts (dry run)
RUNTIME=$(command -v container &>/dev/null && echo "container" || echo "docker")
$RUNTIME run --rm --entrypoint ls nanoclaw-agent:latest /workspace/extra/
```

## Telegram Bot Issues

```bash
# Verify bot token is valid
TOKEN=$(grep "^TELEGRAM_BOT_TOKEN=" .env | cut -d= -f2)
curl -s "https://api.telegram.org/bot${TOKEN}/getMe" | python3 -m json.tool

# Check if bot is polling
grep -E 'Telegram bot|grammy' logs/nanoclaw.log | tail -10

# Check registered Telegram chats
sqlite3 store/messages.db "SELECT * FROM registered_groups WHERE jid LIKE 'tg:%'"

# Secrets are passed via stdin JSON (not env vars or mounted files)
# Check for auth errors in container logs:
ls -t groups/main/logs/container-*.log | head -1 | xargs grep -i "auth\|login\|key\|token" 2>/dev/null | tail -5
```

## Service Management

```bash
# Clean restart (recommended — stops orphaned containers, frees ports, restarts service)
./scripts/restart.sh

# Rebuild host + container image, then clean restart
./scripts/restart.sh --build

# View live logs
tail -f logs/nanoclaw.log
```

**Note:** Always prefer `scripts/restart.sh` over raw launchctl/systemctl commands. Raw service restarts leave orphaned containers running and can cause port conflicts (EADDRINUSE on 3100). The restart script auto-detects Apple Container vs Docker and launchd vs systemd.
