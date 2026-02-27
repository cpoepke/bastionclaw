---
name: generate-image
description: Generate images using Gemini via scripts/generate-image.js. Creates technical diagrams, architecture visuals, blog headers, and branded graphics. Use when the user asks to "create an image", "generate a diagram", "make a visual", or "create a graphic". Triggers on "generate image", "create image", "make diagram", "create visual", "architecture diagram".
---

# Image Generation Skill

Generate images using Gemini's image model via `scripts/generate-image.js`. Specializes in technical architecture diagrams, pipeline visuals, blog headers, and branded project graphics.

## Usage

First, resolve the script path (it may be in different locations depending on environment):

```bash
GEN_IMG=$(test -f scripts/generate-image.js && echo scripts/generate-image.js || test -f /workspace/group/scripts/generate-image.js && echo /workspace/group/scripts/generate-image.js || echo /workspace/project/scripts/generate-image.js)
```

```bash
# Generate a new image
node "$GEN_IMG" "<prompt>" "<output-path>" [--aspect-ratio 16:9]

# Edit an existing image
node "$GEN_IMG" "<edit prompt>" "<output-path>" --input <source-image> [--aspect-ratio 16:9]
```

Requires `GEMINI_API_KEY` environment variable (passed via container env, not .env file).

## Image Editing

Pass `--input` / `-i` with a path to an existing image to edit it instead of generating from scratch. The prompt should describe only the desired change — Gemini will preserve the rest of the image.

Good edit prompts:
- "Change the background color to blue"
- "Add a crown to the lobster"
- "Remove the text in the bottom right corner"
- "Make the arrows thicker and brighter"

Bad edit prompts (too vague or re-describe the whole image):
- "A diagram with boxes and arrows" — this regenerates rather than edits
- "Make it better" — too vague for targeted edits

## Aspect Ratios

| Ratio | Use Case |
|-------|----------|
| `16:9` | Architecture diagrams, pipeline flows, blog banners |
| `1:1` | Logos, icons, social media avatars |
| `4:3` | Documentation images, screenshots |
| `9:16` | Mobile/story format |
| `3:4` | Portrait format |
| `4:1` | Ultra-wide panoramic banners |
| `1:4` | Tall vertical infographics |
| `8:1` | Extreme panoramic strips |
| `1:8` | Extreme vertical strips |

Default to `16:9` for technical diagrams. Ask the user if unclear.

## Project Visual Style

All project diagrams use a **whiteboard sketch style** — hand-drawn feel with colorful markers on a white/off-white background, like a real brainstorming session.

### Background
- White or off-white background like a real whiteboard
- Subtle marker texture / dry-erase feel

### Color Palette (marker colors)
| Color | Role |
|-------|------|
| Blue | Messaging channels, data sources, entry points |
| Orange / Red | Orchestration, danger, warnings, attack flows |
| Purple | AI/agent components, processing, databases |
| Green | Containers, active processes, security, safe elements |
| Red | Destructive operations, vulnerabilities, blocked items |
| Yellow | API endpoints, web services, highlights |
| Cyan / Teal | Indexes, search, semantic operations |
| Black | Text, arrows, annotations, connections |

### Drawing Style
- Hand-sketched boxes with slightly imperfect lines and rounded corners
- Hand-drawn arrows with slight curves and imperfections
- Text that looks like handwritten marker in different colors
- Small doodles, asterisks, underlines, and emphasis marks
- Exclamation marks or stars next to key features
- Lock icons near security features
- Cloud shapes around AI components
- Annotations that look like whiteboard notes with arrows
- Circled keywords and underlined important terms

### Layout
- Left-to-right or top-to-bottom flow
- Clear stage/step numbering when applicable
- Annotations and callout notes in margins (like a real whiteboard)
- Title in large bold marker text at the top

## Whiteboard Background

All whiteboard-style diagrams use a pre-made background image as the canvas. Resolve the path — use the first one that exists:

```bash
WB=$(test -f ~/.claude/skills/generate-image/whiteboard-background.png && echo ~/.claude/skills/generate-image/whiteboard-background.png || test -f docs/whiteboard-background.png && echo docs/whiteboard-background.png || echo "")
```

If `$WB` is not empty, use `--input "$WB"` for all whiteboard diagrams. If empty, generate without `--input` (the prompt will create its own background).

## Prompt Construction

When the user asks for a diagram, build the prompt by combining:

1. **Style preamble** (always include):
   ```
   Draw a hand-sketched technical diagram on this whiteboard using colorful markers. Use a hand-sketched marker style with slightly imperfect lines, hand-drawn arrows with natural curves, and handwritten-looking text in colorful markers. Add small doodles, asterisks, underlines, and emphasis marks like a real whiteboard brainstorming session. Include annotations with arrows, circled keywords, and exclamation marks near key features. Keep the whiteboard background texture visible.
   ```

2. **Color assignments** — map each component type to the marker palette above based on its role

3. **Content** — the specific boxes, labels, arrows, and relationships the user wants

4. **Layout instruction**:
   ```
   Keep it readable but energetic — like a whiteboard sketch from a team planning session. Use hand-drawn arrows between stages. Add small annotation notes in the margins for key insights.
   ```

### Example: Architecture Diagram

```bash
# Resolve paths first
GEN_IMG=$(test -f scripts/generate-image.js && echo scripts/generate-image.js || test -f /workspace/group/scripts/generate-image.js && echo /workspace/group/scripts/generate-image.js || echo /workspace/project/scripts/generate-image.js)
WB=$(test -f ~/.claude/skills/generate-image/whiteboard-background.png && echo ~/.claude/skills/generate-image/whiteboard-background.png || test -f docs/whiteboard-background.png && echo docs/whiteboard-background.png || echo "")

node "$GEN_IMG" "Draw a hand-sketched technical diagram on this whiteboard using colorful markers. Use a hand-sketched marker style with slightly imperfect lines, hand-drawn arrows with natural curves, and handwritten-looking text in colorful markers. Add small doodles, asterisks, underlines, and emphasis marks like a real whiteboard brainstorming session.

Color markers: blue for channels, orange for orchestration, purple for AI components, green for containers.

Title at top: 'System Architecture'

[... specific boxes, connections, labels ...]

Keep it readable but energetic — like a whiteboard sketch from a team planning session. Keep the whiteboard background texture visible." "output-$(date +%Y%m%d-%H%M).png" --input "$WB" --aspect-ratio 16:9
```

## Output Location

**CRITICAL: Never overwrite existing images.** Always append a timestamp to the filename so previous versions are preserved.

**Naming format:** `<name>-<YYYYMMDD-HHMM>.png`

Save images to the current working directory or a subdirectory. Use `docs/` only if it exists and is writable.

Examples:
- `system-architecture-20260221-1430.png`
- `openclaw-vs-bastionclaw-security-20260221-1445.png`

Default: `output-<timestamp>.png` in the current working directory.

## Process

### Generating a New Image
1. Understand what the user wants to visualize
2. Construct the prompt using the style guide above
3. Choose appropriate aspect ratio (default `16:9` for diagrams)
4. Resolve script and whiteboard background paths (see Usage and Whiteboard Background sections)
5. Generate output path with timestamp: `<name>-$(date +%Y%m%d-%H%M).png`
6. For whiteboard-style diagrams with background available:
   `node "$GEN_IMG" "<prompt>" "<path>" --input "$WB" -ar <ratio>`
   For non-whiteboard images (thumbnails, photos, etc.) or if no background available:
   `node "$GEN_IMG" "<prompt>" "<path>" -ar <ratio>`
7. Read the generated image to verify quality
8. If the user wants it linked in docs, update the relevant `.md` file

### Editing an Existing Image
1. Identify the source image to edit (use the most recent timestamped version)
2. Write a focused prompt describing only the change (not the whole image)
3. Generate a new output path with timestamp (never overwrite the source)
4. Run `node "$GEN_IMG" "<edit prompt>" "<path>" --input <source-image>`
5. Read the edited image to verify the change was applied
6. If unsatisfied, iterate with a more specific prompt
