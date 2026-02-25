import { surface, text } from "../theme";

interface PreviewModalProps {
  src: string;
  filename: string;
  type?: "image" | "pdf";
  onClose: () => void;
}

export function ImageModal({ src, filename, type = "image", onClose }: PreviewModalProps) {
  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${surface.overlay}`}
      onClick={onClose}
    >
      <div
        className={`relative flex flex-col items-center ${type === "pdf" ? "w-[80vw] h-[90vh]" : "max-w-[90vw] max-h-[90vh]"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between w-full mb-2 px-1">
          <span className={`text-xs ${text.secondary} truncate`}>{filename}</span>
          <button
            type="button"
            onClick={onClose}
            className={`${text.muted} hover:text-white hover:scale-110 transition-all ml-3 flex-shrink-0`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-5 h-5"
            >
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>
        {type === "pdf" ? (
          <iframe
            src={src}
            title={filename}
            className="w-full flex-1 rounded-lg shadow-2xl bg-white"
          />
        ) : (
          <img
            src={src}
            alt={filename}
            className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
          />
        )}
      </div>
    </div>
  );
}
