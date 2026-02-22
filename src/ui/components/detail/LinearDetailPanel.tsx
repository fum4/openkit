import { useState } from "react";
import { GitBranch } from "lucide-react";

import { useLinearIssueDetail } from "../../hooks/useLinearIssueDetail";
import { useApi } from "../../hooks/useApi";
import { getLinearAttachmentUrl } from "../../hooks/api";
import { useServerUrlOptional } from "../../contexts/ServerContext";
import { badge, border, button, linearPriority, linearStateType, text } from "../../theme";
import { Tooltip } from "../Tooltip";
import { TruncatedTooltip } from "../TruncatedTooltip";
import { MarkdownContent } from "../MarkdownContent";
import { AttachmentImage } from "../AttachmentImage";
import { ClaudeIcon, GitHubIcon, LinearIcon } from "../../icons";
import { PersonalNotesSection, AgentSection } from "./NotesSection";
import { Spinner } from "../Spinner";
import { WorktreeExistsModal } from "../WorktreeExistsModal";

interface LinearDetailPanelProps {
  identifier: string;
  linkedWorktreeId: string | null;
  linkedWorktreePrUrl?: string | null;
  onCreateWorktree: (identifier: string) => void;
  onViewWorktree: (id: string) => void;
  onCodeWithClaude: (intent: {
    worktreeId: string;
    mode: "resume" | "start";
    prompt?: string;
    tabLabel?: string;
  }) => void;
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
  onCreateWorktree,
  onViewWorktree,
  onCodeWithClaude,
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
  const [isCodingWithClaude, setIsCodingWithClaude] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [existingWorktree, setExistingWorktree] = useState<{ id: string; branch: string } | null>(
    null,
  );

  const handleCreate = async () => {
    setIsCreating(true);
    setCreateError(null);
    const result = await api.createFromLinear(identifier);
    setIsCreating(false);
    if (result.success) {
      onCreateWorktree(identifier);
    } else if (result.code === "WORKTREE_EXISTS" && result.worktreeId) {
      setExistingWorktree({ id: result.worktreeId, branch: identifier });
    } else {
      const errorMsg = result.error || "Failed to create worktree";
      if (errorMsg.includes("no commits") || errorMsg.includes("invalid reference")) {
        if (onSetupNeeded) {
          onSetupNeeded();
        } else {
          setCreateError(errorMsg);
        }
      } else {
        setCreateError(errorMsg);
      }
    }
  };

  const handleCodeWithClaude = async () => {
    if (linkedWorktreeId) {
      onCodeWithClaude({ worktreeId: linkedWorktreeId, mode: "resume" });
      return;
    }

    setIsCodingWithClaude(true);
    setCreateError(null);
    const result = await api.createFromLinear(identifier);
    setIsCodingWithClaude(false);
    if (result.success) {
      const worktreeId = result.worktreeId ?? identifier;
      onCodeWithClaude({
        worktreeId,
        mode: "start",
        tabLabel: identifier,
        prompt: `Implement Linear issue ${identifier}${issue?.title ? ` (${issue.title})` : ""}. You are already in the correct worktree. Read TASK.md first, then execute the normal OpenKit flow: run pre-implementation hooks before coding, run required custom hooks when conditions match, and run post-implementation hooks before finishing. Treat AI context and todo checklist as highest-priority instructions. If you need user approval/instructions, notify OpenKit before asking by calling notify with requiresUserAction=true (or run openkit activity await-input in terminal flow).`,
      });
    } else if (result.code === "WORKTREE_EXISTS" && result.worktreeId) {
      setExistingWorktree({ id: result.worktreeId, branch: identifier });
    } else {
      const errorMsg = result.error || "Failed to create worktree";
      if (errorMsg.includes("no commits") || errorMsg.includes("invalid reference")) {
        if (onSetupNeeded) {
          onSetupNeeded();
        } else {
          setCreateError(errorMsg);
        }
      } else {
        setCreateError(errorMsg);
      }
    }
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
        <p className={`${text.error} text-sm`}>{error}</p>
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

  const priorityInfo = linearPriority[issue.priority] ?? linearPriority[0];
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
              <span
                className={`ml-2 text-[11px] font-medium px-2 py-0.5 rounded ${linearStateType[issue.state.type.toLowerCase()] ?? ""}`}
                style={
                  !linearStateType[issue.state.type.toLowerCase()]
                    ? { backgroundColor: `${issue.state.color}20`, color: issue.state.color }
                    : undefined
                }
              >
                {issue.state.name}
              </span>
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
              <span className={`text-[11px] ${priorityInfo.color}`}>{priorityInfo.label}</span>
            </div>
            <h2 className={`text-[15px] font-semibold ${text.primary} leading-snug`}>
              {issue.title}
            </h2>
          </div>
          <div className="flex-shrink-0 pt-1 flex items-center gap-2">
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
              <LinearIcon className="w-3.5 h-3.5 text-[#6b7280] transition-colors group-hover:text-[#5E6AD2]" />
              Open in Linear
            </a>
            {linkedWorktreeId ? (
              <>
                <button
                  type="button"
                  onClick={() => onViewWorktree(linkedWorktreeId)}
                  className={`group inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${button.secondary} rounded-lg transition-colors duration-150`}
                >
                  <GitBranch className="w-3.5 h-3.5 text-[#6b7280] transition-colors group-hover:text-accent" />
                  View Worktree
                </button>
                {linkedWorktreePrUrl && (
                  <a
                    href={linkedWorktreePrUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`group inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${button.secondary} rounded-lg transition-colors duration-150`}
                  >
                    <GitHubIcon className="w-3.5 h-3.5 text-[#6b7280] transition-colors group-hover:text-white" />
                    View PR
                  </a>
                )}
                <button
                  type="button"
                  onClick={handleCodeWithClaude}
                  disabled={isCodingWithClaude}
                  className={`group inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${button.secondary} rounded-lg transition-colors duration-150 disabled:opacity-50`}
                >
                  <ClaudeIcon
                    className={`w-3.5 h-3.5 transition-colors ${isCodingWithClaude ? "text-[#D97757]" : "text-[#6b7280] group-hover:text-[#D97757]"}`}
                  />
                  {isCodingWithClaude ? "Opening..." : "Code with Claude"}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={isCreating || isCodingWithClaude}
                  className={`group inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${button.secondary} rounded-lg transition-colors duration-150 active:scale-[0.98]`}
                >
                  <GitBranch className="w-3.5 h-3.5 text-[#6b7280] transition-colors group-hover:text-accent" />
                  {isCreating ? "Creating..." : "Create Worktree"}
                </button>
                <button
                  type="button"
                  onClick={handleCodeWithClaude}
                  disabled={isCreating || isCodingWithClaude}
                  className={`group inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${button.secondary} rounded-lg transition-colors duration-150 active:scale-[0.98] disabled:opacity-50`}
                >
                  <ClaudeIcon
                    className={`w-3.5 h-3.5 transition-colors ${isCodingWithClaude ? "text-[#D97757]" : "text-[#6b7280] group-hover:text-[#D97757]"}`}
                  />
                  {isCodingWithClaude ? "Preparing..." : "Code with Claude"}
                </button>
              </>
            )}
          </div>
        </div>
        {createError && <p className={`${text.error} text-[10px] mt-2`}>{createError}</p>}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-12">
        {issue.description && (
          <section>
            <SectionLabel>Description</SectionLabel>
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] px-4 py-3">
              <MarkdownContent content={issue.description} />
            </div>
          </section>
        )}

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

        {issue.comments.length > 0 && (
          <section>
            <SectionLabel>Comments ({issue.comments.length})</SectionLabel>
            <div className="space-y-3">
              {issue.comments.map((comment, i) => (
                <div
                  key={i}
                  className="rounded-lg bg-white/[0.02] border border-white/[0.04] px-4 py-3"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-[11px] font-medium ${text.primary}`}>
                      {comment.author}
                    </span>
                    <span className={`text-[10px] ${text.dimmed}`}>
                      {formatDate(comment.createdAt)}
                    </span>
                  </div>
                  <MarkdownContent content={comment.body} />
                </div>
              ))}
            </div>
          </section>
        )}

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
          onResolved={() => {
            setExistingWorktree(null);
            onCreateWorktree(identifier);
          }}
          onCancel={() => setExistingWorktree(null)}
        />
      )}
    </div>
  );
}
