import { useEffect, useRef, useState } from "react";

import type { OpenProjectTarget, OpenProjectTargetOption } from "../../hooks/api";
import type { WorktreeInfo } from "../../types";
import {
  CursorIcon,
  FinderIcon,
  GhosttyIcon,
  IntelliJIcon,
  LinearIcon,
  NeoVimIcon,
  TerminalIcon,
  VSCodeIcon,
  WarpIcon,
  WebStormIcon,
  ZedIcon,
} from "../../icons";
import { action, badge, button, status, surface, text } from "../../theme";
import { Tooltip } from "../Tooltip";

interface DetailHeaderProps {
  worktree: WorktreeInfo;
  isRunning: boolean;
  isCreating: boolean;
  isLoading: boolean;
  onRename: (changes: { name?: string; branch?: string }) => Promise<boolean>;
  onStart: () => void;
  onStop: () => void;
  onRemove: () => void;
  openTargetOptions: OpenProjectTargetOption[];
  selectedOpenTarget: OpenProjectTarget | null;
  onSelectOpenTarget: (target: OpenProjectTarget) => void;
  onOpenProjectIn: (target: OpenProjectTarget) => void;
  onSelectJiraIssue?: (key: string) => void;
  onSelectLinearIssue?: (identifier: string) => void;
  onSelectLocalIssue?: (identifier: string) => void;
}

function InlineEdit({
  value,
  className,
  editClassName,
  editable,
  onSave,
}: {
  value: string;
  className: string;
  editClassName: string;
  editable: boolean;
  onSave: (newValue: string) => Promise<boolean>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const commit = async () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      const ok = await onSave(trimmed);
      if (!ok) setDraft(value);
    } else {
      setDraft(value);
    }
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") inputRef.current?.blur();
          if (e.key === "Escape") {
            setDraft(value);
            setIsEditing(false);
          }
        }}
        className={editClassName}
      />
    );
  }

  return (
    <span
      className={`${className} ${editable ? `cursor-text hover:${surface.editableHover} px-1 -mx-1 rounded transition-colors duration-150` : ""}`}
      onClick={editable ? () => setIsEditing(true) : undefined}
      title={editable ? "Click to edit" : undefined}
    >
      {value}
    </span>
  );
}

function OpenTargetAppIcon({
  target,
  className = "w-4 h-4",
}: {
  target: OpenProjectTarget;
  className?: string;
}) {
  const iconClassName = target === "cursor" ? `${className} invert` : className;
  switch (target) {
    case "file-manager":
      return <FinderIcon className={iconClassName} />;
    case "cursor":
      return <CursorIcon className={iconClassName} />;
    case "vscode":
      return <VSCodeIcon className={iconClassName} />;
    case "zed":
      return <ZedIcon className={iconClassName} />;
    case "intellij":
      return <IntelliJIcon className={iconClassName} />;
    case "webstorm":
      return <WebStormIcon className={iconClassName} />;
    case "terminal":
      return <TerminalIcon className={iconClassName} />;
    case "warp":
      return <WarpIcon className={iconClassName} />;
    case "ghostty":
      return <GhosttyIcon className={iconClassName} />;
    case "neovim":
      return <NeoVimIcon className={iconClassName} />;
    default:
      return <FinderIcon className={iconClassName} />;
  }
}

function OpenProjectSplitButton({
  isLoading,
  openTargetOptions,
  selectedOpenTarget,
  onSelectOpenTarget,
  onOpenProjectIn,
}: {
  isLoading: boolean;
  openTargetOptions: OpenProjectTargetOption[];
  selectedOpenTarget: OpenProjectTarget | null;
  onSelectOpenTarget: (target: OpenProjectTarget) => void;
  onOpenProjectIn: (target: OpenProjectTarget) => void;
}) {
  const [isOpenMenuVisible, setIsOpenMenuVisible] = useState(false);
  const openMenuRef = useRef<HTMLDivElement>(null);
  const selectedTargetOption =
    openTargetOptions.find((option) => option.target === selectedOpenTarget) ?? null;
  const openButtonLabel = selectedTargetOption ? `Open in ${selectedTargetOption.label}` : "Open";
  const hasOpenTargets = openTargetOptions.length > 0;

  useEffect(() => {
    if (!isOpenMenuVisible) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!openMenuRef.current) return;
      if (!openMenuRef.current.contains(event.target as Node)) {
        setIsOpenMenuVisible(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpenMenuVisible(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpenMenuVisible]);

  return (
    <div className="relative inline-flex" ref={openMenuRef}>
      <button
        type="button"
        onClick={() => {
          if (selectedTargetOption) onOpenProjectIn(selectedTargetOption.target);
        }}
        disabled={isLoading || !selectedTargetOption}
        title={
          selectedTargetOption
            ? `Open in ${selectedTargetOption.label}`
            : "No supported apps detected"
        }
        className={`group h-7 pl-2.5 pr-3 text-[11px] font-medium ${button.secondary} rounded-l-md border-r border-white/[0.06] disabled:opacity-50 transition-colors duration-150 inline-flex items-center gap-[10px]`}
      >
        <OpenTargetAppIcon
          target={selectedTargetOption?.target ?? "file-manager"}
          className="w-4 h-4 grayscale transition-[filter] duration-150 group-hover:grayscale-0"
        />
        {openButtonLabel}
      </button>
      <button
        type="button"
        onClick={() => {
          if (!hasOpenTargets) return;
          setIsOpenMenuVisible((prev) => !prev);
        }}
        disabled={isLoading || !hasOpenTargets}
        aria-haspopup="menu"
        aria-expanded={isOpenMenuVisible}
        title="Open project in"
        className={`group h-7 px-2 text-[11px] font-medium ${button.secondary} rounded-r-md disabled:opacity-50 transition-colors duration-150 inline-flex items-center`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="w-3 h-3 text-[#6b7280] group-hover:text-white transition-colors"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.512a.75.75 0 0 1-1.08 0L5.21 8.268a.75.75 0 0 1 .02-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {isOpenMenuVisible && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-white/[0.08] bg-[#11151d] shadow-xl p-1 z-20"
        >
          {openTargetOptions.map((option) => (
            <button
              key={option.target}
              type="button"
              role="menuitem"
              className={`w-full text-left px-2 py-1.5 text-[11px] rounded-md ${text.secondary} hover:${text.primary} hover:bg-white/[0.06] transition-colors duration-150 inline-flex items-center gap-2`}
              onClick={() => {
                setIsOpenMenuVisible(false);
                onSelectOpenTarget(option.target);
                onOpenProjectIn(option.target);
              }}
            >
              <OpenTargetAppIcon target={option.target} className="w-4 h-4" />
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DetailHeader({
  worktree,
  isRunning,
  isCreating,
  isLoading,
  onRename,
  onStart,
  onStop,
  onRemove,
  openTargetOptions,
  selectedOpenTarget,
  onSelectOpenTarget,
  onOpenProjectIn,
  onSelectJiraIssue,
  onSelectLinearIssue,
  onSelectLocalIssue,
}: DetailHeaderProps) {
  const editable = !isRunning && !isCreating;

  return (
    <div className="flex-shrink-0 px-5 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <InlineEdit
            value={worktree.id}
            className={`text-[16px] font-semibold ${text.primary} truncate`}
            editClassName={`text-[16px] font-semibold ${text.primary} bg-transparent border-b border-white/[0.15] focus:border-white/[0.30] outline-none w-44 pb-0.5 transition-colors duration-150`}
            editable={editable}
            onSave={(v) => onRename({ name: v })}
          />
          <InlineEdit
            value={worktree.branch}
            className={`text-xs ${text.muted} truncate`}
            editClassName={`text-xs ${text.muted} bg-transparent border-b border-white/[0.10] focus:border-white/[0.25] outline-none w-72 pb-0.5 transition-colors duration-150`}
            editable={editable}
            onSave={(v) => onRename({ branch: v })}
          />
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isCreating && (
            <span
              className={`px-2 py-0.5 text-[11px] font-medium ${status.creating.badge} rounded-full`}
            >
              Creating
            </span>
          )}
          {!isCreating && (
            <>
              <button
                type="button"
                onClick={onRemove}
                disabled={isLoading}
                aria-label="Delete worktree"
                title="Delete worktree"
                className={`group h-7 px-2.5 text-[11px] font-medium ${button.secondary} hover:text-red-400 rounded-md disabled:opacity-50 transition-colors duration-150 inline-flex items-center gap-1.5`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-3.5 h-3.5 text-[#6b7280] transition-colors group-hover:text-red-400"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.519.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z"
                    clipRule="evenodd"
                  />
                </svg>
                Delete
              </button>
              {isRunning ? (
                <button
                  type="button"
                  onClick={onStop}
                  disabled={isLoading}
                  className={`h-7 px-2.5 text-[11px] font-medium ${action.stop.text} ${action.stop.hover} rounded-md disabled:opacity-50 transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5`}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="w-3.5 h-3.5"
                  >
                    <path
                      fillRule="evenodd"
                      d="M2 10a8 8 0 1 1 16 0 8 8 0 0 1-16 0Zm5-2.25A.75.75 0 0 1 7.75 7h4.5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-.75.75h-4.5a.75.75 0 0 1-.75-.75v-4.5Z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onStart}
                  disabled={isLoading}
                  className={`group h-7 px-2.5 text-[11px] font-medium ${button.secondary} hover:text-accent rounded-md disabled:opacity-50 transition-colors duration-150 active:scale-[0.98] inline-flex items-center gap-1.5`}
                >
                  {isLoading ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="w-3.5 h-3.5 text-[#6b7280] transition-colors group-hover:text-accent animate-spin"
                    >
                      <path
                        fillRule="evenodd"
                        d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H4.598a.75.75 0 0 0-.75.75v3.634a.75.75 0 0 0 1.5 0v-2.033l.312.311a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.06-7.19a.75.75 0 0 0-1.5 0v2.033l-.312-.312a7 7 0 0 0-11.712 3.138.75.75 0 0 0 1.449.39 5.5 5.5 0 0 1 9.201-2.466l.312.312H11.58a.75.75 0 1 0 0 1.5h3.634a.75.75 0 0 0 .75-.75V4.234Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="w-3.5 h-3.5 text-[#6b7280] transition-colors group-hover:text-accent"
                    >
                      <path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.841Z" />
                    </svg>
                  )}
                  Run
                </button>
              )}
              <OpenProjectSplitButton
                isLoading={isLoading}
                openTargetOptions={openTargetOptions}
                selectedOpenTarget={selectedOpenTarget}
                onSelectOpenTarget={onSelectOpenTarget}
                onOpenProjectIn={onOpenProjectIn}
              />
            </>
          )}
          {worktree.ports.length > 0 && (
            <span className={`text-[11px] font-mono ${text.muted}`}>
              {worktree.ports.map((p) => `:${p}`).join(" ")}
            </span>
          )}
        </div>
      </div>

      {/* Integration links — flat, no nested badges */}
      {(worktree.jiraUrl ||
        worktree.linearUrl ||
        worktree.localIssueId ||
        worktree.githubPrUrl) && (
        <div className="flex items-center gap-3 mt-2.5">
          {worktree.jiraUrl &&
            (() => {
              const jiraKey = worktree.jiraUrl!.match(/\/browse\/([A-Z]+-\d+)/)?.[1];
              return (
                <Tooltip position="right" text="View issue">
                  <button
                    type="button"
                    onClick={() => jiraKey && onSelectJiraIssue?.(jiraKey)}
                    className={`flex items-center gap-1.5 text-[11px] ${badge.jira} ${badge.jiraHover} transition-colors duration-150`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-3 h-3"
                    >
                      <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
                      <path d="M13 5v2" />
                      <path d="M13 17v2" />
                      <path d="M13 11v2" />
                    </svg>
                    Jira{worktree.jiraStatus ? ` \u00b7 ${worktree.jiraStatus}` : ""}
                  </button>
                </Tooltip>
              );
            })()}
          {worktree.linearUrl &&
            (() => {
              const linearId = worktree.linearUrl!.match(/\/issue\/([A-Z]+-\d+)/)?.[1];
              return (
                <Tooltip position="right" text="View issue">
                  <button
                    type="button"
                    onClick={() => linearId && onSelectLinearIssue?.(linearId)}
                    className={`flex items-center gap-1.5 text-[11px] ${badge.linear} ${badge.linearHover} transition-colors duration-150`}
                  >
                    <LinearIcon className="w-3 h-3" />
                    Linear{worktree.linearStatus ? ` \u00b7 ${worktree.linearStatus}` : ""}
                  </button>
                </Tooltip>
              );
            })()}
          {worktree.localIssueId && (
            <Tooltip position="right" text="View issue">
              <button
                type="button"
                onClick={() => onSelectLocalIssue?.(worktree.localIssueId!)}
                className={`flex items-center gap-1.5 text-[11px] ${badge.localIssue} ${badge.localIssueHover} transition-colors duration-150`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-3 h-3"
                >
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <line x1="10" y1="9" x2="8" y2="9" />
                </svg>
                Local{worktree.localIssueStatus ? ` \u00b7 ${worktree.localIssueStatus}` : ""}
              </button>
            </Tooltip>
          )}
          {worktree.githubPrUrl && (
            <Tooltip position="right" text="Open pull request">
              <a
                href={worktree.githubPrUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center gap-1.5 text-[11px] transition-colors duration-150 ${
                  worktree.githubPrState === "merged"
                    ? "text-purple-400 hover:text-purple-300"
                    : worktree.githubPrState === "open"
                      ? "text-emerald-400 hover:text-emerald-300"
                      : "text-[#9ca3af] hover:text-white"
                }`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="w-3 h-3"
                >
                  <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
                </svg>
                PR
                {worktree.githubPrState
                  ? ` \u00b7 ${worktree.githubPrState === "draft" ? "Draft" : worktree.githubPrState === "open" ? "Open" : worktree.githubPrState === "merged" ? "Merged" : "Closed"}`
                  : ""}
              </a>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}
