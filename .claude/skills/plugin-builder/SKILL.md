---
name: plugin-builder
description: Package any combination of skills into a distributable Claude Code / Cowork plugin. Builds the correct directory structure, rewrites frontmatter, creates slash commands, generates marketplace.json, and zips for upload. Trigger with "build a plugin", "package these skills as a plugin", "create a plugin from", or "turn these skills into a plugin".
user-invocable: true
---

# Plugin Builder

Package skills from this workspace into a properly structured Claude Code / Cowork plugin.

## When to Use

- User wants to share skills with others
- User wants to upload skills to Cowork
- User wants to publish a plugin to GitHub
- User wants to bundle skills into a distributable package

## Inputs Required

1. **Plugin name** — kebab-case (e.g., `sales-pack`, `content-toolkit`)
2. **Which skills to include** — list of skill names from `.claude/skills/`
3. **Author name** — for plugin.json
4. **Description** — one-line description of what the plugin does
5. **GitHub repo name** — optional, for pushing to GitHub

If the user doesn't specify all inputs, ask for them conversationally.

## Process

Follow these steps EXACTLY. This is the structure Anthropic requires.

### Step 1: Create the Directory Structure

```
{plugin-name}/
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
├── skills/
│   └── {each-skill}/
│       ├── SKILL.md
│       ├── scripts/        (if the skill has scripts)
│       └── references/     (if the skill has references)
├── commands/
│   └── {each-skill}.md
├── CONNECTORS.md
├── README.md
├── LICENSE
└── .gitignore
```

CRITICAL RULES:
- Only `plugin.json` and `marketplace.json` go inside `.claude-plugin/`
- Everything else (`skills/`, `commands/`) goes at the PLUGIN ROOT
- Do NOT put anything inside a `.claude/` directory — that's workspace format, not plugin format

### Step 2: Write plugin.json

File: `.claude-plugin/plugin.json`

Keep it MINIMAL. Anthropic's own plugins only use these 4 fields:

```json
{
  "name": "{plugin-name}",
  "version": "1.0.0",
  "description": "{description}",
  "author": {
    "name": "{author-name}"
  }
}
```

Do NOT add: keywords, homepage, repository, license, custom paths, hooks, skills arrays, or anything else. Auto-discovery handles component loading.

### Step 3: Write marketplace.json

File: `.claude-plugin/marketplace.json`

This makes the repo installable via `/plugin marketplace add`:

```json
{
  "name": "{plugin-name}",
  "description": "{description}",
  "owner": {
    "name": "{author-name}"
  },
  "plugins": [
    {
      "name": "{plugin-name}",
      "source": ".",
      "description": "{description}",
      "version": "1.0.0"
    }
  ]
}
```

### Step 4: Copy and Rewrite Skills

For EACH skill being packaged:

1. Copy the skill directory from `.claude/skills/{name}/` to `{plugin}/skills/{name}/`
2. Include `scripts/`, `references/`, `assets/` subdirectories if they exist
3. **REWRITE the SKILL.md frontmatter** to contain ONLY:

```yaml
---
name: {skill-name}
description: {description with trigger phrases}
---
```

REMOVE these fields (they are workspace-only, not recognized by plugins):
- `model:`
- `context:`
- `allowed-tools:`
- `user-invocable:`

4. **Fix script paths** in the SKILL.md body. Replace:
   - `.claude/skills/{name}/scripts/` → `${CLAUDE_PLUGIN_ROOT}/skills/{name}/scripts/`
   - Any relative script paths → `${CLAUDE_PLUGIN_ROOT}/` prefixed paths

   `${CLAUDE_PLUGIN_ROOT}` is REQUIRED because installed plugins get copied to a cache directory. Without this prefix, script paths break after installation.

### Step 5: Create Slash Commands

For EACH skill, create a command file at `commands/{skill-name}.md`:

```markdown
---
description: {Short description under 60 chars}
argument-hint: "{expected arguments if any}"
---

{One paragraph explaining what the command does.}

$ARGUMENTS
```

The `$ARGUMENTS` variable captures everything the user types after the command name.

### Step 6: Write CONNECTORS.md

List every external service the plugin's skills connect to. For each:
- Service name
- Which skill uses it
- Setup instructions (account creation, API key generation)
- Required environment variables

This file helps users set up the services their skills need.

### Step 7: Write README.md

Include:
- Plugin name and one-line description
- Install instructions for Claude Code AND Cowork
- Table of skills (name, what it does, required API keys)
- Table of commands
- Requirements
- License

### Step 8: Write Supporting Files

**.gitignore:**
```
.env
.env.local
credentials.json
token.json
data/
logs/
.tmp/
.DS_Store
__pycache__/
*.pyc
```

**LICENSE:** MIT (or ask the user)

### Step 9: Package as .zip for Cowork

```bash
cd {plugin-dir} && zip -r ../{plugin-name}.zip . -x "*.DS_Store" -x ".git/*" -x "__pycache__/*" -x "*.pyc"
```

The .zip file can be:
- Dragged into Cowork's plugin upload UI
- Uploaded by org admins via Organization Settings > Plugins
- Max size: 50MB (our plugins are typically 30-150K)

### Step 10: Push to GitHub (Optional)

```bash
cd {plugin-dir}
git init && git branch -m main
git add -A
git commit -m "Initial release: {plugin-name} v1.0.0"
gh repo create {plugin-name} --public --description "{description}" --source . --push
```

Users install via:
```
/plugin marketplace add {github-username}/{plugin-name}
/plugin install {plugin-name}@{plugin-name}
```

## Verification Checklist

Before declaring done, verify:

- [ ] `.claude-plugin/plugin.json` has ONLY name, version, description, author
- [ ] `.claude-plugin/marketplace.json` exists with correct source path
- [ ] NO `.claude/` directory exists (that's workspace format)
- [ ] All skills are in `skills/` at plugin root
- [ ] All SKILL.md frontmatter has ONLY `name` and `description`
- [ ] All script paths use `${CLAUDE_PLUGIN_ROOT}/`
- [ ] Each skill has a matching command in `commands/`
- [ ] CONNECTORS.md lists all external services
- [ ] .zip file created and under 50MB
- [ ] .zip can be uploaded to Cowork without errors

## Common Mistakes to Avoid

1. **Putting skills inside `.claude/skills/`** — Plugin format uses `skills/` at root
2. **Adding extra frontmatter fields** — Plugins only recognize `name` and `description`
3. **Relative script paths** — MUST use `${CLAUDE_PLUGIN_ROOT}/` prefix
4. **Missing marketplace.json** — Without this, `/plugin marketplace add` fails
5. **Missing commands** — Skills work by description matching, but commands give users explicit `/slash` access
6. **Forgetting CONNECTORS.md** — Users need to know which services to set up

## Example

"Package email-digest, research-lead, and gamma-slides as a plugin called sales-toolkit"

Result:
```
sales-toolkit/
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
├── skills/
│   ├── email-digest/
│   │   └── SKILL.md
│   ├── research-lead/
│   │   └── SKILL.md
│   └── gamma-slides/
│       ├── SKILL.md
│       └── scripts/
│           └── create_presentation.py
├── commands/
│   ├── email-digest.md
│   ├── research-lead.md
│   └── slides.md
├── CONNECTORS.md
├── README.md
├── LICENSE
└── .gitignore
```
