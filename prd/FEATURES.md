# This document outlines new features

## Projects / Roadmaps

Users should be able to work on tasks in batches. Add capability to group, serve and track tasks together.

## Linux support

Implement Linux release pipeline & confirm everything works

## Windows support

Add windows support. Current port offsetting does not work on Windows. To investigate what other incompatibilities exist

## Add "Open project in" button

The UI should display a button that helps users open the project in various environments (IDEs / Finder / TBD)

## Add "Code with Claude" button

Add "Code with Claude" button to tasks that will either:

- open claude code in corresponding worktree terminal (if already existing) and allow user to provide further prompts for the current implementation
- create a new worktree (if it doesn't already exist), open claude code in the worktree terminal and automatically start working on the task
