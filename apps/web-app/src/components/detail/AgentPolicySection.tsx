import { useNotes } from "../../hooks/useNotes";
import { text } from "../../theme";
import type { GitPolicyOverride } from "../../hooks/api";

const OPTIONS: { value: GitPolicyOverride; label: string }[] = [
  { value: "inherit", label: "Inherit" },
  { value: "allow", label: "Allow" },
  { value: "deny", label: "Deny" },
];

function getSelectedStyle(value: GitPolicyOverride, opt: GitPolicyOverride): string {
  if (value !== opt) return "text-[#4b5563] hover:text-[#6b7280]";
  if (opt === "allow") return "bg-teal-500/[0.15] text-teal-300";
  if (opt === "deny") return "bg-red-500/[0.15] text-red-300";
  return "bg-white/[0.10] text-[#f0f2f5]";
}

function ThreeStateToggle({
  value,
  onChange,
}: {
  value: GitPolicyOverride;
  onChange: (v: GitPolicyOverride) => void;
}) {
  return (
    <div className="flex gap-0.5 bg-white/[0.04] rounded-lg p-0.5">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-2 py-0.5 text-[10px] font-medium rounded-md transition-colors ${getSelectedStyle(value, opt.value)}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

interface AgentPolicySectionProps {
  source: "jira" | "linear" | "local";
  issueId: string;
}

export function AgentPolicySection({ source, issueId }: AgentPolicySectionProps) {
  const { notes, updateGitPolicy } = useNotes(source, issueId);

  const commitValue: GitPolicyOverride = notes?.gitPolicy?.agentCommits ?? "inherit";
  const pushValue: GitPolicyOverride = notes?.gitPolicy?.agentPushes ?? "inherit";
  const prValue: GitPolicyOverride = notes?.gitPolicy?.agentPRs ?? "inherit";

  return (
    <section>
      <h3 className={`text-[11px] font-medium ${text.muted} mb-3`}>Agent Git Policy</h3>
      <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className={`text-[11px] ${text.secondary}`}>Commits</span>
          <ThreeStateToggle
            value={commitValue}
            onChange={(v) => updateGitPolicy({ agentCommits: v })}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className={`text-[11px] ${text.secondary}`}>Push</span>
          <ThreeStateToggle
            value={pushValue}
            onChange={(v) => updateGitPolicy({ agentPushes: v })}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className={`text-[11px] ${text.secondary}`}>Pull Requests</span>
          <ThreeStateToggle value={prValue} onChange={(v) => updateGitPolicy({ agentPRs: v })} />
        </div>
      </div>
    </section>
  );
}
