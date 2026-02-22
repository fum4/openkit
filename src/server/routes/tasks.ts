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

import type { WorktreeManager } from "../manager";
import type { NotesManager } from "../notes-manager";
import { generateBranchName } from "../branch-name";

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

function getNextIdentifier(configDir: string, prefix = "LOCAL"): string {
  const counterFile = path.join(ensureTasksDir(configDir), ".counter");
  let counter = 0;
  if (existsSync(counterFile)) {
    counter = parseInt(readFileSync(counterFile, "utf-8").trim(), 10) || 0;
  }
  counter++;
  writeFileSync(counterFile, String(counter));
  return prefix ? `${prefix}-${counter}` : String(counter);
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
) {
  const configDir = manager.getConfigDir();

  // List all custom tasks — enrich with linkedWorktreeId from notes
  app.get("/api/tasks", (c) => {
    const tasks = loadAllTasks(configDir);
    const enriched = tasks.map((task) => {
      const notes = notesManager.loadNotes("local", task.id);
      const attachments = listAttachments(configDir, task.id);
      return {
        ...task,
        linkedWorktreeId: notes.linkedWorktreeId,
        attachmentCount: attachments.length,
      };
    });
    return c.json({ tasks: enriched });
  });

  // Get single task — enrich with linkedWorktreeId from notes + attachments
  app.get("/api/tasks/:id", (c) => {
    const task = loadTask(configDir, c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);
    const notes = notesManager.loadNotes("local", task.id);
    const attachments = listAttachments(configDir, task.id);
    return c.json({ task: { ...task, linkedWorktreeId: notes.linkedWorktreeId, attachments } });
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
    const identifier = getNextIdentifier(configDir, manager.getConfig().localIssuePrefix);
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

    return c.json({ success: true, task: { ...task, linkedWorktreeId } });
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

    const notes = notesManager.loadNotes("local", task.id);
    return c.json({ success: true, task: { ...task, linkedWorktreeId: notes.linkedWorktreeId } });
  });

  // Delete task
  app.delete("/api/tasks/:id", (c) => {
    const id = c.req.param("id");
    const taskDir = path.join(getTasksDir(configDir), id);
    if (!existsSync(taskDir)) return c.json({ success: false, error: "Task not found" }, 404);

    rmSync(taskDir, { recursive: true });
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
          onSuccess: () => {
            // Link worktree via notes.json only after async creation actually succeeds
            notesManager.setLinkedWorktreeId("local", taskId, taskId);
          },
        },
      );

      if (!result.success) {
        manager.clearPendingWorktreeContext(taskId);
      }

      return c.json(result);
    } catch (err) {
      manager.clearPendingWorktreeContext(task.id);
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
    return c.json({ success: true });
  });
}
