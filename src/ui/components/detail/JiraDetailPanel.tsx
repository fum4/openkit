import { useState } from "react";
import { GitBranch } from "lucide-react";

import { useJiraIssueDetail } from "../../hooks/useJiraIssueDetail";
import { useApi } from "../../hooks/useApi";
import { useServerUrlOptional } from "../../contexts/ServerContext";
import type { JiraIssueDetail } from "../../types";
import { badge, border, button, jiraPriority, jiraStatus, jiraType, text } from "../../theme";
import { Tooltip } from "../Tooltip";
import { TruncatedTooltip } from "../TruncatedTooltip";
import { AttachmentImage } from "../AttachmentImage";
import { MarkdownContent } from "../MarkdownContent";
import { ClaudeIcon, GitHubIcon, JiraIcon } from "../../icons";
import { PersonalNotesSection, AgentSection } from "./NotesSection";
import { Spinner } from "../Spinner";
import { WorktreeExistsModal } from "../WorktreeExistsModal";
import { ImageModal } from "../ImageModal";

interface JiraDetailPanelProps {
  issueKey: string;
  linkedWorktreeId: string | null;
  linkedWorktreePrUrl?: string | null;
  onCreateWorktree: (key: string) => void;
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
  onCreateWorktree,
  onViewWorktree,
  onCodeWithClaude,
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
  const [isCodingWithClaude, setIsCodingWithClaude] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [existingWorktree, setExistingWorktree] = useState<{ id: string; branch: string } | null>(
    null,
  );
  const [contentPreview, setContentPreview] = useState<{
    src: string;
    filename: string;
    type: "image" | "pdf";
  } | null>(null);

  const handleImageClick = (src: string, alt: string) => {
    const isPdf = src.includes("application%2Fpdf") || alt.toLowerCase().endsWith(".pdf");
    setContentPreview({ src, filename: alt, type: isPdf ? "pdf" : "image" });
  };

  const handleCreate = async () => {
    setIsCreating(true);
    setCreateError(null);
    const result = await api.createFromJira(issueKey);
    console.log("createFromJira result:", result);
    setIsCreating(false);
    if (result.success) {
      onCreateWorktree(issueKey);
    } else if (result.code === "WORKTREE_EXISTS" && result.worktreeId) {
      console.log("Showing WorktreeExistsModal for:", result.worktreeId);
      setExistingWorktree({ id: result.worktreeId, branch: issueKey });
    } else {
      const errorMsg = result.error || "Failed to create worktree";
      // Check if error indicates repository setup is needed
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
    const result = await api.createFromJira(issueKey);
    setIsCodingWithClaude(false);
    if (result.success) {
      const worktreeId = result.worktreeId ?? issueKey;
      onCodeWithClaude({
        worktreeId,
        mode: "start",
        tabLabel: issueKey,
        prompt: `Implement Jira issue ${issueKey}${issue?.summary ? ` (${issue.summary})` : ""}. You are already in the correct worktree. Read TASK.md first, then execute the normal OpenKit flow: run pre-implementation hooks before coding, run required custom hooks when conditions match, and run post-implementation hooks before finishing. Treat AI context and todo checklist as highest-priority instructions. If you need user approval/instructions, notify OpenKit before asking by calling notify with requiresUserAction=true (or run openkit activity await-input in terminal flow).`,
      });
    } else if (result.code === "WORKTREE_EXISTS" && result.worktreeId) {
      setExistingWorktree({ id: result.worktreeId, branch: issueKey });
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

  const statusLower = issue.status.toLowerCase();
  const statusClasses = jiraStatus[statusLower] ?? `${text.secondary} bg-white/[0.06]`;
  const typeLower = issue.type.toLowerCase();
  const typeClasses = jiraType[typeLower] ?? `${text.secondary} bg-white/[0.06]`;
  const priorityLower = issue.priority.toLowerCase();
  const priorityClass = jiraPriority[priorityLower] ?? text.secondary;

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
              <span className={`ml-2 text-[11px] font-medium px-2 py-0.5 rounded ${statusClasses}`}>
                {issue.status}
              </span>
              <span className={`text-[5px] ${text.dimmed}`}>●</span>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${typeClasses}`}>
                {issue.type}
              </span>
              {issue.labels.map((label) => (
                <span
                  key={label}
                  className={`text-[11px] font-medium px-2 py-0.5 rounded bg-white/[0.06] ${text.secondary}`}
                >
                  {label}
                </span>
              ))}
              <span className={`text-[5px] ${text.dimmed}`}>●</span>
              <span className={`text-[11px] ${priorityClass}`}>{issue.priority}</span>
            </div>
            {/* Summary — largest text, clear anchor */}
            <h2 className={`text-[15px] font-semibold ${text.primary} leading-snug`}>
              {issue.summary}
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
              <JiraIcon className="w-3.5 h-3.5 text-[#6b7280] transition-colors group-hover:text-blue-400" />
              Open in Jira
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

      {/* Scrollable body — each section gets its own visual container */}
      <div className="flex-1 overflow-y-auto p-5 space-y-12">
        {issue.description && (
          <section>
            <SectionLabel>Description</SectionLabel>
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] px-4 py-3">
              <MarkdownContent
                content={issue.description}
                baseUrl={serverUrl ?? undefined}
                onImageClick={handleImageClick}
              />
            </div>
          </section>
        )}

        {issue.attachments.length > 0 && (
          <section>
            <SectionLabel>Attachments ({issue.attachments.length})</SectionLabel>
            <AttachmentsSection attachments={issue.attachments} />
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
                      {formatDate(comment.created)}
                    </span>
                  </div>
                  <MarkdownContent
                    content={comment.body}
                    baseUrl={serverUrl ?? undefined}
                    onImageClick={handleImageClick}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

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
          onResolved={() => {
            setExistingWorktree(null);
            onCreateWorktree(issueKey);
          }}
          onCancel={() => setExistingWorktree(null)}
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
    </div>
  );
}
