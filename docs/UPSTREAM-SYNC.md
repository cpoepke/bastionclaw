# Upstream Sync: NanoClaw → BastionClaw

Last synced: 2026-02-23
Upstream: ~60 commits analyzed
Commits: `751325d` (initial port), `c5c3f0a` (read-only hardening + dedup IPC)

## Approach

Manual cherry-pick of individual fixes (NOT a git merge of upstream/main). The codebases have diverged too heavily in `index.ts`, `db.ts`, and `ipc.ts` for a clean merge. Each fix was applied by hand to BastionClaw's versions of the affected files.

BastionClaw has significant additions not present upstream: Telegram channel, WebUI, qmd semantic memory, insight engine, Apple Container auto-detection. These files were preserved untouched.

---

## What Was Ported

### Priority 1: Security Fixes (CRITICAL)

#### 1a. Read-only project root mount (upstream: 5fb1064)

**Vulnerability:** Project root was mounted read-write into containers. A compromised agent could modify `dist/container-runner.js` to inject additional mounts on next restart, achieving full sandbox escape.

**Fix:** Changed `readonly: false` to `readonly: true` for the project root mount in `src/container-runner.ts`.

**Follow-up required:** The read-only mount broke the container agent's ability to run dedup and write to the DB directly. Fixed by:
- Adding `dedup_insights` IPC handler on host (fire-and-forget spawn, no timeout)
- Adding `dedup_insights` MCP tool for container agents
- Updating agent CLAUDE.md to document read-only mount and IPC-only DB mutations
- All DB writes from containers now go through IPC/MCP tools (add_insight, link_insight_source, dedup_insights, etc.)

**Files changed:** `src/container-runner.ts`, `src/ipc.ts`, `container/agent-runner/src/ipc-mcp-stdio.ts`, `groups/main/CLAUDE.md`

#### 1b. Block group folder path escapes (upstream: 2e1c768)

**Vulnerability:** Group folder names from the DB used in `path.join(GROUPS_DIR, folder)` without validation. A malicious `register_group` IPC call with `folder: "../../etc"` escapes the groups directory.

**Fix:** Created `src/group-folder.ts` with:
- `isValidGroupFolder()` — regex allowlist: `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`
- `resolveGroupFolderPath()` / `resolveGroupIpcPath()` — throw if resolved path escapes base dir

Added validation at 6 call sites: `src/db.ts`, `src/ipc.ts`, `src/index.ts`, `src/container-runner.ts`, `src/task-scheduler.ts`.

**Files changed:** `src/group-folder.ts` (new), `src/db.ts`, `src/ipc.ts`, `src/index.ts`, `src/container-runner.ts`, `src/task-scheduler.ts`

---

### Priority 2: Bug Fixes (HIGH)

#### 2a. Filter empty messages from DB polling (upstream: e59856f)

**Bug:** Empty WhatsApp messages (delivery receipts, encryption key distribution) stored in DB triggered unnecessary container agent spawns.

**Fix:** Added `AND content != '' AND content IS NOT NULL` to `getNewMessages()` and `getMessagesSince()` queries.

**Files changed:** `src/db.ts`

#### 2b. Pass host timezone to containers (upstream: 77f7423)

**Bug:** Containers run in UTC; host interprets timestamps as local time. Scheduled "once" tasks fired at wrong times.

**Fix:**
- Added `-e TZ=${TIMEZONE}` to container args in `src/container-runner.ts`
- Added validation in `container/agent-runner/src/ipc-mcp-stdio.ts` to reject `Z`-suffixed or `+HH:MM`-offset timestamps in `schedule_task` "once" type (forces local time)

**Files changed:** `src/container-runner.ts`, `container/agent-runner/src/ipc-mcp-stdio.ts`

#### 2c. Add .catch() handlers to fire-and-forget async calls (upstream: 5f58941)

**Bug:** Unhandled promise rejections on WhatsApp disconnect or container failure crashed the Node process.

**Fix:**
- Added `.catch()` to `startMessageLoop()` call in `src/index.ts` (fatal + process.exit)
- Added `.catch()` to all `runForGroup()` and `runTask()` calls in `src/group-queue.ts` (7 sites)

**Files changed:** `src/index.ts`, `src/group-queue.ts`

#### 2d. Fix skill subdirectory copy crash (upstream: d336b32)

**Bug:** Skills with subdirectories crashed `copyFileSync` with EISDIR.

**Fix:** Replaced `copyFileSync` loop with `fs.cpSync(srcDir, dstDir, { recursive: true })`.

**Files changed:** `src/container-runner.ts`

#### 2e. Pause malformed scheduled tasks (upstream: 02d8528)

**Bug:** Tasks with invalid group folders failed and immediately retried forever.

**Fix:** Added auto-pause (`status: 'paused'`) when group folder validation fails in `runTask()`. Also auto-pauses when the group is not found in registered groups.

**Files changed:** `src/task-scheduler.ts`

---

### Priority 3: Bug Fixes (MODERATE)

#### 3a. Idle preemption fix (upstream: 93bb94f + c6b69e8)

**Bug:** `enqueueTask()` unconditionally called `closeStdin()` on active containers, killing mid-work containers instead of only idle ones. Task containers also used the full 30-min IDLE_TIMEOUT instead of a short close delay.

**Fix:**
- Added `idleWaiting` and `isTaskContainer` flags to GroupState
- Added `notifyIdle()` method; gated `closeStdin()` on `idleWaiting === true`
- `sendMessage()` resets `idleWaiting = false`
- Task containers use 10s `TASK_CLOSE_DELAY_MS` instead of 30-min IDLE_TIMEOUT

**Files changed:** `src/group-queue.ts`, `src/index.ts`, `src/task-scheduler.ts`

#### 3b. WhatsApp type safety + error logging (upstream: 9fb1790)

**Fix:** Typed disconnect error interface, changed `sendPresenceUpdate` to fire-and-forget with `.catch()`.

**Files changed:** `src/channels/whatsapp.ts`

---

## What Was Skipped

| Upstream Change | Why Skipped |
|---|---|
| Skills engine v0.1 (51788de) | ~1,200 LOC three-way merge system for patching host source files. BastionClaw's skills are agent prompts (SKILL.md), not source patches — fundamentally different abstraction. Multi-week port with heavy conflicts. |
| Container runtime extraction (c6e1bfe) | BastionClaw's `getContainerRuntime()` auto-detection already works for both Docker and Apple Container. |
| Docker as default (607623a) | BastionClaw auto-detects runtime. No switching needed. |
| `/update` skill (1216b5b) | Depends on skills engine (skipped above). |
| `/convert-to-apple-container` (7181c49) | Not needed — BastionClaw auto-detects Apple Container. |
| Cross-platform setup (8fc1c23) | BastionClaw uses `/setup` skill via Claude Code. Different approach. |
| Voice transcription skills engine format (a407216) | Requires skills engine. |
| Skills path-remap escape fixes (856f980, ccef3bb) | No `skills-engine/` in BastionClaw. Not applicable. |
| Multi-channel infrastructure (part of 51788de) | BastionClaw already has this (Telegram + WebUI + WhatsApp). |
| `AskUserQuestion` in skills (264f855) | Nice-to-have but cosmetic. Can revisit independently. |

---

## Files Preserved (BastionClaw-only, no upstream equivalent)

- `src/qmd.ts`, `src/qmd-watcher.ts` — semantic memory
- `src/channels/telegram.ts`, `src/channels/webui.ts` — additional channels
- `src/webui/` — entire WebUI directory
- All insight-related code in `src/db.ts` and `src/ipc.ts`
- `container/agent-runner/src/ipc-mcp-stdio.ts` — insight/qmd MCP tools (only timestamp validation touched in 2b, dedup tool added in follow-up)

---

## Post-Sync Fixes

After the initial port, testing revealed issues that required additional work:

1. **Read-only mount broke dedup** — The dedup script (`scripts/dedup-insights.py`) writes directly to sqlite3. With the project root read-only, this fails inside containers. Fixed by adding a `dedup_insights` IPC handler that runs the script on the host as a fire-and-forget detached process (no timeout limit, survives container shutdown).

2. **Agent CLAUDE.md needed updating** — The container agent's instructions told it to use `sqlite3` directly for DB writes. Updated to document the read-only mount and direct all mutations through IPC/MCP tools.

3. **Hardcoded absolute paths** — Several Python scripts and skill docs had hardcoded `/Users/allenharper/bastionclaw/` paths. Replaced with `__file__`-relative paths and container-aware detection (`/workspace/group` vs `groups/main/`).

---

## Verification Performed

- `npm run build` — TypeScript compiles clean
- `./scripts/restart.sh --build` — full rebuild + restart
- Container agent spawns and responds via Telegram
- `dedup_insights` MCP tool triggers host-side dedup via IPC (fire-and-forget)
- Dedup completes on 1,756 insights (all checked, 0 duplicates merged)
- Scheduled task execution works with timezone fix
- WebUI dashboard, chat, and insight views functional
