import { useEffect, useRef } from "react";

import { border, button, surface, text } from "../theme";

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${surface.overlay}`}
      onClick={onCancel}
    >
      <div
        className={`${surface.modal} border ${border.modal} rounded-xl p-5 max-w-sm w-full mx-4 shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className={`${text.primary} font-semibold text-sm mb-2`}>{title}</h3>
        <p className={`${text.secondary} text-xs mb-5`}>{message}</p>
        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className={`px-3 py-1.5 text-xs font-medium ${button.secondary} rounded-lg transition-colors duration-150 active:scale-[0.98]`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-3 py-1.5 text-xs font-medium ${button.confirm} rounded-lg transition-colors duration-150 active:scale-[0.98]`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
