---
name: gamma-slides
description: Generate presentation slide decks from markdown content using the Gamma API. Use when user says "create slides", "make a presentation", "build a deck", "generate a slide deck", or asks to turn content into slides. Run with /gamma-slides.
model: haiku
context: fork
allowed-tools: Bash(python3 .claude/skills/gamma-slides/scripts/*)
user-invocable: true
---

# Gamma Slides

Generate presentations from markdown content via the Gamma API.

## Objective

Take markdown content (outline, notes, or structured text) and produce a polished slide deck using Gamma's AI presentation engine. Returns a live URL to the presentation.

## Inputs Required

- Markdown content for the presentation (outline, notes, or full text)
- GAMMA_API_KEY environment variable

## Execution Steps

### Step 1: Prepare Content

Structure the input as markdown with clear slide breaks:

```markdown
# Presentation Title

## Slide 1: Opening Hook
Key point or question to grab attention

## Slide 2: The Problem
- Pain point 1
- Pain point 2
- Why this matters

## Slide 3: The Solution
...
```

If the user provides rough notes, structure them into slides first.

### Step 2: Generate Presentation

```bash
python3 .claude/skills/gamma-slides/scripts/create_presentation.py --content content.md
```

**Process:**
1. Sends markdown to Gamma API
2. Gamma generates slides with professional design
3. Script polls for completion (can take 30-90 seconds)
4. Returns the live presentation URL

**Output**: JSON with `url` (live Gamma link), `id` (presentation ID), `title`

### Step 3: Present Results

Return the Gamma URL to the user. The presentation is:
- Immediately viewable and shareable
- Editable in Gamma's web editor
- Exportable to PDF or PowerPoint

## Edge Cases

- **Content too long**: Break into sections, suggest splitting into multiple decks
- **Gamma API timeout**: Retry once after 30 seconds
- **No GAMMA_API_KEY**: Tell user to add it to .env and point to docs
- **Content too short**: Suggest adding more substance before generating

## Environment Variables Required

```bash
GAMMA_API_KEY=     # Get from gamma.app
```

## Tips for Good Slides

- One key idea per slide
- Use bullet points, not paragraphs
- Include a clear hook/opening and strong close
- 8-15 slides is the sweet spot for most presentations
- Let Gamma handle the design — focus on content quality
