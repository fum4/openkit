import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { actions } from "../actions";
import type { ActionContext, ActionParam } from "../actions";
import { APP_NAME } from "../constants";
import { MCP_INSTRUCTIONS, MCP_WORK_ON_TASK_PROMPT } from "../instructions";
import { APP_VERSION } from "../version";
import type { ActivityCategory, ActivitySeverity } from "./activity-event";

function toZodType(param: ActionParam) {
  let schema: z.ZodTypeAny;
  switch (param.type) {
    case "number":
      schema = z.number();
      break;
    case "boolean":
      schema = z.boolean();
      break;
    default:
      schema = z.string();
      break;
  }
  schema = schema.describe(param.description);
  if (!param.required) schema = schema.optional();
  return schema;
}

function buildZodShape(params: Record<string, ActionParam>): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, param] of Object.entries(params)) {
    shape[key] = toZodType(param);
  }
  return shape;
}

// Maps tool names to activity events emitted after successful/failed execution
const TRACKED_TOOLS: Record<
  string,
  {
    category: ActivityCategory;
    success: {
      type: string;
      severity: ActivitySeverity;
      title: (params: Record<string, unknown>) => string;
    };
    failure?: {
      type: string;
      severity: ActivitySeverity;
      title: (params: Record<string, unknown>, err: string) => string;
    };
  }
> = {
  commit: {
    category: "agent",
    success: {
      type: "commit_completed",
      severity: "success",
      title: (p) => `Committed in ${p.id}`,
    },
    failure: {
      type: "commit_failed",
      severity: "error",
      title: (p, err) => `Commit failed in ${p.id}: ${err}`,
    },
  },
  push: {
    category: "agent",
    success: { type: "push_completed", severity: "success", title: (p) => `Pushed ${p.id}` },
    failure: {
      type: "push_failed",
      severity: "error",
      title: (p, err) => `Push failed in ${p.id}: ${err}`,
    },
  },
  create_pr: {
    category: "agent",
    success: { type: "pr_created", severity: "success", title: (p) => `PR created for ${p.id}` },
  },
};

export function createMcpServer(ctx: ActionContext): McpServer {
  const projectName = ctx.manager.getProjectName() ?? undefined;

  const server = new McpServer(
    { name: APP_NAME, version: APP_VERSION },
    { instructions: MCP_INSTRUCTIONS },
  );

  for (const action of actions) {
    const zodShape = buildZodShape(action.params);

    server.tool(action.name, action.description, zodShape, async (params) => {
      try {
        const result = await action.handler(ctx, params as Record<string, unknown>);

        // Auto-emit activity for tracked tools
        const tracking = TRACKED_TOOLS[action.name];
        if (tracking && ctx.activityLog) {
          // Check if the result indicates failure (has success: false)
          const resultObj = result as Record<string, unknown> | null;
          if (resultObj && resultObj.success === false && tracking.failure) {
            const errMsg = (resultObj.error as string) || "Unknown error";
            ctx.activityLog.addEvent({
              category: tracking.category,
              type: tracking.failure.type,
              severity: tracking.failure.severity,
              title: tracking.failure.title(params as Record<string, unknown>, errMsg),
              worktreeId:
                ((params as Record<string, unknown>).id as string | undefined) ??
                ((params as Record<string, unknown>).worktreeId as string | undefined),
              projectName,
            });
          } else {
            ctx.activityLog.addEvent({
              category: tracking.category,
              type: tracking.success.type,
              severity: tracking.success.severity,
              title: tracking.success.title(params as Record<string, unknown>),
              worktreeId:
                ((params as Record<string, unknown>).id as string | undefined) ??
                ((params as Record<string, unknown>).worktreeId as string | undefined),
              projectName,
            });
          }
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        // Emit failure activity for tracked tools
        const tracking = TRACKED_TOOLS[action.name];
        if (tracking?.failure && ctx.activityLog) {
          const errMsg = err instanceof Error ? err.message : String(err);
          ctx.activityLog.addEvent({
            category: tracking.category,
            type: tracking.failure.type,
            severity: tracking.failure.severity,
            title: tracking.failure.title(params as Record<string, unknown>, errMsg),
            worktreeId:
              ((params as Record<string, unknown>).id as string | undefined) ??
              ((params as Record<string, unknown>).worktreeId as string | undefined),
            projectName,
          });
        }

        return {
          isError: true,
          content: [
            { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
          ],
        };
      }
    });
  }

  server.prompt(
    "work-on-task",
    "Create a worktree from an issue and start working on it",
    { issueId: z.string().describe("Issue ID (e.g., PROJ-123, ENG-42, or just a number)") },
    async ({ issueId }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: MCP_WORK_ON_TASK_PROMPT.replace("{{ISSUE_ID}}", issueId),
          },
        },
      ],
    }),
  );

  return server;
}
