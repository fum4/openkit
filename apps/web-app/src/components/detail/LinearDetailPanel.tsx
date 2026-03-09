import { useEffect, useRef, useState } from "react";
import { GitBranch } from "lucide-react";

import { useLinearIssueDetail } from "../../hooks/useLinearIssueDetail";
import { useApi } from "../../hooks/useApi";
import { getLinearAttachmentUrl } from "../../hooks/api";
import { useServerUrlOptional } from "../../contexts/ServerContext";
import { badge, border, button, linearStateType, text } from "../../theme";
import { reportPersistentErrorToast } from "../../errorToasts";
import { Tooltip } from "../Tooltip";
import { TruncatedTooltip } from "../TruncatedTooltip";
import { MarkdownContent } from "../MarkdownContent";
import { AttachmentImage } from "../AttachmentImage";
import { GitHubIcon, LinearIcon } from "../../icons";
import { PersonalNotesSection, AgentSection } from "./NotesSection";
import { Spinner } from "../Spinner";
import { WorktreeExistsModal } from "../WorktreeExistsModal";
import { CodeAgentSplitButton, type CodingAgent } from "./CodeAgentSplitButton";
import { EditableTextareaCard } from "../EditableTextareaCard";
import { ConfirmDialog } from "../ConfirmDialog";

interface LinearDetailPanelProps {
  identifier: string;
  linkedWorktreeId: string | null;
  linkedWorktreePrUrl?: string | null;
  activeWorktreeIds: Set<string>;
  onCreateWorktree: (identifier: string) => void;
  onViewWorktree: (id: string) => void;
  onCodeWithClaude: (intent: {
    worktreeId: string;
    mode: "resume" | "start";
    prompt?: string;
    tabLabel?: string;
    skipPermissions?: boolean;
  }) => void;
  onCodeWithCodex: (intent: {
    worktreeId: string;
    mode: "resume" | "start";
    prompt?: string;
    tabLabel?: string;
  }) => void;
  onCodeWithGemini: (intent: {
    worktreeId: string;
    mode: "resume" | "start";
    prompt?: string;
    tabLabel?: string;
  }) => void;
  onCodeWithOpenCode: (intent: {
    worktreeId: string;
    mode: "resume" | "start";
    prompt?: string;
    tabLabel?: string;
  }) => void;
  selectedCodingAgent: CodingAgent;
  onSelectCodingAgent: (agent: CodingAgent) => void;
  refreshIntervalMinutes?: number;
  onSetupNeeded?: () => void;
}

function formatTimeAgo(timestamp: number): string {
  if (!timestamp) return "";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function resolveCreatedWorktreeId(result: {
  worktreeId?: string;
  worktree?: { id: string };
}): string | null {
  return result.worktreeId ?? result.worktree?.id ?? null;
}

function requiresWorktreeRecoveryPrompt(result: {
  success: boolean;
  code?: string;
  worktreeId?: string;
  error?: string;
}): boolean {
  if (result.success || !result.worktreeId) return false;
  if (result.code === "WORKTREE_RECOVERY_REQUIRED") return true;
  return (result.error ?? "").includes("cannot lock ref 'refs/heads/");
}

function formatDate(iso: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className={`text-[11px] font-medium ${text.muted} mb-3`}>{children}</h3>;
}

function getAttachmentLabel(att: { title: string; subtitle: string | null; url: string }): string {
  if (att.title?.trim()) return att.title.trim();
  if (att.subtitle?.trim()) return att.subtitle.trim();
  try {
    const pathname = new URL(att.url).pathname;
    const file = pathname.split("/").filter(Boolean).pop();
    if (file) return decodeURIComponent(file);
  } catch {
    // ignore parse errors
  }
  return "Attachment";
}

function isImageAttachment(att: {
  title: string;
  subtitle: string | null;
  url: string;
  sourceType: string | null;
}): boolean {
  if (att.sourceType?.toLowerCase().includes("image")) return true;
  const candidates = [att.url, att.title, att.subtitle ?? ""];
  return candidates.some((candidate) => {
    const clean = candidate.split("?")[0].toLowerCase();
    return /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/.test(clean);
  });
}

export function LinearDetailPanel({
  identifier,
  linkedWorktreeId,
  linkedWorktreePrUrl,
  activeWorktreeIds,
  onCreateWorktree,
  onViewWorktree,
  onCodeWithClaude,
  onCodeWithCodex,
  onCodeWithGemini,
  onCodeWithOpenCode,
  selectedCodingAgent,
  onSelectCodingAgent,
  refreshIntervalMinutes,
  onSetupNeeded,
}: LinearDetailPanelProps) {
  const api = useApi();
  const serverUrl = useServerUrlOptional();
  const { issue, isLoading, isFetching, error, refetch, dataUpdatedAt } = useLinearIssueDetail(
    identifier,
    refreshIntervalMinutes,
  );
  const [isCreating, setIsCreating] = useState(false);
  const [isCodingWithAgent, setIsCodingWithAgent] = useState(false);
  const [existingWorktree, setExistingWorktree] = useState<{ id: string; branch: string } | null>(
    null,
  );
  const [pendingCodeWithAgent, setPendingCodeWithAgent] = useState<{
    agent: CodingAgent;
    prompt: string;
    tabLabel: string;
  } | null>(null);
  const [statusOptions, setStatusOptions] = useState<
    Array<{ name: string; type: string; color: string }>
  >([]);
  const [priorityOptions, setPriorityOptions] = useState<Array<{ value: number; label: string }>>(
    [],
  );
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isUpdatingPriority, setIsUpdatingPriority] = useState(false);
  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
  const [isPriorityMenuOpen, setIsPriorityMenuOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [titleSaved, setTitleSaved] = useState(false);
  const titleSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [newComment, setNewComment] = useState("");
  const [isAddingComment, setIsAddingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentDraft, setEditingCommentDraft] = useState("");
  const [isUpdatingComment, setIsUpdatingComment] = useState(false);
  const [commentToDelete, setCommentToDelete] = useState<{ id: string; author: string } | null>(
    null,
  );
  const [isDeletingComment, setIsDeletingComment] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);
  const priorityMenuRef = useRef<HTMLDivElement | null>(null);
  const newCommentTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const activeLinkedWorktreeId =
    linkedWorktreeId && activeWorktreeIds.has(linkedWorktreeId) ? linkedWorktreeId : null;
  const activeLinkedWorktreePrUrl = activeLinkedWorktreeId ? linkedWorktreePrUrl : null;

  useEffect(() => {
    if (!isEditingTitle) {
      setTitleDraft(issue?.title ?? "");
    }
  }, [isEditingTitle, issue?.title]);

  useEffect(() => {
    return () => {
      if (titleSaveTimerRef.current) clearTimeout(titleSaveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isStatusMenuOpen && !isPriorityMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedStatusMenu = statusMenuRef.current?.contains(target);
      const clickedPriorityMenu = priorityMenuRef.current?.contains(target);
      if (!clickedStatusMenu) {
        setIsStatusMenuOpen(false);
      }
      if (!clickedPriorityMenu) {
        setIsPriorityMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [isPriorityMenuOpen, isStatusMenuOpen]);

  useEffect(() => {
    if (!issue?.identifier) return;
    let active = true;
    void api.fetchLinearIssueStatusOptions(issue.identifier).then((result) => {
      if (!active) return;
      setStatusOptions(result.options ?? []);
    });
    return () => {
      active = false;
    };
  }, [api, issue?.identifier, issue?.state.name]);

  useEffect(() => {
    let active = true;
    void api.fetchLinearPriorityOptions().then((result) => {
      if (!active) return;
      setPriorityOptions(result.options ?? []);
    });
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    if (error) {
      reportPersistentErrorToast(error, "Failed to load Linear issue", {
        scope: "linear:detail-load",
      });
    }
  }, [error]);

  const handleCreate = async () => {
    setIsCreating(true);
    const result = await api.createFromLinear(identifier);
    setIsCreating(false);
    const createdWorktreeId = resolveCreatedWorktreeId(result);
    if (result.success && createdWorktreeId) {
      onCreateWorktree(createdWorktreeId);
    } else if (result.success) {
      reportPersistentErrorToast(
        "Worktree was created, but the response did not include a worktree id.",
        "Failed to create worktree",
        {
          scope: "linear:create-worktree",
        },
      );
    } else if (
      (result.code === "WORKTREE_EXISTS" || requiresWorktreeRecoveryPrompt(result)) &&
      result.worktreeId
    ) {
      setPendingCodeWithAgent(null);
      setExistingWorktree({ id: result.worktreeId, branch: identifier });
    } else {
      const errorMsg = result.error || "Failed to create worktree";
      if (errorMsg.includes("no commits") || errorMsg.includes("invalid reference")) {
        if (onSetupNeeded) {
          onSetupNeeded();
        } else {
          reportPersistentErrorToast(errorMsg, "Failed to create worktree", {
            scope: "linear:create-worktree",
          });
        }
      } else {
        reportPersistentErrorToast(errorMsg, "Failed to create worktree", {
          scope: "linear:create-worktree",
        });
      }
    }
  };

  const launchCodingAgent = (
    agent: CodingAgent,
    intent: {
      worktreeId: string;
      mode: "resume" | "start";
      prompt?: string;
      tabLabel?: string;
    },
  ) => {
    if (agent === "claude") {
      onCodeWithClaude(intent);
      return;
    }
    if (agent === "codex") {
      onCodeWithCodex(intent);
      return;
    }
    if (agent === "gemini") {
      onCodeWithGemini(intent);
      return;
    }
    onCodeWithOpenCode(intent);
  };

  const handleCodeWithAgent = async (agent: CodingAgent) => {
    onSelectCodingAgent(agent);
    setIsCodingWithAgent(true);
    const result = await api.createFromLinear(identifier);
    setIsCodingWithAgent(false);
    const launchPrompt = `Implement Linear issue ${identifier}${issue?.title ? ` (${issue.title})` : ""}. You are already in the correct worktree. Read TASK.md first, then execute the normal OpenKit flow: run pre-implementation hooks before coding, run required custom hooks when conditions match, and run post-implementation hooks before finishing. Treat AI context and todo checklist as highest-priority instructions. If you need user approval or instructions, run openkit activity await-input before asking.`;
    if (requiresWorktreeRecoveryPrompt(result)) {
      setPendingCodeWithAgent({ agent, prompt: launchPrompt, tabLabel: identifier });
      setExistingWorktree({ id: result.worktreeId as string, branch: identifier });
      return;
    }
    const reusingExistingWorktree =
      (result.success && result.reusedExisting === true) ||
      (!result.success && result.code === "WORKTREE_EXISTS" && !!result.worktreeId);
    if (result.success || reusingExistingWorktree) {
      const worktreeId = result.worktreeId ?? identifier;
      launchCodingAgent(agent, {
        worktreeId,
        mode: reusingExistingWorktree ? "resume" : "start",
        tabLabel: identifier,
        prompt: reusingExistingWorktree ? undefined : launchPrompt,
      });
    } else {
      const errorMsg = result.error || "Failed to create worktree";
      if (errorMsg.includes("no commits") || errorMsg.includes("invalid reference")) {
        if (onSetupNeeded) {
          onSetupNeeded();
        } else {
          reportPersistentErrorToast(errorMsg, "Failed to create worktree", {
            scope: "linear:code-worktree",
          });
        }
      } else {
        reportPersistentErrorToast(errorMsg, "Failed to create worktree", {
          scope: "linear:code-worktree",
        });
      }
    }
  };

  const handleUpdateStatus = async (statusName: string) => {
    if (!statusName) return;
    const currentIssueIdentifier = issue?.identifier;
    if (!currentIssueIdentifier) return;
    if (statusName === issue?.state.name) return;
    setIsUpdatingStatus(true);
    const result = await api.updateLinearIssueStatus(currentIssueIdentifier, statusName);
    setIsUpdatingStatus(false);
    if (!result.success) {
      reportPersistentErrorToast(result.error, "Failed to update status", {
        scope: "linear:update-status",
      });
      return;
    }
    await refetch();
  };

  const handleUpdatePriority = async (priority: number) => {
    const currentIssueIdentifier = issue?.identifier;
    if (!currentIssueIdentifier) return;
    if (priority === issue?.priority) return;
    setIsUpdatingPriority(true);
    const result = await api.updateLinearIssuePriority(currentIssueIdentifier, priority);
    setIsUpdatingPriority(false);
    if (!result.success) {
      reportPersistentErrorToast(result.error, "Failed to update priority", {
        scope: "linear:update-priority",
      });
      return;
    }
    await refetch();
  };

  const persistTitle = async (rawTitle: string, closeEditor = false) => {
    const currentIssueIdentifier = issue?.identifier;
    const nextTitle = rawTitle.trim();
    if (!currentIssueIdentifier || !nextTitle) {
      if (closeEditor) {
        setTitleDraft(issue?.title ?? "");
        setIsEditingTitle(false);
        setTitleSaved(false);
      }
      return;
    }
    if (nextTitle === issue?.title) {
      if (closeEditor) {
        setIsEditingTitle(false);
        setTitleSaved(false);
      }
      return;
    }
    setIsSavingTitle(true);
    const result = await api.updateLinearIssueTitle(currentIssueIdentifier, nextTitle);
    setIsSavingTitle(false);
    if (!result.success) {
      reportPersistentErrorToast(result.error, "Failed to update title", {
        scope: "linear:update-title",
      });
      if (closeEditor) {
        setIsEditingTitle(false);
        setTitleSaved(false);
      }
      return;
    }
    setTitleSaved(true);
    await refetch();
    if (closeEditor) {
      setIsEditingTitle(false);
      setTitleSaved(false);
    }
  };

  const handleAddComment = async () => {
    const comment = newComment.trim();
    if (!comment) return;
    const currentIssueIdentifier = issue?.identifier;
    if (!currentIssueIdentifier) return;
    setIsAddingComment(true);
    const result = await api.addLinearIssueComment(currentIssueIdentifier, comment);
    setIsAddingComment(false);
    if (!result.success) {
      reportPersistentErrorToast(result.error, "Failed to add comment", {
        scope: "linear:add-comment",
      });
      return;
    }
    setNewComment("");
    if (newCommentTextareaRef.current) {
      newCommentTextareaRef.current.style.height = "auto";
    }
    await refetch();
  };

  useEffect(() => {
    const textarea = newCommentTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [newComment]);

  const handleUpdateComment = async () => {
    const currentIssueIdentifier = issue?.identifier;
    const commentId = editingCommentId;
    const comment = editingCommentDraft.trim();
    if (!currentIssueIdentifier || !commentId || !comment) return;
    setIsUpdatingComment(true);
    const result = await api.updateLinearIssueComment(currentIssueIdentifier, commentId, comment);
    setIsUpdatingComment(false);
    if (!result.success) {
      reportPersistentErrorToast(result.error, "Failed to update comment", {
        scope: "linear:update-comment",
      });
      return;
    }
    setEditingCommentId(null);
    setEditingCommentDraft("");
    await refetch();
  };

  const handleDeleteComment = async () => {
    const currentIssueIdentifier = issue?.identifier;
    const commentId = commentToDelete?.id;
    if (!currentIssueIdentifier || !commentId) return;
    setIsDeletingComment(true);
    const result = await api.deleteLinearIssueComment(currentIssueIdentifier, commentId);
    setIsDeletingComment(false);
    if (!result.success) {
      reportPersistentErrorToast(result.error, "Failed to delete comment", {
        scope: "linear:delete-comment",
      });
      return;
    }
    setCommentToDelete(null);
    if (editingCommentId === commentId) {
      setEditingCommentId(null);
      setEditingCommentDraft("");
    }
    await refetch();
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2">
        <Spinner size="sm" className={text.muted} />
        <p className={`${text.muted} text-sm`}>Loading issue...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className={`${text.muted} text-sm`}>Unable to load issue details.</p>
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className={`${text.muted} text-sm`}>Select an issue to view details</p>
      </div>
    );
  }

  const priorityLabel = issue.priorityLabel || String(issue.priority);
  const headerChipClass =
    "inline-flex h-5 min-h-5 shrink-0 items-center justify-center whitespace-nowrap rounded px-2 text-[11px] font-medium leading-5 align-middle box-border";
  const attachmentProxyUrl = (url: string) => getLinearAttachmentUrl(url, serverUrl);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className={`flex-shrink-0 px-5 py-4 border-b ${border.section}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Tooltip position="right" text="Open in Linear">
                <a
                  href={issue.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`text-xs font-semibold ${badge.linear} ${badge.linearHover} transition-colors`}
                >
                  {issue.identifier}
                </a>
              </Tooltip>
              {statusOptions.length > 0 ? (
                <div ref={statusMenuRef} className="relative ml-2 flex h-5 items-center">
                  <button
                    type="button"
                    onClick={() => setIsStatusMenuOpen((prev) => !prev)}
                    disabled={isUpdatingStatus}
                    className={`${headerChipClass} ${linearStateType[issue.state.type.toLowerCase()] ?? ""} disabled:opacity-70`}
                    style={
                      !linearStateType[issue.state.type.toLowerCase()]
                        ? { backgroundColor: `${issue.state.color}20`, color: issue.state.color }
                        : undefined
                    }
                  >
                    {issue.state.name}
                  </button>
                  {isStatusMenuOpen && (
                    <div className="absolute left-0 top-full mt-1 z-10 min-w-[140px] rounded-md border border-white/[0.08] bg-[#101318] shadow-lg overflow-hidden">
                      {statusOptions.map((option) => (
                        <button
                          key={option.name}
                          type="button"
                          onClick={() => {
                            setIsStatusMenuOpen(false);
                            void handleUpdateStatus(option.name);
                          }}
                          className={`block w-full text-left px-2.5 py-1.5 text-[11px] ${text.secondary} hover:bg-white/[0.06] transition-colors`}
                        >
                          {option.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <span
                  className={`ml-2 ${headerChipClass} ${linearStateType[issue.state.type.toLowerCase()] ?? ""}`}
                  style={
                    !linearStateType[issue.state.type.toLowerCase()]
                      ? { backgroundColor: `${issue.state.color}20`, color: issue.state.color }
                      : undefined
                  }
                >
                  {issue.state.name}
                </span>
              )}
              {issue.labels.length > 0 && <span className={`text-[5px] ${text.dimmed}`}>●</span>}
              {issue.labels.map((label) => (
                <span
                  key={label.name}
                  className="text-[11px] font-medium px-2 py-0.5 rounded"
                  style={{ backgroundColor: `${label.color}20`, color: label.color }}
                >
                  {label.name}
                </span>
              ))}
              <span className={`text-[5px] ${text.dimmed}`}>●</span>
              {priorityOptions.length > 0 ? (
                <div ref={priorityMenuRef} className="relative flex h-5 items-center">
                  <button
                    type="button"
                    onClick={() => setIsPriorityMenuOpen((prev) => !prev)}
                    disabled={isUpdatingPriority}
                    className={`${headerChipClass} ${text.secondary} disabled:opacity-70`}
                  >
                    {priorityLabel}
                  </button>
                  {isPriorityMenuOpen && (
                    <div className="absolute left-0 top-full mt-1 z-10 min-w-[120px] rounded-md border border-white/[0.08] bg-[#101318] shadow-lg overflow-hidden">
                      {priorityOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            setIsPriorityMenuOpen(false);
                            void handleUpdatePriority(option.value);
                          }}
                          className={`block w-full text-left px-2.5 py-1.5 text-[11px] ${text.secondary} hover:bg-white/[0.06] transition-colors`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <span className={`${headerChipClass} ${text.secondary}`}>{priorityLabel}</span>
              )}
            </div>
            {isEditingTitle ? (
              <input
                type="text"
                value={titleDraft}
                onChange={(event) => {
                  const nextTitle = event.target.value;
                  setTitleDraft(nextTitle);
                  if (titleSaved) setTitleSaved(false);
                  if (titleSaveTimerRef.current) clearTimeout(titleSaveTimerRef.current);
                  titleSaveTimerRef.current = setTimeout(() => {
                    void persistTitle(nextTitle, false);
                  }, 3000);
                }}
                onBlur={() => {
                  if (titleSaveTimerRef.current) clearTimeout(titleSaveTimerRef.current);
                  void persistTitle(titleDraft, true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (titleSaveTimerRef.current) clearTimeout(titleSaveTimerRef.current);
                    void persistTitle(titleDraft, true);
                  }
                  if (event.key === "Escape") {
                    if (titleSaveTimerRef.current) clearTimeout(titleSaveTimerRef.current);
                    setTitleDraft(issue.title);
                    setTitleSaved(false);
                    setIsEditingTitle(false);
                  }
                }}
                className={`w-full text-[15px] font-semibold ${text.primary} leading-snug bg-transparent border border-white/[0.12] rounded-md px-2 py-1 focus:outline-none focus:border-white/[0.3]`}
                autoFocus
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setTitleDraft(issue.title);
                  setIsEditingTitle(true);
                }}
                className={`text-left text-[15px] font-semibold ${text.primary} leading-snug hover:bg-white/[0.03] rounded px-1 -mx-1 transition-colors`}
              >
                {issue.title}
              </button>
            )}
          </div>
          <div className="flex-shrink-0 pt-1 flex items-center gap-2">
            {(isSavingTitle || titleSaved) && (
              <div className="min-w-[46px] flex justify-end">
                {isSavingTitle ? (
                  <Spinner size="xs" className={text.muted} />
                ) : (
                  <span className={`text-[10px] ${text.muted} font-medium`}>Saved</span>
                )}
              </div>
            )}
            <Tooltip
              position="left"
              text={dataUpdatedAt ? `Last refreshed: ${formatTimeAgo(dataUpdatedAt)}` : "Refresh"}
            >
              <button
                type="button"
                onClick={() => refetch()}
                className={`p-1.5 rounded-lg ${text.muted} hover:text-[#c0c5cc] hover:bg-white/[0.06] transition-colors duration-150 flex items-center gap-1`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className={`w-3.5 h-3.5 ${isFetching && !isLoading ? "animate-spin" : ""}`}
                >
                  <path
                    fillRule="evenodd"
                    d="M13.836 2.477a.75.75 0 0 1 .75.75v3.182a.75.75 0 0 1-.75.75h-3.182a.75.75 0 0 1 0-1.5h1.37l-.84-.841a4.5 4.5 0 0 0-7.08.681.75.75 0 0 1-1.3-.75 6 6 0 0 1 9.44-.908l.84.84V3.227a.75.75 0 0 1 .75-.75Zm-.911 7.5A.75.75 0 0 1 13.199 11a6 6 0 0 1-9.44.908l-.84-.84v1.456a.75.75 0 0 1-1.5 0V9.341a.75.75 0 0 1 .75-.75h3.182a.75.75 0 0 1 0 1.5h-1.37l.84.841a4.5 4.5 0 0 0 7.08-.681.75.75 0 0 1 1.024-.274Z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </Tooltip>
            <a
              href={issue.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`group inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${button.secondary} rounded-lg transition-colors duration-150`}
            >
              <LinearIcon className="w-3.5 h-3.5 text-[#6b7280] transition-colors group-hover:text-[#5E6AD2] [&>svg]:text-inherit" />
              Open in Linear
            </a>
            {activeLinkedWorktreeId ? (
              <>
                <button
                  type="button"
                  onClick={() => onViewWorktree(activeLinkedWorktreeId)}
                  className={`group inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${button.secondary} rounded-lg transition-colors duration-150`}
                >
                  <GitBranch className="w-3.5 h-3.5 text-[#6b7280] transition-colors group-hover:text-accent" />
                  View Worktree
                </button>
                {activeLinkedWorktreePrUrl && (
                  <a
                    href={activeLinkedWorktreePrUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`group inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${button.secondary} rounded-lg transition-colors duration-150`}
                  >
                    <GitHubIcon className="w-3.5 h-3.5 text-[#6b7280] transition-colors group-hover:text-white" />
                    View PR
                  </a>
                )}
                <CodeAgentSplitButton
                  selectedAgent={selectedCodingAgent}
                  onSelectAgent={onSelectCodingAgent}
                  onLaunch={(agent) => void handleCodeWithAgent(agent)}
                  disabled={isCodingWithAgent}
                  isLoading={isCodingWithAgent}
                  loadingLabel="Opening..."
                />
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={isCreating || isCodingWithAgent}
                  className={`group inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${button.secondary} rounded-lg transition-colors duration-150 active:scale-[0.98]`}
                >
                  <GitBranch className="w-3.5 h-3.5 text-[#6b7280] transition-colors group-hover:text-accent" />
                  {isCreating ? "Creating..." : "Create Worktree"}
                </button>
                <CodeAgentSplitButton
                  selectedAgent={selectedCodingAgent}
                  onSelectAgent={onSelectCodingAgent}
                  onLaunch={(agent) => void handleCodeWithAgent(agent)}
                  disabled={isCreating || isCodingWithAgent}
                  isLoading={isCodingWithAgent}
                  loadingLabel="Preparing..."
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-12">
        <section>
          <SectionLabel>Description</SectionLabel>
          <EditableTextareaCard
            value={issue.description ?? ""}
            debounceMs={3000}
            rows={10}
            showSaveState={true}
            showInlineSaveError={false}
            onSave={async (nextValue) => {
              const result = await api.updateLinearIssueDescription(issue.identifier, nextValue);
              if (!result.success) {
                reportPersistentErrorToast(
                  `Failed to save Linear issue description: ${result.error ?? "Unknown error"}`,
                  "Failed to save Linear issue description",
                  {
                    scope: "linear:update-description",
                  },
                );
                return false;
              }
              await refetch();
              return true;
            }}
            renderPreview={(value) =>
              value ? (
                <MarkdownContent content={value} />
              ) : (
                <p className={`text-xs ${text.dimmed}`}>No description.</p>
              )
            }
          />
        </section>

        {issue.attachments.length > 0 && (
          <section>
            <SectionLabel>Attachments ({issue.attachments.length})</SectionLabel>
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
              <div className="flex flex-wrap gap-3">
                {issue.attachments.map((att, i) => (
                  <a
                    key={`${att.url}-${i}`}
                    href={attachmentProxyUrl(att.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex flex-col w-36"
                  >
                    {isImageAttachment(att) ? (
                      <AttachmentImage
                        src={attachmentProxyUrl(att.url)}
                        alt={getAttachmentLabel(att)}
                        className="w-36 h-28 rounded object-cover transition-transform group-hover:scale-[1.02]"
                      />
                    ) : (
                      <div className="w-36 h-28 rounded bg-white/[0.03] flex items-center justify-center hover:bg-white/[0.06] transition-colors">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          className={`w-6 h-6 ${text.dimmed} group-hover:${text.muted} transition-colors`}
                        >
                          <path d="M12.232 4.232a2.5 2.5 0 0 1 3.536 3.536l-1.225 1.224a.75.75 0 0 0 1.061 1.06l1.224-1.224a4 4 0 0 0-5.656-5.656l-3 3a4 4 0 0 0 .225 5.865.75.75 0 0 0 .977-1.138 2.5 2.5 0 0 1-.142-3.667l3-3Z" />
                          <path d="M11.603 7.963a.75.75 0 0 0-.977 1.138 2.5 2.5 0 0 1 .142 3.667l-3 3a2.5 2.5 0 0 1-3.536-3.536l1.225-1.224a.75.75 0 0 0-1.061-1.06l-1.224 1.224a4 4 0 1 0 5.656 5.656l3-3a4 4 0 0 0-.225-5.865Z" />
                        </svg>
                      </div>
                    )}
                    <TruncatedTooltip
                      text={getAttachmentLabel(att)}
                      className={`text-[10px] ${text.muted} group-hover:${text.secondary} mt-1.5 transition-colors`}
                    />
                    {att.sourceType && (
                      <span className={`text-[9px] ${text.dimmed}`}>{att.sourceType}</span>
                    )}
                  </a>
                ))}
              </div>
            </div>
          </section>
        )}

        <section>
          <SectionLabel>Comments ({issue.comments.length})</SectionLabel>
          <div className="space-y-3">
            <div>
              <div className="relative">
                {isAddingComment ? (
                  <div className="absolute top-2 right-2">
                    <Spinner size="xs" className={text.muted} />
                  </div>
                ) : null}
                <textarea
                  ref={newCommentTextareaRef}
                  value={newComment}
                  onChange={(event) => setNewComment(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleAddComment();
                    }
                  }}
                  rows={3}
                  placeholder="Add a comment..."
                  className={`w-full min-h-[72px] overflow-hidden rounded-md bg-white/[0.03] border border-white/[0.08] px-3 py-2 text-xs ${text.secondary} focus:outline-none focus:border-white/[0.2] resize-none`}
                />
              </div>
              <div className="-mt-1 mb-5">
                <span className={`pl-1 text-[10px] ${text.dimmed}`}>
                  Enter to post, Shift + Enter for newline
                </span>
              </div>
            </div>
            {issue.comments.map((comment) => (
              <div
                key={comment.id}
                className="rounded-lg bg-white/[0.02] border border-white/[0.04] px-4 py-3"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[11px] font-medium ${text.primary}`}>
                    {comment.author}
                  </span>
                  <span className={`text-[10px] ${text.dimmed}`}>
                    {formatDate(comment.createdAt)}
                  </span>
                  {comment.canEdit && (
                    <span className={`ml-2 text-[10px] ${text.dimmed}`}>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingCommentId(comment.id);
                          setEditingCommentDraft(comment.body);
                        }}
                        className="hover:text-white transition-colors"
                      >
                        Edit
                      </button>
                      <span className="mx-1.5">|</span>
                      <button
                        type="button"
                        onClick={() =>
                          setCommentToDelete({ id: comment.id, author: comment.author })
                        }
                        className="hover:text-white transition-colors"
                      >
                        Delete
                      </button>
                    </span>
                  )}
                </div>
                {editingCommentId === comment.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={editingCommentDraft}
                      onChange={(event) => setEditingCommentDraft(event.target.value)}
                      rows={4}
                      className={`w-full rounded-md bg-white/[0.03] border border-white/[0.08] px-3 py-2 text-xs ${text.secondary} focus:outline-none focus:border-white/[0.2]`}
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingCommentId(null);
                          setEditingCommentDraft("");
                        }}
                        className={`px-2.5 py-1 text-[11px] rounded ${button.secondary}`}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleUpdateComment()}
                        disabled={isUpdatingComment || editingCommentDraft.trim().length === 0}
                        className={`px-2.5 py-1 text-[11px] rounded ${button.secondary} disabled:opacity-50`}
                      >
                        {isUpdatingComment ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <MarkdownContent content={comment.body} />
                )}
              </div>
            ))}
          </div>
        </section>

        <PersonalNotesSection source="linear" issueId={issue.identifier} />
        <AgentSection source="linear" issueId={issue.identifier} />

        {/* Footer */}
        <div className={`text-[10px] ${text.dimmed} flex flex-wrap gap-4 pt-2`}>
          {issue.assignee && <span>Assigned to {issue.assignee}</span>}
          <span>Created {formatDate(issue.createdAt)}</span>
          <span>Updated {formatDate(issue.updatedAt)}</span>
        </div>
      </div>

      {existingWorktree && (
        <WorktreeExistsModal
          worktreeId={existingWorktree.id}
          branch={existingWorktree.branch}
          onResolved={(action) => {
            const pendingLaunch = pendingCodeWithAgent;
            setExistingWorktree(null);
            setPendingCodeWithAgent(null);
            onCreateWorktree(existingWorktree.id);
            if (pendingLaunch) {
              launchCodingAgent(pendingLaunch.agent, {
                worktreeId: existingWorktree.id,
                mode: action === "reuse" ? "resume" : "start",
                tabLabel: pendingLaunch.tabLabel,
                prompt: action === "reuse" ? undefined : pendingLaunch.prompt,
              });
            }
          }}
          onCancel={() => {
            setExistingWorktree(null);
            setPendingCodeWithAgent(null);
          }}
        />
      )}
      {commentToDelete && (
        <ConfirmDialog
          title="Delete Comment?"
          confirmLabel={isDeletingComment ? "Deleting..." : "Delete"}
          onConfirm={() => void handleDeleteComment()}
          onCancel={() => {
            if (!isDeletingComment) setCommentToDelete(null);
          }}
        >
          <p className={`text-xs ${text.secondary}`}>
            Delete this comment by {commentToDelete.author}?
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
