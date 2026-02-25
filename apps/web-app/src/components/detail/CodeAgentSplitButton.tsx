import { useEffect, useMemo, useRef, useState } from "react";

import { ClaudeIcon, CodexIcon, GeminiIcon, OpenCodeIcon } from "../../icons";
import { button, text } from "../../theme";

export type CodingAgent = "claude" | "codex" | "gemini" | "opencode";

interface AgentOption {
  id: CodingAgent;
  label: string;
}

interface CodeAgentSplitButtonProps {
  selectedAgent: CodingAgent;
  onSelectAgent: (agent: CodingAgent) => void;
  onLaunch: (agent: CodingAgent) => void;
  disabled?: boolean;
  isLoading?: boolean;
  loadingLabel?: string;
}

const AGENT_OPTIONS: AgentOption[] = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
  { id: "gemini", label: "Gemini" },
  { id: "opencode", label: "OpenCode" },
];

function AgentIcon({
  agent,
  className = "w-3.5 h-3.5",
}: {
  agent: CodingAgent;
  className?: string;
}) {
  if (agent === "claude") {
    return <ClaudeIcon className={className} />;
  }
  if (agent === "codex") {
    return <CodexIcon className={className} />;
  }
  if (agent === "gemini") {
    return <GeminiIcon className={className} />;
  }
  return <OpenCodeIcon className={className} />;
}

function getMainIconClassName(agent: CodingAgent): string {
  if (agent === "claude") {
    return "text-[#6b7280] group-hover:text-[#D97757] [&>svg]:text-inherit";
  }
  if (agent === "gemini") {
    return "text-[#6b7280] group-hover:text-[#8AB4FF] [&>svg]:text-inherit";
  }
  if (agent === "opencode") {
    return "text-[#6b7280] group-hover:text-[#78D0A9] [&>svg]:text-inherit";
  }
  return "text-[#6b7280] group-hover:text-white [&>svg]:text-inherit";
}

function getMenuIconClassName(agent: CodingAgent): string {
  if (agent === "claude") return "text-[#D97757]";
  if (agent === "gemini") return "text-[#8AB4FF]";
  if (agent === "opencode") return "text-[#78D0A9]";
  return "text-white";
}

export function CodeAgentSplitButton({
  selectedAgent,
  onSelectAgent,
  onLaunch,
  disabled = false,
  isLoading = false,
  loadingLabel = "Opening...",
}: CodeAgentSplitButtonProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedOption = useMemo(
    () => AGENT_OPTIONS.find((option) => option.id === selectedAgent) ?? AGENT_OPTIONS[0],
    [selectedAgent],
  );

  useEffect(() => {
    if (!isMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMenuOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isMenuOpen]);

  return (
    <div className="relative inline-flex" ref={menuRef}>
      <button
        type="button"
        onClick={() => onLaunch(selectedOption.id)}
        disabled={disabled || isLoading}
        className={`group inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${button.secondary} rounded-l-lg border-r border-white/[0.06] transition-colors duration-150 disabled:opacity-50`}
      >
        <AgentIcon
          agent={selectedOption.id}
          className={`w-3.5 h-3.5 transition-colors ${getMainIconClassName(selectedOption.id)}`}
        />
        {isLoading ? loadingLabel : `Code with ${selectedOption.label}`}
      </button>
      <button
        type="button"
        onClick={() => setIsMenuOpen((prev) => !prev)}
        disabled={disabled || isLoading}
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        title="Choose coding agent"
        className={`group inline-flex items-center px-2 py-1.5 text-xs font-medium ${button.secondary} rounded-r-lg transition-colors duration-150 disabled:opacity-50`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="w-3 h-3 text-[#6b7280] group-hover:text-white transition-colors"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.512a.75.75 0 0 1-1.08 0L5.21 8.268a.75.75 0 0 1 .02-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {isMenuOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-44 rounded-lg border border-white/[0.08] bg-[#11151d] shadow-xl p-1 z-20"
        >
          {AGENT_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitem"
              className={`w-full text-left px-2 py-1.5 text-[11px] rounded-md ${text.secondary} hover:${text.primary} hover:bg-white/[0.06] transition-colors duration-150 inline-flex items-center gap-2`}
              onClick={() => {
                setIsMenuOpen(false);
                onSelectAgent(option.id);
                onLaunch(option.id);
              }}
            >
              <AgentIcon
                agent={option.id}
                className={`w-3.5 h-3.5 ${getMenuIconClassName(option.id)}`}
              />
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
