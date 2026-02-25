import { createWriteStream, existsSync, mkdirSync, writeFileSync } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import path from "path";

import { APP_NAME } from "@openkit/shared/constants";
import { log } from "@openkit/shared/logger";
import { adfToMarkdown } from "./adf-to-markdown";
import { getApiBase, getAuthHeaders } from "./auth";
import type {
  JiraCredentials,
  JiraProjectConfig,
  JiraTaskData,
  JiraComment,
  JiraAttachment,
} from "./types";

export function resolveTaskKey(taskId: string, projectConfig: JiraProjectConfig): string {
  // If already contains a dash, assume it's a full key like PROJ-123
  if (taskId.includes("-")) return taskId.toUpperCase();

  // Otherwise, prepend default project key
  if (!projectConfig.defaultProjectKey) {
    throw new Error(
      `Task ID "${taskId}" has no project prefix and no defaultProjectKey is configured.\n` +
        `Either use the full key (e.g. PROJ-${taskId}) or set defaultProjectKey via "${APP_NAME} connect jira".`,
    );
  }

  return `${projectConfig.defaultProjectKey}-${taskId}`;
}

export async function fetchIssue(
  key: string,
  creds: JiraCredentials,
  configDir: string,
): Promise<JiraTaskData> {
  const base = getApiBase(creds);
  const headers = await getAuthHeaders(creds, configDir);

  // Fetch issue with all fields
  const resp = await fetch(`${base}/issue/${encodeURIComponent(key)}?expand=renderedFields`, {
    headers,
  });

  if (!resp.ok) {
    const body = await resp.text();
    if (resp.status === 404) {
      throw new Error(`Issue ${key} not found`);
    }
    throw new Error(`Failed to fetch issue ${key}: ${resp.status} ${body}`);
  }

  const issue = (await resp.json()) as Record<string, unknown>;
  const fields = issue.fields as Record<string, unknown>;

  // Fetch comments separately for pagination control
  const commentsResp = await fetch(
    `${base}/issue/${encodeURIComponent(key)}/comment?orderBy=-created&maxResults=50`,
    { headers },
  );

  let rawComments: Array<{ author: { displayName: string }; body: unknown; created: string }> = [];
  if (commentsResp.ok) {
    const commentsData = (await commentsResp.json()) as {
      comments: Array<{
        author: { displayName: string };
        body: unknown;
        created: string;
      }>;
    };
    rawComments = commentsData.comments;
  }

  // Build site URL for the issue
  let siteUrl: string;
  if (creds.authMethod === "oauth") {
    siteUrl = creds.oauth.siteUrl;
  } else {
    siteUrl = creds.apiToken.baseUrl;
  }
  const issueUrl = `${siteUrl.replace(/\/$/, "")}/browse/${key}`;

  const rawAttachments = (fields.attachment ?? []) as Array<{
    id: string;
    filename: string;
    content: string;
    thumbnail?: string;
    mimeType: string;
    size: number;
  }>;

  // Build attachment lookup for ADF media nodes (keyed by both filename and id)
  const attachmentMap = new Map<string, { url: string; mimeType: string }>();
  for (const a of rawAttachments) {
    if (a.content) {
      const entry = { url: a.content, mimeType: a.mimeType };
      attachmentMap.set(a.filename, entry);
      if (a.id) attachmentMap.set(a.id, entry);
    }
  }

  const comments: JiraComment[] = rawComments.map((c) => ({
    author: c.author?.displayName ?? "Unknown",
    body: adfToMarkdown(c.body, attachmentMap),
    created: c.created,
  }));

  return {
    key,
    summary: (fields.summary as string) ?? "",
    description: adfToMarkdown(fields.description, attachmentMap),
    status: ((fields.status as Record<string, unknown>)?.name as string) ?? "Unknown",
    priority: ((fields.priority as Record<string, unknown>)?.name as string) ?? "None",
    type: ((fields.issuetype as Record<string, unknown>)?.name as string) ?? "Unknown",
    assignee: ((fields.assignee as Record<string, unknown>)?.displayName as string) ?? null,
    reporter: ((fields.reporter as Record<string, unknown>)?.displayName as string) ?? null,
    labels: (fields.labels as string[]) ?? [],
    created: (fields.created as string) ?? "",
    updated: (fields.updated as string) ?? "",
    comments,
    attachments: rawAttachments.map((a) => ({
      filename: a.filename,
      localPath: "", // filled in after download
      mimeType: a.mimeType,
      size: a.size,
      contentUrl: a.content,
      thumbnail: a.thumbnail ?? null,
    })),
    linkedWorktree: null,
    fetchedAt: new Date().toISOString(),
    url: issueUrl,
  };
}

export async function downloadAttachments(
  rawAttachments: Array<{
    filename: string;
    content: string;
    mimeType: string;
    size: number;
  }>,
  targetDir: string,
  creds: JiraCredentials,
  configDir: string,
): Promise<JiraAttachment[]> {
  if (rawAttachments.length === 0) return [];

  mkdirSync(targetDir, { recursive: true });
  const headers = await getAuthHeaders(creds, configDir);
  const results: JiraAttachment[] = [];
  const usedNames = new Set<string>();

  for (const att of rawAttachments) {
    let filename = att.filename;

    // Handle duplicate filenames
    if (usedNames.has(filename)) {
      const ext = path.extname(filename);
      const base = path.basename(filename, ext);
      let counter = 1;
      while (usedNames.has(`${base}_${counter}${ext}`)) counter++;
      filename = `${base}_${counter}${ext}`;
    }
    usedNames.add(filename);

    const localPath = path.join(targetDir, filename);

    try {
      const resp = await fetch(att.content, {
        headers: { Authorization: headers.Authorization },
      });

      if (!resp.ok || !resp.body) {
        log.warn(`Failed to download ${att.filename}`);
        continue;
      }

      const writeStream = createWriteStream(localPath);
      await pipeline(
        Readable.fromWeb(resp.body as import("stream/web").ReadableStream),
        writeStream,
      );

      results.push({
        filename,
        localPath,
        mimeType: att.mimeType,
        size: att.size,
      });
    } catch (err) {
      log.warn(`Failed to download ${att.filename}: ${err}`);
    }
  }

  return results;
}

export function saveTaskData(taskData: JiraTaskData, tasksDir: string): void {
  // Write to issues/jira/<KEY>/issue.json
  const issueDir = path.join(path.dirname(tasksDir), "issues", "jira", taskData.key);
  mkdirSync(issueDir, { recursive: true });
  writeFileSync(path.join(issueDir, "issue.json"), JSON.stringify(taskData, null, 2) + "\n");

  // Create empty notes.json if it doesn't exist
  const notesPath = path.join(issueDir, "notes.json");
  if (!existsSync(notesPath)) {
    writeFileSync(
      notesPath,
      JSON.stringify(
        {
          linkedWorktreeId: null,
          personal: null,
          aiContext: null,
        },
        null,
        2,
      ) + "\n",
    );
  }
}
