import { button, text } from "../theme";

interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger" | "jira" | "linear" | "mcp" | "skill" | "task";
  size?: "sm" | "md";
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}

export function Button({
  children,
  onClick,
  type = "button",
  variant = "secondary",
  size = "sm",
  disabled,
  loading,
  className = "",
}: ButtonProps) {
  const sizeClass = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";

  const baseClass = `${sizeClass} font-medium rounded-lg transition-colors flex items-center gap-2 disabled:pointer-events-none`;

  const variantClasses = {
    primary: `${button.primary} disabled:bg-[#2dd4bf]/5 disabled:text-[#2dd4bf]/40`,
    secondary: `${text.muted} hover:${text.secondary} hover:bg-white/[0.04] disabled:opacity-50`,
    danger: "text-red-400 hover:bg-red-400/10 disabled:opacity-50",
    jira: "bg-blue-400/15 text-blue-400 hover:bg-blue-400/25 font-medium disabled:bg-blue-400/5 disabled:text-blue-400/40",
    linear:
      "bg-[#5E6AD2]/15 text-[#5E6AD2] hover:bg-[#5E6AD2]/25 font-medium disabled:bg-[#5E6AD2]/5 disabled:text-[#5E6AD2]/40",
    mcp: "bg-purple-400/15 text-purple-400 hover:bg-purple-400/25 font-medium disabled:bg-purple-400/5 disabled:text-purple-400/40",
    skill:
      "bg-pink-400/15 text-pink-400 hover:bg-pink-400/25 font-medium disabled:bg-pink-400/5 disabled:text-pink-400/40",
    task: "bg-amber-400/15 text-amber-400 hover:bg-amber-400/25 font-medium disabled:bg-amber-400/5 disabled:text-amber-400/40",
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`${baseClass} ${variantClasses[variant]} ${className}`}
    >
      {loading && (
        <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
      )}
      {children}
    </button>
  );
}
