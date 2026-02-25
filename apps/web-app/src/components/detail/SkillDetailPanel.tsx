import { useState, useRef, useEffect, useCallback } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { DiffEditor } from "@monaco-editor/react";

import { useSkillDetail, useSkillDeploymentStatus } from "../../hooks/useSkills";
import { useApi } from "../../hooks/useApi";
import { useHooksConfig } from "../../hooks/useHooks";
import type { HookTrigger } from "../../hooks/api";
import { border, skill as skillTheme, text } from "../../theme";
import { ConfirmDialog } from "../ConfirmDialog";
import { MarkdownContent } from "../MarkdownContent";
import { Spinner } from "../Spinner";
import { ToggleSwitch } from "../ToggleSwitch";

const AGENTS = [
  { id: "claude", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "gemini", label: "Gemini CLI" },
  { id: "vscode", label: "VS Code" },
  { id: "codex", label: "Codex" },
] as const;

const SCOPES = ["global", "project"] as const;

interface SkillDetailPanelProps {
  skillName: string;
  onDeleted: () => void;
}

export function SkillDetailPanel({ skillName, onDeleted }: SkillDetailPanelProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { status: allDeploymentStatus, refetch: refetchDeployment } = useSkillDeploymentStatus();

  const skillStatus = allDeploymentStatus[skillName] ?? { inRegistry: true, agents: {} };
  const agentDeployments = skillStatus.agents ?? {};

  const { skill, isLoading, error, refetch } = useSkillDetail(skillName);
  const { config: hooksConfig, refetch: refetchHooks } = useHooksConfig();

  const hookSkillRefs = hooksConfig?.skills?.filter((s) => s.skillName === skillName) ?? [];

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [editingRef, setEditingRef] = useState(false);
  const [editingExamples, setEditingExamples] = useState(false);
  const [editingConfig, setEditingConfig] = useState<string | null>(null);
  const [configDraft, setConfigDraft] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deploying, setDeploying] = useState<string | null>(null);
  const [showOriginalDiff, setShowOriginalDiff] = useState(false);

  useEffect(() => {
    setEditingName(false);
    setEditingRef(false);
    setEditingExamples(false);
    setEditingConfig(null);
    setShowOriginalDiff(false);
  }, [skillName]);

  const saveUpdate = useCallback(
    async (updates: Parameters<typeof api.updateSkill>[1]) => {
      await api.updateSkill(skillName, updates);
      refetch();
      queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
    [api, skillName, refetch, queryClient],
  );

  const handleSaveConfig = async (key: string, value: string | boolean) => {
    await saveUpdate({ frontmatter: { [key]: value } });
    setEditingConfig(null);
  };

  const handleDelete = async () => {
    setShowDeleteConfirm(false);
    setDeploying("delete");
    await api.deleteSkill(skillName);
    setDeploying(null);
    queryClient.invalidateQueries({ queryKey: ["skills"] });
    queryClient.invalidateQueries({ queryKey: ["skillDeploymentStatus"] });
    onDeleted();
  };

  const handleDeploy = async (agentId: string, scope: string, isDeployed: boolean) => {
    const key = `${agentId}-${scope}`;
    setDeploying(key);
    if (isDeployed) {
      await api.undeploySkill(skillName, agentId, scope as "global" | "project");
    } else {
      await api.deploySkill(skillName, agentId, scope as "global" | "project");
    }
    setDeploying(null);
    refetchDeployment();
  };

  // Check if deployed to any agent
  const isDeployedAnywhere = Object.values(agentDeployments).some((d) => d.global || d.project);

  // Redirect when source is deleted / not found
  useEffect(() => {
    if (!isLoading && (error || !skill)) onDeleted();
  }, [isLoading, error, skill]);

  if (isLoading || error || !skill) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2">
        <Spinner size="sm" className={text.muted} />
        <p className={`${text.muted} text-sm`}>Loading skill...</p>
      </div>
    );
  }

  const fm = skill.frontmatter;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className={`flex-shrink-0 px-5 py-4 border-b ${border.section}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`text-[11px] font-mono ${skillTheme.accent}`}>{skill.name}</span>
              {fm.mode && (
                <span className={`text-[11px] px-2.5 py-0.5 rounded-full ${skillTheme.badge}`}>
                  mode
                </span>
              )}
              <span className={`text-[11px] px-2.5 py-0.5 rounded-full ${skillTheme.badge}`}>
                {isDeployedAnywhere ? "Deployed" : "Not deployed"}
              </span>
            </div>
            {editingName ? (
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && nameDraft.trim()) {
                    saveUpdate({ frontmatter: { name: nameDraft.trim() } });
                    setEditingName(false);
                  }
                  if (e.key === "Escape") setEditingName(false);
                }}
                onBlur={() => {
                  if (nameDraft.trim() && nameDraft.trim() !== skill.displayName) {
                    saveUpdate({ frontmatter: { name: nameDraft.trim() } });
                  }
                  setEditingName(false);
                }}
                className={`text-[15px] font-semibold ${text.primary} leading-snug px-2 py-1 -mx-2 -my-1 bg-white/[0.04] border border-white/[0.12] rounded-md focus:outline-none w-full`}
              />
            ) : (
              <h2
                className={`text-[15px] font-semibold ${text.primary} leading-snug px-2 py-1 -mx-2 -my-1 rounded-md hover:bg-white/[0.04] cursor-pointer transition-colors`}
                onClick={() => {
                  setNameDraft(skill.displayName);
                  setEditingName(true);
                }}
              >
                {skill.displayName}
              </h2>
            )}
          </div>
          <div className="flex-shrink-0 pt-1 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className={`p-1.5 rounded-lg ${text.muted} hover:text-red-400 hover:bg-red-900/20 transition-colors`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-12">
        {/* Description — auto-save */}
        <AutoSaveTextSection
          key={`desc-${skillName}`}
          title="Description"
          content={fm.description || ""}
          emptyText="Click to add description..."
          rows={3}
          onSave={(v) => saveUpdate({ frontmatter: { description: v } })}
        />

        {/* Deployment Matrix */}
        <section>
          <h3 className={`text-[11px] font-medium ${text.muted} mb-3`}>Deployment</h3>
          <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] overflow-hidden">
            {/* Header row */}
            <div className={`grid grid-cols-[1fr_80px_80px] px-3 py-2 border-b ${border.subtle}`}>
              <span className={`text-[10px] font-medium ${text.dimmed}`}>Agent</span>
              <span className={`text-[10px] font-medium ${text.dimmed} text-center`}>Global</span>
              <span className={`text-[10px] font-medium ${text.dimmed} text-center`}>Project</span>
            </div>

            {/* Agent rows */}
            {AGENTS.map((agent) => {
              const agentStatus = agentDeployments[agent.id] ?? {};
              return (
                <div
                  key={agent.id}
                  className={`grid grid-cols-[1fr_80px_80px] px-3 py-2 border-b last:border-b-0 ${border.subtle} hover:bg-white/[0.02]`}
                >
                  <span className={`text-xs ${text.secondary}`}>{agent.label}</span>
                  {SCOPES.map((scope) => {
                    const isDeployed = !!agentStatus[scope];
                    const isToggling = deploying === `${agent.id}-${scope}`;

                    return (
                      <div key={scope} className="flex justify-center items-center">
                        {isToggling ? (
                          <Spinner size="xs" className={text.dimmed} />
                        ) : (
                          <ToggleSwitch
                            checked={isDeployed}
                            onToggle={() => handleDeploy(agent.id, scope, isDeployed)}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </section>

        {/* Hooks */}
        <section>
          <h3 className={`text-[11px] font-medium ${text.muted} mb-3`}>Hooks</h3>
          <div className="flex items-center gap-1.5">
            {[
              { trigger: "pre-implementation" as const, label: "Pre-Implementation" },
              { trigger: "post-implementation" as const, label: "Post-Implementation" },
              { trigger: "custom" as const, label: "Custom" },
              { trigger: "on-demand" as const, label: "On-Demand" },
            ].map(({ trigger, label }) => {
              const activeRef = hookSkillRefs.find(
                (s) => (s.trigger ?? "post-implementation") === trigger && s.enabled !== false,
              );
              const isActive = !!activeRef;
              return (
                <button
                  key={trigger}
                  type="button"
                  onClick={async () => {
                    if (!hooksConfig) return;
                    const existingTriggers = Array.from(
                      new Set(
                        hookSkillRefs.map(
                          (s) => (s.trigger ?? "post-implementation") as HookTrigger,
                        ),
                      ),
                    );
                    if (isActive) {
                      await api.removeHookSkill(skillName, trigger);
                    } else {
                      for (const existingTrigger of existingTriggers) {
                        await api.removeHookSkill(skillName, existingTrigger);
                      }
                      await api.importHookSkill(skillName, trigger);
                    }
                    refetchHooks();
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors duration-150 ${
                    isActive
                      ? "bg-teal-500/[0.15] text-teal-300"
                      : `bg-white/[0.06] ${text.dimmed} hover:${text.muted}`
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-teal-400" : "bg-white/20"}`}
                  />
                  {label}
                </button>
              );
            })}
          </div>
          {hookSkillRefs.some(
            (s) => s.enabled !== false && (s.trigger ?? "post-implementation") !== "on-demand",
          ) &&
            !isDeployedAnywhere && (
              <p className={`text-[10px] text-amber-400/80 mt-2`}>
                This skill is an automated hook but isn't deployed to any agent. Deploy it above so
                agents can invoke it.
              </p>
            )}
        </section>

        {/* Configuration */}
        <section>
          <h3 className={`text-[11px] font-medium ${text.muted} mb-2`}>Configuration</h3>
          <div className="space-y-2">
            <EditableConfigRow
              label="Allowed Tools"
              configKey="allowedTools"
              value={fm.allowedTools}
              fallback="none"
              editingConfig={editingConfig}
              configDraft={configDraft}
              setEditingConfig={setEditingConfig}
              setConfigDraft={setConfigDraft}
              onSave={handleSaveConfig}
            />
            <EditableConfigRow
              label="Context"
              configKey="context"
              value={fm.context}
              fallback="inline"
              editingConfig={editingConfig}
              configDraft={configDraft}
              setEditingConfig={setEditingConfig}
              setConfigDraft={setConfigDraft}
              onSave={handleSaveConfig}
              options={["inline", "file", "tool", "none"]}
            />
            <EditableConfigRow
              label="Agent"
              configKey="agent"
              value={fm.agent}
              fallback="general-purpose"
              editingConfig={editingConfig}
              configDraft={configDraft}
              setEditingConfig={setEditingConfig}
              setConfigDraft={setConfigDraft}
              onSave={handleSaveConfig}
            />
            <EditableConfigRow
              label="Model"
              configKey="model"
              value={fm.model}
              fallback="inherit"
              editingConfig={editingConfig}
              configDraft={configDraft}
              setEditingConfig={setEditingConfig}
              setConfigDraft={setConfigDraft}
              onSave={handleSaveConfig}
              options={["", "sonnet", "opus", "haiku"]}
            />
            <EditableConfigRow
              label="Argument Hint"
              configKey="argumentHint"
              value={fm.argumentHint}
              editingConfig={editingConfig}
              configDraft={configDraft}
              setEditingConfig={setEditingConfig}
              setConfigDraft={setConfigDraft}
              onSave={handleSaveConfig}
            />
            <ToggleConfigRow
              label="User-invocable"
              value={fm.userInvocable}
              onToggle={(v) => handleSaveConfig("userInvocable", v)}
            />
            <ToggleConfigRow
              label="Model invocation"
              value={!fm.disableModelInvocation}
              onToggle={(v) => handleSaveConfig("disableModelInvocation", !v)}
            />
            <ToggleConfigRow
              label="Mode"
              value={fm.mode}
              onToggle={(v) => handleSaveConfig("mode", v)}
            />
            <div className="flex items-center gap-2 pt-1">
              <span className={`text-[10px] ${text.dimmed} w-28 flex-shrink-0`}>Path</span>
              <span className={`text-[10px] font-mono ${text.dimmed} truncate`}>{skill.path}</span>
            </div>
          </div>
        </section>

        {/* SKILL.md */}
        <AutoSaveFileSection
          key={`md-${skillName}`}
          title="SKILL.md"
          content={skill.skillMd}
          rows={16}
          onSave={(v) => saveUpdate({ skillMd: v })}
          headerActions={
            skill.builtIn && skill.originalSkillMd ? (
              <button
                type="button"
                onClick={() => setShowOriginalDiff((v) => !v)}
                className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  showOriginalDiff
                    ? "bg-teal-500/[0.15] text-teal-300"
                    : `bg-white/[0.06] ${text.dimmed} hover:${text.muted}`
                }`}
              >
                {showOriginalDiff ? "Hide original diff" : "Compare with original"}
              </button>
            ) : null
          }
        />
        {showOriginalDiff && skill.builtIn && skill.originalSkillMd && (
          <section>
            <h3 className={`text-[11px] font-medium ${text.muted} mb-2`}>
              Built-in Original vs Current
            </h3>
            <div className={`rounded-lg overflow-hidden border ${border.subtle} bg-black/20`}>
              <DiffEditor
                original={skill.originalSkillMd}
                modified={skill.skillMd}
                language="markdown"
                height="520px"
                options={{
                  readOnly: true,
                  renderSideBySide: true,
                  minimap: { enabled: false },
                  wordWrap: "on",
                  scrollBeyondLastLine: false,
                }}
              />
            </div>
          </section>
        )}

        {/* reference.md */}
        {skill.hasReference || editingRef ? (
          <AutoSaveFileSection
            key={`ref-${skillName}`}
            title="reference.md"
            content={skill.referenceMd ?? ""}
            rows={12}
            onSave={(v) => saveUpdate({ referenceMd: v })}
            onDelete={async () => {
              await saveUpdate({ referenceMd: "" });
              setEditingRef(false);
            }}
            startEditing={!skill.hasReference}
          />
        ) : (
          <section>
            <h3 className={`text-[11px] font-medium ${text.muted} mb-2`}>reference.md</h3>
            <button
              type="button"
              onClick={() => setEditingRef(true)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] ${text.dimmed} hover:${text.muted} hover:bg-white/[0.04] transition-colors`}
            >
              <Plus className="w-3 h-3" />
              Add reference
            </button>
          </section>
        )}

        {/* examples.md */}
        {skill.hasExamples || editingExamples ? (
          <AutoSaveFileSection
            key={`ex-${skillName}`}
            title="examples.md"
            content={skill.examplesMd ?? ""}
            rows={12}
            onSave={(v) => saveUpdate({ examplesMd: v })}
            onDelete={async () => {
              await saveUpdate({ examplesMd: "" });
              setEditingExamples(false);
            }}
            startEditing={!skill.hasExamples}
          />
        ) : (
          <section>
            <h3 className={`text-[11px] font-medium ${text.muted} mb-2`}>examples.md</h3>
            <button
              type="button"
              onClick={() => setEditingExamples(true)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] ${text.dimmed} hover:${text.muted} hover:bg-white/[0.04] transition-colors`}
            >
              <Plus className="w-3 h-3" />
              Add examples
            </button>
          </section>
        )}
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <ConfirmDialog
          title="Delete skill?"
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        >
          <p className={`text-xs ${text.secondary}`}>
            The skill "{skill.displayName}" will be deleted from the registry and all agent
            deployments will be cleaned up.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

// ─── Helper components ───────────────────────────────────────

function ToggleConfigRow({
  label,
  value,
  onToggle,
}: {
  label: string;
  value: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={`text-[10px] ${text.dimmed} w-28 flex-shrink-0`}>{label}</span>
      <ToggleSwitch checked={value} onToggle={() => onToggle(!value)} />
    </div>
  );
}

function EditableConfigRow({
  label,
  configKey,
  value,
  fallback,
  editingConfig,
  configDraft,
  setEditingConfig,
  setConfigDraft,
  onSave,
  options,
}: {
  label: string;
  configKey: string;
  value?: string;
  fallback?: string;
  editingConfig: string | null;
  configDraft: string;
  setEditingConfig: (k: string | null) => void;
  setConfigDraft: (v: string) => void;
  onSave: (key: string, value: string) => void;
  options?: string[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const isEditing = editingConfig === configKey;
  const hasValue = value && value !== "";

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      if (selectRef.current) {
        selectRef.current.focus();
        try {
          (selectRef.current as HTMLSelectElement & { showPicker?: () => void }).showPicker?.();
        } catch {
          /* unsupported */
        }
      }
    }
  }, [isEditing]);

  if (isEditing && options) {
    return (
      <div className="flex items-center gap-2">
        <span className={`text-[10px] ${text.dimmed} w-28 flex-shrink-0`}>{label}</span>
        <select
          ref={selectRef}
          value={configDraft}
          onChange={(e) => {
            onSave(configKey, e.target.value);
          }}
          onBlur={() => setEditingConfig(null)}
          className={`text-xs font-mono bg-white/[0.04] border border-white/[0.12] rounded px-1.5 py-0.5 ${text.primary} focus:outline-none`}
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt || (fallback ? `(${fallback})` : "—")}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (isEditing) {
    return (
      <div className="flex items-center gap-2">
        <span className={`text-[10px] ${text.dimmed} w-28 flex-shrink-0`}>{label}</span>
        <input
          ref={inputRef}
          value={configDraft}
          onChange={(e) => setConfigDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onSave(configKey, configDraft);
            }
            if (e.key === "Escape") {
              setEditingConfig(null);
            }
          }}
          onBlur={() => onSave(configKey, configDraft)}
          className={`text-xs font-mono bg-white/[0.04] border border-white/[0.12] rounded px-1.5 py-0.5 ${text.primary} focus:outline-none flex-1`}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className={`text-[10px] ${text.dimmed} w-28 flex-shrink-0`}>{label}</span>
      <span
        className={`text-xs font-mono ${hasValue ? text.secondary : text.dimmed} cursor-pointer hover:bg-white/[0.04] px-1.5 py-0.5 -mx-1.5 rounded transition-colors`}
        onClick={() => {
          setConfigDraft(value ?? "");
          setEditingConfig(configKey);
        }}
      >
        {hasValue ? value : (fallback ?? "—")}
      </span>
    </div>
  );
}

// ─── Auto-save text section (description) ────────────────────

function AutoSaveTextSection({
  title,
  content,
  emptyText,
  rows,
  onSave,
}: {
  title: string;
  content: string;
  emptyText: string;
  rows: number;
  onSave: (value: string) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef("");

  const flush = useCallback(
    (v: string) => {
      if (v !== lastSaved.current) {
        lastSaved.current = v;
        onSave(v);
      }
    },
    [onSave],
  );

  const schedule = useCallback(
    (v: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => flush(v), 600);
    },
    [flush],
  );

  const finish = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    flush(draft);
    setEditing(false);
  }, [draft, flush]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <section>
      <h3 className={`text-[11px] font-medium ${text.muted} mb-2`}>{title}</h3>
      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            schedule(e.target.value);
          }}
          onBlur={finish}
          onKeyDown={(e) => {
            if (e.key === "Escape") finish();
          }}
          className={`w-full px-3 py-2 bg-white/[0.02] border border-white/[0.08] rounded-lg text-xs ${text.primary} focus:outline-none resize-none`}
          rows={rows}
          autoFocus
        />
      ) : (
        <div
          className="rounded-lg bg-white/[0.02] border border-white/[0.04] hover:border-white/[0.08] px-3 py-2 cursor-pointer transition-colors"
          onClick={() => {
            setDraft(content);
            lastSaved.current = content;
            setEditing(true);
          }}
        >
          {content ? (
            <MarkdownContent content={content} />
          ) : (
            <p className={`text-xs ${text.dimmed}`}>{emptyText}</p>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Auto-save file section (SKILL.md / reference / examples) ─

function AutoSaveFileSection({
  title,
  content,
  rows,
  onSave,
  onDelete,
  startEditing,
  headerActions,
}: {
  title: string;
  content: string;
  rows: number;
  onSave: (value: string) => Promise<unknown>;
  onDelete?: () => void;
  startEditing?: boolean;
  headerActions?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(!!startEditing);
  const [draft, setDraft] = useState(startEditing ? content : "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(content);

  const flush = useCallback(
    (v: string) => {
      if (v !== lastSaved.current) {
        lastSaved.current = v;
        onSave(v);
      }
    },
    [onSave],
  );

  const schedule = useCallback(
    (v: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => flush(v), 600);
    },
    [flush],
  );

  const finish = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    flush(draft);
    setEditing(false);
  }, [draft, flush]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className={`text-[11px] font-medium ${text.muted}`}>{title}</h3>
        <div className="flex items-center gap-2">
          {headerActions}
          {onDelete && !startEditing && (
            <button
              type="button"
              onClick={onDelete}
              className={`p-0.5 rounded ${text.dimmed} hover:text-red-400 transition-colors`}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            schedule(e.target.value);
          }}
          onBlur={finish}
          onKeyDown={(e) => {
            if (e.key === "Escape") finish();
          }}
          className={`w-full px-3 py-2 bg-white/[0.02] border border-white/[0.08] rounded-lg text-xs font-mono ${text.primary} focus:outline-none resize-none`}
          rows={rows}
          autoFocus
        />
      ) : content ? (
        <div
          className="rounded-lg bg-white/[0.02] border border-white/[0.04] hover:border-white/[0.08] px-3 py-2 max-h-80 overflow-y-auto cursor-pointer transition-colors"
          onClick={() => {
            setDraft(content);
            lastSaved.current = content;
            setEditing(true);
          }}
        >
          <pre className={`text-xs font-mono ${text.secondary} whitespace-pre-wrap`}>{content}</pre>
        </div>
      ) : null}
    </section>
  );
}
