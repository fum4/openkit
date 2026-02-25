import { Trash2 } from "lucide-react";

import { button, text } from "../theme";
import { Modal } from "./Modal";

interface ConfirmDialogProps {
  title: string;
  confirmLabel?: string;
  confirmClassName?: string;
  icon?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}

export function ConfirmDialog({
  title,
  confirmLabel = "Delete",
  confirmClassName,
  icon,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  return (
    <Modal
      title={title}
      icon={icon ?? <Trash2 className="w-4 h-4 text-red-400" />}
      width="sm"
      onClose={onCancel}
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className={`px-3 py-1.5 text-xs rounded-lg ${text.muted} hover:${text.secondary} transition-colors`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-3 py-1.5 text-xs font-medium ${confirmClassName ?? button.confirm} rounded-lg transition-colors`}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
