/**
 * Per-file collapsible section in the diff viewer content area.
 *
 * Renders a header bar with file info and, when expanded, lazy-fetches
 * the file content and renders a DiffMonacoEditor instance.
 */
import { ChevronDown, ChevronRight } from "lucide-react";
import { forwardRef, useEffect, useState } from "react";

import { fetchDiffFileContent } from "../../hooks/api";
import { useServerUrlOptional } from "../../contexts/ServerContext";
import { log } from "../../logger";
import { palette } from "../../theme";
import type { DiffFileInfo } from "../../types";
import { DIFF_STATUS_COLORS, DIFF_STATUS_LABELS } from "./diff-constants";
import { DiffMonacoEditor } from "./DiffMonacoEditor";

interface DiffFileSectionProps {
  file: DiffFileInfo;
  expanded: boolean;
  onToggle: () => void;
  viewMode: "unified" | "split";
  worktreeId: string;
  includeCommitted: boolean;
}

export const DiffFileSection = forwardRef<HTMLDivElement, DiffFileSectionProps>(
  function DiffFileSection(
    { file, expanded, onToggle, viewMode, worktreeId, includeCommitted },
    ref,
  ) {
    const serverUrl = useServerUrlOptional();
    const [content, setContent] = useState<{ oldContent: string; newContent: string } | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      if (!expanded || content) return;
      if (file.isBinary) return;

      let cancelled = false;
      setLoading(true);
      setError(null);

      fetchDiffFileContent(
        worktreeId,
        file.path,
        file.status,
        includeCommitted,
        file.oldPath,
        serverUrl,
      ).then((res) => {
        if (cancelled) return;
        setLoading(false);
        if (!res.success) {
          log.error("Failed to fetch file content", {
            domain: "diff",
            filePath: file.path,
            error: res.error,
          });
          setError(res.error ?? "Failed to load file content");
          return;
        }
        setContent({ oldContent: res.oldContent, newContent: res.newContent });
      });

      return () => {
        cancelled = true;
      };
    }, [
      expanded,
      content,
      file.isBinary,
      file.path,
      file.status,
      file.oldPath,
      worktreeId,
      includeCommitted,
      serverUrl,
    ]);

    // Reset content when includeCommitted changes
    useEffect(() => {
      setContent(null);
      setError(null);
    }, [includeCommitted]);

    const statusColor = DIFF_STATUS_COLORS[file.status];
    const Chevron = expanded ? ChevronDown : ChevronRight;

    return (
      <div ref={ref} className="border-b border-white/[0.06]">
        <button
          type="button"
          onClick={onToggle}
          className="w-full flex items-center gap-2 px-4 py-2 text-xs hover:bg-white/[0.03] transition-colors duration-100"
        >
          <Chevron className="w-3.5 h-3.5 text-[#6b7280] flex-shrink-0" />
          <span className="font-mono text-[11px] text-white/90 truncate text-left">
            {file.path}
          </span>
          <span
            className="text-[10px] font-mono font-semibold flex-shrink-0"
            style={{ color: statusColor }}
            title={file.status}
          >
            {DIFF_STATUS_LABELS[file.status]}
          </span>
          {file.oldPath && (
            <span className="text-[10px] text-[#6b7280] truncate">(was {file.oldPath})</span>
          )}
          <span className="flex-1" />
          {!file.isBinary && (file.linesAdded > 0 || file.linesRemoved > 0) && (
            <span className="flex-shrink-0 flex gap-1.5 text-[10px] font-mono">
              {file.linesAdded > 0 && (
                <span style={{ color: palette.green }}>+{file.linesAdded}</span>
              )}
              {file.linesRemoved > 0 && (
                <span style={{ color: palette.red }}>-{file.linesRemoved}</span>
              )}
            </span>
          )}
        </button>

        {expanded && (
          <div className="px-4 pb-3">
            {file.isBinary ? (
              <div className="text-xs text-[#6b7280] py-6 text-center">
                Binary file — cannot display diff
              </div>
            ) : loading ? (
              <div className="text-xs text-[#6b7280] py-6 text-center animate-pulse">
                Loading diff...
              </div>
            ) : error ? (
              <div className="text-xs text-red-400 py-6 text-center">{error}</div>
            ) : content && content.oldContent === "" && content.newContent === "" ? (
              <div className="text-xs text-[#6b7280] py-6 text-center">
                File too large to display
              </div>
            ) : content ? (
              <DiffMonacoEditor
                original={content.oldContent}
                modified={content.newContent}
                filePath={file.path}
                viewMode={viewMode}
              />
            ) : null}
          </div>
        )}
      </div>
    );
  },
);
