---
name: youtube-content-creator
description: Transforms video concepts into production-ready scripts with exact spoken lines, forward-pulling hooks between every beat, and a demo-first structure. Takes a concepts.md file and applies the ideal-mechanics.md playbook.
---

# YouTube Content Creator

Turn a video concept into a record-from script with exact spoken lines for every beat.

## When to Use This Skill

- User says "create the video", "write the script", "produce the video", "build the script"
- User runs `/youtube-content-creator` with a path to a concepts.md file or a topic slug
- User wants to turn a gap-finder concept into a full video script
- User has a concepts.md and wants it formatted into a production script

## Inputs

This skill requires two files:

1. **concepts.md** — The video concept with summary and insights. Located at:
   ```
   workspace/group/youtube/{date}/recommended/{topic-slug}/concepts.md
   ```
   If the user doesn't specify a path, look for the most recent date folder and list available concepts for them to choose.

2. **ideal-mechanics.md** — The consolidated viral mechanics playbook. Located at:
   ```
   workspace/group/youtube/ideal-mechanics.md
   ```
   This file contains the best-of-breed patterns from the top-performing videos: hook types, structural blueprints, retention mechanics, emotional arcs, linguistic patterns, algorithm signals, CTA architecture, and implementation playbook.

## Workflow

### Phase 1: Load Context

1. Read the `concepts.md` file for the selected video concept
2. Read `workspace/group/youtube/ideal-mechanics.md` for the viral mechanics playbook
3. Understand the concept's thesis, key insights, and what makes it novel

### Phase 2: Select Mechanics

Based on the concept's content, select the best-fit mechanics from ideal-mechanics.md:

- **Hook type**: Which of the 5 hook types (collision, show-the-result, chiasmus, cascade, dual-outcome) best fits THIS concept's thesis?
- **Structural framework**: Which beat map best serves the argument? (comparison -> framework -> application, thesis -> evidence -> implications -> action, etc.)
- **Emotional arc**: Which arc shape matches the concept? (controlled fear -> empowerment, sustained awe, envy -> confidence, etc.)
- **Retention devices**: Which pattern interrupts, open loops, and curiosity gaps fit the content?
- **Linguistic patterns**: Which power phrase structures, contrast pairs, and rhythm patterns serve the material?
- **CTA approach**: Which CTA style (content-as-CTA, diagnosis -> prescription, behavioral, serialized promise) fits?

### Phase 3: Design the Structure

Decide on the video's macro structure. Two patterns:

**Pattern A: Demo-First (for tool/system/process videos)**
Hook (2-3 sentences) -> Live Demo (1-2 min showing the result) -> Beats explaining how it works -> CTA

**Pattern B: Framework-First (for thesis/argument videos)**
Hook (2-3 sentences) -> Framework setup -> Beats building the argument -> CTA

The hook should always be **3 sentences max** — a claim, a result, and a pull into the next section. No long monologues. Get to the proof or framework immediately.

### Phase 4: Write the Script

**CRITICAL: Every bullet in every beat must be an exact spoken line in quotation marks.** The creator should be able to read the script top to bottom and record directly from it. No meta-descriptions like "explain the concept" or "show the viewer." Write the actual words.

Exceptions to the quotes-only rule:
- `[Screen recording: description]` — production direction in brackets
- `**-> HOOK INTO NEXT**:` — the forward-pulling transition (still in quotes)

Produce the script following this structure:

```markdown
# [VIDEO TITLE — Working Title]

## Metadata
- **Target length**: [minutes]
- **Primary gap exploited**: [which gap type + 1 sentence]
- **Insight sources**: [which source videos/materials' insights are synthesized]
- **Why this wins**: [net information gain — what the viewer learns that they can't learn anywhere else]
- **Mechanics applied**: [which patterns from ideal-mechanics.md are used, with source video refs]

## The Story Arc
- **At 0:00**: [What the viewer believes]
- **At the end**: [What the viewer now understands + what they have (tool, framework, etc.)]

---

## Hook (0:00-0:XX)
- **Type**: [from ideal-mechanics.md]
- **Delivery**: [pacing note — fast/slow, confident/vulnerable, etc.]
- **Lines**:
  > "[Exact spoken words. 2-3 sentences max. Claim + result + pull.]"
- **Why it works**: [1 sentence — which mechanic and why]
- **Emotion**: [what fires first -> what it transitions to]
- **Visual**: [description of what should be on screen during this beat]

---

## [Live Demo / Framework Setup] (0:XX-X:XX)

[If demo-first: narrated screen recording showing the system/result working]
[If framework-first: the conceptual setup before details]

- **X:XX-X:XX — [Sub-section name]**
  - [Production direction in brackets if needed]
  - "[Exact spoken line]"
  - "[Exact spoken line]"

- **X:XX-X:XX — [Sub-section name]**
  - "[Exact spoken line]"
  - "[Exact spoken line]"

- **X:XX-X:XX — The bridge**
  - "[Exact line that transitions from demo/setup to the beats]"
  - **Open loops planted**:
    1. [Question that closes in Beat N]
    2. [Question that closes in Beat N]
    3. [Question that closes in Beat N]

- **Emotion**: [what the viewer feels]
- **Retention**: [which mechanic locks them in]
- **Visual**: [description of what should be on screen]

---

## Beat N: [NAME] (X:XX-X:XX)
- "[Exact spoken line — the opening statement of this beat]"
- "[Exact spoken line]"
- "[Exact spoken line]"
- [Screen recording: description] (if applicable)
- "[Exact spoken line]"
- "[Exact spoken line — the punchline or payoff of this beat]"
- **-> HOOK INTO NEXT**: "[Exact spoken line that creates curiosity about the next beat. Must tease what's coming without revealing it. Should make it impossible to stop watching.]"
- **Visual**: [description of the key visual/diagram for this beat — this drives image generation in Phase 6]
```

#### Beat Writing Rules

1. **Every beat is 4-8 spoken lines in quotes.** Each line is 1-2 sentences max. Written for spoken delivery — short words, natural rhythm, no jargon without immediate explanation.

2. **Every beat ends with `-> HOOK INTO NEXT`.** This is a forward-pulling transition in quotes — the exact words the creator says to bridge into the next beat. It must:
   - Tease what's coming without fully revealing it
   - Create a micro-curiosity gap (30-60 seconds to close)
   - Feel like a natural continuation, not a cliffhanger
   - Use patterns like: "But that's just the mechanism. What it enables is..." / "And here's the part nobody talks about..." / "Now — that sounds great in theory. But it only works if..."

3. **Production directions go in `[brackets]`.** Screen recordings, visual cues, b-roll notes. These are NOT spoken.

4. **No meta-language.** Never write "explain the concept of X" or "describe how Y works." Write the actual explanation as spoken lines.

5. **Callbacks to the demo/earlier beats are explicit.** When closing an open loop, reference it directly: "Remember the gap I showed you in the demo?" / "This is how the system knew those six creators were saying the same thing."

6. **Every beat MUST have a `Visual` field.** This is the description of the key diagram, screen recording, or visual asset for the beat. This field drives the image generation in Phase 6.

7. **Aim for 8-12 beats** for a 12-16 minute video. Each beat is ~60-90 seconds. This creates natural attention resets throughout the video.

#### Continuing the template:

```markdown
---

## Synthesis (X:XX-X:XX)
- "[Walk back through the progression — one line per stage]"
- "[One line per stage]"
- "[One line per stage]"
- "[The big reframe — why the old model is broken]"
- "[The 'aha' line — single most quotable line in the video, designed for clips and social sharing]"
- **Visual**: [description]

---

## CTA + Close (X:XX-X:XX)
- "[Callback to hook — mirror the opening with the new understanding]"
- "[The contrast — before vs after, same inputs different outputs]"
- "[Objection pre-empt 1: 'If you're thinking X — Y.']"
- "[Objection pre-empt 2: 'If you're thinking X — Y.']"
- "[Objection pre-empt 3: 'If you're thinking X — Y.']"
- "[Where to find it — links, community, etc.]"
- "[Closing line — short, punchy, memorable. 3-5 words max.]"
- **Visual**: [description]

---

## Key Lines (Written to Speak)

### The Hook
> [Copy the hook lines here for easy reference]

### The Thesis Statement
> [1-2 sentences that capture the video's unique angle — placed after demo or setup]

### The "Aha" Line
> [Single most quotable line — designed for clips and social sharing]

### The Close
> [Final 30 seconds — word for word, 60-80 words]

---

## Production Notes

### B-Roll
- [List of visual assets needed]

### Links for Description
- [URLs to include]

### Thumbnail Options
- **A**: [concept]
- **B**: [concept]
- **C**: [concept]

### Mechanics Checklist
- [ ] Hook stack in first 10 seconds
- [ ] Frame rejection within first 60 seconds
- [ ] Framework before features
- [ ] 3+ open loops with staggered closure
- [ ] Bifurcation / self-identification moment
- [ ] Honest caveats before close
- [ ] Specificity anchor density (real data, real numbers)
- [ ] Behavioral CTA — action-oriented, not "like and subscribe"
- [ ] Quotable one-liner for social sharing
- [ ] Zero mid-roll CTA interruptions
- [ ] 8-12 beats with forward-pulling hooks between each
```

### Phase 5: Save Script & Get User Approval

Save the script to the same folder as the concepts.md:

```
workspace/group/youtube/{date}/recommended/{topic-slug}/
  concepts.md          # Already exists (from gap-finder)
  script-outline.md    # New (from this skill)
```

After saving, present the script to the user for review. Tell them:

> "Script saved. Review it and let me know if you want changes. When you're happy with it, say **'create the images'** and I'll generate one whiteboard-style diagram per beat plus thumbnail options."

**Do NOT generate images automatically.** Wait for explicit user approval of the script first, then wait for the user to request image generation.

### Phase 6: Generate Beat Images (On User Command)

**Only run this phase when the user explicitly says "create the images", "generate the images", "make the visuals", or similar.**

Read the saved `script-outline.md` and extract the `Visual` field from every beat (Hook, Frame Rejection, each Beat, Synthesis, CTA). Generate one image per beat using the `/generate-image` skill.

#### Image Naming Convention

Images are numbered sequentially by beat order and named descriptively:

```
assets/
  01-hook-[short-description].png
  02-frame-rejection-[short-description].png
  03-beat1-[short-description].png
  04-beat2-[short-description].png
  05-beat3-[short-description].png
  ...
  NN-synthesis-[short-description].png
  NN-cta-[short-description].png
  thumb-a-[short-description].png
  thumb-b-[short-description].png
  thumb-c-[short-description].png
```

Example for the security video:
```
assets/
  01-hook-dual-outcome-stats.png
  02-frame-rejection-not-bugs-architecture.png
  03-beat1-cve-attack-flow.png
  04-beat2-shared-process-architecture.png
  05-beat3-clawhavoc-marketplace.png
  06-beat4-memory-poisoning-flow.png
  07-beat5-container-first-model.png
  08-beat6-env-shadow-mount.png
  09-beat7-ipc-namespaces.png
  10-beat8-mount-allowlist.png
  11-beat9-honest-caveats.png
  12-beat10-comparison-table.png
  13-synthesis-architecture-over-patches.png
  14-cta-build-secure.png
  thumb-a-open-vs-locked.png
  thumb-b-cve-cascade.png
  thumb-c-security-model.png
```

#### Image Generation Rules

1. **Use the `/generate-image` skill** (invoke it via the Skill tool). Follow its whiteboard style guide, color palette, and prompt construction rules.

2. **One image per beat.** Every beat in the script gets exactly one diagram. The `Visual` field in the beat describes what to generate.

3. **Three thumbnail options.** Generate from the `Thumbnail Options` in Production Notes. Thumbnails should be bold, high-contrast, readable at small sizes — YouTube thumbnail style, not whiteboard style.

4. **16:9 aspect ratio** for all beat images. Thumbnails also 16:9.

5. **Save to assets/ subfolder** inside the topic slug directory.

6. **Generate in parallel batches** of 3 to maximize speed without overwhelming the API.

7. **Verify each image** by reading it after generation. If quality is poor, regenerate with a more specific prompt.

8. After all images are generated, list them with their beat mapping:

```
Beat Images Generated:
1. Hook — assets/01-hook-[desc].png
2. Frame Rejection — assets/02-frame-rejection-[desc].png
3. Beat 1: [Name] — assets/03-beat1-[desc].png
...

Thumbnails:
A. assets/thumb-a-[desc].png
B. assets/thumb-b-[desc].png
C. assets/thumb-c-[desc].png
```

#### Phase 6b: Generate Production PDF

After all images are generated and verified, create a landscape PDF with one image per page. This gives the creator a single file to review, print, or share with collaborators.

**PDF structure:**
1. Thumbnails first (one per page) — labeled "Thumbnail A", "Thumbnail B", "Thumbnail C"
2. Then each beat image in order — labeled with the beat name from the script (e.g., "Hook", "Frame Rejection", "Beat 1: The One-Click Nightmare", etc.)

**Generation method:** Use a Node.js script with `sharp` (for image processing) and `pdfkit` (for PDF creation). Install if needed:

```bash
npm list sharp pdfkit 2>/dev/null || npm install --no-save sharp pdfkit
```

Write and run an inline script:

```bash
node -e "
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// True 16:9 page size (1920x1080 scaled to PDF points)
const pageW = 1920 * 0.5;  // 960pt
const pageH = 1080 * 0.5;  // 540pt
const doc = new PDFDocument({ layout: 'landscape', size: [pageH, pageW], margin: 0 });
const assetsDir = 'ASSETS_DIR_PATH';
const outputPath = path.join(assetsDir, '..', 'beat-visuals.pdf');
doc.pipe(fs.createWriteStream(outputPath));

const pages = [
  // Thumbnails first
  'thumb-a-TIMESTAMP.png',
  'thumb-b-TIMESTAMP.png',
  'thumb-c-TIMESTAMP.png',
  // Then beats in order
  '01-hook-DESC.png',
  '02-frame-rejection-DESC.png',
  // ... one entry per beat image ...
];

// pageW and pageH already defined above (960x540, true 16:9)

pages.forEach((file, i) => {
  if (i > 0) doc.addPage();
  const imgPath = path.join(assetsDir, file);
  if (!fs.existsSync(imgPath)) { console.error('Missing:', imgPath); return; }
  // Full-bleed image, no margins or labels
  doc.image(imgPath, 0, 0, { width: pageW, height: pageH });
});

doc.end();
console.log('PDF saved to:', outputPath);
"
```

**Customize the `pages` array** with the actual filenames (including timestamps) and beat labels from the script.

**Output:** Named after the video title in kebab-case (e.g., `openclaw-is-a-security-nightmare.pdf`), saved in the topic slug directory (same level as `script-outline.md` and `assets/`). Extract the title from the `# [VIDEO TITLE]` heading in `script-outline.md`.

After generating, inform the user:

> "Production PDF saved to `{path}/beat-visuals.pdf` — landscape format, one image per page, thumbnails first then each beat in order."

## Output Requirements

1. **Speakable first** — every bullet is an exact spoken line the creator reads and records from. No meta-descriptions. No "explain X to the viewer." Write the actual words.
2. **Forward-pulling** — every beat ends with a `-> HOOK INTO NEXT` transition that makes it impossible to stop watching. The viewer should always know something better is coming.
3. **Demo-aware** — if the video includes a live demo, beats should callback to it explicitly. Close the open loops the demo planted.
4. **Insight-driven** — every beat exists to deliver an insight from concepts.md. If a beat doesn't carry a gap insight or novel synthesis, cut it.
5. **Story-shaped** — the beats form a narrative arc with tension, progression, and payoff. Not a listicle. Not a lecture.
6. **Mechanically sound** — every beat has a specific retention device from ideal-mechanics.md woven in. Hooks, loops, interrupts, and emotional triggers are placed deliberately.
7. **Differentiated** — the script must produce a video that passes YouTube's Gist Filter. The insights and angle must be genuinely novel.
8. **Visually planned** — every beat has a `Visual` field that describes the key on-screen asset. This drives Phase 6 image generation.

## Design Principles

- **concepts.md is the substance** — it provides the thesis, insights, and information gain
- **ideal-mechanics.md is the vehicle** — it provides the hooks, retention, emotional engineering, and structure
- **The script is the deliverable** — detailed enough to record from directly, every line in quotes
- **Every mechanic serves an insight** — don't bolt mechanics on. The retention device and the insight delivery should be the same moment.
- **The hook is 3 sentences, not 30** — get to the proof fast. "Let me show you" > lengthy setup.
- **Forward momentum is non-negotiable** — if a beat doesn't end with a pull into the next, rewrite it until it does.
- **Images are per-beat** — every beat gets one diagram, numbered and named for easy production reference.

## Integration

| Skill | How it connects |
|-------|----------------|
| `youtube-gap-finder` | Produces the concepts.md files this skill consumes |
| `youtube-video-analyst` | Source of the analysis.md files that informed ideal-mechanics.md |
| `content-creator` | Can turn script outlines into newsletter/social content for promotion |
| `generate-image` | Creates whiteboard-style visuals for each beat + thumbnails |
