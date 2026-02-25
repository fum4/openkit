import { existsSync, readFileSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";

import { CONFIG_DIR_NAME } from "@openkit/shared/constants";

export type CommitMessageSource = "jira" | "linear" | "local";

const COMMIT_MESSAGE_FILE = "commit-message.mjs";
const EXPORT_DEFAULT_PREFIX = "export default ";

export const DEFAULT_COMMIT_MESSAGE_RULE = `({ issueId, message }) => {
  if (issueId) {
    return \`[\${issueId}] \${message}\`;
  }
  return message;
}`;

function defaultCommitMessageFn({
  message,
}: {
  message: string;
  issueId: string | null;
  source: string | null;
}): string {
  return message;
}

function getCommitMessageRulePath(configDir: string, source?: CommitMessageSource): string {
  const filename = source ? `commit-message.${source}.mjs` : COMMIT_MESSAGE_FILE;
  return path.join(configDir, CONFIG_DIR_NAME, "scripts", filename);
}

async function loadCustomRule(
  configDir: string,
  source?: CommitMessageSource,
): Promise<
  ((params: { message: string; issueId: string | null; source: string | null }) => string) | null
> {
  const rulePath = getCommitMessageRulePath(configDir, source);
  if (!existsSync(rulePath)) return null;

  try {
    const fileUrl = pathToFileURL(rulePath).href + `?t=${Date.now()}`;
    const mod = await import(fileUrl);
    const fn = mod.default;
    if (typeof fn === "function") return fn;
    return null;
  } catch {
    return null;
  }
}

const COMMIT_SOURCES: readonly string[] = ["jira", "linear", "local"];

export async function formatCommitMessage(
  configDir: string,
  params: { message: string; issueId: string | null; source: string | null },
): Promise<string> {
  const source: CommitMessageSource | undefined =
    params.source && COMMIT_SOURCES.includes(params.source)
      ? (params.source as CommitMessageSource)
      : undefined;

  const fn =
    (source && (await loadCustomRule(configDir, source))) ??
    (await loadCustomRule(configDir)) ??
    defaultCommitMessageFn;

  try {
    const result = fn(params);
    if (typeof result === "string" && result.trim()) return result.trim();
  } catch {
    // Fall through to default
  }
  return defaultCommitMessageFn(params);
}

export function readCommitMessageRuleContent(
  configDir: string,
  source?: CommitMessageSource,
): string {
  const rulePath = getCommitMessageRulePath(configDir, source);
  if (!existsSync(rulePath)) {
    return source ? "" : DEFAULT_COMMIT_MESSAGE_RULE;
  }
  const raw = readFileSync(rulePath, "utf-8");
  if (raw.startsWith(EXPORT_DEFAULT_PREFIX)) {
    return raw.slice(EXPORT_DEFAULT_PREFIX.length);
  }
  return raw;
}

export function wrapWithExportDefault(functionBody: string): string {
  if (functionBody.trimStart().startsWith("export default")) return functionBody;
  return EXPORT_DEFAULT_PREFIX + functionBody;
}

export function hasCustomCommitMessageRule(
  configDir: string,
  source?: CommitMessageSource,
): boolean {
  return existsSync(getCommitMessageRulePath(configDir, source));
}
