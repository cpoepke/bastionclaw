---
name: setup
description: Run initial BastionClaw setup. Use when user wants to install dependencies, configure Telegram, register their main channel, or start the background services. Triggers on "setup", "install", "configure bastionclaw", or first-time setup requests.
---

# BastionClaw Setup

Run all commands automatically. Only pause when user action is required (creating a bot, sending /chatid).

**UX Note:** When asking the user questions, prefer using the `AskUserQuestion` tool instead of just outputting text. This integrates with Claude's built-in question/answer system for a better experience.

## 1. Install Dependencies

```bash
npm install
```

## 2. Install Container Runtime

First, detect the platform and check what's available:

```bash
echo "Platform: $(uname -s)"
which container && echo "Apple Container: installed" || echo "Apple Container: not installed"
which docker && docker info >/dev/null 2>&1 && echo "Docker: installed and running" || echo "Docker: not installed or not running"
```

### If NOT on macOS (Linux, etc.)

Apple Container is macOS-only. Use Docker instead.

Tell the user:
> You're on Linux, so we'll use Docker for container isolation. Let me set that up now.

**Use the `/convert-to-docker` skill** to convert the codebase to Docker, then continue to Section 3.

### If on macOS

**If Apple Container is already installed:** Continue to Section 3.

**If Apple Container is NOT installed:** Ask the user:
> BastionClaw needs a container runtime for isolated agent execution. You have two options:
>
> 1. **Apple Container** (default) - macOS-native, lightweight, designed for Apple silicon
> 2. **Docker** - Cross-platform, widely used, works on macOS and Linux
>
> Which would you prefer?

#### Option A: Apple Container

Tell the user:
> Apple Container is required for running agents in isolated environments.
>
> 1. Download the latest `.pkg` from https://github.com/apple/container/releases
> 2. Double-click to install
> 3. Run `container system start` to start the service
>
> Let me know when you've completed these steps.

Wait for user confirmation, then verify:

```bash
container system start
container --version
```

**Note:** BastionClaw automatically starts the Apple Container system when it launches, so you don't need to start it manually after reboots.

#### Option B: Docker

Tell the user:
> You've chosen Docker. Let me set that up now.

**Use the `/convert-to-docker` skill** to convert the codebase to Docker, then continue to Section 3.

## 3. Configure Claude Authentication

Ask the user:
> Do you want to use your **Claude subscription** (Pro/Max) or an **Anthropic API key**?

### Option 1: Claude Subscription (Recommended)

Tell the user:
> Open another terminal window and run:
> ```
> claude setup-token
> ```
> A browser window will open for you to log in. Once authenticated, the token will be displayed in your terminal. Either:
> 1. Paste it here and I'll add it to `.env` for you, or
> 2. Add it to `.env` yourself as `CLAUDE_CODE_OAUTH_TOKEN=<your-token>`

If they give you the token, add it to `.env`:

```bash
echo "CLAUDE_CODE_OAUTH_TOKEN=<token>" > .env
```

### Option 2: API Key

Ask if they have an existing key to copy or need to create one.

**Copy existing:**
```bash
grep "^ANTHROPIC_API_KEY=" /path/to/source/.env > .env
```

**Create new:**
```bash
echo 'ANTHROPIC_API_KEY=' > .env
```

Tell the user to add their key from https://console.anthropic.com/

**Verify:**
```bash
KEY=$(grep "^ANTHROPIC_API_KEY=" .env | cut -d= -f2)
[ -n "$KEY" ] && echo "API key configured: ${KEY:0:10}...${KEY: -4}" || echo "Missing"
```

## 4. Build Container Image

Build the BastionClaw agent container:

```bash
./container/build.sh
```

This creates the `bastionclaw-agent:latest` image with Node.js, Chromium, Claude Code CLI, and agent-browser.

Verify the build succeeded by running a simple test (this auto-detects which runtime you're using):

```bash
if which docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo '{}' | docker run -i --entrypoint /bin/echo bastionclaw-agent:latest "Container OK" || echo "Container build failed"
else
  echo '{}' | container run -i --entrypoint /bin/echo bastionclaw-agent:latest "Container OK" || echo "Container build failed"
fi
```

## 5. Channel Setup

**Use the AskUserQuestion tool** to ask:

> Which messaging channel do you want to use?
>
> Options:
> 1. **Telegram** (Recommended) - Easy setup, just create a bot with BotFather
> 2. **WhatsApp** - Requires QR code scanning, uses unofficial API

### Option A: Telegram (Default)

**USER ACTION REQUIRED**

Tell the user:

> I need you to create a Telegram bot:
>
> 1. Open Telegram and search for `@BotFather`
> 2. Send `/newbot` and follow prompts:
>    - Bot name: Something friendly (e.g., "My Assistant")
>    - Bot username: Must end with "bot" (e.g., "my_assistant_bot")
> 3. Copy the bot token (looks like `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)
> 4. Paste the token here

Wait for the user to provide the token.

Once they provide it, append to `.env`:

```bash
echo "TELEGRAM_BOT_TOKEN=<token>" >> .env
echo "TELEGRAM_ONLY=true" >> .env
```

**Verify the token works:**

```bash
TOKEN=$(grep "^TELEGRAM_BOT_TOKEN=" .env | cut -d= -f2)
curl -s "https://api.telegram.org/bot${TOKEN}/getMe" | grep -q '"ok":true' && echo "Bot token valid" || echo "Bot token INVALID"
```

### Option B: WhatsApp

**USER ACTION REQUIRED**

**IMPORTANT:** Run this command in the **foreground**. The QR code is multi-line ASCII art that must be displayed in full. Do NOT run in background or truncate the output.

Tell the user:
> A QR code will appear in your browser. On your phone:
> 1. Open WhatsApp
> 2. Tap **Settings → Linked Devices → Link a Device**
> 3. Scan the QR code displayed in the browser

Run with a long Bash tool timeout (120000ms) so the user has time to scan. Do NOT use the `timeout` shell command (it's not available on macOS).

```bash
npm run auth:browser
```

If the browser method fails, fall back to terminal QR:
```bash
npm run auth
```

Wait for the script to output "Successfully authenticated" then continue.

If it says "Already authenticated", skip to the next step.

### 5b. Configure Allowed Senders (WhatsApp Security)

**Only show this section if the user chose WhatsApp.**

Explain the security difference and use `AskUserQuestion`:

> **WhatsApp security note:** Unlike Telegram (where only your bot receives messages), WhatsApp links as your personal account. This means **anyone in your groups** who types the trigger word can activate the agent — it looks like a message from you.
>
> How do you want to handle this?

Options:
1. **Restrict to specific numbers (Recommended)** — Only messages from phone numbers you specify will trigger the bot
2. **Allow all senders** — Anyone in your groups can trigger the bot

**If they choose "Restrict":**

Ask for their phone number(s):
> Enter the phone number(s) that should be allowed to trigger the bot.
>
> Use international format without `+`, spaces, or dashes (e.g. `19195612265` for US +1-919-561-2265).
>
> For multiple numbers, separate with commas.

Write to `.env`:
```bash
echo "WHATSAPP_ALLOWED_SENDERS=<numbers>" >> .env
```

**If they choose "Allow all":**

No action needed — the bot will respond to any sender. You can add `WHATSAPP_ALLOWED_SENDERS` later.

### 5c. Post-Pairing Interaction Guide (WhatsApp)

**Only show this section if the user chose WhatsApp.**

Tell the user:
> **How WhatsApp interaction works:**
>
> - **Main channel** (your primary chat): No prefix needed — just type your message and the agent will respond
> - **Other groups**: Start your message with `@ASSISTANT_NAME` (e.g. `@Andy summarize this conversation`)
> - **Important**: The bot responds **as you** — it's a linked device on your WhatsApp account, not a separate bot. Everyone in the chat sees the response as coming from your number.
> - Messages from non-allowed senders (if you configured the allowlist) are still stored as conversation context — they just won't trigger the agent

## 6. Configure Assistant Name and Main Channel

This step configures three things at once: the trigger word, the main channel type, and the main channel selection.

### 6a. Ask for trigger word

Ask the user:
> What trigger word do you want to use? (default: `Andy`)
>
> In group chats, messages starting with `@TriggerWord` will be sent to the agent.
> In your main channel (and optionally solo chats), no prefix is needed — all messages are processed.

Store their choice for use in the steps below.

If they chose a custom name, also add it to `.env`:
```bash
echo "ASSISTANT_NAME=<name>" >> .env
```

### 6b. Explain security model and ask about main channel type

**Use the AskUserQuestion tool** to present this:

> **Important: Your "main" channel is your admin control portal.**
>
> The main channel has elevated privileges:
> - Can see messages from ALL other registered groups
> - Can manage and delete tasks across all groups
> - Can write to global memory that all groups can read
> - Has read-write access to the entire BastionClaw project
>
> **Recommendation:** Use your personal DM with the bot as your main channel. This ensures only you have admin control.
>
> **Question:** Which setup will you use for your main channel?
>
> Options:
> 1. Personal chat (DM with bot) - Recommended
> 2. Solo group (just me)
> 3. Group with other people (I understand the security implications)

If they choose option 3, ask a follow-up:

> You've chosen a group with other people. This means everyone in that group will have admin privileges over BastionClaw.
>
> Are you sure you want to proceed? The other members will be able to:
> - Read messages from your other registered chats
> - Schedule and manage tasks
> - Access any directories you've mounted
>
> Options:
> 1. Yes, I understand and want to proceed
> 2. No, let me use a personal chat or solo group instead

### 6c. Register the main channel

First build, then start the app briefly so the Telegram bot connects and can receive the `/chatid` command. Use the Bash tool's timeout parameter (20000ms) — do NOT use the `timeout` shell command (it's not available on macOS). The app will be killed when the timeout fires, which is expected.

```bash
npm run build
```

Then run briefly (set Bash tool timeout to 20000ms):
```bash
npm run dev
```

**For Telegram** (chose Telegram in step 5):

Tell the user:

> The bot is now running. To get your chat ID:
>
> **For personal chat (DM with bot):**
> 1. Open Telegram and search for your bot
> 2. Start a chat and send `/chatid`
> 3. The bot will reply with your chat ID (e.g., `tg:123456789`)
> 4. Paste the chat ID here
>
> **For group chat:**
> 1. Add your bot to the group
> 2. Send `/chatid` in the group
> 3. The bot will reply with the group's chat ID (e.g., `tg:-1001234567890`)
> 4. Paste the chat ID here

If the user wants a group chat and needs the bot to see all messages (not just @mentions), also tell them:

> **Important for group chats:** By default, Telegram bots in groups only receive messages that @mention the bot. To let the bot see all messages:
>
> 1. Open Telegram and search for `@BotFather`
> 2. Send `/mybots` and select your bot
> 3. Go to **Bot Settings** > **Group Privacy**
> 4. Select **Turn off**
> 5. Remove and re-add the bot to the group (required for the change to take effect)

Wait for the user to provide the chat ID (format: `tg:NUMBERS`).

**For WhatsApp** (chose WhatsApp in step 5):

**For personal chat** (they chose option 1 in 6b):

Personal chats are NOT synced to the database on startup — only groups are. Instead, ask the user for their phone number (with country code, no + or spaces, e.g. `14155551234`), then construct the JID as `{number}@s.whatsapp.net`.

**For group** (they chose option 2 or 3 in 6b):

Groups are synced on startup via `groupFetchAllParticipating`. Query the database for recent groups:
```bash
sqlite3 store/messages.db "SELECT jid, name FROM chats WHERE jid LIKE '%@g.us' AND jid != '__group_sync__' ORDER BY last_message_time DESC LIMIT 40"
```

Show only the **10 most recent** group names to the user and ask them to pick one. If they say their group isn't in the list, show the next batch from the results you already have. If they tell you the group name directly, look it up:
```bash
sqlite3 store/messages.db "SELECT jid, name FROM chats WHERE name LIKE '%GROUP_NAME%' AND jid LIKE '%@g.us'"
```

### 6d. Write the configuration

Once you have the JID/chat ID, configure it. Use the assistant name from step 6a.

For personal chats (solo, no prefix needed), set `requiresTrigger` to `false`:

```json
{
  "JID_HERE": {
    "name": "main",
    "folder": "main",
    "trigger": "@ASSISTANT_NAME",
    "added_at": "CURRENT_ISO_TIMESTAMP",
    "requiresTrigger": false
  }
}
```

For groups, keep `requiresTrigger` as `true` (default).

Write to the database directly by creating a temporary registration script, or write `data/registered_groups.json` which will be auto-migrated on first run:

```bash
mkdir -p data
```

Then write `data/registered_groups.json` with the correct JID, trigger, and timestamp.

If the user chose a name other than `Andy`, also update:
1. `groups/global/CLAUDE.md` - Change "# Andy" and "You are Andy" to the new name
2. `groups/main/CLAUDE.md` - Same changes at the top

Ensure the groups folder exists:
```bash
mkdir -p groups/main/logs
```

## 7. Configure External Directory Access (Mount Allowlist)

Ask the user:
> Do you want the agent to be able to access any directories **outside** the BastionClaw project?
>
> Examples: Git repositories, project folders, documents you want Claude to work on.
>
> **Note:** This is optional. Without configuration, agents can only access their own group folders.

If **no**, create an empty allowlist to make this explicit:

```bash
mkdir -p ~/.config/bastionclaw
cat > ~/.config/bastionclaw/mount-allowlist.json << 'EOF'
{
  "allowedRoots": [],
  "blockedPatterns": [],
  "nonMainReadOnly": true
}
EOF
echo "Mount allowlist created - no external directories allowed"
```

Skip to the next step.

If **yes**, ask follow-up questions:

### 7a. Collect Directory Paths

Ask the user:
> Which directories do you want to allow access to?
>
> You can specify:
> - A parent folder like `~/projects` (allows access to anything inside)
> - Specific paths like `~/repos/my-app`
>
> List them one per line, or give me a comma-separated list.

For each directory they provide, ask:
> Should `[directory]` be **read-write** (agents can modify files) or **read-only**?
>
> Read-write is needed for: code changes, creating files, git commits
> Read-only is safer for: reference docs, config examples, templates

### 7b. Configure Non-Main Group Access

Ask the user:
> Should **non-main groups** (other chats you add later) be restricted to **read-only** access even if read-write is allowed for the directory?
>
> Recommended: **Yes** - this prevents other groups from modifying files even if you grant them access to a directory.

### 7c. Create the Allowlist

Create the allowlist file based on their answers:

```bash
mkdir -p ~/.config/bastionclaw
```

Then write the JSON file. Example for a user who wants `~/projects` (read-write) and `~/docs` (read-only) with non-main read-only:

```bash
cat > ~/.config/bastionclaw/mount-allowlist.json << 'EOF'
{
  "allowedRoots": [
    {
      "path": "~/projects",
      "allowReadWrite": true,
      "description": "Development projects"
    },
    {
      "path": "~/docs",
      "allowReadWrite": false,
      "description": "Reference documents"
    }
  ],
  "blockedPatterns": [],
  "nonMainReadOnly": true
}
EOF
```

Verify the file:

```bash
cat ~/.config/bastionclaw/mount-allowlist.json
```

Tell the user:
> Mount allowlist configured. The following directories are now accessible:
> - `~/projects` (read-write)
> - `~/docs` (read-only)
>
> **Security notes:**
> - Sensitive paths (`.ssh`, `.gnupg`, `.aws`, credentials) are always blocked
> - This config file is stored outside the project, so agents cannot modify it
> - Changes require restarting the BastionClaw service
>
> To grant a group access to a directory, add it to their config in `data/registered_groups.json`:
> ```json
> "containerConfig": {
>   "additionalMounts": [
>     { "hostPath": "~/projects/my-app" }
>   ]
> }
> ```
> The folder appears inside the container at `/workspace/extra/<folder-name>` (derived from the last segment of the path). Add `"readonly": false` for write access, or `"containerPath": "custom-name"` to override the default name.

## 8. Build and Configure Service

### 8a. Build everything

```bash
# Build host TypeScript
npm run build

# Build WebUI frontend
cd ui && npm install && npm run build && cd ..

# Create logs directory
mkdir -p logs

# Initialize memory search (registers collections, embeds files, downloads models)
# First run downloads ~2GB of search models — may take a few minutes
./scripts/qmd-start.sh
```

### 8b. Configure background service

First, detect the platform:

```bash
echo "Platform: $(uname -s)"
```

#### macOS (launchd)

Generate the plist file with correct paths automatically:

```bash
NODE_PATH=$(which node)
PROJECT_PATH=$(pwd)
HOME_PATH=$HOME

cat > ~/Library/LaunchAgents/com.bastionclaw.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bastionclaw</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>${PROJECT_PATH}/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${PROJECT_PATH}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:${HOME_PATH}/.local/bin</string>
        <key>HOME</key>
        <string>${HOME_PATH}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${PROJECT_PATH}/logs/bastionclaw.log</string>
    <key>StandardErrorPath</key>
    <string>${PROJECT_PATH}/logs/bastionclaw.error.log</string>
</dict>
</plist>
EOF

echo "Created launchd plist with:"
echo "  Node: ${NODE_PATH}"
echo "  Project: ${PROJECT_PATH}"
```

Start the service:

```bash
launchctl load ~/Library/LaunchAgents/com.bastionclaw.plist
```

Verify it's running:
```bash
launchctl list | grep bastionclaw
```

#### Linux (systemd user service)

Generate the systemd unit file. First check if the docker group is stale (user was added mid-session but hasn't re-logged):

```bash
NODE_PATH=$(which node)
PROJECT_PATH=$(pwd)

# Check if docker group is stale (user is in group but current session doesn't have it)
DOCKER_STALE=false
if groups | grep -qv docker && id -nG | grep -q docker 2>/dev/null; then
  DOCKER_STALE=true
elif getent group docker | grep -q "$(whoami)" && ! groups | grep -q docker; then
  DOCKER_STALE=true
fi

if [ "$DOCKER_STALE" = true ]; then
  EXEC_START="sg docker -c \"${NODE_PATH} ${PROJECT_PATH}/dist/index.js\""
  echo "⚠️  Docker group was added mid-session — wrapping ExecStart with sg docker"
  echo "   For a permanent fix, log out and back in (or reboot)."
else
  EXEC_START="${NODE_PATH} ${PROJECT_PATH}/dist/index.js"
fi

mkdir -p ~/.config/systemd/user

cat > ~/.config/systemd/user/bastionclaw.service << EOF
[Unit]
Description=BastionClaw Hard Shell
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${PROJECT_PATH}
ExecStart=${EXEC_START}
Restart=on-failure
RestartSec=5
StandardOutput=append:${PROJECT_PATH}/logs/bastionclaw.log
StandardError=append:${PROJECT_PATH}/logs/bastionclaw.error.log

[Install]
WantedBy=default.target
EOF

echo "Created systemd user service"
```

Enable and start the service:

```bash
systemctl --user daemon-reload
systemctl --user enable bastionclaw
systemctl --user start bastionclaw
```

Enable lingering so the service runs even when you're not logged in:

```bash
loginctl enable-linger $(whoami)
```

Verify it's running:
```bash
systemctl --user status bastionclaw
```

## 9. Test

Tell the user (using the assistant name they configured):

**For Telegram:**
> Send a message to your bot in Telegram.
>
> **Tip:** In your main channel (DM with bot), you don't need the `@` prefix — just send `hello` and the agent will respond. In groups, use `@ASSISTANT_NAME hello` or @mention the bot.

**For WhatsApp:**
> Send a message in your registered chat.
>
> **Tips:**
> - In your main channel, just send `hello` — no prefix needed
> - In other groups, use `@ASSISTANT_NAME hello`
> - If you configured `WHATSAPP_ALLOWED_SENDERS`, make sure you're sending from an allowed number
> - The response will appear as if sent by you (linked device behavior)

Check the logs:
```bash
tail -f logs/bastionclaw.log
```

The user should receive a response in their messaging app.

## Troubleshooting

**Service not starting**: Check `logs/bastionclaw.error.log`

**Container agent fails with "Claude Code process exited with code 1"**:
- Ensure the container runtime is running:
  - Apple Container: `container system start`
  - Docker: `docker info` (start Docker Desktop on macOS, or `sudo systemctl start docker` on Linux)
- Check container logs: `cat groups/main/logs/container-*.log | tail -50`

**No response to messages**:
- Verify the trigger pattern matches (e.g., `@AssistantName` at start of message)
- Main channel doesn't require a prefix — all messages are processed
- Personal/solo chats with `requiresTrigger: false` also don't need a prefix
- Check that the chat is registered: `sqlite3 store/messages.db "SELECT * FROM registered_groups"`
- Check `logs/bastionclaw.log` for errors

**Telegram bot not responding**:
- Verify bot token: `curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"`
- Check that the chat ID is registered (should start with `tg:`): `sqlite3 store/messages.db "SELECT * FROM registered_groups WHERE jid LIKE 'tg:%'"`
- For groups: ensure Group Privacy is disabled in BotFather (see step 6c)
- Ensure `.env` has the correct values (secrets are passed to containers via stdin automatically)

**Telegram bot only responds to @mentions in groups**:
- The bot has Group Privacy enabled (default). Fix: BotFather > `/mybots` > select bot > Bot Settings > Group Privacy > Turn off
- After changing, remove and re-add the bot to the group

**WhatsApp disconnected**:
- The service will show a macOS notification
- Run `npm run auth` to re-authenticate
- Restart the service: `./scripts/restart.sh`

**Restart the service (any platform)**:
```bash
./scripts/restart.sh          # Quick restart
./scripts/restart.sh --build  # Rebuild everything first
```
