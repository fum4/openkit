import { Loader2, Trash2 } from "lucide-react";

import { button, text } from "../theme";
import { Modal } from "./Modal";

interface ConfirmDialogProps {
  title: string;
  confirmLabel?: string;
  loadingConfirmLabel?: string;
  confirmClassName?: string;
  icon?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
  showCancelButton?: boolean;
  showCloseButton?: boolean;
  closeOnBackdrop?: boolean;
  children: React.ReactNode;
}

export function ConfirmDialog({
  title,
  confirmLabel = "Delete",
  loadingConfirmLabel = "Deleting...",
  confirmClassName,
  icon,
  onConfirm,
  onCancel,
  isLoading = false,
  showCancelButton = true,
  showCloseButton = true,
  closeOnBackdrop = true,
  children,
}: ConfirmDialogProps) {
  const handleClose = isLoading ? () => {} : onCancel;

  return (
    <Modal
      title={title}
      icon={icon ?? <Trash2 className="w-4 h-4 text-red-400" />}
      width="sm"
      onClose={handleClose}
      showCloseButton={showCloseButton}
      closeOnBackdrop={closeOnBackdrop}
      footer={
        <>
          {showCancelButton ? (
            <button
              type="button"
              onClick={handleClose}
              disabled={isLoading}
              className={`px-3 py-1.5 text-xs rounded-lg ${text.muted} hover:${text.secondary} transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            onClick={isLoading ? undefined : onConfirm}
            disabled={isLoading}
            className={`px-3 py-1.5 text-xs font-medium ${confirmClassName ?? button.confirm} rounded-lg transition-colors disabled:opacity-70 disabled:cursor-not-allowed inline-flex items-center gap-1.5`}
          >
            {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {isLoading ? loadingConfirmLabel : confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
