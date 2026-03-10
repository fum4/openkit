import { useEffect } from "react";

import {
  type ShortcutAction,
  type ShortcutBinding,
  type ShortcutEvent,
  matchesEvent,
  matchesProjectTab,
  resolveBindings,
} from "../shortcuts";

interface UseShortcutsOptions {
  shortcuts: Record<string, string> | undefined;
  onAction: (event: ShortcutEvent) => void;
  enabled?: boolean;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  if (target.closest(".monaco-editor")) return true;
  return false;
}

function isModalOpen(): boolean {
  return document.querySelector("[data-modal-open]") !== null;
}

export function useShortcuts({ shortcuts, onAction, enabled = true }: UseShortcutsOptions) {
  useEffect(() => {
    if (!enabled) return;

    const bindings = resolveBindings(shortcuts);

    function handleKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;
      if (isModalOpen()) return;

      // Check project-tab first (modifier + digit)
      const projectTabBinding = bindings["project-tab"];
      if (projectTabBinding) {
        const tabIndex = matchesProjectTab(projectTabBinding, event);
        if (tabIndex >= 0) {
          event.preventDefault();
          event.stopPropagation();
          onAction({ action: "project-tab", tabIndex });
          return;
        }
      }

      // Check regular shortcuts
      const entries = Object.entries(bindings) as [ShortcutAction, ShortcutBinding][];
      for (const [action, binding] of entries) {
        if (action === "project-tab") continue;
        if (matchesEvent(binding, event)) {
          event.preventDefault();
          event.stopPropagation();
          onAction({ action });
          return;
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [shortcuts, onAction, enabled]);
}
