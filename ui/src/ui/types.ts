export interface OverviewData {
  uptime: number;
  channels: { name: string; connected: boolean }[];
  groups: { total: number; active: number };
  queue: { activeCount: number; maxConcurrent: number; waitingCount: number };
  tasks: { active: number; paused: number; completed: number };
  messages: { total: number };
  containers: { running: number };
}

export interface ChannelData {
  name: string;
  connected: boolean;
  type: 'whatsapp' | 'telegram';
}

export interface GroupData {
  jid: string;
  name: string;
  folder: string;
  trigger: string;
  added_at: string;
  requiresTrigger?: boolean;
  containerConfig?: unknown;
  sessionId: string | null;
  containerActive: boolean;
}

export interface MessageData {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean | number;
}

export interface TaskData {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: string;
  schedule_value: string;
  context_mode: string;
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: string;
  created_at: string;
  recentRuns: TaskRunLog[];
}

export interface TaskRunLog {
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: string;
  result: string | null;
  error: string | null;
}

export interface SessionData {
  groupFolder: string;
  sessionId: string;
  groupName?: string;
}

export interface SkillData {
  name: string;
  description: string;
  allowedTools: string[];
  enabled: boolean;
  content: string;
  path: string;
}

export interface ConfigData {
  values: Record<string, { value: string | number | boolean; env: string; description: string }>;
}

export interface DebugData {
  queue: {
    activeCount: number;
    maxConcurrent: number;
    waitingCount: number;
    groups: Array<{
      jid: string;
      active: boolean;
      pendingMessages: boolean;
      pendingTaskCount: number;
      containerName: string | null;
      groupFolder: string | null;
    }>;
  };
  db: Record<string, number>;
  env: Record<string, string | undefined>;
  process: {
    pid: number;
    uptime: number;
    memoryUsage: { rss: number; heapUsed: number; heapTotal: number };
    nodeVersion: string;
  };
}

export interface LogEntry {
  level: number;
  time: number;
  msg: string;
  [key: string]: unknown;
}

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface MemoryData {
  collections?: { name: string; path: string; fileCount: number }[];
  totalDocuments?: number;
  totalVectors?: number;
  indexSize?: string;
  mcpStatus?: string;
  mcpPid?: string | null;
  lastUpdated?: string;
  error?: string;
  message?: string;
}

export interface MemorySearchResult {
  results: { docid: string; file: string; title: string; score: number; snippet: string }[];
  error?: string;
}

export interface InsightData {
  id: string;
  text: string;
  detail: string | null;
  category: string | null;
  source_count: number;
  first_seen: string;
  last_seen: string;
  group_folder: string;
}

export interface InsightSourceData {
  id: string;
  url: string;
  title: string | null;
  source_type: string;
  metadata: string | null;
  indexed_at: string;
  insight_count: number;
}

export interface InsightDetailSource {
  id: string;
  url: string;
  title: string | null;
  source_type: string;
  metadata: string | null;
  indexed_at: string;
  context: string | null;
  timestamp_ref: string | null;
}

export interface InsightStatsData {
  totalInsights: number;
  totalSources: number;
  topInsight: { text: string; source_count: number } | null;
  categories: { category: string; count: number }[];
}

export interface InsightActivityData {
  sourceTypeBreakdown: { source_type: string; count: number }[];
  categoryDistribution: { category: string; count: number }[];
  recentActivity: { last24h: number; last7d: number; last30d: number };
  avgSourcesPerInsight: number;
  lastRefresh: string | null;
  pipelineLog: string[];
}

export interface YouTubeVideoData {
  videoId: string;
  title: string;
  author: string;
  published: string;
  views: number;
  vph: number;
  thumbnail: string;
  link: string;
  sparklinePoints: number[];
  snapshotCount: number;
  trendDirection: 'accelerating' | 'decelerating' | 'flat';
  duration: number | null;
}

export interface YouTubeSourceData {
  handle: string;
}

export interface YouTubeDashboardData {
  videos: YouTubeVideoData[];
  lastUpdated: string;
}

export interface YouTubeSourcesData {
  sources: YouTubeSourceData[];
  lookbackDays: number;
}
