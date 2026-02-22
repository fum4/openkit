import { useCallback, useRef, useState } from "react";
import { GitBranch, Paperclip, Trash2, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { useCustomTaskDetail } from "../../hooks/useCustomTaskDetail";
import { useApi } from "../../hooks/useApi";
import { border, button, customTask, getLabelColor, text } from "../../theme";
import { MarkdownContent } from "../MarkdownContent";
import { PersonalNotesSection, AgentSection } from "./NotesSection";
import { Spinner } from "../Spinner";
import { ImageModal } from "../ImageModal";
import { AttachmentThumbnail } from "../AttachmentThumbnail";
import { ClaudeIcon } from "../../icons";
import type { CustomTaskAttachment } from "../../types";

interface CustomTaskDetailPanelProps {
  taskId: string;
  onDeleted: () => void;
  onCreateWorktree: () => void;
  onViewWorktree: (id: string) => void;
  onCodeWithClaude: (intent: {
    worktreeId: string;
    mode: "resume" | "start";
    prompt?: string;
    tabLabel?: string;
  }) => void;
}

function formatDate(iso: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const statusOptions = [
  { value: "todo", label: "Todo" },
  { value: "in-progress", label: "In Progress" },
  { value: "done", label: "Done" },
] as const;

const priorityOptions = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
] as const;

export function CustomTaskDetailPanel({
  taskId,
  onDeleted,
  onCreateWorktree,
  onViewWorktree,
  onCodeWithClaude,
}: CustomTaskDetailPanelProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { task, isLoading, error, refetch } = useCustomTaskDetail(taskId);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [labelInputFocused, setLabelInputFocused] = useState(false);
  const [isCreatingWorktree, setIsCreatingWorktree] = useState(false);
  const [isCodingWithClaude, setIsCodingWithClaude] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [previewImage, setPreviewImage] = useState<{
    src: string;
    filename: string;
    type: "image" | "pdf";
  } | null>(null);

  const update = async (updates: Record<string, unknown>) => {
    await api.updateCustomTask(taskId, updates);
    refetch();
    queryClient.invalidateQueries({ queryKey: ["customTasks"] });
  };

  const handleDelete = async () => {
    await api.deleteCustomTask(taskId);
    queryClient.invalidateQueries({ queryKey: ["customTasks"] });
    onDeleted();
  };

  const handleCreateWorktree = async () => {
    setIsCreatingWorktree(true);
    setCreateError(null);
    const result = await api.createWorktreeFromCustomTask(taskId);
    setIsCreatingWorktree(false);
    if (result.success) {
      refetch();
      queryClient.invalidateQueries({ queryKey: ["customTasks"] });
      onCreateWorktree();
    } else {
      setCreateError(result.error ?? "Failed to create worktree");
    }
  };

  const handleCodeWithClaude = async () => {
    if (task?.linkedWorktreeId) {
      onCodeWithClaude({ worktreeId: task.linkedWorktreeId, mode: "resume" });
      return;
    }

    setIsCodingWithClaude(true);
    setCreateError(null);
    const result = await api.createWorktreeFromCustomTask(taskId);
    setIsCodingWithClaude(false);
    if (result.success) {
      refetch();
      queryClient.invalidateQueries({ queryKey: ["customTasks"] });
      onCodeWithClaude({
        worktreeId: result.worktreeId ?? taskId,
        mode: "start",
        prompt: `Implement local task ${taskId}${task?.title ? ` (${task.title})` : ""}. You are already in the correct worktree. Read TASK.md first, then execute the normal OpenKit flow: run pre-implementation hooks before coding, run required custom hooks when conditions match, and run post-implementation hooks before finishing. Treat AI context and todo checklist as highest-priority instructions. If you need user approval/instructions, notify OpenKit before asking by calling notify with requiresUserAction=true (or run openkit activity await-input in terminal flow).`,
      });
    } else {
      setCreateError(result.error ?? "Failed to create worktree");
    }
  };

  const startEditTitle = () => {
    if (!task) return;
    setTitleDraft(task.title);
    setEditingTitle(true);
  };

  const saveTitle = async () => {
    if (titleDraft.trim() && titleDraft.trim() !== task?.title) {
      await update({ title: titleDraft.trim() });
    }
    setEditingTitle(false);
  };

  const descriptionRef = useRef<HTMLDivElement>(null);
  const [descriptionMinHeight, setDescriptionMinHeight] = useState(60);

  const startEditDescription = () => {
    if (!task) return;
    if (descriptionRef.current) {
      setDescriptionMinHeight(descriptionRef.current.offsetHeight);
    }
    setDescriptionDraft(task.description);
    setEditingDescription(true);
  };

  const saveDescription = async () => {
    if (descriptionDraft !== task?.description) {
      await update({ description: descriptionDraft });
    }
    setEditingDescription(false);
  };

  const autoResize = useCallback(
    (el: HTMLTextAreaElement | null) => {
      if (!el) return;
      el.style.height = "auto";
      el.style.height = Math.max(el.scrollHeight, descriptionMinHeight) + "px";
      el.focus();
    },
    [descriptionMinHeight],
  );

  const handleUploadFiles = async (files: FileList | File[]) => {
    setIsUploading(true);
    for (const file of Array.from(files)) {
      await api.uploadTaskAttachment(taskId, file);
    }
    setIsUploading(false);
    refetch();
  };

  const handleDeleteAttachment = async (filename: string) => {
    await api.deleteTaskAttachment(taskId, filename);
    refetch();
  };

  const addLabel = async (value?: string) => {
    const raw = value ?? labelInput;
    if (!task || !raw.trim()) return;
    const trimmed = raw.trim();
    setLabelInput("");
    if (!task.labels.includes(trimmed)) {
      await update({ labels: [...task.labels, trimmed] });
    }
  };

  const removeLabel = async (label: string) => {
    if (!task) return;
    await update({ labels: task.labels.filter((l: string) => l !== label) });
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2">
        <Spinner size="sm" className={text.muted} />
        <p className={`${text.muted} text-sm`}>Loading task...</p>
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

  if (!task) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className={`${text.muted} text-sm`}>Select a task to view details</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className={`flex-shrink-0 px-5 py-4 border-b ${border.section}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className={`text-xs font-semibold text-amber-500`}>{task.id}</span>
              {task.labels.length > 0 && <span className={`text-[5px] ${text.dimmed}`}>●</span>}
              {task.labels.map((label: string) => {
                const colorSet = getLabelColor(label);
                return (
                  <span
                    key={label}
                    className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded ${colorSet.text} ${colorSet.bg}`}
                  >
                    {label}
                    <button
                      type="button"
                      onClick={() => removeLabel(label)}
                      className="p-0.5 -mr-1 rounded hover:bg-white/[0.10] transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                );
              })}
              {(() => {
                const matchColor =
                  labelInput.trim() && task.labels.includes(labelInput.trim())
                    ? getLabelColor(labelInput.trim())
                    : labelInput.trim()
                      ? getLabelColor(labelInput.trim())
                      : null;
                return (
                  <input
                    type="text"
                    value={labelInput}
                    onChange={(e) => setLabelInput(e.target.value)}
                    onFocus={() => setLabelInputFocused(true)}
                    onBlur={() => {
                      const value = labelInput.trim();
                      setLabelInputFocused(false);
                      setLabelInput("");
                      if (value) addLabel(value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        (e.target as HTMLInputElement).blur();
                      }
                      if (e.key === "Escape") {
                        setLabelInput("");
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    placeholder={labelInputFocused ? "" : "+"}
                    className={`${labelInputFocused ? "w-20 h-auto py-0.5 text-left cursor-text px-2 bg-white/[0.08]" : "w-5 h-5 text-center bg-transparent hover:bg-white/[0.08]"} text-sm leading-[18px] rounded cursor-pointer ${matchColor ? matchColor.text : text.muted} border-none placeholder-[#6b7280] focus:outline-none transition-all`}
                  />
                );
              })()}
            </div>
            {editingTitle ? (
              <input
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveTitle();
                  if (e.key === "Escape") setEditingTitle(false);
                }}
                style={{ width: `${Math.max(titleDraft.length + 1, 10)}ch` }}
                className={`max-w-full text-[15px] font-semibold ${text.primary} bg-white/[0.04] border border-amber-400/30 rounded-md px-2 py-1 focus:outline-none`}
                autoFocus
              />
            ) : (
              <h2
                className={`text-[15px] font-semibold ${text.primary} leading-snug cursor-pointer hover:bg-white/[0.04] rounded-md px-2 py-1 -mx-2 -my-1 transition-colors`}
                onClick={startEditTitle}
              >
                {task.title}
              </h2>
            )}
          </div>
          <div className="flex-shrink-0 pt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className={`p-1.5 rounded-lg ${text.muted} hover:text-red-400 hover:bg-red-900/20 transition-colors`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
            {task.linkedWorktreeId ? (
              <>
                <button
                  type="button"
                  onClick={() => onViewWorktree(task.linkedWorktreeId!)}
                  className={`group inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${button.secondary} rounded-lg transition-colors duration-150`}
                >
                  <GitBranch className="w-3.5 h-3.5 text-[#6b7280] transition-colors group-hover:text-accent" />
                  View Worktree
                </button>
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
                  onClick={handleCreateWorktree}
                  disabled={isCreatingWorktree || isCodingWithClaude}
                  className={`px-3 py-1.5 text-xs font-medium ${button.primary} rounded-lg disabled:opacity-50 transition-colors duration-150 active:scale-[0.98]`}
                >
                  {isCreatingWorktree ? "Creating..." : "Create Worktree"}
                </button>
                <button
                  type="button"
                  onClick={handleCodeWithClaude}
                  disabled={isCreatingWorktree || isCodingWithClaude}
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

      {/* Metadata bar */}
      <div
        className={`flex-shrink-0 px-5 py-3 border-b ${border.section} flex flex-wrap items-center gap-4`}
      >
        {/* Status */}
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-medium ${text.muted}`}>Status</span>
          <div className="flex gap-0.5 bg-white/[0.04] rounded-lg p-0.5">
            {statusOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => update({ status: opt.value })}
                className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${
                  task.status === opt.value
                    ? customTask.status[opt.value]
                    : `${text.dimmed} hover:${text.muted}`
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Priority */}
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-medium ${text.muted}`}>Priority</span>
          <div className="flex gap-0.5 bg-white/[0.04] rounded-lg p-0.5">
            {priorityOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => update({ priority: opt.value })}
                className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${
                  task.priority === opt.value
                    ? customTask.priority[opt.value] + " bg-white/[0.08]"
                    : `${text.dimmed} hover:${text.muted}`
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-12">
        <section>
          <h3 className={`text-[11px] font-medium ${text.muted} mb-3`}>Description</h3>
          {editingDescription ? (
            <textarea
              ref={autoResize}
              value={descriptionDraft}
              onChange={(e) => {
                setDescriptionDraft(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height =
                  Math.max(e.target.scrollHeight, descriptionMinHeight) + "px";
              }}
              onBlur={saveDescription}
              className={`w-full px-4 py-3 bg-white/[0.02] border border-white/[0.08] rounded-lg text-xs ${text.primary} focus:outline-none resize-none`}
              style={{ minHeight: descriptionMinHeight }}
            />
          ) : (
            <div
              ref={descriptionRef}
              className="rounded-lg bg-white/[0.02] border border-white/[0.04] px-4 py-3 cursor-pointer hover:border-white/[0.08] transition-colors min-h-[60px]"
              onClick={startEditDescription}
            >
              {task.description ? (
                <MarkdownContent content={task.description} />
              ) : (
                <p className={`text-xs ${text.dimmed} italic`}>Click to add a description...</p>
              )}
            </div>
          )}
        </section>

        {/* Attachments */}
        <section
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            if (e.dataTransfer.files.length) handleUploadFiles(e.dataTransfer.files);
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className={`text-[11px] font-medium ${text.muted}`}>
              Attachments{task.attachments?.length > 0 ? ` (${task.attachments.length})` : ""}
            </h3>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium ${text.muted} hover:${text.secondary} rounded-md hover:bg-white/[0.06] transition-colors disabled:opacity-50`}
            >
              <Paperclip className="w-3.5 h-3.5" />
              {isUploading ? "Uploading..." : "Add file"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) {
                  handleUploadFiles(e.target.files);
                  e.target.value = "";
                }
              }}
            />
          </div>
          {task.attachments?.length > 0 ? (
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
              <div className="flex flex-wrap gap-3 items-center">
                {[...task.attachments].reverse().map((att: CustomTaskAttachment) => (
                  <AttachmentThumbnail
                    key={att.filename}
                    filename={att.filename}
                    mimeType={att.mimeType}
                    size={att.size}
                    src={api.getTaskAttachmentUrl(taskId, att.filename)}
                    extra={
                      att.createdAt
                        ? new Date(att.createdAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })
                        : undefined
                    }
                    onPreview={setPreviewImage}
                    onRemove={() => handleDeleteAttachment(att.filename)}
                  />
                ))}
                {/* Add tile */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-10 h-10 ml-5 -mt-8 rounded-full bg-white/[0.04] hover:bg-white/[0.07] transition-colors self-center"
                  style={{ display: "grid", placeItems: "center" }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className={`w-4 h-4 ${text.dimmed}`}
                  >
                    <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                  </svg>
                </button>
              </div>
            </div>
          ) : (
            <div
              className={`rounded-lg border border-dashed ${isDragOver ? "border-amber-400/40 bg-amber-400/[0.04]" : "border-white/[0.08]"} px-4 py-6 text-center transition-colors cursor-pointer hover:border-white/[0.15]`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                if (e.dataTransfer.files.length) handleUploadFiles(e.dataTransfer.files);
              }}
            >
              <p className={`text-xs ${text.dimmed}`}>
                {isUploading ? "Uploading..." : "Drop files here or click to upload"}
              </p>
            </div>
          )}
        </section>

        <PersonalNotesSection source="local" issueId={taskId} />
        <AgentSection source="local" issueId={taskId} />

        {/* Timestamps */}
        <div className={`text-[11px] ${text.dimmed} flex flex-wrap gap-4 pt-2`}>
          <span>Created {formatDate(task.createdAt)}</span>
          <span>Updated {formatDate(task.updatedAt)}</span>
        </div>
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <>
          <div
            className="fixed inset-0 bg-black/60 z-50"
            onClick={() => setShowDeleteConfirm(false)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="bg-surface-panel rounded-xl shadow-2xl border border-white/[0.08] p-5 max-w-sm w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className={`text-sm font-medium ${text.primary} mb-2`}>Delete task?</h3>
              <p className={`text-xs ${text.secondary} mb-4`}>
                This will permanently delete "{task.title}". This cannot be undone.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className={`px-3 py-1.5 text-xs rounded-lg ${text.muted} hover:${text.secondary} transition-colors`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className={`px-3 py-1.5 text-xs font-medium ${button.confirm} rounded-lg transition-colors`}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {previewImage && (
        <ImageModal
          src={previewImage.src}
          filename={previewImage.filename}
          type={previewImage.type}
          onClose={() => setPreviewImage(null)}
        />
      )}
    </div>
  );
}
