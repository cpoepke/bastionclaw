---
name: youtube-bulk-ingest
description: Bulk ingest YouTube transcripts from the local workspace into the insight tracking system. Scans the youtube/ directory for all videos with transcripts, skips already-indexed ones, and extracts insights with timestamps. Reusable for future batches. Triggers on "youtube bulk ingest", "ingest all videos", "process youtube transcripts", "bulk ingest".
---

# Bulk YouTube Transcript Ingestion

Process all local YouTube transcripts in the workspace and extract insights with timestamp-linked sources. Designed to be run repeatedly — it skips already-indexed videos.

## Directory Structure

Transcripts live at `/workspace/group/youtube/{date}/{channel-handle}/{video-slug}/`:
- `transcript.json` — structured transcript with timing: `{"video_id", "language", "transcript": [{"text", "start", "duration"}]}`
- `transcript.txt` — plain text with `[seconds]` prefix per line
- `metadata/*.json` — video metadata: `{"video_id", "title", "author_name", "published", "viewCount", "link"}`

## Process

### 1. Discover All Videos

Scan `/workspace/group/youtube/` recursively for directories containing `transcript.json`. Build a manifest:

```bash
find /workspace/group/youtube -name "transcript.json" -type f
```

For each transcript.json found, read the corresponding `metadata/*.json` (first .json file in the metadata/ subdirectory) to get the video URL, title, and author.

### 2. Filter to Unindexed Videos

For each video, call `check_source` with the YouTube URL (`https://www.youtube.com/watch?v={video_id}`). Skip any that return `exists: true`.

Report: "Found X total videos, Y already indexed, Z to process."

### 3. Process Each Video

For each unindexed video, follow the same insight extraction process as the `/ingest` skill:

#### a. Read the transcript
Read `transcript.json`. The transcript array contains segments with `text`, `start` (seconds), and `duration`.

Concatenate segments into readable chunks (aim for ~2000-3000 word chunks for long videos). Preserve the `start` timestamp for each chunk boundary so you can reference it later.

#### b. Extract insights
For each video, extract **5-15 insights**. Each insight has TWO parts:

**text** (bold thesis) — SHORT, GENERALIZABLE principle (10-20 words). This is the dedup key. If two different videos from different creators express the same idea, their `text` should be nearly identical. Think headline, not paragraph.

Good: "AI commoditizes execution, making taste and curation the new scarce skills"
Bad: "Greg Isenberg's guest James says you need taste to stand out from AI"

**detail** — 2-3 sentences expanding on the thesis with specific context from this video.

Also provide:
- **category**: `strategy`, `technical`, `trend`, `principle`, `observation`, `tactic`, or custom
- **context**: A direct quote from the transcript (1-3 sentences)
- **timestamp_ref**: The `MM:SS` or `HH:MM:SS` timestamp where this insight is discussed

**Computing timestamp_ref from transcript.json:**
Find the transcript segment(s) where the insight is discussed. Use the `start` field:
- `start: 754.2` → `"12:34"`
- `start: 3661.0` → `"1:01:01"`
- Format: `Math.floor(start/60)` for minutes, `Math.floor(start%60)` for seconds

#### c. Deduplicate
For each insight, call `search_insights` to check for semantic matches. If a similar insight exists (same core thesis), call `link_insight_source` instead of `add_insight`. The abstract `text` field is what you compare — two insights match if they express the same generalizable principle.

#### d. Store with rich metadata
When calling `add_insight` or `link_insight_source`:
- `source_url`: `https://www.youtube.com/watch?v={video_id}`
- `source_title`: From metadata `title`
- `source_type`: `youtube`
- `source_metadata`: JSON string: `{"author_name": "...", "video_id": "...", "published": "...", "viewCount": "...", "channel": "..."}`  (author_name from metadata JSON)
- `context`: The supporting quote
- `timestamp_ref`: The `MM:SS` string

#### e. CRITICAL: Refresh index after each video
After processing all insights for ONE video, call `refresh_memory_index` and wait for it to complete before moving to the next video. This ensures `search_insights` can find insights from previously-processed videos, enabling dedup across the batch.

**Process videos SERIALLY, one at a time.** Do NOT process multiple videos in parallel. The serial + refresh pattern maximizes dedup cache hits.

### 4. Progress Reporting

After every 5 videos processed, send a progress update via `send_message`:
```
Bulk ingest progress: X/Z videos processed (Y new insights, W linked to existing)
```

### 5. Final Summary

After all videos are processed, send a completion message:
```
Bulk YouTube Ingest Complete
Videos processed: X
New insights: Y
Linked to existing: Z
Total insights now: N
Top corroborated insight: "{text}" (K sources)
```

### 6. Refresh Index

Call `refresh_memory_index` at the end so all new insight markdown files get indexed for semantic search.

## Performance Notes

- For very long videos (60+ min), focus on the **10-15 most impactful insights** rather than exhaustively covering everything.
- Process videos from newest to oldest (sort by date directory) so the most recent content is prioritized.
- If a video has no metadata JSON, construct the URL from the `video_id` field in transcript.json.
- Skip directories named `recommended` or `recommended-videos` (these contain original content drafts, not transcripts).

## Running

This skill can be triggered via:
- Telegram: "@Kia bulk ingest youtube transcripts"
- WebUI chat: "bulk ingest youtube"
- Scheduled task: schedule with `context_mode: 'group'` for access to conversation history

It's safe to run repeatedly — already-indexed videos are skipped automatically.
