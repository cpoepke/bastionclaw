---
name: add-discord
description: Add Discord as a messaging channel. Can replace WhatsApp or run alongside it and Telegram.
allowed-tools: Bash(*), Read, Edit, Write, Glob, Grep, AskUserQuestion
---

# Add Discord Channel

**UX Rule:** Use `AskUserQuestion` for ALL interactions with the user. Never just output questions as text — always use the tool so the user gets structured prompts with selectable options.

Add Discord bot integration to BastionClaw using discord.js.

## Phase 1: Pre-flight

Verify the Discord channel code is properly integrated:

```bash
# 1. Channel implementation exists
ls src/channels/discord.ts

# 2. DiscordChannel is imported in the orchestrator
grep -q "DiscordChannel" src/index.ts && echo "OK: import present" || echo "MISSING: DiscordChannel import"

# 3. Config vars exist
grep -q "DISCORD_BOT_TOKEN" src/config.ts && echo "OK: config present" || echo "MISSING: DISCORD_BOT_TOKEN config"
```

If any check fails, the Discord integration code may not be applied. Tell the user to run `/update` to get the latest codebase.

## Phase 2: Configuration

Use `AskUserQuestion` to collect configuration:

AskUserQuestion: Should Discord replace WhatsApp or run alongside it?
- **Replace WhatsApp** — Discord will be the only channel (sets DISCORD_ONLY=true)
- **Alongside** — All configured channels stay active

AskUserQuestion: Do you have a Discord bot token, or do you need to create one?

If they need to create one, walk them through the full setup below.

## Phase 3: Create a Discord Server (if needed)

AskUserQuestion: Do you already have a Discord server for this bot, or do you need to create one?
- **I have a server** — Skip to Phase 4
- **I need to create one** — Guide me through setup

### Create a Private Server

1. Open Discord (desktop app or browser at https://discord.com)
2. Click the **+** button in the server list (left sidebar)
3. Select **Create My Own**
4. Select **For me and my friends** (keeps it private — no public listing)
5. Name it something like "BastionClaw" or "My Assistant"
6. Click **Create**

You now have a server that only you can see. **Do not share the invite link with anyone yet** — see the Security section below first.

### Create a Dedicated Bot Channel

The bot will read and respond to every message in channels it can see. Create a dedicated channel for it:

1. In your new server, click the **+** next to "TEXT CHANNELS"
2. Name it `bot` or `assistant`
3. Toggle **Private Channel** ON — this is critical
4. Click **Create Channel**

Only you (the server owner) can see this channel now. **After the bot is invited to your server (Phase 4), you must grant it access to this private channel:**

1. Right-click the bot channel > **Edit Channel** > **Permissions**
2. Click **Add members or roles**
3. Search for your bot's name and add it
4. Grant: **View Channel**, **Send Messages**, **Read Message History**
5. Click **Save Changes** (or **Sync** if shown)

## Phase 4: Create a Discord Bot

**You only need ONE bot.** Name it whatever you want — "Kai", "BastionClaw", "My Assistant", etc. If you plan to use agent swarms later, the swarm uses webhooks to give each subagent its own appearance through this single bot. The bot name is just its default identity.

### Step 1: Create the Application

1. Go to https://discord.com/developers/applications
2. Click **New Application**, name it (e.g., "Kai")
3. You may see a roles/setup page after naming — **skip it** and proceed to the tabs on the left sidebar

### Step 2: Fix Installation Settings (do this FIRST)

**IMPORTANT — do this before configuring the Bot tab, or saves will fail with a 500 error.**

1. Go to the **Installation** tab (left sidebar)
2. Under **Default Install Link**, set it to **None**
3. Click **Save Changes**

### Step 3: Configure the Bot

1. Go to the **Bot** tab (left sidebar)
2. Disable **Public Bot** — prevents anyone from inviting your bot to their servers
3. Under **Privileged Gateway Intents**, enable:
   - **Message Content Intent** (required — bot needs to read messages)
   - **Server Members Intent** (optional, for member display names)
4. Click **Save Changes**

### Step 4: Invite the Bot to Your Server

Do this BEFORE copying the token — the invite URL doesn't require the token, and doing it in this order avoids having to reset the token later.

1. Go to the **OAuth2** tab (left sidebar)
2. Under **OAuth2 URL Generator**, select scope: `bot`
3. Under **Bot Permissions**, select: `Send Messages`, `Read Message History`, `View Channels`
4. Copy the generated URL and open it in your browser
5. Select your server from the dropdown and click **Authorize**

### Step 5: Copy the Bot Token (do this LAST)

1. Go back to the **Bot** tab
2. Click **Reset Token** to generate a token
3. **Copy the token immediately** — you can only see it once
4. Paste it when the skill asks for it

The skill will save it to `.env`:

```bash
DISCORD_BOT_TOKEN=your_token_here
```

If replacing WhatsApp:
```bash
DISCORD_ONLY=true
```

## Phase 5: Security Lockdown

**Present this warning to the user before proceeding:**

> **SECURITY WARNING: Anyone who can type in a channel the bot monitors can command it.**
>
> Unlike Telegram (where only your DM with the bot is private by default), Discord bots read messages from channels — and anyone with access to that channel can trigger the bot. The bot runs with your Claude API credentials and has access to your agent's tools, memory, and scheduled tasks.
>
> **What this means:**
> - If you add someone to your server and they can see the bot channel, they can use your bot
> - They can trigger agent containers that run with your API key
> - They can potentially read your agent's memory and conversation history
> - The main channel has admin privileges (register groups, schedule tasks, manage all groups)
>
> **Recommendations:**
> 1. Keep the bot channel **private** (only you can see it)
> 2. If you want others to use the bot, create a **separate non-main channel** for them (with `requiresTrigger: true`) — this limits them to trigger-word interactions only, no admin access
> 3. Never give anyone the **server Administrator** permission — they can see all channels including private ones
> 4. If you must share access, use Discord's **role permissions** to restrict who can see which channels

### Lock Down Channel Permissions

Walk the user through verifying their channel permissions:

1. Right-click the bot channel > **Edit Channel**
2. Go to **Permissions** tab
3. Under **@everyone** (the default role for all server members):
   - **View Channel**: DENY (the X icon)
   - This ensures new members can't see the channel by default
4. Your bot will still work because bot permissions are set at the OAuth2 level, not channel level
5. Only the server owner and explicitly permitted roles can see the channel

### If You Want Shared Access (Non-Main Channel)

If the user wants others to interact with the bot in a separate channel:

1. Create a **new text channel** (e.g., `team-bot`)
2. Keep it as a regular (non-private) channel, or grant access to specific roles
3. Register it as a **non-main group** with `requires_trigger: 1` — users must @mention the bot
4. This channel will NOT have admin privileges (can't register groups, can't manage tasks across groups)
5. Each group gets its own isolated filesystem and memory

## Phase 6: Register the Channel

Enable Developer Mode to get channel IDs:
- **User Settings** (gear icon) > **Advanced** > Enable **Developer Mode**

Then:
- Right-click the bot channel > **Copy Channel ID**

The JID format is `dc:<channelId>`.

AskUserQuestion: Is this your main (admin) channel, or a secondary group channel?
- **Main channel** — This is my primary bot channel with admin privileges (`requires_trigger: 0`)
- **Secondary channel** — This is for a specific group/purpose, require @mention trigger (`requires_trigger: 1`)

Register via the database (substitute the values):

```bash
sqlite3 store/messages.db "INSERT INTO registered_groups (jid, name, folder, trigger_pattern, requires_trigger, channel, added_at) VALUES ('dc:CHANNEL_ID', 'CHANNEL_NAME', 'FOLDER_NAME', '@ASSISTANT_NAME', REQUIRES_TRIGGER, 'discord', '$(date -u +%Y-%m-%dT%H:%M:%S.000Z)')"
```

Create the group folder:

```bash
mkdir -p groups/FOLDER_NAME/logs
```

## Phase 7: Restart and Verify

```bash
./scripts/restart.sh --build
```

Check logs:

```bash
tail -20 logs/bastionclaw.log | grep -i discord
```

You should see `Discord bot connected` with the bot's tag.

Send a test message in the Discord channel mentioning the bot (`@BotName hello`). The bot should respond.

## Supported Features

- Text messages with @mention trigger translation
- Attachment descriptions (image, video, audio, file placeholders)
- Reply context (includes original author)
- Message splitting at 2000-char Discord limit
- Typing indicators
- Server and DM channel support
- Webhook-based agent identities (for Agent Teams/Swarm — see `/add-discord-swarm`)

## Troubleshooting

- **Bot not visible in private channel / no response**: The bot can't see private channels by default. Right-click channel > Edit Channel > Permissions > Add members or roles > add your bot > grant View Channel, Send Messages, Read Message History > Save/Sync
- **"500 error" saving bot settings**: Go to Installation tab first and set Default Install Link to **None**, then save. After that, Bot tab saves will work.
- **Bot doesn't respond**: Check that Message Content Intent is enabled in the Discord Developer Portal
- **"Missing Access" errors**: Ensure the bot has permissions in the channel (Send Messages, Read Message History)
- **Channel not found**: Verify the channel ID and that the bot is in the server
- **Code not loaded**: Run `grep -q "DiscordChannel" dist/index.js` — if no match, rebuild with `npm run build`
- **Bot not connecting**: Check `DISCORD_BOT_TOKEN` in `.env` and verify the token is valid in the Discord Developer Portal
- **Others commanding your bot**: Check channel permissions — ensure @everyone has View Channel denied on your bot channel. See Phase 5.
- **Bot responding to itself**: The code filters `message.author.bot` — this shouldn't happen. Check logs for errors.
