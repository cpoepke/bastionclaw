import { html, nothing } from 'lit';
import type { NanoClawApp } from '../app.ts';
import { formatAgo, clampText } from '../format.ts';

/** Build a YouTube deep-link URL from a source URL and timestamp_ref like "12:34" */
function youtubeDeepLink(sourceUrl: string, timestampRef: string | null): string | null {
  if (!timestampRef) return null;
  const ytMatch = sourceUrl.match(/youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/);
  if (!ytMatch) return null;
  const parts = timestampRef.split(':').map(Number);
  let seconds = 0;
  if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
  else seconds = parts[0] || 0;
  return `https://www.youtube.com/watch?v=${ytMatch[1]}&t=${seconds}`;
}

/** Extract author from source metadata JSON */
function getAuthor(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const m = JSON.parse(metadata);
    return m.author_name || m.author || m.channel || null;
  } catch { return null; }
}

export function renderInsights(state: NanoClawApp) {
  const stats = state.insightStats;
  const insights = state.insights;
  const sources = state.insightSources;

  return html`
    <!-- Stats cards -->
    ${stats ? html`
      <div class="card-grid" style="margin-bottom: 16px;">
        <div class="card">
          <div class="card-title">Total Insights</div>
          <div class="stat-value">${stats.totalInsights}</div>
        </div>
        <div class="card">
          <div class="card-title">Total Sources</div>
          <div class="stat-value">${stats.totalSources}</div>
        </div>
        <div class="card">
          <div class="card-title">Top Insight</div>
          <div class="muted" style="font-size: 12px;">${stats.topInsight ? clampText(stats.topInsight.text, 80) : 'None yet'}</div>
          ${stats.topInsight ? html`<div class="chip chip-ok" style="margin-top: 4px;">${stats.topInsight.source_count} sources</div>` : nothing}
        </div>
      </div>
    ` : nothing}

    <!-- Search and filter -->
    <section class="card">
      <div class="row" style="justify-content: space-between; flex-wrap: wrap; gap: 8px;">
        <div class="row" style="gap: 8px; flex: 1;">
          <input
            type="text"
            class="input"
            placeholder="Search insights..."
            .value=${state.insightSearchQuery}
            @input=${(e: Event) => { state.insightSearchQuery = (e.target as HTMLInputElement).value; }}
            @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') state.searchInsights(); }}
            style="max-width: 300px;"
          />
          <select class="input" style="width: auto;" @change=${(e: Event) => {
            state.insightCategoryFilter = (e.target as HTMLSelectElement).value;
            state.insightPage = 0;
            state.loadInsights();
          }}>
            <option value="">All categories</option>
            ${(stats?.categories || []).map(c => html`
              <option value=${c.category} ?selected=${state.insightCategoryFilter === c.category}>${c.category} (${c.count})</option>
            `)}
          </select>
          <select class="input" style="width: auto;" @change=${(e: Event) => {
            state.insightSortBy = (e.target as HTMLSelectElement).value;
            state.insightPage = 0;
            state.loadInsights();
          }}>
            <option value="source_count" ?selected=${state.insightSortBy === 'source_count'}>Most sourced</option>
            <option value="recent" ?selected=${state.insightSortBy === 'recent'}>Most recent</option>
          </select>
        </div>
        <button class="btn" ?disabled=${state.loading} @click=${() => state.loadInsights()}>
          ${state.loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>
    </section>

    <!-- Insights list -->
    <section class="card" style="margin-top: 16px;">
      <div class="card-title">Insights</div>
      <div class="card-sub">${state.insightTotal} insight${state.insightTotal !== 1 ? 's' : ''}${state.insightTotal > state.insightPageSize ? html` — page ${state.insightPage + 1} of ${Math.ceil(state.insightTotal / state.insightPageSize)}` : nothing}</div>

      ${insights.length === 0
        ? html`<div class="muted" style="margin-top: 16px;">No insights yet. Use the /ingest skill to extract insights from content.</div>`
        : html`
          <div class="list" style="margin-top: 16px;">
            ${insights.map(i => html`
              <div class="list-item" style="display: block;">
                <!-- Bold thesis -->
                <div class="list-title" style="font-weight: 700; font-size: 15px;">${i.text}</div>

                <!-- Detail paragraph -->
                ${i.detail ? html`<div class="muted" style="margin-top: 6px; font-size: 13px; line-height: 1.5;">${i.detail}</div>` : nothing}

                <!-- Category and source count chips -->
                <div class="chip-row" style="margin-top: 8px;">
                  ${i.category ? html`<span class="chip">${i.category}</span>` : nothing}
                  <span class="chip chip-ok">${i.source_count} source${i.source_count !== 1 ? 's' : ''}</span>
                </div>

                <!-- Expandable sources with timestamps -->
                <details style="margin-top: 8px;" @toggle=${(e: Event) => {
                  const det = e.target as HTMLDetailsElement;
                  if (det.open && !state.insightDetails[i.id]) {
                    state.loadInsightDetail(i.id);
                  }
                }}>
                  <summary class="muted" style="cursor: pointer; font-size: 12px;">
                    View ${i.source_count} source${i.source_count !== 1 ? 's' : ''} with timestamps
                  </summary>
                  ${state.insightDetails[i.id] ? html`
                    <div style="margin-top: 8px; padding-left: 12px; border-left: 2px solid var(--border);">
                      ${state.insightDetails[i.id].sources.map((s: any) => {
                        const deepLink = youtubeDeepLink(s.url, s.timestamp_ref);
                        const author = getAuthor(s.metadata);
                        return html`
                          <div style="padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px;">
                            <div style="font-weight: 500;">
                              ${s.title || s.url}${author ? html` <span class="muted" style="font-weight: 400;">— ${author}</span>` : nothing}
                            </div>
                            ${s.context ? html`<div class="muted" style="margin-top: 4px; font-style: italic;">"${clampText(s.context, 200)}"</div>` : nothing}
                            <div class="chip-row" style="margin-top: 4px;">
                              <span class="chip">${s.source_type}</span>
                              ${s.timestamp_ref ? html`
                                ${deepLink ? html`
                                  <a href=${deepLink} target="_blank" rel="noopener" class="chip chip-ok" style="text-decoration: none; cursor: pointer;">
                                    &#9654; ${s.timestamp_ref}
                                  </a>
                                ` : html`<span class="chip">${s.timestamp_ref}</span>`}
                              ` : nothing}
                              <a href=${s.url} target="_blank" rel="noopener" style="color: var(--accent); font-size: 11px;">Open source</a>
                            </div>
                          </div>
                        `;
                      })}
                    </div>
                  ` : html`<div class="muted" style="margin-top: 6px;">Loading...</div>`}
                </details>

                <!-- Delete with confirmation -->
                <div style="margin-top: 8px; text-align: right;">
                  <button class="btn btn--sm danger" @click=${(e: Event) => {
                    const btn = e.target as HTMLButtonElement;
                    if (btn.dataset.confirmed === 'true') {
                      state.deleteInsightItem(i.id);
                    } else {
                      btn.textContent = 'Confirm delete?';
                      btn.dataset.confirmed = 'true';
                      setTimeout(() => { btn.textContent = 'Delete'; btn.dataset.confirmed = ''; }, 3000);
                    }
                  }}>Delete</button>
                </div>
              </div>
            `)}
          </div>
        `
      }

      ${state.insightTotal > state.insightPageSize ? html`
        <div class="row" style="justify-content: center; gap: 8px; margin-top: 16px;">
          <button class="btn btn--sm" ?disabled=${state.insightPage === 0} @click=${() => state.setInsightPage(state.insightPage - 1)}>← Prev</button>
          <span class="muted" style="line-height: 32px;">${state.insightPage + 1} / ${Math.ceil(state.insightTotal / state.insightPageSize)}</span>
          <button class="btn btn--sm" ?disabled=${(state.insightPage + 1) * state.insightPageSize >= state.insightTotal} @click=${() => state.setInsightPage(state.insightPage + 1)}>Next →</button>
        </div>
      ` : nothing}
    </section>

    <!-- Sources table -->
    <section class="card" style="margin-top: 16px;">
      <div class="card-title">Indexed Sources</div>
      <div class="card-sub">${state.insightSourceTotal} source${state.insightSourceTotal !== 1 ? 's' : ''}${state.insightSourceTotal > state.insightPageSize ? html` — page ${state.insightSourcePage + 1} of ${Math.ceil(state.insightSourceTotal / state.insightPageSize)}` : nothing}</div>

      ${sources.length === 0
        ? html`<div class="muted" style="margin-top: 16px;">No sources indexed yet.</div>`
        : html`
          <div class="list" style="margin-top: 16px;">
            ${sources.map(s => {
              const author = getAuthor(s.metadata);
              return html`
                <div class="list-item">
                  <div class="list-main">
                    <div class="list-title">
                      ${s.title || s.url}${author ? html` <span class="muted" style="font-weight: 400;">— ${author}</span>` : nothing}
                    </div>
                    <div class="list-sub">
                      <a href=${s.url} target="_blank" rel="noopener" style="color: var(--accent);">${clampText(s.url, 60)}</a>
                    </div>
                    <div class="chip-row" style="margin-top: 6px;">
                      <span class="chip">${s.source_type}</span>
                      <span class="chip">${s.insight_count} insight${s.insight_count !== 1 ? 's' : ''}</span>
                      <span class="chip">Indexed: ${formatAgo(new Date(s.indexed_at).getTime())}</span>
                    </div>
                  </div>
                </div>
              `;
            })}
          </div>
        `
      }

      ${state.insightSourceTotal > state.insightPageSize ? html`
        <div class="row" style="justify-content: center; gap: 8px; margin-top: 16px;">
          <button class="btn btn--sm" ?disabled=${state.insightSourcePage === 0} @click=${() => state.setInsightSourcePage(state.insightSourcePage - 1)}>← Prev</button>
          <span class="muted" style="line-height: 32px;">${state.insightSourcePage + 1} / ${Math.ceil(state.insightSourceTotal / state.insightPageSize)}</span>
          <button class="btn btn--sm" ?disabled=${(state.insightSourcePage + 1) * state.insightPageSize >= state.insightSourceTotal} @click=${() => state.setInsightSourcePage(state.insightSourcePage + 1)}>Next →</button>
        </div>
      ` : nothing}
    </section>
  `;
}
