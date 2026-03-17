import { Keyboard, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type ShortcutAction,
  type ShortcutBinding,
  DEFAULT_SHORTCUTS,
  SHORTCUT_DEFAULTS,
  detectConflict,
  formatProjectTabShortcut,
  formatShortcut,
  serializeBinding,
  serializeProjectTabBinding,
} from "../shortcuts";
import { settings, shortcut, text } from "../theme";
import { useServer } from "../contexts/ServerContext";
import { useApi } from "../hooks/useApi";
import { ConfirmModal } from "./ConfirmModal";
import { ToggleSwitch } from "./ToggleSwitch";

interface ShortcutsSectionProps {
  shortcuts: Record<string, string> | undefined;
  arrowNavEnabled: boolean;
  onSaved: () => void;
}

const SHORTCUT_LABELS: Record<ShortcutAction, { label: string; description?: string }> = {
  "project-tab": {
    label: "Go to Project Tab",
    description: "Modifier + number key (1, 2, 3…) switches to that project tab",
  },
  "nav-worktrees": { label: "Go to Worktrees" },
  "nav-issues": { label: "Go to Issues" },
  "nav-agents": { label: "Go to Agents" },
  "nav-activity": { label: "Go to Activity" },
  "nav-integrations": { label: "Go to Integrations" },
  "nav-performance": { label: "Go to Performance" },
  "nav-settings": { label: "Go to Settings" },
};

function getEffectiveBinding(
  actionId: ShortcutAction,
  overrides: Record<string, string> | undefined,
): ShortcutBinding {
  if (overrides?.[actionId]) {
    const parts = overrides[actionId].split("+").map((p) => p.trim().toLowerCase());
    const binding: ShortcutBinding = { key: "", metaKey: false };
    for (const part of parts) {
      if (part === "meta") binding.metaKey = true;
      else if (part === "shift") binding.shiftKey = true;
      else if (part === "alt") binding.altKey = true;
      else binding.key = part;
    }
    return binding;
  }
  return SHORTCUT_DEFAULTS[actionId];
}

function isModified(
  actionId: ShortcutAction,
  overrides: Record<string, string> | undefined,
): boolean {
  if (!overrides?.[actionId]) return false;
  const defaultSerialized =
    actionId === "project-tab"
      ? serializeProjectTabBinding(SHORTCUT_DEFAULTS[actionId])
      : serializeBinding(SHORTCUT_DEFAULTS[actionId]);
  return overrides[actionId] !== defaultSerialized;
}

export function ShortcutsSection({
  shortcuts: overrides,
  arrowNavEnabled,
  onSaved,
}: ShortcutsSectionProps) {
  const api = useApi();
  const { projects, isElectron } = useServer();
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [pendingApplyAll, setPendingApplyAll] = useState<{
    actionId: ShortcutAction;
    serialized: string;
  } | null>(null);
  const recordingRef = useRef<ShortcutAction | null>(null);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  const getAllBindings = useCallback((): Record<string, string> => {
    const bindings: Record<string, string> = {};
    for (const def of DEFAULT_SHORTCUTS) {
      if (def.id === "project-tab") {
        bindings[def.id] = overrides?.[def.id] ?? serializeProjectTabBinding(def.defaultBinding);
      } else {
        bindings[def.id] = overrides?.[def.id] ?? serializeBinding(def.defaultBinding);
      }
    }
    return bindings;
  }, [overrides]);

  const doSave = useCallback(
    async (actionId: ShortcutAction, serialized: string) => {
      await api.saveLocalConfig({ shortcuts: { ...overrides, [actionId]: serialized } });
      onSaved();
    },
    [api, overrides, onSaved],
  );

  const handleApplyAllConfirm = useCallback(
    async (choice: "current" | "all") => {
      if (!pendingApplyAll) return;
      const { actionId, serialized } = pendingApplyAll;

      await api.saveLocalConfig({ shortcuts: { ...overrides, [actionId]: serialized } });

      if (choice === "all") {
        for (const project of projects) {
          const projectUrl = `http://localhost:${project.port}`;
          try {
            const res = await fetch(`${projectUrl}/api/local-config`);
            const remoteConfig = res.ok ? await res.json() : {};
            const remoteShortcuts = (remoteConfig.shortcuts as Record<string, string>) ?? {};
            await fetch(`${projectUrl}/api/local-config`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                shortcuts: { ...remoteShortcuts, [actionId]: serialized },
              }),
            });
          } catch {
            // Best effort
          }
        }
      }

      setPendingApplyAll(null);
      onSaved();
    },
    [pendingApplyAll, api, overrides, projects, onSaved],
  );

  const handleResetToDefault = useCallback(
    async (actionId: ShortcutAction) => {
      const defaultSerialized =
        actionId === "project-tab"
          ? serializeProjectTabBinding(SHORTCUT_DEFAULTS[actionId])
          : serializeBinding(SHORTCUT_DEFAULTS[actionId]);
      const next = { ...overrides, [actionId]: defaultSerialized };
      await api.saveLocalConfig({ shortcuts: next });
      onSaved();
    },
    [api, overrides, onSaved],
  );

  useEffect(() => {
    if (!recording) return;
    const isProjectTab = recording === "project-tab";

    function handleKeyDown(event: KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setRecording(null);
        setConflict(null);
        return;
      }

      if (["Meta", "Shift", "Alt", "Control"].includes(event.key)) return;

      const actionId = recordingRef.current;
      if (!actionId) return;

      if (isProjectTab) {
        if (!event.metaKey && !event.altKey) return;

        const binding: ShortcutBinding = {
          key: "",
          metaKey: event.metaKey,
          shiftKey: event.shiftKey || undefined,
          altKey: event.altKey || undefined,
        };

        setConflict(null);
        setRecording(null);

        const serialized = serializeProjectTabBinding(binding);
        if (isElectron && projects.length > 1) {
          setPendingApplyAll({ actionId, serialized });
        } else {
          doSave(actionId, serialized);
        }
      } else {
        const binding: ShortcutBinding = {
          key: event.key.toLowerCase(),
          metaKey: event.metaKey,
          shiftKey: event.shiftKey || undefined,
          altKey: event.altKey || undefined,
        };

        if (!binding.metaKey) return;

        const allBindings = getAllBindings();
        const conflicting = detectConflict(actionId, binding, allBindings);
        if (conflicting) {
          const conflictDef = DEFAULT_SHORTCUTS.find((s) => s.id === conflicting);
          setConflict(conflictDef?.label ?? conflicting);
          return;
        }

        setConflict(null);
        setRecording(null);

        const serialized = serializeBinding(binding);
        if (isElectron && projects.length > 1) {
          setPendingApplyAll({ actionId, serialized });
        } else {
          doSave(actionId, serialized);
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [recording, getAllBindings, doSave, isElectron, projects.length]);

  return (
    <>
      <h3 className={`text-xs font-semibold ${text.primary} mb-4 flex items-center gap-2`}>
        <Keyboard className={`w-3.5 h-3.5 ${text.muted}`} />
        Keyboard Shortcuts
      </h3>

      <div className="flex flex-col gap-0.5">
        {DEFAULT_SHORTCUTS.map((def) => {
          const meta = SHORTCUT_LABELS[def.id];
          const isRecording = recording === def.id;
          const modified = isModified(def.id, overrides);
          const binding = getEffectiveBinding(def.id, overrides);
          const isProjectTab = def.id === "project-tab";
          const displayText = isProjectTab
            ? formatProjectTabShortcut(binding)
            : formatShortcut(binding);

          return (
            <div key={def.id} className="flex flex-col">
              <div className="flex items-center justify-between py-1.5">
                <div className="flex flex-col gap-0.5">
                  <span className={`text-xs font-medium ${settings.label}`}>{meta.label}</span>
                  {meta.description && (
                    <span className={`text-[10px] ${settings.description}`}>
                      {meta.description}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {modified && (
                    <button
                      type="button"
                      onClick={() => handleResetToDefault(def.id)}
                      className={`p-0.5 rounded ${text.dimmed} hover:text-white/70 transition-colors duration-150`}
                      title="Reset to default"
                    >
                      <RotateCcw size={11} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setRecording(def.id);
                      setConflict(null);
                    }}
                    className={`rounded-md px-2 py-0.5 font-mono text-[11px] transition-all duration-150 ${
                      isRecording
                        ? shortcut.badgeRecording
                        : modified
                          ? `${shortcut.badge} ${shortcut.badgeModified}`
                          : shortcut.badge
                    }`}
                  >
                    {isRecording
                      ? isProjectTab
                        ? "Press modifier + any key..."
                        : "Press keys..."
                      : displayText}
                  </button>
                </div>
              </div>
              {isRecording && conflict && (
                <span className="text-[10px] text-red-400 pb-1">Conflicts with "{conflict}"</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/[0.06]">
        <div className="flex flex-col gap-0.5">
          <span className={`text-xs font-medium ${settings.label}`}>Arrow Key Navigation</span>
          <span className={`text-[10px] ${settings.description}`}>
            ⌘ ← / → navigates between pages, ⌘ ↓ / ↑ navigates the sidebar
          </span>
        </div>
        <ToggleSwitch
          checked={arrowNavEnabled}
          onToggle={async () => {
            await api.saveLocalConfig({ arrowNavEnabled: !arrowNavEnabled });
            onSaved();
          }}
        />
      </div>

      {pendingApplyAll && (
        <ConfirmModal
          title="Apply shortcut change"
          message="Apply this shortcut to all open projects or just the current one?"
          confirmLabel="All projects"
          onConfirm={() => handleApplyAllConfirm("all")}
          onCancel={() => handleApplyAllConfirm("current")}
        />
      )}
    </>
  );
}
