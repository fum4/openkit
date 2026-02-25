import {
  Ban,
  Check,
  ChevronDown,
  CircleCheck,
  FileText,
  FishingHook,
  FolderMinus,
  FolderPlus,
  Hand,
  ListChecks,
  Loader2,
  MessageSquareText,
  Play,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { HookSkillRef, HookStep, SkillHookResult, StepResult } from "../../hooks/api";
import { useApi } from "../../hooks/useApi";
import { useEffectiveHooksConfig, useHookSkillResults } from "../../hooks/useHooks";
import { settings, surface, text } from "../../theme";
import { MarkdownContent } from "../MarkdownContent";
import { Modal } from "../Modal";

function statusIcon(status: StepResult["status"]) {
  switch (status) {
    case "passed":
      return <Check className="w-3.5 h-3.5 text-emerald-400" />;
    case "failed":
      return <X className="w-3.5 h-3.5 text-red-400" />;
    case "running":
      return <Loader2 className="w-3.5 h-3.5 text-yellow-400 animate-spin" />;
    case "pending":
      return <div className="w-3.5 h-3.5 rounded-full border border-white/[0.15]" />;
  }
}

function SweepingBorder() {
  const rectStyle: React.CSSProperties = {
    x: 0.5,
    y: 0.5,
    width: "calc(100% - 1px)",
    height: "calc(100% - 1px)",
    animation: "border-sweep 2s linear infinite",
  };
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ animation: "border-sweep-fade 2s linear infinite" }}
    >
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.01)"
        strokeWidth="2"
        strokeDasharray="45 55"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.02)"
        strokeWidth="2"
        strokeDasharray="43 57"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.03)"
        strokeWidth="2"
        strokeDasharray="42 58"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.04)"
        strokeWidth="2"
        strokeDasharray="40 60"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.05)"
        strokeWidth="2"
        strokeDasharray="38 62"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.06)"
        strokeWidth="2"
        strokeDasharray="37 63"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.07)"
        strokeWidth="2"
        strokeDasharray="35 65"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.08)"
        strokeWidth="2"
        strokeDasharray="33 67"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.09)"
        strokeWidth="2"
        strokeDasharray="32 68"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.10)"
        strokeWidth="2"
        strokeDasharray="30 70"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.11)"
        strokeWidth="1.5"
        strokeDasharray="28 72"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.12)"
        strokeWidth="1.5"
        strokeDasharray="27 73"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.13)"
        strokeWidth="1.5"
        strokeDasharray="25 75"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.14)"
        strokeWidth="1.5"
        strokeDasharray="23 77"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.15)"
        strokeWidth="1.5"
        strokeDasharray="22 78"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.16)"
        strokeWidth="1.5"
        strokeDasharray="20 80"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.17)"
        strokeWidth="1.5"
        strokeDasharray="18 82"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.18)"
        strokeWidth="1.5"
        strokeDasharray="17 83"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.19)"
        strokeWidth="1.5"
        strokeDasharray="15 85"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.20)"
        strokeWidth="1.5"
        strokeDasharray="13 87"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.21)"
        strokeWidth="1"
        strokeDasharray="12 88"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.22)"
        strokeWidth="1"
        strokeDasharray="10 90"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.23)"
        strokeWidth="1"
        strokeDasharray="9 91"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.24)"
        strokeWidth="1"
        strokeDasharray="8 92"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.25)"
        strokeWidth="1"
        strokeDasharray="7 93"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.26)"
        strokeWidth="1"
        strokeDasharray="6 94"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.27)"
        strokeWidth="1"
        strokeDasharray="5 95"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.28)"
        strokeWidth="1"
        strokeDasharray="4 96"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.29)"
        strokeWidth="1"
        strokeDasharray="3 97"
        strokeLinecap="round"
        style={rectStyle}
      />
      <rect
        rx="7.5"
        pathLength="100"
        fill="none"
        stroke="rgba(45,212,191,0.30)"
        strokeWidth="1"
        strokeDasharray="2 98"
        strokeLinecap="round"
        style={rectStyle}
      />
    </svg>
  );
}
void SweepingBorder;

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function isPromptStep(step: HookStep): boolean {
  return step.kind === "prompt" || (!!step.prompt && !step.command?.trim());
}

function skillResultKey(skillName: string, trigger?: HookSkillRef["trigger"]): string {
  return `${trigger ?? "post-implementation"}::${skillName}`;
}

interface HooksTabProps {
  worktreeId: string;
  visible: boolean;
  hookUpdateKey?: number;
  hasLinkedIssue?: boolean;
  onNavigateToIssue?: () => void;
  onCreateTask?: () => void;
  onNavigateToHooks?: () => void;
}

export function HooksTab({
  worktreeId,
  visible,
  hookUpdateKey,
  hasLinkedIssue,
  onNavigateToIssue,
  onCreateTask,
  onNavigateToHooks,
}: HooksTabProps) {
  const api = useApi();
  const { config, refetch: refetchConfig } = useEffectiveHooksConfig(visible ? worktreeId : null);
  const { results: skillResults, refetch: refetchSkillResults } = useHookSkillResults(
    visible ? worktreeId : null,
  );
  const [stepResults, setStepResults] = useState<Record<string, StepResult>>({});
  const [runningSteps, setRunningSteps] = useState<Set<string>>(new Set());
  const [runningAll, setRunningAll] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set());
  const [reportPreview, setReportPreview] = useState<{ skillName: string; content: string } | null>(
    null,
  );

  // Fetch latest status on mount / worktree change
  const fetchStatus = useCallback(async () => {
    const result = await api.fetchHooksStatus(worktreeId);
    if (result.status?.steps) {
      const map: Record<string, StepResult> = {};
      for (const step of result.status.steps) {
        map[step.stepId] = step;
      }
      setStepResults(map);
    }
  }, [api, worktreeId]);

  useEffect(() => {
    if (visible) {
      fetchStatus();
      refetchConfig();
      refetchSkillResults();
    }
  }, [visible, fetchStatus, refetchConfig, refetchSkillResults]);

  // Auto-refetch and auto-expand when hook updates arrive via SSE
  const prevStepResultsRef = useRef<Record<string, StepResult>>({});
  const prevSkillResultsRef = useRef(skillResults);
  useEffect(() => {
    if (!hookUpdateKey || !visible) return;
    refetchSkillResults();
    fetchStatus();
  }, [hookUpdateKey, visible, refetchSkillResults, fetchStatus]);

  // Auto-expand commands as soon as they fail
  useEffect(() => {
    const prev = prevStepResultsRef.current;
    const toExpand: string[] = [];

    for (const [stepId, result] of Object.entries(stepResults)) {
      if (result.status !== "failed" || !result.output) continue;
      const prevResult = prev[stepId];
      if (
        !prevResult ||
        prevResult.status !== "failed" ||
        prevResult.completedAt !== result.completedAt ||
        prevResult.output !== result.output
      ) {
        toExpand.push(stepId);
      }
    }

    if (toExpand.length > 0) {
      setExpandedSteps((prevExpanded) => {
        const next = new Set(prevExpanded);
        for (const stepId of toExpand) next.add(stepId);
        return next;
      });
    }

    prevStepResultsRef.current = stepResults;
  }, [stepResults]);

  // Auto-expand skills that just got new results
  useEffect(() => {
    const prev = prevSkillResultsRef.current;
    const toExpand: string[] = [];
    for (const result of skillResults) {
      if (result.status === "running") continue;
      const key = skillResultKey(result.skillName, result.trigger);
      const prevResult = prev.find(
        (r) =>
          skillResultKey(r.skillName, r.trigger) ===
          skillResultKey(result.skillName, result.trigger),
      );
      if (
        !prevResult ||
        prevResult.status === "running" ||
        prevResult.reportedAt !== result.reportedAt
      ) {
        if (
          (result.status === "failed" || result.success === false) &&
          (result.content || result.summary)
        ) {
          toExpand.push(key);
        }
      }
    }
    if (toExpand.length > 0) {
      setExpandedSkills((prev) => {
        const next = new Set(prev);
        for (const name of toExpand) next.add(name);
        return next;
      });
    }
    prevSkillResultsRef.current = skillResults;
  }, [skillResults]);

  // Expand all items when entire pipeline completes
  const pipelineWasCompleteRef = useRef(false);
  useEffect(() => {
    if (!config) return;
    const enabledSteps = config.steps.filter((s) => s.enabled !== false && !isPromptStep(s));
    const enabledSkills = config.skills.filter((s) => s.enabled);
    if (enabledSteps.length === 0 && enabledSkills.length === 0) return;

    const hasAnyResults = enabledSteps.some((s) => stepResults[s.id]) || skillResults.length > 0;
    if (!hasAnyResults) {
      pipelineWasCompleteRef.current = false;
      return;
    }

    const allStepsComplete = enabledSteps.every((s) => {
      const r = stepResults[s.id];
      return r && r.status !== "running";
    });
    const allSkillsComplete = enabledSkills.every((s) => {
      const r = skillResults.find(
        (r2) => skillResultKey(r2.skillName, r2.trigger) === skillResultKey(s.skillName, s.trigger),
      );
      return r && r.status !== "running";
    });

    const isComplete = allStepsComplete && allSkillsComplete;
    if (isComplete && !pipelineWasCompleteRef.current) {
      pipelineWasCompleteRef.current = true;
      setExpandedSteps(
        new Set(
          enabledSteps
            .filter((s) => stepResults[s.id]?.status === "failed" && stepResults[s.id]?.output)
            .map((s) => s.id),
        ),
      );
      setExpandedSkills(
        new Set(
          enabledSkills
            .filter((s) => {
              const r = skillResults.find(
                (r2) =>
                  skillResultKey(r2.skillName, r2.trigger) ===
                  skillResultKey(s.skillName, s.trigger),
              );
              return (r?.status === "failed" || r?.success === false) && (r?.content || r?.summary);
            })
            .map((s) => skillResultKey(s.skillName, s.trigger)),
        ),
      );
    } else if (!isComplete) {
      pipelineWasCompleteRef.current = false;
    }
  }, [config, stepResults, skillResults]);

  const handleRunAll = async () => {
    if (!config) return;
    setRunningAll(true);
    const postSteps = config.steps.filter(
      (s) =>
        s.enabled !== false &&
        (s.trigger === "post-implementation" || !s.trigger) &&
        !isPromptStep(s),
    );
    setRunningSteps(new Set(postSteps.map((s) => s.id)));
    // Clear previous results
    setStepResults({});
    try {
      const run = await api.runHooks(worktreeId, "post-implementation");
      const map: Record<string, StepResult> = {};
      for (const step of run.steps) {
        map[step.stepId] = step;
      }
      setStepResults(map);
    } finally {
      setRunningAll(false);
      setRunningSteps(new Set());
    }
  };

  const handleRunSingle = async (stepId: string) => {
    setRunningSteps((prev) => new Set(prev).add(stepId));
    try {
      const result = await api.runHookStep(worktreeId, stepId);
      setStepResults((prev) => ({ ...prev, [stepId]: result }));
    } finally {
      setRunningSteps((prev) => {
        const next = new Set(prev);
        next.delete(stepId);
        return next;
      });
    }
  };

  const handleViewReport = useCallback(
    async (filePath: string, skillName: string) => {
      const result = await api.fetchFileContent(filePath);
      if (result.content) {
        setReportPreview({ skillName, content: result.content });
      }
    },
    [api],
  );

  if (!visible) return null;

  // Split steps by trigger (include disabled items)
  const preSteps = (config?.steps ?? []).filter((s) => s.trigger === "pre-implementation");
  const postSteps = (config?.steps ?? []).filter(
    (s) => s.trigger === "post-implementation" || !s.trigger,
  );
  const customSteps = (config?.steps ?? []).filter((s) => s.trigger === "custom");
  const onDemandSteps = (config?.steps ?? []).filter((s) => s.trigger === "on-demand");
  const worktreeCreatedSteps = (config?.steps ?? []).filter(
    (s) => s.trigger === "worktree-created",
  );
  const worktreeRemovedSteps = (config?.steps ?? []).filter(
    (s) => s.trigger === "worktree-removed",
  );
  const preSkills = (config?.skills ?? []).filter((s) => s.trigger === "pre-implementation");
  const postSkills = (config?.skills ?? []).filter(
    (s) => s.trigger === "post-implementation" || !s.trigger,
  );
  const customSkills = (config?.skills ?? []).filter((s) => s.trigger === "custom");
  const onDemandSkills = (config?.skills ?? []).filter((s) => s.trigger === "on-demand");

  const hasPre = preSteps.length > 0 || preSkills.length > 0;
  const hasPost = postSteps.length > 0 || postSkills.length > 0;
  const hasCustom = customSteps.length > 0 || customSkills.length > 0;
  const hasOnDemand = onDemandSteps.length > 0 || onDemandSkills.length > 0;
  const hasWorktreeCreated = worktreeCreatedSteps.length > 0;
  const hasWorktreeRemoved = worktreeRemovedSteps.length > 0;

  // Group custom items by condition
  const customGroups: Record<
    string,
    { steps: HookStep[]; skills: HookSkillRef[]; title?: string }
  > = {};
  for (const step of customSteps) {
    const key = step.condition ?? "";
    const g = (customGroups[key] ??= { steps: [], skills: [] });
    g.steps.push(step);
    if (step.conditionTitle) g.title = step.conditionTitle;
  }
  for (const skill of customSkills) {
    const key = skill.condition ?? "";
    const g = (customGroups[key] ??= { steps: [], skills: [] });
    g.skills.push(skill);
    if (skill.conditionTitle) g.title = skill.conditionTitle;
  }

  // Nothing configured at all
  if (
    !hasPre &&
    !hasPost &&
    !hasCustom &&
    !hasOnDemand &&
    !hasWorktreeCreated &&
    !hasWorktreeRemoved
  ) {
    return (
      <div className="relative flex-1 flex flex-col min-h-0 mx-1 mb-[3px] rounded-t-xl rounded-b-lg bg-black/25 border border-black/40 overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/10 via-black/5 to-transparent" />
        <div className="relative z-[1] flex-1 flex flex-col items-center justify-center gap-3 px-8 -mt-5">
          <FishingHook className="w-8 h-8 text-emerald-400/30" />
          <p className={`text-xs ${text.muted} text-center`}>
            No hook steps or skills configured.
            <br />
            Add them in the{" "}
            {onNavigateToHooks ? (
              <button
                type="button"
                onClick={onNavigateToHooks}
                className="text-accent hover:text-accent/80 underline decoration-accent/50 underline-offset-2 transition-colors"
              >
                Hooks
              </button>
            ) : (
              "Hooks"
            )}{" "}
            view to run checks on this worktree.
          </p>
        </div>
      </div>
    );
  }

  // Build skill result map for quick lookup
  const skillResultMap = new Map<string, SkillHookResult>();
  for (const r of skillResults) {
    skillResultMap.set(skillResultKey(r.skillName, r.trigger), r);
  }

  return (
    <div className="relative flex-1 flex flex-col min-h-0 mx-1 mb-[3px] rounded-t-xl rounded-b-lg bg-black/25 overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/10 via-black/5 to-transparent" />
      <div className="relative z-[1] flex-1 border border-black/40 border-b-0 rounded-t-xl overflow-hidden">
        <div className="h-full overflow-y-auto pb-4 -mt-5">
          {/* On-Demand section */}
          {hasOnDemand && (
            <>
              <div className="flex items-center gap-2 px-4 pt-2 pb-3 mt-8">
                <Hand className="w-4 h-4 text-amber-400" />
                <span className={`text-xs ${text.primary}`}>On-Demand</span>
                <span className={`text-[10px] ${text.muted}`}>
                  {onDemandSteps.length + onDemandSkills.length} item
                  {onDemandSteps.length + onDemandSkills.length !== 1 ? "s" : ""}
                </span>
              </div>

              {onDemandSteps.length > 0 && (
                <StepList
                  steps={onDemandSteps}
                  stepResults={stepResults}
                  runningSteps={runningSteps}
                  runningAll={false}
                  expandedSteps={expandedSteps}
                  setExpandedSteps={setExpandedSteps}
                  onRunSingle={handleRunSingle}
                />
              )}

              {onDemandSkills.length > 0 && (
                <SkillList
                  skills={onDemandSkills}
                  skillResultMap={skillResultMap}
                  expandedSkills={expandedSkills}
                  setExpandedSkills={setExpandedSkills}
                  onViewReport={handleViewReport}
                />
              )}
            </>
          )}

          {/* Worktree Created */}
          {hasWorktreeCreated && (
            <>
              <div className="flex items-center gap-2 px-4 pt-2 pb-3 mt-8">
                <FolderPlus className="w-4 h-4 text-cyan-400" />
                <span className={`text-xs ${text.primary}`}>Worktree Created</span>
                <span className={`text-[10px] ${text.muted}`}>
                  {worktreeCreatedSteps.length} item
                  {worktreeCreatedSteps.length !== 1 ? "s" : ""}
                </span>
              </div>
              <StepList
                steps={worktreeCreatedSteps}
                stepResults={stepResults}
                runningSteps={runningSteps}
                runningAll={false}
                expandedSteps={expandedSteps}
                setExpandedSteps={setExpandedSteps}
                onRunSingle={handleRunSingle}
              />
            </>
          )}

          {/* Worktree Removed */}
          {hasWorktreeRemoved && (
            <>
              <div className="flex items-center gap-2 px-4 pt-2 pb-3 mt-8">
                <FolderMinus className="w-4 h-4 text-rose-400" />
                <span className={`text-xs ${text.primary}`}>Worktree Removed</span>
                <span className={`text-[10px] ${text.muted}`}>
                  {worktreeRemovedSteps.length} item
                  {worktreeRemovedSteps.length !== 1 ? "s" : ""}
                </span>
              </div>
              <StepList
                steps={worktreeRemovedSteps}
                stepResults={stepResults}
                runningSteps={runningSteps}
                runningAll={false}
                expandedSteps={expandedSteps}
                setExpandedSteps={setExpandedSteps}
                onRunSingle={handleRunSingle}
              />
            </>
          )}

          {/* Pre-Implementation */}
          {hasPre && (
            <>
              <div className="flex items-center justify-between px-4 pt-2 pb-3 mt-8">
                <div className="flex items-center gap-2">
                  <ListChecks className="w-4 h-4 text-sky-400" />
                  <span className={`text-xs ${text.primary}`}>Pre-Implementation</span>
                  <span className={`text-[10px] ${text.muted}`}>
                    {preSteps.length + preSkills.length} item
                    {preSteps.length + preSkills.length !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>

              {preSteps.length > 0 && (
                <StepList
                  steps={preSteps}
                  stepResults={stepResults}
                  runningSteps={runningSteps}
                  runningAll={false}
                  expandedSteps={expandedSteps}
                  setExpandedSteps={setExpandedSteps}
                  onRunSingle={handleRunSingle}
                />
              )}

              {preSkills.length > 0 && (
                <SkillList
                  skills={preSkills}
                  skillResultMap={skillResultMap}
                  expandedSkills={expandedSkills}
                  setExpandedSkills={setExpandedSkills}
                  onViewReport={handleViewReport}
                />
              )}
            </>
          )}

          {/* Post-Implementation */}
          {hasPost && (
            <>
              <div className="flex items-center justify-between px-4 pt-2 pb-3 mt-8">
                <div className="flex items-center gap-2">
                  <CircleCheck className="w-4 h-4 text-emerald-400" />
                  <span className={`text-xs ${text.primary}`}>Post-Implementation</span>
                  <span className={`text-[10px] ${text.muted}`}>
                    {postSteps.length + postSkills.length} item
                    {postSteps.length + postSkills.length !== 1 ? "s" : ""}
                  </span>
                </div>
                {postSteps.filter((s) => s.enabled !== false && !isPromptStep(s)).length > 1 && (
                  <button
                    onClick={handleRunAll}
                    disabled={runningAll}
                    className="group/run flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg transition-colors border border-white/[0.12] text-[#9ca3af] hover:text-white hover:border-white/[0.25] hover:bg-white/[0.04] disabled:opacity-50"
                  >
                    {runningAll ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5 group-hover/run:fill-current" />
                    )}
                    {runningAll ? "Running..." : "Run All"}
                  </button>
                )}
              </div>

              {postSteps.length > 0 && (
                <StepList
                  steps={postSteps}
                  stepResults={stepResults}
                  runningSteps={runningSteps}
                  runningAll={runningAll}
                  expandedSteps={expandedSteps}
                  setExpandedSteps={setExpandedSteps}
                  onRunSingle={handleRunSingle}
                />
              )}

              {postSkills.length > 0 && (
                <SkillList
                  skills={postSkills}
                  skillResultMap={skillResultMap}
                  expandedSkills={expandedSkills}
                  setExpandedSkills={setExpandedSkills}
                  onViewReport={handleViewReport}
                />
              )}
            </>
          )}

          {/* Custom — grouped by condition */}
          {hasCustom && (
            <>
              <div className="flex items-center gap-2 px-4 pt-2 pb-3 mt-8">
                <MessageSquareText className="w-4 h-4 text-violet-400" />
                <span className={`text-xs ${text.primary}`}>Custom</span>
                <span className={`text-[10px] ${text.muted}`}>
                  {customSteps.length + customSkills.length} item
                  {customSteps.length + customSkills.length !== 1 ? "s" : ""}
                </span>
              </div>

              {Object.entries(customGroups).map(([condition, group]) => (
                <div key={condition} className="mb-3">
                  {/* Group header */}
                  <div className="px-4 pt-2 pb-3">
                    {group.title && (
                      <p className="text-[11px] font-medium text-violet-300">{group.title}</p>
                    )}
                    <p
                      className={`text-[10px] text-violet-400/60 italic ${group.title ? "mt-0.5" : ""}`}
                    >
                      {condition || "No condition set"}
                    </p>
                  </div>

                  {group.steps.length > 0 && (
                    <StepList
                      steps={group.steps}
                      stepResults={stepResults}
                      runningSteps={runningSteps}
                      runningAll={false}
                      expandedSteps={expandedSteps}
                      setExpandedSteps={setExpandedSteps}
                      onRunSingle={handleRunSingle}
                    />
                  )}

                  {group.skills.length > 0 && (
                    <SkillList
                      skills={group.skills}
                      skillResultMap={skillResultMap}
                      expandedSkills={expandedSkills}
                      setExpandedSkills={setExpandedSkills}
                      onViewReport={handleViewReport}
                    />
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
      {/* Configure hooks footer */}
      <div
        className={`relative z-[1] flex-shrink-0 px-4 py-3 border-t border-white/[0.06] ${surface.panel}`}
      >
        <div className="flex items-center justify-center gap-1 text-[11px] flex-wrap">
          {hasLinkedIssue && onNavigateToIssue ? (
            <>
              <button
                type="button"
                onClick={onNavigateToIssue}
                className={`font-medium ${text.muted} hover:text-white transition-colors inline-flex items-center gap-1`}
              >
                Configure hooks for this worktree
              </button>
              {onNavigateToHooks && (
                <>
                  <span className={text.dimmed}>or</span>
                  <button
                    type="button"
                    onClick={onNavigateToHooks}
                    className={`font-medium ${text.muted} hover:text-white transition-colors inline-flex items-center gap-1`}
                  >
                    configure globally
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <span className={text.dimmed}>
                {onCreateTask && (
                  <>
                    <button
                      type="button"
                      onClick={onCreateTask}
                      className={`font-medium ${text.muted} hover:text-white transition-colors`}
                    >
                      Create a task
                    </button>
                    {" to configure hooks, or "}
                  </>
                )}
              </span>
              {onNavigateToHooks && (
                <button
                  type="button"
                  onClick={onNavigateToHooks}
                  className={`font-medium ${text.muted} hover:text-white transition-colors inline-flex items-center gap-1`}
                >
                  configure globally
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Markdown report preview modal */}
      {reportPreview && (
        <Modal
          title={reportPreview.skillName}
          icon={<FileText className="w-4 h-4 text-pink-400" />}
          onClose={() => setReportPreview(null)}
          width="lg"
        >
          <div className="max-h-[60vh] overflow-y-auto">
            <MarkdownContent content={reportPreview.content} />
          </div>
        </Modal>
      )}
    </div>
  );
}

function StepList({
  steps,
  stepResults,
  runningSteps,
  runningAll,
  expandedSteps,
  setExpandedSteps,
  onRunSingle,
  nested,
}: {
  steps: HookStep[];
  stepResults: Record<string, StepResult>;
  runningSteps: Set<string>;
  runningAll: boolean;
  expandedSteps: Set<string>;
  setExpandedSteps: Dispatch<SetStateAction<Set<string>>>;
  onRunSingle: (stepId: string) => void;
  nested?: boolean;
}) {
  const toggleStep = (id: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className={`${nested ? "px-2" : "px-4"} py-[2.5px] space-y-[5px]`}>
      {steps.map((step) => {
        const disabled = step.enabled === false;
        const result = stepResults[step.id];
        const promptStep = isPromptStep(step);
        const isRunning = runningSteps.has(step.id);
        const hasCompletedResult = !!result && result.status !== "running";
        const isExpanded = expandedSteps.has(step.id);
        const statusToneClass =
          !disabled && hasCompletedResult && result?.status === "passed"
            ? "bg-teal-400/[0.02] border-teal-400/[0.12]"
            : !disabled && hasCompletedResult && result?.status === "failed"
              ? "bg-red-400/[0.02] border-red-400/[0.08]"
              : "";
        const cardClass =
          hasCompletedResult || disabled ? (statusToneClass ? "" : settings.card) : "";

        return (
          <div
            key={step.id}
            className={`relative rounded-lg border ${
              statusToneClass
                ? statusToneClass
                : !hasCompletedResult && !isRunning && !disabled
                  ? "border-dashed border-white/[0.08]"
                  : "border-white/[0.04]"
            } ${cardClass} overflow-visible ${disabled ? "opacity-50" : ""} ${
              isExpanded && result?.output ? "mb-2.5" : ""
            }`}
          >
            {/* {isRunning && <SweepingBorder />} */}
            <div className="flex items-center gap-2.5 px-3 py-2">
              {/* Type icon */}
              {promptStep ? (
                <MessageSquareText
                  className={`w-3.5 h-3.5 flex-shrink-0 ${disabled ? text.dimmed : "text-violet-400/70"}`}
                />
              ) : (
                <Terminal
                  className={`w-3.5 h-3.5 flex-shrink-0 ${disabled ? text.dimmed : text.muted}`}
                />
              )}

              <div
                className={`flex-1 flex items-center text-left min-w-0 ${
                  !disabled && !promptStep && result?.output ? "cursor-pointer" : ""
                }`}
                onClick={() => !disabled && !promptStep && result?.output && toggleStep(step.id)}
              >
                <span
                  className={`text-[11px] font-medium ${disabled ? text.dimmed : text.secondary}`}
                >
                  {step.name}
                </span>
                <span
                  className={`text-[10px] ${text.dimmed} ml-2 ${promptStep ? "" : "font-mono"}`}
                >
                  {promptStep ? step.prompt || "(no prompt text)" : step.command}
                </span>
              </div>

              {!disabled && !promptStep && result?.durationMs != null && (
                <span className={`text-[9px] ${text.dimmed} flex-shrink-0`}>
                  {formatDuration(result.durationMs)}
                </span>
              )}

              {!disabled && !promptStep && result?.output && (
                <button onClick={() => toggleStep(step.id)}>
                  <ChevronDown
                    className={`w-3 h-3 ${text.dimmed} transition-transform ${isExpanded ? "rotate-180" : ""}`}
                  />
                </button>
              )}

              {/* Status icon (right side, before run button) */}
              {disabled ? (
                <Ban className="w-3.5 h-3.5 text-white/[0.2] flex-shrink-0" />
              ) : isRunning ? (
                <Loader2 className="w-3.5 h-3.5 text-yellow-400 animate-spin flex-shrink-0" />
              ) : !promptStep && result ? (
                statusIcon(result.status)
              ) : null}

              {!disabled && !promptStep && !runningAll && (
                <button
                  onClick={() => onRunSingle(step.id)}
                  disabled={isRunning}
                  className="group/run p-1 rounded text-teal-400 hover:text-teal-300 hover:bg-teal-400/15 transition-colors disabled:opacity-50 flex-shrink-0"
                >
                  <Play className="w-3 h-3 group-hover/run:fill-current" />
                </button>
              )}
            </div>

            {isExpanded && result?.output && (
              <div className="px-3 pb-4 pt-1">
                <pre
                  className={`text-[10px] ${text.muted} whitespace-pre-wrap break-words font-mono leading-relaxed max-h-60 overflow-y-auto`}
                >
                  {result.output}
                </pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SkillList({
  skills,
  skillResultMap,
  expandedSkills,
  setExpandedSkills,
  onViewReport,
  nested,
}: {
  skills: Array<{ skillName: string; enabled: boolean; trigger?: HookSkillRef["trigger"] }>;
  skillResultMap: Map<string, SkillHookResult>;
  expandedSkills: Set<string>;
  setExpandedSkills: Dispatch<SetStateAction<Set<string>>>;
  onViewReport?: (filePath: string, skillName: string) => void;
  nested?: boolean;
}) {
  const toggleSkill = (name: string) => {
    setExpandedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className={`${nested ? "px-2" : "px-4"} py-[2.5px] space-y-[5px]`}>
      {skills.map((skill) => {
        const disabled = !skill.enabled;
        const key = skillResultKey(skill.skillName, skill.trigger);
        const result = skillResultMap.get(key);
        const isRunning = result?.status === "running";
        const hasCompletedResult = !!result && result.status !== "running";
        const isExpanded = expandedSkills.has(key);
        const statusToneClass =
          !disabled && hasCompletedResult && result?.success
            ? "bg-teal-400/[0.02] border-teal-400/[0.12]"
            : !disabled && hasCompletedResult && result && !result.success
              ? "bg-red-400/[0.02] border-red-400/[0.08]"
              : "";
        const cardClass =
          hasCompletedResult || disabled ? (statusToneClass ? "" : settings.card) : "";

        return (
          <div
            key={key}
            className={`relative rounded-lg border ${
              statusToneClass
                ? statusToneClass
                : !hasCompletedResult && !isRunning && !disabled
                  ? "border-dashed border-white/[0.08]"
                  : "border-white/[0.04]"
            } ${cardClass} overflow-visible ${disabled ? "opacity-50" : ""} ${
              isExpanded && (result?.content || result?.summary) ? "mb-2.5" : ""
            }`}
          >
            {/* {isRunning && <SweepingBorder />} */}
            <div className="flex items-center gap-2.5 px-3 py-2">
              {/* Type icon */}
              <Sparkles
                className={`w-3.5 h-3.5 flex-shrink-0 ${disabled ? text.dimmed : "text-pink-400/70"}`}
              />

              <div
                className={`flex-1 flex items-center text-left min-w-0 ${!disabled && (result?.content || result?.summary) && !isRunning ? "cursor-pointer" : ""}`}
                onClick={() => !disabled && result && !isRunning && toggleSkill(key)}
              >
                <span
                  className={`text-[11px] font-medium ${disabled ? text.dimmed : text.secondary}`}
                >
                  {skill.skillName}
                </span>
              </div>

              {/* View report link */}
              {!disabled && !isRunning && result?.filePath && onViewReport && (
                <button
                  onClick={() => onViewReport(result.filePath!, skill.skillName)}
                  className={`flex items-center gap-1 text-[10px] ${text.muted} hover:text-white transition-colors flex-shrink-0`}
                >
                  <FileText className="w-3 h-3" />
                  <span>View report</span>
                </button>
              )}

              {/* Expand toggle */}
              {!disabled && !isRunning && (result?.content || result?.summary) && (
                <button onClick={() => toggleSkill(key)}>
                  <ChevronDown
                    className={`w-3 h-3 ${text.dimmed} transition-transform ${isExpanded ? "rotate-180" : ""}`}
                  />
                </button>
              )}

              {/* Status icon (right side) */}
              {disabled ? (
                <Ban className="w-3.5 h-3.5 text-white/[0.2] flex-shrink-0" />
              ) : isRunning ? (
                <Loader2 className="w-3.5 h-3.5 text-yellow-400 animate-spin flex-shrink-0" />
              ) : result ? (
                result.success ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                ) : (
                  <X className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                )
              ) : null}
            </div>

            {/* Expanded content */}
            {isExpanded && !isRunning && (result?.content || result?.summary) && (
              <div className="px-3 pb-4 pt-1">
                {result?.summary && (
                  <p className={`text-[10px] ${text.muted} mb-1.5`}>{result.summary}</p>
                )}
                {result?.content && (
                  <pre
                    className={`text-[10px] ${text.muted} whitespace-pre-wrap break-words font-mono leading-relaxed max-h-60 overflow-y-auto`}
                  >
                    {result.content}
                  </pre>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
