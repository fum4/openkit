import { existsSync, readFileSync } from "fs";
import path from "path";

import {
  detectWorktreeId,
  loadIssueDataForContext,
  loadNotesFile,
  resolveEffectiveHooks,
} from "../task";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("../logger", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    plain: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@openkit/agents", () => ({
  formatTaskContext: vi.fn(),
  formatTaskContextJson: vi.fn(),
}));

vi.mock("@openkit/integrations/jira/credentials", () => ({
  loadJiraCredentials: vi.fn(),
  loadJiraProjectConfig: vi.fn(() => ({})),
  saveJiraProjectConfig: vi.fn(),
}));

vi.mock("@openkit/integrations/jira/auth", () => ({
  getApiBase: vi.fn(),
  getAuthHeaders: vi.fn(),
}));

vi.mock("@openkit/integrations/jira/api", () => ({
  resolveTaskKey: vi.fn(),
  fetchIssue: vi.fn(),
  saveTaskData: vi.fn(),
  downloadAttachments: vi.fn(),
}));

vi.mock("@openkit/integrations/linear/credentials", () => ({
  loadLinearCredentials: vi.fn(),
  loadLinearProjectConfig: vi.fn(() => ({})),
  saveLinearProjectConfig: vi.fn(),
}));

vi.mock("@openkit/integrations/linear/api", () => ({
  resolveIdentifier: vi.fn(),
  fetchIssue: vi.fn(),
  fetchIssues: vi.fn(),
  saveTaskData: vi.fn(),
}));

vi.mock("@openkit/server/manager", () => ({
  WorktreeManager: vi.fn(),
}));

vi.mock("@openkit/server/verification-manager", () => ({
  HooksManager: vi.fn(),
}));

vi.mock("@openkit/shared/env-files", () => ({
  copyEnvFiles: vi.fn(),
}));

vi.mock("../config", () => ({
  findConfigDir: vi.fn(),
  loadConfig: vi.fn(() => ({ config: {}, configPath: null })),
  CONFIG_DIR_NAME: ".openkit",
}));

vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
  select: vi.fn(),
}));

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);

describe("detectWorktreeId", () => {
  const originalCwd = process.cwd;

  afterEach(() => {
    process.cwd = originalCwd;
  });

  it("returns correct ID from cwd directly under .openkit/worktrees/<id>", () => {
    process.cwd = () => "/projects/my-app/.openkit/worktrees/ENG-42";

    expect(detectWorktreeId()).toBe("ENG-42");
  });

  it("returns correct ID from subdirectory .openkit/worktrees/<id>/src/foo", () => {
    process.cwd = () => "/projects/my-app/.openkit/worktrees/ENG-42/src/foo";

    expect(detectWorktreeId()).toBe("ENG-42");
  });

  it("returns null when not in a worktree", () => {
    process.cwd = () => "/projects/my-app/src";

    expect(detectWorktreeId()).toBeNull();
  });

  it("returns null when cwd is the root directory", () => {
    process.cwd = () => "/";

    expect(detectWorktreeId()).toBeNull();
  });

  it("returns correct ID when worktree has nested path segments", () => {
    process.cwd = () => "/home/user/code/.openkit/worktrees/PROJ-99/apps/web/src";

    expect(detectWorktreeId()).toBe("PROJ-99");
  });
});

describe("loadIssueDataForContext", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("reads issue.json and maps fields correctly", () => {
    const issueDir = "/project/.openkit/issues/jira/PROJ-123";
    const issueData = {
      identifier: "PROJ-123",
      title: "Fix the bug",
      description: "A detailed description",
      status: "In Progress",
      url: "https://jira.example.com/PROJ-123",
      comments: [{ author: "alice", body: "Looks good", created: "2026-01-01T00:00:00Z" }],
      attachments: [],
      linkedResources: [{ title: "PR", url: "https://github.com/pr/1" }],
    };

    mockedExistsSync.mockImplementation((p) => String(p) === path.join(issueDir, "issue.json"));
    mockedReadFileSync.mockReturnValue(JSON.stringify(issueData));

    const result = loadIssueDataForContext(issueDir, "jira", "PROJ-123");

    expect(result).toEqual({
      source: "jira",
      issueId: "PROJ-123",
      identifier: "PROJ-123",
      title: "Fix the bug",
      description: "A detailed description",
      status: "In Progress",
      url: "https://jira.example.com/PROJ-123",
      comments: issueData.comments,
      attachments: issueData.attachments,
      linkedResources: issueData.linkedResources,
    });
  });

  it("falls back to task.json when issue.json does not exist", () => {
    const issueDir = "/project/.openkit/issues/local/LOCAL-7";
    const taskData = {
      id: "LOCAL-7",
      title: "Local task",
      summary: "A local task",
      description: "Do the thing",
      status: "todo",
      url: "",
    };

    mockedExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === path.join(issueDir, "issue.json")) return false;
      if (s === path.join(issueDir, "task.json")) return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(JSON.stringify(taskData));

    const result = loadIssueDataForContext(issueDir, "local", "LOCAL-7");

    expect(result).not.toBeNull();
    expect(result!.identifier).toBe("LOCAL-7");
    expect(result!.title).toBe("Local task");
    expect(result!.description).toBe("Do the thing");
  });

  it("returns null when neither issue.json nor task.json exists", () => {
    const issueDir = "/project/.openkit/issues/jira/MISSING-1";

    mockedExistsSync.mockReturnValue(false);

    const result = loadIssueDataForContext(issueDir, "jira", "MISSING-1");

    expect(result).toBeNull();
  });

  it("returns null when file contains malformed JSON", () => {
    const issueDir = "/project/.openkit/issues/jira/BAD-1";

    mockedExistsSync.mockImplementation((p) => String(p) === path.join(issueDir, "issue.json"));
    mockedReadFileSync.mockReturnValue("not valid json {{{");

    const result = loadIssueDataForContext(issueDir, "jira", "BAD-1");

    expect(result).toBeNull();
  });

  it("uses summary field as title fallback when title is missing", () => {
    const issueDir = "/project/.openkit/issues/jira/PROJ-5";
    const issueData = {
      key: "PROJ-5",
      summary: "Summary as title",
      description: "",
      status: "Open",
      url: "",
    };

    mockedExistsSync.mockImplementation((p) => String(p) === path.join(issueDir, "issue.json"));
    mockedReadFileSync.mockReturnValue(JSON.stringify(issueData));

    const result = loadIssueDataForContext(issueDir, "jira", "PROJ-5");

    expect(result).not.toBeNull();
    expect(result!.identifier).toBe("PROJ-5");
    expect(result!.title).toBe("Summary as title");
  });
});

describe("loadNotesFile", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns parsed notes when file exists", () => {
    const issueDir = "/project/.openkit/issues/jira/PROJ-1";
    const notesData = {
      aiContext: { content: "Some context" },
      todos: [{ id: "t1", text: "Do stuff", checked: false, createdAt: "2026-01-01" }],
      hookSkills: { "post-implementation:testing": "disable" },
    };

    mockedExistsSync.mockImplementation((p) => String(p) === path.join(issueDir, "notes.json"));
    mockedReadFileSync.mockReturnValue(JSON.stringify(notesData));

    const result = loadNotesFile(issueDir);

    expect(result).toEqual(notesData);
  });

  it("returns empty object when notes.json does not exist", () => {
    const issueDir = "/project/.openkit/issues/jira/PROJ-2";

    mockedExistsSync.mockReturnValue(false);

    const result = loadNotesFile(issueDir);

    expect(result).toEqual({});
  });

  it("returns empty object when notes.json is malformed", () => {
    const issueDir = "/project/.openkit/issues/jira/PROJ-3";

    mockedExistsSync.mockImplementation((p) => String(p) === path.join(issueDir, "notes.json"));
    mockedReadFileSync.mockReturnValue("broken {json");

    const result = loadNotesFile(issueDir);

    expect(result).toEqual({});
  });
});

describe("resolveEffectiveHooks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns null when no hooks.json exists", () => {
    mockedExistsSync.mockReturnValue(false);

    const result = resolveEffectiveHooks("/project", {});

    expect(result).toBeNull();
  });

  it("returns hooks without overrides when notes have no hookSkills", () => {
    const hooksConfig = {
      steps: [
        {
          id: "s1",
          name: "Lint",
          command: "pnpm lint",
          enabled: true,
          trigger: "post-implementation",
        },
      ],
      skills: [{ skillName: "testing", enabled: true, trigger: "post-implementation" }],
    };

    mockedExistsSync.mockImplementation(
      (p) => String(p) === path.join("/project", ".openkit", "hooks.json"),
    );
    mockedReadFileSync.mockReturnValue(JSON.stringify(hooksConfig));

    const result = resolveEffectiveHooks("/project", {});

    expect(result).not.toBeNull();
    expect(result!.checks).toHaveLength(1);
    expect(result!.checks[0].name).toBe("Lint");
    expect(result!.skills).toHaveLength(1);
    expect(result!.skills[0].skillName).toBe("testing");
    expect(result!.skills[0].enabled).toBe(true);
  });

  it("applies enable override to a disabled skill", () => {
    const hooksConfig = {
      steps: [],
      skills: [{ skillName: "testing", enabled: false, trigger: "post-implementation" }],
    };

    mockedExistsSync.mockImplementation(
      (p) => String(p) === path.join("/project", ".openkit", "hooks.json"),
    );
    mockedReadFileSync.mockReturnValue(JSON.stringify(hooksConfig));

    const result = resolveEffectiveHooks("/project", {
      hookSkills: { "post-implementation:testing": "enable" },
    });

    expect(result).not.toBeNull();
    expect(result!.skills[0].enabled).toBe(true);
  });

  it("applies disable override to an enabled skill", () => {
    const hooksConfig = {
      steps: [],
      skills: [{ skillName: "review", enabled: true, trigger: "pre-implementation" }],
    };

    mockedExistsSync.mockImplementation(
      (p) => String(p) === path.join("/project", ".openkit", "hooks.json"),
    );
    mockedReadFileSync.mockReturnValue(JSON.stringify(hooksConfig));

    const result = resolveEffectiveHooks("/project", {
      hookSkills: { "pre-implementation:review": "disable" },
    });

    expect(result).not.toBeNull();
    expect(result!.skills[0].enabled).toBe(false);
  });

  it("uses post-implementation as default trigger for skills without trigger", () => {
    const hooksConfig = {
      steps: [],
      skills: [{ skillName: "deploy", enabled: true }],
    };

    mockedExistsSync.mockImplementation(
      (p) => String(p) === path.join("/project", ".openkit", "hooks.json"),
    );
    mockedReadFileSync.mockReturnValue(JSON.stringify(hooksConfig));

    const result = resolveEffectiveHooks("/project", {
      hookSkills: { "post-implementation:deploy": "disable" },
    });

    expect(result).not.toBeNull();
    expect(result!.skills[0].enabled).toBe(false);
  });

  it("returns null when hooks.json is malformed", () => {
    mockedExistsSync.mockImplementation(
      (p) => String(p) === path.join("/project", ".openkit", "hooks.json"),
    );
    mockedReadFileSync.mockReturnValue("not json");

    const result = resolveEffectiveHooks("/project", {});

    expect(result).toBeNull();
  });

  it("handles missing steps and skills keys gracefully", () => {
    mockedExistsSync.mockImplementation(
      (p) => String(p) === path.join("/project", ".openkit", "hooks.json"),
    );
    mockedReadFileSync.mockReturnValue(JSON.stringify({}));

    const result = resolveEffectiveHooks("/project", {});

    expect(result).not.toBeNull();
    expect(result!.checks).toEqual([]);
    expect(result!.skills).toEqual([]);
  });
});
