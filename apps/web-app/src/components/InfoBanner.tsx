import { X } from "lucide-react";
import { type ReactNode, useState } from "react";

import { text } from "../theme";

type BannerColor = "teal" | "rose" | "amber" | "blue" | "brown";

const colorStyles: Record<BannerColor, { bg: string; border: string; dismiss: string }> = {
  teal: {
    bg: "bg-[#2dd4bf]/[0.04]",
    border: "border-[#2dd4bf]/[0.12]",
    dismiss: "hover:bg-[#2dd4bf]/10 text-[#2dd4bf]/40 hover:text-[#2dd4bf]/70",
  },
  rose: {
    bg: "bg-[#f97066]/[0.05]",
    border: "border-[#f97066]/[0.14]",
    dismiss: "hover:bg-[#f97066]/10 text-[#f97066]/40 hover:text-[#f97066]/70",
  },
  amber: {
    bg: "bg-amber-400/[0.04]",
    border: "border-amber-400/[0.12]",
    dismiss: "hover:bg-amber-400/10 text-amber-400/40 hover:text-amber-400/70",
  },
  blue: {
    bg: "bg-[#2563eb]/[0.08]",
    border: "border-[#3b82f6]/[0.25]",
    dismiss: "hover:bg-[#60a5fa]/10 text-[#60a5fa]/40 hover:text-[#60a5fa]/70",
  },
  brown: {
    bg: "bg-[#8a7560]/[0.05]",
    border: "border-[#8a7560]/[0.22]",
    dismiss: "hover:bg-[#8a7560]/10 text-[#8a7560]/40 hover:text-[#8a7560]/70",
  },
};

interface InfoBannerProps {
  storageKey: string;
  color?: BannerColor;
  children: ReactNode;
}

export function InfoBanner({ storageKey, color = "teal", children }: InfoBannerProps) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(storageKey, "1");
    } catch {
      // localStorage unavailable
    }
  };

  const styles = colorStyles[color];

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${styles.border} ${styles.bg}`}
    >
      <p className={`text-[11px] ${text.secondary} leading-relaxed flex-1`}>{children}</p>
      <button
        type="button"
        onClick={dismiss}
        className={`p-1 rounded-md ${styles.dismiss} transition-colors flex-shrink-0`}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
