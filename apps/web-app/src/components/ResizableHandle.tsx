import { useCallback, useEffect, useRef, useState } from "react";

interface ResizableHandleProps {
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
}

export function ResizableHandle({ onResize, onResizeEnd }: ResizableHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startXRef.current = e.clientX;
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current;
      startXRef.current = e.clientX;
      onResize(delta);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      onResizeEnd?.();
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    // Add cursor style to body during drag
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging, onResize, onResizeEnd]);

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`
        w-1 flex-shrink-0 cursor-col-resize
        hover:bg-[#2dd4bf]/30 active:bg-[#2dd4bf]/50
        transition-colors duration-150
        ${isDragging ? "bg-[#2dd4bf]/50" : "bg-transparent"}
      `}
      style={{ marginLeft: "-2px", marginRight: "-2px" }}
    />
  );
}
