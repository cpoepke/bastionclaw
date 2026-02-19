# Memory System

NanoClaw uses [qmd](https://github.com/tobi/qmd) for persistent semantic memory — a local hybrid search engine that runs entirely on-device with no cloud dependencies.

## Why qmd

Most RAG systems require external services (Pinecone, Weaviate, OpenAI embeddings API). qmd runs fully local using GGUF models on Apple Silicon (Metal) or CPU, keeping all data private. It combines three search strategies in a single tool, which matters because no single approach works for all queries:

- **BM25 keyword search** finds exact terms fast (e.g., "Allen's API key rotation schedule")
- **Vector semantic search** finds conceptually related content even with different wording (e.g., "security concerns" matches a document about "vulnerability assessment")
- **LLM reranking** rescores the top candidates using a small language model, dramatically improving relevance for ambiguous queries

qmd's hybrid search (`query` command) fuses all three into a single pipeline, consistently outperforming any individual approach.

## How Hybrid Search Works

When the agent calls `memory_hybrid_search`, qmd executes a multi-stage pipeline:

1. **Query expansion** — A small LLM generates alternative phrasings of the query (skipped if BM25 already has a strong signal)
2. **Parallel retrieval** — Each query variant searches both the FTS5 (BM25) index and the vector index simultaneously
3. **RRF fusion** — Reciprocal Rank Fusion merges the ranked lists from both retrieval methods
4. **LLM reranking** — A reranker model scores the top 30 candidates on a 0-10 scale
5. **Score blending** — Final ranking combines retrieval position with reranker scores

This takes 2-5 seconds on Apple Silicon with Metal acceleration. Keyword-only search (`memory_search`) returns in <100ms.

## Architecture

qmd runs on the **host** (not in the container). The models require ~2GB RAM and benefit from Metal GPU acceleration — resources unavailable in the 512MB container.

### Why IPC Files Instead of HTTP

The container agent communicates with qmd through the **same filesystem-based IPC** used for all other host communication (sending messages, scheduling tasks, etc.). No HTTP networking is needed.

We chose IPC files over HTTP MCP because:

- **Works identically on Apple Containers and Docker** — Apple Containers don't support `host.containers.internal`, and qmd binds to localhost only. Docker uses `host.docker.internal`. IPC files avoid all container networking complexity.
- **No new attack surface** — HTTP would expose a port that any process on the network could reach. File-based IPC is scoped to the mounted volume.
- **Consistent with existing patterns** — The nanoclaw MCP server already uses stdio + IPC files. Adding a second communication channel would complicate the architecture for no benefit.
- **Acceptable latency** — The host polls IPC every 1 second. Combined with qmd search time (2-5s for hybrid), the ~1s IPC overhead is negligible.

```
Host (macOS / Linux)                  Container (Linux VM)
+-----------------------+             +------------------------+
|  qmd daemon (:8181)   |             |  Claude Agent SDK      |
|  - BM25 index         |             |  - nanoclaw MCP        |
|  - Vector embeddings  |             |    (stdio server)      |
|  - GGUF models        |             |                        |
|                       |  IPC files  |  /workspace/ipc/       |
|  IPC watcher          |<----------->|    +-- tasks/           |
|  (polls tasks/)       |  (shared fs)|    +-- responses/      |
|                       |             |                        |
|  File watcher         |             |  /workspace/group/     |
|  (groups/*.md)        |             |    +-- conversations/  |
+-----------------------+             |    +-- CLAUDE.md       |
                                      +------------------------+
```

### IPC Request-Response Flow

1. Container's MCP tool writes a JSON request to `/workspace/ipc/tasks/` with a unique `requestId`
2. Host's IPC watcher picks up the file, executes `qmd search/vsearch/query/get`
3. Host writes the result to `/workspace/ipc/responses/{requestId}.json`
4. Container polls for the response file (100ms intervals, 30s timeout)
5. Container returns the result to the agent

## Progressive Conversation Indexing

Conversations become searchable **during the session**, not just at compaction time. This is critical for long-running sessions where the agent needs to recall something discussed earlier.

### How It Works

1. **After each agent turn**: The agent-runner captures all user and assistant messages from the SDK stream. After each query result, it exports a markdown snapshot to `conversations/session-{id}.md`.

2. **File watcher detects the change**: The host's qmd file watcher sees the updated `.md` file and schedules a `qmd embed` (15-second debounce, 60-second max delay).

3. **Content becomes searchable**: Within ~20 seconds of the agent responding, the conversation is indexed and searchable by the agent or other sessions.

4. **At compaction**: The PreCompact hook archives the full transcript with a descriptive filename (e.g., `2026-02-18-weather-discussion.md`). The live session snapshot can be cleaned up.

### What Gets Indexed

| Source | When Indexed | Content |
|--------|-------------|---------|
| `groups/{name}/CLAUDE.md` | On boot + file changes | Per-group instructions and context |
| `groups/{name}/conversations/*.md` | Progressive + PreCompact | Conversation transcripts |
| `groups/{name}/*.md` | File changes | Notes, preferences, structured data |
| `groups/global/CLAUDE.md` | On boot + file changes | Shared global memory |

### File Formats

Only **markdown files** (`*.md`) are indexed. PDFs, PPTX, images, and other formats are not supported by qmd. To make non-markdown content searchable, the agent can convert it to markdown first.

## Memory Tools

All memory tools are served by the nanoclaw MCP server (stdio, no networking):

| Tool | qmd Command | Use Case |
|------|-------------|----------|
| `memory_hybrid_search` | `query` | Default search — best quality (BM25 + vector + reranking) |
| `memory_search` | `search` | Fast keyword search when you know exact terms |
| `memory_semantic_search` | `vsearch` | Semantic similarity when keywords miss the intent |
| `memory_get` | `get` | Retrieve a specific document by ID or path |
| `refresh_memory_index` | `embed` | Force re-index after writing important files |

## Models

qmd uses three GGUF models (~2GB total), auto-downloaded on first use to `~/.cache/qmd/models/`:

| Model | Size | Purpose |
|-------|------|---------|
| `embedding-gemma-300M-Q8_0` | ~300MB | Vector embeddings (Metal-accelerated) |
| `qwen3-reranker-0.6b-q8_0` | ~640MB | Reranking candidates |
| `qmd-query-expansion-1.7B-q4_k_m` | ~1.3GB | Query expansion/rephrasing |

Models download on first use during `scripts/qmd-start.sh` (includes a warmup step). Subsequent starts are instant. Models load once on daemon start and persist across container restarts.

## Automatic File Watcher

The host watches `groups/` recursively for `.md` file changes:

- **Debounce**: 15 seconds after last change before triggering embed
- **Max delay**: 60 seconds — ensures embed fires even during sustained writes
- **Concurrent guard**: Only one embed runs at a time; changes during embed are queued
- **Skips**: Log files (`/logs/`) and non-markdown files are ignored

## WebUI Dashboard

The Memory tab in the web control panel (port 3100) shows:

- **Index status**: Total documents, vectors, collections, index size, daemon PID
- **Collections**: Name, file count, path for each registered group
- **Search test**: Interactive search from the browser (keyword / semantic / hybrid modes) with relevance scores

The WebUI search endpoint calls qmd directly on the host (not through IPC), since the web server runs on the host.

## Installation

qmd is installed as a project dependency — `npm install` handles it. No global installation needed.

```bash
npm install                    # Installs qmd as a local dependency
./scripts/qmd-start.sh        # Register collections, embed, start daemon
./scripts/restart.sh --build   # Full rebuild (includes qmd lifecycle)
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| qmd not responding | `qmd status` to check, `qmd mcp stop && scripts/qmd-start.sh` to restart |
| Stale index | `qmd embed -f` to force full re-embed |
| Search timeout (30s) | Check if qmd daemon is running (`qmd status`) |
| Missing conversations | Check container stderr for PreCompact hook errors |
| First search slow | Models download on first use (~2GB); `qmd-start.sh` warms up on boot |
