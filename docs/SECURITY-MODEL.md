# BastionClaw Security Model

## Trust Model

| Entity | Trust Level | Rationale |
|--------|-------------|-----------|
| Main group | Trusted | Private self-chat, admin control |
| Non-main groups | Untrusted | Other users may be malicious |
| Container agents | Sandboxed | Isolated execution environment |
| Channel messages | User input | Potential prompt injection |

For prompt injection risks and user responsibilities, see [PROMPT-INJECTION.md](PROMPT-INJECTION.md).

## Security Boundaries

### 1. Container Isolation (Primary Boundary)

Agents execute in Apple Container (lightweight Linux VMs), providing:
- **Process isolation** - Container processes cannot affect the host
- **Filesystem isolation** - Only explicitly mounted directories are visible
- **Non-root execution** - Runs as unprivileged `node` user (uid 1000)
- **Ephemeral containers** - Fresh environment per invocation (`--rm`)
- **Resource limits** - CPU (2 cores), memory (1GB), process count (256 via ulimit/pids-limit)
- **No shell interpolation** - All container commands use `execFile`/`execFileSync` (no shell invocation)

This is the primary security boundary. Rather than relying on application-level permission checks, the attack surface is limited by what's mounted.

### 2. Mount Security

**Read-Only Project Root** — The main group's project root mount is read-only, preventing a compromised agent from modifying host code (e.g., `dist/container-runner.js`) to inject mounts on next restart. The agent reads source and DB via the read-only mount; all mutations go through IPC/MCP tools processed by the trusted host.

**Group Folder Path Validation** — Group folder names are validated against a strict allowlist (`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`) before use in any `path.join()` call. The `resolveGroupFolderPath()` and `resolveGroupIpcPath()` helpers additionally verify the resolved path doesn't escape its base directory. Validation is enforced at all entry points: DB writes, IPC handlers, container mount construction, task scheduling, and group registration.

**External Allowlist** - Mount permissions stored at `~/.config/bastionclaw/mount-allowlist.json`, which is:
- Outside project root
- Never mounted into containers
- Cannot be modified by agents

**Default Blocked Patterns:**
```
.ssh, .gnupg, .aws, .azure, .gcloud, .kube, .docker,
credentials, .env, .netrc, .npmrc, id_rsa, id_ed25519,
private_key, .secret
```

**Protections:**
- Symlink resolution before validation (prevents traversal attacks)
- Container path validation (rejects `..` and absolute paths)
- `nonMainReadOnly` option forces read-only for non-main groups

### 3. Session Isolation

Each group has isolated Claude sessions at `data/sessions/{group}/.claude/`:
- Groups cannot see other groups' conversation history
- Session data includes full message history and file contents read
- Prevents cross-group information disclosure

### 4. IPC Authorization

Messages and task operations are verified against group identity:

| Operation | Main Group | Non-Main Group |
|-----------|------------|----------------|
| Send message to own chat | ✓ | ✓ |
| Send message to other chats | ✓ | ✗ |
| Schedule task for self | ✓ | ✓ |
| Schedule task for others | ✓ | ✗ |
| View all tasks | ✓ | Own only |
| Manage other groups | ✓ | ✗ |

### 5. Credential Handling

**Mounted Credentials:**
- Claude auth tokens (filtered from `.env`, read-only)

**NOT Mounted:**
- Channel session data (`store/auth/`) - host only
- Mount allowlist - external, never mounted
- Any credentials matching blocked patterns

**Credential Filtering:**
Only these environment variables are exposed to containers (passed via stdin, never written to disk):
```typescript
const allowedVars = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'TRANSCRIPT_API_KEY'];
```

> **Note:** These credentials are passed to the Claude SDK process environment so that Claude Code can authenticate and Bash tool calls can access API keys. The agent can discover these credentials via Bash. Ideally, Claude Code would authenticate without exposing credentials to the agent's execution environment. **PRs welcome** if you have ideas for credential isolation.

## Privilege Comparison

| Capability | Main Group | Non-Main Group |
|------------|------------|----------------|
| Project root access | `/workspace/project` (ro) | None |
| Group folder | `/workspace/group` (rw) | `/workspace/group` (rw) |
| Global memory | Read via project mount | `/workspace/global` (ro) |
| Additional mounts | Configurable | Read-only unless allowed |
| Network access | Unrestricted | Unrestricted |
| MCP tools | All | All |

## Process Stability

- **Unhandled rejection protection** — All fire-and-forget async calls (message loop, group queue drain, task execution) have `.catch()` handlers to prevent Node process crashes on disconnect or container failure.
- **Malformed task auto-pause** — Scheduled tasks with invalid group folders or missing groups are automatically paused instead of retry-looping indefinitely.
- **Idle preemption safety** — The task queue only signals idle containers to exit when new work arrives; containers actively processing messages are never preempted. Task containers use a short 10s close delay instead of the full 30-minute idle timeout.
- **Timezone consistency** — Containers receive the host's `TZ` environment variable. "Once" scheduled tasks reject UTC-suffixed timestamps to prevent timezone mismatch.
- **Empty message filtering** — Delivery receipts and encryption key distribution messages (empty content) are excluded from DB polling to prevent spurious agent spawns.

## Security Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        UNTRUSTED ZONE                             │
│  Inbound Messages (potentially malicious)                         │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼ Prompt injection sanitization,
                                   trigger check, input escaping
┌──────────────────────────────────────────────────────────────────┐
│                     HOST PROCESS (TRUSTED)                        │
│  • Message routing                                                │
│  • IPC authorization                                              │
│  • Mount validation (external allowlist)                          │
│  • Container lifecycle                                            │
│  • Credential filtering                                           │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼ Explicit mounts only
┌──────────────────────────────────────────────────────────────────┐
│                CONTAINER (ISOLATED/SANDBOXED)                     │
│  • Agent execution                                                │
│  • Bash commands (sandboxed)                                      │
│  • File operations (limited to mounts)                            │
│  • Network access (unrestricted)                                  │
│  • Cannot modify security config                                  │
└──────────────────────────────────────────────────────────────────┘
```
