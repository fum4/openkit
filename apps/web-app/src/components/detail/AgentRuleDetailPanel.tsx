import { useState, useCallback, useRef, useEffect } from "react";
import { FileCode, Plus, Trash2 } from "lucide-react";

import { useApi } from "../../hooks/useApi";
import { useAgentRule } from "../../hooks/useAgentRules";
import { agentRule, text, border } from "../../theme";
import { ConfirmDialog } from "../ConfirmDialog";
import { MarkdownContent } from "../MarkdownContent";
import { Spinner } from "../Spinner";

const FILE_META: Record<string, { name: string; path: string; initial: string }> = {
  "claude-md": { name: "CLAUDE.md", path: "CLAUDE.md", initial: "# CLAUDE.md\n\n" },
  "agents-md": { name: "AGENTS.md", path: "AGENTS.md", initial: "# AGENTS.md\n\n" },
};

interface Props {
  fileId: string;
}

export function AgentRuleDetailPanel({ fileId }: Props) {
  const meta = FILE_META[fileId];
  const api = useApi();
  const { exists, content, isLoading, refetch } = useAgentRule(fileId);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef("");

  const flushSave = useCallback(
    async (value: string) => {
      if (value !== lastSaved.current) {
        lastSaved.current = value;
        await api.saveAgentRule(fileId, value);
      }
    },
    [api, fileId],
  );

  const scheduleSave = useCallback(
    (value: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => flushSave(value), 600);
    },
    [flushSave],
  );

  const finishEditing = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await flushSave(draft);
    await refetch();
    setEditing(false);
  }, [draft, flushSave, refetch]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const focusRef = useCallback((el: HTMLTextAreaElement | null) => {
    textareaRef.current = el;
    if (el) el.focus();
  }, []);

  const startEdit = () => {
    setDraft(content);
    lastSaved.current = content;
    setEditing(true);
  };

  const handleDelete = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setEditing(false);
    await api.deleteAgentRule(fileId);
    await refetch();
    setShowDeleteConfirm(false);
  };

  const handleCreate = async () => {
    await api.saveAgentRule(fileId, meta.initial);
    await refetch();
    setDraft(meta.initial);
    lastSaved.current = meta.initial;
    setEditing(true);
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner size="sm" className={text.muted} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className={`flex-shrink-0 flex items-center gap-3 px-5 py-4 border-b ${border.subtle}`}>
        <FileCode className={`w-4 h-4 ${agentRule.accent}`} />
        <div className="flex-1 min-w-0">
          <h2 className={`text-sm font-semibold ${text.primary}`}>{meta.name}</h2>
          <p className={`text-[11px] ${text.muted}`}>{meta.path}</p>
        </div>
        {exists && (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className={`p-1.5 rounded-lg ${text.muted} hover:text-red-400 hover:bg-red-900/20 transition-colors`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Content */}
      {!exists && !editing ? (
        <div className="flex-1 flex items-center justify-center pb-24">
          <div className="flex flex-col items-center gap-3">
            <FileCode className={`w-8 h-8 ${text.dimmed}`} />
            <p className={`text-xs ${text.muted}`}>This file doesn't exist yet.</p>
            <button
              type="button"
              onClick={handleCreate}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg ${agentRule.accentBg} ${agentRule.accent} hover:bg-cyan-400/20 transition-colors`}
            >
              <Plus className="w-3.5 h-3.5" />
              Create {meta.name}
            </button>
          </div>
        </div>
      ) : editing ? (
        <div className="flex-1 flex flex-col min-h-0 p-5">
          <textarea
            ref={focusRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              scheduleSave(e.target.value);
            }}
            onBlur={finishEditing}
            onKeyDown={(e) => {
              if (e.key === "Escape") finishEditing();
            }}
            className={`flex-1 w-full bg-transparent text-xs ${text.primary} focus:outline-none resize-none font-mono leading-relaxed placeholder-[#3b4049]`}
            placeholder={`Write ${meta.name} content...`}
          />
        </div>
      ) : (
        <div
          className="flex-1 overflow-y-auto p-5 cursor-pointer hover:bg-white/[0.01] transition-colors"
          onClick={startEdit}
        >
          <MarkdownContent content={content} />
        </div>
      )}

      {showDeleteConfirm && (
        <ConfirmDialog
          title={`Delete ${meta.name}?`}
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        >
          <p className={`text-xs ${text.secondary}`}>This will delete {meta.path} from disk.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
