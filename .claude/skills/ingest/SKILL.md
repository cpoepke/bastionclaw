---
name: ingest
description: Ingest content (articles, YouTube videos, PDFs, podcasts) and extract insights. Deduplicates against existing insights using semantic search. Use when user shares a URL or file and wants to extract key takeaways. Triggers on "ingest", "extract insights", "analyze this article/video".
---

# Content Ingestion for Insight Tracking

Extract insights from content sources and track them with source attribution. Insights that appear across multiple sources rise to the top.

## Process

### 1. Identify the Source

The user will provide a URL, file path, or paste content directly. Determine the source type:
- **article** — Web articles, blog posts (use firecrawl to fetch)
- **youtube** — YouTube videos (use youtube-full for transcript, OR read local transcript if available)
- **pdf** — PDF documents (read the file)
- **podcast** — Audio transcripts (user provides transcript)
- **other** — Any other content

**Local YouTube transcripts**: If the video already has a local transcript in the workspace at `/workspace/group/youtube/{date}/{channel}/{slug}/`, use those files directly instead of fetching. Check for `transcript.json` (structured with timing) and `metadata/*.json` (title, video_id, link).

### 2. Check if Already Indexed

Call `check_source` with the YouTube URL (e.g., `https://www.youtube.com/watch?v={video_id}`). If it returns `exists: true`, inform the user:
> "This source was already indexed on {date}. Would you like me to re-process it?"

If the user declines, stop. If they want to re-process, continue.

### 3. Fetch the Content

Use the appropriate method based on source type:
- **article**: Use firecrawl to scrape the page
- **youtube (local transcript available)**: Read `transcript.json` from the local workspace path. This file contains an array of `{text, start, duration}` segments with timing in seconds.
- **youtube (no local transcript)**: Use youtube-full to fetch the transcript
- **pdf**: Read the file directly
- **podcast/other**: Ask user to provide the text/transcript

### 4. Extract Insights

Analyze the content and extract **5-20 standalone insights**. Each insight has TWO parts:

#### text (bold thesis) — CRITICAL FOR DEDUP
A **short, generalizable principle** (10-20 words). This is the dedup key — if two different videos express the same idea, their `text` should be nearly identical. Think of it as a bold headline claim.

**Good examples** (abstract, reusable across sources):
- "AI commoditizes execution, making taste and curation the new scarce skills"
- "Context window quality matters more than raw size for coding agents"
- "Skills are the moat — the expert perspective baked in is what separates AI output from slop"

**Bad examples** (too specific to one video, will never match another source):
- "Greg Isenberg's guest James uses Perplexity MCP for market research before prompting"
- "Opus 4.6 achieved 76% retrieval at 1M tokens on NRCV2 benchmark"

#### detail (context paragraph)
2-3 sentences expanding on the thesis with specific context, examples, and nuance from this particular source. This is where the video-specific details live.

#### category
One of: `strategy`, `technical`, `trend`, `principle`, `observation`, `tactic`, or a custom category.

#### context (source quote)
A direct quote from the source (1-3 sentences) that supports this insight.

#### timestamp_ref — CRITICAL for video/audio
The timestamp in `MM:SS` or `HH:MM:SS` format. Use the `start` field from `transcript.json` segments to identify the exact second where this insight is discussed. The timestamp must be precise enough to generate a deep link like `youtube.com/watch?v={id}&t={seconds}`.

#### Timestamp extraction from transcript.json

The transcript.json `transcript` array contains segments like:
```json
{"text": "the key insight is that...", "start": 754.2, "duration": 5.1}
```

When you identify an insight from the transcript text, find the segment(s) where it's discussed and use the `start` value to compute the timestamp:
- `start: 754.2` → `timestamp_ref: "12:34"` (and the deep link second is `754`)
- `start: 3661.0` → `timestamp_ref: "1:01:01"`

### 5. Deduplicate Against Existing Insights

For EACH extracted insight:

1. Call `search_insights` with the insight text
2. Review the results — judge whether any existing insight is **semantically equivalent** (same core idea, possibly different wording)
3. If a match exists with high confidence:
   - Call `link_insight_source` to link the new source to the existing insight
   - Note it as "linked to existing"
4. If no match:
   - Call `add_insight` to create a new insight record
   - Note it as "new"

**Similarity judgment**: Two insights match if they express the same core principle or thesis. The `text` field (bold thesis) is what you compare. Different examples, different speakers, different framings of the same underlying idea all count as a match. Merely related but distinct principles should NOT be merged.

When linking to an existing insight, the `context` and `timestamp_ref` you provide are specific to the NEW source — this is how each source gets its own quote and timestamp while sharing the same abstract insight.

### 6. Report Summary

After processing all insights, send a summary message:

```
Ingested: {source_title}
Type: {source_type}
New insights: X
Linked to existing: Y
Top corroborated insight: "{text}" (now N sources)
```

### 7. Refresh Index

Call `refresh_memory_index` so the new insight markdown files get indexed for future semantic search.

## Source Metadata

When calling `add_insight` or `link_insight_source`, include rich metadata:
- `source_url`: The canonical YouTube URL `https://www.youtube.com/watch?v={video_id}`
- `source_title`: From metadata JSON `title` field
- `source_type`: `youtube`, `article`, `pdf`, `podcast`, or `other`
- `source_metadata`: JSON string with: `{"author": "...", "channel": "...", "video_id": "...", "published": "...", "viewCount": "..."}`
- `context`: The supporting quote from the transcript
- `timestamp_ref`: The `MM:SS` timestamp string (for videos)

## Tips

- When in doubt about whether two insights match, keep them separate. It's better to have near-duplicates than to incorrectly merge distinct ideas.
- Use the `context` field generously — the supporting quote makes insights much more useful later.
- For long content (90+ min videos, lengthy articles), focus on the most impactful and novel insights rather than trying to capture everything.
- For YouTube videos, always include timestamp_ref — this is what enables deep-linking to the exact moment in the video.
