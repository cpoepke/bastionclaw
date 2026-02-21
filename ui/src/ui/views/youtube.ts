import { html, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import type { BastionClawApp } from '../app.ts';
import { formatAgo } from '../format.ts';
import type { YouTubeVideoData } from '../types.ts';

/** Generate inline SVG sparkline from view count points */
function sparklineSvg(points: number[], direction: string): string {
  if (points.length < 2) return '';
  const w = 80, h = 30, pad = 2;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const coords = points.map((v, i) => {
    const x = pad + (i / (points.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((v - min) / range) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const color = direction === 'accelerating' ? '#22c55e' : direction === 'decelerating' ? '#ef4444' : '#9ca3af';
  return `<svg width="${w}" height="${h}" style="vertical-align:middle;"><polyline points="${coords}" fill="none" stroke="${color}" stroke-width="2"/></svg>`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function sortedVideos(state: BastionClawApp): YouTubeVideoData[] {
  const videos = state.youtubeDashboard?.videos || [];
  const col = state.youtubeSortBy;
  const desc = state.youtubeSortDesc;
  return [...videos].sort((a, b) => {
    let av: number | string, bv: number | string;
    switch (col) {
      case 'title': av = a.title.toLowerCase(); bv = b.title.toLowerCase(); break;
      case 'author': av = a.author.toLowerCase(); bv = b.author.toLowerCase(); break;
      case 'published': av = new Date(a.published).getTime(); bv = new Date(b.published).getTime(); break;
      case 'views': av = a.views; bv = b.views; break;
      case 'duration': av = a.duration ?? 0; bv = b.duration ?? 0; break;
      case 'vph': default: av = a.vph; bv = b.vph; break;
    }
    if (av < bv) return desc ? 1 : -1;
    if (av > bv) return desc ? -1 : 1;
    return 0;
  });
}

function sortIndicator(state: BastionClawApp, col: string): string {
  if (state.youtubeSortBy !== col) return '';
  return state.youtubeSortDesc ? ' \u2193' : ' \u2191';
}

export function renderYouTube(state: BastionClawApp) {
  const dashboard = state.youtubeDashboard;
  const sources = state.youtubeSources;
  const videos = sortedVideos(state);

  return html`
    <!-- Stats overview -->
    <div class="card-grid" style="margin-bottom: 16px;">
      <div class="card">
        <div class="card-title">Videos Tracked</div>
        <div class="stat-value">${dashboard?.videos.length ?? 0}</div>
      </div>
      <div class="card">
        <div class="card-title">Channels</div>
        <div class="stat-value">${sources?.sources.length ?? 0}</div>
      </div>
      <div class="card">
        <div class="card-title">Top VPH</div>
        <div class="stat-value">${dashboard?.videos.length ? formatNumber(dashboard.videos[0]?.vph ?? 0) : '—'}</div>
      </div>
    </div>

    <!-- Channel management (collapsible) -->
    <details class="card" style="margin-bottom: 16px;">
      <summary style="cursor: pointer; font-weight: 600; padding: 12px;">Tracked Channels (${sources?.sources.length ?? 0})</summary>
      <div style="padding: 0 12px 12px;">
        ${sources?.sources.length ? html`
          <div class="chip-row" style="margin-top: 8px; flex-wrap: wrap;">
            ${sources.sources.map((s: any) => {
              const handle = typeof s === 'string' ? s : s.handle;
              return html`
                <span class="chip" style="display: inline-flex; align-items: center; gap: 4px;">
                  ${handle}
                  <button class="btn btn--sm danger" style="padding: 0 4px; min-width: auto; font-size: 10px; line-height: 1;"
                    @click=${() => state.removeYouTubeSource(handle)}>x</button>
                </span>
              `;
            })}
          </div>
        ` : html`<div class="muted" style="margin-top: 8px;">No channels tracked yet.</div>`}
        <div class="row" style="gap: 8px; margin-top: 12px;">
          <input type="text" class="input" placeholder="@ChannelHandle"
            .value=${state.youtubeNewHandle}
            @input=${(e: Event) => { state.youtubeNewHandle = (e.target as HTMLInputElement).value; }}
            @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') state.addYouTubeSource(); }}
            style="max-width: 200px;"
          />
          <button class="btn" @click=${() => state.addYouTubeSource()}>Add Channel</button>
        </div>
        ${sources?.lookbackDays ? html`<div class="muted" style="margin-top: 8px; font-size: 12px;">Lookback: ${sources.lookbackDays} days</div>` : nothing}
      </div>
    </details>

    <!-- Video table -->
    <section class="card">
      <div class="row" style="justify-content: space-between; margin-bottom: 12px;">
        <div>
          <div class="card-title">Video Dashboard</div>
          <div class="card-sub">${videos.length} video${videos.length !== 1 ? 's' : ''} ${dashboard?.lastUpdated ? html`— updated ${formatAgo(new Date(dashboard.lastUpdated).getTime())}` : nothing}</div>
        </div>
        <button class="btn" ?disabled=${state.loading} @click=${() => state.loadYouTube()}>
          ${state.loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      ${videos.length === 0
        ? html`<div class="muted">No videos found. Add channels and run /refresh-insights to fetch data.</div>`
        : html`
          <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
              <thead>
                <tr style="border-bottom: 2px solid var(--border);">
                  <th style="padding: 8px; text-align: left;">Thumb</th>
                  <th style="padding: 8px; text-align: left; cursor: pointer;" @click=${() => state.sortYouTubeBy('title')}>
                    Title${sortIndicator(state, 'title')}
                  </th>
                  <th style="padding: 8px; text-align: left; cursor: pointer;" @click=${() => state.sortYouTubeBy('author')}>
                    Channel${sortIndicator(state, 'author')}
                  </th>
                  <th style="padding: 8px; text-align: left; cursor: pointer;" @click=${() => state.sortYouTubeBy('published')}>
                    Published${sortIndicator(state, 'published')}
                  </th>
                  <th style="padding: 8px; text-align: right; cursor: pointer;" @click=${() => state.sortYouTubeBy('duration')}>
                    Duration${sortIndicator(state, 'duration')}
                  </th>
                  <th style="padding: 8px; text-align: right; cursor: pointer;" @click=${() => state.sortYouTubeBy('views')}>
                    Views${sortIndicator(state, 'views')}
                  </th>
                  <th style="padding: 8px; text-align: right; cursor: pointer;" @click=${() => state.sortYouTubeBy('vph')}>
                    VPH${sortIndicator(state, 'vph')}
                  </th>
                  <th style="padding: 8px; text-align: center;">Trend</th>
                </tr>
              </thead>
              <tbody>
                ${videos.map(v => {
                  const pubDate = new Date(v.published);
                  const pubStr = pubDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + pubDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                  return html`
                    <tr style="border-bottom: 1px solid var(--border);">
                      <td style="padding: 8px;">
                        <a href=${v.link} target="_blank" rel="noopener">
                          <img src=${v.thumbnail} width="100" style="border-radius: 4px; display: block;" alt="" loading="lazy" />
                        </a>
                      </td>
                      <td style="padding: 8px; max-width: 300px;">
                        <a href=${v.link} target="_blank" rel="noopener" style="color: var(--accent); text-decoration: none; font-weight: 500;">
                          ${v.title}
                        </a>
                      </td>
                      <td style="padding: 8px;" class="muted">${v.author}</td>
                      <td style="padding: 8px; white-space: nowrap;" class="muted">${pubStr}</td>
                      <td style="padding: 8px; text-align: right; font-variant-numeric: tabular-nums;">${formatDuration(v.duration)}</td>
                      <td style="padding: 8px; text-align: right; font-variant-numeric: tabular-nums;">${formatNumber(v.views)}</td>
                      <td style="padding: 8px; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums;">${formatNumber(v.vph)}</td>
                      <td style="padding: 8px; text-align: center;">
                        ${unsafeHTML(sparklineSvg(v.sparklinePoints, v.trendDirection))}
                        <br><small class="muted">${v.snapshotCount} pts</small>
                      </td>
                    </tr>
                  `;
                })}
              </tbody>
            </table>
          </div>
        `
      }
    </section>
  `;
}
