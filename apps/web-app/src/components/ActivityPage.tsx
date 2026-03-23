import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronUp,
  CheckCircle2,
  ChevronsDownUp,
  ChevronsUpDown,
  Clock3,
  ListFilter,
  Loader2,
  Maximize2,
  MessageCircleCheck,
  MessageCircleX,
  Minimize2,
  PauseCircle,
  PlayCircle,
  RectangleEllipsis,
  Search,
  Terminal,
  Trash2,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ACTIVITY_TYPES } from "@openkit/shared/activity-event";
import {
  ACTIVITY_FILTER_GROUP_OPTIONS,
  ActivityFeedPanel,
  type ActivityFilterGroup,
  isActionRequiredEvent,
} from "./ActivityFeed";
import {
  activityFilterScopeForProject,
  readPersistedActivityDebugMode,
  readPersistedActivityFilters,
  readPersistedLogDomains,
  readPersistedLogLevels,
  readPersistedLogSurfaces,
  writePersistedActivityDebugMode,
  writePersistedActivityFilters,
  writePersistedLogDomains,
  writePersistedLogLevels,
  writePersistedLogSurfaces,
} from "../hooks/activityFilterPersistence";
import { createActivityEvent, type ActivityEvent, type OpsLogEvent } from "../hooks/api";
import { useProjectActivityFeeds } from "../hooks/useProjectActivityFeeds";
import { useProjectOpsLogs } from "../hooks/useProjectOpsLogs";
import { PayloadCopyButton } from "./PayloadCopyButton";
import { ToggleSwitch } from "./ToggleSwitch";
import { text } from "../theme";

type WorktreeNavigationTarget = {
  worktreeId: string;
  projectName?: string;
  sourceServerUrl?: string;
  openClaudeTab?: boolean;
  openHooksTab?: boolean;
};

type IssueNavigationTarget = {
  source: "jira" | "linear" | "local";
  issueId: string;
  projectName?: string;
  sourceServerUrl?: string;
};

interface ActivityPageProps {
  disabledActivityEventTypes?: string[];
  onNavigateToWorktree?: (target: WorktreeNavigationTarget) => void;
  onNavigateToIssue?: (target: IssueNavigationTarget) => void;
}

const STATUS_BADGE: Record<
  "running" | "starting" | "stopped" | "error",
  { label: string; className: string; icon: typeof PlayCircle }
> = {
  running: {
    label: "Running",
    className: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
    icon: PlayCircle,
  },
  starting: {
    label: "Starting",
    className: "text-amber-300 bg-amber-500/10 border-amber-500/30",
    icon: Loader2,
  },
  stopped: {
    label: "Stopped",
    className: "text-[#9ca3af] bg-white/[0.06] border-white/[0.12]",
    icon: PauseCircle,
  },
  error: {
    label: "Error",
    className: "text-red-300 bg-red-500/10 border-red-500/30",
    icon: AlertTriangle,
  },
};

const LOG_LEVEL_CLASS: Record<OpsLogEvent["level"], string> = {
  debug: "text-[#9ca3af] bg-white/[0.06]",
  info: "text-sky-300 bg-sky-500/10",
  warning: "text-amber-300 bg-amber-500/10",
  error: "text-red-300 bg-red-500/10",
};

const LOG_STATUS_CLASS: Record<OpsLogEvent["status"], string> = {
  started: "text-sky-300 bg-sky-500/10",
  succeeded: "text-emerald-300 bg-emerald-500/10",
  failed: "text-red-300 bg-red-500/10",
  info: "text-[#9ca3af] bg-white/[0.06]",
};

const LOG_LEVEL_OPTIONS: OpsLogEvent["level"][] = ["error", "warning", "info", "debug"];
type LogDomainFilter = "http" | "git" | "terminal" | "log" | "other";
type LogSurfaceFilter = "internal" | "notification" | "toast";

const LOG_DOMAIN_OPTIONS: ReadonlyArray<{ id: LogDomainFilter; label: string }> = [
  { id: "http", label: "HTTP" },
  { id: "git", label: "Git" },
  { id: "terminal", label: "Terminal" },
  { id: "log", label: "Log" },
  { id: "other", label: "Other" },
];

const LOG_SURFACE_OPTIONS: ReadonlyArray<{ id: LogSurfaceFilter; label: string }> = [
  { id: "internal", label: "Internal" },
  { id: "notification", label: "Notification" },
  { id: "toast", label: "Toast" },
];

const HTTP_METHOD_TEXT_CLASS: Record<string, string> = {
  GET: "text-blue-300",
  POST: "text-emerald-300",
  DELETE: "text-red-300",
  PUT: "text-orange-300",
};

const HTTP_STATUS_CHIP_CLASS = {
  success: "text-emerald-300 bg-emerald-500/10",
  failure: "text-red-300 bg-red-500/10",
};

const STATUS_PREFIX_PATTERN = /^(Started|Succeeded|Failed):\s+/i;

function buildUnavailableMessage(status: "running" | "starting" | "stopped" | "error"): string {
  if (status === "running") return "Live activity should be available shortly.";
  if (status === "starting") {
    return "Project is starting. Live activity will appear when it is ready.";
  }
  if (status === "error") {
    return "Project failed to start. Resolve the project error to resume activity.";
  }
  return "Project is stopped. Start it to stream live activity updates.";
}

function formatClockTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function getHttpMethod(event: OpsLogEvent): string | null {
  const methodRaw = event.metadata?.method;
  if (typeof methodRaw !== "string") return null;
  const method = methodRaw.trim().toUpperCase();
  return method.length > 0 ? method : null;
}

function getHttpMethodTextClass(method: string): string {
  return HTTP_METHOD_TEXT_CLASS[method] ?? "text-[#9ca3af]";
}

function getHttpPath(event: OpsLogEvent): string | null {
  const pathRaw = event.metadata?.path;
  if (typeof pathRaw === "string" && pathRaw.trim().length > 0) {
    return pathRaw.trim();
  }

  const message = stripStatusPrefix(event.message);
  const method = getHttpMethod(event);
  if (!method) return null;
  const prefix = `${method} `;
  if (!message.startsWith(prefix)) return null;

  const withoutMethod = message.slice(prefix.length);
  const arrowIndex = withoutMethod.indexOf(" -> ");
  if (arrowIndex >= 0) {
    return withoutMethod.slice(0, arrowIndex).trim();
  }
  return withoutMethod.trim();
}

function getHttpStatusCode(event: OpsLogEvent): number | null {
  const codeRaw = event.metadata?.statusCode;
  return typeof codeRaw === "number" && Number.isFinite(codeRaw) ? codeRaw : null;
}

function getHttpStatusChipClass(statusCode: number): string {
  return statusCode >= 400 ? HTTP_STATUS_CHIP_CLASS.failure : HTTP_STATUS_CHIP_CLASS.success;
}

function getHttpTransportTag(event: OpsLogEvent): "SSE" | "WS" | null {
  if (!getHttpMethod(event)) return null;

  const responseTransport = getHttpMetadataString(event, "responseTransport")?.toLowerCase();
  const requestTransport = getHttpMetadataString(event, "requestTransport")?.toLowerCase();
  const responseContentType = getHttpMetadataString(event, "responseContentType")?.toLowerCase();
  const statusCode = getHttpStatusCode(event);

  if (responseTransport === "ws" || requestTransport === "ws" || statusCode === 101) {
    return "WS";
  }
  if (responseTransport === "sse" || responseContentType === "text/event-stream") {
    return "SSE";
  }

  return null;
}

function getHttpMetadataString(event: OpsLogEvent, key: string): string | null {
  const value = event.metadata?.[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getHttpMetadataFlag(event: OpsLogEvent, key: string): boolean {
  return event.metadata?.[key] === true;
}

function formatPayloadForDisplay(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return payload;
  }
}

function buildPayloadCopyText(options: {
  title: string;
  contentType: string | null;
  payload: string | null;
  payloadOmitted: boolean;
  payloadError: string | null;
  payloadTruncated: boolean;
}): string {
  const header = options.contentType ? `${options.title} (${options.contentType})` : options.title;
  const body = options.payload
    ? formatPayloadForDisplay(options.payload)
    : options.payloadOmitted
      ? "Payload omitted (non-text content)"
      : options.payloadError
        ? options.payloadError
        : `No ${options.title.toLowerCase()} payload`;
  const truncatedLine = options.payloadTruncated ? `\n\n${options.title} payload truncated` : "";
  return `${header}\n\n${body}${truncatedLine}`;
}

function getCommandTitle(event: OpsLogEvent): string | null {
  const raw = event.command?.command;
  if (typeof raw !== "string") return null;
  const firstToken = raw.trim().split(/\s+/)[0];
  if (!firstToken) return null;

  const slashIndex = Math.max(firstToken.lastIndexOf("/"), firstToken.lastIndexOf("\\"));
  return slashIndex >= 0 ? firstToken.slice(slashIndex + 1) : firstToken;
}

function getLogDomain(event: OpsLogEvent): LogDomainFilter {
  if (event.source === "http" || event.action.startsWith("http.") || getHttpMethod(event)) {
    return "http";
  }

  const commandTitle = getCommandTitle(event)?.toLowerCase();
  if (commandTitle === "git") {
    return "git";
  }

  if (event.action === "command.exec" || event.command) {
    return "terminal";
  }

  if (event.action === "log") {
    return "log";
  }

  return "other";
}

function getLogSurface(event: OpsLogEvent): LogSurfaceFilter {
  if (event.source === "notification" || event.action.startsWith("notification.")) {
    return "notification";
  }
  if (event.source === "ui.toast" || event.action.startsWith("toast.")) {
    return "toast";
  }
  return "internal";
}

function isConsolidatableCommandEvent(event: OpsLogEvent): boolean {
  return (
    event.action === "command.exec" && typeof event.runId === "string" && event.runId.length > 0
  );
}

function isNewerEvent(a: OpsLogEvent, b: OpsLogEvent): boolean {
  return new Date(a.timestamp).getTime() > new Date(b.timestamp).getTime();
}

function mergeCommandEvents(grouped: {
  started?: OpsLogEvent;
  terminal?: OpsLogEvent;
  latest: OpsLogEvent;
}): OpsLogEvent {
  const base = grouped.started ?? grouped.terminal ?? grouped.latest;
  const terminal = grouped.terminal ?? grouped.started ?? grouped.latest;
  const commandSource = terminal.command ?? base.command;
  const mergedCommand = commandSource
    ? {
        command: commandSource.command,
        args: commandSource.args,
        cwd: terminal.command?.cwd ?? base.command?.cwd,
        pid: terminal.command?.pid ?? base.command?.pid,
        exitCode: terminal.command?.exitCode ?? base.command?.exitCode,
        signal: terminal.command?.signal ?? base.command?.signal,
        durationMs: terminal.command?.durationMs ?? base.command?.durationMs,
        stdout: terminal.command?.stdout ?? base.command?.stdout,
        stderr: terminal.command?.stderr ?? base.command?.stderr,
      }
    : undefined;
  const mergedMetadata =
    base.metadata || terminal.metadata
      ? {
          ...base.metadata,
          ...terminal.metadata,
        }
      : undefined;

  return {
    ...base,
    ...terminal,
    id: base.id,
    timestamp: base.timestamp,
    level: terminal.level,
    status: terminal.status,
    message: terminal.message,
    worktreeId: terminal.worktreeId ?? base.worktreeId,
    projectName: terminal.projectName ?? base.projectName,
    ...(mergedCommand ? { command: mergedCommand } : {}),
    ...(mergedMetadata ? { metadata: mergedMetadata } : {}),
  };
}

function consolidateOpsEvents(events: OpsLogEvent[]): OpsLogEvent[] {
  if (events.length === 0) return events;

  const passthrough: OpsLogEvent[] = [];
  const byRunId = new Map<
    string,
    {
      started?: OpsLogEvent;
      terminal?: OpsLogEvent;
      latest: OpsLogEvent;
    }
  >();

  for (const event of events) {
    if (!isConsolidatableCommandEvent(event)) {
      passthrough.push(event);
      continue;
    }

    const runId = event.runId as string;
    const existing = byRunId.get(runId);
    if (!existing) {
      byRunId.set(runId, {
        started: event.status === "started" ? event : undefined,
        terminal: event.status === "started" ? undefined : event,
        latest: event,
      });
      continue;
    }

    if (event.status === "started") {
      if (!existing.started || isNewerEvent(existing.started, event)) {
        existing.started = event;
      }
    } else if (!existing.terminal || isNewerEvent(event, existing.terminal)) {
      existing.terminal = event;
    }

    if (isNewerEvent(event, existing.latest)) {
      existing.latest = event;
    }
  }

  const consolidatedCommands = [...byRunId.values()].map((group) => mergeCommandEvents(group));
  return [...passthrough, ...consolidatedCommands].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

function stripStatusPrefix(message: string): string {
  return message.replace(STATUS_PREFIX_PATTERN, "");
}

function getLogStatusLabel(event: OpsLogEvent): string {
  const isCommandEvent = event.action === "command.exec" || Boolean(event.command);
  if (!isCommandEvent) return event.status;
  if (event.status === "succeeded") return "success";
  return event.status;
}

function shouldShowCommandProgress(event: OpsLogEvent): boolean {
  const isCommandEvent = event.action === "command.exec" || Boolean(event.command);
  return isCommandEvent && event.status === "started";
}

function renderLogMessage(event: OpsLogEvent): ReactNode {
  const message = stripStatusPrefix(event.message);
  const method = getHttpMethod(event);
  if (!method) return message;

  const prefix = `${method} `;
  if (!message.startsWith(prefix)) {
    return message;
  }

  return (
    <>
      <span className={getHttpMethodTextClass(method)}>{method}</span>
      {message.slice(method.length)}
    </>
  );
}

function renderHttpTitle(event: OpsLogEvent): ReactNode {
  const method = getHttpMethod(event);
  if (!method) return renderLogMessage(event);

  const path = getHttpPath(event);
  if (!path) return renderLogMessage(event);

  return (
    <>
      <span className={getHttpMethodTextClass(method)}>{method}</span>
      {` ${path}`}
    </>
  );
}

function renderLogTitle(event: OpsLogEvent): ReactNode {
  if (getHttpMethod(event)) {
    return renderHttpTitle(event);
  }

  if (event.action === "log") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <RectangleEllipsis className="w-3.5 h-3.5 text-[#9ca3af]" />
        <span>{event.message}</span>
      </span>
    );
  }

  if (event.action === "toast.error") {
    const title = typeof event.metadata?.title === "string" ? event.metadata.title : undefined;
    const description =
      typeof event.metadata?.description === "string" ? event.metadata.description : undefined;
    return (
      <span className="inline-flex items-center gap-1.5">
        <MessageCircleX className="w-3.5 h-3.5 text-red-400 shrink-0" />
        {title && description ? (
          <span className="flex flex-col">
            <span className="text-red-200/90">{title}</span>
            <span className="text-[11px] text-red-200/50">{description}</span>
          </span>
        ) : (
          <span>{event.message}</span>
        )}
      </span>
    );
  }

  if (event.action === "toast.success") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <MessageCircleCheck className="w-3.5 h-3.5 text-emerald-400" />
        <span>{event.message}</span>
      </span>
    );
  }

  const commandTitle = getCommandTitle(event);
  if (!commandTitle) return renderLogMessage(event);

  return (
    <span className="inline-flex items-center gap-1.5">
      <Terminal className="w-3.5 h-3.5 text-[#9ca3af]" />
      <span>{commandTitle}</span>
      {shouldShowCommandProgress(event) && (
        <Loader2 className="w-3 h-3 text-sky-300 animate-spin" />
      )}
    </span>
  );
}

function matchesLogQuery(event: OpsLogEvent, query: string): boolean {
  if (!query) return true;
  const method = getHttpMethod(event);
  const message = stripStatusPrefix(event.message);
  const requestPayload = getHttpMetadataString(event, "requestPayload");
  const responsePayload = getHttpMetadataString(event, "responsePayload");
  const haystack = [
    message,
    event.source,
    event.action,
    method,
    requestPayload,
    responsePayload,
    event.command?.command,
    event.command?.args.join(" "),
    event.command?.cwd,
    event.command?.stdout,
    event.command?.stderr,
    event.worktreeId,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n")
    .toLowerCase();
  return haystack.includes(query);
}

interface OpsLogVirtualListProps {
  filteredOpsEvents: OpsLogEvent[];
  expandedPayloadKeys: Set<string>;
  onTogglePayload: (eventId: string, kind: "request" | "response") => void;
  scrollRef: (node: HTMLDivElement | null) => void;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
}

function OpsLogVirtualList({
  filteredOpsEvents,
  expandedPayloadKeys,
  onTogglePayload,
  scrollRef,
  onScroll,
}: OpsLogVirtualListProps) {
  const opsLogScrollRef = useRef<HTMLDivElement>(null);
  const opsLogVirtualizer = useVirtualizer({
    count: filteredOpsEvents.length,
    getScrollElement: () => opsLogScrollRef.current,
    estimateSize: () => 64,
    overscan: 10,
    getItemKey: (index) => filteredOpsEvents[index]?.id ?? index,
  });

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      (opsLogScrollRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      scrollRef(node);
    },
    [scrollRef],
  );

  return (
    <div ref={setRefs} className="h-full overflow-y-auto" onScroll={onScroll}>
      <div style={{ height: `${opsLogVirtualizer.getTotalSize()}px`, position: "relative" }}>
        {opsLogVirtualizer.getVirtualItems().map((virtualRow) => {
          const event = filteredOpsEvents[virtualRow.index];
          const httpStatusCode = getHttpStatusCode(event);
          const httpTransportTag = getHttpTransportTag(event);
          const requestPayload = getHttpMetadataString(event, "requestPayload");
          const responsePayload = getHttpMetadataString(event, "responsePayload");
          const requestContentType = getHttpMetadataString(event, "requestContentType");
          const responseContentType = getHttpMetadataString(event, "responseContentType");
          const requestPayloadOmitted = getHttpMetadataFlag(event, "requestPayloadOmitted");
          const responsePayloadOmitted = getHttpMetadataFlag(event, "responsePayloadOmitted");
          const requestPayloadTruncated = getHttpMetadataFlag(event, "requestPayloadTruncated");
          const responsePayloadTruncated = getHttpMetadataFlag(event, "responsePayloadTruncated");
          const requestPayloadError = getHttpMetadataString(event, "requestPayloadError");
          const responsePayloadError = getHttpMetadataString(event, "responsePayloadError");
          const requestPayloadExpanded = expandedPayloadKeys.has(`${event.id}:request`);
          const responsePayloadExpanded = expandedPayloadKeys.has(`${event.id}:response`);
          const requestCopyText = buildPayloadCopyText({
            title: "Request",
            contentType: requestContentType,
            payload: requestPayload,
            payloadOmitted: requestPayloadOmitted,
            payloadError: requestPayloadError,
            payloadTruncated: requestPayloadTruncated,
          });
          const responseCopyText = buildPayloadCopyText({
            title: "Response",
            contentType: responseContentType,
            payload: responsePayload,
            payloadOmitted: responsePayloadOmitted,
            payloadError: responsePayloadError,
            payloadTruncated: responsePayloadTruncated,
          });
          const hasRequestCopyContent = typeof requestPayload === "string";
          const hasResponseCopyContent = typeof responsePayload === "string";
          const hasHttpPayloadDetails =
            !!getHttpMethod(event) &&
            !!(
              requestPayload ||
              responsePayload ||
              requestPayloadOmitted ||
              responsePayloadOmitted ||
              requestPayloadError ||
              responsePayloadError
            );

          return (
            <div
              key={event.id}
              data-index={virtualRow.index}
              ref={opsLogVirtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div className="px-4 py-3 border-b border-white/[0.05]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className={`text-xs ${text.primary} break-words`}>{renderLogTitle(event)}</p>
                    <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                      {event.action === "log" && (
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded ${LOG_LEVEL_CLASS[event.level]}`}
                        >
                          {event.level}
                        </span>
                      )}
                      {typeof httpStatusCode === "number" ? (
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded ${getHttpStatusChipClass(httpStatusCode)}`}
                        >
                          {httpStatusCode}
                        </span>
                      ) : event.action !== "log" &&
                        !event.action.startsWith("toast.") &&
                        !shouldShowCommandProgress(event) ? (
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded ${LOG_STATUS_CLASS[event.status]}`}
                        >
                          {getLogStatusLabel(event)}
                        </span>
                      ) : null}
                      <span className={`text-[10px] ${text.dimmed}`}>
                        {event.source}
                        {event.action === "log" && typeof event.metadata?.domain === "string"
                          ? ` · ${event.metadata.domain.toLowerCase()}`
                          : ""}
                      </span>
                      {event.action !== "log" && (
                        <span className={`text-[10px] ${text.dimmed}`}>{event.action}</span>
                      )}
                      {httpTransportTag && (
                        <span className={`text-[10px] ${text.dimmed}`}>({httpTransportTag})</span>
                      )}
                      {event.worktreeId && (
                        <span className={`text-[10px] ${text.dimmed}`}>
                          worktree: {event.worktreeId}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-[10px] ${text.muted}`}>
                      {formatClockTime(event.timestamp)}
                    </p>
                    <p className={`text-[10px] ${text.dimmed}`}>
                      {formatRelativeTime(event.timestamp)}
                    </p>
                  </div>
                </div>

                {hasHttpPayloadDetails && (
                  <>
                    <div className="group/payload mt-2 rounded-md bg-black/20 px-2 pb-2 pt-1 relative">
                      {hasRequestCopyContent && (
                        <PayloadCopyButton
                          copyText={requestCopyText}
                          ariaLabel="Copy request payload"
                          className="absolute top-1 right-1 p-1 rounded text-white/45 hover:text-white transition-colors opacity-0 group-hover/payload:opacity-100 pointer-events-none group-hover/payload:pointer-events-auto"
                        />
                      )}
                      <p className="text-[10px] text-[#6b7280] inline-flex items-center gap-1.5">
                        <ArrowUpRight className="w-3 h-3" />
                        <span>Request{requestContentType ? ` (${requestContentType})` : ""}</span>
                      </p>
                      {requestPayload ? (
                        <button
                          type="button"
                          onClick={() => onTogglePayload(event.id, "request")}
                          className="group mt-2 w-full text-left"
                        >
                          <pre
                            className={`text-[10px] text-slate-200 whitespace-pre-wrap break-words font-mono leading-[1.25] ${
                              requestPayloadExpanded ? "" : "max-h-[6.25em] overflow-hidden"
                            }`}
                          >
                            {formatPayloadForDisplay(requestPayload)}
                          </pre>
                          <p className="mt-4 text-[10px] text-[#6b7280] group-hover/payload:text-white transition-colors inline-flex items-center gap-1">
                            {requestPayloadExpanded ? (
                              <ChevronsDownUp className="w-3 h-3" />
                            ) : (
                              <ChevronsUpDown className="w-3 h-3" />
                            )}
                            <span>
                              {requestPayloadExpanded ? "Click to collapse" : "Click to expand"}
                            </span>
                          </p>
                        </button>
                      ) : requestPayloadOmitted ? (
                        <p className="mt-1 text-[10px] text-[#9ca3af]">
                          Payload omitted (non-text content)
                        </p>
                      ) : requestPayloadError ? (
                        <p className="mt-1 text-[10px] text-red-300/90">{requestPayloadError}</p>
                      ) : (
                        <p className="mt-1 text-[10px] text-[#9ca3af]">No request payload</p>
                      )}
                      {requestPayloadTruncated && (
                        <p className="mt-1 text-[10px] text-amber-300/90">
                          Request payload truncated
                        </p>
                      )}
                    </div>

                    <div className="group/payload mt-2 rounded-md bg-black/20 px-2 pb-2 pt-1 relative">
                      {hasResponseCopyContent && (
                        <PayloadCopyButton
                          copyText={responseCopyText}
                          ariaLabel="Copy response payload"
                          className="absolute top-1 right-1 p-1 rounded text-white/45 hover:text-white transition-colors opacity-0 group-hover/payload:opacity-100 pointer-events-none group-hover/payload:pointer-events-auto"
                        />
                      )}
                      <p className="text-[10px] text-[#6b7280] inline-flex items-center gap-1.5">
                        <ArrowDownLeft className="w-3 h-3" />
                        <span>
                          Response{responseContentType ? ` (${responseContentType})` : ""}
                        </span>
                      </p>
                      {responsePayload ? (
                        <button
                          type="button"
                          onClick={() => onTogglePayload(event.id, "response")}
                          className="group mt-2 w-full text-left"
                        >
                          <pre
                            className={`text-[10px] text-slate-200 whitespace-pre-wrap break-words font-mono leading-[1.25] ${
                              responsePayloadExpanded ? "" : "max-h-[6.25em] overflow-hidden"
                            }`}
                          >
                            {formatPayloadForDisplay(responsePayload)}
                          </pre>
                          <p className="mt-4 text-[10px] text-[#6b7280] group-hover/payload:text-white transition-colors inline-flex items-center gap-1">
                            {responsePayloadExpanded ? (
                              <ChevronsDownUp className="w-3 h-3" />
                            ) : (
                              <ChevronsUpDown className="w-3 h-3" />
                            )}
                            <span>
                              {responsePayloadExpanded ? "Click to collapse" : "Click to expand"}
                            </span>
                          </p>
                        </button>
                      ) : responsePayloadOmitted ? (
                        <p className="mt-1 text-[10px] text-[#9ca3af]">
                          Payload omitted (non-text content)
                        </p>
                      ) : responsePayloadError ? (
                        <p className="mt-1 text-[10px] text-red-300/90">{responsePayloadError}</p>
                      ) : (
                        <p className="mt-1 text-[10px] text-[#9ca3af]">No response payload</p>
                      )}
                      {responsePayloadTruncated && (
                        <p className="mt-1 text-[10px] text-amber-300/90">
                          Response payload truncated
                        </p>
                      )}
                    </div>
                  </>
                )}

                {event.command && (
                  <div className="mt-2 rounded-md bg-black/20 p-2">
                    <p className="text-[10px] font-mono break-words">
                      <span className="text-teal-300">$</span>{" "}
                      <span className="text-white">
                        {event.command.command}
                        {event.command.args.length > 0 ? ` ${event.command.args.join(" ")}` : ""}
                      </span>
                    </p>
                    <div className="mt-1 flex items-center gap-3 flex-wrap">
                      {event.command.cwd && (
                        <span className={`text-[10px] ${text.dimmed} font-mono`}>
                          {event.command.cwd}
                        </span>
                      )}
                      {typeof event.command.durationMs === "number" && (
                        <span
                          className={`text-[10px] ${text.dimmed} inline-flex items-center gap-1`}
                        >
                          <Clock3 className="w-3 h-3" />
                          {event.command.durationMs}ms
                        </span>
                      )}
                      {event.command.exitCode !== undefined && event.command.exitCode !== null && (
                        <span className={`text-[10px] ${text.dimmed}`}>
                          exit {event.command.exitCode}
                        </span>
                      )}
                      {event.command.signal && (
                        <span className={`text-[10px] ${text.dimmed}`}>
                          signal {event.command.signal}
                        </span>
                      )}
                    </div>
                    {event.command.stderr && (
                      <p className="mt-1 text-[10px] text-red-300/90 whitespace-pre-wrap break-words font-mono">
                        {event.command.stderr}
                      </p>
                    )}
                    {event.command.stdout && (
                      <p className="mt-1 text-[10px] text-slate-300 whitespace-pre-wrap break-words font-mono">
                        {event.command.stdout}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ActivityPage({
  disabledActivityEventTypes,
  onNavigateToWorktree,
  onNavigateToIssue,
}: ActivityPageProps) {
  const { feeds } = useProjectActivityFeeds(disabledActivityEventTypes);
  const { feeds: opsFeeds } = useProjectOpsLogs();
  const opsFeedByProjectId = useMemo(
    () => Object.fromEntries(opsFeeds.map((feed) => [feed.project.id, feed])),
    [opsFeeds],
  );

  const [selectedFilterGroupsByProjectId, setSelectedFilterGroupsByProjectId] = useState<
    Record<string, ActivityFilterGroup[]>
  >({});
  const [debugModeByProjectId, setDebugModeByProjectId] = useState<Record<string, boolean>>({});
  const [logSearchByProjectId, setLogSearchByProjectId] = useState<Record<string, string>>({});
  const [selectedLogLevelsByProjectId, setSelectedLogLevelsByProjectId] = useState<
    Record<string, OpsLogEvent["level"][]>
  >({});
  const [selectedLogDomainsByProjectId, setSelectedLogDomainsByProjectId] = useState<
    Record<string, LogDomainFilter[]>
  >({});
  const [selectedLogSurfacesByProjectId, setSelectedLogSurfacesByProjectId] = useState<
    Record<string, LogSurfaceFilter[]>
  >({});
  const [openLogFilterProjectId, setOpenLogFilterProjectId] = useState<string | null>(null);
  const [fullscreenProjectId, setFullscreenProjectId] = useState<string | null>(null);
  const logFilterRef = useRef<HTMLDivElement>(null);
  const [expandedPayloadKeys, setExpandedPayloadKeys] = useState<Set<string>>(() => new Set());
  const [showDebugBackToTopByProjectId, setShowDebugBackToTopByProjectId] = useState<
    Record<string, boolean>
  >({});
  const debugLogScrollRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!openLogFilterProjectId) return;
    const handleClick = (e: MouseEvent) => {
      if (logFilterRef.current && !logFilterRef.current.contains(e.target as Node)) {
        setOpenLogFilterProjectId(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openLogFilterProjectId]);

  const filterScopeByProjectId = useMemo(() => {
    const next: Record<string, string> = {};
    for (const feed of feeds) {
      next[feed.project.id] = activityFilterScopeForProject({
        serverUrl: feed.serverUrl,
        projectId: feed.project.id,
        projectName: feed.project.name,
      });
    }
    return next;
  }, [feeds]);

  useEffect(() => {
    const activeIds = new Set(feeds.map((feed) => feed.project.id));

    const pruneByActiveIds = <T,>(record: Record<string, T>): Record<string, T> => {
      const next: Record<string, T> = {};
      for (const [key, value] of Object.entries(record)) {
        if (activeIds.has(key)) {
          next[key] = value;
        }
      }
      return next;
    };

    setSelectedFilterGroupsByProjectId((prev) => pruneByActiveIds(prev));
    setDebugModeByProjectId((prev) => pruneByActiveIds(prev));
    setLogSearchByProjectId((prev) => pruneByActiveIds(prev));
    setSelectedLogLevelsByProjectId((prev) => pruneByActiveIds(prev));
    setSelectedLogDomainsByProjectId((prev) => pruneByActiveIds(prev));
    setSelectedLogSurfacesByProjectId((prev) => pruneByActiveIds(prev));
    setShowDebugBackToTopByProjectId((prev) => pruneByActiveIds(prev));
    setOpenLogFilterProjectId((prev) => (prev && activeIds.has(prev) ? prev : null));
  }, [feeds]);

  useEffect(() => {
    setSelectedFilterGroupsByProjectId((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const feed of feeds) {
        if (next[feed.project.id] !== undefined) continue;
        next[feed.project.id] = readPersistedActivityFilters(
          filterScopeByProjectId[feed.project.id],
        );
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [feeds, filterScopeByProjectId]);

  useEffect(() => {
    setDebugModeByProjectId((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const feed of feeds) {
        if (next[feed.project.id] !== undefined) continue;
        next[feed.project.id] = readPersistedActivityDebugMode(
          filterScopeByProjectId[feed.project.id],
        );
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [feeds, filterScopeByProjectId]);

  useEffect(() => {
    const allDomainIds = LOG_DOMAIN_OPTIONS.map((o) => o.id);
    const allSurfaceIds = LOG_SURFACE_OPTIONS.map((o) => o.id);

    setSelectedLogLevelsByProjectId((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const feed of feeds) {
        if (next[feed.project.id] !== undefined) continue;
        const persisted = readPersistedLogLevels(filterScopeByProjectId[feed.project.id]);
        if (persisted) {
          next[feed.project.id] = persisted.filter((l): l is OpsLogEvent["level"] =>
            LOG_LEVEL_OPTIONS.includes(l as OpsLogEvent["level"]),
          );
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    setSelectedLogDomainsByProjectId((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const feed of feeds) {
        if (next[feed.project.id] !== undefined) continue;
        const persisted = readPersistedLogDomains(filterScopeByProjectId[feed.project.id]);
        if (persisted) {
          next[feed.project.id] = persisted.filter((d): d is LogDomainFilter =>
            allDomainIds.includes(d as LogDomainFilter),
          );
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    setSelectedLogSurfacesByProjectId((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const feed of feeds) {
        if (next[feed.project.id] !== undefined) continue;
        const persisted = readPersistedLogSurfaces(filterScopeByProjectId[feed.project.id]);
        if (persisted) {
          next[feed.project.id] = persisted.filter((s): s is LogSurfaceFilter =>
            allSurfaceIds.includes(s as LogSurfaceFilter),
          );
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [feeds, filterScopeByProjectId]);

  useEffect(() => {
    for (const [projectId, selectedFilters] of Object.entries(selectedFilterGroupsByProjectId)) {
      const scope = filterScopeByProjectId[projectId];
      if (!scope) continue;
      writePersistedActivityFilters(scope, selectedFilters);
    }
  }, [filterScopeByProjectId, selectedFilterGroupsByProjectId]);

  useEffect(() => {
    for (const [projectId, enabled] of Object.entries(debugModeByProjectId)) {
      const scope = filterScopeByProjectId[projectId];
      if (!scope) continue;
      writePersistedActivityDebugMode(scope, enabled);
    }
  }, [debugModeByProjectId, filterScopeByProjectId]);

  useEffect(() => {
    const defaults = LOG_LEVEL_OPTIONS as string[];
    for (const [projectId, levels] of Object.entries(selectedLogLevelsByProjectId)) {
      const scope = filterScopeByProjectId[projectId];
      if (!scope) continue;
      writePersistedLogLevels(scope, levels, defaults);
    }
  }, [filterScopeByProjectId, selectedLogLevelsByProjectId]);

  useEffect(() => {
    const defaults = LOG_DOMAIN_OPTIONS.map((o) => o.id) as string[];
    for (const [projectId, domains] of Object.entries(selectedLogDomainsByProjectId)) {
      const scope = filterScopeByProjectId[projectId];
      if (!scope) continue;
      writePersistedLogDomains(scope, domains, defaults);
    }
  }, [filterScopeByProjectId, selectedLogDomainsByProjectId]);

  useEffect(() => {
    const defaults = LOG_SURFACE_OPTIONS.map((o) => o.id) as string[];
    for (const [projectId, surfaces] of Object.entries(selectedLogSurfacesByProjectId)) {
      const scope = filterScopeByProjectId[projectId];
      if (!scope) continue;
      writePersistedLogSurfaces(scope, surfaces, defaults);
    }
  }, [filterScopeByProjectId, selectedLogSurfacesByProjectId]);

  const seenSignature = useMemo(
    () =>
      feeds
        .map((feed) => `${feed.project.id}:${feed.events.map((event) => event.id).join(",")}`)
        .join("|"),
    [feeds],
  );

  useEffect(() => {
    if (!seenSignature) return;
    for (const feed of feeds) {
      if (!feed.isRunning || feed.events.length === 0) continue;
      feed.markEventsSeen(feed.events.map((event) => event.id));
    }
  }, [feeds, seenSignature]);

  const clearInputRequired = useCallback((event: ActivityEvent) => {
    const sourceServerUrl =
      typeof event.metadata?.sourceServerUrl === "string"
        ? (event.metadata.sourceServerUrl as string)
        : null;
    const fallbackGroupKey = event.worktreeId
      ? `agent-awaiting-input:${event.worktreeId}`
      : undefined;

    void createActivityEvent(
      {
        category: "agent",
        type: ACTIVITY_TYPES.AGENT_AWAITING_INPUT,
        severity: "info",
        title: "Input acknowledged",
        detail: "Opening agent context",
        worktreeId: event.worktreeId,
        groupKey: event.groupKey ?? fallbackGroupKey,
        metadata: {
          requiresUserAction: false,
          awaitingUserInput: false,
          cleared: true,
          clearedReason: "user-clicked",
          ...(sourceServerUrl ? { sourceServerUrl } : {}),
        },
      },
      sourceServerUrl,
    );
  }, []);

  const togglePayloadExpansion = useCallback((eventId: string, kind: "request" | "response") => {
    const key = `${eventId}:${kind}`;
    setExpandedPayloadKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  if (feeds.length === 0) {
    return (
      <div className="absolute inset-0 px-5 pb-16 overflow-hidden">
        <div className="min-h-[420px] rounded-xl border border-white/[0.08] bg-[#12151a] flex items-center justify-center">
          <div className="text-center">
            <p className={`text-sm ${text.secondary}`}>No projects are open.</p>
            <p className={`text-xs ${text.dimmed} mt-1`}>Open a project to view activity cards.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 px-5 pb-16 overflow-hidden">
      <div className="h-full min-h-0 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(500px,1fr))] [grid-auto-rows:minmax(0,1fr)]">
        {feeds.map((feed) => {
          if (fullscreenProjectId && fullscreenProjectId !== feed.project.id) return null;

          const debugMode = debugModeByProjectId[feed.project.id] ?? false;
          const selectedFilterGroups = selectedFilterGroupsByProjectId[feed.project.id] ?? [];
          const selectedFilterGroupSet = new Set(selectedFilterGroups);
          const unseenEventIds = new Set(
            feed.events
              .filter((event) => !feed.seenEventIds.has(event.id))
              .map((event) => event.id),
          );
          const hasActionRequiredEvents = feed.events.some((event) => isActionRequiredEvent(event));
          const badge = STATUS_BADGE[feed.project.status];
          const StatusIcon = badge.icon;

          const opsFeed = opsFeedByProjectId[feed.project.id];
          const opsEvents = consolidateOpsEvents(opsFeed?.events ?? []);
          const logSearchQuery = (logSearchByProjectId[feed.project.id] ?? "").trim().toLowerCase();
          const selectedLogLevels =
            selectedLogLevelsByProjectId[feed.project.id] ?? LOG_LEVEL_OPTIONS;
          const selectedLogDomains =
            selectedLogDomainsByProjectId[feed.project.id] ??
            LOG_DOMAIN_OPTIONS.map((option) => option.id);
          const selectedLogSurfaces =
            selectedLogSurfacesByProjectId[feed.project.id] ??
            LOG_SURFACE_OPTIONS.map((option) => option.id);
          const selectedLogLevelSet = new Set(selectedLogLevels);
          const selectedLogDomainSet = new Set(selectedLogDomains);
          const selectedLogSurfaceSet = new Set(selectedLogSurfaces);
          const isLogLevelFilterActive = selectedLogLevels.length < LOG_LEVEL_OPTIONS.length;
          const isLogDomainFilterActive = selectedLogDomains.length < LOG_DOMAIN_OPTIONS.length;
          const isLogSurfaceFilterActive = selectedLogSurfaces.length < LOG_SURFACE_OPTIONS.length;
          const isDebugFilterActive =
            isLogLevelFilterActive || isLogDomainFilterActive || isLogSurfaceFilterActive;
          const shouldShowDebugBackToTop = showDebugBackToTopByProjectId[feed.project.id] ?? false;
          const hasFailureInWindow = opsEvents.some(
            (event) => event.status === "failed" || event.level === "error",
          );
          const hasNoFailureInWindow = opsEvents.length > 0 && !hasFailureInWindow;
          const debugBorderClass = hasNoFailureInWindow
            ? "border-emerald-400/15"
            : "border-amber-400/20";
          const filteredOpsEvents = opsEvents.filter((event) => {
            if (!selectedLogLevelSet.has(event.level)) {
              return false;
            }
            if (!selectedLogDomainSet.has(getLogDomain(event))) {
              return false;
            }
            if (!selectedLogSurfaceSet.has(getLogSurface(event))) {
              return false;
            }
            return matchesLogQuery(event, logSearchQuery);
          });

          const clearCurrentView = () => {
            if (debugMode) {
              opsFeed?.clearAll();
            } else {
              feed.clearAll();
            }
          };

          return (
            <section
              key={feed.project.id}
              className={`min-w-[500px] h-full min-h-0 rounded-xl bg-[#12151a] flex flex-col border transition-colors ${
                debugMode ? debugBorderClass : "border-transparent"
              }`}
            >
              <div
                className={`px-4 py-3 border-b ${
                  hasActionRequiredEvents ? "border-amber-300/20" : "border-white/[0.06]"
                } flex items-center justify-between gap-3`}
              >
                <h2 className={`text-sm font-medium ${text.primary} truncate`}>
                  {feed.project.name}
                </h2>
                <div className="flex items-center gap-2">
                  {(feed.isRunning || debugMode) && (
                    <button
                      type="button"
                      onClick={clearCurrentView}
                      className={`mr-3 text-[10px] ${text.muted} hover:text-white transition-colors flex items-center gap-1 whitespace-nowrap`}
                    >
                      <Trash2 className="w-3 h-3" />
                      Clear
                    </button>
                  )}

                  {feed.isRunning && !debugMode && (
                    <div className="flex items-center gap-1.5 overflow-x-auto">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFilterGroupsByProjectId((prev) => ({
                            ...prev,
                            [feed.project.id]: [],
                          }));
                        }}
                        className={`px-2 py-0.5 rounded-md text-[10px] whitespace-nowrap transition-colors ${
                          selectedFilterGroupSet.size === 0
                            ? "bg-accent/20 text-accent"
                            : `${text.muted} bg-white/[0.04] hover:bg-white/[0.08] hover:text-white`
                        }`}
                      >
                        All
                      </button>
                      {ACTIVITY_FILTER_GROUP_OPTIONS.map((group) => {
                        const selected = selectedFilterGroupSet.has(group.id);
                        return (
                          <button
                            key={group.id}
                            type="button"
                            onClick={() => {
                              setSelectedFilterGroupsByProjectId((prev) => {
                                const current = prev[feed.project.id] ?? [];
                                const next = current.includes(group.id)
                                  ? current.filter((value) => value !== group.id)
                                  : [...current, group.id];
                                return {
                                  ...prev,
                                  [feed.project.id]: next,
                                };
                              });
                            }}
                            className={`px-2 py-0.5 rounded-md text-[10px] whitespace-nowrap transition-colors ${
                              selected
                                ? "bg-accent/20 text-accent"
                                : `${text.muted} bg-white/[0.04] hover:bg-white/[0.08] hover:text-white`
                            }`}
                          >
                            {group.label}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="ml-1 flex items-center gap-2">
                    <span className={`text-[10px] ${debugMode ? "text-amber-300" : text.muted}`}>
                      Debug
                    </span>
                    <ToggleSwitch
                      checked={debugMode}
                      size="sm"
                      ariaLabel="Toggle debug logs"
                      checkedTrackClassName="bg-amber-500/30"
                      checkedThumbClassName="bg-amber-300"
                      onToggle={() =>
                        setDebugModeByProjectId((prev) => ({
                          ...prev,
                          [feed.project.id]: !(prev[feed.project.id] ?? false),
                        }))
                      }
                    />
                  </div>

                  {feed.project.status !== "running" && (
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[10px] font-medium ${badge.className}`}
                    >
                      <StatusIcon
                        className={`w-3 h-3 ${feed.project.status === "starting" ? "animate-spin" : ""}`}
                      />
                      {badge.label}
                    </span>
                  )}

                  {feeds.length > 1 && (
                    <button
                      type="button"
                      aria-label={
                        fullscreenProjectId === feed.project.id
                          ? "Exit fullscreen"
                          : "Fullscreen panel"
                      }
                      title={
                        fullscreenProjectId === feed.project.id
                          ? "Exit fullscreen"
                          : "Fullscreen panel"
                      }
                      onClick={() =>
                        setFullscreenProjectId((prev) =>
                          prev === feed.project.id ? null : feed.project.id,
                        )
                      }
                      className={`p-1.5 rounded transition-colors ${text.muted} hover:text-white`}
                    >
                      {fullscreenProjectId === feed.project.id ? (
                        <Minimize2 className="w-3.5 h-3.5" />
                      ) : (
                        <Maximize2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </div>

              {debugMode ? (
                <div className="flex-1 min-h-0 flex flex-col">
                  <div className="px-4 py-2 border-b border-white/[0.06] flex items-center gap-2">
                    <div className="relative flex-1 min-w-0">
                      <Search
                        className={`w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 ${text.dimmed}`}
                      />
                      <input
                        value={logSearchByProjectId[feed.project.id] ?? ""}
                        onChange={(e) =>
                          setLogSearchByProjectId((prev) => ({
                            ...prev,
                            [feed.project.id]: e.target.value,
                          }))
                        }
                        placeholder="Search command, source, message..."
                        className={`w-full pl-7 pr-2 py-1.5 bg-white/[0.04] rounded text-xs ${text.primary} placeholder-[#6b7280] focus:outline-none focus:bg-white/[0.06]`}
                      />
                    </div>
                    <div ref={logFilterRef} className="relative">
                      <button
                        type="button"
                        aria-label="Filter debug logs"
                        title="Filter debug logs"
                        onClick={() =>
                          setOpenLogFilterProjectId((prev) =>
                            prev === feed.project.id ? null : feed.project.id,
                          )
                        }
                        className={`p-1.5 rounded transition-colors ${
                          isDebugFilterActive ? "text-amber-300" : `${text.muted} hover:text-white`
                        }`}
                      >
                        <ListFilter className="w-3.5 h-3.5" />
                      </button>

                      {openLogFilterProjectId === feed.project.id && (
                        <div className="absolute right-0 top-full mt-1.5 z-20 min-w-[170px] max-h-[70vh] overflow-y-auto rounded-md border border-white/[0.08] bg-[#171a1f] shadow-lg p-2 space-y-1">
                          <p className="mb-2 px-0.5 text-[10px] font-medium tracking-wide text-[#6b7280]">
                            Severity
                          </p>
                          {LOG_LEVEL_OPTIONS.map((level) => {
                            const checked = selectedLogLevelSet.has(level);
                            return (
                              <label
                                key={level}
                                className="flex items-center gap-2 text-[11px] text-[#c9d1d9] cursor-pointer select-none"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    setSelectedLogLevelsByProjectId((prev) => {
                                      const current = prev[feed.project.id] ?? LOG_LEVEL_OPTIONS;
                                      const nextSet = new Set<OpsLogEvent["level"]>(current);
                                      if (nextSet.has(level)) {
                                        nextSet.delete(level);
                                      } else {
                                        nextSet.add(level);
                                      }
                                      const nextLevels = LOG_LEVEL_OPTIONS.filter((value) =>
                                        nextSet.has(value),
                                      );
                                      return {
                                        ...prev,
                                        [feed.project.id]: nextLevels,
                                      };
                                    });
                                  }}
                                  className="h-3.5 w-3.5 rounded border-white/20 bg-white/10 accent-amber-400"
                                />
                                <span className="capitalize">{level}</span>
                              </label>
                            );
                          })}
                          <div className="mt-3 mb-1 border-t border-white/[0.08]" />
                          <p className="mt-2 mb-2 px-0.5 text-[10px] font-medium tracking-wide text-[#6b7280]">
                            Type
                          </p>
                          {LOG_DOMAIN_OPTIONS.map((domain) => {
                            const checked = selectedLogDomainSet.has(domain.id);
                            return (
                              <label
                                key={domain.id}
                                className="flex items-center gap-2 text-[11px] text-[#c9d1d9] cursor-pointer select-none"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    setSelectedLogDomainsByProjectId((prev) => {
                                      const current =
                                        prev[feed.project.id] ??
                                        LOG_DOMAIN_OPTIONS.map((option) => option.id);
                                      const nextSet = new Set<LogDomainFilter>(current);
                                      if (nextSet.has(domain.id)) {
                                        nextSet.delete(domain.id);
                                      } else {
                                        nextSet.add(domain.id);
                                      }
                                      const nextDomains = LOG_DOMAIN_OPTIONS.map(
                                        (option) => option.id,
                                      ).filter((value) => nextSet.has(value));
                                      return {
                                        ...prev,
                                        [feed.project.id]: nextDomains,
                                      };
                                    });
                                  }}
                                  className="h-3.5 w-3.5 rounded border-white/20 bg-white/10 accent-amber-400"
                                />
                                <span>{domain.label}</span>
                              </label>
                            );
                          })}
                          <div className="mt-3 mb-1 border-t border-white/[0.08]" />
                          <p className="mt-2 mb-2 px-0.5 text-[10px] font-medium tracking-wide text-[#6b7280]">
                            Surface
                          </p>
                          {LOG_SURFACE_OPTIONS.map((surface) => {
                            const checked = selectedLogSurfaceSet.has(surface.id);
                            return (
                              <label
                                key={surface.id}
                                className="flex items-center gap-2 text-[11px] text-[#c9d1d9] cursor-pointer select-none"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    setSelectedLogSurfacesByProjectId((prev) => {
                                      const current =
                                        prev[feed.project.id] ??
                                        LOG_SURFACE_OPTIONS.map((option) => option.id);
                                      const nextSet = new Set<LogSurfaceFilter>(current);
                                      if (nextSet.has(surface.id)) {
                                        nextSet.delete(surface.id);
                                      } else {
                                        nextSet.add(surface.id);
                                      }
                                      const nextSurfaces = LOG_SURFACE_OPTIONS.map(
                                        (option) => option.id,
                                      ).filter((value) => nextSet.has(value));
                                      return {
                                        ...prev,
                                        [feed.project.id]: nextSurfaces,
                                      };
                                    });
                                  }}
                                  className="h-3.5 w-3.5 rounded border-white/20 bg-white/10 accent-amber-400"
                                />
                                <span>{surface.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="relative flex-1 min-h-0">
                    {!feed.isRunning && opsEvents.length === 0 ? (
                      <div className="h-full overflow-y-auto flex items-center justify-center px-6 text-center">
                        <div>
                          <p className={`text-sm ${text.secondary}`}>Live activity unavailable</p>
                          <p className={`text-xs ${text.dimmed} mt-1 max-w-[420px]`}>
                            {buildUnavailableMessage(feed.project.status)}
                          </p>
                        </div>
                      </div>
                    ) : filteredOpsEvents.length === 0 ? (
                      <div className="h-full overflow-y-auto flex items-center justify-center px-6 text-center">
                        <div>
                          <p className={`text-sm ${text.secondary}`}>No matching logs.</p>
                          <p className={`text-xs ${text.dimmed} mt-1`}>
                            Adjust filters or wait for new activity.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <OpsLogVirtualList
                        filteredOpsEvents={filteredOpsEvents}
                        expandedPayloadKeys={expandedPayloadKeys}
                        onTogglePayload={togglePayloadExpansion}
                        scrollRef={(node) => {
                          debugLogScrollRefs.current[feed.project.id] = node;
                        }}
                        onScroll={(event) => {
                          const shouldShow = event.currentTarget.scrollTop > 120;
                          setShowDebugBackToTopByProjectId((prev) =>
                            prev[feed.project.id] === shouldShow
                              ? prev
                              : {
                                  ...prev,
                                  [feed.project.id]: shouldShow,
                                },
                          );
                        }}
                      />
                    )}
                    {shouldShowDebugBackToTop && filteredOpsEvents.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          debugLogScrollRefs.current[feed.project.id]?.scrollTo({
                            top: 0,
                            behavior: "smooth",
                          });
                        }}
                        aria-label="Back to top"
                        className="absolute left-1/2 -translate-x-1/2 bottom-4 z-10 w-8 h-8 rounded-full bg-white/[0.12] hover:bg-white/[0.2] text-white/80 hover:text-white flex items-center justify-center shadow-xl shadow-black/35 transition-colors"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {hasFailureInWindow && (
                    <div className="px-4 py-2 border-t border-amber-400/15 bg-amber-400/5 text-[11px] text-amber-200/85 flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Failure events detected in this project.
                    </div>
                  )}
                  {hasNoFailureInWindow && (
                    <div className="px-4 py-2 border-t border-emerald-400/15 bg-emerald-400/5 text-[11px] text-emerald-200/85 flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      No failures in current log window.
                    </div>
                  )}
                </div>
              ) : feed.isRunning ? (
                <ActivityFeedPanel
                  events={feed.events}
                  unseenEventIds={unseenEventIds}
                  isLoading={feed.isLoading}
                  onClearAll={feed.clearAll}
                  selectedFilterGroups={selectedFilterGroups}
                  onToggleFilterGroup={(group) => {
                    setSelectedFilterGroupsByProjectId((prev) => {
                      const current = prev[feed.project.id] ?? [];
                      const next = current.includes(group)
                        ? current.filter((value) => value !== group)
                        : [...current, group];
                      return {
                        ...prev,
                        [feed.project.id]: next,
                      };
                    });
                  }}
                  onClearFilterGroups={() => {
                    setSelectedFilterGroupsByProjectId((prev) => ({
                      ...prev,
                      [feed.project.id]: [],
                    }));
                  }}
                  onNavigateToWorktree={onNavigateToWorktree}
                  onNavigateToIssue={onNavigateToIssue}
                  onResolveActionRequired={clearInputRequired}
                  hideTitle
                  hideTopBar
                  hideClearAction
                  hideFilterBar
                  containerClassName="flex-1 min-h-0 flex flex-col"
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                  <p className={`text-sm ${text.secondary}`}>Live activity unavailable</p>
                  <p className={`text-xs ${text.dimmed} mt-1 max-w-[420px]`}>
                    {buildUnavailableMessage(feed.project.status)}
                  </p>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
