import { Paperclip, X } from "lucide-react";

import { text } from "../theme";
import { TruncatedTooltip } from "./TruncatedTooltip";

interface AttachmentThumbnailProps {
  filename: string;
  mimeType: string;
  size: number;
  /** Image/PDF src URL for preview */
  src?: string;
  /** Extra info shown after size (e.g. date) */
  extra?: string;
  /** Called when clicking an image/PDF — opens preview modal */
  onPreview?: (preview: { src: string; filename: string; type: "image" | "pdf" }) => void;
  /** Called when clicking the remove button */
  onRemove?: () => void;
}

function formatSize(size: number): string {
  if (size < 1024) return `${size}B`;
  if (size < 1048576) return `${Math.round(size / 1024)}KB`;
  return `${(size / 1048576).toFixed(1)}MB`;
}

export function AttachmentThumbnail({
  filename,
  mimeType,
  size,
  src,
  extra,
  onPreview,
  onRemove,
}: AttachmentThumbnailProps) {
  const isImage = mimeType.startsWith("image/");
  const isPdf = mimeType === "application/pdf";

  return (
    <div className="group flex flex-col w-36">
      <div className="relative">
        {isImage && src ? (
          <button
            type="button"
            onClick={() => onPreview?.({ src, filename, type: "image" })}
            className="rounded overflow-hidden block"
          >
            <img
              src={src}
              alt={filename}
              className="w-36 h-28 object-cover transition-transform hover:scale-105"
            />
          </button>
        ) : isPdf && src ? (
          <button
            type="button"
            onClick={() => onPreview?.({ src, filename, type: "pdf" })}
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
            <Paperclip className={`w-6 h-6 ${text.dimmed}`} />
          </div>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="absolute -top-1.5 -right-1.5 p-1 rounded-full bg-black border border-white/[0.08] text-[#9ca3af] hover:bg-red-700 hover:text-white hover:border-transparent hover:scale-110 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      <TruncatedTooltip text={filename} className={`text-[10px] ${text.muted} mt-1.5`} />
      <span className={`text-[9px] ${text.dimmed}`}>
        {formatSize(size)}
        {extra ? ` · ${extra}` : ""}
      </span>
    </div>
  );
}
