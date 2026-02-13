<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="NanoClaw Hard Shell" width="400">
</p>

<p align="center">
  A personal Claude assistant that runs securely in containers. Forked from <a href="https://github.com/qwibitai/nanoclaw">NanoClaw</a> with Telegram as the default channel, a built-in web control panel, and cybersecurity-focused customizations.
</p>

## About This Fork

**NanoClaw Hard Shell** is a fork of [NanoClaw](https://github.com/qwibitai/nanoclaw), an awesome lightweight personal Claude assistant. This fork makes the following changes:

- **Telegram by default** — Uses Telegram Bot API (via Grammy) instead of WhatsApp as the primary channel
- **Web control panel** — Built-in Fastify + Lit web UI for monitoring, chat, and management
- **Cybersecurity hardening** — Additional tooling and configuration for security research workflows

All credit for the core architecture, container isolation model, skills system, and agent swarm support goes to the [upstream NanoClaw project](https://github.com/qwibitai/nanoclaw).

## Why NanoClaw Exists

The authors of [NanoClaw](https://github.com/qwibitai/nanoclaw) built it as a lightweight, secure alternative to [OpenClaw](https://github.com/openclaw/openclaw). OpenClaw has 52+ modules, 8 config management files, 45+ dependencies, and abstractions for 15 channel providers. Security is application-level (allowlists, pairing codes) rather than OS isolation. Everything runs in one Node process with shared memory.

NanoClaw gives you the same core functionality in a codebase you can understand in 8 minutes. One process. A handful of files. Agents run in actual Linux containers with filesystem isolation, not behind permission checks.

## Why I Forked It

I needed a personal Claude assistant tailored for cybersecurity work. NanoClaw's container isolation model and small codebase made it the ideal foundation. This fork adds:

- **Telegram-first setup** — Official bot API is more reliable than WhatsApp's unofficial library, and better suited for automated workflows
- **Web control panel** — Full browser-based UI for monitoring agent sessions, managing tasks, viewing logs, and chatting directly with the agent without needing a phone
- **Security research tooling** — Custom skills and configurations for penetration testing, threat analysis, and security automation workflows

The upstream project's philosophy of "skills over features" means these customizations stay clean and maintainable.

## Quick Start

```bash
git clone https://github.com/harperaa/nanoclaw-hard-shell.git
cd nanoclaw-hard-shell
claude
```

Then run `/setup`. Claude Code handles everything: dependencies, Telegram bot creation, container setup, service configuration.

## What It Supports

- **Telegram I/O** — Message your agent from your phone (WhatsApp also supported via `/add-whatsapp` skill)
- **Isolated group context** — Each group has its own `CLAUDE.md` memory, isolated filesystem, and runs in its own container sandbox with only that filesystem mounted
- **Main channel** — Your private channel (DM with bot) for admin control; every other group is completely isolated
- **Scheduled tasks** — Recurring jobs that run the agent and can message you back
- **Web access** — Search and fetch content
- **Container isolation** — Agents sandboxed in Apple Container (macOS) or Docker (macOS/Linux)
- **Agent Swarms** — Spin up teams of specialized agents that collaborate on complex tasks
- **Optional integrations** — Add Gmail (`/add-gmail`) and more via skills
- **Web control panel** — Browser-based UI for monitoring, chat, and management

## Web Interface

NanoClaw Hard Shell includes a built-in web control panel that starts automatically alongside the main process at `http://localhost:3100`.

### Tabs

| Group | Tabs | Purpose |
|-------|------|---------|
| **Chat** | Chat | Send messages to your agent directly from the browser. Spawns a container and streams the response in real-time via WebSocket. |
| **Dashboard** | Overview, Channels | System stats (uptime, queue depth, message counts) and channel health status. |
| **Operations** | Groups, Messages, Tasks, Sessions | Manage registered groups, browse message history, control scheduled tasks (pause/resume/delete), view active sessions. |
| **System** | Skills, Config, Logs, Debug | Full CRUD for skills, CLAUDE.md editor with per-group scope selector, in-memory log viewer with level filters, and system diagnostics (queue state, DB stats, process info). |

### How it works

The web server runs inside the same Node.js process as everything else — no separate service to manage. It uses Fastify for HTTP/WebSocket and serves a pre-built Lit frontend from `ui/dist/`.

- **REST API** (`/api/*`) for reads and mutations — calls `db.ts` functions directly
- **WebSocket** (`/ws`) for live events and chat streaming
- **Chat** sends messages through the same `GroupQueue` and `runContainerAgent` pipeline as Telegram messages, using a `web@chat` pseudo-JID

To rebuild the frontend after changes:

```bash
cd ui && npm install && npm run build
```

The port can be changed with the `WEBUI_PORT` environment variable (default: `3100`).

## Usage

Talk to your assistant with the trigger word (default: `@Kia`):

```
@Kia send an overview of the sales pipeline every weekday morning at 9am (has access to my Obsidian vault folder)
@Kia review the git history for the past week each Friday and update the README if there's drift
@Kia every Monday at 8am, compile news on AI developments from Hacker News and TechCrunch and message me a briefing
```

From the main channel (DM with bot), you can manage groups and tasks:
```
@Kia list all scheduled tasks across groups
@Kia pause the Monday briefing task
@Kia join the Family Chat group
```

## Customizing

There are no configuration files to learn. Just tell Claude Code what you want:

- "Change the trigger word to @Bob"
- "Remember in the future to make responses shorter and more direct"
- "Add a custom greeting when I say good morning"
- "Store conversation summaries weekly"

Or run `/customize` for guided changes.

The codebase is small enough that Claude can safely modify it.

## Contributing

Issues and PRs are welcome. If your change would also benefit the upstream project, please consider contributing it to [qwibitai/nanoclaw](https://github.com/qwibitai/nanoclaw) as well.

**Don't add features. Add skills.** See [upstream NanoClaw](https://github.com/qwibitai/nanoclaw) for the full philosophy.

## Requirements

- macOS or Linux
- Node.js 20+
- [Claude Code](https://claude.ai/download)
- [Apple Container](https://github.com/apple/container) (macOS) or [Docker](https://docker.com/products/docker-desktop) (macOS/Linux)
- A Telegram account (for creating a bot via [@BotFather](https://t.me/BotFather))

## Architecture

```
Channels (Telegram/WhatsApp) --> SQLite --> Polling loop --> Container (Claude Agent SDK) --> Response
WebUI (localhost:3100)       --> REST API / WebSocket ----^
```

Single Node.js process. Agents execute in isolated Linux containers with mounted directories. Per-group message queue with concurrency control. IPC via filesystem. Built-in Fastify web server for the control panel.

Key files:
- `src/index.ts` - Orchestrator: state, message loop, agent invocation
- `src/channels/telegram.ts` - Telegram bot connection, send/receive
- `src/ipc.ts` - IPC watcher and task processing
- `src/router.ts` - Message formatting and outbound routing
- `src/group-queue.ts` - Per-group queue with global concurrency limit
- `src/container-runner.ts` - Spawns streaming agent containers
- `src/task-scheduler.ts` - Runs scheduled tasks
- `src/db.ts` - SQLite operations (messages, groups, sessions, state)
- `src/webui/server.ts` - Fastify server, API routes, WebSocket handler
- `ui/` - Lit + Vite frontend (built to `ui/dist/`)
- `groups/*/CLAUDE.md` - Per-group memory

## FAQ

**Why Telegram and not WhatsApp/Signal/etc?**

Telegram has an official bot API, making it the most reliable and easiest to set up. WhatsApp is also supported — run `/add-whatsapp` to add or switch to it. That's the whole point of the skills system.

**Why Apple Container instead of Docker?**

On macOS, Apple Container is lightweight, fast, and optimized for Apple silicon. But Docker is also fully supported — during `/setup`, you can choose which runtime to use. On Linux, Docker is used automatically.

**Can I run this on Linux?**

Yes. Run `/setup` and it will automatically configure Docker as the container runtime.

**Is this secure?**

Agents run in containers, not behind application-level permission checks. They can only access explicitly mounted directories. You should still review what you're running, but the codebase is small enough that you actually can. See [docs/SECURITY.md](docs/SECURITY.md) for the full security model.

**How do I debug issues?**

Run `claude`, then run `/debug`. Check `logs/nanoclaw.log` and `logs/nanoclaw.error.log` for details.

## Upstream

This project is a fork of [NanoClaw](https://github.com/qwibitai/nanoclaw) by [@gavrielc](https://github.com/gavrielc). Check out the upstream project for the original vision, community Discord, and contribution guidelines.

## License

MIT
