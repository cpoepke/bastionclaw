---
allowed-tools: Bash(*), Read, Edit, Write, Glob, Grep
description: Refresh the insight pipeline — manage YouTube sources, fetch transcripts, extract insights, and set up automated cron scheduling.
---

# Refresh Insights Pipeline

Interactive command to manage YouTube sources and run the full insight extraction pipeline.

## Step 0: Validate API Keys

Check that required API keys are available in `.env`:

```bash
grep -c 'TRANSCRIPT_API_KEY' .env 2>/dev/null
```

If `TRANSCRIPT_API_KEY` is not in `.env`, tell the user:
> TRANSCRIPT_API_KEY is required for fetching YouTube transcripts via TranscriptAPI.
> Add it to `.env`

Do not proceed until the key is confirmed.

## Step 1: Check Existing Configuration

Read sources.json to see if this has been configured before:

```bash
cat .claude/skills/youtube-planner/sources.json 2>/dev/null
```

Also check if a cron task is already scheduled in BastionClaw:

```bash
sqlite3 store/messages.db "SELECT id, schedule_value, status FROM scheduled_tasks WHERE id LIKE 'refresh-insights%' AND schedule_type = 'cron'"
```

### If sources.json EXISTS AND has lookback_days AND cron task exists (subsequent run):

Show a summary of current config:
- Number of channels and their handles
- Current lookback_days setting
- Current cron schedule

Then ask a SINGLE question: "Run pipeline with these settings?"
1. **Run now** — Proceed immediately to Step 4 (run pipeline).
2. **Modify sources** — Go to Step 2 (source management only).
3. **Reconfigure everything** — Go through Steps 2-3 for full setup.

### If sources.json does NOT exist OR is missing lookback_days OR no cron task (first run):

Proceed through Steps 2-3 below for full setup.

## Step 2: Source Management

### If sources.json does NOT exist:

Ask the user with 2 options:
1. **Search YouTube** — Ask for a search term, then ask how many channels to pull (default 10, advise that more channels = longer processing time). Use the youtube-full skill to search YouTube, extract the top N channel handles, and save them to sources.json.
2. **Provide channels manually** — Ask for a comma-separated list of @handles (e.g. `@ColeMedin, @GregIsenberg, @rasmic`). Save to sources.json.

### If sources.json EXISTS:

Show the current sources count and list, then ask the user:
1. **Use existing sources** — Proceed with current channels.
2. **Add channels via search** — Search term → ask how many channels (default 10) → find top N channels → add to existing sources.json (dedup against existing).
3. **Add channels manually** — Comma-separated @handles → add to existing sources.json (dedup against existing).

### Configure Lookback Period

Ask the user: "How many days of videos should we pull?" with options:
- **Last 7 days** (Recommended for routine refreshes)
- **Last 14 days**
- **Last 30 days** (Recommended for first run)
- **Custom number of days**

Save the chosen value as `lookback_days` in sources.json.

**Important**: Advise the user that more channels and more days = significantly longer processing time. For example, 14 channels x 30 days could mean 100+ videos to process, each taking ~2 minutes for insight extraction.

When saving sources.json, use this format:
```json
{
  "sources": ["@handle1", "@handle2", ...],
  "lookback_days": 7
}
```

## Step 3: Configure Cron Schedule

Check if a refresh-insights cron task already exists:
```bash
sqlite3 store/messages.db "SELECT id, schedule_value, status FROM scheduled_tasks WHERE id LIKE 'refresh-insights%' AND schedule_type = 'cron'"
```

If already exists, show the current schedule and ask if they want to keep it or change it.

If not installed, ask: "How frequently should this pipeline run automatically?" with options:
- **Every 6 hours** (`0 */6 * * *`)
- **Every 8 hours** (`0 */8 * * *`)
- **Every 12 hours** (`0 0,12 * * *`) — midnight and noon local time
- **Skip** (no cron, manual only)
- **Custom** (user provides cron expression)

Note: BastionClaw's task scheduler interprets cron expressions in local timezone (auto-adjusts for DST).

Install as a BastionClaw scheduled task. The agent has read-only access to the project root at `/workspace/project/` and read-write access to `/workspace/group/`. Look up the main group's chat_jid from the DB before inserting:

```bash
CHAT_JID=$(sqlite3 store/messages.db "SELECT jid FROM registered_groups WHERE folder = 'main' LIMIT 1")
sqlite3 store/messages.db "INSERT OR REPLACE INTO scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, next_run, status, created_at, context_mode) VALUES (
  'refresh-insights-cron',
  'main',
  '$CHAT_JID',
  'Run the insight refresh pipeline. Execute these steps in order:

1. Read /workspace/project/.claude/skills/youtube-planner/sources.json for the channel list and lookback_days.
2. For each channel, run: python3 /workspace/project/.claude/skills/youtube-planner/catch-up-channel.py @CHANNEL lookback_days
   (pass TRANSCRIPT_API_KEY from environment)
3. IMMEDIATELY after all channels are fetched, update sources.json to set lookback_days to 1 (so future runs only pull the last day of videos). If the write fails because the filesystem is read-only, skip this step — it is non-critical.
4. Find all new transcript.json files that are not yet indexed in insight_sources. For each one:
   - Check duration: read the transcript JSON, get the last segment start time. If < 120 seconds, SKIP it (it is a Short).
   - Read the metadata and transcript
   - You MUST extract at least 10 insights per video (target 10-15). Do NOT reduce this number for efficiency or any other reason. Each insight should be a distinct, actionable takeaway.
   - Use add_insight for each (pass source_metadata as JSON string with author, published, viewCount, videoId)
   - Do NOT call search_insights or link_insight_source
5. Run dedup using the dedup_insights MCP tool (do NOT run the python script directly — the DB is read-only in the container)
6. Send a summary via send_message: channels fetched, new transcripts, insights extracted, shorts skipped, dedup merges.',
  'cron',
  'SELECTED_CRON',
  NULL,
  'active',
  datetime('now'),
  'group'
)"
```

Replace `SELECTED_CRON` with the user's chosen cron expression (e.g. `0 0,12 * * *`).

Verify:
```bash
sqlite3 store/messages.db "SELECT id, schedule_value, status FROM scheduled_tasks WHERE id = 'refresh-insights-cron'"
```

## Step 4: Run Pipeline Immediately

Run the pipeline with env vars from .env:

```bash
export $(grep -v '^#' .env | xargs) && python3 scripts/refresh-insights.py
```

Stream output to the user. This may take a while depending on the number of channels and lookback period.

## Monitoring In-Progress Pipeline (Container Agent)

When the refresh-insights pipeline runs as a scheduled task inside a container, use these commands to check progress:

```bash
# 1. Is the container running?
RUNTIME=$(command -v container &>/dev/null && echo "container" || echo "docker")
$RUNTIME list 2>/dev/null || $RUNTIME ps 2>/dev/null

# 2. Check processes inside (look for 'claude' agent)
$RUNTIME exec bastionclaw-main-{timestamp} ps aux

# 3. Check new sources indexed since pipeline started
sqlite3 store/messages.db \
  "SELECT title, indexed_at FROM insight_sources WHERE indexed_at >= 'START_TIMESTAMP' ORDER BY indexed_at DESC"

# 4. Check new insights extracted since pipeline started
sqlite3 store/messages.db \
  "SELECT substr(text,1,80), category, first_seen FROM insights WHERE first_seen >= 'START_TIMESTAMP' ORDER BY first_seen DESC LIMIT 20"

# 5. Check task run logs after completion
sqlite3 store/messages.db \
  "SELECT run_at, duration_ms, status, substr(result,1,200) FROM task_run_logs WHERE task_id = 'refresh-insights-cron' ORDER BY run_at DESC LIMIT 3"
```

Replace `{timestamp}` with the container name from step 1, and `START_TIMESTAMP` with the ISO timestamp when the task started (visible in `logs/bastionclaw.log`).

## Step 5: Show Results

After the pipeline completes:

1. Show the log summary:
```bash
tail -20 /tmp/refresh-insights.log
```

2. Show insight stats:
```bash
curl -s http://localhost:3100/api/insights/stats | python3 -m json.tool
```

3. Point user to WebUI: http://localhost:3100 (Insights tab and YouTube tab).
