---
name: add-telegram-swarm
description: Add Agent Swarm (Teams) support to Telegram. Each subagent gets its own bot identity in the group. Requires Telegram channel to be set up first (use /add-telegram). Triggers on "agent swarm", "agent teams telegram", "telegram swarm", "bot pool".
allowed-tools: Bash(*), Read, Edit, Write, Glob, Grep, AskUserQuestion
---

# Add Agent Swarm to Telegram

**UX Rule:** Use `AskUserQuestion` for ALL interactions with the user. Never just output questions as text — always use the tool so the user gets structured prompts with selectable options.

This skill adds Agent Teams (Swarm) support to an existing Telegram channel. Each subagent in a team gets its own bot identity in the Telegram group, so users can visually distinguish which agent is speaking.

**Prerequisite**: Telegram must already be set up via the `/add-telegram` skill. If `src/telegram.ts` does not exist or `TELEGRAM_BOT_TOKEN` is not configured, tell the user to run `/add-telegram` first.

## Phase 0: Detection & Options

### Detect existing swarms

Query all existing swarms across channels:

```bash
# Telegram swarms
sqlite3 store/messages.db "SELECT jid, name, folder, container_config FROM registered_groups WHERE jid LIKE 'tg:%' AND container_config LIKE '%webhookUrl%'"

# Discord swarms
sqlite3 store/messages.db "SELECT jid, name, folder, container_config FROM registered_groups WHERE jid LIKE 'dc:%' AND container_config LIKE '%webhookUrl%'"

# Total swarm count
sqlite3 store/messages.db "SELECT COUNT(*) FROM registered_groups WHERE (jid LIKE 'dc:%' AND container_config LIKE '%webhookUrl%') OR (jid LIKE 'tg:%' AND container_config LIKE '%webhookUrl%')"
```

**If existing Telegram swarms found**, AskUserQuestion with 3 options:
- **Add a new swarm** (default) — Create a new Telegram group with its own team
- **Replace an existing swarm** — Delete the old config and start fresh for that group
- **Update an existing swarm** — Modify team composition or CLAUDE.md for an existing swarm

**If no swarms found**, proceed directly to the resource warning.

### Resource warning (always show)

> Each swarm runs in its own container VM using approximately **1GB of RAM**. The default limit is **5 concurrent containers** (shared across all channels). You currently have N swarm(s) configured. To increase the limit, set `MAX_CONCURRENT_CONTAINERS` in your `.env` on the host.

Present via AskUserQuestion to confirm the user understands before proceeding.

### Naming

AskUserQuestion: "What theme name for this swarm? Name it based on the group's interest or purpose — e.g., 'marketing', 'stocks', 'research', 'dev', 'personal'. The group folder will be `telegram-{theme}`."

**Never default to "telegram-main"** — always require a theme name.

## Phase 1: Create Telegram Group & Add Bots

### Step 1: Create or choose a group

AskUserQuestion: "Do you already have a Telegram group for this swarm, or do you need to create one?"
- **Create a new group** (Recommended) — I'll walk you through creating a dedicated group
- **Use an existing group** — I already have a group ready

#### If creating a new group:

Guide the user through creating a Telegram group named after the swarm theme:

1. Open Telegram and tap the **pencil/compose** icon (top right)
2. Select **New Group**
3. Name it after your swarm theme — e.g., "Research", "Marketing", "Stocks"
4. Add your **main bot** (search for its @username) as a member
5. Tap **Create**

After creation, you'll add the pool bots in the Prerequisites step below.

### Step 2: Security reminder

Present this to the user via AskUserQuestion (confirm they understand before proceeding):

> **Security note:** Anyone in this Telegram group can command the bot — triggering agent containers that run with your API key and have access to tools, memory, and scheduled tasks.
>
> **Keep the group private.** Do not share invite links. If you want shared access, create a separate group registered with `requiresTrigger: true` so others must @mention the bot and get limited (non-admin) access.
>
> Unlike private DMs, group messages are visible to all group members. Be mindful of what information you ask the bot to process in a group setting.

### Step 3: Ensure main bot has Group Privacy disabled

The main bot must be able to see all messages in the group (not just @mentions):

1. Open `@BotFather` in Telegram
2. Send `/mybots` and select your **main bot**
3. Go to **Bot Settings** > **Group Privacy**
4. If it says "enabled", select **Turn off**
5. **Remove and re-add the main bot to the group** — this is required for the change to take effect

Skip this step if the main bot already has Group Privacy disabled (you can check in BotFather).

## How It Works

- The **main bot** receives messages and sends lead agent responses (already set up by `/add-telegram`)
- **Pool bots** are send-only — each gets a Grammy `Api` instance (no polling)
- When a subagent calls `send_message` with a `sender` parameter, the host assigns a pool bot and renames it to match the sender's role
- Messages appear in Telegram from different bot identities

```
Subagent calls send_message(text: "Found 3 results", sender: "Researcher")
  → MCP writes IPC file with sender field
  → Host IPC watcher picks it up
  → Assigns pool bot #2 to "Researcher" (round-robin, stable per-group)
  → Renames pool bot #2 to "Researcher" via setMyName
  → Sends message via pool bot #2's Api instance
  → Appears in Telegram from "Researcher" bot
```

## Prerequisites

### 1. Create Pool Bots

Tell the user:

> I need you to create 3-5 Telegram bots to use as the agent pool. These will be renamed dynamically to match agent roles.
>
> 1. Open Telegram and search for `@BotFather`
> 2. Send `/newbot` for each bot:
>    - Give them any placeholder name (e.g., "Bot 1", "Bot 2")
>    - Usernames like `myproject_swarm_1_bot`, `myproject_swarm_2_bot`, etc.
> 3. Copy all the tokens

Wait for user to provide the tokens.

### 2. Disable Group Privacy for Pool Bots

Tell the user:

> **Important**: Each pool bot needs Group Privacy disabled so it can send messages in groups.
>
> For **each** pool bot in `@BotFather`:
> 1. Send `/mybots` and select the bot
> 2. Go to **Bot Settings** > **Group Privacy** > **Turn off**

### 3. Add Pool Bots to the Swarm Group

Tell the user:

> Now add all pool bots to the Telegram group you created for this swarm:
>
> 1. Open the group in Telegram
> 2. Tap the group name at the top to open group info
> 3. Tap **Add Members**
> 4. Search for each pool bot by its @username and add it
> 5. Verify all bots appear in the member list
>
> **Note:** After adding a bot whose Group Privacy setting was just changed, you may need to remove and re-add it for the change to take effect.

### 3. Image Generation Setup (if applicable)

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

   If `NEEDS_ADDING`, find the `allowedVars` array in `src/container-runner.ts` and add `'GEMINI_API_KEY'` to it:

   ```bash
   # Find the current allowedVars line
   grep "allowedVars" src/container-runner.ts
   ```

   Edit the array to include `'GEMINI_API_KEY'`. For example, if it currently reads:
   ```typescript
   const allowedVars = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'TRANSCRIPT_API_KEY'];
   ```
   Change it to:
   ```typescript
   const allowedVars = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'TRANSCRIPT_API_KEY', 'GEMINI_API_KEY'];
   ```

   This ensures the key is passed via stdin to the container's SDK environment, where Bash tool calls can access it.

## Implementation

### Step 1: Update Configuration

Read `src/config.ts` and add the bot pool config near the other Telegram exports:

```typescript
export const TELEGRAM_BOT_POOL = (process.env.TELEGRAM_BOT_POOL || '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);
```

### Step 2: Add Bot Pool to Telegram Module

Read `src/telegram.ts` and add the following:

1. **Update imports** — add `Api` to the Grammy import:

```typescript
import { Api, Bot } from 'grammy';
```

2. **Add pool state** after the existing `let bot` declaration:

```typescript
// Bot pool for agent teams: send-only Api instances (no polling)
const poolApis: Api[] = [];
// Maps "{groupFolder}:{senderName}" → pool Api index for stable assignment
const senderBotMap = new Map<string, number>();
let nextPoolIndex = 0;
```

3. **Add pool functions** — place these before the `isTelegramConnected` function:

```typescript
/**
 * Initialize send-only Api instances for the bot pool.
 * Each pool bot can send messages but doesn't poll for updates.
 */
export async function initBotPool(tokens: string[]): Promise<void> {
  for (const token of tokens) {
    try {
      const api = new Api(token);
      const me = await api.getMe();
      poolApis.push(api);
      logger.info(
        { username: me.username, id: me.id, poolSize: poolApis.length },
        'Pool bot initialized',
      );
    } catch (err) {
      logger.error({ err }, 'Failed to initialize pool bot');
    }
  }
  if (poolApis.length > 0) {
    logger.info({ count: poolApis.length }, 'Telegram bot pool ready');
  }
}

/**
 * Send a message via a pool bot assigned to the given sender name.
 * Assigns bots round-robin on first use; subsequent messages from the
 * same sender in the same group always use the same bot.
 * On first assignment, renames the bot to match the sender's role.
 */
export async function sendPoolMessage(
  chatId: string,
  text: string,
  sender: string,
  groupFolder: string,
): Promise<void> {
  if (poolApis.length === 0) {
    // No pool bots — fall back to main bot
    await sendTelegramMessage(chatId, text);
    return;
  }

  const key = `${groupFolder}:${sender}`;
  let idx = senderBotMap.get(key);
  if (idx === undefined) {
    idx = nextPoolIndex % poolApis.length;
    nextPoolIndex++;
    senderBotMap.set(key, idx);
    // Rename the bot to match the sender's role, then wait for Telegram to propagate
    try {
      await poolApis[idx].setMyName(sender);
      await new Promise((r) => setTimeout(r, 2000));
      logger.info({ sender, groupFolder, poolIndex: idx }, 'Assigned and renamed pool bot');
    } catch (err) {
      logger.warn({ sender, err }, 'Failed to rename pool bot (sending anyway)');
    }
  }

  const api = poolApis[idx];
  try {
    const numericId = chatId.replace(/^tg:/, '');
    const MAX_LENGTH = 4096;
    if (text.length <= MAX_LENGTH) {
      await api.sendMessage(numericId, text);
    } else {
      for (let i = 0; i < text.length; i += MAX_LENGTH) {
        await api.sendMessage(numericId, text.slice(i, i + MAX_LENGTH));
      }
    }
    logger.info({ chatId, sender, poolIndex: idx, length: text.length }, 'Pool message sent');
  } catch (err) {
    logger.error({ chatId, sender, err }, 'Failed to send pool message');
  }
}
```

### Step 3: Add sender Parameter to MCP Tool

Read `container/agent-runner/src/ipc-mcp-stdio.ts` and update the `send_message` tool to accept an optional `sender` parameter:

Change the tool's schema from:
```typescript
{ text: z.string().describe('The message text to send') },
```

To:
```typescript
{
  text: z.string().describe('The message text to send'),
  sender: z.string().optional().describe('Your role/identity name (e.g. "Researcher"). When set, messages appear from a dedicated bot in Telegram.'),
},
```

And update the handler to include `sender` in the IPC data:

```typescript
async (args) => {
    const data: Record<string, string | undefined> = {
      type: 'message',
      chatJid,
      text: args.text,
      sender: args.sender || undefined,
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(MESSAGES_DIR, data);

    return { content: [{ type: 'text' as const, text: 'Message sent.' }] };
  },
```

### Step 4: Update Host IPC Routing

Read `src/ipc.ts` and make these changes:

1. **Add imports** — add `sendPoolMessage` and `initBotPool` from the Telegram swarm module, and `TELEGRAM_BOT_POOL` from config.

2. **Update IPC message routing** — in `src/ipc.ts`, find where the `sendMessage` dependency is called to deliver IPC messages (inside `processIpcFiles`). The `sendMessage` is passed in via the `IpcDeps` parameter. Wrap it to route Telegram swarm messages through the bot pool:

```typescript
if (data.sender && data.chatJid.startsWith('tg:')) {
  await sendPoolMessage(
    data.chatJid,
    data.text,
    data.sender,
    sourceGroup,
  );
} else {
  await deps.sendMessage(data.chatJid, data.text);
}
```

Note: The assistant name prefix is handled by `formatOutbound()` in the router — Telegram channels have `prefixAssistantName = false` so no prefix is added for `tg:` JIDs.

3. **Initialize pool in `main()` in `src/index.ts`** — after creating the Telegram channel, add:

```typescript
if (TELEGRAM_BOT_POOL.length > 0) {
  await initBotPool(TELEGRAM_BOT_POOL);
}
```

### Step 5: Update CLAUDE.md Files

#### 5a. Add global message formatting rules

Read `groups/global/CLAUDE.md` and add a Message Formatting section:

```markdown
## Message Formatting

NEVER use markdown. Only use WhatsApp/Telegram formatting:
- *single asterisks* for bold (NEVER **double asterisks**)
- _underscores_ for italic
- • bullet points
- ```triple backticks``` for code

No ## headings. No [links](url). No **double stars**.
```

#### 5b. Update existing group CLAUDE.md headings

In any group CLAUDE.md that has a "WhatsApp Formatting" section (e.g. `groups/main/CLAUDE.md`), rename the heading to reflect multi-channel support:

```
## WhatsApp Formatting (and other messaging apps)
```

#### 5c. Add Agent Teams instructions to Telegram groups

If the team includes a visual/image-producing role, copy the generate-image skill to the container skills directory so it's available as a proper invokable skill inside the container:

```bash
mkdir -p container/skills/generate-image
cp .claude/skills/generate-image/SKILL.md container/skills/generate-image/SKILL.md
```

Also copy the canonical generate-image script into each Telegram group's scripts directory so the container agent uses the exact same version as the host:

```bash
for FOLDER in $(sqlite3 store/messages.db "SELECT folder FROM registered_groups WHERE jid LIKE 'tg:%'"); do
  mkdir -p "groups/${FOLDER}/scripts"
  cp scripts/generate-image.js "groups/${FOLDER}/scripts/generate-image.js"
done
```

The container-runner syncs `container/skills/` into each group's `.claude/skills/` at spawn time, making them available to the SDK as invokable skills.

For each Telegram group that will use agent teams, create or update its `groups/{folder}/CLAUDE.md` with these instructions. Read the existing CLAUDE.md first (or `groups/global/CLAUDE.md` as a base) and add the Agent Teams section:

```markdown
## Agent Teams

When creating a team to tackle a complex task, follow these rules:

### CRITICAL: Follow the user's prompt exactly

Create *exactly* the team the user asked for — same number of agents, same roles, same names. Do NOT add extra agents, rename roles, or use generic names like "Researcher 1". If the user says "a marine biologist, a physicist, and Alexander Hamilton", create exactly those three agents with those exact names.

### CRITICAL: How teammates communicate

Every teammate MUST call `mcp__bastionclaw__send_message` to post their work to the Telegram group. This is NOT optional. If a teammate does not call `send_message`, their work is invisible — the user never sees it, other teammates never see it, and the lead agent cannot reference it.

*The `send_message` call IS the deliverable.* Work that only exists as internal Task tool output is wasted — it never reaches the group chat.

### Team member instructions

Each team member MUST be instructed to:

1. Your PRIMARY job is to call `mcp__bastionclaw__send_message` with `sender` set to your exact role/character name (e.g., `sender: "Marine Biologist"`). This is how your output reaches the Telegram group. If you don't call it, your work doesn't exist.
2. You MUST call `send_message` at least once with your completed work.
3. Also communicate with teammates via `SendMessage` as normal for coordination.
4. Keep group messages *short* — 2-4 sentences max per message. Break longer content into multiple `send_message` calls. No walls of text.
5. Use the `sender` parameter consistently — always the same name so the bot identity stays stable.
6. Post the FULL content via `send_message` — do NOT just announce it's ready. Post the actual text.
7. NEVER use markdown formatting. Use ONLY WhatsApp/Telegram formatting: single *asterisks* for bold (NOT **double**), _underscores_ for italic, • for bullets, ```backticks``` for code. No ## headings, no [links](url), no **double asterisks**.

### Teammate prompt template (MUST use this)

When creating a teammate via the Task tool, you MUST include these exact instructions in their prompt. Do not omit or paraphrase — the teammate needs these to function:

\```
CRITICAL REQUIREMENT: You MUST call mcp__bastionclaw__send_message to post your work to the Telegram group. This is your primary deliverable — if you don't call send_message, your work is invisible and wasted.

You are the [ROLE]. Your job is [RESPONSIBILITY].

When your work is ready, post it to the group:
- Call mcp__bastionclaw__send_message with sender set to "[ROLE]" and text set to your full output
- Do NOT just return your work as text — you MUST use the send_message tool
- Keep each message to 2-4 sentences. Break longer content into multiple send_message calls
- ONLY use single *asterisks* for bold (never **double**), _underscores_ for italic, • for bullets. No markdown.

After posting via send_message, you may also return a brief summary to the orchestrator.
\```

### Synchronization rules for the lead agent
- *Never announce completion until all teammates have posted their output.* If you delegated to N agents, wait for N `send_message` posts in the group.
- *If a teammate completed their Task but didn't post to the group, the work is incomplete.* Re-delegate or post the work yourself with the teammate's sender name.
- *Never paraphrase what a teammate "would have said."* Only reference what they actually posted to the group.
- *Do NOT wrap up early.* Wait for every delegated agent to finish posting before your final summary.
- *Do NOT write the deliverable yourself.* If a specialist was supposed to produce output, they post it — not you.

### Lead agent behavior

As the lead agent who created the team:

- You do NOT need to react to or relay every teammate message. The user sees those directly from the teammate bots.
- Send your own messages only to comment, share thoughts, synthesize, or direct the team.
- When processing an internal update from a teammate that doesn't need a user-facing response, wrap your *entire* output in `<internal>` tags.
- Focus on high-level coordination and the final synthesis.
```

### Step 6: Update Environment

Add pool tokens to `.env`:

```bash
TELEGRAM_BOT_POOL=TOKEN1,TOKEN2,TOKEN3,...
```

Also add `TELEGRAM_BOT_POOL` to the launchd plist (`~/Library/LaunchAgents/com.bastionclaw.plist`) in the `EnvironmentVariables` dict if using launchd.

### Step 7: Rebuild and Restart

```bash
npm run build
./container/build.sh  # Required — MCP tool changed
launchctl unload ~/Library/LaunchAgents/com.bastionclaw.plist
launchctl load ~/Library/LaunchAgents/com.bastionclaw.plist
```

Must use `unload/load` (not just `kickstart`) because the plist env vars changed.

### Step 8: Test

Tell the user:

> Send a message in your Telegram group asking for a multi-agent task, e.g.:
> "Assemble a team of a researcher and a coder to build me a hello world app"
>
> You should see:
> - The lead agent (main bot) acknowledging and creating the team
> - Each subagent messaging from a different bot, renamed to their role
> - Short, scannable messages from each agent
>
> Check logs: `tail -f logs/bastionclaw.log | grep -i pool`

## Architecture Notes

- Pool bots use Grammy's `Api` class — lightweight, no polling, just send
- Bot names are set via `setMyName` — changes are global to the bot, not per-chat
- A 2-second delay after `setMyName` allows Telegram to propagate the name change before the first message
- Sender→bot mapping is stable within a group (keyed as `{groupFolder}:{senderName}`)
- Mapping resets on service restart — pool bots get reassigned fresh
- If pool runs out, bots are reused (round-robin wraps)

## Troubleshooting

### Pool bots not sending messages

1. Verify tokens: `curl -s "https://api.telegram.org/botTOKEN/getMe"`
2. Check pool initialized: `grep "Pool bot" logs/bastionclaw.log`
3. Ensure all pool bots are members of the Telegram group
4. Check Group Privacy is disabled for each pool bot

### Bot names not updating

Telegram caches bot names client-side. The 2-second delay after `setMyName` helps, but users may need to restart their Telegram client to see updated names immediately.

### Subagents not using send_message

Check the group's `CLAUDE.md` has the Agent Teams instructions. The lead agent reads this when creating teammates and must include the `send_message` + `sender` instructions in each teammate's prompt.

## Removal

To remove Agent Swarm support while keeping basic Telegram:

1. Remove `TELEGRAM_BOT_POOL` from `src/config.ts`
2. Remove pool code from `src/telegram.ts` (`poolApis`, `senderBotMap`, `initBotPool`, `sendPoolMessage`)
3. Remove pool routing from IPC handler in `src/index.ts` (revert to plain `sendMessage`)
4. Remove `initBotPool` call from `main()`
5. Remove `sender` param from MCP tool in `container/agent-runner/src/ipc-mcp-stdio.ts`
6. Remove Agent Teams section from group CLAUDE.md files
7. Remove `TELEGRAM_BOT_POOL` from `.env` and launchd plist
8. Rebuild: `npm run build && ./container/build.sh && launchctl unload ~/Library/LaunchAgents/com.bastionclaw.plist && launchctl load ~/Library/LaunchAgents/com.bastionclaw.plist`
