# Wiki Synthesis — Scheduled Task Prompt

**Schedule:** `0 8 * * 0` (weekly, Sunday at 08:00 UTC — 2 hours after lint)

---

## Prompt

```
Generate or update cross-cutting Wiki/Syntheses pages that connect entities and concepts.

STEP 1 — Load conventions
Read /workspace/extra/brain/CLAUDE.md — focus on Wiki/Syntheses format and frontmatter schema.
Read /workspace/extra/brain/log.md to understand recent activity (especially INGEST entries from the past week).

STEP 2 — Gather material
Read all files in:
- Wiki/Entities/ — note which have been recently updated (check `updated` field)
- Wiki/Concepts/ — note themes and connections
- Sources/Briefings/ from the last 7 days
- Sources/Research/ (any new reports)

Also check if existing Wiki/Syntheses/ pages exist and when they were last updated.

STEP 3 — Identify synthesis opportunities
Look for:
a) Entities that share multiple common themes or are frequently co-mentioned across briefings
b) Concepts that have accumulated enough entity connections to warrant a cross-cutting analysis
c) Emerging trends visible across multiple recent briefings (check emerging-themes frontmatter)
d) Gaps: themes that briefings keep raising but have no synthesis page yet
e) Existing syntheses that are outdated and need refreshing based on new information

Prioritize the strongest 1-3 synthesis opportunities. Quality over quantity.

STEP 4 — Create or update syntheses
For each synthesis (1-3 maximum):

a) Check if a matching Wiki/Syntheses/ page already exists
   - If YES: update it with new information, add new sources, update the `updated` date
   - If NO: create a new page following the wiki/synthesis frontmatter template

b) Write substantive analysis (500-1500 words) that:
   - Connects multiple entities and concepts with [[wikilinks]]
   - Draws insights from briefings and research
   - Identifies patterns, trends, or tensions
   - Provides actionable takeaways relevant to Conrad's work

c) Include proper frontmatter with:
   - type: wiki/synthesis
   - tags: wiki, synthesis, plus relevant topic tags
   - sources: wikilinks to all referenced entities, concepts, and briefings
   - created/updated dates

STEP 5 — Update metadata
Update /workspace/extra/brain/index.md with any new synthesis entries.
Append to /workspace/extra/brain/log.md:
"- CREATE: Synthesis {name} — connects {list of entities/concepts}"
or "- UPDATE: Synthesis {name} — refreshed with {description of new info}"

STEP 6 — Git commit and push
cd /workspace/extra/brain
git config user.name "Brain Maintainer"
git config user.email "brain@n8t.dev"
git remote set-url origin "https://${GITHUB_TOKEN}@github.com/cpoepke/brain.git"
git pull --rebase --autostash
git add -A
git commit -m "brain: weekly synthesis $(date -u +%Y-%m-%d)"
git push

STEP 7 — Send summary via send_message
List what was created/updated, which entities and concepts are connected, and any notable insights discovered. Keep it concise but highlight the most interesting connections.
```
