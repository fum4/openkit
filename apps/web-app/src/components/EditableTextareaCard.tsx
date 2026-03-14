import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { FileCode } from "lucide-react";

import { text } from "../theme";
import { ClickToEditHint } from "./ClickToEditHint";
import { Spinner } from "./Spinner";

interface PathAnnotation {
  text: string;
  title?: string;
  actions?: ReactNode;
  icon?: ReactNode;
}

interface EditableTextareaCardProps {
  value: string;
  onSave: (value: string) => Promise<unknown> | unknown;
  editable?: boolean;
  onStartEditing?: () => boolean | void;
  renderPreview?: (value: string) => ReactNode;
  rows?: number;
  monospace?: boolean;
  startEditing?: boolean;
  debounceMs?: number;
  placeholder?: string;
  pathAnnotation?: PathAnnotation;
  sectionTitle?: string;
  showClickHint?: boolean;
  hintClassName?: string;
  textareaClassName?: string;
  containerClassName?: string;
  contentPaddingClassName?: string;
  previewClassName?: string;
  emptyPlaceholder?: ReactNode;
  showSaveState?: boolean;
  savedLabel?: string;
  showInlineSaveError?: boolean;
}

export function EditableTextareaCard({
  value,
  onSave,
  editable = true,
  onStartEditing,
  renderPreview,
  rows = 8,
  monospace = false,
  startEditing = false,
  debounceMs,
  placeholder,
  pathAnnotation,
  sectionTitle,
  showClickHint = true,
  hintClassName,
  textareaClassName,
  containerClassName = "rounded-lg bg-white/[0.02] border border-white/[0.04] overflow-hidden",
  contentPaddingClassName = "p-3",
  previewClassName,
  emptyPlaceholder,
  showSaveState = false,
  savedLabel = "Saved",
  showInlineSaveError = true,
}: EditableTextareaCardProps) {
  const [editing, setEditing] = useState(startEditing);
  const [draft, setDraft] = useState(startEditing ? value : "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef(value);

  useEffect(() => {
    if (!editing) {
      setDraft(value);
      lastSavedRef.current = value;
    }
  }, [editing, value]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    if (!editing || !textareaRef.current) return;
    const el = textareaRef.current;
    requestAnimationFrame(() => {
      const end = el.value.length;
      el.focus();
      el.setSelectionRange(end, end);
      autoResize();
    });
  }, [editing, autoResize]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  const persist = useCallback(
    async (nextValue: string) => {
      if (nextValue === lastSavedRef.current) return true;
      setSaving(true);
      try {
        const result = await onSave(nextValue);
        if (result === false) {
          throw new Error("Failed to save");
        }
        lastSavedRef.current = nextValue;
        setSaved(true);
        setSaveError(null);
        return true;
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Failed to save");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [onSave],
  );

  const schedulePersist = useCallback(
    (nextValue: string) => {
      if (!debounceMs) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void persist(nextValue);
      }, debounceMs);
    },
    [debounceMs, persist],
  );

  const finishEditing = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await persist(draft);
    setEditing(false);
  }, [draft, persist]);

  return (
    <div className={containerClassName}>
      {sectionTitle ? (
        <h3 className={`text-[11px] font-medium ${text.muted} px-3 pt-2 pb-1`}>{sectionTitle}</h3>
      ) : null}

      {pathAnnotation ? (
        <>
          <div className="flex items-center justify-between gap-2 px-3 pt-2 pb-2">
            <div className="flex items-center gap-1.5 min-w-0">
              {pathAnnotation.icon ?? <FileCode className={`w-3.5 h-3.5 ${text.muted}`} />}
              <span
                className={`text-[10px] ${text.muted} truncate`}
                title={pathAnnotation.title ?? pathAnnotation.text}
              >
                {pathAnnotation.text}
              </span>
            </div>
            {pathAnnotation.actions ? (
              <div className="flex-shrink-0">{pathAnnotation.actions}</div>
            ) : null}
          </div>
          <div className="border-t border-white/[0.08]" />
        </>
      ) : null}

      {editing ? (
        <div className={`${contentPaddingClassName} relative`}>
          {showSaveState && (saving || saved) ? (
            <div className="absolute top-2 right-3 flex items-center gap-1.5">
              {saving ? <Spinner size="xs" className={text.muted} /> : null}
              {!saving && saved ? (
                <span className={`text-[10px] ${text.muted} font-medium`}>{savedLabel}</span>
              ) : null}
            </div>
          ) : null}
          <textarea
            ref={textareaRef}
            value={draft}
            placeholder={placeholder}
            onChange={(e) => {
              const nextValue = e.target.value;
              setDraft(nextValue);
              if (saved) setSaved(false);
              schedulePersist(nextValue);
              autoResize();
            }}
            onBlur={() => {
              void finishEditing();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                void finishEditing();
              }
            }}
            rows={rows}
            className={`block w-full p-0 text-xs bg-transparent border-0 rounded-none focus:outline-none resize-none overflow-hidden ${monospace ? `font-mono ${text.secondary}` : text.primary}${textareaClassName ? ` ${textareaClassName}` : ""}`}
          />
          {showInlineSaveError && saveError && (
            <div className="flex items-center gap-2 mt-1">
              {saveError ? <span className={`text-[10px] ${text.error}`}>{saveError}</span> : null}
            </div>
          )}
        </div>
      ) : (
        <div
          className={`${editable ? "cursor-pointer hover:bg-white/[0.03] transition-colors" : ""} ${contentPaddingClassName}`}
          onClick={
            editable
              ? () => {
                  if (onStartEditing && onStartEditing() === false) return;
                  setDraft(value);
                  lastSavedRef.current = value;
                  setSaved(false);
                  setSaveError(null);
                  setEditing(true);
                }
              : undefined
          }
        >
          {value ? (
            renderPreview ? (
              <div className={previewClassName}>{renderPreview(value)}</div>
            ) : (
              <pre
                className={`text-xs whitespace-pre-wrap ${monospace ? `font-mono ${text.secondary}` : text.primary}`}
              >
                {value}
              </pre>
            )
          ) : emptyPlaceholder ? (
            emptyPlaceholder
          ) : showClickHint && editable ? (
            <ClickToEditHint className={hintClassName} />
          ) : null}
          {value && showClickHint && editable ? (
            <ClickToEditHint className={hintClassName ?? "mt-2"} />
          ) : null}
        </div>
      )}
    </div>
  );
}
