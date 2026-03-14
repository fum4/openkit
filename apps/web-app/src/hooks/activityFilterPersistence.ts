import type { ActivityFilterGroup } from "../components/ActivityFeed";

const FILTERS_KEY_PREFIX = "OpenKit:activityFeedFiltersByScope:";
const LEGACY_FILTERS_KEY = "OpenKit:activityFeedFilters";
const DEBUG_MODE_KEY_PREFIX = "OpenKit:activityDebugModeByScope:";
const LOG_LEVELS_KEY_PREFIX = "OpenKit:logLevelsByScope:";
const LOG_DOMAINS_KEY_PREFIX = "OpenKit:logDomainsByScope:";
const LOG_SURFACES_KEY_PREFIX = "OpenKit:logSurfacesByScope:";

function normalizeActivityFilterGroups(value: unknown): ActivityFilterGroup[] {
  if (!Array.isArray(value)) return [];
  const next: ActivityFilterGroup[] = [];
  for (const item of value) {
    if (
      item === "worktree" ||
      item === "issues" ||
      item === "hooks" ||
      item === "agents" ||
      item === "system"
    ) {
      if (!next.includes(item)) next.push(item);
      continue;
    }
    // Legacy combined token support.
    if (item === "agents-system") {
      if (!next.includes("agents")) next.push("agents");
      if (!next.includes("system")) next.push("system");
    }
  }
  return next;
}

function readFiltersByKey(key: string): ActivityFilterGroup[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return normalizeActivityFilterGroups(JSON.parse(raw));
  } catch {
    return null;
  }
}

function scopedFiltersKey(scope: string): string {
  return `${FILTERS_KEY_PREFIX}${scope}`;
}

function scopedDebugModeKey(scope: string): string {
  return `${DEBUG_MODE_KEY_PREFIX}${scope}`;
}

export function activityFilterScopeForProject(options: {
  serverUrl?: string | null;
  projectId?: string | null;
  projectName?: string | null;
}): string {
  if (typeof options.serverUrl === "string" && options.serverUrl.length > 0) {
    return `server:${options.serverUrl}`;
  }
  if (typeof options.projectId === "string" && options.projectId.length > 0) {
    return `project:${options.projectId}`;
  }
  if (typeof options.projectName === "string" && options.projectName.trim().length > 0) {
    return `name:${options.projectName.trim().toLowerCase()}`;
  }
  return "__default__";
}

export function readPersistedActivityFilters(
  scope: string,
  options?: { allowLegacyFallback?: boolean },
): ActivityFilterGroup[] {
  const scoped = readFiltersByKey(scopedFiltersKey(scope));
  if (scoped !== null) return scoped;
  if (!options?.allowLegacyFallback) return [];
  const legacy = readFiltersByKey(LEGACY_FILTERS_KEY);
  return legacy ?? [];
}

export function writePersistedActivityFilters(
  scope: string,
  selectedFilterGroups: ActivityFilterGroup[],
): void {
  const key = scopedFiltersKey(scope);
  try {
    if (selectedFilterGroups.length === 0) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(selectedFilterGroups));
  } catch {
    // Ignore localStorage write failures.
  }
}

export function readPersistedActivityDebugMode(scope: string): boolean {
  try {
    const raw = localStorage.getItem(scopedDebugModeKey(scope));
    if (!raw) return false;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "boolean") return parsed;

    return raw === "true";
  } catch {
    return false;
  }
}

export function writePersistedActivityDebugMode(scope: string, enabled: boolean): void {
  try {
    const key = scopedDebugModeKey(scope);
    if (!enabled) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(enabled));
  } catch {
    // Ignore localStorage write failures.
  }
}

function readStringArray(key: string): string[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return null;
  }
}

function writeStringArray(key: string, values: string[], defaults: string[]): void {
  try {
    if (values.length === defaults.length && defaults.every((d) => values.includes(d))) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(values));
  } catch {
    // Ignore localStorage write failures.
  }
}

export function readPersistedLogLevels(scope: string): string[] | null {
  return readStringArray(`${LOG_LEVELS_KEY_PREFIX}${scope}`);
}

export function writePersistedLogLevels(scope: string, values: string[], defaults: string[]): void {
  writeStringArray(`${LOG_LEVELS_KEY_PREFIX}${scope}`, values, defaults);
}

export function readPersistedLogDomains(scope: string): string[] | null {
  return readStringArray(`${LOG_DOMAINS_KEY_PREFIX}${scope}`);
}

export function writePersistedLogDomains(
  scope: string,
  values: string[],
  defaults: string[],
): void {
  writeStringArray(`${LOG_DOMAINS_KEY_PREFIX}${scope}`, values, defaults);
}

export function readPersistedLogSurfaces(scope: string): string[] | null {
  return readStringArray(`${LOG_SURFACES_KEY_PREFIX}${scope}`);
}

export function writePersistedLogSurfaces(
  scope: string,
  values: string[],
  defaults: string[],
): void {
  writeStringArray(`${LOG_SURFACES_KEY_PREFIX}${scope}`, values, defaults);
}
