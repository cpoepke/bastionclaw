import 'dotenv/config';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  WHATSAPP_ALLOWED_SENDERS,
  ASSISTANT_NAME,
  DATA_DIR,
  IDLE_TIMEOUT,
  MAIN_GROUP_FOLDER,
  POLL_INTERVAL,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_ONLY,
  DISCORD_BOT_TOKEN,
  DISCORD_ONLY,
  DISCORD_WEBHOOK_URLS,
  TRIGGER_PATTERN,
  getContainerRuntime,
} from './config.js';
import { DiscordChannel } from './channels/discord.js';
import { TelegramChannel } from './channels/telegram.js';
import { WebUIChannel } from './channels/webui.js';
import { WhatsAppChannel } from './channels/whatsapp.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getAllTasks,
  getMessagesSince,
  getNewMessages,
  getRouterState,
  initDatabase,
  setRegisteredGroup,
  setRouterState,
  setSession,
  storeChatMetadata,
  storeMessage,
} from './db.js';
import { isValidGroupFolder, resolveGroupFolderPath } from './group-folder.js';
import { GroupQueue } from './group-queue.js';
import { startIpcWatcher } from './ipc.js';
import { findChannel, formatMessages, formatOutbound } from './router.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { Channel, NewMessage, RegisteredGroup } from './types.js';
import { logger } from './logger.js';
import { startQmdWatcher } from './qmd-watcher.js';
import { startWebServer } from './webui/server.js';

// Re-export for backwards compatibility during refactor
export { escapeXml, formatMessages } from './router.js';

let lastTimestamp = '';
let sessions: Record<string, string> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
let messageLoopRunning = false;

let whatsapp: WhatsAppChannel;
const channels: Channel[] = [];
const queue = new GroupQueue();

// Shared typing interval management — tracks per-chat typing indicator timers
// so both processGroupMessages and the piped-message path in messageLoop can
// start/stop typing without scoping issues.
const typingIntervals = new Map<string, ReturnType<typeof setInterval>>();

function startTypingInterval(chatJid: string, channel: Channel): void {
  clearTypingInterval(chatJid);
  if (channel.setTyping) {
    typingIntervals.set(
      chatJid,
      setInterval(() => channel.setTyping!(chatJid, true), 4000),
    );
  }
}

function clearTypingInterval(chatJid: string): void {
  const existing = typingIntervals.get(chatJid);
  if (existing) {
    clearInterval(existing);
    typingIntervals.delete(chatJid);
  }
}

function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn('Corrupted last_agent_timestamp in DB, resetting');
    lastAgentTimestamp = {};
  }
  sessions = getAllSessions();
  registeredGroups = getAllRegisteredGroups();
  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded',
  );
}

function saveState(): void {
  setRouterState('last_timestamp', lastTimestamp);
  setRouterState(
    'last_agent_timestamp',
    JSON.stringify(lastAgentTimestamp),
  );
}

function registerGroup(jid: string, group: RegisteredGroup): void {
  if (!isValidGroupFolder(group.folder)) {
    logger.error({ folder: group.folder }, 'Rejected group with invalid folder name');
    return;
  }
  registeredGroups[jid] = group;
  setRegisteredGroup(jid, group);

  // Create group folder (validated path)
  const groupDir = resolveGroupFolderPath(group.folder);
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

/**
 * Get available groups list for the agent.
 * Returns groups ordered by most recent activity.
 */
export function getAvailableGroups(): import('./container-runner.js').AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__' && (c.jid.endsWith('@g.us') || c.jid.startsWith('tg:') || c.jid.startsWith('dc:')))
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

/** @internal - exported for testing */
export function _setRegisteredGroups(groups: Record<string, RegisteredGroup>): void {
  registeredGroups = groups;
}

/**
 * Process all pending messages for a group.
 * Called by the GroupQueue when it's this group's turn.
 */
async function processGroupMessages(chatJid: string): Promise<boolean> {
  const group = registeredGroups[chatJid];
  if (!group) return true;

  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

  const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
  const missedMessages = getMessagesSince(
    chatJid,
    sinceTimestamp,
    ASSISTANT_NAME,
  );

  if (missedMessages.length === 0) return true;

  // Filter by sender allowlist — only applies to WhatsApp (numeric sender IDs)
  const filteredMessages = WHATSAPP_ALLOWED_SENDERS.size > 0
    ? missedMessages.filter((m) => {
        const id = m.sender.split('@')[0];
        return !/^\d+$/.test(id) || WHATSAPP_ALLOWED_SENDERS.has(id);
      })
    : missedMessages;

  if (filteredMessages.length === 0) return true;

  // For non-main groups, check if trigger is required and present
  if (!isMainGroup && group.requiresTrigger !== false) {
    const hasTrigger = filteredMessages.some((m) =>
      TRIGGER_PATTERN.test(m.content.trim()),
    );
    if (!hasTrigger) return true;
  }

  const prompt = formatMessages(filteredMessages);

  // Advance cursor so the piping path in startMessageLoop won't re-fetch
  // these messages. Save the old cursor so we can roll back on error.
  const previousCursor = lastAgentTimestamp[chatJid] || '';
  lastAgentTimestamp[chatJid] =
    filteredMessages[filteredMessages.length - 1].timestamp;
  saveState();

  logger.info(
    {
      group: group.name,
      messageCount: filteredMessages.length,
      prompt: filteredMessages[0]?.content,
    },
    'Processing messages',
  );

  // Track idle timer for closing stdin when agent is idle
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug({ group: group.name }, 'Idle timeout, closing container stdin');
      queue.closeStdin(chatJid);
    }, IDLE_TIMEOUT);
  };

  const channel = findChannel(channels, chatJid);
  // Telegram typing indicators expire after ~5s, so re-send periodically
  if (channel?.setTyping) {
    await channel.setTyping(chatJid, true);
    startTypingInterval(chatJid, channel);
  }
  let hadError = false;
  let outputSentToUser = false;

  const output = await runAgent(group, prompt, chatJid, async (result) => {
    // Streaming output callback — called for each agent result
    if (result.result) {
      const raw = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
      // Strip <internal>...</internal> blocks — agent uses these for internal reasoning
      const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
      logger.info({ group: group.name, hasChannel: !!channel, textLen: text.length }, `Agent output: ${raw.slice(0, 200)}`);
      if (text && channel) {
        const formatted = formatOutbound(channel, text);
        if (formatted) {
          try {
            await channel.sendMessage(chatJid, formatted);
          } catch (err) {
            logger.error({ group: group.name, chatJid, err }, 'Failed to send agent output');
          }
        } else {
          logger.warn({ group: group.name }, 'formatOutbound returned empty');
        }
        outputSentToUser = true;
      } else if (!channel) {
        logger.warn({ group: group.name }, 'No channel found for agent output');
      }
      // Clear typing indicator after sending a response
      clearTypingInterval(chatJid);
      if (channel?.setTyping) channel.setTyping(chatJid, false).catch(() => {});
      // Only reset idle timer on actual results, not session-update markers (result: null)
      resetIdleTimer();
    } else if (result.status !== 'error') {
      // Null result = agent query/turn completed (waiting for next input).
      // Do NOT clear typing here — agent may still be working on piped messages
      // or starting a new query round. Typing clears when output is sent or container exits.
      logger.info({ group: group.name }, 'Agent query completed');
      queue.notifyIdle(chatJid);
    }

    if (result.status === 'error') {
      hadError = true;
    }
  });

  clearTypingInterval(chatJid);
  if (channel?.setTyping) await channel.setTyping(chatJid, false);
  if (idleTimer) clearTimeout(idleTimer);

  if (output === 'error' || hadError) {
    // If we already sent output to the user, don't roll back the cursor —
    // the user got their response and re-processing would send duplicates.
    if (outputSentToUser) {
      logger.warn({ group: group.name }, 'Agent error after output was sent, skipping cursor rollback to prevent duplicates');
      return true;
    }

    // Notify the user that something went wrong so they don't wait in silence.
    if (channel) {
      try {
        await channel.sendMessage(chatJid, '⚠️ Something went wrong processing that request. The agent will retry automatically.');
      } catch (notifyErr) {
        logger.warn({ group: group.name, err: notifyErr }, 'Failed to send error notification to channel');
      }
    }

    // Roll back cursor so retries can re-process these messages
    lastAgentTimestamp[chatJid] = previousCursor;
    saveState();
    logger.warn({ group: group.name }, 'Agent error, rolled back message cursor for retry');
    return false;
  }

  return true;
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<'success' | 'error'> {
  const isMain = group.folder === MAIN_GROUP_FOLDER;
  const sessionId = sessions[group.folder];

  // Update tasks snapshot for container to read (filtered by group)
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  // Update available groups snapshot (main group only can see all groups)
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  // Wrap onOutput to track session ID from streamed results
  const wrappedOnOutput = onOutput
    ? async (output: ContainerOutput) => {
        if (output.newSessionId) {
          sessions[group.folder] = output.newSessionId;
          setSession(group.folder, output.newSessionId);
        }
        await onOutput(output);
      }
    : undefined;

  try {
    const output = await runContainerAgent(
      group,
      {
        prompt,
        sessionId,
        groupFolder: group.folder,
        chatJid,
        isMain,
        assistantName: ASSISTANT_NAME,
      },
      (proc, containerName) => queue.registerProcess(chatJid, proc, containerName, group.folder),
      wrappedOnOutput,
    );

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      setSession(group.folder, output.newSessionId);
    }

    if (output.status === 'error') {
      logger.error(
        { group: group.name, error: output.error },
        'Container agent error',
      );
      return 'error';
    }

    return 'success';
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return 'error';
  }
}

async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  messageLoopRunning = true;

  logger.info(`BastionClaw running (trigger: @${ASSISTANT_NAME})`);

  while (true) {
    try {
      const jids = Object.keys(registeredGroups);
      const { messages, newTimestamp } = getNewMessages(
        jids,
        lastTimestamp,
        ASSISTANT_NAME,
      );

      if (messages.length > 0) {
        logger.info({ count: messages.length }, 'New messages');

        // Advance the "seen" cursor for all messages immediately
        lastTimestamp = newTimestamp;
        saveState();

        // Deduplicate by group
        const messagesByGroup = new Map<string, NewMessage[]>();
        for (const msg of messages) {
          const existing = messagesByGroup.get(msg.chat_jid);
          if (existing) {
            existing.push(msg);
          } else {
            messagesByGroup.set(msg.chat_jid, [msg]);
          }
        }

        for (const [chatJid, groupMessages] of messagesByGroup) {
          const group = registeredGroups[chatJid];
          if (!group) continue;

          const isMainGroup = group.folder === MAIN_GROUP_FOLDER;
          const needsTrigger = !isMainGroup && group.requiresTrigger !== false;

          // Filter by sender allowlist — only applies to WhatsApp (numeric sender IDs)
          const allowed = WHATSAPP_ALLOWED_SENDERS.size > 0
            ? groupMessages.filter((m) => {
                const id = m.sender.split('@')[0];
                return !/^\d+$/.test(id) || WHATSAPP_ALLOWED_SENDERS.has(id);
              })
            : groupMessages;
          if (allowed.length === 0) continue;

          // For non-main groups, only act on trigger messages.
          // Non-trigger messages accumulate in DB and get pulled as
          // context when a trigger eventually arrives.
          if (needsTrigger) {
            const hasTrigger = allowed.some((m) =>
              TRIGGER_PATTERN.test(m.content.trim()),
            );
            if (!hasTrigger) continue;
          }

          // Pull all messages since lastAgentTimestamp so non-trigger
          // context that accumulated between triggers is included.
          const allPending = getMessagesSince(
            chatJid,
            lastAgentTimestamp[chatJid] || '',
            ASSISTANT_NAME,
          );
          const messagesToSend =
            allPending.length > 0 ? allPending : groupMessages;
          const formatted = formatMessages(messagesToSend);

          if (queue.sendMessage(chatJid, formatted)) {
            logger.info(
              { chatJid, count: messagesToSend.length, prompt: messagesToSend[0]?.content },
              'Piped messages to active container',
            );
            lastAgentTimestamp[chatJid] =
              messagesToSend[messagesToSend.length - 1].timestamp;
            saveState();
            // Restart typing interval for piped messages (previous one
            // may have been cleared when the last response was sent)
            const ch = findChannel(channels, chatJid);
            if (ch?.setTyping) {
              await ch.setTyping(chatJid, true);
              startTypingInterval(chatJid, ch);
            }
          } else {
            // No active container — enqueue for a new one
            queue.enqueueMessageCheck(chatJid);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

/**
 * Startup recovery: check for unprocessed messages in registered groups.
 * Handles crash between advancing lastTimestamp and processing messages.
 */
function recoverPendingMessages(): void {
  for (const [chatJid, group] of Object.entries(registeredGroups)) {
    const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
    const pending = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
    if (pending.length > 0) {
      logger.info(
        { group: group.name, pendingCount: pending.length },
        'Recovery: found unprocessed messages',
      );
      queue.enqueueMessageCheck(chatJid);
    }
  }
}

function ensureContainerSystemRunning(): void {
  const runtime = getContainerRuntime();

  if (runtime === 'container') {
    // Apple Container (macOS)
    try {
      execFileSync('container', ['system', 'status'], { stdio: 'pipe' });
      logger.debug('Apple Container system already running');
    } catch {
      logger.info('Starting Apple Container system...');
      try {
        execFileSync('container', ['system', 'start'], { stdio: 'pipe', timeout: 30000 });
        logger.info('Apple Container system started');
      } catch (err) {
        logger.error({ err }, 'Failed to start Apple Container system');
        console.error('\n╔════════════════════════════════════════════════════════════════╗');
        console.error('║  FATAL: Apple Container system failed to start                 ║');
        console.error('║                                                                ║');
        console.error('║  Agents cannot run without Apple Container. To fix:           ║');
        console.error('║  1. Install from: https://github.com/apple/container/releases ║');
        console.error('║  2. Run: container system start                               ║');
        console.error('║  3. Restart BastionClaw                                          ║');
        console.error('╚════════════════════════════════════════════════════════════════╝\n');
        throw new Error('Apple Container system is required but failed to start');
      }
    }
  } else {
    // Docker
    try {
      execFileSync('docker', ['info'], { stdio: 'pipe', timeout: 10000 });
      logger.debug('Docker daemon is running');
    } catch {
      logger.error('Docker daemon is not running');
      console.error('\n╔════════════════════════════════════════════════════════════════╗');
      console.error('║  FATAL: Docker is not running                                  ║');
      console.error('║                                                                ║');
      console.error('║  Agents cannot run without Docker. To fix:                     ║');
      console.error('║  macOS:  Start Docker Desktop                                  ║');
      console.error('║  Linux:  sudo systemctl start docker                           ║');
      console.error('║  Install: https://docker.com/products/docker-desktop           ║');
      console.error('╚════════════════════════════════════════════════════════════════╝\n');
      throw new Error('Docker is required but not running');
    }
  }

  // Kill and clean up orphaned BastionClaw containers from previous runs
  try {
    if (runtime === 'container') {
      const output = execFileSync('container', ['ls', '--format', 'json'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf-8',
      });
      const containers: { status: string; configuration: { id: string } }[] = JSON.parse(output || '[]');
      const orphans = containers
        .filter((c) => c.status === 'running' && c.configuration.id.startsWith('bastionclaw-'))
        .map((c) => c.configuration.id);
      for (const name of orphans) {
        try {
          execFileSync('container', ['stop', name], { stdio: 'pipe', timeout: 10000 });
        } catch {
          // If stop hangs, force kill via launchctl process lookup (no shell interpolation)
          try {
            const launchList = execFileSync('launchctl', ['list'], { encoding: 'utf-8', stdio: 'pipe', timeout: 5000 });
            const pidLine = launchList.split('\n').find(l => l.includes(name));
            if (pidLine) {
              const pid = pidLine.trim().split(/\s+/)[0];
              if (/^\d+$/.test(pid)) {
                execFileSync('kill', ['-9', pid], { stdio: 'pipe', timeout: 5000 });
              }
            }
          } catch { /* best effort */ }
        }
      }
      if (orphans.length > 0) {
        logger.info({ count: orphans.length, names: orphans }, 'Stopped orphaned containers');
      }
    } else {
      const output = execFileSync('docker', ['ps', '--format', '{{.Names}}', '--filter', 'name=bastionclaw-'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf-8',
      });
      const orphans = output.trim().split('\n').filter(Boolean);
      for (const name of orphans) {
        try {
          execFileSync('docker', ['stop', '-t', '5', name], { stdio: 'pipe', timeout: 10000 });
          execFileSync('docker', ['rm', '-f', name], { stdio: 'pipe', timeout: 5000 });
        } catch { /* already stopped */ }
      }
      if (orphans.length > 0) {
        logger.info({ count: orphans.length, names: orphans }, 'Stopped orphaned containers');
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to clean up orphaned containers');
  }
}

async function main(): Promise<void> {
  ensureContainerSystemRunning();
  initDatabase();
  logger.info('Database initialized');
  loadState();

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    await queue.shutdown(10000);
    for (const ch of channels) await ch.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start WebUI server early so it's available even if channels fail to connect
  startWebServer({
    queue,
    channels: () => channels,
    registeredGroups: () => registeredGroups,
  });

  // Channel callbacks (shared by all channels)
  const channelOpts = {
    onMessage: (chatJid: string, msg: NewMessage) => storeMessage(msg),
    onChatMetadata: (chatJid: string, timestamp: string, name?: string) =>
      storeChatMetadata(chatJid, timestamp, name),
    registeredGroups: () => registeredGroups,
  };

  // Create and connect channels
  if (!TELEGRAM_ONLY && !DISCORD_ONLY) {
    whatsapp = new WhatsAppChannel(channelOpts);
    channels.push(whatsapp);
    await whatsapp.connect();
  }

  if (TELEGRAM_BOT_TOKEN) {
    const telegram = new TelegramChannel(TELEGRAM_BOT_TOKEN, channelOpts);
    channels.push(telegram);
    await telegram.connect();
  }

  if (DISCORD_BOT_TOKEN) {
    const discord = new DiscordChannel(DISCORD_BOT_TOKEN, channelOpts);
    channels.push(discord);
    await discord.connect();
    if (DISCORD_WEBHOOK_URLS.length > 0) {
      discord.initWebhooks(DISCORD_WEBHOOK_URLS);
    }
  }

  // WebUI channel — register web@chat as an alias for the main group
  const webuiChannel = new WebUIChannel();
  channels.push(webuiChannel);

  // Register web@chat so the message loop picks up WebUI messages
  const mainEntry = Object.entries(registeredGroups)
    .find(([, g]) => g.folder === MAIN_GROUP_FOLDER);
  if (mainEntry) {
    const [, mainGroup] = mainEntry;
    registeredGroups['web@chat'] = {
      ...mainGroup,
      name: mainGroup.name,
      requiresTrigger: false,
    };
  }

  // Start qmd file watcher for auto-indexing memory
  startQmdWatcher();

  // Start subsystems (independently of connection handler)
  startSchedulerLoop({
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
    queue,
    onProcess: (groupJid, proc, containerName, groupFolder) => queue.registerProcess(groupJid, proc, containerName, groupFolder),
    sendMessage: async (jid, rawText) => {
      const channel = findChannel(channels, jid);
      if (!channel) return;
      const text = formatOutbound(channel, rawText);
      if (text) await channel.sendMessage(jid, text);
    },
  });
  startIpcWatcher({
    sendMessage: (jid, text) => {
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      return channel.sendMessage(jid, text);
    },
    sendWebhookMessage: DISCORD_WEBHOOK_URLS.length > 0
      ? async (jid, text, sender) => {
          const ch = findChannel(channels, jid);
          if (ch instanceof DiscordChannel) {
            await ch.sendAsWebhook(jid, text, sender);
          } else if (ch) {
            await ch.sendMessage(jid, `${sender}: ${text}`);
          }
        }
      : undefined,
    registeredGroups: () => registeredGroups,
    registerGroup,
    syncGroupMetadata: (force) => whatsapp?.syncGroupMetadata(force) ?? Promise.resolve(),
    getAvailableGroups,
    writeGroupsSnapshot: (gf, im, ag, rj) => writeGroupsSnapshot(gf, im, ag, rj),
  });
  queue.setProcessMessagesFn(processGroupMessages);
  recoverPendingMessages();

  startMessageLoop().catch((err) => {
    logger.error({ err }, 'Fatal error in message loop');
    process.exit(1);
  });
}

// Guard: only run when executed directly, not when imported by tests
const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'Failed to start BastionClaw');
    process.exit(1);
  });
}
