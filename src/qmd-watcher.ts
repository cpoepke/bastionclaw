import fs from 'fs';
import { execFile, execFileSync } from 'child_process';
import { logger } from './logger.js';
import { GROUPS_DIR } from './config.js';
import { getQmdBin } from './qmd.js';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let maxDelayTimer: ReturnType<typeof setTimeout> | null = null;
let embedRunning = false;
const DEBOUNCE_MS = 15000; // Wait 15s after last change before embedding
const MAX_DELAY_MS = 60000; // Force embed after 60s regardless of continued changes

function runEmbed(qmd: string): void {
  if (embedRunning) return;
  embedRunning = true;

  // Clear both timers
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (maxDelayTimer) {
    clearTimeout(maxDelayTimer);
    maxDelayTimer = null;
  }

  logger.info('qmd auto-update starting');
  // update discovers new/changed files, embed creates vectors
  execFile(qmd, ['update'], { timeout: 60000 }, (updateErr) => {
    if (updateErr)
      logger.warn({ err: updateErr }, 'qmd update failed (non-fatal)');
    execFile(qmd, ['embed'], { timeout: 60000 }, (embedErr) => {
      embedRunning = false;
      if (embedErr)
        logger.warn({ err: embedErr }, 'qmd auto-embed failed (non-fatal)');
      else logger.debug('qmd auto-update+embed complete');
    });
  });
}

/**
 * Auto-register group directories as qmd collections and run initial embed.
 * Idempotent — safe to call on every startup.
 */
function ensureQmdCollections(qmd: string): void {
  try {
    const dirs = fs.readdirSync(GROUPS_DIR).filter((f) => {
      try {
        return fs.statSync(`${GROUPS_DIR}/${f}`).isDirectory();
      } catch {
        return false;
      }
    });

    for (const name of dirs) {
      const dirPath = `${GROUPS_DIR}/${name}`;
      try {
        execFileSync(qmd, ['collection', 'add', dirPath, '--name', name], {
          timeout: 10000,
          stdio: 'pipe',
        });
        logger.debug({ name }, 'qmd collection registered');
      } catch {
        // Already exists or other non-fatal error
      }
    }

    // Run initial update + embed (non-blocking)
    execFile(qmd, ['update'], { timeout: 60000 }, (updateErr) => {
      if (updateErr)
        logger.warn(
          { err: updateErr },
          'qmd initial update failed (non-fatal)',
        );
      execFile(qmd, ['embed'], { timeout: 60000 }, (embedErr) => {
        if (embedErr)
          logger.warn(
            { err: embedErr },
            'qmd initial embed failed (non-fatal)',
          );
        else logger.info('qmd initial update+embed complete');
      });
    });
  } catch (err) {
    logger.warn({ err }, 'qmd collection registration failed (non-fatal)');
  }
}

export function startQmdWatcher(): void {
  try {
    const qmd = getQmdBin();

    // Ensure collections are registered and initially embedded
    ensureQmdCollections(qmd);

    const watcher = fs.watch(
      GROUPS_DIR,
      { recursive: true },
      (_event, filename) => {
        if (!filename || !filename.endsWith('.md')) return;
        if (filename.includes('/logs/')) return;
        if (embedRunning) return;

        // Debounce: reset on each change
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => runEmbed(qmd), DEBOUNCE_MS);

        // Max delay: ensure embed fires within 60s of first change
        if (!maxDelayTimer) {
          maxDelayTimer = setTimeout(() => runEmbed(qmd), MAX_DELAY_MS);
        }
      },
    );

    watcher.on('error', (err) => {
      logger.warn({ err }, 'qmd file watcher error');
    });

    logger.info('qmd file watcher started on groups/');
  } catch (err) {
    logger.warn({ err }, 'Failed to start qmd file watcher (non-fatal)');
  }
}
