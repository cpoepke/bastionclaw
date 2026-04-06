import {
  Client,
  Events,
  GatewayIntentBits,
  Message,
  TextChannel,
  WebhookClient,
} from 'discord.js';

import { ASSISTANT_NAME, TRIGGER_PATTERN } from '../config.js';
import { logger } from '../logger.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

/**
 * Split text into chunks that respect word boundaries.
 * Tries to split on newlines first, then spaces, and only
 * hard-splits mid-word as a last resort.
 */
function chunkText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitAt = -1;

    // Try to split at a newline
    const lastNewline = remaining.lastIndexOf('\n', maxLength);
    if (lastNewline > 0) {
      splitAt = lastNewline + 1; // keep the newline in the first chunk
    }

    // Fall back to last space
    if (splitAt <= 0) {
      const lastSpace = remaining.lastIndexOf(' ', maxLength);
      if (lastSpace > 0) {
        splitAt = lastSpace + 1;
      }
    }

    // Hard split as last resort
    if (splitAt <= 0) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  return chunks;
}

export interface DiscordChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

export class DiscordChannel implements Channel {
  name = 'discord';

  private client: Client | null = null;
  private opts: DiscordChannelOpts;
  private botToken: string;
  private webhookMap = new Map<string, WebhookClient>();
  private defaultWebhook: WebhookClient | null = null;

  constructor(botToken: string, opts: DiscordChannelOpts) {
    this.botToken = botToken;
    this.opts = opts;
  }

  initWebhooks(mapping: Record<string, string>, fallbackUrls: string[]): void {
    for (const [jid, url] of Object.entries(mapping)) {
      this.webhookMap.set(jid, new WebhookClient({ url }));
    }
    if (fallbackUrls.length > 0) {
      this.defaultWebhook = new WebhookClient({ url: fallbackUrls[0] });
    }
    logger.info(
      { mapped: this.webhookMap.size, fallback: !!this.defaultWebhook },
      'Discord webhooks initialized',
    );
  }

  registerWebhook(jid: string, url: string): void {
    this.webhookMap.set(jid, new WebhookClient({ url }));
    logger.info({ jid }, 'Discord webhook registered');
  }

  async sendAsWebhook(
    jid: string,
    text: string,
    sender: string,
  ): Promise<void> {
    const wh = this.webhookMap.get(jid) || this.defaultWebhook;
    if (!wh) {
      await this.sendMessage(jid, `${sender}: ${text}`);
      return;
    }

    const chunks = chunkText(text, 2000);

    for (const chunk of chunks) {
      await wh.send({
        content: chunk,
        username: sender,
        avatarURL: `https://ui-avatars.com/api/?name=${encodeURIComponent(sender)}&background=random&size=128`,
      });
    }
    logger.info(
      { jid, sender, length: text.length },
      'Discord webhook message sent',
    );
  }

  async connect(): Promise<void> {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      if (message.author.bot) return;

      const channelId = message.channelId;
      const chatJid = `dc:${channelId}`;
      let content = message.content;
      const timestamp = message.createdAt.toISOString();
      const senderName =
        message.member?.displayName ||
        message.author.displayName ||
        message.author.username;
      const sender = message.author.id;
      const msgId = message.id;

      let chatName: string;
      if (message.guild) {
        const textChannel = message.channel as TextChannel;
        chatName = `${message.guild.name} #${textChannel.name}`;
      } else {
        chatName = senderName;
      }

      // Translate @bot mentions into trigger format
      if (this.client?.user) {
        const botId = this.client.user.id;
        const isBotMentioned =
          message.mentions.users.has(botId) ||
          content.includes(`<@${botId}>`) ||
          content.includes(`<@!${botId}>`);

        if (isBotMentioned) {
          content = content
            .replace(new RegExp(`<@!?${botId}>`, 'g'), '')
            .trim();
          if (!TRIGGER_PATTERN.test(content)) {
            content = `@${ASSISTANT_NAME} ${content}`;
          }
        }
      }

      // Describe attachments as text placeholders
      if (message.attachments.size > 0) {
        const attachmentDescriptions = [...message.attachments.values()].map(
          (att) => {
            const contentType = att.contentType || '';
            if (contentType.startsWith('image/')) {
              return `[Image: ${att.name || 'image'}]`;
            } else if (contentType.startsWith('video/')) {
              return `[Video: ${att.name || 'video'}]`;
            } else if (contentType.startsWith('audio/')) {
              return `[Audio: ${att.name || 'audio'}]`;
            } else {
              return `[File: ${att.name || 'file'}]`;
            }
          },
        );
        if (content) {
          content = `${content}\n${attachmentDescriptions.join('\n')}`;
        } else {
          content = attachmentDescriptions.join('\n');
        }
      }

      // Include reply context
      if (message.reference?.messageId) {
        try {
          const repliedTo = await message.channel.messages.fetch(
            message.reference.messageId,
          );
          const replyAuthor =
            repliedTo.member?.displayName ||
            repliedTo.author.displayName ||
            repliedTo.author.username;
          content = `[Reply to ${replyAuthor}] ${content}`;
        } catch {
          // Referenced message may have been deleted
        }
      }

      this.opts.onChatMetadata(chatJid, timestamp, chatName);

      const group = this.opts.registeredGroups()[chatJid];
      if (!group) {
        logger.debug(
          { chatJid, chatName },
          'Message from unregistered Discord channel',
        );
        return;
      }

      this.opts.onMessage(chatJid, {
        id: msgId,
        chat_jid: chatJid,
        sender,
        sender_name: senderName,
        content,
        timestamp,
        is_from_me: false,
      });

      logger.info(
        { chatJid, chatName, sender: senderName },
        'Discord message stored',
      );
    });

    this.client.on(Events.Error, (err) => {
      logger.error({ err: err.message }, 'Discord client error');
    });

    return new Promise<void>((resolve) => {
      this.client!.once(Events.ClientReady, (readyClient) => {
        logger.info(
          { username: readyClient.user.tag, id: readyClient.user.id },
          'Discord bot connected',
        );
        console.log(`\n  Discord bot: ${readyClient.user.tag}`);
        console.log(
          `  Use /chatid command or check channel IDs in Discord settings\n`,
        );
        resolve();
      });

      this.client!.login(this.botToken);
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.client) {
      logger.warn('Discord client not initialized');
      return;
    }

    try {
      const channelId = jid.replace(/^dc:/, '');
      const channel = await this.client.channels.fetch(channelId);

      if (!channel || !('send' in channel)) {
        logger.warn({ jid }, 'Discord channel not found or not text-based');
        return;
      }

      const textChannel = channel as TextChannel;

      const chunks = chunkText(text, 2000);
      for (const chunk of chunks) {
        await textChannel.send(chunk);
      }
      logger.info({ jid, length: text.length }, 'Discord message sent');
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Discord message');
    }
  }

  isConnected(): boolean {
    return this.client !== null && this.client.isReady();
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('dc:');
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      logger.info('Discord bot stopped');
    }
  }

  async sendImage(
    jid: string,
    imagePath: string,
    caption?: string,
  ): Promise<void> {
    if (!this.client) {
      logger.warn('Discord client not initialized');
      return;
    }

    try {
      const channelId = jid.replace(/^dc:/, '');
      const channel = await this.client.channels.fetch(channelId);

      if (!channel || !('send' in channel)) {
        logger.warn({ jid }, 'Discord channel not found or not text-based');
        return;
      }

      await (channel as TextChannel).send({
        content: caption || '',
        files: [imagePath],
      });
      logger.info({ jid, imagePath }, 'Discord image sent');
    } catch (err) {
      logger.error({ jid, imagePath, err }, 'Failed to send Discord image');
    }
  }

  async sendImageAsWebhook(
    jid: string,
    imagePath: string,
    caption: string,
    sender: string,
  ): Promise<void> {
    const wh = this.webhookMap.get(jid) || this.defaultWebhook;
    if (!wh) {
      await this.sendImage(jid, imagePath, `${sender}: ${caption}`);
      return;
    }

    await wh.send({
      content: caption || '',
      username: sender,
      avatarURL: `https://ui-avatars.com/api/?name=${encodeURIComponent(sender)}&background=random&size=128`,
      files: [imagePath],
    });
    logger.info({ jid, sender, imagePath }, 'Discord webhook image sent');
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!this.client || !isTyping) return;
    try {
      const channelId = jid.replace(/^dc:/, '');
      const channel = await this.client.channels.fetch(channelId);
      if (channel && 'sendTyping' in channel) {
        await (channel as TextChannel).sendTyping();
      }
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send Discord typing indicator');
    }
  }
}
