import { existsSync, readFileSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";

import { CONFIG_DIR_NAME } from "@openkit/shared/constants";

export type BranchSource = "jira" | "linear" | "local";

const BRANCH_NAME_FILE = "branch-name.mjs";
const EXPORT_DEFAULT_PREFIX = "export default ";

// The default rule shown in the editor and used when no custom file exists
export const DEFAULT_BRANCH_RULE = `({ issueId, name }) => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

  return \`\${issueId}/\${slug}\`;
}`;

function defaultBranchNameFn({ issueId, name }: { issueId: string; name: string }): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_") // replace non-alphanumeric chars with underscores
    .replace(/^_|_$/g, ""); // trim leading/trailing underscores
  return `${issueId}/${slug}`;
}

function getBranchNameRulePath(configDir: string, source?: BranchSource): string {
  const filename = source ? `branch-name.${source}.mjs` : BRANCH_NAME_FILE;
  return path.join(configDir, CONFIG_DIR_NAME, "scripts", filename);
}

async function loadCustomRule(
  configDir: string,
  source?: BranchSource,
): Promise<((params: { issueId: string; name: string; type: string }) => string) | null> {
  const rulePath = getBranchNameRulePath(configDir, source);
  if (!existsSync(rulePath)) return null;

  try {
    // Use timestamp query to bust import cache so edits take effect without restart
    const fileUrl = pathToFileURL(rulePath).href + `?t=${Date.now()}`;
    const mod = await import(fileUrl);
    const fn = mod.default;
    if (typeof fn === "function") return fn;
    return null;
  } catch {
    return null;
  }
}

const BRANCH_SOURCES: readonly string[] = ["jira", "linear", "local"];

export async function generateBranchName(
  configDir: string,
  params: { issueId: string; name: string; type: string },
): Promise<string> {
  // Determine source from params.type
  const source: BranchSource | undefined = BRANCH_SOURCES.includes(params.type)
    ? (params.type as BranchSource)
    : undefined;

  // Try source-specific rule first, then fall back to default rule
  const fn =
    (source && (await loadCustomRule(configDir, source))) ??
    (await loadCustomRule(configDir)) ??
    defaultBranchNameFn;

  try {
    const result = fn(params);
    if (typeof result === "string" && result.trim()) return result.trim();
  } catch {
    // Fall through to default
  }
  return defaultBranchNameFn(params);
}

export function readBranchNameRuleContent(configDir: string, source?: BranchSource): string {
  const rulePath = getBranchNameRulePath(configDir, source);
  if (!existsSync(rulePath)) {
    // For source-specific: return empty string to distinguish "no override" from default
    // For default: return the built-in default rule
    return source ? "" : DEFAULT_BRANCH_RULE;
  }
  const raw = readFileSync(rulePath, "utf-8");
  // Strip export default wrapper so the UI only sees the function expression
  if (raw.startsWith(EXPORT_DEFAULT_PREFIX)) {
    return raw.slice(EXPORT_DEFAULT_PREFIX.length);
  }
  return raw;
}

export function wrapWithExportDefault(functionBody: string): string {
  if (functionBody.trimStart().startsWith("export default")) return functionBody;
  return EXPORT_DEFAULT_PREFIX + functionBody;
}

export function hasCustomBranchNameRule(configDir: string, source?: BranchSource): boolean {
  return existsSync(getBranchNameRulePath(configDir, source));
}
