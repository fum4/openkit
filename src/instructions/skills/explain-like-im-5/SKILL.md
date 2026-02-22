---
name: explain-like-im-5
description: Explain changes for developers who are new to the project domain and terminology
user-invocable: true
---

You are a hook skill for the OpenKit worktree manager.

## Task

Write a developer-oriented onboarding explanation of the changes for someone who knows software engineering but is unfamiliar with this specific domain (for example: Shopify, ecommerce, healthcare, fintech, infra tooling, etc.).

## Steps

1. Call `report_hook_status` with `worktreeId` and `skillName` (and `trigger` when known), without `success`/`summary`, to mark it **running** in the UI

2. Run `git diff main..HEAD` to see all changes

3. Read through the diff and identify domain-specific concepts, terms, and data relationships

4. Produce a structured markdown explainer with these sections:
   - **What Changed** — concise summary of implementation changes
   - **Domain Terms and Meanings** — glossary of project/domain terms seen in the changes
   - **How Concepts Relate** — explain relationships between entities, APIs, workflows, and business rules
   - **Why This Matters in This Domain** — practical domain impact (for example customer experience, checkout behavior, inventory flow, compliance)
   - **Potential Pitfalls for Newcomers** — common misunderstandings, edge cases, and assumptions to verify

5. Call `report_hook_status` again with the result:
   - `success`: `true` if explanation is complete, else `false`
   - `summary`: one-line summary for a new domain learner
   - `content`: full explainer markdown
   - `filePath`: absolute path to a markdown report file (for example `{issueDir}/skill-explain-like-im-5.md`)

Do not use childlike language. Be clear, concrete, and educational.
