# Claude Code Plugin Specification — Quick Reference

Source: Official Anthropic documentation (code.claude.com/docs/en/plugins-reference)

## plugin.json (Required Fields)

Only `name` is truly required. Anthropic's own plugins use at most 4 fields:

```json
{
  "name": "kebab-case-name",
  "version": "1.0.0",
  "description": "Under 200 chars",
  "author": { "name": "Name" }
}
```

Name validation: `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/`

## SKILL.md Frontmatter (Only These Fields)

```yaml
---
name: skill-name
description: Third-person description with trigger phrases. "Use when user says X, Y, or Z."
---
```

NOT recognized in plugins: `model`, `context`, `allowed-tools`, `user-invocable`, `version`.

## Command Frontmatter

```yaml
---
description: Under 60 chars for /help display
argument-hint: "<required> [optional]"
---
```

Variables: `$ARGUMENTS` (all text), `$1`/`$2` (positional), `@$1` (file include), `${CLAUDE_PLUGIN_ROOT}` (plugin path).

## Directory Layout

```
plugin-root/           # Everything at root level
├── .claude-plugin/    # ONLY plugin.json and marketplace.json go here
├── skills/            # Auto-discovered
├── commands/          # Auto-discovered
├── agents/            # Auto-discovered (rarely used in Cowork)
├── hooks/             # Auto-discovered (rarely used in Cowork)
├── .mcp.json          # Auto-discovered
├── settings.json      # Only "agent" key supported
├── CONNECTORS.md      # Tool-agnostic connector docs
└── README.md
```

## marketplace.json

Required for `/plugin marketplace add` to work:

```json
{
  "name": "marketplace-name",
  "owner": { "name": "Owner" },
  "plugins": [
    { "name": "plugin-name", "source": ".", "description": "...", "version": "1.0.0" }
  ]
}
```

## Script Paths

ALWAYS use `${CLAUDE_PLUGIN_ROOT}/path/to/script.py` in SKILL.md and hooks.
Installed plugins are cached at `~/.claude/plugins/cache` — relative paths break.

## Packaging for Cowork

```bash
zip -r plugin-name.zip . -x "*.DS_Store" -x ".git/*" -x "__pycache__/*"
```

Upload the .zip via Cowork Customize sidebar. Max 50MB.

## What Cowork Uses vs Ignores

| Component | Cowork | Claude Code CLI |
|-----------|--------|-----------------|
| Skills | Yes | Yes |
| Commands | Yes | Yes |
| Agents | Rarely | Yes |
| Hooks | Rarely | Yes |
| MCP (HTTP) | Yes | Yes |
| MCP (stdio) | No | Yes |
| LSP | No | Yes |
| settings.json | Limited | Limited |

## Reserved Marketplace Names (Blocked)

claude-code-marketplace, claude-code-plugins, claude-plugins-official, anthropic-marketplace, anthropic-plugins, agent-skills, life-sciences.
