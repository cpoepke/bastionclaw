/**
 * Group folder validation — prevents path traversal attacks.
 *
 * Group folder names from the DB are used in path.join() calls throughout
 * the codebase. Without validation, a malicious folder like "../../etc"
 * could escape the groups directory.
 */
import path from 'path';

import { DATA_DIR, GROUPS_DIR } from './config.js';

/** Allowlist: alphanumeric, hyphens, underscores. 1-64 chars. */
const VALID_FOLDER_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isValidGroupFolder(folder: string): boolean {
  return VALID_FOLDER_RE.test(folder);
}

/**
 * Resolve a group folder path under GROUPS_DIR and verify it doesn't escape.
 * Throws if the folder name is invalid or the resolved path escapes the base.
 */
export function resolveGroupFolderPath(folder: string): string {
  if (!isValidGroupFolder(folder)) {
    throw new Error(`Invalid group folder name: ${folder}`);
  }
  const resolved = path.resolve(GROUPS_DIR, folder);
  if (!resolved.startsWith(GROUPS_DIR + path.sep) && resolved !== GROUPS_DIR) {
    throw new Error(`Group folder path escapes base directory: ${folder}`);
  }
  return resolved;
}

/**
 * Resolve a group IPC path under DATA_DIR/ipc and verify it doesn't escape.
 * Throws if the folder name is invalid or the resolved path escapes the base.
 */
export function resolveGroupIpcPath(folder: string): string {
  if (!isValidGroupFolder(folder)) {
    throw new Error(`Invalid group folder name: ${folder}`);
  }
  const ipcBase = path.join(DATA_DIR, 'ipc');
  const resolved = path.resolve(ipcBase, folder);
  if (!resolved.startsWith(ipcBase + path.sep) && resolved !== ipcBase) {
    throw new Error(`Group IPC path escapes base directory: ${folder}`);
  }
  return resolved;
}
