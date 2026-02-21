import { html, nothing } from 'lit';
import type { BastionClawApp } from '../app.ts';

export function renderMemory(state: BastionClawApp) {
  const m = state.memory;
  if (!m) return html`<div class="muted">Loading...</div>`;

  if (m.error) {
    return html`
      <div class="callout danger">
        <strong>qmd not available</strong>: ${m.message || m.error}
        <div style="margin-top: 8px; font-size: 13px;">
          Install with: <code>npm install</code> then <code>bash scripts/qmd-start.sh</code>
        </div>
      </div>
    `;
  }

  const collections = m.collections || [];
  const searchResults = state.memorySearchResults;

  return html`
    <section class="grid grid-cols-2">
      <div class="card">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="card-title">Index Status</div>
            <div class="card-sub">qmd memory search engine.</div>
          </div>
          <button class="btn" ?disabled=${state.loading} @click=${() => state.loadMemory()}>
            ${state.loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        <div class="status-list" style="margin-top: 16px;">
          <div><span class="label">Documents</span><span>${m.totalDocuments ?? '—'}</span></div>
          <div><span class="label">Vectors</span><span>${m.totalVectors ?? '—'}</span></div>
          <div><span class="label">Collections</span><span>${collections.length}</span></div>
          <div><span class="label">Index Size</span><span>${m.indexSize ?? '—'}</span></div>
          <div>
            <span class="label">MCP Daemon</span>
            <span class="pill">
              <span class="statusDot ${m.mcpStatus === 'running' ? 'ok' : ''}"></span>
              ${m.mcpStatus ?? 'unknown'}${m.mcpPid ? ` (PID ${m.mcpPid})` : ''}
            </span>
          </div>
          ${m.lastUpdated ? html`<div><span class="label">Last Updated</span><span>${m.lastUpdated}</span></div>` : nothing}
        </div>
      </div>

      <div class="card">
        <div class="card-title">Collections</div>
        <div class="card-sub">Registered group directories.</div>
        ${collections.length === 0
          ? html`<div class="muted" style="margin-top: 12px;">No collections registered.</div>`
          : html`
            <div class="table-wrap" style="margin-top: 12px;">
              <table>
                <thead><tr><th>Name</th><th>Files</th><th>Path</th></tr></thead>
                <tbody>
                  ${collections.map((c) => html`
                    <tr>
                      <td><strong>${c.name}</strong></td>
                      <td>${c.fileCount}</td>
                      <td class="mono" style="font-size: 12px;">${c.path}</td>
                    </tr>
                  `)}
                </tbody>
              </table>
            </div>
          `
        }
      </div>
    </section>

    <section class="card">
      <div class="card-title">Search Test</div>
      <div class="card-sub">Test memory search from the dashboard.</div>
      <div class="row" style="margin-top: 12px; gap: 8px;">
        <input
          type="text"
          class="input"
          style="flex: 1;"
          placeholder="Search query..."
          .value=${state.memorySearchQuery}
          @input=${(e: Event) => { state.memorySearchQuery = (e.target as HTMLInputElement).value; }}
          @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') state.searchMemory(); }}
        />
        <select
          class="input"
          style="width: auto;"
          .value=${state.memorySearchMode}
          @change=${(e: Event) => { state.memorySearchMode = (e.target as HTMLSelectElement).value; }}
        >
          <option value="keyword">Keyword (BM25)</option>
          <option value="semantic">Semantic</option>
          <option value="hybrid">Hybrid</option>
        </select>
        <button class="btn" @click=${() => state.searchMemory()}>Search</button>
      </div>

      ${searchResults?.error ? html`
        <div class="callout danger" style="margin-top: 12px;">${searchResults.error}</div>
      ` : nothing}

      ${searchResults?.results && searchResults.results.length > 0 ? html`
        <div class="table-wrap" style="margin-top: 12px;">
          <table>
            <thead><tr><th>Score</th><th>File</th><th>Snippet</th></tr></thead>
            <tbody>
              ${searchResults.results.map((r) => html`
                <tr>
                  <td class="mono">${typeof r.score === 'number' ? (r.score * 100).toFixed(0) + '%' : '—'}</td>
                  <td class="mono" style="font-size: 12px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${r.file}</td>
                  <td style="font-size: 13px; max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${r.snippet?.split('\n').slice(0, 2).join(' ')}</td>
                </tr>
              `)}
            </tbody>
          </table>
        </div>
      ` : nothing}

      ${searchResults?.results && searchResults.results.length === 0 ? html`
        <div class="muted" style="margin-top: 12px;">No results found.</div>
      ` : nothing}
    </section>
  `;
}
