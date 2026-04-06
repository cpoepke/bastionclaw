import type { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';

const WORKSPACE = path.resolve(process.cwd(), 'workspace', 'group', 'youtube');
const SOURCES_FILE = path.resolve(
  process.cwd(),
  '.claude',
  'skills',
  'youtube-planner',
  'sources.json',
);

// Find all metadata JSON files under workspace date/channel/video/metadata dirs
function findMetadataFiles(base: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(base)) return results;
  // Level 1: date dirs
  for (const d1 of fs.readdirSync(base, { withFileTypes: true })) {
    if (!d1.isDirectory() || d1.name === 'dashboard.html') continue;
    const p1 = path.join(base, d1.name);
    // Level 2: channel dirs
    for (const d2 of fs.readdirSync(p1, { withFileTypes: true })) {
      if (!d2.isDirectory()) continue;
      const p2 = path.join(p1, d2.name);
      // Level 3: video dirs
      for (const d3 of fs.readdirSync(p2, { withFileTypes: true })) {
        if (!d3.isDirectory()) continue;
        const metaDir = path.join(p2, d3.name, 'metadata');
        if (!fs.existsSync(metaDir)) continue;
        for (const f of fs.readdirSync(metaDir)) {
          if (f.endsWith('.json')) {
            results.push(path.join(metaDir, f));
          }
        }
      }
    }
  }
  return results;
}

interface VideoMeta {
  video_id?: string;
  videoId?: string;
  title?: string;
  author_name?: string;
  author?: string;
  published?: string;
  viewCount?: number;
  thumbnail_url?: string;
  thumbnail?: string;
  link?: string;
  duration_seconds?: number;
}

function parseTimestamp(filename: string): Date | null {
  const stem = path.basename(filename, '.json');
  const match = stem.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})$/);
  if (!match) return null;
  return new Date(
    `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00Z`,
  );
}

function calculateVph(views: number, publishedStr: string): number {
  const published = new Date(publishedStr);
  const now = new Date();
  let hours = (now.getTime() - published.getTime()) / 3600000;
  if (hours < 0.1) hours = 0.1;
  return Math.round(views / hours);
}

function collectVideos(): {
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
}[] {
  if (!fs.existsSync(WORKSPACE)) return [];

  const metadataFiles = findMetadataFiles(WORKSPACE);
  const videoMap = new Map<
    string,
    { meta: VideoMeta; snapshots: [Date, number][] }
  >();

  for (const filepath of metadataFiles) {
    let meta: VideoMeta;
    try {
      meta = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    } catch {
      continue;
    }

    const videoId = meta.video_id || meta.videoId || '';
    if (!videoId) continue;

    const ts = parseTimestamp(filepath);
    if (!ts) continue;

    if (!videoMap.has(videoId)) {
      videoMap.set(videoId, { meta, snapshots: [] });
    }
    videoMap.get(videoId)!.snapshots.push([ts, Number(meta.viewCount || 0)]);
  }

  const videos: ReturnType<typeof collectVideos> = [];

  for (const [videoId, data] of videoMap) {
    const { meta, snapshots } = data;
    if (!meta.published) continue;

    snapshots.sort((a, b) => a[0].getTime() - b[0].getTime());
    const latestViews = snapshots[snapshots.length - 1][1];
    const vph = calculateVph(latestViews, meta.published);
    const sparklinePoints = snapshots.map((s) => s[1]);

    let trendDirection: 'accelerating' | 'decelerating' | 'flat' = 'flat';
    if (sparklinePoints.length >= 2) {
      const mid = Math.floor(sparklinePoints.length / 2);
      const firstAvg =
        sparklinePoints.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
      const secondAvg =
        sparklinePoints.slice(mid).reduce((a, b) => a + b, 0) /
        (sparklinePoints.length - mid);
      if (secondAvg > firstAvg * 1.1) trendDirection = 'accelerating';
      else if (secondAvg < firstAvg * 0.9) trendDirection = 'decelerating';
    }

    videos.push({
      videoId,
      title: meta.title || 'Unknown',
      author: meta.author_name || meta.author || 'Unknown',
      published: meta.published,
      views: latestViews,
      vph,
      thumbnail: meta.thumbnail_url || meta.thumbnail || '',
      link: meta.link || `https://www.youtube.com/watch?v=${videoId}`,
      sparklinePoints,
      snapshotCount: snapshots.length,
      trendDirection,
      duration: meta.duration_seconds ?? null,
    });
  }

  videos.sort((a, b) => b.vph - a.vph);
  return videos;
}

function readSources(): { sources: string[]; lookbackDays: number } {
  try {
    const data = JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf-8'));
    return {
      sources: data.sources || [],
      lookbackDays: data.lookback_days || 30,
    };
  } catch {
    return { sources: [], lookbackDays: 30 };
  }
}

function writeSources(sources: string[], lookbackDays: number): void {
  const dir = path.dirname(SOURCES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    SOURCES_FILE,
    JSON.stringify({ sources, lookback_days: lookbackDays }, null, 2) + '\n',
  );
}

export function registerYouTubeRoutes(app: FastifyInstance): void {
  // Dashboard data — all videos with VPH computed server-side
  app.get('/api/youtube/dashboard', async () => {
    const videos = collectVideos();
    return {
      videos,
      lastUpdated: new Date().toISOString(),
    };
  });

  // Tracked sources list
  app.get('/api/youtube/sources', async () => {
    return readSources();
  });

  // Add a channel to sources
  app.post<{ Body: { handle: string } }>(
    '/api/youtube/sources',
    async (req, reply) => {
      const handle = req.body.handle?.trim();
      if (!handle)
        return reply.status(400).send({ error: 'handle is required' });
      const normalized = handle.startsWith('@') ? handle : `@${handle}`;
      const { sources, lookbackDays } = readSources();
      if (sources.includes(normalized)) {
        return { ok: true, message: 'Already tracked' };
      }
      sources.push(normalized);
      writeSources(sources, lookbackDays);
      return { ok: true, sources };
    },
  );

  // Remove a channel from sources
  app.delete<{ Params: { handle: string } }>(
    '/api/youtube/sources/:handle',
    async (req, reply) => {
      const handle = decodeURIComponent(req.params.handle);
      const { sources, lookbackDays } = readSources();
      const idx = sources.indexOf(handle);
      if (idx === -1)
        return reply.status(404).send({ error: 'Channel not found' });
      sources.splice(idx, 1);
      writeSources(sources, lookbackDays);
      return { ok: true, sources };
    },
  );
}
