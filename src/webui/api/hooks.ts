import fs from 'fs';
import path from 'path';
import type { FastifyInstance } from 'fastify';

import { DATA_DIR, TRIGGER_PATTERN } from '../../config.js';
import { storeChatMessage } from '../../db.js';
import { logger } from '../../logger.js';
import type { ServerDeps } from '../server.js';

const MC_MAPPINGS_DIR = path.join(DATA_DIR, 'ipc', 'main', '.mc-mappings');

export function registerHookRoutes(
  app: FastifyInstance,
  deps: ServerDeps,
): void {
  app.post('/hooks/agent', async (req, reply) => {
    const body = req.body as {
      message?: string;
      sessionKey?: string;
      group?: string;
    };

    if (!body.message || !body.sessionKey) {
      return reply
        .status(400)
        .send({ error: 'Missing required fields: message, sessionKey' });
    }

    // Resolve target group: by folder name, default to main (web@chat)
    let chatJid = 'web@chat';
    let groupFolder = 'main';

    if (body.group) {
      const groups = deps.registeredGroups();
      const entry = Object.entries(groups).find(
        ([, g]) => g.folder === body.group,
      );
      if (!entry) {
        return reply
          .status(404)
          .send({ error: `Group not found: ${body.group}` });
      }
      chatJid = entry[0];
      groupFolder = entry[1].folder;
    }

    // Prefix with trigger pattern if group requires it
    let messageContent = body.message;
    if (groupFolder !== 'main' && !TRIGGER_PATTERN.test(messageContent)) {
      // Extract trigger word from pattern (e.g. "@jarvis")
      const triggerWord = `@${process.env.ASSISTANT_NAME || 'jarvis'}`;
      messageContent = `${triggerWord} ${messageContent}`;
    }

    // Store message in SQLite — the message loop picks it up
    const msgId = `mc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    storeChatMessage({
      id: msgId,
      chat_jid: chatJid,
      sender: 'mission-control',
      sender_name: 'Mission Control',
      content: messageContent,
      timestamp: new Date().toISOString(),
      is_from_me: false,
    });

    // Write .mc-mappings file so the watcher can correlate this run
    fs.mkdirSync(MC_MAPPINGS_DIR, { recursive: true });
    const mappingFile = path.join(
      MC_MAPPINGS_DIR,
      `${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`,
    );
    fs.writeFileSync(
      mappingFile,
      JSON.stringify({
        sessionKey: body.sessionKey,
        group: groupFolder,
      }),
    );

    // Trigger immediate processing
    deps.queue.enqueueMessageCheck(chatJid);

    logger.info(
      { chatJid, groupFolder, sessionKey: body.sessionKey, msgId },
      'Mission Control hook: message enqueued',
    );

    return reply.send({ ok: true, chatJid, groupFolder });
  });
}
