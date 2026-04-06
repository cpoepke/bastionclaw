import {
  OBSIDIAN_API_URL,
  OBSIDIAN_MONITOR_MAPPINGS,
  OBSIDIAN_MONITOR_INTERVAL,
  OBSIDIAN_MONITOR_MAX_AGE_DAYS,
} from './config.js';
import { getSeenFiles, markFileSeen } from './db.js';
import { logger } from './logger.js';

interface ObsidianMonitorDeps {
  sendMessage: (jid: string, text: string) => Promise<void>;
}

interface ObsidianFileEntry {
  path: string;
  // The Obsidian Local REST API returns these fields in directory listings
  [key: string]: unknown;
}

export function startObsidianMonitor(deps: ObsidianMonitorDeps): void {
  if (OBSIDIAN_MONITOR_MAPPINGS.length === 0) {
    logger.info('Obsidian monitor disabled (no mappings configured)');
    return;
  }

  const apiKey = process.env.LOCAL_REST_API_KEY;
  if (!apiKey) {
    logger.warn('Obsidian monitor disabled: LOCAL_REST_API_KEY not set');
    return;
  }

  logger.info(
    {
      mappings: OBSIDIAN_MONITOR_MAPPINGS.length,
      interval: OBSIDIAN_MONITOR_INTERVAL,
    },
    'Obsidian monitor started',
  );

  const poll = async () => {
    for (const { vaultPath, chatJid } of OBSIDIAN_MONITOR_MAPPINGS) {
      try {
        await checkFolder(vaultPath, chatJid, apiKey, deps);
      } catch (err) {
        logger.error(
          { err, vaultPath },
          'Obsidian monitor: folder check failed',
        );
      }
    }
    setTimeout(poll, OBSIDIAN_MONITOR_INTERVAL);
  };

  // Delay first poll by 10s to let connections stabilize
  setTimeout(poll, 10_000);
}

async function checkFolder(
  vaultPath: string,
  chatJid: string,
  apiKey: string,
  deps: ObsidianMonitorDeps,
): Promise<void> {
  const encodedPath = encodeURIComponent(vaultPath).replace(/%2F/g, '/');
  const url = `${OBSIDIAN_API_URL}/vault/${encodedPath}/`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    logger.warn(
      { status: response.status, vaultPath },
      'Obsidian monitor: failed to list folder',
    );
    return;
  }

  const data = (await response.json()) as { files: string[] };
  const files = data.files || [];

  // Filter to .md files only
  const mdFiles = files.filter((f) => f.endsWith('.md'));

  const seen = getSeenFiles(vaultPath);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - OBSIDIAN_MONITOR_MAX_AGE_DAYS);

  const newFiles: string[] = [];

  for (const filePath of mdFiles) {
    if (seen.has(filePath)) continue;

    // Extract date from filename patterns like "Personal-Briefing-2026-04-06.md"
    // or fall back to checking via the Obsidian API
    const dateMatch = filePath.match(/(\d{4})[.-](\d{2})[.-](\d{2})/);
    if (dateMatch) {
      const fileDate = new Date(
        `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`,
      );
      if (fileDate < cutoff) {
        // Old file, mark as seen but don't notify
        markFileSeen(vaultPath, filePath);
        continue;
      }
    }

    newFiles.push(filePath);
    markFileSeen(vaultPath, filePath);
  }

  if (newFiles.length > 0) {
    logger.info(
      { vaultPath, count: newFiles.length, files: newFiles },
      'Obsidian monitor: new files detected',
    );

    for (const filePath of newFiles) {
      const filename = filePath.split('/').pop() || filePath;
      const message = `\u{1F4C4} New note: *${filename.replace('.md', '')}*\n\u{1F4C1} \`${vaultPath}/${filePath}\``;
      try {
        await deps.sendMessage(chatJid, message);
      } catch (err) {
        logger.error(
          { err, filePath, chatJid },
          'Obsidian monitor: failed to send notification',
        );
      }
    }
  }
}
