import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import path from "path";

import { CONFIG_DIR_NAME } from "@openkit/shared/constants";

export type IssueSource = "jira" | "linear" | "local";

export type GitPolicyOverride = "inherit" | "allow" | "deny";

export interface TodoItem {
  id: string;
  text: string;
  checked: boolean;
  createdAt: string;
}

export type HookSkillOverride = "inherit" | "enable" | "disable";

export interface IssueNotes {
  linkedWorktreeId: string | null;
  personal: { content: string; updatedAt: string } | null;
  aiContext: { content: string; updatedAt: string } | null;
  todos: TodoItem[];
  gitPolicy?: {
    agentCommits?: GitPolicyOverride;
    agentPushes?: GitPolicyOverride;
    agentPRs?: GitPolicyOverride;
  };
  hookSkills?: Record<string, HookSkillOverride>;
}

const EMPTY_NOTES: IssueNotes = {
  linkedWorktreeId: null,
  personal: null,
  aiContext: null,
  todos: [],
};

export class NotesManager {
  private configDir: string;

  constructor(configDir: string) {
    this.configDir = configDir;
  }

  getIssueDir(source: IssueSource, id: string): string {
    return path.join(this.configDir, CONFIG_DIR_NAME, "issues", source, id);
  }

  private notesPath(source: IssueSource, id: string): string {
    return path.join(this.getIssueDir(source, id), "notes.json");
  }

  loadNotes(source: IssueSource, id: string): IssueNotes {
    const filePath = this.notesPath(source, id);
    if (!existsSync(filePath)) return { ...EMPTY_NOTES, todos: [] };
    try {
      const notes = JSON.parse(readFileSync(filePath, "utf-8")) as IssueNotes;
      notes.todos ??= [];
      return notes;
    } catch {
      return { ...EMPTY_NOTES, todos: [] };
    }
  }

  saveNotes(source: IssueSource, id: string, notes: IssueNotes): void {
    const dir = this.getIssueDir(source, id);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.notesPath(source, id), JSON.stringify(notes, null, 2) + "\n");
  }

  updateSection(
    source: IssueSource,
    id: string,
    section: "personal" | "aiContext",
    content: string,
  ): IssueNotes {
    const notes = this.loadNotes(source, id);
    notes[section] = { content, updatedAt: new Date().toISOString() };
    this.saveNotes(source, id, notes);
    return notes;
  }

  getLinkedWorktreeId(source: IssueSource, id: string): string | null {
    return this.loadNotes(source, id).linkedWorktreeId;
  }

  setLinkedWorktreeId(source: IssueSource, id: string, worktreeId: string | null): void {
    const notes = this.loadNotes(source, id);
    notes.linkedWorktreeId = worktreeId;
    this.saveNotes(source, id, notes);
  }

  clearLinkedWorktreeId(worktreeId: string): void {
    const issuesDir = path.join(this.configDir, CONFIG_DIR_NAME, "issues");

    for (const source of ["jira", "linear", "local"] as IssueSource[]) {
      const sourceDir = path.join(issuesDir, source);
      if (!existsSync(sourceDir)) continue;

      for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const notes = this.loadNotes(source, entry.name);
        if (notes.linkedWorktreeId !== worktreeId) continue;
        notes.linkedWorktreeId = null;
        this.saveNotes(source, entry.name, notes);
      }
    }
  }

  addTodo(source: IssueSource, id: string, text: string): IssueNotes {
    const notes = this.loadNotes(source, id);
    notes.todos.push({
      id: randomUUID(),
      text,
      checked: false,
      createdAt: new Date().toISOString(),
    });
    this.saveNotes(source, id, notes);
    return notes;
  }

  updateTodo(
    source: IssueSource,
    id: string,
    todoId: string,
    updates: { text?: string; checked?: boolean },
  ): IssueNotes {
    const notes = this.loadNotes(source, id);
    const todo = notes.todos.find((t) => t.id === todoId);
    if (!todo) throw new Error(`Todo "${todoId}" not found`);
    if (updates.text !== undefined) todo.text = updates.text;
    if (updates.checked !== undefined) todo.checked = updates.checked;
    this.saveNotes(source, id, notes);
    return notes;
  }

  deleteTodo(source: IssueSource, id: string, todoId: string): IssueNotes {
    const notes = this.loadNotes(source, id);
    notes.todos = notes.todos.filter((t) => t.id !== todoId);
    this.saveNotes(source, id, notes);
    return notes;
  }

  updateGitPolicy(
    source: IssueSource,
    id: string,
    policy: { agentCommits?: GitPolicyOverride; agentPushes?: GitPolicyOverride },
  ): IssueNotes {
    const notes = this.loadNotes(source, id);
    notes.gitPolicy = { ...notes.gitPolicy, ...policy };
    this.saveNotes(source, id, notes);
    return notes;
  }

  updateHookSkills(
    source: IssueSource,
    id: string,
    overrides: Record<string, HookSkillOverride>,
  ): IssueNotes {
    const notes = this.loadNotes(source, id);
    notes.hookSkills = { ...notes.hookSkills, ...overrides };
    this.saveNotes(source, id, notes);
    return notes;
  }

  /**
   * Build a map of worktreeId → { source, issueId } by scanning all notes.json files.
   */
  buildWorktreeLinkMap(): Map<string, { source: IssueSource; issueId: string }> {
    const map = new Map<string, { source: IssueSource; issueId: string }>();
    const issuesDir = path.join(this.configDir, CONFIG_DIR_NAME, "issues");

    for (const source of ["jira", "linear", "local"] as IssueSource[]) {
      const sourceDir = path.join(issuesDir, source);
      if (!existsSync(sourceDir)) continue;

      for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const notesFile = path.join(sourceDir, entry.name, "notes.json");
        if (!existsSync(notesFile)) continue;
        try {
          const notes = JSON.parse(readFileSync(notesFile, "utf-8")) as IssueNotes;
          if (notes.linkedWorktreeId) {
            map.set(notes.linkedWorktreeId, { source, issueId: entry.name });
          }
        } catch {
          // Ignore corrupt notes files
        }
      }
    }

    return map;
  }
}
