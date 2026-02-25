import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Plus, X } from "lucide-react";

import type { TodoItem } from "../../hooks/api";
import { notes as notesTheme, text } from "../../theme";

interface TodoListProps {
  todos: TodoItem[];
  onAdd: (text: string) => void;
  onToggle: (todoId: string) => void;
  onDelete: (todoId: string) => void;
  onUpdate: (todoId: string, text: string) => void;
}

let draftCounter = 0;

export function TodoList({ todos, onAdd, onToggle, onDelete, onUpdate }: TodoListProps) {
  const [drafts, setDrafts] = useState<number[]>([]);

  const addDraft = () => {
    setDrafts((prev) => [...prev, ++draftCounter]);
  };

  const commitDraft = (draftId: number, value: string) => {
    onAdd(value);
    setDrafts((prev) => prev.filter((id) => id !== draftId));
  };

  const cancelDraft = (draftId: number) => {
    setDrafts((prev) => prev.filter((id) => id !== draftId));
  };

  return (
    <div>
      {todos.map((todo) => (
        <TodoRow
          key={todo.id}
          todo={todo}
          onToggle={onToggle}
          onDelete={onDelete}
          onUpdate={onUpdate}
        />
      ))}

      {drafts.map((draftId) => (
        <NewTodoRow
          key={`draft-${draftId}`}
          onCommit={(value) => commitDraft(draftId, value)}
          onCancel={() => cancelDraft(draftId)}
        />
      ))}

      {/* Add button — always visible */}
      <button
        type="button"
        onClick={addDraft}
        className={`flex items-center gap-1.5 mt-1 py-1 px-1 text-[11px] ${text.dimmed} hover:text-[#9ca3af] transition-colors rounded`}
      >
        <Plus className="w-3 h-3" />
        <span>Add todo</span>
      </button>
    </div>
  );
}

// ─── New todo row (spawned when the add button is clicked) ──────

function NewTodoRow({
  onCommit,
  onCancel,
}: {
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committed = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const commit = useCallback(
    (v: string) => {
      if (committed.current) return;
      committed.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      onCommit(v);
    },
    [onCommit],
  );

  const scheduleCommit = useCallback(
    (v: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => commit(v), 600);
    },
    [commit],
  );

  const handleChange = (newValue: string) => {
    setValue(newValue);
    const trimmed = newValue.trim();
    if (trimmed) {
      scheduleCommit(trimmed);
    } else {
      // Cleared the text — cancel any pending save
      if (saveTimer.current) clearTimeout(saveTimer.current);
    }
  };

  const handleBlur = () => {
    const trimmed = value.trim();
    if (trimmed) {
      commit(trimmed);
    } else {
      onCancel();
    }
  };

  return (
    <div className="flex items-start gap-2.5 py-1.5 px-1 -mx-1 rounded-md">
      {/* Unchecked checkbox (static) */}
      <div
        className={`flex-shrink-0 w-4 h-4 mt-[1px] rounded-full border ${notesTheme.todoCheckbox}`}
      />

      {/* Editable input */}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const trimmed = value.trim();
            if (trimmed) commit(trimmed);
            else onCancel();
          }
          if (e.key === "Escape") onCancel();
        }}
        placeholder="What needs to be done?"
        className={`flex-1 bg-transparent text-xs leading-relaxed ${text.primary} outline-none placeholder-[#3b4049]`}
      />
    </div>
  );
}

// ─── Todo row ───────────────────────────────────────────────────

function TodoRow({
  todo,
  onToggle,
  onDelete,
  onUpdate,
}: {
  todo: TodoItem;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const startEdit = () => {
    setDraft(todo.text);
    setEditing(true);
  };

  const finishEdit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== todo.text) {
      onUpdate(todo.id, trimmed);
    }
  };

  return (
    <div className="flex items-start gap-2.5 py-1.5 px-1 -mx-1 rounded-md group hover:bg-white/[0.02] transition-colors">
      {/* Circular checkbox */}
      <button
        type="button"
        onClick={() => onToggle(todo.id)}
        className={`flex-shrink-0 w-4 h-4 mt-[1px] rounded-full border transition-all duration-200 flex items-center justify-center ${
          todo.checked
            ? notesTheme.todoChecked
            : `${notesTheme.todoCheckbox} hover:border-teal-400/60`
        }`}
      >
        <AnimatePresence>
          {todo.checked && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ duration: 0.12, ease: "easeOut" }}
            >
              <Check className={`w-2.5 h-2.5 ${notesTheme.todoCheckIcon}`} strokeWidth={3} />
            </motion.div>
          )}
        </AnimatePresence>
      </button>

      {/* Text */}
      {editing ? (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={finishEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") finishEdit();
            if (e.key === "Escape") setEditing(false);
          }}
          autoFocus
          className={`flex-1 bg-transparent text-xs leading-relaxed ${text.primary} outline-none`}
        />
      ) : (
        <span
          onClick={startEdit}
          className={`flex-1 text-xs leading-relaxed transition-all duration-200 ${
            todo.checked ? `line-through ${text.dimmed}` : `${text.primary} cursor-text`
          }`}
        >
          {todo.text}
        </span>
      )}

      {/* Delete */}
      <button
        type="button"
        onClick={() => onDelete(todo.id)}
        className={`flex-shrink-0 p-0.5 mt-[1px] rounded opacity-0 group-hover:opacity-100 ${text.dimmed} hover:text-red-400 transition-all duration-150`}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
