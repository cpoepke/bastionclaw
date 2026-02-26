---
name: add-discord-swarm
description: Add Agent Swarm (Teams) support to Discord. Each subagent gets its own identity via webhooks. Requires Discord channel to be set up first (use /add-discord).
allowed-tools: Bash(*), Read, Edit, Write, Glob, Grep, AskUserQuestion
---

# Add Discord Swarm (Agent Teams)

**UX Rule:** Use `AskUserQuestion` for ALL interactions with the user. Never just output questions as text — always use the tool so the user gets structured prompts with selectable options.

Add multi-agent swarm support to Discord. Each subagent appears as a distinct identity with its own username and avatar via Discord webhooks. Multiple swarms can run on different Discord channels, each with its own team composition, webhook, and isolated group folder.

## Phase 0: Prerequisites & Detection

### Step 1: Check Discord is enabled

```bash
# 1. discord.ts exists
ls src/channels/discord.ts 2>/dev/null && echo "OK: discord.ts exists" || echo "MISSING"

# 2. DISCORD_BOT_TOKEN is configured
grep -q "DISCORD_BOT_TOKEN" .env 2>/dev/null && echo "OK: token present" || echo "MISSING"

# 3. At least one dc: group is registered
sqlite3 store/messages.db "SELECT jid, name FROM registered_groups WHERE jid LIKE 'dc:%'" 2>/dev/null | head -5
```

If ANY of these checks fail, tell the user Discord isn't set up yet and run `/add-discord` first. **Stop here** — do not continue with this skill until `/add-discord` completes successfully. Then re-run these checks.

### Step 2: Detect existing swarms

Query all existing Discord swarms (those with per-channel webhookUrl in container_config):

```bash
sqlite3 store/messages.db "SELECT jid, name, folder, container_config FROM registered_groups WHERE jid LIKE 'dc:%' AND container_config LIKE '%webhookUrl%'"
```

Also count total swarms across all channels (Discord + Telegram):

```bash
sqlite3 store/messages.db "SELECT COUNT(*) FROM registered_groups WHERE (jid LIKE 'dc:%' AND container_config LIKE '%webhookUrl%') OR (jid LIKE 'tg:%' AND container_config LIKE '%webhookUrl%')"
```

**If existing swarms found**, AskUserQuestion with 3 options:
- **Add a new swarm** (default) — Create a new channel with its own team
- **Replace an existing swarm** — Delete the old config and start fresh for that channel
- **Update an existing swarm** — Modify team composition, webhook URL, or CLAUDE.md for an existing swarm

**If no swarms found**, proceed directly to the resource warning and then Phase 1.

### Step 3: Resource warning (always show before proceeding)

Always present this information before proceeding to Phase 1:

> Each swarm runs in its own container VM using approximately **1GB of RAM**. The default limit is **5 concurrent containers** (shared across all channels). You currently have N swarm(s) configured. To increase the limit, set `MAX_CONCURRENT_CONTAINERS` in your `.env` on the host.

Present via AskUserQuestion to confirm the user understands before proceeding.

### Update flow (when user picks "Update existing")

1. List existing swarms, let user pick which one
2. AskUserQuestion: what to change? (team composition, webhook URL, CLAUDE.md instructions)
3. Apply targeted changes without recreating everything:
   - **Team composition**: Update the Agent Teams section in `groups/{folder}/CLAUDE.md`
   - **Webhook URL**: Update `container_config` in DB: `sqlite3 store/messages.db "UPDATE registered_groups SET container_config = json_set(container_config, '$.webhookUrl', 'NEW_URL') WHERE jid = 'dc:CHANNEL_ID'"`
   - **CLAUDE.md instructions**: Edit the group's CLAUDE.md directly

### Replace flow (when user picks "Replace existing")

1. List existing swarms, let user pick which one
2. Confirm deletion
3. Remove the group from DB: `sqlite3 store/messages.db "DELETE FROM registered_groups WHERE jid = 'dc:CHANNEL_ID'"`
4. Proceed through full Phase 1-4 as if creating new (reusing the same channel ID)

## Phase 1: Naming & Team Composition

### Step 1: Choose a theme name

AskUserQuestion: "What theme name for this swarm? Name it based on the channel's interest or purpose — e.g., 'marketing', 'stocks', 'research', 'dev', 'personal'. The group folder will be `discord-{theme}`."

**Never default to "discord-main"** — always require a theme name. Suggest names based on the channel's purpose or interest area. The folder will be `discord-{theme}`.

### Step 2: Understand the use case

AskUserQuestion: "What are you trying to accomplish with your bot team? Describe the kind of tasks you want the team to handle."
- Listen to their answer, suggest improvements, identify gaps

### Step 3: Recommend team composition

Based on their use case, recommend a team structure.

**Container slot limit:** There are a maximum of 5 concurrent container slots shared across all channels. Only the first 5 agents that request action get loaded into containers — additional agents queue until a slot frees up. Keep total team size to 5 or fewer for best responsiveness. If an existing swarm is configured on another channel, account for those agents when sizing the team.

AskUserQuestion: "Based on what you described, here's what I recommend. Which team template fits best?"
- **Software Dev Team** — Orchestrator, Architect, Developer, QA Reviewer
- **Research Team** — Orchestrator, Researcher, Analyst, Critic
- **Content Team** — Orchestrator, Writer, Editor, Fact-Checker
- **Custom** — Define your own roles

Always recommend including an adversarial/reviewer role. Explain: "The reviewer's job is to actively challenge the team's output — find flaws, edge cases, and assumptions. Teams without adversarial review produce lower quality work."

If the user requests more than 5 agents, warn them: "Only 5 agents can run concurrently. The first 5 to request action will be loaded into containers. Additional agents will queue and take action as slots become available. You can still configure more than 5, but expect some agents to wait."

### Step 4: Define each role

For each role in the chosen template, confirm:
- **Name**: The display name in Discord (e.g., "Architect")
- **Responsibility**: What they do (1-2 sentences)
- **Expertise**: Domain knowledge they bring
- **Interaction pattern**: Who they talk to and when

Present the final team spec to the user for approval before proceeding.

### Step 5: Image Generation Setup (if applicable)

Most content and research teams benefit from image generation. Check if `GEMINI_API_KEY` is already configured:

```bash
grep -q "GEMINI_API_KEY" .env 2>/dev/null && echo "GEMINI_KEY=yes" || echo "GEMINI_KEY=no"
```

**If the key is missing**, and the team includes a Visual Director or any role that would produce images, guide the user:

AskUserQuestion: "Your team includes a visual role. To generate actual images (not just descriptions), you need a Gemini API key. Would you like to set that up now?"
- **Yes, set it up** — Walk through the steps below
- **Skip for now** — The Visual Director will provide text-based recommendations only

If the user wants to set it up:

1. **Get a Gemini API key:**
   > 1. Go to https://aistudio.google.com/apikey
   > 2. Sign in with your Google account
   > 3. Click **Create API key**
   > 4. Select or create a Google Cloud project when prompted
   > 5. Copy the generated key

2. **Add to `.env`:**

   AskUserQuestion: "Paste your Gemini API key here."

   Then append to `.env`:
   ```bash
   echo "GEMINI_API_KEY=<their_key>" >> .env
   ```

3. **Add to container allowlist** so the key is passed into container agents:

   Check if it's already in the allowlist:
   ```bash
   grep -q "GEMINI_API_KEY" src/container-runner.ts && echo "ALREADY_ALLOWED" || echo "NEEDS_ADDING"
   ```

   If `NEEDS_ADDING`, find the `allowedVars` array in `src/container-runner.ts` and add `'GEMINI_API_KEY'` to it.

## Phase 2: Discord Webhook Setup

Guide the user through creating a webhook **for the specific Discord channel** where this swarm will operate:

1. Open Discord and go to the channel for this swarm
2. Click the **gear icon** (Edit Channel) next to the channel name
3. Go to **Integrations** > **Webhooks**
4. Click **New Webhook**
5. Name it anything (e.g., "BastionClaw Swarm") — the name doesn't matter, each message sets its own username
6. Click **Copy Webhook URL**
7. Share the URL

### Save the webhook URL in container_config (NOT in .env)

The webhook URL is stored per-group in `container_config` JSON, not in `DISCORD_WEBHOOK_URLS` env var. This enables multiple swarms with different webhooks.

Get the Discord channel JID:

```bash
sqlite3 store/messages.db "SELECT jid, name FROM registered_groups WHERE jid LIKE 'dc:%'"
```

If the channel is not yet registered, register it first. The JID format is `dc:{channelId}`.

Register the group with the webhook URL in container_config:

```bash
# For a new group — write IPC file to register via the register_group handler
# The folder name is discord-{theme} from Phase 1
cat > data/ipc/main/tasks/register-swarm-$(date +%s).json << 'EOF'
{
  "type": "register_group",
  "jid": "dc:CHANNEL_ID",
  "name": "CHANNEL_NAME",
  "folder": "discord-THEME",
  "trigger": "@bastionclaw",
  "channel": "discord",
  "containerConfig": {
    "webhookUrl": "https://discord.com/api/webhooks/..."
  }
}
EOF
```

Or update an existing group's container_config directly:

```bash
sqlite3 store/messages.db "UPDATE registered_groups SET container_config = json_set(COALESCE(container_config, '{}'), '$.webhookUrl', 'WEBHOOK_URL') WHERE jid = 'dc:CHANNEL_ID'"
```

### Verify the webhook works

```bash
# Test the webhook with curl
curl -X POST "WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"content": "Swarm webhook test!", "username": "TestBot", "avatar_url": "https://ui-avatars.com/api/?name=Test&background=random&size=128"}'
```

If a message appears in Discord from "TestBot", the webhook is working.

## Phase 3: Code Verification

The multi-swarm webhook routing code should already be applied. Verify:

```bash
# 1. Per-JID webhook map in discord.ts
grep -q "webhookMap" src/channels/discord.ts && echo "OK" || echo "MISSING"

# 2. registerWebhook method in discord.ts
grep -q "registerWebhook" src/channels/discord.ts && echo "OK" || echo "MISSING"

# 3. webhookUrl in ContainerConfig types
grep -q "webhookUrl" src/types.ts && echo "OK" || echo "MISSING"

# 4. registerWebhook in IpcDeps
grep -q "registerWebhook" src/ipc.ts && echo "OK" || echo "MISSING"

# 5. Webhook mapping built from registeredGroups in index.ts
grep -q "webhookMapping" src/index.ts && echo "OK" || echo "MISSING"

# 6. sendWebhookMessage wired for Discord
grep -q "sendWebhookMessage" src/ipc.ts && echo "OK" || echo "MISSING"
```

If any are missing, the host code needs updating. Check that multi-swarm support has been implemented.

## Phase 4: CLAUDE.md & Scripts

Create the group folder and write team instructions:

```bash
FOLDER="discord-THEME"  # From Phase 1
mkdir -p "groups/${FOLDER}/logs"
mkdir -p "groups/${FOLDER}/scripts"
```

If the team includes a Visual Director or image-producing role, copy the generate-image skill and script:

```bash
mkdir -p container/skills/generate-image
cp .claude/skills/generate-image/SKILL.md container/skills/generate-image/SKILL.md
cp scripts/generate-image.js "groups/${FOLDER}/scripts/generate-image.js"
```

Then write `groups/{folder}/CLAUDE.md` with the team instructions:

```markdown
## Agent Teams — Discord Swarm

When the user requests a task that benefits from multiple perspectives, assemble your team.

### Team Roster
{Generated from Phase 1 — list each role with name, responsibility}

### CRITICAL: How teammates communicate

Every teammate MUST call `mcp__bastionclaw__send_message` to post their work to the Discord group. This is NOT optional. If a teammate does not call `send_message`, their work is invisible — the user never sees it, other teammates never see it, and the Orchestrator cannot reference it.

**The `send_message` call IS the deliverable.** Work that only exists as internal Task tool output is wasted — it never reaches the group chat.

### Rules for ALL team members
1. Your PRIMARY job is to call `mcp__bastionclaw__send_message` with `sender` set to your exact role name
2. You MUST call `send_message` at least once with your completed work. This is how your output reaches the Discord group. If you don't call it, your work doesn't exist.
3. Keep messages SHORT — 2-4 sentences max. No walls of text.
4. Use Discord formatting only: **bold**, *italic*, `code`, ```code blocks```
5. Do NOT use markdown headings (##) — they don't render in Discord
6. Post the FULL content via `send_message` — do NOT just announce it's ready. Post the actual text.
7. When citing sources, statistics, or claims from external content, ALWAYS include a hyperlink to the source URL. Use Discord link format: `[source name](https://url)`. Never cite a source without a clickable link.

### Adversarial Reviewer
The Reviewer's job is to BREAK things. They should:
- Challenge every assumption the team makes
- Find edge cases the Developer missed
- Question the Architect's design decisions
- Flag security concerns, performance issues, missing error handling
- NOT rubber-stamp — if they can't find problems, look harder
- **Post their critique to the group via `send_message` with their sender name**

### Pipeline
1. Orchestrator receives the task, breaks it into subtasks
2. Orchestrator delegates to the right specialist(s) using the Task tool
3. Specialists do their work AND post their output to the group via `send_message`
4. **CRITICAL: Orchestrator MUST wait for each pipeline stage to complete before moving to the next.** Do NOT summarize or wrap up until ALL reviewers have posted their feedback to the group.
5. Reviewer examines ALL output and posts critique via `send_message`
6. If Reviewer finds issues, route back to the relevant specialist
7. Orchestrator synthesizes the final result ONLY after all specialists and reviewers have posted

### Synchronization rules for the Orchestrator
- **Never announce completion until all teammates have posted their output.** If you delegated to N agents, wait for N `send_message` posts in the group.
- **If a teammate completed their Task but didn't post to the group, the work is incomplete.** Re-delegate or post the work yourself with the teammate's sender name.
- **Never paraphrase what a teammate "would have said."** Only reference what they actually posted to the group.
- **Do NOT wrap up early.** Wait for every delegated agent to finish posting before your final summary.
- **Do NOT write the deliverable yourself.** If a specialist was supposed to produce output, they post it — not you.

### Teammate prompt template (MUST use this)

When creating a teammate via the Task tool, you MUST include these exact instructions in their prompt. Do not omit or paraphrase:

```
CRITICAL REQUIREMENT: You MUST call mcp__bastionclaw__send_message to post your work to the Discord group. This is your primary deliverable — if you don't call send_message, your work is invisible and wasted.

You are the [ROLE]. Your job is [RESPONSIBILITY].

When your work is ready, post it to the group:
- Call mcp__bastionclaw__send_message with sender set to "[ROLE]" and text set to your full output
- Do NOT just return your work as text — you MUST use the send_message tool
- Keep each message to 2-4 sentences. Break longer content into multiple send_message calls
- Use Discord formatting: **bold** for emphasis, *italic* for titles. No markdown headings (## etc)

After posting via send_message, you may also return a brief summary to the orchestrator.
```

### Visual Director / Image Generation (conditional)

If the team includes a Visual Director or any image-producing role, check whether `GEMINI_API_KEY` is available:

```bash
grep -q "GEMINI_API_KEY" .env 2>/dev/null && echo "GEMINI_KEY=yes" || echo "GEMINI_KEY=no"
```

**If the key is present**, add these additional instructions to the Visual Director's teammate prompt:

```
You have image generation capability. First check if the API key is available:
  test -n "$GEMINI_API_KEY" && echo "READY" || echo "NO_KEY"

If READY, use the generate-image skill to create images. The skill is available as an invokable skill — follow its instructions for style guide, prompt construction, and script usage. ALWAYS generate an actual image — do not just describe or recommend visuals. After generating, post to the group via send_message with sender "Visual Director" describing what you created and the file path.

If NO_KEY, post to the group explaining that image generation requires a GEMINI_API_KEY in the host .env file, and that the system needs to be restarted after adding it so the container picks up the new key. Provide text-based visual recommendations in the meantime.
```

**If the key is NOT present**, inform the user during setup that image generation requires adding `GEMINI_API_KEY` to `.env`. The Visual Director will still function but will only provide text-based visual recommendations.
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
   - Messages appear in the correct channel (not leaking to other swarm channels)

### Troubleshooting

- **All messages come from one identity**: Check that `webhookUrl` is set in the group's `container_config` in the DB and the service was restarted
- **Webhook errors in logs**: Verify the webhook URL is still valid (webhooks can be deleted in Discord settings)
- **No team behavior**: Check the group's `CLAUDE.md` has the Agent Teams section
- **Agent Teams not activating**: Verify `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set in container env
- **Messages going to wrong channel**: Each swarm channel needs its own webhook URL in `container_config`. Check: `sqlite3 store/messages.db "SELECT jid, container_config FROM registered_groups WHERE jid LIKE 'dc:%'"`
- **Messages too long**: The code auto-chunks at 2000 chars, but remind agents to keep messages short in CLAUDE.md
- **Fallback behavior**: Groups without a `webhookUrl` in `container_config` will use the `DISCORD_WEBHOOK_URLS` env var as fallback. If neither is set, messages are sent as the bot itself.
