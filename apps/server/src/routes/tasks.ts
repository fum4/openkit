import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
  statSync,
} from "fs";
import { Hono } from "hono";
import path from "path";

import { CONFIG_DIR_NAME } from "@openkit/shared/constants";
import { log } from "../logger";
import type { WorktreeManager } from "../manager";
import type { NotesManager } from "../notes-manager";
import { generateBranchName } from "../branch-name";
import { regenerateTaskMd } from "../task-context";
import type { HooksManager } from "../verification-manager";

const taskLog = log.get("task");

interface CustomTask {
  id: string;
  title: string;
  description: string;
  status: "todo" | "in-progress" | "done";
  priority: "high" | "medium" | "low";
  labels: string[];
  createdAt: string;
  updatedAt: string;
}

function getTasksDir(configDir: string): string {
  return path.join(configDir, ".openkit", "issues", "local");
}

function ensureTasksDir(configDir: string): string {
  const dir = getTasksDir(configDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getNextIdentifier(
  configDir: string,
  prefix = "LOCAL",
): {
  identifier: string;
  counterBefore: number;
  counterAfter: number;
  collisionsSkipped: number;
} {
  const counterFile = path.join(ensureTasksDir(configDir), ".counter");
  let counter = 0;
  if (existsSync(counterFile)) {
    counter = parseInt(readFileSync(counterFile, "utf-8").trim(), 10) || 0;
  }
  const counterBefore = counter;
  let collisionsSkipped = 0;
  let identifier = "";
  while (true) {
    counter++;
    identifier = prefix ? `${prefix}-${counter}` : String(counter);
    const taskDir = path.join(getTasksDir(configDir), identifier);
    if (!existsSync(taskDir)) break;
    collisionsSkipped++;
  }
  writeFileSync(counterFile, String(counter));
  return {
    identifier,
    counterBefore,
    counterAfter: counter,
    collisionsSkipped,
  };
}

function readCounterValue(configDir: string): number {
  const counterFile = path.join(ensureTasksDir(configDir), ".counter");
  if (!existsSync(counterFile)) return 0;
  return parseInt(readFileSync(counterFile, "utf-8").trim(), 10) || 0;
}

function writeCounterValue(configDir: string, value: number): void {
  const counterFile = path.join(ensureTasksDir(configDir), ".counter");
  writeFileSync(counterFile, String(value));
}

function ensureCounterAtLeast(configDir: string, minimumValue: number): void {
  const current = readCounterValue(configDir);
  if (current >= minimumValue) return;
  writeCounterValue(configDir, minimumValue);
}

function loadTask(configDir: string, id: string): CustomTask | null {
  const filePath = path.join(getTasksDir(configDir), id, "task.json");
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8")) as CustomTask;
}

function saveTask(configDir: string, task: CustomTask): void {
  const dir = path.join(ensureTasksDir(configDir), task.id);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "task.json"), JSON.stringify(task, null, 2));
}

interface TaskAttachment {
  filename: string;
  mimeType: string;
  size: number;
  localPath: string;
  createdAt: string;
}

function getAttachmentsDir(configDir: string, taskId: string): string {
  return path.join(getTasksDir(configDir), taskId, "attachments");
}

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".xml": "application/xml",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".tar": "application/x-tar",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".ts": "text/typescript",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function mimeFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

function listAttachments(configDir: string, taskId: string): TaskAttachment[] {
  const dir = getAttachmentsDir(configDir, taskId);
  if (!existsSync(dir)) return [];

  const attachments: TaskAttachment[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const filePath = path.join(dir, entry);
    const stat = statSync(filePath);
    if (!stat.isFile()) continue;
    attachments.push({
      filename: entry,
      mimeType: mimeFromFilename(entry),
      size: stat.size,
      localPath: filePath,
      createdAt: stat.birthtime.toISOString(),
    });
  }
  return attachments;
}

function loadAllTasks(configDir: string): CustomTask[] {
  const dir = getTasksDir(configDir);
  if (!existsSync(dir)) return [];

  const tasks: CustomTask[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const task = loadTask(configDir, entry.name);
    if (task) tasks.push(task);
  }

  return tasks.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function registerTaskRoutes(
  app: Hono,
  manager: WorktreeManager,
  notesManager: NotesManager,
  hooksManager?: HooksManager,
) {
  const configDir = manager.getConfigDir();
  const worktreesPath = path.join(configDir, CONFIG_DIR_NAME, "worktrees");
  const getProjectName = () => manager.getProjectName() ?? undefined;
  const getHooksSnapshot = (worktreeId: string) => {
    if (!hooksManager) {
      log.warn("hooksManager not provided to registerTaskRoutes — hooks will be skipped", {
        domain: "tasks",
        worktreeId,
      });
      return undefined;
    }
    const config = hooksManager.getConfig();
    const effectiveSkills = hooksManager.getEffectiveSkills(worktreeId, notesManager);
    return {
      checks: config.steps,
      skills: effectiveSkills,
    };
  };
  const logTaskEvent = (options: {
    action: string;
    message: string;
    status?: "info" | "success" | "failed";
    level?: "debug" | "info" | "warning" | "error";
    worktreeId?: string;
    metadata?: Record<string, unknown>;
  }) => {
    const level = options.level ?? (options.status === "failed" ? "error" : "info");
    const context = {
      domain: "task",
      action: options.action,
      status: options.status ?? "info",
      worktreeId: options.worktreeId,
      projectName: getProjectName(),
      ...options.metadata,
    };
    switch (level) {
      case "error":
        taskLog.error(options.message, context);
        break;
      case "warning":
        taskLog.warn(options.message, context);
        break;
      case "debug":
        taskLog.debug(options.message, context);
        break;
      default:
        if (options.status === "success") {
          taskLog.success(options.message, context);
        } else {
          taskLog.info(options.message, context);
        }
    }
  };
  const toResolutionStatus = (code: "WORKTREE_NOT_FOUND" | "WORKTREE_ID_AMBIGUOUS"): 404 | 409 =>
    code === "WORKTREE_ID_AMBIGUOUS" ? 409 : 404;
  const resolveActiveLinkedWorktreeId = (taskId: string): string | null => {
    const notes = notesManager.loadNotes("local", taskId);
    if (!notes.linkedWorktreeId) return null;
    const resolved = manager.resolveWorktreeId(notes.linkedWorktreeId);
    if (resolved.success) {
      if (resolved.worktreeId !== notes.linkedWorktreeId) {
        notesManager.setLinkedWorktreeId("local", taskId, resolved.worktreeId);
      }
      return resolved.worktreeId;
    }
    notesManager.setLinkedWorktreeId("local", taskId, null);
    return null;
  };

  // List all custom tasks — enrich with linkedWorktreeId from notes
  app.get("/api/tasks", (c) => {
    const tasks = loadAllTasks(configDir);
    const enriched = tasks.map((task) => {
      const attachments = listAttachments(configDir, task.id);
      return {
        ...task,
        linkedWorktreeId: resolveActiveLinkedWorktreeId(task.id),
        attachmentCount: attachments.length,
      };
    });
    return c.json({ tasks: enriched });
  });

  // Get single task — enrich with linkedWorktreeId from notes + attachments
  app.get("/api/tasks/:id", (c) => {
    const task = loadTask(configDir, c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);
    const attachments = listAttachments(configDir, task.id);
    return c.json({
      task: {
        ...task,
        linkedWorktreeId: resolveActiveLinkedWorktreeId(task.id),
        attachments,
      },
    });
  });

  // Create task
  app.post("/api/tasks", async (c) => {
    const body = await c.req.json<{
      title?: string;
      description?: string;
      priority?: string;
      labels?: string[];
      linkedWorktreeId?: string;
    }>();

    if (!body.title?.trim()) {
      return c.json({ success: false, error: "Title is required" }, 400);
    }

    const now = new Date().toISOString();
    const nextIdentifier = getNextIdentifier(configDir, manager.getConfig().localIssuePrefix);
    const identifier = nextIdentifier.identifier;
    const task: CustomTask = {
      id: identifier,
      title: body.title.trim(),
      description: body.description?.trim() ?? "",
      status: "todo",
      priority: (["high", "medium", "low"].includes(body.priority ?? "")
        ? body.priority
        : "medium") as CustomTask["priority"],
      labels: Array.isArray(body.labels)
        ? body.labels.map((l) => String(l).trim()).filter(Boolean)
        : [],
      createdAt: now,
      updatedAt: now,
    };

    const linkedWorktreeId = body.linkedWorktreeId ?? null;

    saveTask(configDir, task);
    // Create notes.json alongside (optionally linking to a worktree)
    notesManager.saveNotes("local", task.id, {
      linkedWorktreeId,
      personal: null,
      aiContext: null,
      todos: [],
    });

    logTaskEvent({
      action: "task.create",
      message: `Created local task ${identifier}`,
      status: "success",
      metadata: {
        taskId: identifier,
        counterBefore: nextIdentifier.counterBefore,
        counterAfter: nextIdentifier.counterAfter,
        collisionsSkipped: nextIdentifier.collisionsSkipped,
        linkedWorktreeId,
      },
    });

    return c.json({ success: true, task: { ...task, linkedWorktreeId } });
  });

  app.post("/api/tasks/recover-local", async (c) => {
    const body = await c.req.json<{
      taskId?: string;
      title?: string;
      description?: string;
      priority?: string;
      labels?: string[];
    }>();

    const rawTaskId = body.taskId?.trim() ?? "";
    if (!rawTaskId) {
      return c.json({ success: false, error: "taskId is required" }, 400);
    }

    const prefix = manager.getConfig().localIssuePrefix?.trim() || "LOCAL";
    const prefixUpper = `${prefix.toUpperCase()}-`;
    const upperTaskId = rawTaskId.toUpperCase();
    if (!upperTaskId.startsWith(prefixUpper)) {
      return c.json(
        {
          success: false,
          error: `taskId must start with "${prefix}-"`,
        },
        400,
      );
    }

    const numericPartRaw = rawTaskId.slice(prefix.length + 1).trim();
    if (!/^\d+$/.test(numericPartRaw)) {
      return c.json({ success: false, error: "taskId must end with a numeric suffix" }, 400);
    }
    const numericPart = parseInt(numericPartRaw, 10);
    if (!Number.isFinite(numericPart) || numericPart <= 0) {
      return c.json({ success: false, error: "taskId suffix must be a positive number" }, 400);
    }

    const canonicalTaskId = `${prefix}-${numericPart}`;
    const taskDir = path.join(getTasksDir(configDir), canonicalTaskId);
    if (existsSync(taskDir)) {
      return c.json({ success: false, error: `Task "${canonicalTaskId}" already exists` }, 409);
    }

    const resolved = manager.resolveWorktreeId(canonicalTaskId);
    if (!resolved.success) {
      return c.json({ success: false, error: resolved.error }, toResolutionStatus(resolved.code));
    }

    const now = new Date().toISOString();
    const task: CustomTask = {
      id: canonicalTaskId,
      title: body.title?.trim() || `Recovered task ${canonicalTaskId}`,
      description: body.description?.trim() ?? "",
      status: "todo",
      priority: (["high", "medium", "low"].includes(body.priority ?? "")
        ? body.priority
        : "medium") as CustomTask["priority"],
      labels: Array.isArray(body.labels)
        ? body.labels.map((label) => String(label).trim()).filter(Boolean)
        : [],
      createdAt: now,
      updatedAt: now,
    };

    saveTask(configDir, task);
    notesManager.saveNotes("local", task.id, {
      linkedWorktreeId: resolved.worktreeId,
      personal: null,
      aiContext: null,
      todos: [],
    });
    ensureCounterAtLeast(configDir, numericPart);

    logTaskEvent({
      action: "task.recover",
      message: `Recovered local task ${canonicalTaskId}`,
      status: "success",
      worktreeId: resolved.worktreeId,
      metadata: {
        taskId: canonicalTaskId,
        linkedWorktreeId: resolved.worktreeId,
        counterAfter: readCounterValue(configDir),
      },
    });

    return c.json({
      success: true,
      task: { ...task, linkedWorktreeId: resolved.worktreeId },
      linkedWorktreeId: resolved.worktreeId,
    });
  });

  // Update task
  app.patch("/api/tasks/:id", async (c) => {
    const task = loadTask(configDir, c.req.param("id"));
    if (!task) return c.json({ success: false, error: "Task not found" }, 404);

    const body = await c.req.json<
      Partial<{
        title: string;
        description: string;
        status: string;
        priority: string;
        labels: string[];
      }>
    >();

    if (body.title !== undefined) task.title = body.title.trim();
    if (body.description !== undefined) task.description = body.description;
    if (body.status !== undefined && ["todo", "in-progress", "done"].includes(body.status)) {
      task.status = body.status as CustomTask["status"];
    }
    if (body.priority !== undefined && ["high", "medium", "low"].includes(body.priority)) {
      task.priority = body.priority as CustomTask["priority"];
    }
    if (body.labels !== undefined) {
      task.labels = body.labels.map((l) => String(l).trim()).filter(Boolean);
    }

    task.updatedAt = new Date().toISOString();
    saveTask(configDir, task);

    // Regenerate TASK.md in linked worktree when task content changes
    const linkedWorktreeId = resolveActiveLinkedWorktreeId(task.id);
    if (linkedWorktreeId) {
      try {
        regenerateTaskMd(
          "local",
          task.id,
          linkedWorktreeId,
          notesManager,
          configDir,
          worktreesPath,
          getHooksSnapshot(linkedWorktreeId),
        );
      } catch (err) {
        // Non-critical — don't fail the task update, but log for diagnosability
        logTaskEvent({
          action: "task.regenerate-taskmd",
          message: `Failed to regenerate TASK.md for task ${task.id}`,
          level: "warning",
          status: "failed",
          worktreeId: linkedWorktreeId,
          metadata: {
            taskId: task.id,
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }

    logTaskEvent({
      action: "task.update",
      message: `Updated local task ${task.id}`,
      status: "success",
      metadata: {
        taskId: task.id,
        status: task.status,
        priority: task.priority,
        labelCount: task.labels.length,
      },
    });

    return c.json({
      success: true,
      task: { ...task, linkedWorktreeId },
    });
  });

  // Delete task
  app.delete("/api/tasks/:id", (c) => {
    const id = c.req.param("id");
    const taskDir = path.join(getTasksDir(configDir), id);
    if (!existsSync(taskDir)) return c.json({ success: false, error: "Task not found" }, 404);

    rmSync(taskDir, { recursive: true });
    logTaskEvent({
      action: "task.delete",
      message: `Deleted local task ${id}`,
      status: "success",
      metadata: { taskId: id },
    });
    return c.json({ success: true });
  });

  // Create worktree from custom task
  app.post("/api/tasks/:id/create-worktree", async (c) => {
    const task = loadTask(configDir, c.req.param("id"));
    if (!task) return c.json({ success: false, error: "Task not found" }, 404);

    const body = await c.req.json<{ branch?: string }>().catch(() => ({ branch: undefined }));

    // Use custom branch or generated name from rule
    const branchName =
      body.branch ||
      (await generateBranchName(configDir, { issueId: task.id, name: task.title, type: "local" }));

    logTaskEvent({
      action: "task.create-worktree",
      message: `Creating worktree from local task ${task.id}`,
      status: "info",
      metadata: {
        taskId: task.id,
        branchName,
        hasCustomBranchOverride: Boolean(body.branch),
      },
    });

    // Load AI context notes
    const notes = notesManager.loadNotes("local", task.id);
    const aiContext = notes.aiContext?.content ?? null;

    // Get attachments for TASK.md
    const attachments = listAttachments(configDir, task.id);

    // Set pending context so TASK.md gets written after worktree creation
    manager.setPendingWorktreeContext(task.id, {
      data: {
        source: "local",
        issueId: task.id,
        identifier: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        url: "",
        attachments:
          attachments.length > 0
            ? attachments.map((a) => ({
                filename: a.filename,
                localPath: a.localPath,
                mimeType: a.mimeType,
              }))
            : undefined,
      },
      aiContext,
    });

    try {
      const taskId = task.id;
      const result = await manager.createWorktree(
        { branch: branchName, name: taskId },
        {
          onSuccess: (createdWorktreeId) => {
            // Link worktree via notes.json only after async creation actually succeeds
            notesManager.setLinkedWorktreeId("local", taskId, createdWorktreeId);
          },
        },
      );

      if (!result.success) {
        manager.clearPendingWorktreeContext(taskId);
        if (result.code === "WORKTREE_EXISTS" && result.worktreeId) {
          const canonicalWorktreeId = result.worktreeId;
          logTaskEvent({
            action: "task.create-worktree",
            message: `Reused existing worktree for local task ${taskId}`,
            status: "success",
            worktreeId: canonicalWorktreeId,
            metadata: {
              taskId,
              branchName,
              code: result.code,
              worktreeId: canonicalWorktreeId,
              reusedExisting: true,
            },
          });
          notesManager.setLinkedWorktreeId("local", taskId, canonicalWorktreeId);
          return c.json({
            success: true,
            reusedExisting: true,
            worktreeId: canonicalWorktreeId,
            worktreePath: path.join(configDir, ".openkit", "worktrees", canonicalWorktreeId),
          });
        }
      }

      if (result.success) {
        logTaskEvent({
          action: "task.create-worktree",
          message: `Created worktree for local task ${taskId}`,
          status: "success",
          worktreeId: result.worktree?.id,
          metadata: {
            taskId,
            branchName,
            worktreeId: result.worktree?.id ?? null,
            reusedExisting: false,
          },
        });
        return c.json({ ...result, reusedExisting: false });
      }
      logTaskEvent({
        action: "task.create-worktree",
        message: `Failed to create worktree for local task ${taskId}`,
        status: "failed",
        worktreeId: result.worktreeId,
        metadata: {
          taskId,
          branchName,
          code: result.code,
          error: result.error,
          worktreeId: result.worktreeId,
        },
      });
      return c.json(result);
    } catch (err) {
      manager.clearPendingWorktreeContext(task.id);
      logTaskEvent({
        action: "task.create-worktree",
        message: `Worktree creation threw for local task ${task.id}`,
        status: "failed",
        metadata: {
          taskId: task.id,
          branchName,
          error: err instanceof Error ? err.message : "Failed to create worktree",
        },
      });
      return c.json({
        success: false,
        error: err instanceof Error ? err.message : "Failed to create worktree",
      });
    }
  });

  // Upload attachment to a task
  app.post("/api/tasks/:id/attachments", async (c) => {
    const task = loadTask(configDir, c.req.param("id"));
    if (!task) return c.json({ success: false, error: "Task not found" }, 404);

    const body = await c.req.parseBody();
    const file = body["file"];
    if (!file || !(file instanceof File)) {
      return c.json({ success: false, error: "No file uploaded" }, 400);
    }

    const dir = getAttachmentsDir(configDir, task.id);
    mkdirSync(dir, { recursive: true });

    // Deduplicate filename
    let filename = file.name;
    if (existsSync(path.join(dir, filename))) {
      const ext = path.extname(filename);
      const base = path.basename(filename, ext);
      let counter = 1;
      while (existsSync(path.join(dir, `${base}_${counter}${ext}`))) counter++;
      filename = `${base}_${counter}${ext}`;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    writeFileSync(path.join(dir, filename), buffer);

    logTaskEvent({
      action: "task.attachment.upload",
      message: `Uploaded attachment for local task ${task.id}`,
      status: "success",
      metadata: {
        taskId: task.id,
        filename,
        mimeType: mimeFromFilename(filename),
        size: buffer.length,
      },
    });

    return c.json({
      success: true,
      attachment: {
        filename,
        mimeType: mimeFromFilename(filename),
        size: buffer.length,
        localPath: path.join(dir, filename),
      },
    });
  });

  // Serve attachment file
  app.get("/api/tasks/:id/attachments/:filename", (c) => {
    const id = c.req.param("id");
    const filename = c.req.param("filename");
    const filePath = path.join(getAttachmentsDir(configDir, id), filename);

    if (!existsSync(filePath)) {
      return c.json({ error: "Attachment not found" }, 404);
    }

    const mimeType = mimeFromFilename(filename);
    const data = readFileSync(filePath);
    return new Response(data, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  });

  // Delete attachment
  app.delete("/api/tasks/:id/attachments/:filename", (c) => {
    const id = c.req.param("id");
    const filename = c.req.param("filename");
    const filePath = path.join(getAttachmentsDir(configDir, id), filename);

    if (!existsSync(filePath)) {
      return c.json({ success: false, error: "Attachment not found" }, 404);
    }

    rmSync(filePath);
    logTaskEvent({
      action: "task.attachment.delete",
      message: `Deleted attachment from local task ${id}`,
      status: "success",
      metadata: {
        taskId: id,
        filename,
      },
    });
    return c.json({ success: true });
  });
}
