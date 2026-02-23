import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { CodingAgent } from "../hooks/api";
import { ClaudeIcon, CodexIcon, GeminiIcon, OpenCodeIcon } from "../icons";
import { input, text } from "../theme";

const AGENT_OPTIONS: Array<{ id: CodingAgent; label: string }> = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
  { id: "gemini", label: "Gemini" },
  { id: "opencode", label: "OpenCode" },
];

function AgentIcon({ agent }: { agent: CodingAgent }) {
  const iconClassName =
    agent === "claude"
      ? "w-3.5 h-3.5 text-[#D97757]"
      : agent === "codex"
        ? "w-3.5 h-3.5 text-white"
        : agent === "gemini"
          ? "w-3.5 h-3.5 text-[#8AB4FF]"
          : "w-3.5 h-3.5 text-[#78D0A9]";
  if (agent === "claude") return <ClaudeIcon className={iconClassName} />;
  if (agent === "codex") return <CodexIcon className={iconClassName} />;
  if (agent === "gemini") return <GeminiIcon className={iconClassName} />;
  return <OpenCodeIcon className={iconClassName} />;
}

export function AgentModelDropdown({
  value,
  onChange,
  className = "",
  disabled = false,
  triggerVariant = "full",
  iconSize = "md",
}: {
  value: CodingAgent;
  onChange: (agent: CodingAgent) => void;
  className?: string;
  disabled?: boolean;
  triggerVariant?: "full" | "icon";
  iconSize?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = useMemo(
    () => AGENT_OPTIONS.find((option) => option.id === value) ?? AGENT_OPTIONS[0],
    [value],
  );

  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
    }
  }, [disabled, open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {triggerVariant === "icon" ? (
        <button
          type="button"
          aria-disabled={disabled}
          onClick={() => {
            if (disabled) return;
            setOpen((prev) => !prev);
          }}
          className={`inline-flex items-center justify-center ${
            iconSize === "sm" ? "w-[30px] h-[30px]" : "w-8 h-8"
          } rounded-md bg-white/[0.04] border border-white/[0.06] ${
            disabled
              ? "opacity-50 cursor-not-allowed hover:bg-white/[0.04] hover:border-white/[0.06]"
              : "cursor-pointer hover:bg-white/[0.06] hover:border-white/[0.15]"
          } transition-colors duration-150`}
          title={`Auto-start agent: ${selected.label}`}
          aria-label={`Auto-start agent: ${selected.label}`}
        >
          <AgentIcon agent={selected.id} />
        </button>
      ) : (
        <button
          type="button"
          aria-disabled={disabled}
          onClick={() => {
            if (disabled) return;
            setOpen((prev) => !prev);
          }}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs bg-white/[0.04] border border-white/[0.06] ${input.text} ${
            disabled
              ? "opacity-50 cursor-not-allowed hover:bg-white/[0.04] hover:border-white/[0.06]"
              : "cursor-pointer hover:bg-white/[0.06] hover:border-white/[0.15]"
          } transition-colors duration-150 min-w-28`}
        >
          <AgentIcon agent={selected.id} />
          <span>{selected.label}</span>
          <ChevronDown className={`w-3 h-3 ${text.muted}`} />
        </button>
      )}

      {open && (
        <div className="absolute left-0 top-full mt-1 min-w-32 rounded-lg border border-white/[0.08] bg-[#11151d] shadow-xl p-1 z-20">
          {AGENT_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`w-full text-left px-2 py-1.5 text-[11px] rounded-md ${text.secondary} hover:${text.primary} hover:bg-white/[0.06] transition-colors duration-150 inline-flex items-center gap-2`}
              onClick={() => {
                setOpen(false);
                onChange(option.id);
              }}
            >
              <AgentIcon agent={option.id} />
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
