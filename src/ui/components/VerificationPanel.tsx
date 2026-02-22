import {
  CircleCheck,
  FishingHook,
  FolderMinus,
  FolderPlus,
  Hand,
  ListChecks,
  MessageSquareText,
  Pencil,
  Plus,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { HookSkillRef, HookStep, HookTrigger } from "../hooks/api";
import { useApi } from "../hooks/useApi";
import { useHooksConfig } from "../hooks/useHooks";
import { infoBanner, settings, text } from "../theme";
import { ToggleSwitch } from "./ToggleSwitch";

const BANNER_DISMISSED_KEY = "OpenKit:hooksBannerDismissed";

export function HooksPanel() {
  const { config, saveConfig, refetch } = useHooksConfig();
  const api = useApi();
  const [addingStep, setAddingStep] = useState<HookTrigger | null>(null);
  const [addingPrompt, setAddingPrompt] = useState<HookTrigger | null>(null);
  const [newName, setNewName] = useState("");
  const [newCommand, setNewCommand] = useState("");
  const [newPromptName, setNewPromptName] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [showImportPicker, setShowImportPicker] = useState<HookTrigger | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const [bannerDismissed, setBannerDismissed] = useState(
    () => localStorage.getItem(BANNER_DISMISSED_KEY) === "1",
  );
  const dismissBanner = () => {
    setBannerDismissed(true);
    localStorage.setItem(BANNER_DISMISSED_KEY, "1");
  };

  if (!config)
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-5 h-5 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );

  const addStep = (trigger: HookTrigger) => {
    const name = newName.trim();
    const command = newCommand.trim();
    if (!name || !command) return;

    const id = `step-${Date.now()}`;
    const step: HookStep = { id, name, command, kind: "command", enabled: true, trigger };
    saveConfig({ ...config, steps: [...config.steps, step] });
    setNewName("");
    setNewCommand("");
    setAddingStep(null);
  };

  const addPrompt = (trigger: HookTrigger) => {
    const name = newPromptName.trim();
    const prompt = newPrompt.trim();
    if (!name || !prompt) return;

    const id = `step-${Date.now()}`;
    const step: HookStep = {
      id,
      name,
      command: "",
      kind: "prompt",
      prompt,
      enabled: true,
      trigger,
    };
    saveConfig({ ...config, steps: [...config.steps, step] });
    setNewPromptName("");
    setNewPrompt("");
    setAddingPrompt(null);
  };

  const addCustomStep = (
    name: string,
    command: string,
    condition: string,
    conditionTitle?: string,
  ) => {
    const id = `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const step: HookStep = {
      id,
      name,
      command,
      kind: "command",
      enabled: true,
      trigger: "custom",
      condition,
      conditionTitle,
    };
    saveConfig({ ...config, steps: [...config.steps, step] });
  };

  const addCustomPrompt = (
    name: string,
    prompt: string,
    condition: string,
    conditionTitle?: string,
  ) => {
    const id = `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const step: HookStep = {
      id,
      name,
      command: "",
      kind: "prompt",
      prompt,
      enabled: true,
      trigger: "custom",
      condition,
      conditionTitle,
    };
    saveConfig({ ...config, steps: [...config.steps, step] });
  };

  const removeStep = (stepId: string) => {
    saveConfig({ ...config, steps: config.steps.filter((s) => s.id !== stepId) });
  };

  const updateStep = (
    stepId: string,
    updates: Partial<Pick<HookStep, "name" | "command" | "prompt" | "enabled" | "condition">>,
  ) => {
    saveConfig({
      ...config,
      steps: config.steps.map((s) => (s.id === stepId ? { ...s, ...updates } : s)),
    });
  };

  const handleToggleSkill = async (skillName: string, enabled: boolean, trigger?: HookTrigger) => {
    await api.toggleHookSkill(skillName, enabled, trigger);
    refetch();
  };

  const handleRemoveSkill = async (skillName: string, trigger?: HookTrigger) => {
    await api.removeHookSkill(skillName, trigger);
    refetch();
  };

  const updateSkillCondition = (
    skillName: string,
    trigger: HookTrigger | undefined,
    condition: string,
  ) => {
    saveConfig({
      ...config,
      skills: config.skills.map((s) =>
        s.skillName === skillName &&
        (s.trigger ?? "post-implementation") === (trigger ?? "post-implementation")
          ? { ...s, condition }
          : s,
      ),
    });
  };

  const handleImportSkill = async (skillName: string, trigger: HookTrigger, condition?: string) => {
    await api.importHookSkill(skillName, trigger, condition);
    refetch();
    setShowImportPicker(null);
  };

  const handleImportCustomSkill = async (
    skillName: string,
    condition: string,
    conditionTitle?: string,
  ) => {
    await api.importHookSkill(skillName, "custom", condition, conditionTitle);
    refetch();
  };

  const removeCustomGroup = (condition: string) => {
    saveConfig({
      ...config,
      steps: config.steps.filter(
        (s) => !(s.trigger === "custom" && (s.condition ?? "") === condition),
      ),
      skills: config.skills.filter(
        (s) => !(s.trigger === "custom" && (s.condition ?? "") === condition),
      ),
    });
  };

  const updateCustomGroup = (oldCondition: string, newCondition: string, newTitle?: string) => {
    const updatedSteps = config.steps.map((s) =>
      s.trigger === "custom" && (s.condition ?? "") === oldCondition
        ? { ...s, condition: newCondition, conditionTitle: newTitle || undefined }
        : s,
    );
    const updatedSkills = config.skills.map((s) =>
      s.trigger === "custom" && (s.condition ?? "") === oldCondition
        ? { ...s, condition: newCondition, conditionTitle: newTitle || undefined }
        : s,
    );
    saveConfig({ ...config, steps: updatedSteps, skills: updatedSkills });
  };

  // Split items by trigger
  const preSteps = config.steps.filter((s) => s.trigger === "pre-implementation");
  const postSteps = config.steps.filter((s) => s.trigger === "post-implementation" || !s.trigger);
  const onDemandSteps = config.steps.filter((s) => s.trigger === "on-demand");
  const worktreeCreatedSteps = config.steps.filter((s) => s.trigger === "worktree-created");
  const worktreeRemovedSteps = config.steps.filter((s) => s.trigger === "worktree-removed");
  const customSteps = config.steps.filter((s) => s.trigger === "custom");
  const preSkills = config.skills.filter((s) => s.trigger === "pre-implementation");
  const postSkills = config.skills.filter((s) => s.trigger === "post-implementation" || !s.trigger);
  const onDemandSkills = config.skills.filter((s) => s.trigger === "on-demand");
  const customSkills = config.skills.filter((s) => s.trigger === "custom");

  const hasPreItems = preSteps.length > 0 || preSkills.length > 0;
  const hasPostItems = postSteps.length > 0 || postSkills.length > 0;
  const hasOnDemandItems = onDemandSteps.length > 0 || onDemandSkills.length > 0;
  const hasWorktreeCreatedItems = worktreeCreatedSteps.length > 0;
  const hasWorktreeRemovedItems = worktreeRemovedSteps.length > 0;

  return (
    <div className="max-w-2xl mx-auto p-6 flex flex-col gap-12">
      {/* Dismissible info banner */}
      {!bannerDismissed && (
        <div
          className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${infoBanner.border} ${infoBanner.bg}`}
        >
          <FishingHook className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
          <p className={`text-[11px] ${text.secondary} leading-relaxed flex-1`}>
            Hooks are automated checks and skills that validate your work, running at predefined
            points in your workflow to ensure quality, consistency, and compliance throughout each
            stage of the process.
          </p>
          <button
            type="button"
            onClick={dismissBanner}
            className="p-1 rounded-md hover:bg-emerald-400/10 text-emerald-400/40 hover:text-emerald-400/70 transition-colors flex-shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Pre-Implementation section */}
      <HooksSection
        title="Pre-Implementation"
        description="Run before agents start working on a task"
        icon={<ListChecks className="w-3.5 h-3.5 text-sky-400" />}
        steps={preSteps}
        skills={preSkills}
        hasItems={hasPreItems}
        addingStep={addingStep === "pre-implementation"}
        onStartAdding={() => {
          setAddingPrompt(null);
          setShowImportPicker(null);
          setAddingStep("pre-implementation");
        }}
        onCancelAdding={() => {
          setAddingStep(null);
          setNewName("");
          setNewCommand("");
        }}
        onAddStep={() => addStep("pre-implementation")}
        addingPrompt={addingPrompt === "pre-implementation"}
        onStartAddingPrompt={() => {
          setAddingStep(null);
          setShowImportPicker(null);
          setAddingPrompt("pre-implementation");
        }}
        onCancelAddingPrompt={() => {
          setAddingPrompt(null);
          setNewPromptName("");
          setNewPrompt("");
        }}
        onAddPrompt={() => addPrompt("pre-implementation")}
        onShowImportPicker={() => {
          setAddingStep(null);
          setAddingPrompt(null);
          setNewName("");
          setNewCommand("");
          setShowImportPicker("pre-implementation");
        }}
        showImportPicker={showImportPicker === "pre-implementation"}
        onImportSkill={(name) => handleImportSkill(name, "pre-implementation")}
        onCloseImportPicker={() => setShowImportPicker(null)}
        newName={newName}
        setNewName={setNewName}
        newCommand={newCommand}
        setNewCommand={setNewCommand}
        newPromptName={newPromptName}
        setNewPromptName={setNewPromptName}
        newPrompt={newPrompt}
        setNewPrompt={setNewPrompt}
        nameRef={nameRef}
        updateStep={updateStep}
        removeStep={removeStep}
        handleToggleSkill={handleToggleSkill}
        handleRemoveSkill={handleRemoveSkill}
        updateSkillCondition={updateSkillCondition}
        allowPrompts
      />

      {/* Post-Implementation section */}
      <HooksSection
        title="Post-Implementation"
        description="Run after agents finish implementing a task"
        icon={<CircleCheck className="w-3.5 h-3.5 text-emerald-400" />}
        steps={postSteps}
        skills={postSkills}
        hasItems={hasPostItems}
        addingStep={addingStep === "post-implementation"}
        onStartAdding={() => {
          setAddingPrompt(null);
          setShowImportPicker(null);
          setAddingStep("post-implementation");
        }}
        onCancelAdding={() => {
          setAddingStep(null);
          setNewName("");
          setNewCommand("");
        }}
        onAddStep={() => addStep("post-implementation")}
        addingPrompt={addingPrompt === "post-implementation"}
        onStartAddingPrompt={() => {
          setAddingStep(null);
          setShowImportPicker(null);
          setAddingPrompt("post-implementation");
        }}
        onCancelAddingPrompt={() => {
          setAddingPrompt(null);
          setNewPromptName("");
          setNewPrompt("");
        }}
        onAddPrompt={() => addPrompt("post-implementation")}
        onShowImportPicker={() => {
          setAddingStep(null);
          setAddingPrompt(null);
          setNewName("");
          setNewCommand("");
          setShowImportPicker("post-implementation");
        }}
        showImportPicker={showImportPicker === "post-implementation"}
        onImportSkill={(name) => handleImportSkill(name, "post-implementation")}
        onCloseImportPicker={() => setShowImportPicker(null)}
        newName={newName}
        setNewName={setNewName}
        newCommand={newCommand}
        setNewCommand={setNewCommand}
        newPromptName={newPromptName}
        setNewPromptName={setNewPromptName}
        newPrompt={newPrompt}
        setNewPrompt={setNewPrompt}
        nameRef={nameRef}
        updateStep={updateStep}
        removeStep={removeStep}
        handleToggleSkill={handleToggleSkill}
        handleRemoveSkill={handleRemoveSkill}
        updateSkillCondition={updateSkillCondition}
        allowPrompts
      />

      {/* Custom section */}
      <CustomHooksSection
        steps={customSteps}
        skills={customSkills}
        onAddStep={addCustomStep}
        onAddPrompt={addCustomPrompt}
        onUpdateStep={updateStep}
        onRemoveStep={removeStep}
        onImportSkill={handleImportCustomSkill}
        onToggleSkill={(name, enabled) => handleToggleSkill(name, enabled, "custom")}
        onRemoveSkill={(name) => handleRemoveSkill(name, "custom")}
        onRemoveGroup={removeCustomGroup}
        onUpdateGroup={updateCustomGroup}
      />

      {/* On-Demand section */}
      <HooksSection
        title="On-Demand"
        description="Manually triggered from the worktree view"
        icon={<Hand className="w-3.5 h-3.5 text-amber-400" />}
        steps={onDemandSteps}
        skills={onDemandSkills}
        hasItems={hasOnDemandItems}
        addingStep={addingStep === "on-demand"}
        onStartAdding={() => {
          setAddingPrompt(null);
          setShowImportPicker(null);
          setAddingStep("on-demand");
        }}
        onCancelAdding={() => {
          setAddingStep(null);
          setNewName("");
          setNewCommand("");
        }}
        onAddStep={() => addStep("on-demand")}
        addingPrompt={false}
        onStartAddingPrompt={() => {}}
        onCancelAddingPrompt={() => {}}
        onAddPrompt={() => {}}
        onShowImportPicker={() => {
          setAddingStep(null);
          setAddingPrompt(null);
          setNewName("");
          setNewCommand("");
          setShowImportPicker("on-demand");
        }}
        showImportPicker={showImportPicker === "on-demand"}
        onImportSkill={(name) => handleImportSkill(name, "on-demand")}
        onCloseImportPicker={() => setShowImportPicker(null)}
        newName={newName}
        setNewName={setNewName}
        newCommand={newCommand}
        setNewCommand={setNewCommand}
        newPromptName={newPromptName}
        setNewPromptName={setNewPromptName}
        newPrompt={newPrompt}
        setNewPrompt={setNewPrompt}
        nameRef={nameRef}
        updateStep={updateStep}
        removeStep={removeStep}
        handleToggleSkill={handleToggleSkill}
        handleRemoveSkill={handleRemoveSkill}
        updateSkillCondition={updateSkillCondition}
        allowPrompts={false}
      />

      {/* Worktree Created section */}
      <HooksSection
        title="Worktree Created"
        description="Run automatically when a worktree is created"
        icon={<FolderPlus className="w-3.5 h-3.5 text-cyan-400" />}
        steps={worktreeCreatedSteps}
        skills={[]}
        hasItems={hasWorktreeCreatedItems}
        addingStep={addingStep === "worktree-created"}
        onStartAdding={() => {
          setAddingPrompt(null);
          setShowImportPicker(null);
          setAddingStep("worktree-created");
        }}
        onCancelAdding={() => {
          setAddingStep(null);
          setNewName("");
          setNewCommand("");
        }}
        onAddStep={() => addStep("worktree-created")}
        addingPrompt={false}
        onStartAddingPrompt={() => {}}
        onCancelAddingPrompt={() => {}}
        onAddPrompt={() => {}}
        onShowImportPicker={() => {}}
        showImportPicker={false}
        onImportSkill={() => {}}
        onCloseImportPicker={() => {}}
        newName={newName}
        setNewName={setNewName}
        newCommand={newCommand}
        setNewCommand={setNewCommand}
        newPromptName={newPromptName}
        setNewPromptName={setNewPromptName}
        newPrompt={newPrompt}
        setNewPrompt={setNewPrompt}
        nameRef={nameRef}
        updateStep={updateStep}
        removeStep={removeStep}
        handleToggleSkill={handleToggleSkill}
        handleRemoveSkill={handleRemoveSkill}
        updateSkillCondition={updateSkillCondition}
        allowPrompts={false}
        allowSkills={false}
      />

      {/* Worktree Removed section */}
      <HooksSection
        title="Worktree Removed"
        description="Run automatically when a worktree is removed"
        icon={<FolderMinus className="w-3.5 h-3.5 text-rose-400" />}
        steps={worktreeRemovedSteps}
        skills={[]}
        hasItems={hasWorktreeRemovedItems}
        addingStep={addingStep === "worktree-removed"}
        onStartAdding={() => {
          setAddingPrompt(null);
          setShowImportPicker(null);
          setAddingStep("worktree-removed");
        }}
        onCancelAdding={() => {
          setAddingStep(null);
          setNewName("");
          setNewCommand("");
        }}
        onAddStep={() => addStep("worktree-removed")}
        addingPrompt={false}
        onStartAddingPrompt={() => {}}
        onCancelAddingPrompt={() => {}}
        onAddPrompt={() => {}}
        onShowImportPicker={() => {}}
        showImportPicker={false}
        onImportSkill={() => {}}
        onCloseImportPicker={() => {}}
        newName={newName}
        setNewName={setNewName}
        newCommand={newCommand}
        setNewCommand={setNewCommand}
        newPromptName={newPromptName}
        setNewPromptName={setNewPromptName}
        newPrompt={newPrompt}
        setNewPrompt={setNewPrompt}
        nameRef={nameRef}
        updateStep={updateStep}
        removeStep={removeStep}
        handleToggleSkill={handleToggleSkill}
        handleRemoveSkill={handleRemoveSkill}
        updateSkillCondition={updateSkillCondition}
        allowPrompts={false}
        allowSkills={false}
      />
    </div>
  );
}

function HooksSection({
  title,
  description,
  icon,
  steps,
  skills,
  hasItems,
  addingStep,
  addingPrompt,
  onStartAdding,
  onCancelAdding,
  onAddStep,
  onStartAddingPrompt,
  onCancelAddingPrompt,
  onAddPrompt,
  onShowImportPicker,
  showImportPicker,
  onImportSkill,
  onCloseImportPicker,
  newName,
  setNewName,
  newCommand,
  setNewCommand,
  newPromptName,
  setNewPromptName,
  newPrompt,
  setNewPrompt,
  nameRef,
  updateStep,
  removeStep,
  handleToggleSkill,
  handleRemoveSkill,
  updateSkillCondition,
  allowPrompts,
  allowSkills,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  steps: HookStep[];
  skills: HookSkillRef[];
  hasItems: boolean;
  addingStep: boolean;
  addingPrompt: boolean;
  onStartAdding: () => void;
  onCancelAdding: () => void;
  onAddStep: () => void;
  onStartAddingPrompt: () => void;
  onCancelAddingPrompt: () => void;
  onAddPrompt: () => void;
  onShowImportPicker: () => void;
  showImportPicker: boolean;
  onImportSkill: (name: string) => void;
  onCloseImportPicker: () => void;
  newName: string;
  setNewName: (v: string) => void;
  newCommand: string;
  setNewCommand: (v: string) => void;
  newPromptName: string;
  setNewPromptName: (v: string) => void;
  newPrompt: string;
  setNewPrompt: (v: string) => void;
  nameRef: React.RefObject<HTMLInputElement | null>;
  updateStep: (
    stepId: string,
    updates: Partial<Pick<HookStep, "name" | "command" | "prompt" | "enabled" | "condition">>,
  ) => void;
  removeStep: (stepId: string) => void;
  handleToggleSkill: (skillName: string, enabled: boolean, trigger?: HookTrigger) => void;
  handleRemoveSkill: (skillName: string, trigger?: HookTrigger) => void;
  updateSkillCondition: (
    skillName: string,
    trigger: HookTrigger | undefined,
    condition: string,
  ) => void;
  allowPrompts?: boolean;
  allowSkills?: boolean;
}) {
  const skillsEnabled = allowSkills !== false;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className={`text-xs font-semibold ${text.primary} uppercase tracking-wider`}>
          {title}
        </h3>
        <span className={`text-[10px] ${text.dimmed} ml-1`}>{description}</span>
      </div>
      <div className="space-y-2">
        {!hasItems && !addingStep && (
          <div className="text-center py-6">
            <p className={`text-xs ${text.muted}`}>
              No {title.toLowerCase()} hooks configured yet.
            </p>
          </div>
        )}

        {/* Command cards */}
        {steps.map((step) => (
          <StepCard
            key={step.id}
            step={step}
            onUpdate={(updates) => updateStep(step.id, updates)}
            onToggle={(enabled) => updateStep(step.id, { enabled })}
            onRemove={() => removeStep(step.id)}
          />
        ))}

        {/* Skill cards */}
        {skillsEnabled &&
          skills.map((skill) => (
            <SkillCard
              key={`${skill.skillName}-${skill.trigger ?? "post-implementation"}`}
              skill={skill}
              onToggle={(enabled) => handleToggleSkill(skill.skillName, enabled, skill.trigger)}
              onRemove={() => handleRemoveSkill(skill.skillName, skill.trigger)}
              onUpdateCondition={(condition) =>
                updateSkillCondition(skill.skillName, skill.trigger, condition)
              }
            />
          ))}

        {/* Add step form */}
        {addingStep && (
          <div className={`rounded-xl border border-white/[0.06] ${settings.card} p-4 space-y-3`}>
            <div className="flex items-center justify-between mb-3">
              <span className={`text-xs font-medium ${text.primary}`}>Add command</span>
              <button onClick={onCancelAdding} className={`p-1 ${text.dimmed} hover:text-white`}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <input
              ref={nameRef}
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name (e.g. Type check)"
              className={`w-full px-3 py-2 rounded-lg text-xs bg-white/[0.04] border border-white/[0.06] text-white placeholder-[#4b5563] focus:outline-none focus:border-white/[0.15]`}
            />
            <input
              value={newCommand}
              onChange={(e) => setNewCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onAddStep();
                if (e.key === "Escape") onCancelAdding();
              }}
              placeholder="Command (e.g. pnpm check-types)"
              className={`w-full px-3 py-2 rounded-lg text-xs bg-white/[0.04] border border-white/[0.06] text-white placeholder-[#4b5563] focus:outline-none focus:border-white/[0.15] font-mono`}
            />
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={onCancelAdding}
                className={`px-3 py-1.5 text-[11px] font-medium ${text.muted} hover:text-[#9ca3af] rounded-lg transition-colors`}
              >
                Cancel
              </button>
              <button
                onClick={onAddStep}
                disabled={!newName.trim() || !newCommand.trim()}
                className="px-3 py-1.5 text-[11px] font-medium text-emerald-400 bg-emerald-400/10 hover:bg-emerald-400/20 rounded-lg transition-colors disabled:opacity-40"
              >
                Add command
              </button>
            </div>
          </div>
        )}

        {/* Add prompt form */}
        {addingPrompt && (
          <div className={`rounded-xl border border-white/[0.06] ${settings.card} p-4 space-y-3`}>
            <div className="flex items-center justify-between mb-3">
              <span className={`text-xs font-medium ${text.primary}`}>Add prompt</span>
              <button
                onClick={onCancelAddingPrompt}
                className={`p-1 ${text.dimmed} hover:text-white`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <input
              value={newPromptName}
              onChange={(e) => setNewPromptName(e.target.value)}
              placeholder="Title (e.g. Architecture check)"
              className={`w-full px-3 py-2 rounded-lg text-xs bg-white/[0.04] border border-white/[0.06] text-white placeholder-[#4b5563] focus:outline-none focus:border-white/[0.15]`}
            />
            <textarea
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              rows={3}
              placeholder="Description (what should the agent do?)"
              className={`w-full px-3 py-2 rounded-lg text-xs bg-white/[0.04] border border-white/[0.06] text-white placeholder-[#4b5563] focus:outline-none focus:border-white/[0.15] resize-none`}
            />
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={onCancelAddingPrompt}
                className={`px-3 py-1.5 text-[11px] font-medium ${text.muted} hover:text-[#9ca3af] rounded-lg transition-colors`}
              >
                Cancel
              </button>
              <button
                onClick={onAddPrompt}
                disabled={!newPromptName.trim() || !newPrompt.trim()}
                className="px-3 py-1.5 text-[11px] font-medium text-teal-300 bg-teal-400/10 hover:bg-teal-400/20 rounded-lg transition-colors disabled:opacity-40"
              >
                Add prompt
              </button>
            </div>
          </div>
        )}

        {/* Import skill picker */}
        {skillsEnabled && showImportPicker && (
          <ImportSkillPicker onImport={onImportSkill} onClose={onCloseImportPicker} />
        )}

        {/* Action buttons — only show when neither form is open */}
        {!addingStep && !addingPrompt && !showImportPicker && (
          <div className="flex flex-col gap-2 pt-1">
            <button
              onClick={onStartAdding}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium ${text.muted} hover:text-[#9ca3af] border border-dashed border-white/[0.08] hover:border-white/[0.15] rounded-lg transition-colors`}
            >
              <Plus className="w-3.5 h-3.5" />
              Add command
            </button>
            {skillsEnabled && (
              <button
                onClick={onShowImportPicker}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium ${text.muted} hover:text-[#9ca3af] border border-dashed border-white/[0.08] hover:border-white/[0.15] rounded-lg transition-colors`}
              >
                <Plus className="w-3.5 h-3.5" />
                Add skill
              </button>
            )}
            {allowPrompts && (
              <button
                onClick={onStartAddingPrompt}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium ${text.muted} hover:text-[#9ca3af] border border-dashed border-white/[0.08] hover:border-white/[0.15] rounded-lg transition-colors`}
              >
                <Plus className="w-3.5 h-3.5" />
                Add prompt
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StepCard({
  step,
  onUpdate,
  onToggle,
  onRemove,
}: {
  step: HookStep;
  onUpdate: (updates: Partial<Pick<HookStep, "name" | "command" | "prompt" | "condition">>) => void;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(step.name);
  const [editCommand, setEditCommand] = useState(step.command);
  const [editPrompt, setEditPrompt] = useState(step.prompt ?? "");
  const [editCondition, setEditCondition] = useState(step.condition ?? "");
  const enabled = step.enabled !== false;
  const isCustom = step.trigger === "custom";
  const isPrompt = step.kind === "prompt" || (!!step.prompt && !step.command?.trim());

  const save = () => {
    const name = editName.trim();
    const command = editCommand.trim();
    const prompt = editPrompt.trim();
    if (name && (isPrompt ? prompt : command)) {
      const updates: Partial<Pick<HookStep, "name" | "command" | "prompt" | "condition">> = {};
      updates.name = name;
      if (isPrompt) updates.prompt = prompt;
      else updates.command = command;
      if (isCustom) updates.condition = editCondition.trim();
      onUpdate(updates);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <div className={`rounded-xl border border-white/[0.06] ${settings.card} p-4 space-y-3`}>
        <input
          autoFocus
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          className={`w-full px-3 py-2 rounded-lg text-xs bg-white/[0.04] border border-white/[0.06] text-white focus:outline-none focus:border-white/[0.15]`}
        />
        <input
          value={editCommand}
          onChange={(e) => setEditCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isCustom && !isPrompt) save();
            if (e.key === "Escape") setEditing(false);
          }}
          className={`w-full px-3 py-2 rounded-lg text-xs bg-white/[0.04] border border-white/[0.06] text-white focus:outline-none focus:border-white/[0.15] font-mono ${isPrompt ? "hidden" : ""}`}
        />
        {isPrompt && (
          <textarea
            value={editPrompt}
            onChange={(e) => setEditPrompt(e.target.value)}
            rows={3}
            placeholder="Prompt text"
            className={`w-full px-3 py-2 rounded-lg text-xs bg-white/[0.04] border border-white/[0.06] text-white focus:outline-none focus:border-white/[0.15] resize-none`}
          />
        )}
        {isCustom && (
          <textarea
            value={editCondition}
            onChange={(e) => setEditCondition(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
            }}
            placeholder="When should agents run this?"
            rows={2}
            className={`w-full px-3 py-2 rounded-lg text-xs bg-white/[0.04] border border-white/[0.06] text-white placeholder-[#4b5563] focus:outline-none focus:border-white/[0.15] resize-none`}
          />
        )}
        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={() => setEditing(false)}
            className={`px-3 py-1.5 text-[11px] font-medium ${text.muted} hover:text-[#9ca3af] rounded-lg transition-colors`}
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="px-3 py-1.5 text-[11px] font-medium text-emerald-400 bg-emerald-400/10 hover:bg-emerald-400/20 rounded-lg transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-white/[0.06] ${settings.card} group`}>
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
        onClick={() => {
          setEditName(step.name);
          setEditCommand(step.command);
          setEditPrompt(step.prompt ?? "");
          setEditCondition(step.condition ?? "");
          setEditing(true);
        }}
      >
        {isPrompt ? (
          <MessageSquareText
            className={`w-3.5 h-3.5 flex-shrink-0 ${enabled ? "text-violet-400/70" : text.dimmed}`}
          />
        ) : (
          <Terminal className={`w-3.5 h-3.5 flex-shrink-0 ${enabled ? text.muted : text.dimmed}`} />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${enabled ? text.primary : text.dimmed}`}>
              {step.name}
            </span>
          </div>
          <p
            className={`text-[11px] ${text.dimmed} mt-0.5 ${isPrompt ? "" : "font-mono"} truncate`}
          >
            {isPrompt ? step.prompt : step.command}
          </p>
          {isCustom && step.condition && (
            <p className={`text-[10px] text-violet-400/70 mt-1 italic truncate`}>
              {step.condition}
            </p>
          )}
        </div>

        {/* Toggle */}
        <ToggleSwitch
          checked={enabled}
          onToggle={(e) => {
            e.stopPropagation();
            onToggle(!enabled);
          }}
        />

        {/* Remove */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className={`-mr-1 p-1 rounded ${text.dimmed} hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function SkillCard({
  skill,
  onToggle,
  onRemove,
  onUpdateCondition,
}: {
  skill: HookSkillRef;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
  onUpdateCondition: (condition: string) => void;
}) {
  const isPredefined = skill.skillName.startsWith("verify-");
  const isCustom = skill.trigger === "custom";
  const [editingCondition, setEditingCondition] = useState(false);
  const [conditionDraft, setConditionDraft] = useState("");
  const conditionRef = useRef<HTMLTextAreaElement>(null);

  const startEditCondition = () => {
    setConditionDraft(skill.condition ?? "");
    setEditingCondition(true);
    setTimeout(() => conditionRef.current?.focus(), 0);
  };

  const finishEditCondition = () => {
    const trimmed = conditionDraft.trim();
    if (trimmed && trimmed !== (skill.condition ?? "")) {
      onUpdateCondition(trimmed);
    }
    setEditingCondition(false);
  };

  return (
    <div className={`rounded-xl border border-white/[0.06] ${settings.card} group`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <Sparkles
          className={`w-3.5 h-3.5 flex-shrink-0 ${skill.enabled ? "text-pink-400/70" : text.dimmed}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${skill.enabled ? text.primary : text.dimmed}`}>
              {skill.skillName}
            </span>
            {isPredefined && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-400/10 text-emerald-400">
                built-in
              </span>
            )}
          </div>
          <p className={`text-[11px] ${text.dimmed} mt-0.5 font-mono`}>/{skill.skillName}</p>
          {isCustom &&
            (editingCondition ? (
              <textarea
                ref={conditionRef}
                value={conditionDraft}
                onChange={(e) => setConditionDraft(e.target.value)}
                onBlur={finishEditCondition}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    finishEditCondition();
                  }
                  if (e.key === "Escape") setEditingCondition(false);
                }}
                className={`w-full mt-1 text-[10px] text-violet-400 bg-violet-400/[0.06] border border-violet-400/20 rounded-md px-2 py-1 focus:outline-none focus:border-violet-400/40 resize-none font-mono leading-relaxed`}
                rows={2}
                placeholder="Describe when this hook should run..."
              />
            ) : (
              <p
                className={`text-[10px] mt-1 italic truncate cursor-pointer rounded px-1 -mx-1 transition-colors ${
                  skill.condition
                    ? "text-violet-400/70 hover:text-violet-400 hover:bg-violet-400/[0.06]"
                    : `${text.dimmed} hover:text-violet-400/70 hover:bg-violet-400/[0.06]`
                }`}
                onClick={startEditCondition}
              >
                {skill.condition || "Click to set condition..."}
              </p>
            ))}
        </div>

        {/* Toggle */}
        <ToggleSwitch checked={skill.enabled} onToggle={() => onToggle(!skill.enabled)} />

        {/* Remove */}
        <button
          onClick={onRemove}
          className={`-mr-1 p-1 rounded ${text.dimmed} hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function CustomHookGroupCard({
  condition,
  conditionTitle,
  steps,
  skills,
  onUpdateStep,
  onRemoveStep,
  onToggleSkill,
  onRemoveSkill,
  onRemoveGroup,
  onEditGroup,
}: {
  condition: string;
  conditionTitle?: string;
  steps: HookStep[];
  skills: HookSkillRef[];
  onUpdateStep: (stepId: string, updates: Partial<Pick<HookStep, "enabled">>) => void;
  onRemoveStep: (stepId: string) => void;
  onToggleSkill: (skillName: string, enabled: boolean) => void;
  onRemoveSkill: (skillName: string) => void;
  onRemoveGroup: () => void;
  onEditGroup: () => void;
}) {
  return (
    <div
      className={`rounded-xl border border-white/[0.06] ${settings.card} overflow-hidden group/card`}
    >
      {/* Condition header */}
      <div
        className="group/header flex items-center bg-violet-400/[0.04] border-b border-white/[0.04] hover:bg-violet-400/[0.08] transition-colors cursor-pointer"
        onClick={onEditGroup}
      >
        <div className="flex-1 px-4 py-2.5 min-w-0">
          {conditionTitle && (
            <p className="text-[11px] font-medium text-violet-300 leading-relaxed">
              {conditionTitle}
            </p>
          )}
          <p
            className={`text-[10px] text-violet-400/80 italic leading-relaxed ${conditionTitle ? "mt-0.5" : ""}`}
          >
            {condition || "No condition set"}
          </p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemoveGroup();
          }}
          className={`p-1 mr-3 rounded ${text.dimmed} hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover/header:opacity-100 transition-all flex-shrink-0`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div>
        {/* Step rows */}
        {steps.map((step) => {
          const enabled = step.enabled !== false;
          const isPrompt = step.kind === "prompt" || (!!step.prompt && !step.command?.trim());
          return (
            <div
              key={step.id}
              className="flex items-center gap-3 px-4 py-2.5 group cursor-pointer hover:bg-white/[0.02] transition-colors"
              onClick={onEditGroup}
            >
              {isPrompt ? (
                <MessageSquareText
                  className={`w-3.5 h-3.5 flex-shrink-0 ${enabled ? "text-violet-400/70" : text.dimmed}`}
                />
              ) : (
                <Terminal
                  className={`w-3.5 h-3.5 flex-shrink-0 ${enabled ? text.muted : text.dimmed}`}
                />
              )}
              <div className="flex-1 min-w-0">
                <span className={`text-xs font-medium ${enabled ? text.primary : text.dimmed}`}>
                  {step.name}
                </span>
                <p
                  className={`text-[11px] ${text.dimmed} mt-0.5 ${isPrompt ? "" : "font-mono"} truncate`}
                >
                  {isPrompt ? step.prompt : step.command}
                </p>
              </div>
              <ToggleSwitch
                checked={enabled}
                onToggle={(e) => {
                  e.stopPropagation();
                  onUpdateStep(step.id, { enabled: !enabled });
                }}
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveStep(step.id);
                }}
                className={`-mr-1 p-1 rounded ${text.dimmed} hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
        {/* Skill rows */}
        {skills.map((skill) => (
          <div
            key={skill.skillName}
            className="flex items-center gap-3 px-4 py-2.5 group cursor-pointer hover:bg-white/[0.02] transition-colors"
            onClick={onEditGroup}
          >
            <Sparkles
              className={`w-3.5 h-3.5 flex-shrink-0 ${skill.enabled ? "text-pink-400/70" : text.dimmed}`}
            />
            <div className="flex-1 min-w-0">
              <span className={`text-xs font-medium ${skill.enabled ? text.primary : text.dimmed}`}>
                {skill.skillName}
              </span>
              <p className={`text-[11px] ${text.dimmed} mt-0.5 font-mono`}>/{skill.skillName}</p>
            </div>
            <ToggleSwitch
              checked={skill.enabled}
              onToggle={(e) => {
                e.stopPropagation();
                onToggleSkill(skill.skillName, !skill.enabled);
              }}
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemoveSkill(skill.skillName);
              }}
              className={`-mr-1 p-1 rounded ${text.dimmed} hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomHookEditor({
  onAddCommand,
  onAddPrompt,
  onImportSkill,
  onRemoveStep,
  onRemoveSkill,
  onConditionChange,
  onClose,
  initialCondition,
  initialTitle,
  existingSteps,
  existingSkills,
}: {
  onAddCommand: (name: string, command: string, condition: string, conditionTitle?: string) => void;
  onAddPrompt: (name: string, prompt: string, condition: string, conditionTitle?: string) => void;
  onImportSkill: (skillName: string, condition: string, conditionTitle?: string) => void;
  onRemoveStep: (stepId: string) => void;
  onRemoveSkill?: (skillName: string) => void;
  onConditionChange?: (oldCondition: string, newCondition: string, newTitle?: string) => void;
  onClose: () => void;
  initialCondition?: string;
  initialTitle?: string;
  existingSteps?: HookStep[];
  existingSkills?: HookSkillRef[];
}) {
  const api = useApi();
  const [available, setAvailable] = useState<
    Array<{ name: string; displayName: string; description: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState(initialTitle ?? "");
  const [condition, setCondition] = useState(initialCondition ?? "");
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [removedSkills, setRemovedSkills] = useState<Set<string>>(new Set());
  const [pendingCmds, setPendingCmds] = useState<Array<{ name: string; command: string }>>([]);
  const [pendingPrompts, setPendingPrompts] = useState<Array<{ name: string; prompt: string }>>([]);
  const [cmdName, setCmdName] = useState("");
  const [cmdCommand, setCmdCommand] = useState("");
  const [promptName, setPromptName] = useState("");
  const [promptText, setPromptText] = useState("");

  const isEditMode = initialCondition !== undefined;
  const conditionChanged = isEditMode && condition.trim() !== (initialCondition ?? "").trim();
  const titleChanged = isEditMode && title.trim() !== (initialTitle ?? "").trim();
  const existingSkillNames = new Set(existingSkills?.map((s) => s.skillName) ?? []);
  const newSkillCount = [...selectedSkills].filter((n) => !existingSkillNames.has(n)).length;

  const fetchAvailable = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.fetchAvailableHookSkills();
      setAvailable(data.available);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchAvailable();
  }, [fetchAvailable]);

  const toggleSkill = (name: string) => {
    if (existingSkillNames.has(name)) {
      // Toggle removal of existing skill
      setRemovedSkills((prev) => {
        const next = new Set(prev);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      });
    } else {
      setSelectedSkills((prev) => {
        const next = new Set(prev);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      });
    }
  };

  const addCmd = () => {
    const n = cmdName.trim();
    const c = cmdCommand.trim();
    if (!n || !c) return;
    setPendingCmds((prev) => [...prev, { name: n, command: c }]);
    setCmdName("");
    setCmdCommand("");
  };

  const addPrompt = () => {
    const n = promptName.trim();
    const p = promptText.trim();
    if (!n || !p) return;
    setPendingPrompts((prev) => [...prev, { name: n, prompt: p }]);
    setPromptName("");
    setPromptText("");
  };

  const handleSubmit = () => {
    const cond = condition.trim();
    if (!cond) return;
    const t = title.trim() || undefined;
    // Include in-progress command inputs
    const allCmds = [...pendingCmds];
    if (cmdName.trim() && cmdCommand.trim()) {
      allCmds.push({ name: cmdName.trim(), command: cmdCommand.trim() });
    }
    for (const cmd of allCmds) {
      onAddCommand(cmd.name, cmd.command, cond, t);
    }
    const allPrompts = [...pendingPrompts];
    if (promptName.trim() && promptText.trim()) {
      allPrompts.push({ name: promptName.trim(), prompt: promptText.trim() });
    }
    for (const prompt of allPrompts) {
      onAddPrompt(prompt.name, prompt.prompt, cond, t);
    }
    for (const name of selectedSkills) {
      if (!existingSkillNames.has(name)) {
        onImportSkill(name, cond, t);
      }
    }
    // Remove deselected existing skills
    for (const name of removedSkills) {
      onRemoveSkill?.(name);
    }
    if ((conditionChanged || titleChanged) && onConditionChange) {
      onConditionChange(initialCondition!, cond, t);
    }
    onClose();
  };

  const hasInProgressCmd = !!cmdName.trim() && !!cmdCommand.trim();
  const hasInProgressPrompt = !!promptName.trim() && !!promptText.trim();
  const totalNew =
    pendingCmds.length +
    pendingPrompts.length +
    newSkillCount +
    (hasInProgressCmd ? 1 : 0) +
    (hasInProgressPrompt ? 1 : 0);
  const hasChanges = totalNew > 0 || removedSkills.size > 0 || conditionChanged || titleChanged;
  const showSubmit = isEditMode ? hasChanges : !!condition.trim() && totalNew > 0;
  const submitLabel =
    totalNew > 0 && removedSkills.size > 0
      ? "Save changes"
      : totalNew > 0
        ? `Add ${totalNew} item${totalNew > 1 ? "s" : ""}`
        : removedSkills.size > 0
          ? "Save changes"
          : "Update condition";

  const lowerSearch = search.toLowerCase();
  const filtered = lowerSearch
    ? available.filter(
        (s) =>
          s.name.toLowerCase().includes(lowerSearch) ||
          s.displayName.toLowerCase().includes(lowerSearch) ||
          s.description.toLowerCase().includes(lowerSearch),
      )
    : available;

  // Merge existing and pending commands/prompts for display
  const allCommands: Array<{
    type: "existing" | "pending";
    id: string;
    name: string;
    command: string;
  }> = [
    ...(existingSteps ?? [])
      .filter((s) => !(s.kind === "prompt" || (!!s.prompt && !s.command?.trim())))
      .map((s) => ({
        type: "existing" as const,
        id: s.id,
        name: s.name,
        command: s.command,
      })),
    ...pendingCmds.map((c, i) => ({
      type: "pending" as const,
      id: `pending-${i}`,
      name: c.name,
      command: c.command,
    })),
  ];
  const allPrompts: Array<{
    type: "existing" | "pending";
    id: string;
    name: string;
    prompt: string;
  }> = [
    ...(existingSteps ?? [])
      .filter((s) => s.kind === "prompt" || (!!s.prompt && !s.command?.trim()))
      .map((s) => ({
        type: "existing" as const,
        id: s.id,
        name: s.name,
        prompt: s.prompt ?? "",
      })),
    ...pendingPrompts.map((p, i) => ({
      type: "pending" as const,
      id: `pending-prompt-${i}`,
      name: p.name,
      prompt: p.prompt,
    })),
  ];

  return (
    <div className={`rounded-xl border border-white/[0.06] ${settings.card} p-4`}>
      <div className="flex items-center justify-between mb-3">
        <span className={`text-xs font-medium ${text.primary} flex items-center gap-1.5`}>
          {isEditMode && <Pencil className="w-3 h-3" />}
          {isEditMode ? "Edit hook" : "Add hook"}
        </span>
        <button onClick={onClose} className={`p-1 ${text.dimmed} hover:text-white`}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Title */}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder='Title (e.g. "Database checks")'
        className={`w-full px-3 py-2 mb-2 rounded-lg text-xs bg-white/[0.04] border border-white/[0.06] text-white placeholder-[#4b5563] focus:outline-none focus:border-white/[0.15]`}
        autoFocus
      />

      {/* Condition */}
      <textarea
        value={condition}
        onChange={(e) => setCondition(e.target.value)}
        placeholder='When should agents run this? (e.g. "When changes touch database models or migrations")'
        rows={2}
        className={`w-full px-3 py-2 mb-3 rounded-lg text-xs bg-white/[0.04] border border-white/[0.06] text-white placeholder-[#4b5563] focus:outline-none focus:border-white/[0.15] resize-none`}
      />

      {/* Commands section */}
      <div className="mb-3">
        <span className={`text-[10px] font-medium ${text.muted} uppercase tracking-wider`}>
          Commands
        </span>
        {allCommands.length > 0 && (
          <div className="space-y-1 mt-2">
            {allCommands.map((cmd) => (
              <div
                key={cmd.id}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.02]"
              >
                <Terminal className={`w-3 h-3 ${text.dimmed} flex-shrink-0`} />
                <span className={`text-xs ${text.secondary} flex-1 min-w-0 truncate`}>
                  {cmd.name}
                </span>
                <span className={`text-[10px] ${text.dimmed} font-mono truncate max-w-[40%]`}>
                  {cmd.command}
                </span>
                <button
                  onClick={() =>
                    cmd.type === "existing"
                      ? onRemoveStep(cmd.id)
                      : setPendingCmds((prev) => prev.filter((_, j) => `pending-${j}` !== cmd.id))
                  }
                  className={`${text.dimmed} hover:text-red-400 flex-shrink-0`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 mt-2">
          <input
            value={cmdName}
            onChange={(e) => setCmdName(e.target.value)}
            placeholder="Name"
            className={`flex-1 px-2.5 py-1.5 rounded-lg text-xs bg-white/[0.04] border border-white/[0.06] text-white placeholder-[#4b5563] focus:outline-none focus:border-white/[0.15]`}
          />
          <input
            value={cmdCommand}
            onChange={(e) => setCmdCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addCmd();
            }}
            placeholder="Command"
            className={`flex-1 px-2.5 py-1.5 rounded-lg text-xs bg-white/[0.04] border border-white/[0.06] text-white placeholder-[#4b5563] focus:outline-none focus:border-white/[0.15] font-mono`}
          />
          {/* Add another command (commits current inputs to list, clears for next) */}
          {pendingCmds.length > 0 || (cmdName.trim() && cmdCommand.trim()) ? (
            <button
              onClick={addCmd}
              disabled={!cmdName.trim() || !cmdCommand.trim()}
              className={`px-2 py-1.5 rounded-lg ${text.dimmed} hover:text-[#9ca3af] hover:bg-white/[0.06] transition-colors disabled:opacity-30 disabled:hover:text-inherit disabled:hover:bg-transparent`}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Prompts section */}
      <div className="mb-3 border-t border-white/[0.06] pt-3">
        <span className={`text-[10px] font-medium ${text.muted} uppercase tracking-wider`}>
          Prompts
        </span>
        {allPrompts.length > 0 && (
          <div className="space-y-1 mt-2">
            {allPrompts.map((prompt) => (
              <div
                key={prompt.id}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.02]"
              >
                <MessageSquareText className={`w-3 h-3 text-violet-400/70 flex-shrink-0`} />
                <span className={`text-xs ${text.secondary} flex-1 min-w-0 truncate`}>
                  {prompt.name}
                </span>
                <span className={`text-[10px] ${text.dimmed} truncate max-w-[50%]`}>
                  {prompt.prompt}
                </span>
                <button
                  onClick={() =>
                    prompt.type === "existing"
                      ? onRemoveStep(prompt.id)
                      : setPendingPrompts((prev) =>
                          prev.filter((_, j) => `pending-prompt-${j}` !== prompt.id),
                        )
                  }
                  className={`${text.dimmed} hover:text-red-400 flex-shrink-0`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 mt-2">
          <input
            value={promptName}
            onChange={(e) => setPromptName(e.target.value)}
            placeholder="Title"
            className={`flex-1 px-2.5 py-1.5 rounded-lg text-xs bg-white/[0.04] border border-white/[0.06] text-white placeholder-[#4b5563] focus:outline-none focus:border-white/[0.15]`}
          />
          <input
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addPrompt();
            }}
            placeholder="Description"
            className={`flex-1 px-2.5 py-1.5 rounded-lg text-xs bg-white/[0.04] border border-white/[0.06] text-white placeholder-[#4b5563] focus:outline-none focus:border-white/[0.15]`}
          />
          {pendingPrompts.length > 0 || (promptName.trim() && promptText.trim()) ? (
            <button
              onClick={addPrompt}
              disabled={!promptName.trim() || !promptText.trim()}
              className={`px-2 py-1.5 rounded-lg ${text.dimmed} hover:text-[#9ca3af] hover:bg-white/[0.06] transition-colors disabled:opacity-30 disabled:hover:text-inherit disabled:hover:bg-transparent`}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Skills section */}
      <div className="border-t border-white/[0.06] pt-3">
        <span className={`text-[10px] font-medium ${text.muted} uppercase tracking-wider`}>
          Skills
        </span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search skills..."
          className={`w-full px-3 py-2 mt-2 mb-2 rounded-lg text-xs bg-white/[0.04] border border-white/[0.06] text-white placeholder-[#4b5563] focus:outline-none focus:border-white/[0.15]`}
        />
        {loading ? (
          <div className="flex justify-center py-4">
            <div className="w-4 h-4 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className={`text-[11px] ${text.muted} text-center py-3`}>
            {search ? "No skills match your search." : "No additional skills available."}
          </p>
        ) : (
          <div className="space-y-0.5 max-h-48 overflow-y-auto">
            {filtered.map((skill) => {
              const isExisting = existingSkillNames.has(skill.name);
              const isChecked = isExisting
                ? !removedSkills.has(skill.name)
                : selectedSkills.has(skill.name);
              return (
                <button
                  key={skill.name}
                  onClick={() => toggleSkill(skill.name)}
                  className="w-full text-left px-3 py-2 rounded-lg transition-colors flex items-center gap-2.5 hover:bg-white/[0.04]"
                >
                  <span
                    className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                      isChecked ? "bg-teal-400/20 border-teal-400/50" : "border-white/[0.15]"
                    }`}
                  >
                    {isChecked && (
                      <svg
                        className="w-2 h-2 text-teal-400"
                        viewBox="0 0 12 12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M2 6l3 3 5-5" />
                      </svg>
                    )}
                  </span>
                  <div className="min-w-0">
                    <span className={`text-xs font-medium ${text.secondary}`}>
                      {skill.displayName}
                    </span>
                    {skill.description && (
                      <p className={`text-[10px] ${text.muted} mt-0.5`}>{skill.description}</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Submit */}
      {showSubmit && (
        <button
          onClick={handleSubmit}
          disabled={!condition.trim()}
          className="w-full mt-3 px-3 py-2 rounded-lg text-xs font-medium bg-teal-400/15 text-teal-300 hover:bg-teal-400/25 transition-colors disabled:opacity-40"
        >
          {submitLabel}
        </button>
      )}
    </div>
  );
}

function CustomHooksSection({
  steps,
  skills,
  onAddStep,
  onAddPrompt,
  onUpdateStep,
  onRemoveStep,
  onImportSkill,
  onToggleSkill,
  onRemoveSkill,
  onRemoveGroup,
  onUpdateGroup,
}: {
  steps: HookStep[];
  skills: HookSkillRef[];
  onAddStep: (name: string, command: string, condition: string, conditionTitle?: string) => void;
  onAddPrompt: (name: string, prompt: string, condition: string, conditionTitle?: string) => void;
  onUpdateStep: (
    stepId: string,
    updates: Partial<Pick<HookStep, "name" | "command" | "prompt" | "enabled" | "condition">>,
  ) => void;
  onRemoveStep: (stepId: string) => void;
  onImportSkill: (skillName: string, condition: string, conditionTitle?: string) => void;
  onToggleSkill: (skillName: string, enabled: boolean) => void;
  onRemoveSkill: (skillName: string) => void;
  onRemoveGroup: (condition: string) => void;
  onUpdateGroup: (oldCondition: string, newCondition: string, newTitle?: string) => void;
}) {
  const [editingCondition, setEditingCondition] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  // Group all items by condition
  const groups: Record<string, { steps: HookStep[]; skills: HookSkillRef[]; title?: string }> = {};
  for (const step of steps) {
    const key = step.condition ?? "";
    const g = (groups[key] ??= { steps: [], skills: [] });
    g.steps.push(step);
    if (step.conditionTitle) g.title = step.conditionTitle;
  }
  for (const skill of skills) {
    const key = skill.condition ?? "";
    const g = (groups[key] ??= { steps: [], skills: [] });
    g.skills.push(skill);
    if (skill.conditionTitle) g.title = skill.conditionTitle;
  }

  const hasItems = steps.length > 0 || skills.length > 0;
  const isEditing = showEditor;
  const allConditions = new Set([
    ...Object.keys(groups),
    ...(editingCondition !== null ? [editingCondition] : []),
  ]);

  const openEditor = () => {
    setEditingCondition(null);
    setShowEditor(true);
  };
  const editGroup = (condition: string) => {
    setEditingCondition(condition);
    setShowEditor(true);
  };
  const closeEditor = () => {
    setEditingCondition(null);
    setShowEditor(false);
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <MessageSquareText className="w-3.5 h-3.5 text-violet-400" />
        <h3 className={`text-xs font-semibold ${text.primary} uppercase tracking-wider`}>Custom</h3>
        <span className={`text-[10px] ${text.dimmed} ml-1`}>
          Agent decides when to run based on your condition
        </span>
      </div>
      <div className="space-y-2">
        {!hasItems && !isEditing && (
          <div className="text-center py-6">
            <p className={`text-xs ${text.muted}`}>No custom hooks configured yet.</p>
          </div>
        )}

        {/* Groups — render editor inline when editing */}
        {[...allConditions].map((condition) =>
          isEditing && editingCondition === condition ? (
            <CustomHookEditor
              key={`edit-${condition}`}
              initialCondition={condition}
              initialTitle={groups[condition]?.title}
              existingSteps={groups[condition]?.steps}
              existingSkills={groups[condition]?.skills}
              onAddCommand={onAddStep}
              onAddPrompt={onAddPrompt}
              onImportSkill={onImportSkill}
              onRemoveStep={onRemoveStep}
              onRemoveSkill={onRemoveSkill}
              onConditionChange={onUpdateGroup}
              onClose={closeEditor}
            />
          ) : groups[condition] ? (
            <CustomHookGroupCard
              key={condition}
              condition={condition}
              conditionTitle={groups[condition].title}
              steps={groups[condition].steps}
              skills={groups[condition].skills}
              onUpdateStep={onUpdateStep}
              onRemoveStep={onRemoveStep}
              onToggleSkill={onToggleSkill}
              onRemoveSkill={onRemoveSkill}
              onRemoveGroup={() => onRemoveGroup(condition)}
              onEditGroup={() => editGroup(condition)}
            />
          ) : null,
        )}

        {/* New editor at bottom */}
        {isEditing && editingCondition === null && (
          <CustomHookEditor
            onAddCommand={onAddStep}
            onAddPrompt={onAddPrompt}
            onImportSkill={onImportSkill}
            onRemoveStep={onRemoveStep}
            onClose={closeEditor}
          />
        )}

        {/* Add hook button */}
        {!isEditing && (
          <div className="flex flex-col gap-2 pt-1">
            <button
              onClick={openEditor}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium ${text.muted} hover:text-[#9ca3af] border border-dashed border-white/[0.08] hover:border-white/[0.15] rounded-lg transition-colors`}
            >
              <Plus className="w-3.5 h-3.5" />
              Add hook
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ImportSkillPicker({
  onImport,
  onClose,
  showConditionInput,
  initialCondition,
  initialSelected,
  onConditionChange,
}: {
  onImport: (skillName: string, condition?: string) => void;
  onClose: () => void;
  showConditionInput?: boolean;
  initialCondition?: string;
  initialSelected?: Set<string>;
  onConditionChange?: (oldCondition: string, newCondition: string) => void;
}) {
  const api = useApi();
  const [available, setAvailable] = useState<
    Array<{ name: string; displayName: string; description: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [condition, setCondition] = useState(initialCondition ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));

  const isEditMode = initialCondition !== undefined;
  const conditionChanged = isEditMode && condition.trim() !== (initialCondition ?? "").trim();

  const fetchAvailable = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.fetchAvailableHookSkills();
      setAvailable(data.available);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchAvailable();
  }, [fetchAvailable]);

  const lowerSearch = search.toLowerCase();
  const filtered = lowerSearch
    ? available.filter(
        (s) =>
          s.name.toLowerCase().includes(lowerSearch) ||
          s.displayName.toLowerCase().includes(lowerSearch) ||
          s.description.toLowerCase().includes(lowerSearch),
      )
    : available;

  const toggleSkill = (name: string) => {
    if (initialSelected?.has(name)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleSubmit = () => {
    const cond = condition.trim() || undefined;
    for (const name of selected) {
      if (!initialSelected?.has(name)) {
        onImport(name, cond);
      }
    }
    if (conditionChanged && onConditionChange) {
      onConditionChange(initialCondition!, condition.trim());
    }
    onClose();
  };

  const newlySelected = [...selected].filter((n) => !initialSelected?.has(n)).length;
  const showAction = showConditionInput && (newlySelected > 0 || conditionChanged);

  return (
    <div className={`rounded-xl border border-white/[0.06] ${settings.card} p-4`}>
      <div className="flex items-center justify-between mb-3">
        <span className={`text-xs font-medium ${text.primary} flex items-center gap-1.5`}>
          {isEditMode && <Pencil className="w-3 h-3" />}
          {isEditMode ? "Edit hook" : "Add skill"}
        </span>
        <button onClick={onClose} className={`p-1 ${text.dimmed} hover:text-white`}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Condition input for custom hooks */}
      {showConditionInput && (
        <textarea
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          placeholder='When should agents run this? (e.g. "When changes touch database models or migrations")'
          rows={2}
          className={`w-full px-3 py-2 mb-3 rounded-lg text-xs bg-white/[0.04] border border-white/[0.06] text-white placeholder-[#4b5563] focus:outline-none focus:border-white/[0.15] resize-none`}
          autoFocus
        />
      )}

      {/* Search input */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search skills..."
        className={`w-full px-3 py-2 mb-3 rounded-lg text-xs bg-white/[0.04] border border-white/[0.06] text-white placeholder-[#4b5563] focus:outline-none focus:border-white/[0.15]`}
        autoFocus={!showConditionInput}
      />

      {loading ? (
        <div className="flex justify-center py-4">
          <div className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <p className={`text-[11px] ${text.muted} text-center py-4`}>
          {search
            ? "No skills match your search."
            : "No additional skills available in the registry."}
        </p>
      ) : (
        <div className="space-y-1">
          {filtered.map((skill) => {
            const isChecked = selected.has(skill.name);
            const isLocked = initialSelected?.has(skill.name);
            return (
              <button
                key={skill.name}
                onClick={() =>
                  showConditionInput ? toggleSkill(skill.name) : onImport(skill.name)
                }
                className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors flex items-center gap-2.5 ${
                  isLocked ? "opacity-50 cursor-default" : "hover:bg-white/[0.04]"
                }`}
              >
                {showConditionInput && (
                  <span
                    className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                      isChecked
                        ? isLocked
                          ? "bg-teal-400/10 border-teal-400/30"
                          : "bg-teal-400/20 border-teal-400/50"
                        : "border-white/[0.15]"
                    }`}
                  >
                    {isChecked && (
                      <svg
                        className="w-2 h-2 text-teal-400"
                        viewBox="0 0 12 12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M2 6l3 3 5-5" />
                      </svg>
                    )}
                  </span>
                )}
                <div className="min-w-0">
                  <span className={`text-xs font-medium ${text.secondary}`}>
                    {skill.displayName}
                  </span>
                  {skill.description && (
                    <p className={`text-[10px] ${text.muted} mt-0.5`}>{skill.description}</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Action button */}
      {showAction && (
        <button
          onClick={handleSubmit}
          className="w-full mt-3 px-3 py-2 rounded-lg text-xs font-medium bg-teal-400/15 text-teal-300 hover:bg-teal-400/25 transition-colors"
        >
          {newlySelected > 0
            ? `Add ${newlySelected} skill${newlySelected > 1 ? "s" : ""}`
            : "Update condition"}
        </button>
      )}
    </div>
  );
}
