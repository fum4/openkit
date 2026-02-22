import { useCallback, useEffect, useState } from "react";

import type { ActivityEvent, HookTrigger, StepResult } from "./api";
import { useServerUrlOptional } from "../contexts/ServerContext";

const DEFAULT_TOAST_EVENTS = [
  "creation_started",
  "creation_completed",
  "creation_failed",
  "skill_started",
  "skill_completed",
  "skill_failed",
  "crashed",
  "connection_lost",
];

type HookItemStatus = "running" | "passed" | "failed";

export interface HookFeedItem {
  key: string;
  itemType: "skill" | "command";
  label: string;
  detail?: string;
  status: HookItemStatus;
  filePath?: string;
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

function formatHookTriggerLabel(trigger: HookTrigger): string {
  switch (trigger) {
    case "pre-implementation":
      return "Pre-Implementation";
    case "post-implementation":
      return "Post-Implementation";
    case "custom":
      return "Custom";
    case "on-demand":
      return "On-Demand";
    case "worktree-created":
      return "Worktree Created";
    case "worktree-removed":
      return "Worktree Removed";
  }
}

function isHookRelatedEvent(event: ActivityEvent): boolean {
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

function sortByNewest(events: ActivityEvent[]): ActivityEvent[] {
  return [...events].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

function withSourceServerUrl(event: ActivityEvent, serverUrl: string | null): ActivityEvent {
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

  const title =
    running > 0
      ? `${formatHookTriggerLabel(trigger)} hooks running (${completed}/${total})`
      : failed > 0
        ? `${formatHookTriggerLabel(trigger)} hooks completed (${failed} failed)`
        : `${formatHookTriggerLabel(trigger)} hooks completed`;
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

function upsertEvent(events: ActivityEvent[], incoming: ActivityEvent): ActivityEvent[] {
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
    return sortByNewest(next).slice(0, 200);
  }

  if (incoming.groupKey) {
    const idx = next.findIndex((event) => event.groupKey === incoming.groupKey);
    if (idx >= 0) {
      next = [...next];
      next[idx] = incoming;
    } else {
      next = [incoming, ...next];
    }
    return sortByNewest(next).slice(0, 200);
  }

  if (next.some((event) => event.id === incoming.id)) {
    return sortByNewest(next).slice(0, 200);
  }

  return sortByNewest([incoming, ...next]).slice(0, 200);
}

export function useActivityFeed(
  onToast?: (
    message: string,
    level: "error" | "info" | "success",
    projectName?: string,
    worktreeId?: string,
  ) => void,
  onUpsertToast?: (
    groupKey: string,
    message: string,
    level: "error" | "info" | "success",
    isLoading: boolean,
    projectName?: string,
    worktreeId?: string,
  ) => void,
  toastEvents?: string[],
  disabledEventTypes?: string[],
) {
  const serverUrl = useServerUrlOptional();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [clearedAt, setClearedAt] = useState<number>(() => {
    if (serverUrl === null) return 0;
    try {
      const stored = localStorage.getItem(`dawg:activityClearedAt:${serverUrl}`);
      const parsed = stored ? Number(stored) : 0;
      return Number.isFinite(parsed) ? parsed : 0;
    } catch {
      return 0;
    }
  });

  useEffect(() => {
    if (serverUrl === null) {
      setClearedAt(0);
      return;
    }
    try {
      const stored = localStorage.getItem(`dawg:activityClearedAt:${serverUrl}`);
      const parsed = stored ? Number(stored) : 0;
      setClearedAt(Number.isFinite(parsed) ? parsed : 0);
    } catch {
      setClearedAt(0);
    }
  }, [serverUrl]);

  useEffect(() => {
    if (serverUrl === null) {
      setEvents([]);
      setUnreadCount(0);
      return;
    }

    const handler = (e: CustomEvent<ActivityEvent>) => {
      const event = withSourceServerUrl(e.detail, serverUrl);
      if ((disabledEventTypes ?? []).includes(event.type)) return;
      const eventTime = new Date(event.timestamp).getTime();
      if (clearedAt > 0 && Number.isFinite(eventTime) && eventTime <= clearedAt) return;

      setEvents((prev) => upsertEvent(prev, event));
      setUnreadCount((c) => c + 1);

      if (isHookRelatedEvent(event)) return;

      const activeToastEvents = toastEvents ?? DEFAULT_TOAST_EVENTS;
      if (activeToastEvents.includes(event.type)) {
        const level =
          event.severity === "error" ? "error" : event.severity === "success" ? "success" : "info";
        const isLoading = event.type.endsWith("_started");
        if (event.groupKey && onUpsertToast) {
          onUpsertToast(
            event.groupKey,
            event.title,
            level,
            isLoading,
            event.projectName,
            event.worktreeId,
          );
        } else if (onToast) {
          onToast(event.title, level, event.projectName, event.worktreeId);
        }
      }
    };

    const historyHandler = (e: CustomEvent<ActivityEvent[]>) => {
      const filteredHistory =
        clearedAt > 0
          ? e.detail.filter((event) => {
              const eventTime = new Date(event.timestamp).getTime();
              return (
                (!Number.isFinite(eventTime) || eventTime > clearedAt) &&
                !(disabledEventTypes ?? []).includes(event.type)
              );
            })
          : e.detail.filter((event) => !(disabledEventTypes ?? []).includes(event.type));
      if (filteredHistory.length === 0) return;
      const scopedHistory = filteredHistory.map((event) => withSourceServerUrl(event, serverUrl));
      // History arrives newest-first; replay oldest-first so grouped events end with latest state.
      const chronologicalHistory = [...scopedHistory].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

      setEvents((prev) => {
        const withHistory = chronologicalHistory.reduce(
          (acc, event) => upsertEvent(acc, event),
          prev,
        );
        return sortByNewest(withHistory).slice(0, 200);
      });
    };

    window.addEventListener("dawg:activity", handler as EventListener);
    window.addEventListener("dawg:activity-history", historyHandler as EventListener);

    return () => {
      window.removeEventListener("dawg:activity", handler as EventListener);
      window.removeEventListener("dawg:activity-history", historyHandler as EventListener);
    };
  }, [serverUrl, onToast, onUpsertToast, toastEvents, clearedAt, disabledEventTypes]);

  useEffect(() => {
    if (!disabledEventTypes || disabledEventTypes.length === 0) return;
    const disabled = new Set(disabledEventTypes);
    setEvents((prev) => prev.filter((event) => !disabled.has(event.type)));
  }, [disabledEventTypes]);

  const markAllRead = useCallback(() => {
    setUnreadCount(0);
  }, []);

  const clearAll = useCallback(() => {
    const now = Date.now();
    setEvents([]);
    setUnreadCount(0);
    setClearedAt(now);
    if (serverUrl !== null) {
      try {
        localStorage.setItem(`dawg:activityClearedAt:${serverUrl}`, String(now));
      } catch {
        // Ignore localStorage errors.
      }
    }
  }, [serverUrl]);

  return {
    events,
    unreadCount,
    markAllRead,
    clearAll,
  };
}
