---
name: generate-image
description: Generate images using Gemini via scripts/generate-image.js. Creates technical diagrams, architecture visuals, blog headers, and branded graphics. Use when the user asks to "create an image", "generate a diagram", "make a visual", or "create a graphic". Triggers on "generate image", "create image", "make diagram", "create visual", "architecture diagram".
---

# Image Generation Skill

Generate images using Gemini's image model via `scripts/generate-image.js`. Specializes in technical architecture diagrams, pipeline visuals, blog headers, and branded project graphics.

## Usage

```bash
node scripts/generate-image.js "<prompt>" "<output-path>" [--aspect-ratio 16:9]
```

Requires `GEMINI_API_KEY` in `.env`.

## Aspect Ratios

| Ratio | Use Case |
|-------|----------|
| `16:9` | Architecture diagrams, pipeline flows, blog banners |
| `1:1` | Logos, icons, social media avatars |
| `4:3` | Documentation images, screenshots |
| `9:16` | Mobile/story format |
| `3:4` | Portrait format |

Default to `16:9` for technical diagrams. Ask the user if unclear.

## Project Visual Style

All project diagrams follow a consistent brand. **Always include these style instructions in the prompt:**

### Background
- Dark background: `#1a1a2e` (deep navy)
- Subtle geometric mesh or grid pattern in the background (very low opacity)

### Color Palette (box/element fills)
| Color | Hex | Role |
|-------|-----|------|
| Teal | `#00d4aa` | Primary actions, entry points, data sources |
| Orange | `#ff6b35` | Orchestration, file systems, web interfaces |
| Purple | `#7c3aed` | AI/agent components, processing, databases |
| Green | `#22c55e` | Agent containers, active processes |
| Red | `#ef4444` | Deduplication, destructive/merge operations |
| Yellow | `#eab308` | API endpoints, web services |
| Cyan | `#06b6d4` | Indexes, search, semantic operations |

### Typography & Elements
- White text (`#ffffff`) for all labels and descriptions
- Bold sans-serif headers for box titles
- Lighter weight for subtitles and descriptions
- Rounded corners on all boxes (modern flat design)
- Clean directional arrows (not hand-drawn) connecting stages
- Subtle drop shadows for depth

### Layout
- Left-to-right or top-to-bottom flow
- Clear stage/step numbering when applicable
- Legend box in corner when using 4+ colors
- Title in large bold text at the top center

## Prompt Construction

When the user asks for a diagram, build the prompt by combining:

1. **Style preamble** (always include):
   ```
   Create a clean, professional technical architecture diagram on a dark background (#1a1a2e) with subtle geometric patterns. Use modern flat design with rounded boxes, subtle gradients, and clean connecting arrows. White text on colored boxes.
   ```

2. **Color assignments** — map each component type to the palette above based on its role

3. **Content** — the specific boxes, labels, arrows, and relationships the user wants

4. **Layout instruction**:
   ```
   Keep it minimal and readable. No unnecessary decoration. Use clear directional arrows between stages.
   ```

### Example: Architecture Diagram

```
Create a clean, professional technical architecture diagram on a dark background (#1a1a2e) with subtle geometric patterns. Use modern flat design with rounded boxes, subtle gradients, and clean connecting arrows. White text on colored boxes.

Color palette: teal (#00d4aa) for data sources, orange (#ff6b35) for orchestration, purple (#7c3aed) for AI processing, green (#22c55e) for containers.

Title at top: 'System Architecture'

[... specific boxes, connections, labels ...]

Keep it minimal and readable. No unnecessary decoration.
```

## Output Location

- Architecture diagrams: `docs/<name>.png`
- Blog images: user-specified path
- Default: `output.png` in project root

## Process

1. Understand what the user wants to visualize
2. Construct the prompt using the style guide above
3. Choose appropriate aspect ratio (default `16:9` for diagrams)
4. Choose output path (default `docs/` for architecture diagrams)
5. Run `node scripts/generate-image.js "<prompt>" "<path>" -ar <ratio>`
6. Read the generated image to verify quality
7. If the user wants it linked in docs, update the relevant `.md` file
