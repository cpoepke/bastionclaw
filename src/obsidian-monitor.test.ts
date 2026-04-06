import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./config.js', () => ({
  OBSIDIAN_API_URL: 'http://obsidian.test:27123',
  OBSIDIAN_MONITOR_MAPPINGS: [
    { vaultPath: 'Sources/Briefings', chatJid: 'briefings@g.us' },
  ],
  OBSIDIAN_MONITOR_INTERVAL: 60000,
  OBSIDIAN_MONITOR_MAX_AGE_DAYS: 3,
}));

vi.mock('./db.js', () => ({
  getSeenFiles: vi.fn(() => new Set<string>()),
  markFileSeen: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { startObsidianMonitor } from './obsidian-monitor.js';
import { getSeenFiles, markFileSeen } from './db.js';

const mockGetSeenFiles = vi.mocked(getSeenFiles);
const mockMarkFileSeen = vi.mocked(markFileSeen);

describe('obsidian-monitor', () => {
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-06T12:00:00Z'));
    sendMessage = vi.fn().mockResolvedValue(undefined);
    process.env.LOCAL_REST_API_KEY = 'test-api-key';
    vi.clearAllMocks();
    mockGetSeenFiles.mockReturnValue(new Set<string>());
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.LOCAL_REST_API_KEY;
  });

  function mockFetch(files: string[], ok = true, status = 200) {
    global.fetch = vi.fn().mockResolvedValue({
      ok,
      status,
      json: () => Promise.resolve({ files }),
    });
  }

  async function startAndPoll() {
    startObsidianMonitor({ sendMessage });
    await vi.advanceTimersByTimeAsync(10_000);
  }

  it('sends notification for new recent file', async () => {
    mockFetch(['2026/04/Personal-Briefing-2026-04-06.md']);

    await startAndPoll();

    expect(global.fetch).toHaveBeenCalledWith(
      'http://obsidian.test:27123/vault/Sources/Briefings/',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer test-api-key',
          Accept: 'application/json',
        },
      }),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      'briefings@g.us',
      expect.stringContaining('Personal-Briefing-2026-04-06'),
    );
    expect(mockMarkFileSeen).toHaveBeenCalledWith(
      'Sources/Briefings',
      '2026/04/Personal-Briefing-2026-04-06.md',
    );
  });

  it('skips files older than max age (3 days)', async () => {
    mockFetch(['2026/03/Personal-Briefing-2026-03-01.md']);

    await startAndPoll();

    expect(sendMessage).not.toHaveBeenCalled();
    // Still marks as seen to avoid re-checking
    expect(mockMarkFileSeen).toHaveBeenCalledWith(
      'Sources/Briefings',
      '2026/03/Personal-Briefing-2026-03-01.md',
    );
  });

  it('skips already seen files', async () => {
    mockGetSeenFiles.mockReturnValue(
      new Set(['2026/04/Personal-Briefing-2026-04-06.md']),
    );
    mockFetch(['2026/04/Personal-Briefing-2026-04-06.md']);

    await startAndPoll();

    expect(sendMessage).not.toHaveBeenCalled();
    expect(mockMarkFileSeen).not.toHaveBeenCalled();
  });

  it('filters non-markdown files', async () => {
    mockFetch(['image.png', 'data.json', 'Recent-Note.md']);

    await startAndPoll();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      'briefings@g.us',
      expect.stringContaining('Recent-Note'),
    );
  });

  it('handles API errors gracefully', async () => {
    mockFetch([], false, 500);

    await startAndPoll();

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does not start when LOCAL_REST_API_KEY is missing', async () => {
    delete process.env.LOCAL_REST_API_KEY;
    global.fetch = vi.fn();

    startObsidianMonitor({ sendMessage });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sends multiple notifications for multiple new files', async () => {
    mockFetch([
      '2026/04/Personal-Briefing-2026-04-05.md',
      '2026/04/Personal-Briefing-2026-04-06.md',
    ]);

    await startAndPoll();

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(mockMarkFileSeen).toHaveBeenCalledTimes(2);
  });

  it('includes file without date in name as new (no age filter)', async () => {
    mockFetch(['my-research-note.md']);

    await startAndPoll();

    expect(sendMessage).toHaveBeenCalledWith(
      'briefings@g.us',
      expect.stringContaining('my-research-note'),
    );
  });

  it('continues polling after sendMessage error', async () => {
    sendMessage.mockRejectedValueOnce(new Error('send failed'));
    mockFetch([
      '2026/04/Personal-Briefing-2026-04-05.md',
      '2026/04/Personal-Briefing-2026-04-06.md',
    ]);

    await startAndPoll();

    // Both files should be marked as seen despite send error on first
    expect(mockMarkFileSeen).toHaveBeenCalledTimes(2);
  });
});
