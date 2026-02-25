/**
 * Stdio MCP Server for BastionClaw
 * Standalone process that agent teams subagents can inherit.
 * Reads context from environment variables, writes IPC files for the host.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { CronExpressionParser } from 'cron-parser';

const IPC_DIR = '/workspace/ipc';
const MESSAGES_DIR = path.join(IPC_DIR, 'messages');
const TASKS_DIR = path.join(IPC_DIR, 'tasks');
const RESPONSES_DIR = path.join(IPC_DIR, 'responses');

// Context from environment variables (set by the agent runner)
const chatJid = process.env.BASTIONCLAW_CHAT_JID!;
const groupFolder = process.env.BASTIONCLAW_GROUP_FOLDER!;
const isMain = process.env.BASTIONCLAW_IS_MAIN === '1';

function writeIpcFile(dir: string, data: object): string {
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(dir, filename);

  // Atomic write: temp file then rename
  const tempPath = `${filepath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filepath);

  return filename;
}

const server = new McpServer({
  name: 'bastionclaw',
  version: '1.0.0',
});

server.tool(
  'send_message',
  "Send a message to the user or group immediately while you're still running. Use this for progress updates or to send multiple messages. You can call this multiple times. Note: when running as a scheduled task, your final output is NOT sent to the user — use this tool if you need to communicate with the user or group.",
  {
    text: z.string().describe('The message text to send'),
    sender: z.string().optional().describe('Your role/identity name (e.g. "Researcher"). When set, messages appear from a dedicated bot in Telegram.'),
  },
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
);

server.tool(
  'schedule_task',
  `Schedule a recurring or one-time task. The task will run as a full agent with access to all tools.

CONTEXT MODE - Choose based on task type:
\u2022 "group": Task runs in the group's conversation context, with access to chat history. Use for tasks that need context about ongoing discussions, user preferences, or recent interactions.
\u2022 "isolated": Task runs in a fresh session with no conversation history. Use for independent tasks that don't need prior context. When using isolated mode, include all necessary context in the prompt itself.

If unsure which mode to use, you can ask the user. Examples:
- "Remind me about our discussion" \u2192 group (needs conversation context)
- "Check the weather every morning" \u2192 isolated (self-contained task)
- "Follow up on my request" \u2192 group (needs to know what was requested)
- "Generate a daily report" \u2192 isolated (just needs instructions in prompt)

MESSAGING BEHAVIOR - The task agent's output is sent to the user or group. It can also use send_message for immediate delivery, or wrap output in <internal> tags to suppress it. Include guidance in the prompt about whether the agent should:
\u2022 Always send a message (e.g., reminders, daily briefings)
\u2022 Only send a message when there's something to report (e.g., "notify me if...")
\u2022 Never send a message (background maintenance tasks)

SCHEDULE VALUE FORMAT (all times are LOCAL timezone):
\u2022 cron: Standard cron expression (e.g., "*/5 * * * *" for every 5 minutes, "0 9 * * *" for daily at 9am LOCAL time)
\u2022 interval: Milliseconds between runs (e.g., "300000" for 5 minutes, "3600000" for 1 hour)
\u2022 once: Local time WITHOUT "Z" suffix (e.g., "2026-02-01T15:30:00"). Do NOT use UTC/Z suffix.`,
  {
    prompt: z.string().describe('What the agent should do when the task runs. For isolated mode, include all necessary context here.'),
    schedule_type: z.enum(['cron', 'interval', 'once']).describe('cron=recurring at specific times, interval=recurring every N ms, once=run once at specific time'),
    schedule_value: z.string().describe('cron: "*/5 * * * *" | interval: milliseconds like "300000" | once: local timestamp like "2026-02-01T15:30:00" (no Z suffix!)'),
    context_mode: z.enum(['group', 'isolated']).default('group').describe('group=runs with chat history and memory, isolated=fresh session (include context in prompt)'),
    target_group_jid: z.string().optional().describe('(Main group only) JID of the group to schedule the task for. Defaults to the current group.'),
  },
  async (args) => {
    // Validate schedule_value before writing IPC
    if (args.schedule_type === 'cron') {
      try {
        CronExpressionParser.parse(args.schedule_value);
      } catch {
        return {
          content: [{ type: 'text' as const, text: `Invalid cron: "${args.schedule_value}". Use format like "0 9 * * *" (daily 9am) or "*/5 * * * *" (every 5 min).` }],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'interval') {
      const ms = parseInt(args.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        return {
          content: [{ type: 'text' as const, text: `Invalid interval: "${args.schedule_value}". Must be positive milliseconds (e.g., "300000" for 5 min).` }],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'once') {
      // Reject UTC-suffixed timestamps — the host interprets "once" values as local time.
      // A "Z" or "+HH:MM" offset would cause the task to fire at the wrong time.
      if (/Z$/.test(args.schedule_value) || /[+-]\d{2}:\d{2}$/.test(args.schedule_value)) {
        return {
          content: [{ type: 'text' as const, text: `Timestamps for "once" tasks must be local time without timezone suffix. Use "2026-02-01T15:30:00" instead of "${args.schedule_value}".` }],
          isError: true,
        };
      }
      const date = new Date(args.schedule_value);
      if (isNaN(date.getTime())) {
        return {
          content: [{ type: 'text' as const, text: `Invalid timestamp: "${args.schedule_value}". Use local time format like "2026-02-01T15:30:00" (no Z suffix).` }],
          isError: true,
        };
      }
    }

    // Non-main groups can only schedule for themselves
    const targetJid = isMain && args.target_group_jid ? args.target_group_jid : chatJid;

    const data = {
      type: 'schedule_task',
      prompt: args.prompt,
      schedule_type: args.schedule_type,
      schedule_value: args.schedule_value,
      context_mode: args.context_mode || 'group',
      targetJid,
      createdBy: groupFolder,
      timestamp: new Date().toISOString(),
    };

    const filename = writeIpcFile(TASKS_DIR, data);

    return {
      content: [{ type: 'text' as const, text: `Task scheduled (${filename}): ${args.schedule_type} - ${args.schedule_value}` }],
    };
  },
);

server.tool(
  'list_tasks',
  "List all scheduled tasks. From main: shows all tasks. From other groups: shows only that group's tasks.",
  {},
  async () => {
    const tasksFile = path.join(IPC_DIR, 'current_tasks.json');

    try {
      if (!fs.existsSync(tasksFile)) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] };
      }

      const allTasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));

      const tasks = isMain
        ? allTasks
        : allTasks.filter((t: { groupFolder: string }) => t.groupFolder === groupFolder);

      if (tasks.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] };
      }

      const formatted = tasks
        .map(
          (t: { id: string; prompt: string; schedule_type: string; schedule_value: string; status: string; next_run: string }) =>
            `- [${t.id}] ${t.prompt.slice(0, 50)}... (${t.schedule_type}: ${t.schedule_value}) - ${t.status}, next: ${t.next_run || 'N/A'}`,
        )
        .join('\n');

      return { content: [{ type: 'text' as const, text: `Scheduled tasks:\n${formatted}` }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error reading tasks: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  },
);

server.tool(
  'pause_task',
  'Pause a scheduled task. It will not run until resumed.',
  { task_id: z.string().describe('The task ID to pause') },
  async (args) => {
    const data = {
      type: 'pause_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} pause requested.` }] };
  },
);

server.tool(
  'resume_task',
  'Resume a paused task.',
  { task_id: z.string().describe('The task ID to resume') },
  async (args) => {
    const data = {
      type: 'resume_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} resume requested.` }] };
  },
);

server.tool(
  'cancel_task',
  'Cancel and delete a scheduled task.',
  { task_id: z.string().describe('The task ID to cancel') },
  async (args) => {
    const data = {
      type: 'cancel_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} cancellation requested.` }] };
  },
);

server.tool(
  'register_group',
  `Register a new WhatsApp group so the agent can respond to messages there. Main group only.

Use available_groups.json to find the JID for a group. The folder name should be lowercase with hyphens (e.g., "family-chat").`,
  {
    jid: z.string().describe('The WhatsApp JID (e.g., "120363336345536173@g.us")'),
    name: z.string().describe('Display name for the group'),
    folder: z.string().describe('Folder name for group files (lowercase, hyphens, e.g., "family-chat")'),
    trigger: z.string().describe('Trigger word (e.g., "@Andy")'),
  },
  async (args) => {
    if (!isMain) {
      return {
        content: [{ type: 'text' as const, text: 'Only the main group can register new groups.' }],
        isError: true,
      };
    }

    const data = {
      type: 'register_group',
      jid: args.jid,
      name: args.name,
      folder: args.folder,
      trigger: args.trigger,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [{ type: 'text' as const, text: `Group "${args.name}" registered. It will start receiving messages immediately.` }],
    };
  },
);

server.tool(
  'refresh_memory_index',
  'Re-index workspace files for semantic search. Blocks until indexing is complete. Run after creating or updating important documents.',
  {},
  async () => {
    try {
      const result = await sendIpcRequest({
        type: 'refresh_index',
        groupFolder,
      }, 60000);
      return { content: [{ type: 'text' as const, text: `Memory index refreshed. ${JSON.stringify(result)}` }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Index refresh failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// --- Request-response IPC for qmd memory search ---

function sendIpcRequest(data: object, timeoutMs = 30000): Promise<unknown> {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const responseFile = path.join(RESPONSES_DIR, `${requestId}.json`);

  // Write the request with the requestId so the host knows where to write the response
  writeIpcFile(TASKS_DIR, { ...data, requestId });

  // Poll for response file
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      try {
        if (fs.existsSync(responseFile)) {
          const content = fs.readFileSync(responseFile, 'utf-8');
          fs.unlinkSync(responseFile); // Clean up
          resolve(JSON.parse(content));
          return;
        }
      } catch {
        // File may be partially written, retry
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('Memory search timed out'));
        return;
      }
      setTimeout(poll, 100);
    };
    poll();
  });
}

server.tool(
  'memory_search',
  `Search long-term memory using keyword search (BM25). Fast and precise when you know exact terms.
Returns ranked results with file paths, scores, and text snippets.`,
  {
    query: z.string().max(500).describe('The search query'),
    limit: z.number().optional().default(10).describe('Max results (default 10)'),
  },
  async (args) => {
    try {
      const result = await sendIpcRequest({
        type: 'qmd_search',
        mode: 'keyword',
        query: args.query,
        limit: args.limit,
        groupFolder,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Search failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'memory_semantic_search',
  `Search long-term memory using semantic/vector similarity. Best when keywords don't capture intent.
Finds conceptually related content even with different wording.`,
  {
    query: z.string().max(500).describe('The search query'),
    limit: z.number().optional().default(10).describe('Max results (default 10)'),
  },
  async (args) => {
    try {
      const result = await sendIpcRequest({
        type: 'qmd_search',
        mode: 'semantic',
        query: args.query,
        limit: args.limit,
        groupFolder,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Search failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'memory_hybrid_search',
  `Search long-term memory using hybrid search (BM25 + semantic + LLM reranking). Best quality results.
Combines keyword precision with semantic understanding. Use this as your default memory search.`,
  {
    query: z.string().max(500).describe('The search query'),
    limit: z.number().optional().default(10).describe('Max results (default 10)'),
  },
  async (args) => {
    try {
      const result = await sendIpcRequest({
        type: 'qmd_search',
        mode: 'hybrid',
        query: args.query,
        limit: args.limit,
        groupFolder,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Search failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'memory_get',
  'Retrieve a specific document from memory by its document ID or file path.',
  {
    docid: z.string().describe('The document ID or file path to retrieve'),
  },
  async (args) => {
    try {
      const result = await sendIpcRequest({
        type: 'qmd_get',
        docid: args.docid,
        groupFolder,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Get failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// --- Insight tracking tools ---

server.tool(
  'check_source',
  'Check if a content source (URL, file) has already been indexed for insight extraction. Use before ingesting content to avoid duplicate processing.',
  {
    url: z.string().describe('The URL or file path of the content source'),
  },
  async (args) => {
    try {
      // Hash the URL locally for the check
      const crypto = await import('crypto');
      const urlHash = crypto.createHash('sha256').update(args.url.trim()).digest('hex');
      const result = await sendIpcRequest({
        type: 'insight_check_source',
        urlHash,
        groupFolder,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Check failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'search_insights',
  'Search existing insights using semantic and keyword search. Use to check if a similar insight already exists before adding a new one.',
  {
    query: z.string().max(500).describe('The insight text to search for'),
    limit: z.number().optional().default(5).describe('Max results (default 5)'),
  },
  async (args) => {
    try {
      const result = await sendIpcRequest({
        type: 'insight_search',
        query: args.query,
        limit: args.limit,
        groupFolder,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Search failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'add_insight',
  'Add a new insight extracted from content. Creates the source record if needed, creates the insight, and links them. Also writes a markdown file for semantic indexing.',
  {
    text: z.string().describe('Bold thesis statement — a short, generalizable principle (10-20 words). Should be abstract enough that the same insight from a different source would use the same text.'),
    detail: z.string().optional().describe('2-3 sentences expanding on the thesis with specific context and nuance.'),
    source_url: z.string().describe('URL or file path of the content source'),
    source_title: z.string().optional().describe('Title of the source'),
    source_type: z.enum(['article', 'youtube', 'pdf', 'podcast', 'other']).describe('Type of content source'),
    source_metadata: z.string().optional().describe('JSON string with extra metadata (author, channel, duration, etc.)'),
    category: z.string().optional().describe('Insight category: strategy, technical, trend, etc.'),
    context: z.string().optional().describe('Direct quote from the source supporting this insight'),
    timestamp_ref: z.string().optional().describe('Video/audio timestamp like "12:34" or page number'),
  },
  async (args) => {
    try {
      const result = await sendIpcRequest({
        type: 'insight_add',
        insightText: args.text,
        insightDetail: args.detail,
        sourceUrl: args.source_url,
        sourceTitle: args.source_title,
        sourceType: args.source_type,
        sourceMetadata: args.source_metadata,
        category: args.category,
        context: args.context,
        timestampRef: args.timestamp_ref,
        groupFolder,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Add failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'link_insight_source',
  'Link an existing insight to a new source. Use when you find an insight that semantically matches one already in the database. This bumps the source count, making frequently-corroborated insights rise to the top.',
  {
    insight_id: z.string().describe('ID of the existing insight to link'),
    source_url: z.string().describe('URL or file path of the new source'),
    source_title: z.string().optional().describe('Title of the source'),
    source_type: z.enum(['article', 'youtube', 'pdf', 'podcast', 'other']).describe('Type of content source'),
    source_metadata: z.string().optional().describe('JSON string with extra metadata'),
    context: z.string().optional().describe('Supporting quote from the new source'),
    timestamp_ref: z.string().optional().describe('Video/audio timestamp or page number'),
  },
  async (args) => {
    try {
      const result = await sendIpcRequest({
        type: 'insight_link',
        insightId: args.insight_id,
        sourceUrl: args.source_url,
        sourceTitle: args.source_title,
        sourceType: args.source_type,
        sourceMetadata: args.source_metadata,
        context: args.context,
        timestampRef: args.timestamp_ref,
        groupFolder,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Link failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'get_insights',
  'List insights sorted by corroboration count or recency. Use to review the most well-supported insights across all ingested content.',
  {
    sort_by: z.enum(['source_count', 'recent']).default('source_count').describe('Sort order'),
    limit: z.number().optional().default(20).describe('Max results'),
    offset: z.number().optional().default(0).describe('Offset for pagination'),
    category: z.string().optional().describe('Filter by category'),
  },
  async (args) => {
    try {
      const result = await sendIpcRequest({
        type: 'insight_list',
        sortBy: args.sort_by,
        limit: args.limit,
        offset: args.offset,
        category: args.category,
        groupFolder,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `List failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'dedup_insights',
  'Run the semantic dedup pass on the host. Merges duplicate insights that are semantically similar, transferring source links to the keeper. Run this after bulk ingestion.',
  {
    threshold: z.number().optional().default(0.65).describe('Minimum similarity score to consider a match (0.0-1.0, default 0.65)'),
    dry_run: z.boolean().optional().default(false).describe('Preview merges without making changes'),
  },
  async (args) => {
    const MAX_ATTEMPTS = 3;
    const TIMEOUT_MS = 600_000; // 10 minutes per attempt

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const result = await sendIpcRequest({
          type: 'dedup_insights',
          threshold: args.threshold,
          dryRun: args.dry_run,
          groupFolder,
        }, TIMEOUT_MS) as { ok?: boolean; output?: string; error?: string; stdout?: string };
        if (result.ok) {
          return { content: [{ type: 'text' as const, text: result.output || 'Dedup completed.' }] };
        }
        return { content: [{ type: 'text' as const, text: `Dedup failed: ${result.error}\n${result.stdout || ''}` }], isError: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const isTimeout = message.includes('timed out');
        if (isTimeout && attempt < MAX_ATTEMPTS) {
          console.error(`[dedup] Attempt ${attempt}/${MAX_ATTEMPTS} timed out, retrying...`);
          continue;
        }
        return { content: [{ type: 'text' as const, text: `Dedup failed after ${attempt} attempt(s): ${message}` }], isError: true };
      }
    }
    return { content: [{ type: 'text' as const, text: 'Dedup failed: max retries exceeded' }], isError: true };
  },
);

// Start the stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
