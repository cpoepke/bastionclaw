import crypto from 'crypto';
import { execFile, execFileSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import { CronExpressionParser } from 'cron-parser';

import { getQmdBin } from './qmd.js';

import {
  ASSISTANT_NAME,
  DATA_DIR,
  GROUPS_DIR,
  IPC_POLL_INTERVAL,
  MAIN_GROUP_FOLDER,
  TIMEZONE,
} from './config.js';
import { isValidGroupFolder } from './group-folder.js';
import { AvailableGroup } from './container-runner.js';
import {
  createTask, deleteTask, getTaskById, updateTask,
  hashSourceUrl, getSourceByHash, createSource, createInsight,
  linkInsightSource, getTopInsights, searchInsightsKeyword,
  type InsightSource,
} from './db.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';

export interface IpcDeps {
  sendMessage: (jid: string, text: string) => Promise<void>;
  sendWebhookMessage?: (jid: string, text: string, sender: string) => Promise<void>;
  sendImage?: (jid: string, imagePath: string, caption?: string) => Promise<void>;
  sendWebhookImage?: (jid: string, imagePath: string, caption: string, sender: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  registerGroup: (jid: string, group: RegisteredGroup) => void;
  registerWebhook?: (jid: string, url: string) => void;
  syncGroupMetadata: (force: boolean) => Promise<void>;
  getAvailableGroups: () => AvailableGroup[];
  writeGroupsSnapshot: (
    groupFolder: string,
    isMain: boolean,
    availableGroups: AvailableGroup[],
    registeredJids: Set<string>,
  ) => void;
}

/** Resolve a container path to the host path.
 *  /workspace/group/foo.png → groups/{folder}/foo.png
 *  foo.png (bare filename)  → groups/{folder}/foo.png
 */
function resolveContainerPath(containerPath: string, groupFolder: string): string {
  const stripped = containerPath.replace(/^\/workspace\/group\//, '');
  if (stripped !== containerPath) {
    return path.join(GROUPS_DIR, groupFolder, stripped);
  }
  // Bare filename or relative path — resolve relative to group dir
  if (!path.isAbsolute(containerPath)) {
    return path.join(GROUPS_DIR, groupFolder, containerPath);
  }
  return containerPath;
}

let ipcWatcherRunning = false;

export function startIpcWatcher(deps: IpcDeps): void {
  if (ipcWatcherRunning) {
    logger.debug('IPC watcher already running, skipping duplicate start');
    return;
  }
  ipcWatcherRunning = true;

  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  const processIpcFiles = async () => {
    // Scan all group IPC directories (identity determined by directory)
    let groupFolders: string[];
    try {
      groupFolders = fs.readdirSync(ipcBaseDir).filter((f) => {
        const stat = fs.statSync(path.join(ipcBaseDir, f));
        return stat.isDirectory() && f !== 'errors';
      });
    } catch (err) {
      logger.error({ err }, 'Error reading IPC base directory');
      setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
      return;
    }

    const registeredGroups = deps.registeredGroups();

    for (const sourceGroup of groupFolders) {
      const isMain = sourceGroup === MAIN_GROUP_FOLDER;
      const messagesDir = path.join(ipcBaseDir, sourceGroup, 'messages');
      const tasksDir = path.join(ipcBaseDir, sourceGroup, 'tasks');

      // Process messages from this group's IPC directory
      try {
        if (fs.existsSync(messagesDir)) {
          const messageFiles = fs
            .readdirSync(messagesDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of messageFiles) {
            const filePath = path.join(messagesDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              if (data.type === 'message' && data.chatJid && data.text) {
                // Authorization: verify this group can send to this chatJid
                const targetGroup = registeredGroups[data.chatJid];
                if (
                  isMain ||
                  (targetGroup && targetGroup.folder === sourceGroup)
                ) {
                  // Strip <internal>...</internal> blocks — agent reasoning not for end users
                  const text = data.text.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
                  if (!text && !data.image) {
                    logger.debug({ chatJid: data.chatJid, sourceGroup }, 'IPC message suppressed (internal-only)');
                  } else if (data.image) {
                    // Resolve container path to host path
                    const hostImagePath = resolveContainerPath(data.image, sourceGroup);
                    if (fs.existsSync(hostImagePath)) {
                      if (data.sender && deps.sendWebhookImage) {
                        await deps.sendWebhookImage(data.chatJid, hostImagePath, text, data.sender);
                      } else if (deps.sendImage) {
                        await deps.sendImage(data.chatJid, hostImagePath, text || undefined);
                      } else if (text) {
                        // Fallback: send text only
                        await deps.sendMessage(data.chatJid, `${ASSISTANT_NAME}: ${text}`);
                      }
                      logger.info(
                        { chatJid: data.chatJid, sourceGroup, image: hostImagePath },
                        'IPC image message sent',
                      );
                    } else {
                      logger.warn(
                        { chatJid: data.chatJid, sourceGroup, image: data.image, resolved: hostImagePath },
                        'IPC image file not found, sending text only',
                      );
                      if (text) {
                        if (data.sender && deps.sendWebhookMessage) {
                          await deps.sendWebhookMessage(data.chatJid, text, data.sender);
                        } else {
                          await deps.sendMessage(data.chatJid, `${ASSISTANT_NAME}: ${text}`);
                        }
                      }
                    }
                  } else if (data.sender && deps.sendWebhookMessage) {
                    await deps.sendWebhookMessage(data.chatJid, text, data.sender);
                    logger.info(
                      { chatJid: data.chatJid, sourceGroup, sender: data.sender },
                      'IPC webhook message sent',
                    );
                  } else {
                    await deps.sendMessage(
                      data.chatJid,
                      `${ASSISTANT_NAME}: ${text}`,
                    );
                    logger.info(
                      { chatJid: data.chatJid, sourceGroup },
                      'IPC message sent',
                    );
                  }
                } else {
                  logger.warn(
                    { chatJid: data.chatJid, sourceGroup },
                    'Unauthorized IPC message attempt blocked',
                  );
                }
              }
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC message',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error(
          { err, sourceGroup },
          'Error reading IPC messages directory',
        );
      }

      // Process tasks from this group's IPC directory
      try {
        if (fs.existsSync(tasksDir)) {
          const taskFiles = fs
            .readdirSync(tasksDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of taskFiles) {
            const filePath = path.join(tasksDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              // Pass source group identity to processTaskIpc for authorization
              await processTaskIpc(data, sourceGroup, isMain, deps);
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC task',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error({ err, sourceGroup }, 'Error reading IPC tasks directory');
      }
    }

    setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
  };

  processIpcFiles();
  logger.info('IPC watcher started (per-group namespaces)');
}

export async function processTaskIpc(
  data: {
    type: string;
    taskId?: string;
    prompt?: string;
    schedule_type?: string;
    schedule_value?: string;
    context_mode?: string;
    groupFolder?: string;
    chatJid?: string;
    targetJid?: string;
    // For register_group
    jid?: string;
    name?: string;
    folder?: string;
    trigger?: string;
    channel?: string;
    containerConfig?: RegisteredGroup['containerConfig'];
    // For qmd request-response IPC
    requestId?: string;
    query?: string;
    mode?: string;
    docid?: string;
    // For insight tracking
    urlHash?: string;
    sourceUrl?: string;
    sourceTitle?: string;
    sourceType?: string;
    sourceMetadata?: string;
    insightText?: string;
    insightDetail?: string;
    insightId?: string;
    category?: string;
    context?: string;
    timestampRef?: string;
    sortBy?: string;
    limit?: number;
    offset?: number;
    // For dedup_insights
    threshold?: number;
    dryRun?: boolean;
    // For paperclip_api proxy
    method?: string;
    path?: string;
    body?: string;
    headers?: Record<string, string>;
  },
  sourceGroup: string, // Verified identity from IPC directory
  isMain: boolean, // Verified from directory path
  deps: IpcDeps,
): Promise<void> {
  const registeredGroups = deps.registeredGroups();

  switch (data.type) {
    case 'schedule_task':
      if (
        data.prompt &&
        data.schedule_type &&
        data.schedule_value &&
        data.targetJid
      ) {
        // Resolve the target group from JID
        const targetJid = data.targetJid as string;
        const targetGroupEntry = registeredGroups[targetJid];

        if (!targetGroupEntry) {
          logger.warn(
            { targetJid },
            'Cannot schedule task: target group not registered',
          );
          break;
        }

        const targetFolder = targetGroupEntry.folder;

        // Authorization: non-main groups can only schedule for themselves
        if (!isMain && targetFolder !== sourceGroup) {
          logger.warn(
            { sourceGroup, targetFolder },
            'Unauthorized schedule_task attempt blocked',
          );
          break;
        }

        const scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';

        let nextRun: string | null = null;
        if (scheduleType === 'cron') {
          try {
            const interval = CronExpressionParser.parse(data.schedule_value, {
              tz: TIMEZONE,
            });
            nextRun = interval.next().toISOString();
          } catch {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid cron expression',
            );
            break;
          }
        } else if (scheduleType === 'interval') {
          const ms = parseInt(data.schedule_value, 10);
          if (isNaN(ms) || ms <= 0) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid interval',
            );
            break;
          }
          nextRun = new Date(Date.now() + ms).toISOString();
        } else if (scheduleType === 'once') {
          const scheduled = new Date(data.schedule_value);
          if (isNaN(scheduled.getTime())) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid timestamp',
            );
            break;
          }
          nextRun = scheduled.toISOString();
        }

        const taskId = (typeof data.taskId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(data.taskId))
          ? data.taskId
          : `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const contextMode =
          data.context_mode === 'group' || data.context_mode === 'isolated'
            ? data.context_mode
            : 'isolated';
        createTask({
          id: taskId,
          group_folder: targetFolder,
          chat_jid: targetJid,
          prompt: data.prompt,
          schedule_type: scheduleType,
          schedule_value: data.schedule_value,
          context_mode: contextMode,
          next_run: nextRun,
          status: 'active',
          created_at: new Date().toISOString(),
        });
        logger.info(
          { taskId, sourceGroup, targetFolder, contextMode },
          'Task created via IPC',
        );
      }
      break;

    case 'pause_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'paused' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task paused via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task pause attempt',
          );
        }
      }
      break;

    case 'resume_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'active' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task resumed via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task resume attempt',
          );
        }
      }
      break;

    case 'cancel_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          deleteTask(data.taskId);
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task cancelled via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task cancel attempt',
          );
        }
      }
      break;

    case 'refresh_groups':
      // Only main group can request a refresh
      if (isMain) {
        logger.info(
          { sourceGroup },
          'Group metadata refresh requested via IPC',
        );
        await deps.syncGroupMetadata(true);
        // Write updated snapshot immediately
        const availableGroups = deps.getAvailableGroups();
        deps.writeGroupsSnapshot(
          sourceGroup,
          true,
          availableGroups,
          new Set(Object.keys(registeredGroups)),
        );
      } else {
        logger.warn(
          { sourceGroup },
          'Unauthorized refresh_groups attempt blocked',
        );
      }
      break;

    case 'register_group':
      // Only main group can register new groups
      if (!isMain) {
        logger.warn(
          { sourceGroup },
          'Unauthorized register_group attempt blocked',
        );
        break;
      }
      if (data.jid && data.name && data.folder && data.trigger) {
        if (!isValidGroupFolder(data.folder)) {
          logger.warn(
            { folder: data.folder },
            'Invalid group folder name in register_group request',
          );
          break;
        }
        deps.registerGroup(data.jid, {
          name: data.name,
          folder: data.folder,
          trigger: data.trigger,
          added_at: new Date().toISOString(),
          containerConfig: data.containerConfig,
          channel: data.channel,
        });
        // Register per-channel webhook if provided in containerConfig
        if (data.containerConfig?.webhookUrl && deps.registerWebhook) {
          deps.registerWebhook(data.jid, data.containerConfig.webhookUrl);
        }
      } else {
        logger.warn(
          { data },
          'Invalid register_group request - missing required fields',
        );
      }
      break;

    case 'refresh_index': {
      // Always use directory-derived sourceGroup (trusted), never the payload's groupFolder
      const folder = sourceGroup;
      const requestId = data.requestId as string | undefined;
      try {
        // update discovers new/changed files, embed creates vectors
        execFileSync(getQmdBin(), ['update'], { timeout: 30000, stdio: 'pipe' });
        execFileSync(getQmdBin(), ['embed', '-c', folder], { timeout: 30000, stdio: 'pipe' });
        logger.info({ folder }, 'qmd index refreshed');
        if (requestId) {
          writeIpcResponse(sourceGroup, requestId, { ok: true });
        }
      } catch (err) {
        logger.warn({ folder, err }, 'qmd embed failed (non-fatal)');
        if (requestId) {
          writeIpcResponse(sourceGroup, requestId, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }
      break;
    }

    case 'qmd_search': {
      const requestId = data.requestId as string | undefined;
      if (!requestId) break;

      const query = (data.query as string || '').slice(0, 500);
      const mode = data.mode as string || 'keyword';
      if (!query) {
        writeIpcResponse(sourceGroup, requestId, { results: [], error: 'Missing query' });
        break;
      }

      const cmd = mode === 'semantic' ? 'vsearch' : mode === 'hybrid' ? 'query' : 'search';
      try {
        const result = execFileSync(getQmdBin(), [cmd, '--json', query], {
          timeout: 30000,
          stdio: ['pipe', 'pipe', 'pipe'],
          encoding: 'utf-8',
        });
        writeIpcResponse(sourceGroup, requestId, { results: JSON.parse(result) });
      } catch (err) {
        writeIpcResponse(sourceGroup, requestId, {
          results: [],
          error: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case 'qmd_get': {
      const requestId = data.requestId as string | undefined;
      if (!requestId) break;

      const docid = data.docid as string;
      if (!docid) {
        writeIpcResponse(sourceGroup, requestId, { error: 'Missing docid' });
        break;
      }

      try {
        const content = execFileSync(getQmdBin(), ['get', docid], {
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe'],
          encoding: 'utf-8',
        });
        writeIpcResponse(sourceGroup, requestId, { docid, content });
      } catch (err) {
        writeIpcResponse(sourceGroup, requestId, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case 'insight_check_source': {
      const requestId = data.requestId;
      if (!requestId || !data.urlHash) break;
      const source = getSourceByHash(data.urlHash);
      writeIpcResponse(sourceGroup, requestId, {
        exists: !!source,
        source: source ? { id: source.id, title: source.title, indexed_at: source.indexed_at } : undefined,
      });
      break;
    }

    case 'insight_search': {
      const requestId = data.requestId;
      if (!requestId || !data.query) break;
      const limit = data.limit || 5;

      // Try qmd hybrid search first, fall back to keyword
      let results: { id: string; text: string; source_count: number; category: string | null; score: number }[] = [];
      try {
        const qmdResult = execFileSync(getQmdBin(), ['query', '--json', data.query], {
          timeout: 30000,
          stdio: ['pipe', 'pipe', 'pipe'],
          encoding: 'utf-8',
        });
        const qmdHits = JSON.parse(qmdResult) as { docid: string; score: number; snippet?: string }[];
        // Match qmd results to insight records by checking if docid contains insight ID
        for (const hit of qmdHits.slice(0, limit)) {
          // Insight files are named {id}.md in insights/ dir
          // qmd returns file path in 'file' field (e.g. qmd://main/insights/{id}.md), not in 'docid'
          const fileField = (hit as Record<string, unknown>).file as string | undefined;
          const idMatch = (fileField || hit.docid).match(/insights\/([a-f0-9-]+)\.md/);
          if (idMatch) {
            const insight = searchInsightsKeyword(sourceGroup, '').find(i => i.id === idMatch[1]);
            if (insight) {
              results.push({
                id: insight.id,
                text: insight.text,
                source_count: insight.source_count,
                category: insight.category,
                score: hit.score,
              });
            }
          }
        }
      } catch {
        // qmd not available, fall back to keyword search
      }

      // Supplement with keyword search if qmd didn't find enough
      if (results.length < limit) {
        const keywordResults = searchInsightsKeyword(sourceGroup, data.query, limit);
        for (const insight of keywordResults) {
          if (!results.find(r => r.id === insight.id)) {
            results.push({
              id: insight.id,
              text: insight.text,
              source_count: insight.source_count,
              category: insight.category,
              score: 0,
            });
          }
        }
        results = results.slice(0, limit);
      }

      logger.info({ query: data.query.slice(0, 80), resultCount: results.length, topScore: results[0]?.score }, 'Insight search via IPC');
      writeIpcResponse(sourceGroup, requestId, { results });
      break;
    }

    case 'insight_add': {
      const requestId = data.requestId;
      if (!requestId || !data.insightText || !data.sourceUrl || !data.sourceType) break;

      // Reject local file paths — agent must provide canonical URLs
      if (data.sourceUrl.startsWith('/') || data.sourceUrl.startsWith('workspace/')) {
        logger.warn({ sourceUrl: data.sourceUrl, sourceGroup }, 'Rejected insight source with local file path — agent must use canonical URL (e.g. YouTube watch URL)');
        writeIpcResponse(sourceGroup, requestId, { error: 'source_url must be a canonical URL (e.g. https://www.youtube.com/watch?v=...), not a local file path. Check metadata.json for the video_id or link field.' });
        break;
      }

      const now = new Date().toISOString();
      const sourceHash = hashSourceUrl(data.sourceUrl);
      const insightId = crypto.randomUUID();

      // Create source if needed
      const existingSource = getSourceByHash(sourceHash);
      if (!existingSource) {
        createSource({
          id: sourceHash,
          url: data.sourceUrl,
          title: data.sourceTitle ?? null,
          source_type: data.sourceType,
          metadata: data.sourceMetadata ?? null,
          indexed_at: now,
        });
      }

      // Create insight
      createInsight({
        id: insightId,
        text: data.insightText,
        detail: data.insightDetail ?? null,
        category: data.category ?? null,
        source_count: 1,
        first_seen: now,
        last_seen: now,
        group_folder: sourceGroup,
      });

      // Link them
      linkInsightSource(insightId, sourceHash, data.context, data.timestampRef);

      // Write markdown for qmd indexing (must be under GROUPS_DIR so qmd indexes it)
      const insightsDir = path.join(GROUPS_DIR, sourceGroup, 'insights');
      fs.mkdirSync(insightsDir, { recursive: true });
      const detailBlock = data.insightDetail ? `\n${data.insightDetail}\n` : '';
      const mdContent = `# ${data.insightText}\n${detailBlock}\nCategory: ${data.category || 'general'}\nSource: ${data.sourceUrl}\n`;
      fs.writeFileSync(path.join(insightsDir, `${insightId}.md`), mdContent);

      writeIpcResponse(sourceGroup, requestId, {
        insight_id: insightId,
        source_id: sourceHash,
        is_new: true,
      });
      logger.info({ insightId, sourceGroup }, 'Insight created via IPC');
      break;
    }

    case 'insight_link': {
      const requestId = data.requestId;
      if (!requestId || !data.insightId || !data.sourceUrl || !data.sourceType) break;

      // Reject local file paths — agent must provide canonical URLs
      if (data.sourceUrl.startsWith('/') || data.sourceUrl.startsWith('workspace/')) {
        logger.warn({ sourceUrl: data.sourceUrl, sourceGroup }, 'Rejected insight link with local file path — agent must use canonical URL');
        writeIpcResponse(sourceGroup, requestId, { error: 'source_url must be a canonical URL (e.g. https://www.youtube.com/watch?v=...), not a local file path. Check metadata.json for the video_id or link field.' });
        break;
      }

      const now = new Date().toISOString();
      const sourceHash = hashSourceUrl(data.sourceUrl);

      // Create source if needed
      const existingSource = getSourceByHash(sourceHash);
      if (!existingSource) {
        createSource({
          id: sourceHash,
          url: data.sourceUrl,
          title: data.sourceTitle ?? null,
          source_type: data.sourceType,
          metadata: data.sourceMetadata ?? null,
          indexed_at: now,
        });
      }

      // Link and bump count
      linkInsightSource(data.insightId, sourceHash, data.context, data.timestampRef);

      // Get updated count
      const updated = getTopInsights(sourceGroup, 1, 0).insights.find(i => i.id === data.insightId);

      writeIpcResponse(sourceGroup, requestId, {
        insight_id: data.insightId,
        source_id: sourceHash,
        new_source_count: updated?.source_count ?? 1,
      });
      logger.info({ insightId: data.insightId, sourceGroup }, 'Insight source linked via IPC');
      break;
    }

    case 'insight_list': {
      const requestId = data.requestId;
      if (!requestId) break;

      const sortBy = data.sortBy === 'recent' ? 'recent' : 'source_count';
      const limit = data.limit || 20;
      const offset = data.offset || 0;
      const result = getTopInsights(sourceGroup, limit, offset, data.category, sortBy as 'source_count' | 'recent');
      writeIpcResponse(sourceGroup, requestId, result);
      break;
    }

    case 'dedup_insights': {
      const requestId = data.requestId;
      if (!requestId) break;

      const scriptPath = path.join(process.cwd(), 'scripts', 'dedup-insights.py');
      if (!fs.existsSync(scriptPath)) {
        writeIpcResponse(sourceGroup, requestId, { ok: false, error: 'dedup-insights.py not found' });
        break;
      }

      const args = [scriptPath];
      if (data.threshold) args.push('--threshold', String(data.threshold));
      if (data.dryRun) args.push('--dry-run');

      logger.info({ sourceGroup, threshold: data.threshold }, 'Running dedup-insights');
      try {
        const output = execFileSync('python3', args, {
          timeout: 600_000, // 10 minute timeout
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024,
        });
        const lines = output.trim().split('\n');
        const summaryStart = lines.findIndex(l => l.includes('DEDUP COMPLETE'));
        const summary = summaryStart >= 0 ? lines.slice(summaryStart).join('\n') : lines.slice(-5).join('\n');
        writeIpcResponse(sourceGroup, requestId, { ok: true, output: summary, fullOutput: output });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stdout = (err as { stdout?: string }).stdout || '';
        writeIpcResponse(sourceGroup, requestId, { ok: false, error: message, output: stdout });
      }
      break;
    }

    case 'paperclip_api': {
      const requestId = data.requestId;
      if (!requestId) break;

      const method = (data.method as string || 'GET').toUpperCase();
      const apiPath = data.path as string;
      if (!apiPath || !apiPath.startsWith('/api/')) {
        writeIpcResponse(sourceGroup, requestId, { error: 'Path must start with /api/' });
        break;
      }

      const paperclipApiUrl = process.env.PAPERCLIP_API_URL || 'http://127.0.0.1:3101';
      const paperclipApiKey = process.env.PAPERCLIP_API_KEY || '';
      const url = `${paperclipApiUrl}${apiPath}`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(paperclipApiKey ? { 'Authorization': `Bearer ${paperclipApiKey}` } : {}),
        ...(data.headers as Record<string, string> || {}),
      };

      try {
        const fetchOptions: RequestInit = { method, headers };
        if (data.body && ['POST', 'PUT', 'PATCH'].includes(method)) {
          fetchOptions.body = data.body as string;
        }

        const response = await fetch(url, fetchOptions);
        const body = await response.text();

        logger.debug(
          { method, path: apiPath, status: response.status, sourceGroup },
          'Paperclip API proxy call',
        );

        writeIpcResponse(sourceGroup, requestId, {
          status: response.status,
          body,
        });
      } catch (err) {
        logger.warn(
          { method, path: apiPath, err, sourceGroup },
          'Paperclip API proxy error',
        );
        writeIpcResponse(sourceGroup, requestId, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
}

/** Write a response file for a request-response IPC call */
function writeIpcResponse(sourceGroup: string, requestId: string, data: unknown): void {
  const responsesDir = path.join(DATA_DIR, 'ipc', sourceGroup, 'responses');
  fs.mkdirSync(responsesDir, { recursive: true });
  const responsePath = path.join(responsesDir, `${requestId}.json`);
  const tempPath = `${responsePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data));
  fs.renameSync(tempPath, responsePath);
}
