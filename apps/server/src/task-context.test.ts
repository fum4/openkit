import { generateTaskMd, type TaskContextData, type HooksInfo } from "./task-context";
import { createTestHookStep, createTestHookSkillRef } from "./test/fixtures";

function createTaskData(overrides: Partial<TaskContextData> = {}): TaskContextData {
  return {
    source: "jira",
    issueId: "PROJ-123",
    identifier: "PROJ-123",
    title: "Fix login bug",
    description: "Users cannot log in on mobile",
    status: "In Progress",
    url: "https://jira.example.com/browse/PROJ-123",
    ...overrides,
  };
}

describe("generateTaskMd", () => {
  it("generates basic markdown with header and metadata", () => {
    const data = createTaskData();

    const result = generateTaskMd(data);

    expect(result).toContain("# PROJ-123 — Fix login bug");
    expect(result).toContain("**Source:** jira");
    expect(result).toContain("**Status:** In Progress");
    expect(result).toContain("**URL:** https://jira.example.com/browse/PROJ-123");
  });

  it("includes description section", () => {
    const data = createTaskData({ description: "Detailed description here" });

    const result = generateTaskMd(data);

    expect(result).toContain("## Description");
    expect(result).toContain("Detailed description here");
  });

  it("omits description section when empty", () => {
    const data = createTaskData({ description: "" });

    const result = generateTaskMd(data);

    expect(result).not.toContain("## Description");
  });

  it("includes AI context when provided", () => {
    const data = createTaskData();

    const result = generateTaskMd(data, "Custom AI instructions here");

    expect(result).toContain("## AI Context");
    expect(result).toContain("Custom AI instructions here");
  });

  it("omits AI context when null", () => {
    const data = createTaskData();

    const result = generateTaskMd(data, null);

    expect(result).not.toContain("## AI Context");
  });

  it("includes comments section", () => {
    const data = createTaskData({
      comments: [
        { author: "Alice", body: "This is a comment", created: "2024-01-15T10:00:00Z" },
        { author: "Bob", body: "Another comment" },
      ],
    });

    const result = generateTaskMd(data);

    expect(result).toContain("## Comments");
    expect(result).toContain("**Alice (2024-01-15):** This is a comment");
    expect(result).toContain("**Bob:** Another comment");
  });

  it("includes todos section with checked and unchecked items", () => {
    const todos = [
      { id: "t1", text: "Write tests", checked: false, createdAt: "2024-01-01T00:00:00Z" },
      { id: "t2", text: "Update docs", checked: true, createdAt: "2024-01-01T00:00:00Z" },
    ];

    const result = generateTaskMd(createTaskData(), null, todos);

    expect(result).toContain("## Todos");
    expect(result).toContain("- [ ] Write tests `(todo-id: t1)`");
    expect(result).toContain("- [x] Update docs `(todo-id: t2)`");
  });

  it("includes attachments section when files have local paths", () => {
    const data = createTaskData({
      attachments: [
        { filename: "screenshot.png", localPath: "/tmp/screenshot.png", mimeType: "image/png" },
      ],
    });

    const result = generateTaskMd(data);

    expect(result).toContain("## Attachments");
    expect(result).toContain("`screenshot.png` (image/png) — `/tmp/screenshot.png`");
  });

  it("includes linked resources section", () => {
    const data = createTaskData({
      linkedResources: [
        { title: "Design Doc", url: "https://example.com/doc", sourceType: "confluence" },
      ],
    });

    const result = generateTaskMd(data);

    expect(result).toContain("## Linked Resources");
    expect(result).toContain("[Design Doc](https://example.com/doc) (confluence)");
  });

  it("includes pre-implementation hooks", () => {
    const hooks: HooksInfo = {
      checks: [
        createTestHookStep({
          name: "Type Check",
          command: "pnpm typecheck",
          trigger: "pre-implementation",
        }),
      ],
      skills: [
        createTestHookSkillRef({
          skillName: "code-review",
          trigger: "pre-implementation",
        }),
      ],
    };

    const result = generateTaskMd(createTaskData(), null, undefined, hooks);

    expect(result).toContain("## Hooks (Pre-Implementation)");
    expect(result).toContain("**Type Check:** `pnpm typecheck`");
    expect(result).toContain("### code-review");
  });

  it("includes post-implementation hooks", () => {
    const hooks: HooksInfo = {
      checks: [
        createTestHookStep({
          name: "Lint",
          command: "pnpm lint",
          trigger: "post-implementation",
        }),
      ],
      skills: [],
    };

    const result = generateTaskMd(createTaskData(), null, undefined, hooks);

    expect(result).toContain("## Hooks (Post-Implementation)");
    expect(result).toContain("**Lint:** `pnpm lint`");
  });

  it("includes prompt hooks in pre-implementation section", () => {
    const hooks: HooksInfo = {
      checks: [
        createTestHookStep({
          name: "Review Plan",
          command: "",
          kind: "prompt",
          prompt: "Review the implementation plan",
          trigger: "pre-implementation",
        }),
      ],
      skills: [],
    };

    const result = generateTaskMd(createTaskData(), null, undefined, hooks);

    expect(result).toContain("### Prompt Hooks");
    expect(result).toContain("**Review Plan:** Review the implementation plan");
  });

  it("includes custom condition-based hooks", () => {
    const hooks: HooksInfo = {
      checks: [
        createTestHookStep({
          name: "Run E2E",
          command: "pnpm test:e2e",
          trigger: "custom",
          condition: "When UI components change",
        }),
      ],
      skills: [],
    };

    const result = generateTaskMd(createTaskData(), null, undefined, hooks);

    expect(result).toContain("## Hooks (Custom — Condition-Based)");
    expect(result).toContain("**When:** When UI components change");
    expect(result).toContain("`pnpm test:e2e`");
  });

  it("skips disabled hooks", () => {
    const hooks: HooksInfo = {
      checks: [
        createTestHookStep({
          name: "Disabled Step",
          command: "echo disabled",
          enabled: false,
          trigger: "post-implementation",
        }),
      ],
      skills: [],
    };

    const result = generateTaskMd(createTaskData(), null, undefined, hooks);

    expect(result).not.toContain("Disabled Step");
  });

  it("always includes workflow contract section", () => {
    const result = generateTaskMd(createTaskData());

    expect(result).toContain("## Workflow Contract (Mandatory)");
    expect(result).toContain("openkit activity phase --phase task-started");
  });

  it("ends with auto-generated footer", () => {
    const result = generateTaskMd(createTaskData());

    expect(result).toContain("*Auto-generated by OpenKit.");
  });
});
