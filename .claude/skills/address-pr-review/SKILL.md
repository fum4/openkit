---
name: address-pr-review
description: Use when the user wants to address PR review feedback. Reads the latest bot code review from a GitHub PR (prioritizing Claude), analyzes comments, and addresses actionable feedback with code changes. Accepts an optional PR number or derives it from the current branch.
---

# Address PR Review Skill

Address actionable feedback from bot code reviews on GitHub PRs.

## Rules

- **Never commit or push** — only make code edits
- **Stop early** if no PR found, no bot review found, or no actionable comments
- **Flag ambiguous comments** for user decision rather than guessing
- Do not modify tests unless the review comment explicitly asks for test changes

## Steps

### Step 1: Determine the PR

If the user provided a PR number as an argument, use that. Otherwise, derive it from the current branch:

```bash
gh pr view --json number,title,url
```

If no PR is found, inform the user and stop.

### Step 2: Get repo info

```bash
gh repo view --json owner,name
```

Extract `owner` and `name` for API calls.

### Step 3: Fetch the Clode Review comment

The code review is posted as a **PR issue comment** (not a PR review) by `github-actions[bot]`, with a title containing "Clode Review".

```bash
gh api repos/{owner}/{repo}/issues/{number}/comments
```

From the results:

1. Find comments where `user.login` is `github-actions[bot]` **and** the body contains "Clode Review"
2. Among matching comments, pick the **latest** by `created_at`
3. If no Clode Review comment is found, inform the user and stop

Parse the comment body — it contains structured markdown with severity sections (e.g. `### 🟠 Medium`, `### 🟡 Minor`) and numbered items describing issues with file references.

### Step 5: Present summary

Show the user:

- **Review metadata**: comment date
- **Issues by severity**: list each numbered item with:
  - Severity level (from section header, e.g. Medium, Minor)
  - File path referenced
  - The issue description
  - Classification: **actionable** (clear code change requested) vs **informational** (observation, question, or style preference)

Ask the user to confirm before proceeding with changes, or let them select which comments to address.

### Step 6: Address actionable comments

For each actionable comment:

1. Read the referenced file using the Read tool
2. Understand the comment's intent and the surrounding code context
3. Make targeted edits using the Edit tool
4. If the comment is ambiguous or you're unsure about the correct fix, **skip it** and flag it for the user

### Step 7: Post-change summary

Present a summary:

- **Changed**: list of files and what was modified, with the comment that prompted it
- **Skipped**: list of comments that were informational, ambiguous, or flagged for user decision
- Remind the user to review the changes and run tests before committing
