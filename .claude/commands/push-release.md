---
allowed-tools: Bash(git tag:*), Bash(git log:*), Bash(git diff:*), Bash(git push:*), Bash(gh release:*), Bash(date:*), Read(**/SKILL.md), Read(**/README.md), Read(**/*.md), AskUserQuestion
description: Create and push a new release with automatic versioning and high-quality changelog generation
---

# Push Release - Automated Release Management

Automate the entire release process with date-based versioning (YYYY.MM.DD), changelog generation, git tagging, and GitHub release creation.

---

## Step 1: Check Working Directory Status

**CRITICAL**: Ensure working directory is clean before creating a release.

```bash
git status
```

**If there are uncommitted changes:**

```
⚠️  WARNING: You have uncommitted changes!

Changes not staged for commit:
  modified:   src/some-file.ts

🛑 STOP: Please commit all changes before creating a release.

A release should be a clean snapshot of committed work.

Please commit your changes first:
  git add .
  git commit -m "Your commit message"

Then run /push-release again.
```

**Exit if working directory is dirty. Do not proceed.**

---

**If working directory is clean:**

```
✅ Working directory is clean. Proceeding with release...
```

Continue to Step 2.

---

## Step 2: Determine Version

**Get today's date and check for existing tags:**

```bash
date +%Y.%m.%d
git tag --sort=-v:refname | head -n 5
```

**Version format: `YYYY.MM.DD`**

- Base version is today's date (e.g., `2026.02.18`)
- If a tag for today already exists (e.g., `2026.02.18`), append a sequential suffix: `2026.02.18.2`, `2026.02.18.3`, etc.
- Check existing tags to determine the correct suffix

**Show version:**
```
📍 Latest tag: 2026.02.17
🚀 New Version: 2026.02.18
```

---

## Step 3: Collect Commits Since Last Release

Get all commits since the last release tag:

```bash
git log <last-tag>..HEAD --oneline --no-merges
```

If no previous tags exist, get all commits:

```bash
git log --oneline --no-merges
```

**If no commits since last release:**
```
⚠️  No commits since last release.

Cannot create a new release without changes.

Please make some commits first, then run /push-release again.
```

**Exit if no commits.**

---

**If commits exist:**

```
📝 Commits since <last-tag>:

232f30d Add semantic memory with qmd hybrid search
0e82ea7 Fix container networking for IPC
2100324 Update WebUI memory dashboard
```

Continue to Step 4.

---

## Step 4: Analyze Changes and Generate Changelog

**Analyze commits to extract:**

1. **Major Features** - What big things were added?
2. **Improvements** - What was enhanced?
3. **Bug Fixes** - What was fixed?
4. **Files Changed** - What files were added, modified, deleted, renamed?

**Read relevant files to understand context:**
- Check README.md for feature descriptions
- Check modified command files for new functionality
- Check skill files for new capabilities

**Generate structured changelog following this format:**

```markdown
## [Emoji] [Release Title]

[1-2 sentence summary of what this release brings]

### Major Features (if any)

- **Feature Name**: Description
  - Sub-point with details
  - Another sub-point

### Improvements (if any)

- **Area Improved**: What changed and why it's better
- **Another Improvement**: Details

### Bug Fixes (if any)

- Fixed [specific issue]
- Resolved [another issue]

### What's Included

This release includes [N] commits:
- `[hash]`: [commit message]
- `[hash]`: [commit message]

**Files Changed:**
- ➕ Added: [list of new files]
- ➖ Deleted: [list of removed files]
- 🔄 Renamed: [old] → [new]
- ✏️ Updated: [list of modified files]

---

## 📥 How to Update

### For New Users

\`\`\`bash
git clone https://github.com/harperaa/nanoclaw-hard-shell.git
cd nanoclaw-hard-shell
npm install
\`\`\`

### For Existing Users

\`\`\`bash
git pull origin main
npm install
./scripts/restart.sh --build
\`\`\`
```

**Key Principles for Changelog Quality:**

1. **Use proper markdown formatting**
   - All code in backticks or code blocks
   - File names in backticks
   - Commands in bash code blocks

2. **Be specific and actionable**
   - Exact file names and paths
   - Concrete examples
   - Clear benefits

3. **Use emojis strategically**
   - 🧠 for learning/intelligence features
   - ⚡ for performance improvements
   - 🔒 for security features
   - 🔄 for workflow changes
   - ✨ for new features
   - 🐛 for bug fixes
   - 📚 for documentation
   - ⚠️ for breaking changes

4. **Include metrics when available**
   - "13x more efficient"
   - "Reduced from 1200 to 90 lines"
   - "3-5x faster"

---

## Step 5: Show Preview and Get Approval

**Display the generated changelog to the user:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 RELEASE PREVIEW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Version: 2026.02.18
Commits: 3
Files Changed: 5

CHANGELOG:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Full generated changelog here]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Ask for approval:**

Use AskUserQuestion:

**Question**: "Proceed with creating this release?"

**Header**: "Confirm"

**Options**:

1. **Yes, create release** - Proceed with tagging and publishing
2. **Edit changelog first** - Let me modify the changelog before publishing
3. **Cancel** - Don't create the release

**multiSelect**: false

---

## Step 6A: If User Chooses "Yes, create release"

Proceed directly to Step 7.

---

## Step 6B: If User Chooses "Edit changelog first"

**Provide the changelog as editable text:**

```
I'll create a draft of the changelog. Please review and let me know what changes you'd like.

Current changelog:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Full changelog text]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

What would you like to change?
```

**Wait for user edits, then proceed to Step 7.**

---

## Step 6C: If User Chooses "Cancel"

```
❌ Release cancelled.

No tags or releases were created.
```

**Exit the command.**

---

## Step 7: Create Git Tag

Create an annotated tag with the version:

```bash
git tag -a 2026.02.18 -m "Release 2026.02.18"
```

**Verify tag was created:**

```bash
git tag --list 2026.02.18
```

**Show confirmation:**
```
✅ Created tag: 2026.02.18
```

---

## Step 8: Push Tag to Remote

Push the tag to the remote repository:

```bash
git push origin 2026.02.18
```

**Show confirmation:**
```
✅ Pushed tag to origin
```

---

## Step 9: Create GitHub Release

Create the GitHub release with the generated changelog:

```bash
gh release create 2026.02.18 \
  --repo harperaa/nanoclaw-hard-shell \
  --title "2026.02.18: [Release Title]" \
  --notes "[Full changelog in proper markdown format]"
```

**IMPORTANT**: Ensure the changelog uses proper markdown formatting:
- Bash commands in `bash` code blocks
- Output in plain code blocks
- File names in backticks
- No text accidentally rendered as headers

**Show confirmation with URL:**
```
✅ Created GitHub release: https://github.com/harperaa/nanoclaw-hard-shell/releases/tag/2026.02.18
```

---

## Step 10: Summary

Display final summary:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎉 RELEASE COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Version: 2026.02.18
Commits: 3 commits included
Tag: Created and pushed
Release: Published on GitHub

📦 Release URL:
https://github.com/harperaa/nanoclaw-hard-shell/releases/tag/2026.02.18

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Error Handling

### If Git Tag Already Exists

```
❌ Error: Tag 2026.02.18 already exists

Incrementing to 2026.02.18.2...
```

Automatically increment the suffix and retry.

### If GitHub Release Creation Fails

```
❌ Error: Failed to create GitHub release

The tag was created locally and pushed to GitHub.
However, the GitHub release creation failed.

You can create it manually:
1. Visit: https://github.com/harperaa/nanoclaw-hard-shell/releases/new
2. Select tag: 2026.02.18
3. Copy the changelog from above
4. Publish the release

Or try again:
gh release create 2026.02.18 --repo harperaa/nanoclaw-hard-shell --title "2026.02.18: [Title]" --notes "[Changelog]"
```

### If No GitHub CLI Installed

```
❌ Error: GitHub CLI (gh) not installed

The tag has been created and pushed successfully.

To complete the release:

Option 1: Install GitHub CLI
  brew install gh  # macOS
  # or visit: https://cli.github.com

Then run:
  gh release create 2026.02.18 --repo harperaa/nanoclaw-hard-shell --title "2026.02.18: [Title]" --notes "[Changelog]"

Option 2: Create release manually
  Visit: https://github.com/harperaa/nanoclaw-hard-shell/releases/new
  Select tag: 2026.02.18
  Add the changelog and publish
```

---

**Changelog Quality Checklist:**
- ✅ Proper markdown formatting (code blocks, backticks)
- ✅ Specific and actionable descriptions
- ✅ Concrete examples and metrics
- ✅ Clear update instructions
- ✅ Commit hashes included
- ✅ Files changed documented
- ✅ Breaking changes highlighted
- ✅ Benefits clearly stated
