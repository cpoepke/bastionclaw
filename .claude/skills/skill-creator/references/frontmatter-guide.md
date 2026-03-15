# Frontmatter Guide

## Description Writing

The description is Claude's only clue about whether to load your skill. It must answer:
1. **What** does this skill do?
2. **When** should Claude use it?

### Rules

- Max 1024 characters
- Third person only (description is injected into system prompt)
- Include 3-5 trigger phrases after "Use when..."
- Be specific enough to avoid over-triggering on unrelated tasks

### Good Descriptions

```yaml
# Pipeline skill — specific action + trigger phrases
description: Process Gmail inbox to identify high-risk emails, analyze sentiment
  and urgency, generate strategic recommendations, create draft responses, and
  deliver an executive briefing to Slack. Run with /email-digest or ask to
  process emails.

# Research skill — clear workflow + triggers
description: Transform a LinkedIn URL into a complete research package with
  personalized outreach. Scrapes profile, researches company via Perplexity,
  runs AI analysis for pain points and DM sequences. Run with /research-lead
  or ask to research a lead.

# Creative skill — scope + boundary + triggers
description: Build premium static websites using the PRISM framework (6-phase
  process). Use when asked to build, design, or create a website or landing
  page. For interactive apps with databases and auth, use build-app instead.
```

### Bad Descriptions

```yaml
# Too vague — triggers on everything
description: Helps with projects.

# No trigger conditions — Claude doesn't know WHEN
description: Creates sophisticated multi-page documentation systems.

# Wrong POV — breaks system prompt injection
description: I can help you process Excel files.

# Over-triggers — too broad
description: Processes documents and analyzes data for business use.
```

### The Formula

```
[What it does in plain language] + [Use when user says "X", "Y", "Z"]
```

## Model Routing

| Model | Cost | Use For |
|-------|------|---------|
| `haiku` | Cheapest | Simple lookups, fast tasks, classification |
| `sonnet` | Balanced | Most automated pipelines (default) |
| `opus` | Expensive | Complex reasoning, creative work, architecture |

Default to `sonnet` for pipeline skills. Only use `opus` when the skill requires creative judgment or complex multi-step reasoning.

## Context and Tool Scoping

### context: fork
Runs the skill in an isolated subagent. Recommended for:
- Any skill with `model: sonnet` or `model: haiku` (spawns cheaper subagent)
- Long-running pipelines (isolates from main conversation)

### allowed-tools
Restricts which tools the subagent can use:
```yaml
allowed-tools: Bash(python3 .claude/skills/SKILL_NAME/scripts/*)
```

### disable-model-invocation: true
Prevents Claude from auto-triggering. Use for destructive operations.

## Frontmatter Templates

### Automated Pipeline
```yaml
---
name: skill-name
description: What this pipeline does. Run with /skill-name or ask to do X.
model: sonnet
context: fork
allowed-tools: Bash(python3 .claude/skills/skill-name/scripts/*)
---
```

### Interactive / Creative
```yaml
---
name: skill-name
description: What this skill creates. Use when asked to build, design, or create X.
model: opus
context: fork
---
```

### Manual-Only (Destructive)
```yaml
---
name: skill-name
description: What this does (dangerous). Only run via /skill-name.
model: sonnet
context: fork
disable-model-invocation: true
---
```
