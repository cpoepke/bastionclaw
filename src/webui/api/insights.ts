import type { FastifyInstance } from 'fastify';
import {
  getTopInsights,
  getInsightById,
  deleteInsight,
  updateInsightFields,
  getAllInsightSources,
  getInsightsBySource,
  getSourceByHash,
  getInsightStats,
  searchInsightsKeyword,
} from '../../db.js';

export function registerInsightRoutes(app: FastifyInstance): void {
  // List insights (sortable, filterable, searchable)
  app.get<{
    Querystring: {
      group?: string;
      sort?: string;
      category?: string;
      search?: string;
      limit?: string;
      offset?: string;
    };
  }>('/api/insights', async (req) => {
    const groupFolder = req.query.group || 'main';
    const sortBy = req.query.sort === 'recent' ? 'recent' : 'source_count';
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const offset = parseInt(req.query.offset || '0', 10);

    if (req.query.search) {
      const insights = searchInsightsKeyword(groupFolder, req.query.search, limit);
      return { insights, total: insights.length };
    }

    return getTopInsights(groupFolder, limit, offset, req.query.category, sortBy);
  });

  // Stats — must be before /:id to avoid matching "stats" as an ID
  app.get<{ Querystring: { group?: string } }>('/api/insights/stats', async (req) => {
    const groupFolder = req.query.group || 'main';
    return getInsightStats(groupFolder);
  });

  // List all sources — must be before /:id
  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/api/insights/sources',
    async (req) => {
      const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
      const offset = parseInt(req.query.offset || '0', 10);
      return getAllInsightSources(limit, offset);
    },
  );

  // Source with linked insights
  app.get<{ Params: { id: string } }>('/api/insights/sources/:id', async (req, reply) => {
    const source = getSourceByHash(req.params.id);
    if (!source) return reply.status(404).send({ error: 'Source not found' });
    const insights = getInsightsBySource(req.params.id);
    return { ...source, insights };
  });

  // Single insight with sources
  app.get<{ Params: { id: string } }>('/api/insights/:id', async (req, reply) => {
    const insight = getInsightById(req.params.id);
    if (!insight) return reply.status(404).send({ error: 'Insight not found' });
    return insight;
  });

  // Delete insight
  app.delete<{ Params: { id: string } }>('/api/insights/:id', async (req, reply) => {
    const insight = getInsightById(req.params.id);
    if (!insight) return reply.status(404).send({ error: 'Insight not found' });
    deleteInsight(req.params.id);
    return { ok: true };
  });

  // Update insight
  app.patch<{ Params: { id: string }; Body: { text?: string; category?: string } }>(
    '/api/insights/:id',
    async (req, reply) => {
      const insight = getInsightById(req.params.id);
      if (!insight) return reply.status(404).send({ error: 'Insight not found' });
      updateInsightFields(req.params.id, req.body);
      return { ok: true };
    },
  );
}
