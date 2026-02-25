---
name: setup
description: Run initial BastionClaw setup. Use when user wants to install dependencies, configure Telegram, register their main channel, or start the background services. Triggers on "setup", "install", "configure bastionclaw", or first-time setup requests.
allowed-tools: Bash(*), Read, Edit, Write, Glob, Grep, AskUserQuestion
---

# BastionClaw Setup

Run all commands automatically. Only pause when user action is required (creating a bot, sending /chatid).

**UX Rule:** Use `AskUserQuestion` for ALL interactions with the user. Never just output questions as text — always use the tool so the user gets structured prompts with selectable options.

**Minimize interruptions:** Batch related questions into a single AskUserQuestion call when possible. Don't ask permission to run bash commands — the `Bash(*)` allowed-tool means all commands are pre-approved. Just run them. Only pause for things that truly require user action (pasting tokens, scanning QR codes, creating external accounts).

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

Apple Container is macOS-only. Use Docker instead. Inform the user you'll use Docker, then use the `/convert-to-docker` skill and continue to Section 3.

### If on macOS

**If Apple Container is already installed:** Continue to Section 3.

**If Apple Container is NOT installed:**

AskUserQuestion: BastionClaw needs a container runtime for isolated agent execution. Which would you prefer?
- **Apple Container** (Recommended) — macOS-native, lightweight, designed for Apple silicon
- **Docker** — Cross-platform, widely used, works on macOS and Linux

#### Option A: Apple Container

AskUserQuestion: Apple Container needs to be installed. Please complete these steps:
1. Download the latest `.pkg` from https://github.com/apple/container/releases
2. Double-click to install
3. Let me know when it's done.
- **Done, I installed it** — Continue setup
- **I need help** — Show me more details

Then verify:

```bash
container system start
container --version
```

**Note:** BastionClaw automatically starts the Apple Container system when it launches, so you don't need to start it manually after reboots.

#### Option B: Docker

Use the `/convert-to-docker` skill to convert the codebase to Docker, then continue to Section 3.

## 3. Configure Claude Authentication

AskUserQuestion: How do you want to authenticate with Claude?
- **Claude subscription (Pro/Max)** (Recommended) — Uses your existing Claude subscription via OAuth token
- **Anthropic API key** — Uses a pay-per-use API key from console.anthropic.com

### Option 1: Claude Subscription (Recommended)

AskUserQuestion: Open another terminal and run `claude setup-token`. A browser will open for login. Once done, paste the token here.
- **I'll paste the token** — Paste it in the "Other" field
- **I'll add it to .env myself** — I know what I'm doing

If they give you the token, add it to `.env`:

```bash
echo "CLAUDE_CODE_OAUTH_TOKEN=<token>" > .env
```

### Option 2: API Key

AskUserQuestion: Do you have an existing Anthropic API key, or do you need to create one?
- **I have a key** — Paste it in the "Other" field
- **I need to create one** — I'll get one from console.anthropic.com

**If they have a key**, write it to `.env`:
```bash
echo "ANTHROPIC_API_KEY=<key>" > .env
```

**If they need to create one:**
```bash
echo 'ANTHROPIC_API_KEY=' > .env
```

AskUserQuestion: Go to https://console.anthropic.com/, create an API key, and paste it here.
- **I have the key** — Paste it in the "Other" field

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

AskUserQuestion: Which messaging channel do you want to use?
- **Telegram** (Recommended) — Easy setup, just create a bot with BotFather
- **WhatsApp** — Requires QR code scanning, uses unofficial API
- **Discord** — Create a Discord bot, good for team collaboration

### Option A: Telegram (Default)

AskUserQuestion: I need you to create a Telegram bot. Here's how:
1. Open Telegram and search for `@BotFather`
2. Send `/newbot` and follow prompts (name it anything, username must end with "bot")
3. Copy the bot token and paste it below
- **I have the token** — Paste it in the "Other" field
- **I need help** — Walk me through it step by step

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

AskUserQuestion: A QR code will appear in your browser. You'll need to scan it with WhatsApp (Settings > Linked Devices > Link a Device). Ready?
- **Yes, let's go** — Show the QR code
- **I need help** — Explain the process in detail

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

AskUserQuestion: Unlike Telegram (where only your bot receives messages), WhatsApp links as your personal account. Anyone in your groups who types the trigger word can activate the agent. How do you want to handle this?
- **Restrict to specific numbers** (Recommended) — Only messages from phone numbers you specify will trigger the bot
- **Allow all senders** — Anyone in your groups can trigger the bot

**If they choose "Restrict":**

AskUserQuestion: Enter your phone number(s) in international format without `+`, spaces, or dashes (e.g. `19195612265` for US +1-919-561-2265). For multiple numbers, separate with commas.
- **I'll paste my number(s)** — Paste in the "Other" field

Write to `.env`:
```bash
echo "WHATSAPP_ALLOWED_SENDERS=<numbers>" >> .env
```

**If they choose "Allow all":**

No action needed — the bot will respond to any sender. You can add `WHATSAPP_ALLOWED_SENDERS` later.

### 5c. Post-Pairing Interaction Guide (WhatsApp)

**Only show this section if the user chose WhatsApp.**

AskUserQuestion: Here's how WhatsApp interaction works. Your **main channel** needs no prefix — just type and the agent responds. In **other groups**, start messages with `@ASSISTANT_NAME`. Important: the bot responds **as you** (linked device). Non-allowed senders' messages are stored as context but won't trigger the agent. Got it?
- **Got it, continue** — Proceed to next step
- **Tell me more** — Explain in detail

## 6. Configure Assistant Name and Main Channel

This step configures three things at once: the trigger word, the main channel type, and the main channel selection.

### 6a. Ask for trigger word and main channel type

Collect trigger word and main channel type in one interaction:

AskUserQuestion: What trigger word should the agent respond to in group chats? (default: `Andy`). Messages starting with `@TriggerWord` will activate the agent. In your main channel, no prefix is needed.
- **Andy** (Recommended) — Use the default name
- **Custom name** — I'll type my preferred name in "Other"

If they chose a custom name, add it to `.env`:
```bash
echo "ASSISTANT_NAME=<name>" >> .env
```

### 6b. Main channel type

AskUserQuestion: Your "main" channel is your admin portal — it has elevated privileges (cross-group visibility, task management, global memory, full project access). Which setup do you want?
- **Personal chat (DM with bot)** (Recommended) — Only you have admin control
- **Solo group (just me)** — A group with only you in it
- **Group with other people** — Everyone in the group gets admin privileges

If they choose "Group with other people":

AskUserQuestion: Everyone in that group will be able to read messages from other chats, manage tasks, and access mounted directories. Are you sure?
- **Yes, I understand** — Proceed with shared admin access
- **No, I'll use a personal chat** — Switch to the recommended option

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

AskUserQuestion: The bot is running briefly so we can get your chat ID. Open Telegram, find your bot (or add it to a group), and send `/chatid`. The bot will reply with the ID. For group chats, you'll also need to disable Group Privacy in BotFather (`/mybots` > Bot Settings > Group Privacy > Turn off, then remove and re-add the bot). Paste the chat ID when ready.
- **I have the chat ID** — Paste it in the "Other" field (format: `tg:NUMBERS`)
- **I need help** — Walk me through it step by step

Wait for the user to provide the chat ID (format: `tg:NUMBERS`).

**For WhatsApp** (chose WhatsApp in step 5):

**For personal chat** (they chose option 1 in 6b):

Personal chats are NOT synced to the database on startup — only groups are. Ask the user for their phone number:

AskUserQuestion: I need your phone number to set up the main channel. Use international format without `+`, spaces, or dashes (e.g. `14155551234`).
- **I'll paste my number** — Paste in the "Other" field

Construct the JID as `{number}@s.whatsapp.net`.

**For group** (they chose option 2 or 3 in 6b):

Groups are synced on startup via `groupFetchAllParticipating`. Query the database for recent groups:
```bash
sqlite3 store/messages.db "SELECT jid, name FROM chats WHERE jid LIKE '%@g.us' AND jid != '__group_sync__' ORDER BY last_message_time DESC LIMIT 40"
```

Show the **10 most recent** group names via AskUserQuestion and ask the user to pick one. If they say their group isn't listed, show the next batch. If they provide a name directly, look it up:
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

AskUserQuestion: Do you want the agent to access directories **outside** the BastionClaw project? (e.g. Git repos, project folders, documents). Without this, agents can only access their own group folders.
- **No, skip this** (Recommended) — Agents stay sandboxed to their group folders
- **Yes, I want to grant access** — I'll specify which directories

If **no**, create an empty allowlist:

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

If **yes**, collect all directory info in one interaction:

### 7a. Collect Directory Paths

AskUserQuestion: Which directories should be accessible? List them in the "Other" field (one per line or comma-separated). For each, specify read-write or read-only. Example: `~/projects (read-write), ~/docs (read-only)`. Parent folders like `~/projects` allow access to everything inside.
- **I'll list my directories** — Type them in the "Other" field

Then ask about non-main group permissions:

AskUserQuestion: Should non-main groups (other chats added later) be restricted to read-only even if the directory allows read-write?
- **Yes, restrict non-main groups** (Recommended) — Prevents other groups from modifying files
- **No, same permissions for all** — All groups get the configured access level

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

AskUserQuestion: Mount allowlist configured! Sensitive paths (`.ssh`, `.gnupg`, `.aws`) are always blocked. To grant a group access to a directory later, add `additionalMounts` to their config in the database. The folder appears in the container at `/workspace/extra/<folder-name>`. Ready to continue?
- **Got it, continue** — Proceed to build and service setup
- **Tell me more about mounts** — Explain how container mounts work

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

Start tailing logs immediately:
```bash
tail -f logs/bastionclaw.log
```

AskUserQuestion: Setup complete! Send a test message to your bot now. In your main channel, just type `hello` — no prefix needed. In groups, use `@ASSISTANT_NAME hello`. Check the logs above for activity. Did you get a response?
- **Yes, it works!** — Setup is complete
- **No response** — Help me troubleshoot
- **Error in logs** — I see an error message

If they need troubleshooting, check the Troubleshooting section below.

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
