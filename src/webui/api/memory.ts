import { execFileSync } from 'child_process';
import type { FastifyInstance } from 'fastify';
import { getQmdBin } from '../../qmd.js';

interface MemoryStatus {
  totalDocuments: number;
  totalVectors: number;
  indexSize: string;
  mcpStatus: string;
  mcpPid: string | null;
  lastUpdated: string;
  collections: { name: string; path: string; fileCount: number }[];
  error?: string;
}

function parseQmdStatus(text: string): MemoryStatus {
  const result: MemoryStatus = {
    totalDocuments: 0,
    totalVectors: 0,
    indexSize: '',
    mcpStatus: 'unknown',
    mcpPid: null,
    lastUpdated: '',
    collections: [],
  };

  // Parse "Size:  3.3 MB"
  const sizeMatch = text.match(/Size:\s+(.+)/);
  if (sizeMatch) result.indexSize = sizeMatch[1].trim();

  // Parse "MCP:   running (PID 35231)" or "MCP:   not running"
  const mcpMatch = text.match(/MCP:\s+(\w+)(?:\s+\(PID (\d+)\))?/);
  if (mcpMatch) {
    result.mcpStatus = mcpMatch[1];
    result.mcpPid = mcpMatch[2] || null;
  }

  // Parse "Total:    11 files indexed"
  const totalMatch = text.match(/Total:\s+(\d+)/);
  if (totalMatch) result.totalDocuments = parseInt(totalMatch[1], 10);

  // Parse "Vectors:  34 embedded"
  const vecMatch = text.match(/Vectors:\s+(\d+)/);
  if (vecMatch) result.totalVectors = parseInt(vecMatch[1], 10);

  // Parse "Updated:  17m ago"
  const updMatch = text.match(/Updated:\s+(.+)/);
  if (updMatch) result.lastUpdated = updMatch[1].trim();

  // Parse collection blocks like:
  //   global (qmd://global/)
  //     Pattern:  **/*.md
  //     Files:    1 (updated 17m ago)
  const collectionRegex = /^\s{2}(\w[\w-]*)\s+\(qmd:\/\/\w+\/\)\s*\n\s+Pattern:\s+.+\n\s+Files:\s+(\d+)/gm;
  let match;
  while ((match = collectionRegex.exec(text)) !== null) {
    result.collections.push({
      name: match[1],
      path: `qmd://${match[1]}/`,
      fileCount: parseInt(match[2], 10),
    });
  }

  return result;
}

export function registerMemoryRoutes(app: FastifyInstance): void {
  // GET /api/memory — qmd status + collection stats
  app.get('/api/memory', async () => {
    try {
      const statusText = execFileSync(getQmdBin(), ['status'], {
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf-8',
      });
      return parseQmdStatus(statusText);
    } catch (err) {
      return {
        error: 'qmd not available',
        message: err instanceof Error ? err.message : String(err),
        collections: [],
        totalDocuments: 0,
        mcpStatus: 'stopped',
      };
    }
  });

  // GET /api/memory/search?q=...&mode=keyword|semantic|hybrid — test search from WebUI
  app.get('/api/memory/search', async (req) => {
    const { q, mode = 'search' } = req.query as { q: string; mode?: string };
    if (!q) return { results: [], error: 'Missing query parameter "q"' };
    if (q.length > 500) return { results: [], error: 'Query too long (max 500 chars)' };

    const cmd = mode === 'semantic' ? 'vsearch' : mode === 'hybrid' ? 'query' : 'search';
    try {
      const result = execFileSync(getQmdBin(), [cmd, '--json', q], {
        timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf-8',
      });
      return { results: JSON.parse(result) };
    } catch (err) {
      return {
        results: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}
