import crypto from 'crypto';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { DATA_DIR, STORE_DIR } from './config.js';
import { isValidGroupFolder } from './group-folder.js';
import { logger } from './logger.js';
import {
  NewMessage,
  RegisteredGroup,
  ScheduledTask,
  TaskRunLog,
} from './types.js';

let db: Database.Database;

function createSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      last_message_time TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT,
      chat_jid TEXT,
      sender TEXT,
      sender_name TEXT,
      content TEXT,
      timestamp TEXT,
      is_from_me INTEGER,
      PRIMARY KEY (id, chat_jid),
      FOREIGN KEY (chat_jid) REFERENCES chats(jid)
    );
    CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      group_folder TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      next_run TEXT,
      last_run TEXT,
      last_result TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_next_run ON scheduled_tasks(next_run);
    CREATE INDEX IF NOT EXISTS idx_status ON scheduled_tasks(status);

    CREATE TABLE IF NOT EXISTS task_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      run_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_run_logs ON task_run_logs(task_id, run_at);

    CREATE TABLE IF NOT EXISTS router_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      group_folder TEXT PRIMARY KEY,
      session_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS registered_groups (
      jid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      folder TEXT NOT NULL,
      trigger_pattern TEXT NOT NULL,
      added_at TEXT NOT NULL,
      container_config TEXT,
      requires_trigger INTEGER DEFAULT 1,
      channel TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_registered_groups_folder ON registered_groups(folder);

    CREATE TABLE IF NOT EXISTS insight_sources (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT,
      source_type TEXT NOT NULL,
      metadata TEXT,
      indexed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS insights (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      detail TEXT,
      category TEXT,
      source_count INTEGER NOT NULL DEFAULT 1,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      group_folder TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS insight_source_links (
      insight_id TEXT NOT NULL REFERENCES insights(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES insight_sources(id) ON DELETE CASCADE,
      context TEXT,
      timestamp_ref TEXT,
      linked_at TEXT NOT NULL,
      PRIMARY KEY (insight_id, source_id)
    );

    CREATE INDEX IF NOT EXISTS idx_insights_source_count ON insights(source_count DESC);
    CREATE INDEX IF NOT EXISTS idx_insights_group ON insights(group_folder);
    CREATE INDEX IF NOT EXISTS idx_insight_links_source ON insight_source_links(source_id);

    CREATE TABLE IF NOT EXISTS obsidian_seen_files (
      vault_path TEXT NOT NULL,
      file_path  TEXT NOT NULL,
      first_seen TEXT NOT NULL,
      PRIMARY KEY (vault_path, file_path)
    );
  `);

  // Add context_mode column if it doesn't exist (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE scheduled_tasks ADD COLUMN context_mode TEXT DEFAULT 'isolated'`,
    );
  } catch {
    /* column already exists */
  }

  // Add detail column to insights if it doesn't exist (migration)
  try {
    database.exec(`ALTER TABLE insights ADD COLUMN detail TEXT`);
  } catch {
    /* column already exists */
  }
}

/** Infer channel type from JID format */
export function inferChannelFromJid(jid: string): string {
  if (jid.startsWith('tg:')) return 'telegram';
  if (jid.startsWith('dc:')) return 'discord';
  if (jid.endsWith('@g.us') || jid.endsWith('@s.whatsapp.net'))
    return 'whatsapp';
  return 'unknown';
}

/** Get all JIDs that share a folder (for multi-channel broadcast) */
export function getJidsForFolder(folder: string): string[] {
  const rows = db
    .prepare('SELECT jid FROM registered_groups WHERE folder = ?')
    .all(folder) as Array<{ jid: string }>;
  return rows.map((r) => r.jid);
}

/**
 * Migrate existing registered_groups table:
 * - Remove UNIQUE constraint on folder (allows multi-channel per folder)
 * - Add channel column and backfill from JID patterns
 */
function migrateRegisteredGroupsSchema(database: Database.Database): void {
  // Check if folder has UNIQUE constraint (old schema)
  const tableInfo = database
    .prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='registered_groups'`,
    )
    .get() as { sql: string } | undefined;

  if (!tableInfo) return;

  const needsUniqueFix = tableInfo.sql.includes('UNIQUE');

  // Add channel column if missing
  const hasChannel = tableInfo.sql.includes('channel');

  if (needsUniqueFix) {
    // Recreate table without UNIQUE on folder
    database.exec(`
      CREATE TABLE IF NOT EXISTS registered_groups_new (
        jid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        folder TEXT NOT NULL,
        trigger_pattern TEXT NOT NULL,
        added_at TEXT NOT NULL,
        container_config TEXT,
        requires_trigger INTEGER DEFAULT 1,
        channel TEXT
      );
      INSERT INTO registered_groups_new (jid, name, folder, trigger_pattern, added_at, container_config, requires_trigger)
        SELECT jid, name, folder, trigger_pattern, added_at, container_config, requires_trigger FROM registered_groups;
      DROP TABLE registered_groups;
      ALTER TABLE registered_groups_new RENAME TO registered_groups;
      CREATE INDEX IF NOT EXISTS idx_registered_groups_folder ON registered_groups(folder);
    `);
    logger.info(
      'Migrated registered_groups: removed UNIQUE on folder, added channel column',
    );
  } else if (!hasChannel) {
    try {
      database.exec(`ALTER TABLE registered_groups ADD COLUMN channel TEXT`);
      logger.info('Added channel column to registered_groups');
    } catch {
      /* column already exists */
    }
  }

  // Backfill channel from JID patterns
  const rows = database
    .prepare('SELECT jid FROM registered_groups WHERE channel IS NULL')
    .all() as Array<{ jid: string }>;
  if (rows.length > 0) {
    const stmt = database.prepare(
      'UPDATE registered_groups SET channel = ? WHERE jid = ?',
    );
    for (const row of rows) {
      stmt.run(inferChannelFromJid(row.jid), row.jid);
    }
    logger.info(
      { count: rows.length },
      'Backfilled channel column in registered_groups',
    );
  }
}

export function initDatabase(): void {
  const dbPath = path.join(STORE_DIR, 'messages.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  createSchema(db);
  migrateRegisteredGroupsSchema(db);

  // Migrate from JSON files if they exist
  migrateJsonState();
}

/** @internal - for tests only. Creates a fresh in-memory database. */
export function _initTestDatabase(): void {
  db = new Database(':memory:');
  createSchema(db);
}

/**
 * Store chat metadata only (no message content).
 * Used for all chats to enable group discovery without storing sensitive content.
 */
export function storeChatMetadata(
  chatJid: string,
  timestamp: string,
  name?: string,
): void {
  if (name) {
    // Update with name, preserving existing timestamp if newer
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        name = excluded.name,
        last_message_time = MAX(last_message_time, excluded.last_message_time)
    `,
    ).run(chatJid, name, timestamp);
  } else {
    // Update timestamp only, preserve existing name if any
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        last_message_time = MAX(last_message_time, excluded.last_message_time)
    `,
    ).run(chatJid, chatJid, timestamp);
  }
}

/**
 * Update chat name without changing timestamp for existing chats.
 * New chats get the current time as their initial timestamp.
 * Used during group metadata sync.
 */
export function updateChatName(chatJid: string, name: string): void {
  db.prepare(
    `
    INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET name = excluded.name
  `,
  ).run(chatJid, name, new Date().toISOString());
}

export interface ChatInfo {
  jid: string;
  name: string;
  last_message_time: string;
}

/**
 * Get all known chats, ordered by most recent activity.
 */
export function getAllChats(): ChatInfo[] {
  return db
    .prepare(
      `
    SELECT jid, name, last_message_time
    FROM chats
    ORDER BY last_message_time DESC
  `,
    )
    .all() as ChatInfo[];
}

/**
 * Get timestamp of last group metadata sync.
 */
export function getLastGroupSync(): string | null {
  // Store sync time in a special chat entry
  const row = db
    .prepare(`SELECT last_message_time FROM chats WHERE jid = '__group_sync__'`)
    .get() as { last_message_time: string } | undefined;
  return row?.last_message_time || null;
}

/**
 * Record that group metadata was synced.
 */
export function setLastGroupSync(): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES ('__group_sync__', '__group_sync__', ?)`,
  ).run(now);
}

/**
 * Store a message with full content.
 * Only call this for registered groups where message history is needed.
 */
export function storeMessage(msg: NewMessage): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.id,
    msg.chat_jid,
    msg.sender,
    msg.sender_name,
    msg.content,
    msg.timestamp,
    msg.is_from_me ? 1 : 0,
  );
}

/**
 * Store a message directly (for non-WhatsApp channels that don't use Baileys proto).
 */
export function storeMessageDirect(msg: {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: boolean;
}): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.id,
    msg.chat_jid,
    msg.sender,
    msg.sender_name,
    msg.content,
    msg.timestamp,
    msg.is_from_me ? 1 : 0,
  );
}

export function getNewMessages(
  jids: string[],
  lastTimestamp: string,
  botPrefix: string,
): { messages: NewMessage[]; newTimestamp: string } {
  if (jids.length === 0) return { messages: [], newTimestamp: lastTimestamp };

  const placeholders = jids.map(() => '?').join(',');
  // Filter out bot's own messages by checking content prefix (not is_from_me, since user shares the account)
  // Also filter empty messages (delivery receipts, encryption key distribution)
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp
    FROM messages
    WHERE timestamp > ? AND chat_jid IN (${placeholders}) AND content NOT LIKE ?
      AND content != '' AND content IS NOT NULL
    ORDER BY timestamp
  `;

  const rows = db
    .prepare(sql)
    .all(lastTimestamp, ...jids, `${botPrefix}:%`) as NewMessage[];

  let newTimestamp = lastTimestamp;
  for (const row of rows) {
    if (row.timestamp > newTimestamp) newTimestamp = row.timestamp;
  }

  return { messages: rows, newTimestamp };
}

export function getMessagesSince(
  chatJid: string,
  sinceTimestamp: string,
  botPrefix: string,
): NewMessage[] {
  // Filter out bot's own messages by checking content prefix
  // Also filter empty messages (delivery receipts, encryption key distribution)
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp
    FROM messages
    WHERE chat_jid = ? AND timestamp > ? AND content NOT LIKE ?
      AND content != '' AND content IS NOT NULL
    ORDER BY timestamp
  `;
  return db
    .prepare(sql)
    .all(chatJid, sinceTimestamp, `${botPrefix}:%`) as NewMessage[];
}

export function createTask(
  task: Omit<ScheduledTask, 'last_run' | 'last_result'>,
): void {
  db.prepare(
    `
    INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, next_run, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    task.id,
    task.group_folder,
    task.chat_jid,
    task.prompt,
    task.schedule_type,
    task.schedule_value,
    task.context_mode || 'isolated',
    task.next_run,
    task.status,
    task.created_at,
  );
}

export function getTaskById(id: string): ScheduledTask | undefined {
  return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as
    | ScheduledTask
    | undefined;
}

export function getTasksForGroup(groupFolder: string): ScheduledTask[] {
  return db
    .prepare(
      'SELECT * FROM scheduled_tasks WHERE group_folder = ? ORDER BY created_at DESC',
    )
    .all(groupFolder) as ScheduledTask[];
}

export function getAllTasks(): ScheduledTask[] {
  return db
    .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
    .all() as ScheduledTask[];
}

export function updateTask(
  id: string,
  updates: Partial<
    Pick<
      ScheduledTask,
      'prompt' | 'schedule_type' | 'schedule_value' | 'next_run' | 'status'
    >
  >,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.prompt !== undefined) {
    fields.push('prompt = ?');
    values.push(updates.prompt);
  }
  if (updates.schedule_type !== undefined) {
    fields.push('schedule_type = ?');
    values.push(updates.schedule_type);
  }
  if (updates.schedule_value !== undefined) {
    fields.push('schedule_value = ?');
    values.push(updates.schedule_value);
  }
  if (updates.next_run !== undefined) {
    fields.push('next_run = ?');
    values.push(updates.next_run);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(
    `UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`,
  ).run(...values);
}

export function deleteTask(id: string): void {
  // Delete child records first (FK constraint)
  db.prepare('DELETE FROM task_run_logs WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
}

export function getDueTasks(): ScheduledTask[] {
  const now = new Date().toISOString();
  return db
    .prepare(
      `
    SELECT * FROM scheduled_tasks
    WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
    ORDER BY next_run
  `,
    )
    .all(now) as ScheduledTask[];
}

export function updateTaskAfterRun(
  id: string,
  nextRun: string | null,
  lastResult: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE scheduled_tasks
    SET next_run = ?, last_run = ?, last_result = ?, status = CASE WHEN ? IS NULL THEN 'completed' ELSE status END
    WHERE id = ?
  `,
  ).run(nextRun, now, lastResult, nextRun, id);
}

export function logTaskRun(log: TaskRunLog): void {
  // Use SELECT ... WHERE EXISTS to skip gracefully if the task was deleted while running.
  db.prepare(
    `
    INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM scheduled_tasks WHERE id = ?)
  `,
  ).run(
    log.task_id,
    log.run_at,
    log.duration_ms,
    log.status,
    log.result,
    log.error,
    log.task_id,
  );
}

// --- Router state accessors ---

export function getRouterState(key: string): string | undefined {
  const row = db
    .prepare('SELECT value FROM router_state WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function setRouterState(key: string, value: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO router_state (key, value) VALUES (?, ?)',
  ).run(key, value);
}

// --- Session accessors ---

export function getSession(groupFolder: string): string | undefined {
  const row = db
    .prepare('SELECT session_id FROM sessions WHERE group_folder = ?')
    .get(groupFolder) as { session_id: string } | undefined;
  return row?.session_id;
}

export function setSession(groupFolder: string, sessionId: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO sessions (group_folder, session_id) VALUES (?, ?)',
  ).run(groupFolder, sessionId);
}

export function getAllSessions(): Record<string, string> {
  const rows = db
    .prepare('SELECT group_folder, session_id FROM sessions')
    .all() as Array<{ group_folder: string; session_id: string }>;
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.group_folder] = row.session_id;
  }
  return result;
}

// --- Registered group accessors ---

export function getRegisteredGroup(
  jid: string,
): (RegisteredGroup & { jid: string }) | undefined {
  const row = db
    .prepare('SELECT * FROM registered_groups WHERE jid = ?')
    .get(jid) as
    | {
        jid: string;
        name: string;
        folder: string;
        trigger_pattern: string;
        added_at: string;
        container_config: string | null;
        requires_trigger: number | null;
        channel: string | null;
      }
    | undefined;
  if (!row) return undefined;

  let containerConfig: RegisteredGroup['containerConfig'];
  if (row.container_config) {
    try {
      containerConfig = JSON.parse(row.container_config);
    } catch (err) {
      logger.error(
        { jid, raw: row.container_config, error: err },
        'Corrupt container_config in registered_groups, ignoring',
      );
    }
  }

  return {
    jid: row.jid,
    name: row.name,
    folder: row.folder,
    trigger: row.trigger_pattern,
    added_at: row.added_at,
    containerConfig,
    requiresTrigger:
      row.requires_trigger === null ? undefined : row.requires_trigger === 1,
    channel: row.channel || undefined,
  };
}

export function setRegisteredGroup(jid: string, group: RegisteredGroup): void {
  if (!isValidGroupFolder(group.folder)) {
    throw new Error(`Invalid group folder name: ${group.folder}`);
  }
  const channel = group.channel || inferChannelFromJid(jid);
  db.prepare(
    `INSERT INTO registered_groups (jid, name, folder, trigger_pattern, added_at, container_config, requires_trigger, channel)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(jid) DO UPDATE SET
       name = excluded.name,
       folder = excluded.folder,
       trigger_pattern = excluded.trigger_pattern,
       container_config = excluded.container_config,
       requires_trigger = excluded.requires_trigger,
       channel = excluded.channel`,
  ).run(
    jid,
    group.name,
    group.folder,
    group.trigger,
    group.added_at,
    group.containerConfig ? JSON.stringify(group.containerConfig) : null,
    group.requiresTrigger === undefined ? 1 : group.requiresTrigger ? 1 : 0,
    channel,
  );
}

export function getAllRegisteredGroups(): Record<string, RegisteredGroup> {
  const rows = db.prepare('SELECT * FROM registered_groups').all() as Array<{
    jid: string;
    name: string;
    folder: string;
    trigger_pattern: string;
    added_at: string;
    container_config: string | null;
    requires_trigger: number | null;
    channel: string | null;
  }>;
  const result: Record<string, RegisteredGroup> = {};
  for (const row of rows) {
    if (!isValidGroupFolder(row.folder)) {
      continue; // Skip groups with invalid folder names
    }

    let containerConfig: RegisteredGroup['containerConfig'];
    if (row.container_config) {
      try {
        containerConfig = JSON.parse(row.container_config);
      } catch (err) {
        logger.error(
          { jid: row.jid, raw: row.container_config, error: err },
          'Corrupt container_config in registered_groups, ignoring',
        );
      }
    }

    result[row.jid] = {
      name: row.name,
      folder: row.folder,
      trigger: row.trigger_pattern,
      added_at: row.added_at,
      containerConfig,
      requiresTrigger:
        row.requires_trigger === null ? undefined : row.requires_trigger === 1,
      channel: row.channel || undefined,
    };
  }
  return result;
}

// --- WebUI query functions ---

export function getMessagesForGroup(
  chatJid: string,
  limit: number,
  before?: string,
): NewMessage[] {
  if (before) {
    return db
      .prepare(
        `SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me
         FROM messages WHERE chat_jid = ? AND timestamp < ?
         ORDER BY timestamp DESC LIMIT ?`,
      )
      .all(chatJid, before, limit) as NewMessage[];
  }
  return db
    .prepare(
      `SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me
       FROM messages WHERE chat_jid = ?
       ORDER BY timestamp DESC LIMIT ?`,
    )
    .all(chatJid, limit) as NewMessage[];
}

export function storeChatMessage(msg: {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: boolean;
}): void {
  // Ensure chat row exists before inserting message (FK constraint)
  storeChatMetadata(msg.chat_jid, msg.timestamp, 'Web Chat');
  storeMessageDirect(msg);
}

export function deleteSession(groupFolder: string): void {
  db.prepare('DELETE FROM sessions WHERE group_folder = ?').run(groupFolder);
}

export function getDbStats(): Record<string, number> {
  const tables = [
    'chats',
    'messages',
    'scheduled_tasks',
    'task_run_logs',
    'sessions',
    'registered_groups',
    'router_state',
    'insights',
    'insight_sources',
    'insight_source_links',
  ];
  const stats: Record<string, number> = {};
  for (const table of tables) {
    const row = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as {
      count: number;
    };
    stats[table] = row.count;
  }
  return stats;
}

export function getTaskRunLogs(taskId: string, limit = 20): TaskRunLog[] {
  return db
    .prepare(
      'SELECT * FROM task_run_logs WHERE task_id = ? ORDER BY run_at DESC LIMIT ?',
    )
    .all(taskId, limit) as TaskRunLog[];
}

// --- Insight tracking ---

export interface InsightSource {
  id: string;
  url: string;
  title: string | null;
  source_type: string;
  metadata: string | null;
  indexed_at: string;
}

export interface Insight {
  id: string;
  text: string;
  detail: string | null;
  category: string | null;
  source_count: number;
  first_seen: string;
  last_seen: string;
  group_folder: string;
}

export interface InsightSourceLink {
  insight_id: string;
  source_id: string;
  context: string | null;
  timestamp_ref: string | null;
  linked_at: string;
}

/** Normalize a URL and return its SHA-256 hash for dedup */
export function hashSourceUrl(url: string): string {
  let normalized = url.trim();
  // Normalize YouTube URLs to canonical form
  const ytMatch = normalized.match(
    /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  );
  if (ytMatch) {
    normalized = `https://www.youtube.com/watch?v=${ytMatch[1]}`;
  } else {
    try {
      const u = new URL(normalized);
      u.hash = '';
      // Strip common tracking params
      for (const p of [
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_term',
        'utm_content',
        'fbclid',
        'gclid',
        'ref',
      ]) {
        u.searchParams.delete(p);
      }
      normalized = u.toString();
    } catch {
      // Not a valid URL, hash as-is
    }
  }
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export function getSourceByHash(id: string): InsightSource | undefined {
  return db.prepare('SELECT * FROM insight_sources WHERE id = ?').get(id) as
    | InsightSource
    | undefined;
}

export function createSource(source: InsightSource): void {
  db.prepare(
    'INSERT OR IGNORE INTO insight_sources (id, url, title, source_type, metadata, indexed_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    source.id,
    source.url,
    source.title,
    source.source_type,
    source.metadata,
    source.indexed_at,
  );
}

export function createInsight(insight: Insight): void {
  db.prepare(
    'INSERT INTO insights (id, text, detail, category, source_count, first_seen, last_seen, group_folder) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    insight.id,
    insight.text,
    insight.detail,
    insight.category,
    insight.source_count,
    insight.first_seen,
    insight.last_seen,
    insight.group_folder,
  );
}

export function getInsightById(id: string):
  | (Insight & {
      sources: (InsightSource & {
        context: string | null;
        timestamp_ref: string | null;
      })[];
    })
  | undefined {
  const insight = db.prepare('SELECT * FROM insights WHERE id = ?').get(id) as
    | Insight
    | undefined;
  if (!insight) return undefined;
  const sources = db
    .prepare(
      `SELECT s.*, l.context, l.timestamp_ref FROM insight_sources s
     JOIN insight_source_links l ON l.source_id = s.id
     WHERE l.insight_id = ? ORDER BY l.linked_at DESC`,
    )
    .all(id) as (InsightSource & {
    context: string | null;
    timestamp_ref: string | null;
  })[];
  return { ...insight, sources };
}

export function linkInsightSource(
  insightId: string,
  sourceId: string,
  context?: string,
  timestampRef?: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    'INSERT OR IGNORE INTO insight_source_links (insight_id, source_id, context, timestamp_ref, linked_at) VALUES (?, ?, ?, ?, ?)',
  ).run(insightId, sourceId, context ?? null, timestampRef ?? null, now);
  db.prepare(
    'UPDATE insights SET source_count = (SELECT COUNT(*) FROM insight_source_links WHERE insight_id = ?), last_seen = ? WHERE id = ?',
  ).run(insightId, now, insightId);
}

export function getTopInsights(
  groupFolder: string,
  limit = 20,
  offset = 0,
  category?: string,
  sortBy: 'source_count' | 'recent' = 'source_count',
): { insights: Insight[]; total: number } {
  const where = category
    ? 'WHERE group_folder = ? AND category = ?'
    : 'WHERE group_folder = ?';
  const params = category ? [groupFolder, category] : [groupFolder];

  const orderCol =
    sortBy === 'recent'
      ? 'last_seen DESC'
      : 'source_count DESC, last_seen DESC';

  const total = (
    db
      .prepare(`SELECT COUNT(*) as count FROM insights ${where}`)
      .get(...params) as { count: number }
  ).count;
  const insights = db
    .prepare(
      `SELECT * FROM insights ${where} ORDER BY ${orderCol} LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Insight[];
  return { insights, total };
}

export function getInsightsBySource(sourceId: string): Insight[] {
  return db
    .prepare(
      `SELECT i.* FROM insights i
     JOIN insight_source_links l ON l.insight_id = i.id
     WHERE l.source_id = ? ORDER BY i.source_count DESC`,
    )
    .all(sourceId) as Insight[];
}

export function getInsightSources(insightId: string): (InsightSource & {
  context: string | null;
  timestamp_ref: string | null;
})[] {
  return db
    .prepare(
      `SELECT s.*, l.context, l.timestamp_ref FROM insight_sources s
     JOIN insight_source_links l ON l.source_id = s.id
     WHERE l.insight_id = ? ORDER BY l.linked_at DESC`,
    )
    .all(insightId) as (InsightSource & {
    context: string | null;
    timestamp_ref: string | null;
  })[];
}

export function getAllInsightSources(
  limit = 50,
  offset = 0,
): { sources: (InsightSource & { insight_count: number })[]; total: number } {
  const total = (
    db.prepare('SELECT COUNT(*) as count FROM insight_sources').get() as {
      count: number;
    }
  ).count;
  const sources = db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM insight_source_links l WHERE l.source_id = s.id) as insight_count
     FROM insight_sources s ORDER BY s.indexed_at DESC LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as (InsightSource & { insight_count: number })[];
  return { sources, total };
}

export function deleteInsight(id: string): void {
  // CASCADE will handle insight_source_links
  db.prepare('DELETE FROM insights WHERE id = ?').run(id);
}

export function updateInsightFields(
  id: string,
  updates: { text?: string; detail?: string; category?: string },
): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (updates.text !== undefined) {
    fields.push('text = ?');
    values.push(updates.text);
  }
  if (updates.detail !== undefined) {
    fields.push('detail = ?');
    values.push(updates.detail);
  }
  if (updates.category !== undefined) {
    fields.push('category = ?');
    values.push(updates.category);
  }
  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE insights SET ${fields.join(', ')} WHERE id = ?`).run(
    ...values,
  );
}

export function getInsightStats(groupFolder: string): {
  totalInsights: number;
  totalSources: number;
  topInsight: { text: string; source_count: number } | null;
  categories: { category: string; count: number }[];
} {
  const totalInsights = (
    db
      .prepare('SELECT COUNT(*) as count FROM insights WHERE group_folder = ?')
      .get(groupFolder) as { count: number }
  ).count;
  const totalSources = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT s.id) as count FROM insight_sources s
     JOIN insight_source_links l ON l.source_id = s.id
     JOIN insights i ON i.id = l.insight_id
     WHERE i.group_folder = ?`,
      )
      .get(groupFolder) as { count: number }
  ).count;
  const topInsight =
    (db
      .prepare(
        'SELECT text, source_count FROM insights WHERE group_folder = ? ORDER BY source_count DESC LIMIT 1',
      )
      .get(groupFolder) as
      | { text: string; source_count: number }
      | undefined) ?? null;
  const categories = db
    .prepare(
      `SELECT COALESCE(category, 'uncategorized') as category, COUNT(*) as count
     FROM insights WHERE group_folder = ? GROUP BY category ORDER BY count DESC`,
    )
    .all(groupFolder) as { category: string; count: number }[];
  return { totalInsights, totalSources, topInsight, categories };
}

export function searchInsightsKeyword(
  groupFolder: string,
  query: string,
  limit = 10,
): Insight[] {
  const pattern = `%${query}%`;
  return db
    .prepare(
      'SELECT * FROM insights WHERE group_folder = ? AND text LIKE ? ORDER BY source_count DESC LIMIT ?',
    )
    .all(groupFolder, pattern, limit) as Insight[];
}

export function getInsightActivity(groupFolder: string): {
  sourceTypeBreakdown: { source_type: string; count: number }[];
  categoryDistribution: { category: string; count: number }[];
  recentActivity: { last24h: number; last7d: number; last30d: number };
  avgSourcesPerInsight: number;
  lastRefresh: string | null;
} {
  const sourceTypeBreakdown = db
    .prepare(
      `SELECT s.source_type, COUNT(DISTINCT s.id) as count
     FROM insight_sources s
     JOIN insight_source_links l ON l.source_id = s.id
     JOIN insights i ON i.id = l.insight_id
     WHERE i.group_folder = ?
     GROUP BY s.source_type ORDER BY count DESC`,
    )
    .all(groupFolder) as { source_type: string; count: number }[];

  const categoryDistribution = db
    .prepare(
      `SELECT COALESCE(category, 'uncategorized') as category, COUNT(*) as count
     FROM insights WHERE group_folder = ? GROUP BY category ORDER BY count DESC`,
    )
    .all(groupFolder) as { category: string; count: number }[];

  const last24h = (
    db
      .prepare(
        "SELECT COUNT(*) as count FROM insights WHERE group_folder = ? AND first_seen >= datetime('now', '-1 day')",
      )
      .get(groupFolder) as { count: number }
  ).count;
  const last7d = (
    db
      .prepare(
        "SELECT COUNT(*) as count FROM insights WHERE group_folder = ? AND first_seen >= datetime('now', '-7 days')",
      )
      .get(groupFolder) as { count: number }
  ).count;
  const last30d = (
    db
      .prepare(
        "SELECT COUNT(*) as count FROM insights WHERE group_folder = ? AND first_seen >= datetime('now', '-30 days')",
      )
      .get(groupFolder) as { count: number }
  ).count;

  const avgRow = db
    .prepare(
      'SELECT AVG(source_count) as avg FROM insights WHERE group_folder = ?',
    )
    .get(groupFolder) as { avg: number | null };
  const avgSourcesPerInsight = Math.round((avgRow.avg || 0) * 100) / 100;

  const lastRefreshRow = db
    .prepare(
      `SELECT MAX(s.indexed_at) as last_refresh
     FROM insight_sources s
     JOIN insight_source_links l ON l.source_id = s.id
     JOIN insights i ON i.id = l.insight_id
     WHERE i.group_folder = ?`,
    )
    .get(groupFolder) as { last_refresh: string | null };

  return {
    sourceTypeBreakdown,
    categoryDistribution,
    recentActivity: { last24h, last7d, last30d },
    avgSourcesPerInsight,
    lastRefresh: lastRefreshRow.last_refresh,
  };
}

// --- Obsidian seen files ---

export function getSeenFiles(vaultPath: string): Set<string> {
  const rows = db
    .prepare('SELECT file_path FROM obsidian_seen_files WHERE vault_path = ?')
    .all(vaultPath) as Array<{ file_path: string }>;
  return new Set(rows.map((r) => r.file_path));
}

export function markFileSeen(vaultPath: string, filePath: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO obsidian_seen_files (vault_path, file_path, first_seen) VALUES (?, ?, ?)`,
  ).run(vaultPath, filePath, new Date().toISOString());
}

// --- JSON migration ---

function migrateJsonState(): void {
  const migrateFile = (filename: string) => {
    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      fs.renameSync(filePath, `${filePath}.migrated`);
      return data;
    } catch {
      return null;
    }
  };

  // Migrate router_state.json
  const routerState = migrateFile('router_state.json') as {
    last_timestamp?: string;
    last_agent_timestamp?: Record<string, string>;
  } | null;
  if (routerState) {
    if (routerState.last_timestamp) {
      setRouterState('last_timestamp', routerState.last_timestamp);
    }
    if (routerState.last_agent_timestamp) {
      setRouterState(
        'last_agent_timestamp',
        JSON.stringify(routerState.last_agent_timestamp),
      );
    }
  }

  // Migrate sessions.json
  const sessions = migrateFile('sessions.json') as Record<
    string,
    string
  > | null;
  if (sessions) {
    for (const [folder, sessionId] of Object.entries(sessions)) {
      setSession(folder, sessionId);
    }
  }

  // Migrate registered_groups.json
  const groups = migrateFile('registered_groups.json') as Record<
    string,
    RegisteredGroup
  > | null;
  if (groups) {
    for (const [jid, group] of Object.entries(groups)) {
      setRegisteredGroup(jid, group);
    }
  }
}
