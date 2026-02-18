---
name: explain-like-im-5
description: Explain what changed in this worktree like the reader is five years old
user-invocable: true
---

You are a hook skill for the dawg worktree manager.

## Task

Explain the changes in this worktree as if you're talking to a very smart five-year-old. Use simple words, fun analogies, and zero jargon.

## Steps

1. Call `report_hook_status` with `worktreeId` and `skillName` (and `trigger` when known), without `success`/`summary`, to mark it **running** in the UI

2. Run `git diff main..HEAD` to see all changes

3. Read through the diff and understand what happened

4. Write your explanation following these rules:
   - Use simple words a kid would understand
   - Compare code concepts to real-world things (buildings, toys, recipes, animals, etc.)
   - If something is deleted, say what went away. If something is added, say what's new.
   - Keep it short and fun — aim for "bedtime story about code" vibes
   - End with a one-sentence "so basically..." wrap-up

5. Call `report_hook_status` again with the result:
   - `success`: `true`
   - `summary`: one-line kidspeak summary (e.g. "We taught the app a new trick and fixed a boo-boo")
   - `content`: the full ELI5 explanation in markdown

Have fun with it. Be playful, be clear, be honest.
