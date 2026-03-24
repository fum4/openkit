import { useEffect, useRef, useState } from "react";
import { GitBranch } from "lucide-react";

import { useJiraIssueDetail } from "../../hooks/useJiraIssueDetail";
import { useApi } from "../../hooks/useApi";
import { useServerUrlOptional } from "../../contexts/ServerContext";
import type { JiraIssueDetail } from "../../types";
import { badge, border, button, jiraPriority, jiraStatus, jiraType, text } from "../../theme";
import { reportPersistentErrorToast } from "../../errorToasts";
import { Tooltip } from "../Tooltip";
import { TruncatedTooltip } from "../TruncatedTooltip";
import { AttachmentImage } from "../AttachmentImage";
import { MarkdownContent } from "../MarkdownContent";
import { GitHubIcon, JiraIcon } from "../../icons";
import { PersonalNotesSection, AgentSection } from "./NotesSection";
import { Spinner } from "../Spinner";
import { WorktreeExistsModal } from "../WorktreeExistsModal";
import { ImageModal } from "../ImageModal";
import { CodeAgentSplitButton, type CodingAgent } from "./CodeAgentSplitButton";
import { EditableTextareaCard } from "../EditableTextareaCard";
import { ConfirmDialog } from "../ConfirmDialog";

interface JiraDetailPanelProps {
  issueKey: string;
  linkedWorktreeId: string | null;
  linkedWorktreePrUrl?: string | null;
  activeWorktreeIds: Set<string>;
  onCreateWorktree: (key: string) => void;
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

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function proxyUrl(url: string, serverUrl: string | null) {
  return `${serverUrl ?? ""}/api/jira/attachment?url=${encodeURIComponent(url)}`;
}

function isImage(mimeType: string) {
  return mimeType.startsWith("image/");
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className={`text-[11px] font-medium ${text.muted} mb-3`}>{children}</h3>;
}

function AttachmentsSection({ attachments }: { attachments: JiraIssueDetail["attachments"] }) {
  const serverUrl = useServerUrlOptional();
  const [preview, setPreview] = useState<{
    src: string;
    filename: string;
    type: "image" | "pdf";
  } | null>(null);

  return (
    <>
      <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
        <div className="flex flex-wrap gap-3">
          {attachments.map((att, i) => {
            const isImg = isImage(att.mimeType) && att.contentUrl;
            const isPdf = att.mimeType === "application/pdf" && att.contentUrl;
            const url = att.contentUrl ? proxyUrl(att.contentUrl, serverUrl) : null;

            return (
              <div key={i} className="group flex flex-col w-36">
                <div className="relative">
                  {isImg ? (
                    <button
                      type="button"
                      onClick={() =>
                        setPreview({ src: url!, filename: att.filename, type: "image" })
                      }
                      className="rounded overflow-hidden block"
                    >
                      <AttachmentImage
                        src={proxyUrl(att.thumbnail || att.contentUrl!, serverUrl)}
                        alt={att.filename}
                        className="w-36 h-28 object-cover transition-transform hover:scale-105"
                      />
                    </button>
                  ) : isPdf ? (
                    <button
                      type="button"
                      onClick={() => setPreview({ src: url!, filename: att.filename, type: "pdf" })}
                      className="w-36 h-28 rounded bg-white/[0.03] flex flex-col items-center justify-center gap-1 hover:gap-1.5 hover:bg-white/[0.06] transition-all group/pdf"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="w-8 h-8 text-red-400/70 transition-transform group-hover/pdf:scale-110"
                      >
                        <path d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0 0 16.5 9h-1.875a1.875 1.875 0 0 1-1.875-1.875V5.25A3.75 3.75 0 0 0 9 1.5H5.625Z" />
                        <path d="M12.971 1.816A5.23 5.23 0 0 1 14.25 5.25v1.875c0 .207.168.375.375.375H16.5a5.23 5.23 0 0 1 3.434 1.279 9.768 9.768 0 0 0-6.963-6.963Z" />
                      </svg>
                      <span
                        className={`text-[10px] font-semibold ${text.secondary} transition-transform group-hover/pdf:scale-110`}
                      >
                        PDF
                      </span>
                    </button>
                  ) : (
                    <div className="w-36 h-28 rounded bg-white/[0.03] flex items-center justify-center">
                      <FileIcon mimeType={att.mimeType} />
                    </div>
                  )}
                </div>
                <TruncatedTooltip
                  text={att.filename}
                  className={`text-[10px] ${text.muted} mt-1.5`}
                />
                <span className={`text-[9px] ${text.dimmed}`}>{formatSize(att.size)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {preview && (
        <ImageModal
          src={preview.src}
          filename={preview.filename}
          type={preview.type}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}

function FileIcon({ mimeType }: { mimeType: string }) {
  const color = mimeType.includes("pdf")
    ? "text-red-400"
    : mimeType.includes("zip") || mimeType.includes("archive")
      ? "text-yellow-400"
      : mimeType.includes("text") || mimeType.includes("json")
        ? "text-green-400"
        : "text-gray-400";
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={`w-3.5 h-3.5 flex-shrink-0 ${color}`}
    >
      <path d="M3 3.5A1.5 1.5 0 0 1 4.5 2h6.879a1.5 1.5 0 0 1 1.06.44l4.122 4.12A1.5 1.5 0 0 1 17 8.622V16.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 16.5v-13Z" />
    </svg>
  );
}

export function JiraDetailPanel({
  issueKey,
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
}: JiraDetailPanelProps) {
  const api = useApi();
  const serverUrl = useServerUrlOptional();
  const { issue, isLoading, isFetching, error, refetch, dataUpdatedAt } = useJiraIssueDetail(
    issueKey,
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
  const [statusOptions, setStatusOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [priorityOptions, setPriorityOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [typeOptions, setTypeOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isUpdatingPriority, setIsUpdatingPriority] = useState(false);
  const [isUpdatingType, setIsUpdatingType] = useState(false);
  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
  const [isPriorityMenuOpen, setIsPriorityMenuOpen] = useState(false);
  const [isTypeMenuOpen, setIsTypeMenuOpen] = useState(false);
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [isSavingSummary, setIsSavingSummary] = useState(false);
  const [summarySaved, setSummarySaved] = useState(false);
  const summarySaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [newComment, setNewComment] = useState("");
  const [isAddingComment, setIsAddingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentDraft, setEditingCommentDraft] = useState("");
  const [isUpdatingComment, setIsUpdatingComment] = useState(false);
  const [commentToDelete, setCommentToDelete] = useState<{ id: string; author: string } | null>(
    null,
  );
  const [isDeletingComment, setIsDeletingComment] = useState(false);
  const [contentPreview, setContentPreview] = useState<{
    src: string;
    filename: string;
    type: "image" | "pdf";
  } | null>(null);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);
  const priorityMenuRef = useRef<HTMLDivElement | null>(null);
  const typeMenuRef = useRef<HTMLDivElement | null>(null);
  const newCommentTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const activeLinkedWorktreeId =
    linkedWorktreeId && activeWorktreeIds.has(linkedWorktreeId) ? linkedWorktreeId : null;
  const activeLinkedWorktreePrUrl = activeLinkedWorktreeId ? linkedWorktreePrUrl : null;

  const handleImageClick = (src: string, alt: string) => {
    const isPdf = src.includes("application%2Fpdf") || alt.toLowerCase().endsWith(".pdf");
    setContentPreview({ src, filename: alt, type: isPdf ? "pdf" : "image" });
  };

  useEffect(() => {
    if (!isEditingSummary) {
      setSummaryDraft(issue?.summary ?? "");
    }
  }, [isEditingSummary, issue?.summary]);

  useEffect(() => {
    return () => {
      if (summarySaveTimerRef.current) clearTimeout(summarySaveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isStatusMenuOpen && !isPriorityMenuOpen && !isTypeMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedStatusMenu = statusMenuRef.current?.contains(target);
      const clickedPriorityMenu = priorityMenuRef.current?.contains(target);
      const clickedTypeMenu = typeMenuRef.current?.contains(target);
      if (!clickedStatusMenu) {
        setIsStatusMenuOpen(false);
      }
      if (!clickedPriorityMenu) {
        setIsPriorityMenuOpen(false);
      }
      if (!clickedTypeMenu) {
        setIsTypeMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [isPriorityMenuOpen, isStatusMenuOpen, isTypeMenuOpen]);

  useEffect(() => {
    let active = true;
    void api.fetchJiraIssueStatusOptions(issueKey).then((result) => {
      if (!active) return;
      setStatusOptions(result.options ?? []);
    });
    return () => {
      active = false;
    };
  }, [api, issue?.status, issueKey]);

  useEffect(() => {
    let active = true;
    void api.fetchJiraPriorityOptions().then((result) => {
      if (!active) return;
      setPriorityOptions(result.options ?? []);
    });
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    let active = true;
    void api.fetchJiraIssueTypeOptions(issueKey).then((result) => {
      if (!active) return;
      setTypeOptions(result.options ?? []);
    });
    return () => {
      active = false;
    };
  }, [api, issue?.type, issueKey]);

  useEffect(() => {
    if (error) {
      reportPersistentErrorToast(error, "Failed to load Jira issue", {
        scope: "jira:detail-load",
      });
    }
  }, [error]);

  const handleCreate = async () => {
    setIsCreating(true);
    const result = await api.createFromJira(issueKey);
    setIsCreating(false);
    const createdWorktreeId = resolveCreatedWorktreeId(result);
    if (result.success && createdWorktreeId) {
      onCreateWorktree(createdWorktreeId);
    } else if (result.success) {
      reportPersistentErrorToast(
        "Worktree was created, but the response did not include a worktree id.",
        "Failed to create worktree",
        {
          scope: "jira:create-worktree",
        },
      );
    } else if (
      (result.code === "WORKTREE_EXISTS" || requiresWorktreeRecoveryPrompt(result)) &&
      result.worktreeId
    ) {
      setPendingCodeWithAgent(null);
      setExistingWorktree({ id: result.worktreeId, branch: issueKey });
    } else {
      const errorMsg = result.error || "Failed to create worktree";
      // Check if error indicates repository setup is needed
      if (errorMsg.includes("no commits") || errorMsg.includes("invalid reference")) {
        if (onSetupNeeded) {
          onSetupNeeded();
        } else {
          reportPersistentErrorToast(errorMsg, "Failed to create worktree", {
            scope: "jira:create-worktree",
          });
        }
      } else {
        reportPersistentErrorToast(errorMsg, "Failed to create worktree", {
          scope: "jira:create-worktree",
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
    const result = await api.createFromJira(issueKey);
    setIsCodingWithAgent(false);
    const launchPrompt = `Implement Jira issue ${issueKey}${issue?.summary ? ` (${issue.summary})` : ""}. You are already in the correct worktree. Run \`openkit task context\` to get full task details, then execute the normal OpenKit flow: run pre-implementation hooks before coding, run required custom hooks when conditions match, and run post-implementation hooks before finishing. Treat AI context and todo checklist as highest-priority instructions. If you need user approval or instructions, run openkit activity await-input before asking.`;
    if (requiresWorktreeRecoveryPrompt(result)) {
      setPendingCodeWithAgent({ agent, prompt: launchPrompt, tabLabel: issueKey });
      setExistingWorktree({ id: result.worktreeId as string, branch: issueKey });
      return;
    }
    const reusingExistingWorktree =
      (result.success && result.reusedExisting === true) ||
      (!result.success && result.code === "WORKTREE_EXISTS" && !!result.worktreeId);
    if (result.success || reusingExistingWorktree) {
      const worktreeId = result.worktreeId ?? issueKey;
      launchCodingAgent(agent, {
        worktreeId,
        mode: reusingExistingWorktree ? "resume" : "start",
        tabLabel: issueKey,
        prompt: reusingExistingWorktree ? undefined : launchPrompt,
      });
    } else {
      const errorMsg = result.error || "Failed to create worktree";
      if (errorMsg.includes("no commits") || errorMsg.includes("invalid reference")) {
        if (onSetupNeeded) {
          onSetupNeeded();
        } else {
          reportPersistentErrorToast(errorMsg, "Failed to create worktree", {
            scope: "jira:code-worktree",
          });
        }
      } else {
        reportPersistentErrorToast(errorMsg, "Failed to create worktree", {
          scope: "jira:code-worktree",
        });
      }
    }
  };

  const handleUpdateStatus = async (statusName: string) => {
    if (!statusName) return;
    const currentIssueKey = issue?.key;
    if (!currentIssueKey) return;
    if (statusName === issue?.status) return;
    setIsUpdatingStatus(true);
    const result = await api.updateJiraIssueStatus(currentIssueKey, statusName);
    setIsUpdatingStatus(false);
    if (!result.success) return;
    await refetch();
  };

  const handleUpdatePriority = async (priorityName: string) => {
    if (!priorityName) return;
    const currentIssueKey = issue?.key;
    if (!currentIssueKey) return;
    if (priorityName === issue?.priority) return;
    setIsUpdatingPriority(true);
    const result = await api.updateJiraIssuePriority(currentIssueKey, priorityName);
    setIsUpdatingPriority(false);
    if (!result.success) return;
    await refetch();
  };

  const handleUpdateType = async (typeName: string) => {
    if (!typeName) return;
    const currentIssueKey = issue?.key;
    if (!currentIssueKey) return;
    if (typeName === issue?.type) return;
    setIsUpdatingType(true);
    const result = await api.updateJiraIssueType(currentIssueKey, typeName);
    setIsUpdatingType(false);
    if (!result.success) return;
    await refetch();
  };

  const persistSummary = async (rawSummary: string, closeEditor = false) => {
    const currentIssueKey = issue?.key;
    const nextSummary = rawSummary.trim();
    if (!currentIssueKey || !nextSummary) {
      if (closeEditor) {
        setSummaryDraft(issue?.summary ?? "");
        setIsEditingSummary(false);
        setSummarySaved(false);
      }
      return;
    }
    if (nextSummary === issue?.summary) {
      if (closeEditor) {
        setIsEditingSummary(false);
        setSummarySaved(false);
      }
      return;
    }
    setIsSavingSummary(true);
    const result = await api.updateJiraIssueSummary(currentIssueKey, nextSummary);
    setIsSavingSummary(false);
    if (!result.success) {
      if (closeEditor) {
        setIsEditingSummary(false);
        setSummarySaved(false);
      }
      return;
    }
    setSummarySaved(true);
    await refetch();
    if (closeEditor) {
      setIsEditingSummary(false);
      setSummarySaved(false);
    }
  };

  const handleAddComment = async () => {
    const comment = newComment.trim();
    if (!comment) return;
    const currentIssueKey = issue?.key;
    if (!currentIssueKey) return;
    setIsAddingComment(true);
    const result = await api.addJiraIssueComment(currentIssueKey, comment);
    setIsAddingComment(false);
    if (!result.success) return;
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
    const currentIssueKey = issue?.key;
    const commentId = editingCommentId;
    const comment = editingCommentDraft.trim();
    if (!currentIssueKey || !commentId || !comment) return;
    setIsUpdatingComment(true);
    const result = await api.updateJiraIssueComment(currentIssueKey, commentId, comment);
    setIsUpdatingComment(false);
    if (!result.success) return;
    setEditingCommentId(null);
    setEditingCommentDraft("");
    await refetch();
  };

  const handleDeleteComment = async () => {
    const currentIssueKey = issue?.key;
    const commentId = commentToDelete?.id;
    if (!currentIssueKey || !commentId) return;
    setIsDeletingComment(true);
    const result = await api.deleteJiraIssueComment(currentIssueKey, commentId);
    setIsDeletingComment(false);
    if (!result.success) return;
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

  const statusLower = issue.status.toLowerCase();
  const statusClasses = jiraStatus[statusLower] ?? `${text.secondary} bg-white/[0.06]`;
  const typeLower = issue.type.toLowerCase();
  const typeClasses = jiraType[typeLower] ?? `${text.secondary} bg-white/[0.06]`;
  const priorityLower = issue.priority.toLowerCase();
  const priorityClass = jiraPriority[priorityLower] ?? text.secondary;
  const headerChipClass =
    "inline-flex h-5 min-h-5 shrink-0 items-center justify-center whitespace-nowrap rounded px-2 text-[11px] font-medium leading-5 align-middle box-border";

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header — compact key + title + action */}
      <div className={`flex-shrink-0 px-5 py-4 border-b ${border.section}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {/* Issue key + status + refresh on one line */}
            <div className="flex items-center gap-2 mb-2">
              <Tooltip position="right" text="Open in Jira">
                <a
                  href={issue.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`text-xs font-semibold ${badge.jira} ${badge.jiraHover} transition-colors`}
                >
                  {issue.key}
                </a>
              </Tooltip>
              {statusOptions.length > 0 ? (
                <div ref={statusMenuRef} className="relative ml-2 flex h-5 items-center">
                  <button
                    type="button"
                    onClick={() => setIsStatusMenuOpen((prev) => !prev)}
                    disabled={isUpdatingStatus}
                    className={`${headerChipClass} ${statusClasses} disabled:opacity-70`}
                  >
                    {issue.status}
                  </button>
                  {isStatusMenuOpen && (
                    <div className="absolute left-0 top-full mt-1 z-10 min-w-[140px] rounded-md border border-white/[0.08] bg-[#101318] shadow-lg overflow-hidden">
                      {statusOptions.map((option) => (
                        <button
                          key={option.id}
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
                <span className={`ml-2 ${headerChipClass} ${statusClasses}`}>{issue.status}</span>
              )}
              <span className={`text-[5px] ${text.dimmed}`}>●</span>
              {typeOptions.length > 0 ? (
                <div ref={typeMenuRef} className="relative flex h-5 items-center">
                  <button
                    type="button"
                    onClick={() => setIsTypeMenuOpen((prev) => !prev)}
                    disabled={isUpdatingType}
                    className={`${headerChipClass} ${typeClasses} disabled:opacity-70`}
                  >
                    {issue.type}
                  </button>
                  {isTypeMenuOpen && (
                    <div className="absolute left-0 top-full mt-1 z-10 min-w-[120px] rounded-md border border-white/[0.08] bg-[#101318] shadow-lg overflow-hidden">
                      {typeOptions.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => {
                            setIsTypeMenuOpen(false);
                            void handleUpdateType(option.name);
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
                <span className={`${headerChipClass} ${typeClasses}`}>{issue.type}</span>
              )}
              {issue.labels.map((label) => (
                <span
                  key={label}
                  className={`text-[11px] font-medium px-2 py-0.5 rounded bg-white/[0.06] ${text.secondary}`}
                >
                  {label}
                </span>
              ))}
              <span className={`text-[5px] ${text.dimmed}`}>●</span>
              {priorityOptions.length > 0 ? (
                <div ref={priorityMenuRef} className="relative flex h-5 items-center">
                  <button
                    type="button"
                    onClick={() => setIsPriorityMenuOpen((prev) => !prev)}
                    disabled={isUpdatingPriority}
                    className={`${headerChipClass} ${priorityClass} disabled:opacity-70`}
                  >
                    {issue.priority}
                  </button>
                  {isPriorityMenuOpen && (
                    <div className="absolute left-0 top-full mt-1 z-10 min-w-[120px] rounded-md border border-white/[0.08] bg-[#101318] shadow-lg overflow-hidden">
                      {priorityOptions.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => {
                            setIsPriorityMenuOpen(false);
                            void handleUpdatePriority(option.name);
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
                <span className={`${headerChipClass} ${priorityClass}`}>{issue.priority}</span>
              )}
            </div>
            {/* Summary — largest text, clear anchor */}
            {isEditingSummary ? (
              <input
                type="text"
                value={summaryDraft}
                onChange={(event) => {
                  const nextSummary = event.target.value;
                  setSummaryDraft(nextSummary);
                  if (summarySaved) setSummarySaved(false);
                  if (summarySaveTimerRef.current) clearTimeout(summarySaveTimerRef.current);
                  summarySaveTimerRef.current = setTimeout(() => {
                    void persistSummary(nextSummary, false);
                  }, 3000);
                }}
                onBlur={() => {
                  if (summarySaveTimerRef.current) clearTimeout(summarySaveTimerRef.current);
                  void persistSummary(summaryDraft, true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (summarySaveTimerRef.current) clearTimeout(summarySaveTimerRef.current);
                    void persistSummary(summaryDraft, true);
                  }
                  if (event.key === "Escape") {
                    if (summarySaveTimerRef.current) clearTimeout(summarySaveTimerRef.current);
                    setSummaryDraft(issue.summary);
                    setSummarySaved(false);
                    setIsEditingSummary(false);
                  }
                }}
                className={`w-full text-[15px] font-semibold ${text.primary} leading-snug bg-transparent border border-white/[0.12] rounded-md px-2 py-1 focus:outline-none focus:border-white/[0.3]`}
                autoFocus
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setSummaryDraft(issue.summary);
                  setIsEditingSummary(true);
                }}
                className={`text-left text-[15px] font-semibold ${text.primary} leading-snug hover:bg-white/[0.03] rounded px-1 -mx-1 transition-colors`}
              >
                {issue.summary}
              </button>
            )}
          </div>
          <div className="flex-shrink-0 pt-1 flex items-center gap-2">
            {(isSavingSummary || summarySaved) && (
              <div className="min-w-[46px] flex justify-end">
                {isSavingSummary ? (
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
              <JiraIcon className="w-3.5 h-3.5 text-[#6b7280] transition-colors group-hover:text-blue-400 [&>svg]:text-inherit" />
              Open in Jira
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

      {/* Scrollable body — each section gets its own visual container */}
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
              const result = await api.updateJiraIssueDescription(issue.key, nextValue);
              if (!result.success) return false;
              await refetch();
              return true;
            }}
            renderPreview={(value) =>
              value ? (
                <MarkdownContent
                  content={value}
                  baseUrl={serverUrl ?? undefined}
                  onImageClick={handleImageClick}
                />
              ) : (
                <p className={`text-xs ${text.dimmed}`}>No description.</p>
              )
            }
          />
        </section>

        {issue.attachments.length > 0 && (
          <section>
            <SectionLabel>Attachments ({issue.attachments.length})</SectionLabel>
            <AttachmentsSection attachments={issue.attachments} />
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
                    {formatDate(comment.created)}
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
                  <MarkdownContent
                    content={comment.body}
                    baseUrl={serverUrl ?? undefined}
                    onImageClick={handleImageClick}
                  />
                )}
              </div>
            ))}
          </div>
        </section>

        <PersonalNotesSection source="jira" issueId={issue.key} />
        <AgentSection source="jira" issueId={issue.key} />

        {/* Footer */}
        <div className={`text-[10px] ${text.dimmed} flex flex-wrap gap-4 pt-2`}>
          {issue.reporter && <span>Reported by {issue.reporter}</span>}
          <span>Created {formatDate(issue.created)}</span>
          <span>Updated {formatDate(issue.updated)}</span>
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

      {contentPreview && (
        <ImageModal
          src={contentPreview.src}
          filename={contentPreview.filename}
          type={contentPreview.type}
          onClose={() => setContentPreview(null)}
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
