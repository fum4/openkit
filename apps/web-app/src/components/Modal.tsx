import { X } from "lucide-react";

import { surface, text } from "../theme";

interface ModalProps {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  onSubmit?: (e: React.FormEvent) => void;
  width?: "sm" | "md" | "lg";
}

const widthMap = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" } as const;

export function Modal({
  title,
  icon,
  children,
  footer,
  onClose,
  onSubmit,
  width = "md",
}: ModalProps) {
  const widthClass = widthMap[width];

  const content = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          {icon && <div className="p-2 rounded-lg bg-white/[0.06]">{icon}</div>}
          <h2 className={`text-sm font-medium ${text.primary}`}>{title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={`p-1 rounded-md ${text.muted} hover:${text.secondary} hover:bg-white/[0.04] transition-colors`}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="px-5 py-4">{children}</div>

      {/* Footer */}
      {footer && (
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-white/[0.06]">
          {footer}
        </div>
      )}
    </>
  );

  return (
    <>
      {/* Backdrop */}
      <div className={`fixed inset-0 ${surface.overlay} z-50`} onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {onSubmit ? (
          <form
            onSubmit={onSubmit}
            className={`w-full ${widthClass} ${surface.panel} rounded-xl shadow-2xl border border-white/[0.08] overflow-hidden`}
            onClick={(e) => e.stopPropagation()}
          >
            {content}
          </form>
        ) : (
          <div
            className={`w-full ${widthClass} ${surface.panel} rounded-xl shadow-2xl border border-white/[0.08] overflow-hidden`}
            onClick={(e) => e.stopPropagation()}
          >
            {content}
          </div>
        )}
      </div>
    </>
  );
}
