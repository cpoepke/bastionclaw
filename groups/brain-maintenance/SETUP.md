# Brain Maintenance — Setup Instructions

## Prerequisites

1. **GITHUB_TOKEN** in Infisical at `/apps/nanoclaw` (already created — syncs to `nanoclaw-app-secrets` K8s secret via Infisical operator)
2. **Mount allowlist** at `~/.config/bastionclaw/mount-allowlist.json` (already created)
3. **J.A.R.V.I.S. Ops** WhatsApp group created
4. **Terraform applied** (Spacelift auto-applies on commit) — obsidian-brain gets `GIT_PULL_INTERVAL=300` and `GITHUB_TOKEN` from Infisical

## Step 1: Find the J.A.R.V.I.S. Ops Group JID

In the main BastionClaw chat, ask Kai:

> Find the JID for the "J.A.R.V.I.S. Ops" WhatsApp group

Or query directly:

```
sqlite3 /path/to/store/messages.db "SELECT jid, name FROM chats WHERE name LIKE '%JARVIS%' OR name LIKE '%Ops%'"
```

## Step 2: Register the brain-maintenance Group

In the main BastionClaw chat, tell Kai:

> Register a new group for the J.A.R.V.I.S. Ops channel:
> - name: "Brain Maintenance"
> - folder: "brain-maintenance"
> - trigger: "@Brain"
> - JID: <the JID from step 1>
> - Additional mount: ~/Projects/Current/n8t.dev-os/brain as "brain" with read-write access
> - Timeout: 600000 (10 minutes)

Kai will write the IPC file. Verify with:

```
sqlite3 /path/to/store/messages.db "SELECT * FROM registered_groups WHERE folder='brain-maintenance'"
```

## Step 3: Test the Group

Send a message in the J.A.R.V.I.S. Ops group:

> @Brain List files in /workspace/extra/brain/ and tell me what you see

Verify the agent can:
- See the vault contents
- Read CLAUDE.md
- Run git commands (`git status`, `git log --oneline -3`)

## Step 4: Schedule the Tasks

In the main BastionClaw chat, tell Kai to schedule three tasks targeting the brain-maintenance group:

### Task 1: Briefing Ingest (Daily)

> Schedule a task for the J.A.R.V.I.S. Ops group:
> - Cron: 0 4 * * * (daily at 4 AM UTC)
> - Prompt: (paste the prompt from prompts/briefing-ingest.md, the content inside the ``` block)

### Task 2: Vault Lint (Weekly Sunday)

> Schedule a task for the J.A.R.V.I.S. Ops group:
> - Cron: 0 6 * * 0 (Sunday at 6 AM UTC)
> - Prompt: (paste the prompt from prompts/vault-lint.md, the content inside the ``` block)

### Task 3: Wiki Synthesis (Weekly Sunday)

> Schedule a task for the J.A.R.V.I.S. Ops group:
> - Cron: 0 8 * * 0 (Sunday at 8 AM UTC)
> - Prompt: (paste the prompt from prompts/wiki-synthesis.md, the content inside the ``` block)

## Step 5: Verify Scheduled Tasks

Ask Kai to list scheduled tasks:

> Show me all scheduled tasks for the brain-maintenance group

Or check the database:

```
sqlite3 /path/to/store/messages.db "SELECT id, schedule_value, status, next_run FROM scheduled_tasks WHERE group_folder='brain-maintenance'"
```

## Step 6: Deploy obsidian-docker Config

Apply the Terraform change to enable periodic git pulls:

```bash
cd /path/to/n8t.dev-os-infra/rackspace/apps
terraform plan -target=kubernetes_config_map.obsidian_brain_config
terraform apply -target=kubernetes_config_map.obsidian_brain_config
```

Then restart the obsidian-brain pod to pick up the new config:

```bash
kubectl rollout restart deployment/obsidian-brain -n obsidian-brain
```

## Monitoring

- **Mission Control**: Brain maintenance tasks appear in the dashboard with source "scheduled"
- **J.A.R.V.I.S. Ops chat**: Daily/weekly summaries arrive after each run
- **Brain log.md**: All operations are logged with timestamps
- **Git history**: Every operation creates a commit in the brain repo
