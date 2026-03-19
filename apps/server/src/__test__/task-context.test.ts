import { describe, expect, it } from "vitest";
import { formatTaskContext, formatTaskContextJson } from "@openkit/agents";
import type { TaskContextData, HooksInfo } from "@openkit/agents";

function makeData(overrides?: Partial<TaskContextData>): TaskContextData {
  return {
    source: "local",
    issueId: "LOCAL-1",
    identifier: "LOCAL-1",
    title: "Test task",
    description: "A test description",
    status: "todo",
    url: "",
    ...overrides,
  };
}

describe("formatTaskContext", () => {
  it("renders header with identifier and title", () => {
    const md = formatTaskContext(makeData());
    expect(md).toContain("# LOCAL-1 — Test task");
    expect(md).toContain("**Source:** local");
    expect(md).toContain("**Status:** todo");
  });

  it("does not include workflow contract boilerplate", () => {
    const md = formatTaskContext(makeData());
    expect(md).not.toContain("Workflow Contract");
    expect(md).not.toContain("Agent Communication");
    expect(md).not.toContain("openkit activity phase");
  });

  it("renders extra context when provided", () => {
    const md = formatTaskContext(makeData(), "Follow TDD strictly");
    expect(md).toContain("## Extra Context");
    expect(md).toContain("take priority over the description and comments");
    expect(md).toContain("Follow TDD strictly");
  });

  it("omits extra context section when null", () => {
    const md = formatTaskContext(makeData(), null);
    expect(md).not.toContain("## Extra Context");
  });

  it("renders description", () => {
    const md = formatTaskContext(makeData({ description: "Fix the bug" }));
    expect(md).toContain("## Description");
    expect(md).toContain("Fix the bug");
  });

  it("renders comments with dates and guidance", () => {
    const md = formatTaskContext(
      makeData({
        comments: [{ author: "Alice", body: "Looks good", created: "2026-03-15T10:00:00Z" }],
      }),
    );
    expect(md).toContain("Discussion history from the issue tracker");
    expect(md).toContain("**Alice (2026-03-15):** Looks good");
  });

  it("renders todos with checkbox syntax", () => {
    const md = formatTaskContext(makeData(), null, [
      { id: "t1", text: "First", checked: false, createdAt: "2026-01-01T00:00:00Z" },
      { id: "t2", text: "Second", checked: true, createdAt: "2026-01-01T00:00:00Z" },
    ]);
    expect(md).toContain("- [ ] First `(todo-id: t1)`");
    expect(md).toContain("- [x] Second `(todo-id: t2)`");
  });

  it("renders attachments with local paths", () => {
    const md = formatTaskContext(
      makeData({
        attachments: [{ filename: "img.png", localPath: "/tmp/img.png", mimeType: "image/png" }],
      }),
    );
    expect(md).toContain("`img.png` (image/png)");
  });

  it("renders pre-implementation hooks", () => {
    const hooks: HooksInfo = {
      checks: [
        {
          id: "s1",
          name: "Lint",
          command: "pnpm lint",
          enabled: true,
          trigger: "pre-implementation",
        },
      ],
      skills: [],
    };
    const md = formatTaskContext(makeData(), null, undefined, hooks);
    expect(md).toContain("## Hooks (Pre-Implementation)");
    expect(md).toContain("**Lint:** `pnpm lint`");
  });

  it("renders post-implementation hooks", () => {
    const hooks: HooksInfo = {
      checks: [
        {
          id: "s1",
          name: "Test",
          command: "pnpm test",
          enabled: true,
          trigger: "post-implementation",
        },
      ],
      skills: [],
    };
    const md = formatTaskContext(makeData(), null, undefined, hooks);
    expect(md).toContain("## Hooks (Post-Implementation)");
    expect(md).toContain("**Test:** `pnpm test`");
  });

  it("renders prompt hooks separately from command hooks", () => {
    const hooks: HooksInfo = {
      checks: [
        {
          id: "s1",
          name: "Lint",
          command: "pnpm lint",
          enabled: true,
          trigger: "pre-implementation",
        },
        {
          id: "s2",
          name: "Review plan",
          command: "",
          prompt: "Review the plan before coding",
          kind: "prompt",
          enabled: true,
          trigger: "pre-implementation",
        },
      ],
      skills: [],
    };
    const md = formatTaskContext(makeData(), null, undefined, hooks);
    expect(md).toContain("### Pipeline Checks");
    expect(md).toContain("### Prompt Hooks");
    expect(md).toContain("**Review plan:** Review the plan before coding");
  });

  it("does not include auto-generated footer", () => {
    const md = formatTaskContext(makeData());
    expect(md).not.toContain("Auto-generated");
  });
});

describe("formatTaskContextJson", () => {
  it("returns structured object with reshaped hooks", () => {
    const hooks: HooksInfo = {
      checks: [
        {
          id: "s1",
          name: "Lint",
          command: "pnpm lint",
          enabled: true,
          trigger: "pre-implementation",
        },
        { id: "s2", name: "Test", command: "pnpm test", enabled: true },
      ],
      skills: [{ skillName: "my-skill", enabled: true, trigger: "pre-implementation" }],
    };
    const result = formatTaskContextJson(
      makeData(),
      "ctx",
      [{ id: "t1", text: "Do it", checked: false, createdAt: "2026-01-01T00:00:00Z" }],
      hooks,
    );
    expect(result.identifier).toBe("LOCAL-1");
    expect(result.aiContext).toBe("ctx");
    expect(result.hooks.pre.commands).toHaveLength(1);
    expect(result.hooks.pre.skills).toHaveLength(1);
    expect(result.hooks.post.commands).toHaveLength(1);
  });

  it("places prompt hooks in prompts array, not commands", () => {
    const hooks: HooksInfo = {
      checks: [
        {
          id: "s1",
          name: "Review",
          command: "",
          prompt: "Review the plan",
          kind: "prompt",
          enabled: true,
          trigger: "pre-implementation",
        },
      ],
      skills: [],
    };
    const result = formatTaskContextJson(makeData(), null, undefined, hooks);
    expect(result.hooks.pre.prompts).toHaveLength(1);
    expect(result.hooks.pre.prompts[0].name).toBe("Review");
    expect(result.hooks.pre.commands).toHaveLength(0);
  });
});
