import { text } from "../theme";

interface ClickToEditHintProps {
  className?: string;
}

export function ClickToEditHint({ className }: ClickToEditHintProps) {
  return (
    <p className={`text-xs ${text.dimmed}${className ? ` ${className}` : ""}`}>Click to edit</p>
  );
}
