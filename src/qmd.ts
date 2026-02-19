/**
 * Resolves the qmd binary path from node_modules/.bin.
 * All host-side code should use this instead of bare 'qmd'.
 */

import path from 'path';
import fs from 'fs';

let _qmdPath: string | null = null;

export function getQmdBin(): string {
  if (_qmdPath) return _qmdPath;

  // Resolve from project's node_modules/.bin
  const projectBin = path.resolve(process.cwd(), 'node_modules', '.bin', 'qmd');
  if (fs.existsSync(projectBin)) {
    _qmdPath = projectBin;
    return _qmdPath;
  }

  // Fallback: check PATH
  _qmdPath = 'qmd';
  return _qmdPath;
}
