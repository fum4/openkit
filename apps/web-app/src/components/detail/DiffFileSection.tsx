/**
 * Per-file collapsible section in the diff viewer content area.
 *
 * Renders a header bar with file info and, when expanded, lazy-fetches
 * the file content and renders a DiffMonacoEditor instance.
 */
import { ChevronDown, ChevronRight, Minus, Plus } from "lucide-react";
import { forwardRef, useCallback, useEffect, useRef, useState } from "react";

import { fetchDiffFileContent } from "../../hooks/api";
import { useServerUrlOptional } from "../../contexts/ServerContext";
import { log } from "../../logger";
import { palette } from "../../theme";
import type { DiffFileContentResponse, DiffFileInfo } from "../../types";
import { Tooltip } from "../Tooltip";
import { DIFF_STATUS_COLORS, DIFF_STATUS_LABELS } from "./diff-constants";
import { DiffMonacoEditor } from "./DiffMonacoEditor";

interface DiffFileSectionProps {
  file: DiffFileInfo;
  expanded: boolean;
  onToggle: () => void;
  viewMode: "unified" | "split";
  worktreeId: string;
  includeCommitted: boolean;
  refreshKey: number;
  /** Optional custom content fetcher. Overrides the default fetchDiffFileContent when provided. */
  fetchContent?: () => Promise<DiffFileContentResponse>;
  /** Optional stage/unstage action shown on hover in the file header. */
  stageAction?: () => void;
  /** Whether the action is "stage" or "unstage" — controls icon and tooltip. */
  stageActionType?: "stage" | "unstage";
}

export const DiffFileSection = forwardRef<HTMLDivElement, DiffFileSectionProps>(
  function DiffFileSection(
    {
      file,
      expanded,
      onToggle,
      viewMode,
      worktreeId,
      includeCommitted,
      refreshKey,
      fetchContent,
      stageAction,
      stageActionType,
    },
    ref,
  ) {
    const serverUrl = useServerUrlOptional();
    const [content, setContent] = useState<{ oldContent: string; newContent: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [diffReady, setDiffReady] = useState(false);
    const fetchingRef = useRef(false);
    const fetchContentRef = useRef(fetchContent);
    fetchContentRef.current = fetchContent;

    // Invalidate cached content on refresh or includeCommitted toggle
    useEffect(() => {
      setContent(null);
      setError(null);
      setDiffReady(false);
      fetchingRef.current = false;
    }, [refreshKey, includeCommitted]);

    const doFetch = useCallback(() => {
      if (content || fetchingRef.current || file.isBinary) return;
      fetchingRef.current = true;
      setError(null);

      const fetchPromise = fetchContentRef.current
        ? fetchContentRef.current()
        : fetchDiffFileContent(
            worktreeId,
            file.path,
            file.status,
            includeCommitted,
            file.oldPath,
            serverUrl,
          );

      fetchPromise
        .then((res) => {
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
        })
        .catch((err) => {
          fetchingRef.current = false;
          const msg = err instanceof Error ? err.message : "Failed to load file content";
          log.error("Failed to fetch file content", {
            domain: "diff",
            filePath: file.path,
            error: err,
          });
          setError(msg);
        });
    }, [content, file, worktreeId, includeCommitted, serverUrl]);

    // Fetch when expanded (if not already prefetched)
    useEffect(() => {
      if (expanded) doFetch();
    }, [expanded, doFetch]);

    const statusColor = DIFF_STATUS_COLORS[file.status];
    const Chevron = expanded ? ChevronDown : ChevronRight;

    return (
      <div ref={ref} className="border-b border-white/[0.04]">
        <div
          className="group w-full flex items-center gap-2 px-4 py-2 text-xs hover:bg-white/[0.03] transition-colors duration-100 cursor-pointer"
          role="button"
          tabIndex={0}
          onClick={onToggle}
          onMouseEnter={doFetch}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onToggle();
            }
          }}
        >
          <Chevron className="w-3.5 h-3.5 text-[#6b7280] flex-shrink-0" />
          <span className="text-[11px] text-[#9ca3af] truncate text-left">{file.path}</span>
          <span
            className="text-[10px] font-mono font-semibold flex-shrink-0"
            style={{ color: statusColor }}
          >
            {DIFF_STATUS_LABELS[file.status]}
          </span>
          {file.oldPath && (
            <span className="text-[10px] text-[#6b7280] truncate">(was {file.oldPath})</span>
          )}
          <span className="flex-1" />
          {stageAction ? (
            <span className="flex-shrink-0 flex items-center justify-end w-12 h-4">
              <span className="group-hover:hidden flex gap-1.5 text-[10px] font-mono">
                {!file.isBinary && file.linesAdded > 0 && (
                  <span style={{ color: palette.green }}>+{file.linesAdded}</span>
                )}
                {!file.isBinary && file.linesRemoved > 0 && (
                  <span style={{ color: palette.red }}>-{file.linesRemoved}</span>
                )}
              </span>
              <Tooltip text={stageActionType === "unstage" ? "Unstage" : "Stage"} position="left">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    stageAction();
                  }}
                  className="hidden group-hover:flex items-center p-0.5 rounded text-[#6b7280] hover:text-white hover:bg-white/[0.08]"
                >
                  {stageActionType === "unstage" ? (
                    <Minus className="w-3.5 h-3.5" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                </button>
              </Tooltip>
            </span>
          ) : (
            !file.isBinary &&
            (file.linesAdded > 0 || file.linesRemoved > 0) && (
              <span className="flex-shrink-0 flex gap-1.5 text-[10px] font-mono">
                {file.linesAdded > 0 && (
                  <span style={{ color: palette.green }}>+{file.linesAdded}</span>
                )}
                {file.linesRemoved > 0 && (
                  <span style={{ color: palette.red }}>-{file.linesRemoved}</span>
                )}
              </span>
            )
          )}
        </div>

        {expanded && (
          <div className={diffReady || file.isBinary || error ? "px-4" : ""}>
            {file.isBinary ? (
              <div className="text-xs text-[#6b7280] py-6 text-center">
                Binary file — cannot display diff
              </div>
            ) : error ? (
              <div className="text-xs text-red-400 py-6 text-center">{error}</div>
            ) : content ? (
              <div style={{ height: diffReady ? "auto" : 0, overflow: "hidden" }}>
                <DiffMonacoEditor
                  original={content.oldContent}
                  modified={content.newContent}
                  filePath={file.path}
                  viewMode={viewMode}
                  onReady={() => setDiffReady(true)}
                />
              </div>
            ) : null}
          </div>
        )}
      </div>
    );
  },
);
