import { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleCheck,
  Copy,
  FolderMinus,
  FolderPlus,
  Hand,
  ListChecks,
  MessageSquareText,
  Sparkles,
  Terminal,
} from "lucide-react";

import { useNotes } from "../../hooks/useNotes";
import { useHooksConfig } from "../../hooks/useHooks";
import { notes as notesTheme, text } from "../../theme";
import { MarkdownContent } from "../MarkdownContent";
import { Tooltip } from "../Tooltip";
import { TodoList } from "./TodoList";
import type { GitPolicyOverride, HookSkillOverride, HookTrigger } from "../../hooks/api";

interface SectionProps {
  source: "jira" | "linear" | "local";
  issueId: string;
}

// ─── PersonalNotesSection ───────────────────────────────────────

export function PersonalNotesSection({ source, issueId }: SectionProps) {
  const { notes, updateSection, addTodo } = useNotes(source, issueId);
  const personalContent = notes?.personal?.content ?? "";
  const aiContent = notes?.aiContext?.content ?? "";

  return (
    <section>
      <h3 className={`text-[11px] font-medium ${text.muted} mb-3`}>Notes</h3>
      <NotePane
        key={`${source}-${issueId}-personal`}
        content={personalContent}
        section="personal"
        updateSection={updateSection}
        onMoveToAiContext={(selectedText) => {
          const appended = aiContent ? `${aiContent}\n\n${selectedText}` : selectedText;
          updateSection("aiContext", appended);
        }}
        onAddTodo={addTodo}
        placeholder="Personal notes about this issue..."
        emptyText="Click to add personal notes..."
        accentBg={notesTheme.personalAccent}
        accentBorder={notesTheme.personalBorder}
      />
    </section>
  );
}

// ─── AgentSection ──────────────────────────────────────────────

type AgentTab = "context" | "todos" | "gitPolicy" | "hooks";

const AGENT_TABS: { key: AgentTab; label: string }[] = [
  { key: "context", label: "Context" },
  { key: "todos", label: "Todos" },
  { key: "gitPolicy", label: "Git Policy" },
  { key: "hooks", label: "Hooks" },
];

export function AgentSection({ source, issueId }: SectionProps) {
  const {
    notes,
    updateSection,
    addTodo,
    toggleTodo,
    deleteTodo,
    updateTodoText,
    updateGitPolicy,
    updateHookSkills,
  } = useNotes(source, issueId);
  const { config: hooksConfig } = useHooksConfig();
  const [activeTab, setActiveTab] = useState<AgentTab>("context");

  const aiContent = notes?.aiContext?.content ?? "";
  const todos = notes?.todos ?? [];
  const gitPolicy = notes?.gitPolicy;
  const hookSkills = notes?.hookSkills;

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <h3 className={`text-[11px] font-medium ${text.muted}`}>Agents</h3>
        <div className="flex gap-0.5 bg-white/[0.04] rounded-lg p-0.5">
          {AGENT_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${
                activeTab === tab.key
                  ? `${notesTheme.tabActive} ${notesTheme.aiIcon}`
                  : notesTheme.tabInactive
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Context tab keeps the card — it's an editable markdown area */}
      {activeTab === "context" && (
        <div
          className={`rounded-lg ${notesTheme.aiAccent} border ${notesTheme.aiBorder} overflow-hidden`}
        >
          <DirectionsPane
            key={`${source}-${issueId}-aiContext`}
            content={aiContent}
            updateSection={updateSection}
          />
        </div>
      )}

      {/* Todos — open layout, no card */}
      {activeTab === "todos" && (
        <TodoList
          todos={todos}
          onAdd={addTodo}
          onToggle={toggleTodo}
          onDelete={deleteTodo}
          onUpdate={updateTodoText}
        />
      )}

      {/* Git Policy — inline row of controls */}
      {activeTab === "gitPolicy" && (
        <GitPolicyPane gitPolicy={gitPolicy} updateGitPolicy={updateGitPolicy} />
      )}

      {/* Hooks — grouped list */}
      {activeTab === "hooks" && (
        <HooksPane
          hooksConfig={hooksConfig}
          hookSkills={hookSkills}
          updateHookSkills={updateHookSkills}
        />
      )}
    </section>
  );
}

// ─── Git Policy pane ──────────────────────────────────────────

const POLICY_OPTIONS: { value: GitPolicyOverride; label: string }[] = [
  { value: "inherit", label: "Inherit" },
  { value: "allow", label: "Allow" },
  { value: "deny", label: "Deny" },
];

function GitPolicyPane({
  gitPolicy,
  updateGitPolicy,
}: {
  gitPolicy?: {
    agentCommits?: GitPolicyOverride;
    agentPushes?: GitPolicyOverride;
    agentPRs?: GitPolicyOverride;
  };
  updateGitPolicy: (policy: {
    agentCommits?: GitPolicyOverride;
    agentPushes?: GitPolicyOverride;
    agentPRs?: GitPolicyOverride;
  }) => void;
}) {
  const operations = [
    { key: "agentCommits" as const, label: "Commits" },
    { key: "agentPushes" as const, label: "Pushes" },
    { key: "agentPRs" as const, label: "PRs" },
  ];

  return (
    <div className="space-y-2.5">
      {operations.map((op) => {
        const value: GitPolicyOverride = gitPolicy?.[op.key] ?? "inherit";
        return (
          <div key={op.key} className="flex items-center gap-4">
            <span className={`text-[11px] ${text.secondary} w-14`}>{op.label}</span>
            <div className="flex gap-0.5 bg-white/[0.04] rounded-md p-0.5">
              {POLICY_OPTIONS.map((opt) => {
                let selectedStyle = "text-[#4b5563] hover:text-[#6b7280]";
                if (value === opt.value) {
                  if (opt.value === "allow") selectedStyle = "bg-teal-500/[0.15] text-teal-300";
                  else if (opt.value === "deny") selectedStyle = "bg-red-500/[0.15] text-red-300";
                  else selectedStyle = "bg-white/[0.10] text-[#e0e2e5]";
                }
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => updateGitPolicy({ [op.key]: opt.value })}
                    className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${selectedStyle}`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Hooks pane ───────────────────────────────────────────────

const SKILL_OVERRIDE_OPTIONS: { value: HookSkillOverride; label: string }[] = [
  { value: "inherit", label: "Inherit" },
  { value: "enable", label: "Enable" },
  { value: "disable", label: "Disable" },
];

const TRIGGER_GROUPS: {
  trigger: HookTrigger;
  label: string;
  description: string;
  Icon: typeof ListChecks;
  iconColor: string;
}[] = [
  {
    trigger: "pre-implementation",
    label: "Pre-Implementation",
    description: "Run before agents start",
    Icon: ListChecks,
    iconColor: "text-sky-400",
  },
  {
    trigger: "post-implementation",
    label: "Post-Implementation",
    description: "Run after agents finish",
    Icon: CircleCheck,
    iconColor: "text-emerald-400",
  },
  {
    trigger: "custom",
    label: "Custom",
    description: "Agent decides when to run",
    Icon: MessageSquareText,
    iconColor: "text-violet-400",
  },
  {
    trigger: "on-demand",
    label: "On-Demand",
    description: "Manually triggered",
    Icon: Hand,
    iconColor: "text-amber-400",
  },
  {
    trigger: "worktree-created",
    label: "Worktree Created",
    description: "Runs after create",
    Icon: FolderPlus,
    iconColor: "text-cyan-400",
  },
  {
    trigger: "worktree-removed",
    label: "Worktree Removed",
    description: "Runs after remove",
    Icon: FolderMinus,
    iconColor: "text-rose-400",
  },
];

function HooksPane({
  hooksConfig,
  hookSkills,
  updateHookSkills,
}: {
  hooksConfig?: {
    steps: Array<{
      id: string;
      name: string;
      command: string;
      enabled?: boolean;
      trigger?: HookTrigger;
      condition?: string;
    }>;
    skills: Array<{
      skillName: string;
      enabled: boolean;
      trigger?: HookTrigger;
      condition?: string;
    }>;
  } | null;
  hookSkills?: Record<string, HookSkillOverride>;
  updateHookSkills: (overrides: Record<string, HookSkillOverride>) => void;
}) {
  const steps = hooksConfig?.steps ?? [];
  const skills = hooksConfig?.skills ?? [];

  if (steps.length === 0 && skills.length === 0) {
    return (
      <p className={`text-xs ${text.dimmed} italic py-1`}>
        No hooks configured. Add hooks in the Agents view.
      </p>
    );
  }

  return (
    <div className="space-y-7">
      {TRIGGER_GROUPS.map(({ trigger, label, description, Icon, iconColor }) => {
        const groupSteps = steps.filter((s) => (s.trigger ?? "post-implementation") === trigger);
        const groupSkills = skills.filter((s) => (s.trigger ?? "post-implementation") === trigger);
        if (groupSteps.length === 0 && groupSkills.length === 0) return null;

        return (
          <div key={trigger}>
            <div className="flex items-center gap-1.5 mb-2">
              <Icon className={`w-3.5 h-3.5 ${iconColor}`} />
              <span className={`text-[10px] font-medium ${text.secondary}`}>{label}</span>
              <span className={`text-[9px] ${text.dimmed} ml-1`}>{description}</span>
            </div>

            <div className="space-y-1.5">
              {groupSteps.map((step) => (
                <div key={step.id}>
                  <div className="flex items-center gap-2 py-1">
                    <Terminal className={`w-3 h-3 ${text.dimmed} flex-shrink-0`} />
                    <span className={`text-[10px] ${text.muted} flex-shrink-0`}>{step.name}</span>
                    <code className={`text-[9px] ${text.dimmed} font-mono truncate`}>
                      {step.command}
                    </code>
                  </div>
                  {trigger === "custom" && step.condition && (
                    <p className={`text-[9px] text-violet-400/60 italic ml-5 mt-0.5 truncate`}>
                      {step.condition}
                    </p>
                  )}
                </div>
              ))}

              {groupSkills.map((skill) => {
                const overrideKey = `${trigger}:${skill.skillName}`;
                const value: HookSkillOverride = hookSkills?.[overrideKey] ?? "inherit";
                return (
                  <div key={overrideKey}>
                    <div className="flex items-center gap-5">
                      <span className={`text-[10px] ${text.muted} w-28 truncate`}>
                        {skill.skillName.replace(/^verify-/, "")}
                      </span>
                      <div className="flex gap-0.5 bg-white/[0.04] rounded-md p-0.5">
                        {SKILL_OVERRIDE_OPTIONS.map((opt) => {
                          let selectedStyle = "text-[#4b5563] hover:text-[#6b7280]";
                          if (value === opt.value) {
                            if (opt.value === "enable")
                              selectedStyle = "bg-emerald-500/[0.15] text-emerald-300";
                            else if (opt.value === "disable")
                              selectedStyle = "bg-red-500/[0.15] text-red-300";
                            else selectedStyle = "bg-white/[0.10] text-[#e0e2e5]";
                          }
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => updateHookSkills({ [overrideKey]: opt.value })}
                              className={`px-1.5 py-0.5 text-[9px] font-medium rounded transition-colors ${selectedStyle}`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {trigger === "custom" && skill.condition && (
                      <p className={`text-[9px] text-violet-400/60 italic ml-0.5 mt-0.5 truncate`}>
                        {skill.condition}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Directions pane (inline in the Agent section) ────────────

function DirectionsPane({
  content,
  updateSection,
}: {
  content: string;
  updateSection: (section: "personal" | "aiContext", content: string) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef("");

  const flushSave = useCallback(
    (value: string) => {
      if (value !== lastSaved.current) {
        lastSaved.current = value;
        updateSection("aiContext", value);
      }
    },
    [updateSection],
  );

  const scheduleSave = useCallback(
    (value: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => flushSave(value), 600);
    },
    [flushSave],
  );

  const finishEditing = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    flushSave(draft);
    setEditing(false);
  }, [draft, flushSave]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const autoResize = useCallback((el: HTMLTextAreaElement | null) => {
    textareaRef.current = el;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.max(el.scrollHeight, 80) + "px";
    el.focus();
  }, []);

  const startEdit = () => {
    setDraft(content);
    lastSaved.current = content;
    setEditing(true);
  };

  if (editing) {
    return (
      <div className="px-4 pb-3 pt-2">
        <textarea
          ref={autoResize}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            scheduleSave(e.target.value);
            if (textareaRef.current) {
              textareaRef.current.style.height = "auto";
              textareaRef.current.style.height =
                Math.max(textareaRef.current.scrollHeight, 80) + "px";
            }
          }}
          onBlur={finishEditing}
          onKeyDown={(e) => {
            if (e.key === "Escape") finishEditing();
          }}
          placeholder="Directions for AI agents..."
          className={`w-full bg-transparent text-xs ${text.primary} focus:outline-none resize-none placeholder-[#3b4049] leading-relaxed`}
          style={{ minHeight: 80 }}
        />
      </div>
    );
  }

  return (
    <div
      className="px-4 pb-3 pt-2 cursor-pointer hover:bg-white/[0.01] transition-colors min-h-[80px]"
      onClick={startEdit}
    >
      {content ? (
        <MarkdownContent content={content} />
      ) : (
        <p className={`text-xs ${notesTheme.emptyText} italic`}>
          Click to add directions for AI agents...
        </p>
      )}
    </div>
  );
}

// ─── Selection menu (appears on text selection in personal notes) ───

function SelectionMenu({
  position,
  onCopy,
  onMoveToAiContext,
  onAddTodo,
}: {
  position: { x: number; y: number };
  onCopy: () => void;
  onMoveToAiContext: () => void;
  onAddTodo: () => void;
}) {
  return (
    <div
      className="fixed z-50 flex items-center gap-0.5 px-1 py-0.5 rounded-lg bg-[#1e2028] border border-white/[0.1] shadow-xl shadow-black/40"
      style={{ left: position.x, top: position.y }}
    >
      <Tooltip text="Copy" position="top">
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onCopy();
          }}
          className={`p-1.5 rounded-md ${text.dimmed} hover:${text.primary} hover:bg-white/[0.06] transition-colors`}
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
      <Tooltip text="Move to AI context" position="top">
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onMoveToAiContext();
          }}
          className={`p-1.5 rounded-md ${text.dimmed} hover:text-purple-400 hover:bg-purple-400/[0.08] transition-colors`}
        >
          <Sparkles className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
      <Tooltip text="Add to AI todos" position="top">
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onAddTodo();
          }}
          className={`p-1.5 rounded-md ${text.dimmed} hover:text-teal-400 hover:bg-teal-400/[0.08] transition-colors`}
        >
          <ListChecks className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
    </div>
  );
}

// ─── Personal note pane (standalone card) ──────────────────────

function NotePane({
  content,
  section,
  updateSection,
  onMoveToAiContext,
  onAddTodo,
  placeholder,
  emptyText,
  accentBg,
  accentBorder,
}: {
  content: string;
  section: "personal" | "aiContext";
  updateSection: (section: "personal" | "aiContext", content: string) => Promise<unknown>;
  onMoveToAiContext?: (selectedText: string) => void;
  onAddTodo?: (text: string) => void;
  placeholder: string;
  emptyText: string;
  accentBg: string;
  accentBorder: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef("");
  const [selectionMenu, setSelectionMenu] = useState<{ x: number; y: number; text: string } | null>(
    null,
  );

  const flushSave = useCallback(
    (value: string) => {
      if (value !== lastSaved.current) {
        lastSaved.current = value;
        updateSection(section, value);
      }
    },
    [updateSection, section],
  );

  const scheduleSave = useCallback(
    (value: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => flushSave(value), 600);
    },
    [flushSave],
  );

  const finishEditing = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    flushSave(draft);
    setEditing(false);
  }, [draft, flushSave]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  // Detect text selection inside the note pane
  useEffect(() => {
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !containerRef.current) {
        setSelectionMenu(null);
        return;
      }

      const anchorNode = sel.anchorNode;
      if (!anchorNode || !containerRef.current.contains(anchorNode)) {
        setSelectionMenu(null);
        return;
      }

      const selectedText = sel.toString().trim();
      if (!selectedText) {
        setSelectionMenu(null);
        return;
      }

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setSelectionMenu({
        x: rect.left + rect.width / 2 - 52,
        y: rect.top - 38,
        text: selectedText,
      });
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    setSelectionMenu(null);
  };

  const autoResize = useCallback((el: HTMLTextAreaElement | null) => {
    textareaRef.current = el;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.max(el.scrollHeight, 80) + "px";
    el.focus();
  }, []);

  const startEdit = () => {
    setDraft(content);
    lastSaved.current = content;
    setEditing(true);
  };

  if (editing) {
    return (
      <div ref={containerRef}>
        <textarea
          ref={autoResize}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            scheduleSave(e.target.value);
            if (textareaRef.current) {
              textareaRef.current.style.height = "auto";
              textareaRef.current.style.height =
                Math.max(textareaRef.current.scrollHeight, 80) + "px";
            }
          }}
          onBlur={finishEditing}
          onKeyDown={(e) => {
            if (e.key === "Escape") finishEditing();
          }}
          placeholder={placeholder}
          className={`w-full px-4 py-3 ${accentBg} border ${accentBorder} rounded-lg text-xs ${text.primary} focus:outline-none resize-none placeholder-[#4b5563]`}
          style={{ minHeight: 80 }}
        />

        {selectionMenu && (onMoveToAiContext || onAddTodo) && (
          <SelectionMenu
            position={selectionMenu}
            onCopy={() => {
              navigator.clipboard.writeText(selectionMenu.text);
              clearSelection();
            }}
            onMoveToAiContext={() => {
              onMoveToAiContext?.(selectionMenu.text);
              clearSelection();
            }}
            onAddTodo={() => {
              onAddTodo?.(selectionMenu.text);
              clearSelection();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef}>
      <div
        className={`rounded-lg ${accentBg} border ${accentBorder} px-4 py-3 cursor-pointer hover:border-white/[0.08] transition-colors min-h-[60px]`}
        onClick={() => {
          const sel = window.getSelection();
          if (sel && !sel.isCollapsed) return;
          startEdit();
        }}
      >
        {content ? (
          <MarkdownContent content={content} />
        ) : (
          <p className={`text-xs ${notesTheme.emptyText} italic`}>{emptyText}</p>
        )}
      </div>

      {selectionMenu && (onMoveToAiContext || onAddTodo) && (
        <SelectionMenu
          position={selectionMenu}
          onCopy={() => {
            navigator.clipboard.writeText(selectionMenu.text);
            clearSelection();
          }}
          onMoveToAiContext={() => {
            onMoveToAiContext?.(selectionMenu.text);
            clearSelection();
          }}
          onAddTodo={() => {
            onAddTodo?.(selectionMenu.text);
            clearSelection();
          }}
        />
      )}
    </div>
  );
}
