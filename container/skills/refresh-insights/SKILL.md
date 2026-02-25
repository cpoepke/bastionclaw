---
name: refresh-insights
description: Run the YouTube insight refresh pipeline — fetch transcripts from tracked channels, extract insights, and deduplicate. Use when scheduled or when asked to refresh insights.
allowed-tools: Bash(*), Read, Write, Edit, Glob, Grep, mcp__bastionclaw__*
---

# Refresh Insights Pipeline

Run the full insight extraction pipeline: fetch transcripts → extract insights → deduplicate.

## Step 1: Load Sources

Read the channel list and lookback period:

```bash
cat /workspace/project/.claude/skills/youtube-planner/sources.json
```

This file contains:
- `sources`: array of YouTube @handles to fetch
- `lookback_days`: how many days of videos to pull

If the file doesn't exist or is empty, report the error via `send_message` and stop.

## Step 2: Fetch Transcripts

For each channel in sources, fetch recent videos:

```bash
python3 /workspace/project/.claude/skills/youtube-planner/catch-up-channel.py @CHANNEL LOOKBACK_DAYS
```

`TRANSCRIPT_API_KEY` must be in the environment (passed via container secrets).

After all channels are fetched, update `lookback_days` to `1` so future runs only pull the last day:

```bash
# Copy to writable location, modify, copy back
cp /workspace/project/.claude/skills/youtube-planner/sources.json /workspace/group/sources.json
# Edit lookback_days to 1 in /workspace/group/sources.json
cp /workspace/group/sources.json /workspace/project/.claude/skills/youtube-planner/sources.json
```

If the write back fails (read-only filesystem), skip it — non-critical.

## Step 3: Extract Insights

Find all new `transcript.json` files not yet indexed in `insight_sources`. For each one:

1. **Check duration**: read the transcript JSON, get the last segment's start time. If < 120 seconds, **SKIP** it (it's a YouTube Short).
2. **Read the FULL transcript** — every word, do not skim or summarize.
3. **Extract insights** using the `add_insight` MCP tool. Pass `source_metadata` as a JSON string with `author`, `published`, `viewCount`, `videoId`.
4. **MINIMUM 10 insights per video.** Target 10-15. This is a hard requirement. Each insight must be a distinct, actionable takeaway — not filler.
5. After extracting, **count** your insights. If fewer than 10, re-read the transcript and extract more until you reach at least 10.
6. Do **NOT** call `search_insights` or `link_insight_source`.

## Step 4: Deduplicate

Call the `dedup_insights` MCP tool and **WAIT** for it to return. The response contains an `output` field with the exact merge count and remaining insight count. Parse these numbers — do not paraphrase or guess.

## Step 5: Report Results

Send a summary via `send_message` that **MUST** include ALL of these:

- Channels fetched (count)
- New videos found vs already indexed
- Per-video: channel name, title, duration, insight count (must be >= 10 each)
- Total new insights extracted
- Shorts skipped (count)
- Dedup: exact merge count, source links moved, and total insights remaining — copy directly from the `dedup_insights` response
- Do **NOT** use vague language like "flagged for review" or "completed successfully" — report actual numbers
