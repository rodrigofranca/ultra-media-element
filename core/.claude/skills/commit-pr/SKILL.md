---
name: commit-pr
description: >-
  Commit all changes and create or update a PR following project conventions.
  Triggers: "commit and pr", "push changes", "create pull request",
  "commit-pr", "send pr".
allowed-tools: Bash(git:*), Bash(gh:*), Glob, Grep, Read
context: fork
---

# Commit & PR

Stage all changes, create a conventional commit, and open a pull request (or push to an existing one).

## Usage

```
/commit-pr [refs]
```

- `refs` (optional): Issue/PR references (e.g., `#123`, `fixes #456`)

### Examples

```
/commit-pr
/commit-pr #42
/commit-pr fixes #15
```

## Arguments

$ARGUMENTS

## Your Tasks

### Step 1: Analyze Changes

1. Run `git status` to identify changed files
2. Run `git diff --staged` and `git diff` to understand what changed
3. Read modified files if needed for context

### Step 2: Determine Commit Type

Based on the changes and CLAUDE.md commit conventions:

| Type | Usage |
|------|-------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `chore` | Build, config, dependencies, cleanup |
| `docs` | Documentation only |
| `data` | Test data, media samples |
| `refactor` | Code restructure without behavior change |
| `test` | Adding or updating tests |

Format: `<type>: <description in lowercase>`

Keep subject line under 72 chars.

### Step 3: Create Commit

1. Stage all changes: `git add -A`
2. Create commit with conventional message:
   ```bash
   git commit -m "type: description"
   ```

### Step 4: Push and Create/Update PR

1. Push branch to remote:
   ```bash
   git push -u origin HEAD
   ```

2. Check if a PR already exists for this branch:
   ```bash
   gh pr list --head "$(git branch --show-current)" --json number,url,title,body --jq '.[0]'
   ```

3. **If PR exists:**
   - The push already updated the PR code
   - Report: "Pushed to PR #N: <url>"

4. **If no PR exists:** Create one:
   ```bash
   gh pr create --title "type: description" --body "$(cat <<'EOF'
   ## Summary

   - What changed and why (1-3 bullets)

   ## Test Plan

   - [ ] How to verify the change
   EOF
   )"
   ```

### Step 5: Report

Output one of:
- "Pushed to PR #N: <url>"
- "Created PR #N: <url>"

## Important

- Always stage ALL changes with `git add -A`
- Always check for existing PR before creating — avoid duplicates
- Never commit to `main` directly — create a branch first if on main
- Commit message must follow CLAUDE.md Section 5 conventions
- PR title matches the commit message
- PR body is concise: why over what, no file lists
