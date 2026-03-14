import { createWriteStream, existsSync, mkdirSync, writeFileSync } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import path from "path";

import { APP_NAME } from "@openkit/shared/constants";
import { log } from "./logger";
import { adfToMarkdown } from "./adf-to-markdown";
import { getApiBase, getAuthHeaders } from "./auth";
import type {
  JiraCredentials,
  JiraProjectConfig,
  JiraTaskData,
  JiraComment,
  JiraAttachment,
} from "./types";

export interface JiraStatusOption {
  id: string;
  name: string;
}

export interface JiraPriorityOption {
  id: string;
  name: string;
}

export interface JiraIssueTypeOption {
  id: string;
  name: string;
}

function toAdfDocument(text: string): Record<string, unknown> {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return {
      type: "doc",
      version: 1,
      content: [],
    };
  }
  const lines = normalized.split("\n");
  const content = lines.map((line) => ({
    type: "paragraph",
    content: line.length > 0 ? [{ type: "text", text: line }] : [],
  }));
  return {
    type: "doc",
    version: 1,
    content,
  };
}

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

  let currentUserAccountId: string | null = null;
  const myselfResp = await fetch(`${base}/myself`, { headers });
  if (myselfResp.ok) {
    const myself = (await myselfResp.json()) as { accountId?: string };
    currentUserAccountId = myself.accountId ?? null;
  }

  let rawComments: Array<{
    id: string;
    author: { displayName: string; accountId?: string };
    body: unknown;
    created: string;
  }> = [];
  if (commentsResp.ok) {
    const commentsData = (await commentsResp.json()) as {
      comments: Array<{
        id: string;
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
    id: c.id,
    author: c.author?.displayName ?? "Unknown",
    body: adfToMarkdown(c.body, attachmentMap),
    created: c.created,
    canEdit: !!currentUserAccountId && c.author?.accountId === currentUserAccountId,
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

export async function fetchIssueStatusOptions(
  key: string,
  creds: JiraCredentials,
  configDir: string,
): Promise<JiraStatusOption[]> {
  const base = getApiBase(creds);
  const headers = await getAuthHeaders(creds, configDir);
  const resp = await fetch(`${base}/issue/${encodeURIComponent(key)}/transitions`, { headers });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Failed to fetch transitions for ${key}: ${resp.status} ${body}`);
  }
  const data = (await resp.json()) as {
    transitions?: Array<{ id?: string; to?: { name?: string } }>;
  };
  const seen = new Set<string>();
  const options: JiraStatusOption[] = [];
  for (const transition of data.transitions ?? []) {
    const id = transition.id?.trim();
    const name = transition.to?.name?.trim();
    if (!id || !name) continue;
    const dedupeKey = `${id}:${name.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    options.push({ id, name });
  }
  return options;
}

export async function transitionIssueStatus(
  key: string,
  statusName: string,
  creds: JiraCredentials,
  configDir: string,
): Promise<void> {
  const options = await fetchIssueStatusOptions(key, creds, configDir);
  const next = options.find(
    (option) => option.name.toLowerCase() === statusName.trim().toLowerCase(),
  );
  if (!next) {
    throw new Error(`Status "${statusName}" is not available as a transition for ${key}`);
  }
  const base = getApiBase(creds);
  const headers = await getAuthHeaders(creds, configDir);
  const resp = await fetch(`${base}/issue/${encodeURIComponent(key)}/transitions`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transition: {
        id: next.id,
      },
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Failed to transition ${key} to ${statusName}: ${resp.status} ${body}`);
  }
}

export async function fetchPriorityOptions(
  creds: JiraCredentials,
  configDir: string,
): Promise<JiraPriorityOption[]> {
  const base = getApiBase(creds);
  const headers = await getAuthHeaders(creds, configDir);
  const resp = await fetch(`${base}/priority`, { headers });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Failed to fetch priorities: ${resp.status} ${body}`);
  }
  const data = (await resp.json()) as Array<{ id?: string; name?: string }>;
  const options = data
    .map((priority) => ({
      id: priority.id?.trim() ?? "",
      name: priority.name?.trim() ?? "",
    }))
    .filter((priority) => priority.id && priority.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  return options;
}

export async function fetchIssueTypeOptions(
  key: string,
  creds: JiraCredentials,
  configDir: string,
): Promise<JiraIssueTypeOption[]> {
  const base = getApiBase(creds);
  const headers = await getAuthHeaders(creds, configDir);
  const resp = await fetch(`${base}/issue/${encodeURIComponent(key)}/editmeta`, { headers });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Failed to fetch issue type options for ${key}: ${resp.status} ${body}`);
  }
  const data = (await resp.json()) as {
    fields?: {
      issuetype?: {
        allowedValues?: Array<{ id?: string; name?: string }>;
      };
    };
  };
  const options = (data.fields?.issuetype?.allowedValues ?? [])
    .map((issueType) => ({
      id: issueType.id?.trim() ?? "",
      name: issueType.name?.trim() ?? "",
    }))
    .filter((issueType) => issueType.id && issueType.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  return options;
}

export async function updateIssuePriority(
  key: string,
  priorityName: string,
  creds: JiraCredentials,
  configDir: string,
): Promise<void> {
  const options = await fetchPriorityOptions(creds, configDir);
  const next = options.find(
    (option) => option.name.toLowerCase() === priorityName.trim().toLowerCase(),
  );
  if (!next) {
    throw new Error(`Priority "${priorityName}" is not available`);
  }
  const base = getApiBase(creds);
  const headers = await getAuthHeaders(creds, configDir);
  const resp = await fetch(`${base}/issue/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        priority: {
          id: next.id,
        },
      },
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Failed to update priority for ${key}: ${resp.status} ${body}`);
  }
}

export async function updateIssueType(
  key: string,
  typeName: string,
  creds: JiraCredentials,
  configDir: string,
): Promise<void> {
  const options = await fetchIssueTypeOptions(key, creds, configDir);
  const next = options.find(
    (option) => option.name.toLowerCase() === typeName.trim().toLowerCase(),
  );
  if (!next) {
    throw new Error(`Issue type "${typeName}" is not available`);
  }
  const base = getApiBase(creds);
  const headers = await getAuthHeaders(creds, configDir);
  const resp = await fetch(`${base}/issue/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        issuetype: {
          id: next.id,
        },
      },
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Failed to update issue type for ${key}: ${resp.status} ${body}`);
  }
}

export async function updateIssueDescription(
  key: string,
  description: string,
  creds: JiraCredentials,
  configDir: string,
): Promise<void> {
  const base = getApiBase(creds);
  const headers = await getAuthHeaders(creds, configDir);
  const resp = await fetch(`${base}/issue/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        description: toAdfDocument(description),
      },
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Failed to update description for ${key}: ${resp.status} ${body}`);
  }
}

export async function updateIssueSummary(
  key: string,
  summary: string,
  creds: JiraCredentials,
  configDir: string,
): Promise<void> {
  const base = getApiBase(creds);
  const headers = await getAuthHeaders(creds, configDir);
  const resp = await fetch(`${base}/issue/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        summary,
      },
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Failed to update summary for ${key}: ${resp.status} ${body}`);
  }
}

export async function addIssueComment(
  key: string,
  comment: string,
  creds: JiraCredentials,
  configDir: string,
): Promise<void> {
  const base = getApiBase(creds);
  const headers = await getAuthHeaders(creds, configDir);
  const resp = await fetch(`${base}/issue/${encodeURIComponent(key)}/comment`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      body: toAdfDocument(comment),
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Failed to add comment to ${key}: ${resp.status} ${body}`);
  }
}

export async function updateIssueComment(
  key: string,
  commentId: string,
  comment: string,
  creds: JiraCredentials,
  configDir: string,
): Promise<void> {
  const base = getApiBase(creds);
  const headers = await getAuthHeaders(creds, configDir);
  const resp = await fetch(
    `${base}/issue/${encodeURIComponent(key)}/comment/${encodeURIComponent(commentId)}`,
    {
      method: "PUT",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        body: toAdfDocument(comment),
      }),
    },
  );
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Failed to update comment ${commentId}: ${resp.status} ${body}`);
  }
}

export async function deleteIssueComment(
  key: string,
  commentId: string,
  creds: JiraCredentials,
  configDir: string,
): Promise<void> {
  const base = getApiBase(creds);
  const headers = await getAuthHeaders(creds, configDir);
  const resp = await fetch(
    `${base}/issue/${encodeURIComponent(key)}/comment/${encodeURIComponent(commentId)}`,
    {
      method: "DELETE",
      headers,
    },
  );
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Failed to delete comment ${commentId}: ${resp.status} ${body}`);
  }
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
