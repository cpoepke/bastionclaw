# Briefing Ingest — Scheduled Task Prompt

**Schedule:** `0 4 * * *` (daily at 04:00 UTC, 1 hour after atlas-morning-briefing)

---

## Prompt

```
Process new daily briefings into the brain's Wiki layer.

STEP 1 — Load conventions
Read /workspace/extra/brain/CLAUDE.md. Pay close attention to:
- INGEST operation steps
- Wiki entity/concept frontmatter schemas
- Naming conventions
- Update protocol (update frontmatter dates, index.md, log.md)

STEP 2 — Find unprocessed briefings
Read /workspace/extra/brain/log.md to see which briefings have already been processed (look for "INGEST: Processed" entries mentioning briefing filenames).
List all files in /workspace/extra/brain/Sources/Briefings/ recursively.
Any briefing file NOT mentioned in a log.md INGEST entry is unprocessed.
If no unprocessed briefings exist, send a message "No new briefings to process" and exit.

STEP 3 — Process each unprocessed briefing (oldest first)
For each briefing:

a) Read the full briefing content.

b) Extract key information:
   - Entity mentions: tools, companies, people, services, frameworks mentioned
   - Emerging themes and concepts from the frontmatter and body
   - Notable findings, papers, blog posts

c) For each entity mentioned:
   - Check if a Wiki/Entities/ page exists for it
   - If YES: add a dated section (### YYYY-MM-DD) with a 2-3 sentence summary of what the briefing says about this entity. Add the briefing as a source in frontmatter. Update the `updated` date.
   - If NO: count how many times this entity has been mentioned across ALL briefings (not just this one). If 3 or more total mentions, create a new Entity page following the wiki/entity frontmatter template from CLAUDE.md. If under 3, skip but note the count.

d) For emerging themes in the briefing frontmatter:
   - Check if matching Wiki/Concepts/ pages exist
   - If YES: update them with new information from this briefing
   - If NO: create a new Concept page if the theme is substantive (mentioned in 2+ briefings or described in detail)

e) Add wikilinks between the briefing and any updated/created wiki pages.

STEP 4 — Update metadata
- Update /workspace/extra/brain/index.md with any new file entries (under the appropriate section)
- Append to /workspace/extra/brain/log.md with today's date:
  "- INGEST: Processed {briefing-filename} — updated {N} entities ({names}), created {N} new ({names})"

STEP 5 — Git commit and push
cd /workspace/extra/brain
git config user.name "Brain Maintainer"
git config user.email "brain@n8t.dev"
git remote set-url origin "https://${GITHUB_TOKEN}@github.com/cpoepke/brain.git"
git pull --rebase --autostash
git add -A
git commit -m "brain: ingest briefing(s) $(date -u +%Y-%m-%d)"
git push

STEP 6 — Report results
Send a summary message listing:
- Which briefings were processed
- Which entities were updated (with counts)
- Which new entities/concepts were created
- Any entities approaching the 3-mention threshold (2 mentions)
```
