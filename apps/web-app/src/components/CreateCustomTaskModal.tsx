import { useMemo, useRef, useState } from "react";
import { ListTodo, Paperclip, X } from "lucide-react";

import { customTask, getLabelColor, text } from "../theme";
import { Modal } from "./Modal";
import { ImageModal } from "./ImageModal";
import { AttachmentThumbnail } from "./AttachmentThumbnail";

interface CreateCustomTaskModalProps {
  onCreated: (taskId?: string) => void;
  onClose: () => void;
  onCreate: (data: {
    title: string;
    description?: string;
    priority?: string;
    labels?: string[];
    linkedWorktreeId?: string;
  }) => Promise<{ success: boolean; task?: { id: string }; error?: string }>;
  onUploadAttachment?: (taskId: string, file: File) => Promise<unknown>;
  linkedWorktreeId?: string;
}

export function CreateCustomTaskModal({
  onCreated,
  onClose,
  onCreate,
  onUploadAttachment,
  linkedWorktreeId,
}: CreateCustomTaskModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium");
  const [labels, setLabels] = useState<string[]>([]);
  const [labelInput, setLabelInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<{
    src: string;
    filename: string;
    type: "image" | "pdf";
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Stable object URLs for file previews
  const fileUrls = useMemo(
    () =>
      files.map((f) =>
        f.type.startsWith("image/") || f.type === "application/pdf"
          ? URL.createObjectURL(f)
          : undefined,
      ),
    [files],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsCreating(true);
    setError(null);

    const result = await onCreate({
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      labels: labels.length > 0 ? labels : undefined,
      linkedWorktreeId,
    });

    setIsCreating(false);

    if (result.success) {
      // Upload attachments if any
      if (result.task?.id && files.length > 0 && onUploadAttachment) {
        for (const file of files) {
          await onUploadAttachment(result.task.id, file);
        }
      }
      onCreated(result.task?.id);
      onClose();
    } else {
      setError(result.error ?? "Failed to create task");
    }
  };

  const addLabel = () => {
    const trimmed = labelInput.trim();
    if (trimmed && !labels.includes(trimmed)) {
      setLabels([...labels, trimmed]);
    }
    setLabelInput("");
  };

  const removeLabel = (label: string) => {
    setLabels(labels.filter((l) => l !== label));
  };

  const priorities = ["low", "medium", "high"] as const;

  return (
    <Modal
      title="Create Task"
      icon={<ListTodo className="w-4 h-4 text-amber-400" />}
      onClose={onClose}
      onSubmit={handleSubmit}
      width="lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className={`px-3 py-1.5 text-xs rounded-lg ${text.muted} hover:${text.secondary} transition-colors`}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim() || isCreating}
            className={`px-4 py-1.5 text-xs font-medium rounded-lg ${customTask.button} disabled:opacity-50 transition-colors`}
          >
            {isCreating ? "Creating..." : "Create Task"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Title */}
        <div>
          <label className={`block text-[11px] font-medium ${text.secondary} mb-1.5`}>Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            className={`w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-xs ${text.primary} placeholder-[#4b5563] outline-none focus:border-white/[0.15] transition-colors`}
            autoFocus
          />
        </div>

        {/* Priority + Labels */}
        <div className="flex gap-3 items-start">
          {/* Priority */}
          <div className="shrink-0">
            <label className={`block text-[11px] font-medium ${text.secondary} mb-1.5`}>
              Priority
            </label>
            <div className="flex gap-1">
              {priorities.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={`px-2.5 py-1.5 text-[11px] font-medium rounded-lg transition-colors ${
                    priority === p
                      ? `${customTask.priority[p]} bg-white/[0.08]`
                      : `${text.muted} hover:bg-white/[0.04]`
                  }`}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Labels */}
          <div className="flex-1 min-w-0">
            <label className={`block text-[11px] font-medium ${text.secondary} mb-1.5`}>
              Labels
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    addLabel();
                  }
                }}
                placeholder="Add a label..."
                className={`flex-1 px-3 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded-lg text-xs ${text.primary} placeholder-[#4b5563] outline-none focus:border-white/[0.15] transition-colors`}
              />
              <button
                type="button"
                onClick={addLabel}
                disabled={!labelInput.trim()}
                className={`px-3 py-1.5 text-[11px] font-medium rounded-lg bg-white/[0.06] ${text.secondary} hover:bg-white/[0.10] disabled:opacity-30 transition-colors`}
              >
                Add
              </button>
            </div>
          </div>
        </div>

        {labels.length > 0 && (
          <div className="flex flex-wrap gap-1.5 -mt-2">
            {labels.map((label) => {
              const colorSet = getLabelColor(label);
              return (
                <span
                  key={label}
                  className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded ${colorSet.text} ${colorSet.bg}`}
                >
                  {label}
                  <button
                    type="button"
                    onClick={() => removeLabel(label)}
                    className="hover:opacity-70 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {/* Description */}
        <div>
          <label className={`block text-[11px] font-medium ${text.secondary} mb-1.5`}>
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add details, markdown supported..."
            rows={8}
            className={`w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-xs ${text.primary} placeholder-[#4b5563] outline-none focus:border-white/[0.15] transition-colors resize-none`}
          />
        </div>

        {/* Attachments */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className={`text-[11px] font-medium ${text.secondary}`}>Attachments</label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium ${text.muted} hover:${text.secondary} rounded-md hover:bg-white/[0.06] transition-colors`}
            >
              <Paperclip className="w-3.5 h-3.5" />
              Add file
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) {
                  setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
                  e.target.value = "";
                }
              }}
            />
          </div>
          {files.length > 0 && (
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
              <div className="flex flex-wrap gap-3">
                {files.map((file, i) => (
                  <AttachmentThumbnail
                    key={`${file.name}-${i}`}
                    filename={file.name}
                    mimeType={file.type}
                    size={file.size}
                    src={fileUrls[i]}
                    onPreview={setPreviewImage}
                    onRemove={() => setFiles(files.filter((_, idx) => idx !== i))}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {error && <p className={`${text.error} text-[11px]`}>{error}</p>}
      </div>

      {previewImage && (
        <ImageModal
          src={previewImage.src}
          filename={previewImage.filename}
          type={previewImage.type}
          onClose={() => setPreviewImage(null)}
        />
      )}
    </Modal>
  );
}
