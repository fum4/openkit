import AnsiToHtml from "ansi-to-html";
import { useEffect, useMemo, useRef } from "react";

import type { WorktreeInfo } from "../../types";
import { text } from "../../theme";
import { Spinner } from "../Spinner";

const ansiConverter = new AnsiToHtml({
  fg: "#d4d4d4",
  bg: "transparent",
  newline: true,
  escapeXML: true,
});

interface LogsViewerProps {
  worktree: WorktreeInfo;
  isRunning: boolean;
  isCreating: boolean;
  visible?: boolean;
}

export function LogsViewer({ worktree, isRunning, isCreating, visible = true }: LogsViewerProps) {
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLPreElement>(null);
  const userScrolledUp = useRef(false);

  useEffect(() => {
    userScrolledUp.current = false;
  }, [worktree.id]);

  useEffect(() => {
    if (userScrolledUp.current) return;
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [worktree.logs]);

  const handleScroll = () => {
    const el = logsContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    userScrolledUp.current = !atBottom;
  };

  // Convert ANSI codes to HTML for colored log output
  // Note: ansiConverter has escapeXML: true which sanitizes any HTML in the input
  const logsHtml = useMemo(() => {
    if (!worktree.logs?.length) return null;
    return ansiConverter.toHtml(worktree.logs.join("\n"));
  }, [worktree.logs]);

  const shellStyle = { display: visible ? undefined : "none" };

  if (isRunning || isCreating) {
    return (
      <div
        className="flex-1 min-h-0 relative mx-1 mb-[4px] p-1 rounded-t-xl rounded-b-lg bg-[#07090d]"
        style={shellStyle}
      >
        <div className="h-full w-full min-h-0 rounded-t-lg rounded-b-md bg-black overflow-hidden px-2">
          <pre
            ref={logsContainerRef}
            onScroll={handleScroll}
            className={`h-full w-full min-h-0 ${text.secondary} text-xs font-mono py-3 overflow-y-auto`}
          >
            {logsHtml ? (
              // Safe: logs come from our own server process, and escapeXML sanitizes HTML
              <span dangerouslySetInnerHTML={{ __html: logsHtml }} />
            ) : isCreating ? (
              <span className={`flex items-center gap-2 ${text.muted}`}>
                <Spinner size="xs" />
                Initializing worktree...
              </span>
            ) : (
              "No logs yet."
            )}
            <div ref={logsEndRef} />
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 min-h-0 relative mx-1 mb-[4px] p-1 rounded-t-xl rounded-b-lg bg-[#07090d]"
      style={shellStyle}
    >
      <div
        className={`h-full w-full min-h-0 rounded-t-lg rounded-b-md bg-black overflow-hidden px-2 flex items-center justify-center ${text.dimmed} text-xs`}
      >
        Start this worktree to see logs
      </div>
    </div>
  );
}
