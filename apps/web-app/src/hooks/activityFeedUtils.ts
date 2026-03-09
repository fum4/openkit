import type { ActivityEvent, HookTrigger, StepResult } from "./api";

export const ACTIVITY_FEED_EVENT_LIMIT = 200;

export type HookItemStatus = "running" | "passed" | "failed";

export interface HookFeedItem {
  key: string;
  itemType: "skill" | "command";
  label: string;
  detail?: string;
  status: HookItemStatus;
  filePath?: string;
}

export interface ConsecutiveActivityItem {
  id: string;
  title: string;
  detail?: string;
  timestamp: string;
  worktreeId?: string;
  projectName?: string;
  issueId?: string;
  source?: "jira" | "linear" | "local";
  sourceServerUrl?: string;
}

function normalizeHookTrigger(value: unknown): HookTrigger {
  if (
    value === "pre-implementation" ||
    value === "post-implementation" ||
    value === "custom" ||
    value === "on-demand" ||
    value === "worktree-created" ||
    value === "worktree-removed"
  ) {
    return value;
  }
  return "post-implementation";
}

function formatHookTriggerContext(trigger: HookTrigger): string {
  switch (trigger) {
    case "pre-implementation":
      return "pre-implementation";
    case "post-implementation":
      return "post-implementation";
    case "custom":
      return "custom";
    case "on-demand":
      return "on-demand";
    case "worktree-created":
      return "worktree created";
    case "worktree-removed":
      return "worktree removed";
  }
}

export function isHookRelatedEvent(event: ActivityEvent): boolean {
  return (
    event.groupKey?.startsWith("hooks:") === true ||
    event.type === "hooks_started" ||
    event.type === "hooks_ran" ||
    event.type === "skill_started" ||
    event.type === "skill_completed" ||
    event.type === "skill_failed" ||
    event.metadata?.trigger !== undefined
  );
}

export function sortActivityEventsByNewest(events: ActivityEvent[]): ActivityEvent[] {
  return [...events].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

export function withSourceServerUrl(event: ActivityEvent, serverUrl: string | null): ActivityEvent {
  if (!serverUrl) return event;
  return {
    ...event,
    metadata: {
      ...event.metadata,
      sourceServerUrl: serverUrl,
    },
  };
}

function toHookItems(event: ActivityEvent): HookFeedItem[] {
  const rawItems = (event.metadata?.hookItems as HookFeedItem[] | undefined) ?? [];
  return Array.isArray(rawItems) ? rawItems : [];
}

function normalizeIssueSource(value: unknown): "jira" | "linear" | "local" | undefined {
  if (value === "jira" || value === "linear" || value === "local") return value;
  return undefined;
}

function toConsecutiveItem(event: ActivityEvent): ConsecutiveActivityItem {
  return {
    id: event.id,
    title: event.title,
    detail: event.detail,
    timestamp: event.timestamp,
    worktreeId: event.worktreeId,
    projectName: event.projectName,
    issueId:
      typeof event.metadata?.issueId === "string" ? (event.metadata.issueId as string) : undefined,
    source: normalizeIssueSource(event.metadata?.source),
    sourceServerUrl:
      typeof event.metadata?.sourceServerUrl === "string"
        ? (event.metadata.sourceServerUrl as string)
        : undefined,
  };
}

function toConsecutiveItems(event: ActivityEvent): ConsecutiveActivityItem[] {
  const raw = event.metadata?.consecutiveGroupItems as ConsecutiveActivityItem[] | undefined;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw;
  }
  return [toConsecutiveItem(event)];
}

function shouldGroupConsecutively(event: ActivityEvent): boolean {
  return event.type === "task_detected";
}

function sameConsecutiveGroupContext(a: ActivityEvent, b: ActivityEvent): boolean {
  if (a.type !== b.type || a.category !== b.category) return false;
  if ((a.projectName ?? "") !== (b.projectName ?? "")) return false;
  const aSourceServerUrl =
    typeof a.metadata?.sourceServerUrl === "string" ? (a.metadata.sourceServerUrl as string) : "";
  const bSourceServerUrl =
    typeof b.metadata?.sourceServerUrl === "string" ? (b.metadata.sourceServerUrl as string) : "";
  return aSourceServerUrl === bSourceServerUrl;
}

function pluralizeActivityTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return "New notifications";
  if (trimmed.endsWith("s")) return trimmed;
  if (trimmed.endsWith("y")) return `${trimmed.slice(0, -1)}ies`;
  return `${trimmed}s`;
}

function mergeConsecutiveEvents(existing: ActivityEvent, incoming: ActivityEvent): ActivityEvent {
  const existingItems = toConsecutiveItems(existing);
  if (existingItems.some((item) => item.id === incoming.id)) {
    return existing;
  }
  const mergedItems = [...existingItems, toConsecutiveItem(incoming)];
  const groupedTitle = pluralizeActivityTitle(incoming.title || existing.title);
  return {
    ...existing,
    id: existing.id,
    timestamp: incoming.timestamp,
    title: groupedTitle,
    detail: undefined,
    worktreeId: incoming.worktreeId ?? existing.worktreeId,
    projectName: incoming.projectName ?? existing.projectName,
    metadata: {
      ...existing.metadata,
      ...incoming.metadata,
      consecutiveGroupCount: mergedItems.length,
      consecutiveGroupItems: mergedItems,
    },
  };
}

export function getConsecutiveGroupItems(event: ActivityEvent): ConsecutiveActivityItem[] {
  return toConsecutiveItems(event);
}

function upsertHookItem(items: HookFeedItem[], item: HookFeedItem): HookFeedItem[] {
  const idx = items.findIndex((existing) => existing.key === item.key);
  if (idx >= 0) {
    const next = [...items];
    next[idx] = { ...next[idx], ...item };
    return next;
  }
  return [...items, item];
}

function updateHookGroup(
  existing: ActivityEvent | undefined,
  incoming: ActivityEvent,
): ActivityEvent {
  const trigger = normalizeHookTrigger(incoming.metadata?.trigger ?? existing?.metadata?.trigger);
  let items = toHookItems(existing ?? incoming);

  if (
    (incoming.type === "skill_started" ||
      incoming.type === "skill_completed" ||
      incoming.type === "skill_failed") &&
    incoming.metadata?.skillName
  ) {
    const skillName = String(incoming.metadata.skillName);
    const status: HookItemStatus =
      incoming.type === "skill_started"
        ? "running"
        : incoming.type === "skill_failed"
          ? "failed"
          : "passed";
    items = upsertHookItem(items, {
      key: `skill:${skillName}`,
      itemType: "skill",
      label: skillName,
      status,
      detail: incoming.detail,
      filePath: incoming.metadata.filePath as string | undefined,
    });
  }

  const commandResults =
    (incoming.metadata?.commandResults as
      | Array<
          Partial<StepResult> & {
            stepId?: string;
            stepName?: string;
            command?: string;
            status?: string;
          }
        >
      | undefined) ?? [];
  for (const step of commandResults) {
    const stepId = step.stepId ?? step.stepName ?? "step";
    const status: HookItemStatus =
      step.status === "failed" ? "failed" : step.status === "passed" ? "passed" : "running";
    items = upsertHookItem(items, {
      key: `command:${stepId}`,
      itemType: "command",
      label: step.stepName ?? "Command",
      detail: step.command,
      status,
    });
  }

  const total = items.length;
  const passed = items.filter((item) => item.status === "passed").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const running = items.filter((item) => item.status === "running").length;
  const completed = passed + failed;
  const triggerContext = formatHookTriggerContext(trigger);

  const title =
    running > 0
      ? `Hooks running - ${completed}/${total} (${triggerContext})`
      : failed > 0
        ? `Hooks completed - ${failed} failed (${triggerContext})`
        : `Hooks completed (${triggerContext})`;

  const detail =
    total === 0
      ? "No runnable command hooks configured."
      : running > 0
        ? `${running} still running`
        : failed > 0
          ? `${passed} passed, ${failed} failed`
          : `${passed} passed`;

  return {
    ...(existing ?? incoming),
    id: existing?.id ?? incoming.id,
    timestamp: incoming.timestamp,
    title,
    detail,
    severity: running > 0 ? "info" : failed > 0 ? "error" : "success",
    metadata: {
      ...existing?.metadata,
      ...incoming.metadata,
      trigger,
      hookItems: items,
      hookStatus: running > 0 ? "running" : failed > 0 ? "failed" : "passed",
    },
  };
}

export function upsertActivityEvent(
  events: ActivityEvent[],
  incoming: ActivityEvent,
): ActivityEvent[] {
  let next = events;

  if (incoming.groupKey?.startsWith("hooks:")) {
    const idx = next.findIndex((event) => event.groupKey === incoming.groupKey);
    const merged = updateHookGroup(idx >= 0 ? next[idx] : undefined, incoming);
    if (idx >= 0) {
      next = [...next];
      next[idx] = merged;
    } else {
      next = [merged, ...next];
    }
    return sortActivityEventsByNewest(next).slice(0, ACTIVITY_FEED_EVENT_LIMIT);
  }

  if (shouldGroupConsecutively(incoming) && next.length > 0) {
    const latest = next[0];
    if (shouldGroupConsecutively(latest) && sameConsecutiveGroupContext(latest, incoming)) {
      const merged = mergeConsecutiveEvents(latest, incoming);
      next = [merged, ...next.slice(1)];
      return sortActivityEventsByNewest(next).slice(0, ACTIVITY_FEED_EVENT_LIMIT);
    }
  }

  if (incoming.groupKey) {
    const idx = next.findIndex((event) => event.groupKey === incoming.groupKey);
    if (idx >= 0) {
      next = [...next];
      next[idx] = incoming;
    } else {
      next = [incoming, ...next];
    }
    return sortActivityEventsByNewest(next).slice(0, ACTIVITY_FEED_EVENT_LIMIT);
  }

  if (next.some((event) => event.id === incoming.id)) {
    return sortActivityEventsByNewest(next).slice(0, ACTIVITY_FEED_EVENT_LIMIT);
  }

  return sortActivityEventsByNewest([incoming, ...next]).slice(0, ACTIVITY_FEED_EVENT_LIMIT);
}

export function replayActivityHistory(
  currentEvents: ActivityEvent[],
  historyEvents: ActivityEvent[],
): ActivityEvent[] {
  const chronologicalHistory = [...historyEvents].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const withHistory = chronologicalHistory.reduce(
    (acc, event) => upsertActivityEvent(acc, event),
    currentEvents,
  );
  return sortActivityEventsByNewest(withHistory).slice(0, ACTIVITY_FEED_EVENT_LIMIT);
}
