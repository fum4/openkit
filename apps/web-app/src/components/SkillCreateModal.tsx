import { useState } from "react";
import { Download, Sparkles } from "lucide-react";

import { useApi } from "../hooks/useApi";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";
import { skill as skillTheme, input, text } from "../theme";

const AGENTS = [
  { id: "claude", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "gemini", label: "Gemini CLI" },
  { id: "vscode", label: "VS Code" },
  { id: "codex", label: "Codex" },
] as const;

type SkillMode = "create" | "install";
type Step = "choose" | "form";

const MODES: { id: SkillMode; label: string; description: string; icon: typeof Sparkles }[] = [
  {
    id: "create",
    label: "Create Skill",
    description: "Write a new skill from scratch",
    icon: Sparkles,
  },
  {
    id: "install",
    label: "Install Skill",
    description: "Install from a GitHub repo or local path",
    icon: Download,
  },
];

interface SkillCreateModalProps {
  onCreated: (skillName: string) => void;
  onInstalled: (skillNames: string[]) => void;
  onClose: () => void;
}

export function SkillCreateModal({ onCreated, onInstalled, onClose }: SkillCreateModalProps) {
  const api = useApi();
  const [skillMode, setSkillMode] = useState<SkillMode>("create");
  const [step, setStep] = useState<Step>("choose");

  // ── Create form state ──
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [allowedTools, setAllowedTools] = useState("");
  const [context, setContext] = useState("");
  const [agent, setAgent] = useState("");
  const [model, setModel] = useState("");
  const [argumentHint, setArgumentHint] = useState("");
  const [disableModelInvocation, setDisableModelInvocation] = useState(false);
  const [userInvocable, setUserInvocable] = useState(true);
  const [mode, setMode] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [deployAgents, setDeployAgents] = useState<string[]>(["claude"]);
  const [deployScope, setDeployScope] = useState<"global" | "project">("global");

  // ── Install form state ──
  const [repo, setRepo] = useState("");
  const [skillName, setSkillName] = useState("");
  const [installAgents, setInstallAgents] = useState<string[]>(["claude"]);
  const [installScope, setInstallScope] = useState<"global" | "project">("global");
  const [installed, setInstalled] = useState<string[] | null>(null);

  // ── Shared state ──
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const toggleAgent = (agentId: string, list: string[], setter: (v: string[]) => void) => {
    setter(list.includes(agentId) ? list.filter((a) => a !== agentId) : [...list, agentId]);
  };

  // ── Create submit ──
  const handleCreate = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);

    const result = await api.createSkill({
      name: name.trim(),
      description: description.trim() || undefined,
      allowedTools: allowedTools.trim() || undefined,
      context: context.trim() || undefined,
      agent: agent.trim() || undefined,
      model: model.trim() || undefined,
      argumentHint: argumentHint.trim() || undefined,
      disableModelInvocation: disableModelInvocation || undefined,
      userInvocable: userInvocable ? undefined : false,
      mode: mode || undefined,
      instructions: instructions.trim() || undefined,
    });

    if (result.success && result.skill) {
      for (const agentId of deployAgents) {
        await api.deploySkill(result.skill.name, agentId, deployScope);
      }
      setSubmitting(false);
      onCreated(result.skill.name);
      onClose();
    } else if (result.success) {
      setSubmitting(false);
      onCreated(
        name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "-")
          .replace(/-+/g, "-"),
      );
      onClose();
    } else {
      setSubmitting(false);
      setError(result.error ?? "Failed to create skill");
    }
  };

  // ── Install submit ──
  const handleInstall = async () => {
    if (!repo.trim() || installAgents.length === 0) return;
    setSubmitting(true);
    setError(null);

    const result = await api.installSkill({
      repo: repo.trim(),
      skill: skillName.trim() || undefined,
      agents: installAgents,
      scope: installScope,
    });

    setSubmitting(false);

    if (result.success) {
      setInstalled(result.installed ?? []);
      onInstalled(result.installed ?? []);
    } else {
      setError(result.error ?? "Failed to install skill");
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (skillMode === "create") handleCreate();
    else handleInstall();
  };

  const inputClass = `w-full px-2.5 py-1.5 bg-white/[0.04] border border-white/[0.06] rounded-md ${input.text} placeholder-[#4b5563] text-xs focus:outline-none focus:bg-white/[0.06] focus:border-white/[0.15] transition-all duration-150`;

  const canSubmitCreate = name.trim().length > 0;
  const canSubmitInstall = repo.trim().length > 0 && installAgents.length > 0;

  // ── Install success view ──
  if (installed) {
    return (
      <Modal
        title="Skill Installed"
        icon={<Download className="w-4 h-4 text-pink-400" />}
        onClose={onClose}
        width="sm"
        footer={
          <button
            type="button"
            onClick={onClose}
            className={`px-4 py-1.5 text-xs ${skillTheme.button} rounded-lg transition-colors duration-150`}
          >
            Done
          </button>
        }
      >
        <div className="space-y-2">
          {installed.length > 0 ? (
            <>
              <p className={`text-xs ${text.secondary}`}>Successfully installed:</p>
              <ul className="space-y-1">
                {installed.map((n) => (
                  <li key={n} className={`text-xs ${text.primary} flex items-center gap-2`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                    {n}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className={`text-xs ${text.secondary}`}>Installation completed.</p>
          )}
        </div>
      </Modal>
    );
  }

  // ── Footer ──
  const footer =
    step === "choose" ? (
      <>
        <button
          type="button"
          onClick={onClose}
          className={`px-3 py-1.5 text-xs rounded-lg ${text.muted} hover:${text.secondary} transition-colors`}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => setStep("form")}
          className={`px-4 py-1.5 text-xs ${skillTheme.button} rounded-lg transition-colors duration-150`}
        >
          Next
        </button>
      </>
    ) : (
      <>
        <button
          type="button"
          onClick={() => {
            setStep("choose");
            setError(null);
          }}
          className={`px-3 py-1.5 text-xs rounded-lg ${text.muted} hover:${text.secondary} transition-colors`}
        >
          Back
        </button>
        <button
          type="submit"
          disabled={submitting || (skillMode === "create" ? !canSubmitCreate : !canSubmitInstall)}
          className={`px-4 py-1.5 text-xs ${skillTheme.button} rounded-lg disabled:opacity-50 transition-colors duration-150 flex items-center gap-2`}
        >
          {submitting && <Spinner size="xs" />}
          {submitting
            ? skillMode === "create"
              ? "Creating..."
              : "Installing..."
            : skillMode === "create"
              ? "Create Skill"
              : "Install"}
        </button>
      </>
    );

  return (
    <Modal
      title={
        step === "choose" ? "Add Skill" : skillMode === "create" ? "Create Skill" : "Install Skill"
      }
      icon={<Sparkles className="w-4 h-4 text-pink-400" />}
      onClose={onClose}
      onSubmit={step === "form" ? handleSubmit : undefined}
      width="md"
      footer={footer}
    >
      {step === "choose" ? (
        /* ── Mode selection ── */
        <div className="space-y-2">
          {MODES.map((m) => {
            const Icon = m.icon;
            const isActive = skillMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setSkillMode(m.id);
                  setStep("form");
                }}
                className={`w-full text-left flex items-center gap-3 px-3 py-3 rounded-lg border transition-colors ${
                  isActive
                    ? "bg-white/[0.04] border-white/[0.15]"
                    : "bg-transparent border-white/[0.06] hover:border-white/[0.10] hover:bg-white/[0.02]"
                }`}
              >
                <Icon
                  className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-pink-400" : text.muted}`}
                />
                <div>
                  <div
                    className={`text-xs font-medium ${isActive ? text.primary : text.secondary}`}
                  >
                    {m.label}
                  </div>
                  <div className={`text-[10px] ${text.dimmed}`}>{m.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      ) : skillMode === "create" ? (
        /* ── Create form ── */
        <div className="space-y-3">
          <div>
            <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. code-reviewer"
              className={inputClass}
              autoFocus
            />
          </div>

          <div>
            <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>Deploy to</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {AGENTS.map((a) => (
                <label key={a.id} className="flex items-center gap-1.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={deployAgents.includes(a.id)}
                    onChange={() => toggleAgent(a.id, deployAgents, setDeployAgents)}
                    className="accent-teal-400"
                  />
                  <span
                    className={`text-[11px] ${deployAgents.includes(a.id) ? text.secondary : text.dimmed} group-hover:${text.secondary} transition-colors`}
                  >
                    {a.label}
                  </span>
                </label>
              ))}
            </div>
            <div className="flex items-center bg-white/[0.04] rounded-lg p-0.5 w-fit">
              {(["global", "project"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setDeployScope(s)}
                  className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
                    deployScope === s
                      ? "text-[#d1d5db] bg-white/[0.06]"
                      : `${text.dimmed} hover:${text.muted}`
                  }`}
                >
                  {s === "global" ? "Global" : "Project"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this skill do? (used for auto-invocation)"
              className={inputClass}
            />
          </div>

          <div>
            <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>
              Allowed Tools
            </label>
            <input
              type="text"
              value={allowedTools}
              onChange={(e) => setAllowedTools(e.target.value)}
              placeholder="e.g. Read, Grep, Glob, Bash(git:*)"
              className={inputClass}
            />
            <p className={`text-[10px] ${text.dimmed} mt-0.5`}>
              Comma-separated, supports wildcards
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>Context</label>
              <select
                value={context}
                onChange={(e) => setContext(e.target.value)}
                className={inputClass}
              >
                <option value="">inline (default)</option>
                <option value="fork">fork (subagent)</option>
              </select>
            </div>
            <div>
              <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>Agent</label>
              <input
                type="text"
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                placeholder="e.g. Explore, Plan"
                className={inputClass}
                disabled={context !== "fork"}
              />
              <p className={`text-[10px] ${text.dimmed} mt-0.5`}>Subagent type (when fork)</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className={inputClass}
              >
                <option value="">inherit (default)</option>
                <option value="opus">opus</option>
                <option value="sonnet">sonnet</option>
                <option value="haiku">haiku</option>
              </select>
            </div>
            <div>
              <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>
                Argument Hint
              </label>
              <input
                type="text"
                value={argumentHint}
                onChange={(e) => setArgumentHint(e.target.value)}
                placeholder="e.g. [issue-number]"
                className={inputClass}
              />
              <p className={`text-[10px] ${text.dimmed} mt-0.5`}>Shown in autocomplete</p>
            </div>
          </div>

          {/* Boolean toggles */}
          <div className="space-y-2 pt-1">
            <label className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={userInvocable}
                onChange={(e) => setUserInvocable(e.target.checked)}
                className="accent-teal-400"
              />
              <span
                className={`text-xs ${text.secondary} group-hover:${text.primary} transition-colors`}
              >
                User-invocable
              </span>
              <span className={`text-[10px] ${text.dimmed}`}>Show in /slash menu</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={disableModelInvocation}
                onChange={(e) => setDisableModelInvocation(e.target.checked)}
                className="accent-teal-400"
              />
              <span
                className={`text-xs ${text.secondary} group-hover:${text.primary} transition-colors`}
              >
                Disable model invocation
              </span>
              <span className={`text-[10px] ${text.dimmed}`}>Only user can trigger</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={mode}
                onChange={(e) => setMode(e.target.checked)}
                className="accent-teal-400"
              />
              <span
                className={`text-xs ${text.secondary} group-hover:${text.primary} transition-colors`}
              >
                Mode command
              </span>
              <span className={`text-[10px] ${text.dimmed}`}>Modifies Claude's behavior</span>
            </label>
          </div>

          <div>
            <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>
              Instructions
            </label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Markdown instructions for the skill..."
              rows={5}
              className={`${inputClass} resize-none`}
            />
          </div>

          {error && <p className={`${text.error} text-[11px]`}>{error}</p>}
        </div>
      ) : (
        /* ── Install form ── */
        <div className="space-y-3">
          <div>
            <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>
              Repository *
            </label>
            <input
              type="text"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="e.g. vercel-labs/agent-skills or GitHub URL"
              className={inputClass}
              autoFocus
            />
            <p className={`text-[10px] ${text.dimmed} mt-0.5`}>
              GitHub repo, full URL, or local path
            </p>
          </div>

          <div>
            <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>Skill name</label>
            <input
              type="text"
              value={skillName}
              onChange={(e) => setSkillName(e.target.value)}
              placeholder="all skills if empty"
              className={inputClass}
            />
            <p className={`text-[10px] ${text.dimmed} mt-0.5`}>
              Target a specific skill with -s flag
            </p>
          </div>

          <div>
            <label className={`block text-[11px] font-medium ${text.muted} mb-1`}>Deploy to</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {AGENTS.map((a) => (
                <label key={a.id} className="flex items-center gap-1.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={installAgents.includes(a.id)}
                    onChange={() => toggleAgent(a.id, installAgents, setInstallAgents)}
                    className="accent-teal-400"
                  />
                  <span
                    className={`text-[11px] ${installAgents.includes(a.id) ? text.secondary : text.dimmed} group-hover:${text.secondary} transition-colors`}
                  >
                    {a.label}
                  </span>
                </label>
              ))}
            </div>
            <div className="flex items-center bg-white/[0.04] rounded-lg p-0.5 w-fit">
              {(["global", "project"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setInstallScope(s)}
                  className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
                    installScope === s
                      ? "text-[#d1d5db] bg-white/[0.06]"
                      : `${text.dimmed} hover:${text.muted}`
                  }`}
                >
                  {s === "global" ? "Global" : "Project"}
                </button>
              ))}
            </div>
          </div>

          {error && <p className={`${text.error} text-[11px]`}>{error}</p>}
        </div>
      )}
    </Modal>
  );
}
