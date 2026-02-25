import { cloneElement, useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

type TooltipPosition = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  text: React.ReactNode;
  children: React.ReactElement<Record<string, unknown>>;
  position?: TooltipPosition;
  delay?: number;
}

function getTooltipStyle(rect: DOMRect, position: TooltipPosition): React.CSSProperties {
  switch (position) {
    case "top":
      return { left: rect.left + rect.width / 2, top: rect.top };
    case "bottom":
      return { left: rect.left + rect.width / 2, top: rect.bottom };
    case "left":
      return { left: rect.left, top: rect.top + rect.height / 2 };
    case "right":
      return { left: rect.right, top: rect.top + rect.height / 2 };
  }
}

const transformClass: Record<TooltipPosition, string> = {
  top: "-translate-x-1/2 -translate-y-full -mt-1.5",
  bottom: "-translate-x-1/2 mt-1.5",
  left: "-translate-x-full -translate-y-1/2 -ml-1.5",
  right: "-translate-y-1/2 ml-1.5",
};

export function Tooltip({ text, children, position = "top", delay = 0 }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback(() => {
    if (delay > 0) {
      timeoutRef.current = setTimeout(() => setVisible(true), delay);
    } else {
      setVisible(true);
    }
  }, [delay]);

  const hide = useCallback(() => {
    clearTimeout(timeoutRef.current);
    setVisible(false);
  }, []);

  useEffect(() => {
    if (!visible || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setStyle(getTooltipStyle(rect, position));
  }, [visible, position]);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  const child = cloneElement(children, {
    ref: triggerRef,
    onMouseEnter: (e: React.MouseEvent) => {
      show();
      if (typeof children.props.onMouseEnter === "function") {
        (children.props.onMouseEnter as (e: React.MouseEvent) => void)(e);
      }
    },
    onMouseLeave: (e: React.MouseEvent) => {
      hide();
      if (typeof children.props.onMouseLeave === "function") {
        (children.props.onMouseLeave as (e: React.MouseEvent) => void)(e);
      }
    },
  });

  return (
    <>
      {child}
      {visible &&
        style &&
        createPortal(
          <div className="fixed z-[9999] pointer-events-none" style={style}>
            <div
              className={`relative ${transformClass[position]} px-2 rounded-md bg-black border border-white/[0.12] shadow-[0_2px_8px_rgba(0,0,0,0.5)] flex items-center h-[26px]`}
            >
              <span className="text-[11.5px] text-[#b0b8c4] whitespace-nowrap">{text}</span>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
