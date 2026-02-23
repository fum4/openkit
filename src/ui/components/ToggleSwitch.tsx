import type { MouseEvent } from "react";

type ToggleSwitchSize = "sm" | "md";

const SIZE_CLASSES: Record<
  ToggleSwitchSize,
  { track: string; thumb: string; thumbOn: string; thumbOff: string }
> = {
  sm: {
    track: "w-6 h-3.5",
    thumb: "top-0.5 w-2.5 h-2.5",
    thumbOn: "left-[11px]",
    thumbOff: "left-0.5",
  },
  md: {
    track: "w-7 h-4",
    thumb: "top-0.5 w-3 h-3",
    thumbOn: "left-3.5",
    thumbOff: "left-0.5",
  },
};

interface ToggleSwitchProps {
  checked: boolean;
  onToggle?: (event: MouseEvent<HTMLButtonElement>) => void;
  interactive?: boolean;
  disabled?: boolean;
  size?: ToggleSwitchSize;
  className?: string;
  title?: string;
  ariaLabel?: string;
  checkedTrackClassName?: string;
  uncheckedTrackClassName?: string;
  checkedThumbClassName?: string;
  uncheckedThumbClassName?: string;
}

export function ToggleSwitch({
  checked,
  onToggle,
  interactive = true,
  disabled = false,
  size = "md",
  className = "",
  title,
  ariaLabel,
  checkedTrackClassName = "bg-accent/35",
  uncheckedTrackClassName = "bg-white/[0.08]",
  checkedThumbClassName = "bg-accent",
  uncheckedThumbClassName = "bg-white/40",
}: ToggleSwitchProps) {
  const sizeClasses = SIZE_CLASSES[size];
  const cursorClass = interactive
    ? disabled
      ? "opacity-50 cursor-not-allowed"
      : "cursor-pointer"
    : "cursor-default";
  const cursorStyle = {
    cursor: interactive ? (disabled ? "not-allowed" : "pointer") : "default",
  } as const;
  const trackClassName = `relative ${sizeClasses.track} rounded-full transition-colors duration-200 flex-shrink-0 ${cursorClass} ${checked ? checkedTrackClassName : uncheckedTrackClassName} ${className}`;
  const thumbClassName = `absolute ${sizeClasses.thumb} rounded-full transition-all duration-200 ${checked ? `${sizeClasses.thumbOn} ${checkedThumbClassName}` : `${sizeClasses.thumbOff} ${uncheckedThumbClassName}`}`;

  if (!interactive) {
    return (
      <span aria-hidden="true" className={trackClassName} style={cursorStyle}>
        <span className={thumbClassName} />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(event) => onToggle?.(event)}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={trackClassName}
      style={cursorStyle}
    >
      <span className={thumbClassName} />
    </button>
  );
}
