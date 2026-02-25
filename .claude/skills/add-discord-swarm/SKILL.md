---
name: add-discord-swarm
description: Add Agent Swarm (Teams) support to Discord. Each subagent gets its own identity via webhooks. Requires Discord channel to be set up first (use /add-discord).
allowed-tools: Bash(*), Read, Edit, Write, Glob, Grep, AskUserQuestion
---

# Add Discord Swarm (Agent Teams)

**UX Rule:** Use `AskUserQuestion` for ALL interactions with the user. Never just output questions as text — always use the tool so the user gets structured prompts with selectable options.

Add multi-agent swarm support to Discord. Each subagent appears as a distinct identity with its own username and avatar via Discord webhooks.

## Phase 0: Prerequisites

Check that Discord channel is already set up:

```bash
# 1. discord.ts exists
ls src/channels/discord.ts

# 2. DISCORD_BOT_TOKEN is configured
grep -q "DISCORD_BOT_TOKEN" .env && echo "OK: token present" || echo "MISSING: run /add-discord first"

# 3. At least one dc: group is registered
sqlite3 store/messages.db "SELECT jid, name FROM registered_groups WHERE jid LIKE 'dc:%'" | head -5
```

If Discord is not set up, tell the user to run `/add-discord` first and stop.

## Phase 1: Discovery (Interactive)

### Step 1: Understand the use case

AskUserQuestion: "What are you trying to accomplish with your bot team? Describe the kind of tasks you want the team to handle."
- Listen to their answer, suggest improvements, identify gaps

### Step 2: Recommend team composition

Based on their use case, recommend a team structure.

AskUserQuestion: "Based on what you described, here's what I recommend. Which team template fits best?"
- **Software Dev Team** — Orchestrator, Architect, Developer, QA Reviewer
- **Research Team** — Orchestrator, Researcher, Analyst, Critic
- **Content Team** — Orchestrator, Writer, Editor, Fact-Checker
- **Custom** — Define your own roles

Always recommend including an adversarial/reviewer role. Explain: "The reviewer's job is to actively challenge the team's output — find flaws, edge cases, and assumptions. Teams without adversarial review produce lower quality work."

### Step 3: Define each role

For each role in the chosen template, confirm:
- **Name**: The display name in Discord (e.g., "Architect")
- **Responsibility**: What they do (1-2 sentences)
- **Expertise**: Domain knowledge they bring
- **Interaction pattern**: Who they talk to and when

Present the final team spec to the user for approval before proceeding.

## Phase 2: Discord Webhook Setup

Guide the user through creating a Discord webhook:

1. Open Discord and go to the channel where the bot operates
2. Click the **gear icon** (Edit Channel) next to the channel name
3. Go to **Integrations** > **Webhooks**
4. Click **New Webhook**
5. Name it anything (e.g., "BastionClaw Swarm") — the name doesn't matter, each message sets its own username
6. Click **Copy Webhook URL**
7. Share the URL

### Save the webhook URL

Add to `.env`:

```bash
DISCORD_WEBHOOK_URLS=https://discord.com/api/webhooks/...
```

Multiple webhooks (for multiple channels) can be comma-separated.

### Verify the webhook works

```bash
# Test the webhook with curl
curl -X POST "WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"content": "Swarm webhook test!", "username": "TestBot", "avatar_url": "https://ui-avatars.com/api/?name=Test&background=random&size=128"}'
```

If a message appears in Discord from "TestBot", the webhook is working.

## Phase 3: Code Changes

The following code changes should already be applied. Verify they are present:

```bash
# 1. DISCORD_WEBHOOK_URLS in config
grep -q "DISCORD_WEBHOOK_URLS" src/config.ts && echo "OK" || echo "MISSING"

# 2. WebhookClient in discord.ts
grep -q "WebhookClient" src/channels/discord.ts && echo "OK" || echo "MISSING"

# 3. sendWebhookMessage in ipc.ts
grep -q "sendWebhookMessage" src/ipc.ts && echo "OK" || echo "MISSING"

# 4. Webhook wiring in index.ts
grep -q "initWebhooks" src/index.ts && echo "OK" || echo "MISSING"
```

If any are missing, apply the changes from the plan. The code changes add:
- `DISCORD_WEBHOOK_URLS` config in `src/config.ts`
- `initWebhooks()` and `sendAsWebhook()` methods on `DiscordChannel`
- `sendWebhookMessage` optional dep in `IpcDeps` with sender-aware routing
- Webhook initialization and IPC wiring in `src/index.ts`

## Phase 4: CLAUDE.md Configuration

Append the Agent Teams section to the group's `CLAUDE.md`. Use the team spec from Phase 1.

Find the group folder for the Discord channel:

```bash
sqlite3 store/messages.db "SELECT folder FROM registered_groups WHERE jid LIKE 'dc:%' LIMIT 1"
```

Then append to `groups/{folder}/CLAUDE.md`:

```markdown
## Agent Teams — Discord Swarm

When the user requests a task that benefits from multiple perspectives, assemble your team.

### Team Roster
{Generated from Phase 1 — list each role with name, responsibility}

### Rules for ALL team members
1. Call `mcp__bastionclaw__send_message` with `sender` set to your exact role name
2. Keep messages SHORT — 2-4 sentences max. No walls of text.
3. Use Discord formatting only: **bold**, *italic*, `code`, ```code blocks```
4. Do NOT use markdown headings (##) — they don't render in Discord

### Adversarial Reviewer
The Reviewer's job is to BREAK things. They should:
- Challenge every assumption the team makes
- Find edge cases the Developer missed
- Question the Architect's design decisions
- Flag security concerns, performance issues, missing error handling
- NOT rubber-stamp — if they can't find problems, look harder

### Pipeline
1. Orchestrator receives the task, breaks it into subtasks
2. Orchestrator delegates to the right specialist(s) using the Task tool
3. Specialists do their work, sharing progress via send_message with their sender name
4. Reviewer examines ALL output and challenges it
5. If Reviewer finds issues, route back to the relevant specialist
6. Orchestrator synthesizes the final result
```

Customize the roster section based on the team defined in Phase 1.

## Phase 5: Build, Restart, Test

```bash
# Build
npm run build

# Restart with rebuild
./scripts/restart.sh --build
```

### Verify

1. Send a test message in the Discord channel mentioning the bot:
   > @BotName Assemble a team to review this code: `print("hello")`

2. Check logs:
   ```bash
   tail -f logs/bastionclaw.log | grep -i webhook
   ```

3. Verify in Discord:
   - Each subagent's messages appear with a different username and avatar
   - The reviewer actively challenges the work
   - Messages are short and Discord-formatted

### Troubleshooting

- **All messages come from one identity**: Check `DISCORD_WEBHOOK_URLS` is set in `.env` and the service was restarted
- **Webhook errors in logs**: Verify the webhook URL is still valid (webhooks can be deleted in Discord settings)
- **No team behavior**: Check the group's `CLAUDE.md` has the Agent Teams section
- **Agent Teams not activating**: Verify `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set in container env
- **Messages too long**: The code auto-chunks at 2000 chars, but remind agents to keep messages short in CLAUDE.md
