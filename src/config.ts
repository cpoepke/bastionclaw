import { execFileSync } from 'child_process';
import path from 'path';

export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'Andy';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 5000;

export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
export const TELEGRAM_ONLY = process.env.TELEGRAM_ONLY === 'true';

export const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
export const DISCORD_ONLY = process.env.DISCORD_ONLY === 'true';
export const DISCORD_WEBHOOK_URLS: string[] = (
  process.env.DISCORD_WEBHOOK_URLS || ''
)
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);

// Absolute paths needed for container mounts
const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || '/Users/user';

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'bastionclaw',
  'mount-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_GROUP_FOLDER = 'main';

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'bastionclaw-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '1800000',
  10,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default
export const IPC_POLL_INTERVAL = 1000;
export const IDLE_TIMEOUT = parseInt(process.env.IDLE_TIMEOUT || '1800000', 10); // 30min default — how long to keep container alive after last result
export const MAX_CONCURRENT_CONTAINERS = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_CONTAINERS || '5', 10) || 5,
);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const TRIGGER_PATTERN = new RegExp(
  `^@${escapeRegex(ASSISTANT_NAME)}\\b`,
  'i',
);

// WhatsApp sender allowlist: only these phone numbers can trigger the bot (empty = all allowed)
export const WHATSAPP_ALLOWED_SENDERS: Set<string> = (() => {
  const raw = process.env.WHATSAPP_ALLOWED_SENDERS || '';
  const numbers = raw
    .split(',')
    .map((s) => s.replace(/[+\s-]/g, '').trim())
    .filter(Boolean);
  return new Set(numbers);
})();

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

// WebUI
export const WEBUI_PORT = parseInt(process.env.WEBUI_PORT || '3100', 10);
export const WEBUI_HOST = process.env.WEBUI_HOST || '127.0.0.1';

// Container runtime detection: Apple Container (macOS) or Docker
let _detectedRuntime: 'container' | 'docker' | null = null;

export function getContainerRuntime(): 'container' | 'docker' {
  if (_detectedRuntime) return _detectedRuntime;
  try {
    execFileSync('container', ['--version'], { stdio: 'pipe' });
    _detectedRuntime = 'container';
  } catch {
    _detectedRuntime = 'docker';
  }
  return _detectedRuntime;
}

// Obsidian folder monitor
// OBSIDIAN_MONITOR_MAPPINGS format: "vault/path:chatJid,vault/path:chatJid"
export const OBSIDIAN_API_URL =
  process.env.OBSIDIAN_API_URL ||
  'http://obsidian-brain-mcp.obsidian-brain.svc.cluster.local:27123';

export const OBSIDIAN_MONITOR_MAPPINGS: Array<{
  vaultPath: string;
  chatJid: string;
}> = (process.env.OBSIDIAN_MONITOR_MAPPINGS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((entry) => {
    const colonIdx = entry.lastIndexOf(':');
    if (colonIdx === -1) return null;
    return {
      vaultPath: entry.slice(0, colonIdx).trim(),
      chatJid: entry.slice(colonIdx + 1).trim(),
    };
  })
  .filter((e): e is { vaultPath: string; chatJid: string } => e !== null);

export const OBSIDIAN_MONITOR_INTERVAL = parseInt(
  process.env.OBSIDIAN_MONITOR_INTERVAL || '60000',
  10,
);

export const OBSIDIAN_MONITOR_MAX_AGE_DAYS = parseInt(
  process.env.OBSIDIAN_MONITOR_MAX_AGE_DAYS || '3',
  10,
);
