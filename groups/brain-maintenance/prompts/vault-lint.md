# Vault Lint — Scheduled Task Prompt

**Schedule:** `0 6 * * 0` (weekly, Sunday at 06:00 UTC)

---

## Prompt

```
Run the 8 LINT checks on the brain vault and report findings.

STEP 1 — Load conventions
Read /workspace/extra/brain/CLAUDE.md — focus on the LINT section which defines all 8 checks.

STEP 2 — Run each check systematically

*Check 1 — Orphaned pages*
For every .md file in Wiki/ and Sources/, check if any other file contains a [[wikilink]] pointing to it. List files with zero inbound links. Exclude index.md, log.md, CLAUDE.md, and README.md from the check.

*Check 2 — Staleness*
Find Wiki/ and Context/ pages where the `updated` frontmatter field is older than 90 days from today.

*Check 3 — Unsynthesized sources*
Find files in Sources/ (Briefings, Bookmarks, Clippings, Research) that are not referenced by any [[wikilink]] from Wiki/ pages. Group by source type.

*Check 4 — Missing entities*
Scan all Wiki/ and Sources/Briefings/ content for proper nouns (capitalized multi-word terms, tool names, company names). Count occurrences across all files. List any with 3+ mentions that lack their own Wiki/Entities/ page.

*Check 5 — Contradictions*
Read all Wiki/ pages. Flag any cases where two pages make conflicting claims about the same entity, concept, or fact.

*Check 6 — Broken links*
Find all [[wikilinks]] across all .md files. Check that each target file exists. List broken links with their source file.

*Check 7 — Concept decay*
Find Wiki/Concepts/ pages tagged `auto-promoted`. Check if any briefing in the last 30 days references them. Flag those with no recent references for potential archival.

*Check 8 — Entity timeline pruning*
Count ### YYYY-MM-DD sections in each Wiki/Entities/ page. Flag any with 50+ dated sections as candidates for summarization.

STEP 3 — Compile and log findings
Format findings as a structured report with counts per check.
Append to /workspace/extra/brain/log.md:
"- LINT: Weekly audit — {N} orphans, {N} stale, {N} unsynthesized, {N} missing entities, {N} contradictions, {N} broken links, {N} decayed concepts, {N} pruning candidates"

STEP 4 — Git commit if log.md was updated
cd /workspace/extra/brain
git config user.name "Brain Maintainer"
git config user.email "brain@n8t.dev"
git remote set-url origin "https://${GITHUB_TOKEN}@github.com/cpoepke/brain.git"
git pull --rebase --autostash
git add log.md
git commit -m "brain: weekly lint $(date -u +%Y-%m-%d)"
git push

STEP 5 — Send the full lint report via send_message
Format as a checklist with emoji indicators:
- Items needing action
- Items that are informational
Present the most actionable findings first.
Do NOT auto-fix anything — present findings for human review.
```
