import { useRef, useState, useCallback } from "react";

import { Tooltip } from "./Tooltip";

interface TruncatedTooltipProps {
  text: string;
  className?: string;
}

/**
 * Renders a truncated span that shows a Tooltip only when the text overflows.
 */
export function TruncatedTooltip({ text: content, className = "" }: TruncatedTooltipProps) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  const checkTruncation = useCallback(() => {
    const el = spanRef.current;
    if (el) setIsTruncated(el.scrollWidth > el.clientWidth);
  }, []);

  const span = (
    <span ref={spanRef} className={`truncate block ${className}`} onMouseEnter={checkTruncation}>
      {content}
    </span>
  );

  if (!isTruncated) return span;

  return (
    <Tooltip text={content} position="top">
      {span}
    </Tooltip>
  );
}
