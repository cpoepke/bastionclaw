import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { WsClient } from './api-client.ts';
import { renderApp } from './app-render.ts';
import type { TabId } from './navigation.ts';
import type {
  OverviewData, ChannelData, GroupData, TaskData,
  SessionData, SkillData, ConfigData, DebugData,
  LogEntry, MessageData, MemoryData, MemorySearchResult,
  InsightData, InsightSourceData, InsightStatsData,
} from './types.ts';

@customElement('nanoclaw-app')
export class NanoClawApp extends LitElement {
  // Disable shadow DOM so global CSS works
  createRenderRoot() { return this; }

  @state() tab: TabId = 'overview';
  @state() loading = false;
  @state() error: string | null = null;

  // Overview
  @state() overview: OverviewData | null = null;

  // Channels
  @state() channels: ChannelData[] = [];

  // Groups
  @state() groups: GroupData[] = [];
  @state() selectedGroupFolder: string | null = null;

  // Messages
  @state() messagesGroupJid: string = '';
  @state() messages: MessageData[] = [];
  @state() messagesHasMore = false;

  // Tasks
  @state() tasks: TaskData[] = [];

  // Sessions
  @state() sessions: SessionData[] = [];

  // Skills
  @state() skills: SkillData[] = [];
  @state() skillsFilter = '';
  @state() skillEditorName: string | null = null;
  @state() skillEditorContent = '';

  // Config
  @state() config: ConfigData | null = null;
  @state() claudeMdFolder: string = 'global';
  @state() claudeMdContent = '';
  @state() claudeMdDirty = false;

  // Logs
  @state() logs: LogEntry[] = [];
  @state() logsFilterText = '';
  @state() logsLevel = '';
  @state() logsAutoFollow = true;

  // Memory
  @state() memory: MemoryData | null = null;
  @state() memorySearchQuery = '';
  @state() memorySearchMode = 'keyword';
  @state() memorySearchResults: MemorySearchResult | null = null;

  // Insights
  @state() insights: InsightData[] = [];
  @state() insightTotal = 0;
  @state() insightSources: InsightSourceData[] = [];
  @state() insightSourceTotal = 0;
  @state() insightStats: InsightStatsData | null = null;
  @state() insightSearchQuery = '';
  @state() insightCategoryFilter = '';
  @state() insightSortBy = 'source_count';
  @state() insightDetails: Record<string, any> = {};
  @state() insightPage = 0;
  @state() insightSourcePage = 0;
  insightPageSize = 20;

  // Debug
  @state() debug: DebugData | null = null;

  // Chat
  @state() chatMessages: MessageData[] = [];
  @state() chatDraft = '';
  @state() chatStreaming = false;
  @state() chatStreamText = '';

  private ws = new WsClient();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private wsCleanup: (() => void) | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.ws.connect();
    this.wsCleanup = this.ws.on((msg) => this.handleWsMessage(msg));
    this.loadTab();
    // Refresh overview every 10s when on overview tab, memory every 30s
    this.pollTimer = setInterval(() => {
      if (this.tab === 'overview') this.loadOverview();
    }, 10000);
    setInterval(() => {
      if (this.tab === 'memory') this.loadMemory();
    }, 30000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.wsCleanup) this.wsCleanup();
  }

  private handleWsMessage(msg: { type: string; [key: string]: unknown }) {
    if (msg.type === 'chat.stream') {
      this.chatStreamText += msg.text as string;
    } else if (msg.type === 'chat.done') {
      this.chatStreaming = false;
      this.chatMessages = [
        ...this.chatMessages,
        {
          id: `resp-${Date.now()}`,
          chat_jid: 'web@chat',
          sender: 'assistant',
          sender_name: 'Assistant',
          content: msg.text as string,
          timestamp: new Date().toISOString(),
          is_from_me: true,
        },
      ];
      this.chatStreamText = '';
    } else if (msg.type === 'chat.ack') {
      // Message acknowledged
    } else if (msg.type === 'chat.error') {
      this.chatStreaming = false;
      this.chatStreamText = '';
      this.error = msg.error as string;
    }
  }

  switchTab(tab: TabId) {
    this.tab = tab;
    this.error = null;
    this.loadTab();
  }

  async loadTab() {
    this.loading = true;
    this.error = null;
    try {
      switch (this.tab) {
        case 'overview': await this.loadOverview(); break;
        case 'channels': await this.loadChannels(); break;
        case 'memory': await this.loadMemory(); break;
        case 'insights': await this.loadInsights(); break;
        case 'groups': await this.loadGroups(); break;
        case 'messages': await this.loadMessages(); break;
        case 'tasks': await this.loadTasks(); break;
        case 'sessions': await this.loadSessions(); break;
        case 'skills': await this.loadSkills(); break;
        case 'config': await this.loadConfig(); break;
        case 'logs': await this.loadLogs(); break;
        case 'debug': await this.loadDebug(); break;
        case 'chat': await this.loadChatHistory(); break;
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }

  private async fetchApi<T>(path: string, opts?: RequestInit): Promise<T> {
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.json();
  }

  async loadOverview() { this.overview = await this.fetchApi('/api/overview'); }
  async loadChannels() { this.channels = await this.fetchApi('/api/channels'); }
  async loadGroups() { this.groups = await this.fetchApi('/api/groups'); }
  async loadTasks() { this.tasks = await this.fetchApi('/api/tasks'); }
  async loadSessions() { this.sessions = await this.fetchApi('/api/sessions'); }
  async loadSkills() { this.skills = await this.fetchApi('/api/skills'); }
  async loadConfig() {
    this.config = await this.fetchApi('/api/config');
    await this.loadClaudeMd();
  }
  async loadLogs() {
    const params = new URLSearchParams();
    if (this.logsLevel) params.set('level', this.logsLevel);
    params.set('limit', '500');
    const data: { entries: LogEntry[] } = await this.fetchApi(`/api/logs?${params}`);
    this.logs = data.entries;
  }
  async loadMemory() { this.memory = await this.fetchApi('/api/memory'); }
  async searchMemory() {
    if (!this.memorySearchQuery.trim()) return;
    this.memorySearchResults = await this.fetchApi(
      `/api/memory/search?q=${encodeURIComponent(this.memorySearchQuery)}&mode=${this.memorySearchMode}`,
    );
  }
  async loadInsights() {
    const params = new URLSearchParams();
    if (this.insightCategoryFilter) params.set('category', this.insightCategoryFilter);
    if (this.insightSortBy) params.set('sort', this.insightSortBy);
    if (this.insightSearchQuery) params.set('search', this.insightSearchQuery);
    params.set('limit', String(this.insightPageSize));
    params.set('offset', String(this.insightPage * this.insightPageSize));
    const data: { insights: InsightData[]; total: number } = await this.fetchApi(`/api/insights?${params}`);
    this.insights = data.insights;
    this.insightTotal = data.total;
    const srcParams = new URLSearchParams();
    srcParams.set('limit', String(this.insightPageSize));
    srcParams.set('offset', String(this.insightSourcePage * this.insightPageSize));
    const srcData: { sources: InsightSourceData[]; total: number } = await this.fetchApi(`/api/insights/sources?${srcParams}`);
    this.insightSources = srcData.sources;
    this.insightSourceTotal = srcData.total;
    this.insightStats = await this.fetchApi('/api/insights/stats');
  }
  async searchInsights() {
    this.insightPage = 0;
    await this.loadInsights();
  }
  async setInsightPage(page: number) {
    this.insightPage = page;
    await this.loadInsights();
  }
  async setInsightSourcePage(page: number) {
    this.insightSourcePage = page;
    await this.loadInsights();
  }
  async deleteInsightItem(id: string) {
    await this.fetchApi(`/api/insights/${id}`, { method: 'DELETE' });
    delete this.insightDetails[id];
    await this.loadInsights();
  }
  async loadInsightDetail(id: string) {
    const detail = await this.fetchApi(`/api/insights/${id}`);
    this.insightDetails = { ...this.insightDetails, [id]: detail };
  }
  async loadDebug() { this.debug = await this.fetchApi('/api/debug'); }
  async loadChatHistory() {
    const data: { messages: MessageData[] } = await this.fetchApi('/api/chat/history');
    this.chatMessages = data.messages;
  }
  async loadMessages() {
    if (!this.messagesGroupJid) {
      this.messages = [];
      return;
    }
    const data: { messages: MessageData[]; hasMore: boolean } = await this.fetchApi(
      `/api/messages?group=${encodeURIComponent(this.messagesGroupJid)}&limit=50`,
    );
    this.messages = data.messages;
    this.messagesHasMore = data.hasMore;
  }
  async loadClaudeMd() {
    const endpoint = this.claudeMdFolder === 'global'
      ? '/api/config/global/claude-md'
      : `/api/config/groups/${encodeURIComponent(this.claudeMdFolder)}/claude-md`;
    const data: { content: string } = await this.fetchApi(endpoint);
    this.claudeMdContent = data.content;
    this.claudeMdDirty = false;
  }

  // Actions
  async saveClaudeMd() {
    const endpoint = this.claudeMdFolder === 'global'
      ? '/api/config/global/claude-md'
      : `/api/config/groups/${encodeURIComponent(this.claudeMdFolder)}/claude-md`;
    await this.fetchApi(endpoint, {
      method: 'PUT',
      body: JSON.stringify({ content: this.claudeMdContent }),
    });
    this.claudeMdDirty = false;
  }

  async toggleSkill(name: string) {
    await this.fetchApi(`/api/skills/${encodeURIComponent(name)}/toggle`, { method: 'POST' });
    await this.loadSkills();
  }

  async deleteSkill(name: string) {
    await this.fetchApi(`/api/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });
    this.skillEditorName = null;
    await this.loadSkills();
  }

  async createSkill(name: string, content: string) {
    await this.fetchApi('/api/skills', {
      method: 'POST',
      body: JSON.stringify({ name, content }),
    });
    await this.loadSkills();
  }

  async updateSkill(name: string, content: string) {
    await this.fetchApi(`/api/skills/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
    await this.loadSkills();
  }

  async pauseTask(id: string) {
    await this.fetchApi(`/api/tasks/${id}/pause`, { method: 'POST' });
    await this.loadTasks();
  }

  async resumeTask(id: string) {
    await this.fetchApi(`/api/tasks/${id}/resume`, { method: 'POST' });
    await this.loadTasks();
  }

  async deleteTask(id: string) {
    await this.fetchApi(`/api/tasks/${id}`, { method: 'DELETE' });
    await this.loadTasks();
  }

  async deleteSession(folder: string) {
    await this.fetchApi(`/api/sessions/${encodeURIComponent(folder)}`, { method: 'DELETE' });
    await this.loadSessions();
  }

  sendChat() {
    if (!this.chatDraft.trim()) return;
    const text = this.chatDraft.trim();
    this.chatMessages = [
      ...this.chatMessages,
      {
        id: `user-${Date.now()}`,
        chat_jid: 'web@chat',
        sender: 'web-user',
        sender_name: 'You',
        content: text,
        timestamp: new Date().toISOString(),
        is_from_me: false,
      },
    ];
    this.chatDraft = '';
    this.chatStreaming = true;
    this.chatStreamText = '';
    this.ws.send({ type: 'chat.send', text });
  }

  updated(changed: Map<string, unknown>) {
    super.updated(changed);
    if (changed.has('chatMessages') || changed.has('chatStreamText') || changed.has('chatStreaming')) {
      const thread = this.querySelector('#chat-thread');
      if (thread) {
        thread.scrollTop = thread.scrollHeight;
      }
    }
  }

  render() {
    return renderApp(this);
  }
}
