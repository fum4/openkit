/**
 * Main container for the diff viewer tab.
 *
 * Fetches the file list, renders a sidebar (file list) on the left
 * and a scrollable content area (per-file diff sections) on the right.
 * Supports unified/side-by-side view modes and an "include committed" toggle.
 */
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Columns2,
  FileCode2,
  RefreshCw,
  Rows2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchDiffFiles, fetchPrDiffFiles, fetchPrDiffFileContent } from "../../hooks/api";
import { useServerUrlOptional } from "../../contexts/ServerContext";
import { log } from "../../logger";
import { border, detailTab, palette } from "../../theme";
import type { DiffFileInfo, PrDiffListResponse } from "../../types";
import type { WorktreeInfo } from "../../types";
import { ResizableHandle } from "../ResizableHandle";
import { ToggleSwitch } from "../ToggleSwitch";
import { Tooltip } from "../Tooltip";
import { DiffFileSidebar } from "./DiffFileSidebar";
import { DiffFileSection } from "./DiffFileSection";

interface DiffViewerTabProps {
  worktree: WorktreeInfo;
  visible: boolean;
}

const FILES_EXPANDED_THRESHOLD = 10;

export function DiffViewerTab({ worktree, visible }: DiffViewerTabProps) {
  const serverUrl = useServerUrlOptional();
  const [files, setFiles] = useState<DiffFileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");
  const [includeCommitted, setIncludeCommitted] = useState(false);
  const [showMergedDiff, setShowMergedDiff] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const stored = localStorage.getItem("openkit:diff-sidebar-width");
      return stored ? parseInt(stored, 10) || 224 : 224;
    } catch {
      return 224;
    }
  });
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;
  const [refreshKey, setRefreshKey] = useState(0);
  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const contentRef = useRef<HTMLDivElement>(null);
  const fetchCountRef = useRef(0);

  const isMerged = worktree.githubPrState === "merged";

  // Always fetch PR diff metadata for merged worktrees (needed for headSha comparison).
  // The actual diff data is cached with staleTime: Infinity so it's a single fetch.
  const prDiffQuery = useQuery<PrDiffListResponse>({
    queryKey: ["pr-diff", worktree.id],
    queryFn: () => fetchPrDiffFiles(worktree.id, serverUrl),
    enabled: isMerged && visible,
    staleTime: Infinity,
  });

  // Detect whether the user has committed new work after the PR was merged
  const hasPostMergeCommits =
    prDiffQuery.data?.success &&
    prDiffQuery.data.headSha &&
    prDiffQuery.data.localHeadSha &&
    prDiffQuery.data.headSha !== prDiffQuery.data.localHeadSha;

  // For non-merged worktrees, show Committed when there are commits ahead of base.
  // For merged worktrees, show Committed only when there are NEW commits after the merge.
  const showCommittedToggle =
    !showMergedDiff && (isMerged ? !!hasPostMergeCommits : (worktree.commitsAheadOfBase ?? 0) > 0);

  const fetchFiles = useCallback(async () => {
    const fetchId = ++fetchCountRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchDiffFiles(worktree.id, includeCommitted, serverUrl);
      if (fetchId !== fetchCountRef.current) return; // stale
      if (!res.success) {
        log.error("Failed to fetch diff files", {
          domain: "diff",
          worktreeId: worktree.id,
          error: res.error,
        });
        setError(res.error ?? "Failed to load changes");
        setFiles([]);
        return;
      }
      setFiles(res.files);
      setRefreshKey((k) => k + 1);
      // Surface partial/full errors from git operations
      if (res.error && res.files.length === 0) {
        setError(res.error);
      } else if (res.error) {
        log.warn("Partial diff error", { domain: "diff", error: res.error });
      }
      // Auto-expand if fewer than threshold
      if (res.files.length < FILES_EXPANDED_THRESHOLD) {
        setExpandedFiles(new Set(res.files.map((f) => f.path)));
      } else {
        setExpandedFiles(new Set());
      }
    } catch (err) {
      if (fetchId !== fetchCountRef.current) return; // stale
      const message = err instanceof Error ? err.message : "Failed to load changes";
      log.error("Failed to fetch diff files", {
        domain: "diff",
        worktreeId: worktree.id,
        error: message,
      });
      setError(message);
      setFiles([]);
    } finally {
      if (fetchId === fetchCountRef.current) {
        setLoading(false);
      }
    }
  }, [worktree.id, includeCommitted, serverUrl]);

  // Fetch when tab becomes visible, worktree changes, or includeCommitted toggles.
  // Skip when merged diff is active OR when the smart default will auto-enable it.
  useEffect(() => {
    if (!visible || showMergedDiff) return;
    fetchFiles();
  }, [
    visible,
    worktree.id,
    includeCommitted,
    fetchFiles,
    showMergedDiff,
    isMerged,
    worktree.hasUncommitted,
  ]);

  // Best-effort refresh when hasUncommitted changes
  useEffect(() => {
    if (!visible || showMergedDiff) return;
    fetchFiles();
  }, [worktree.hasUncommitted]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset state when switching worktrees
  const prevWorktreeId = useRef(worktree.id);
  useEffect(() => {
    if (prevWorktreeId.current === worktree.id) return;
    prevWorktreeId.current = worktree.id;
    setShowMergedDiff(false);
    setFiles([]);
    setError(null);
    setLoading(true);
    setIncludeCommitted(false);
    setExpandedFiles(new Set());
    setSelectedFile(null);
  }, [worktree.id]);

  // Clear stale files when toggling between local and merged modes
  const prevShowMerged = useRef(showMergedDiff);
  useEffect(() => {
    if (prevShowMerged.current === showMergedDiff) return;
    prevShowMerged.current = showMergedDiff;
    setFiles([]);
    setError(null);
    setLoading(true);
  }, [showMergedDiff]);

  // Sync merged PR diff data into component state
  useEffect(() => {
    if (!showMergedDiff) return;
    // Keep loading until we have data or an error — covers the gap where the query
    // is pending but hasn't started fetching yet (e.g. between enable and first fetch).
    if (prDiffQuery.isLoading || (!prDiffQuery.data && !prDiffQuery.error)) {
      setLoading(true);
      setError(null);
      return;
    }
    setLoading(false);
    if (prDiffQuery.error) {
      setError(
        prDiffQuery.error instanceof Error ? prDiffQuery.error.message : "Failed to load PR diff",
      );
      setFiles([]);
      return;
    }
    if (prDiffQuery.data) {
      if (!prDiffQuery.data.success) {
        setError(prDiffQuery.data.error ?? "Failed to load PR diff");
        setFiles([]);
        return;
      }
      setFiles(prDiffQuery.data.files);
      setRefreshKey((k) => k + 1);
      if (prDiffQuery.data.files.length < FILES_EXPANDED_THRESHOLD) {
        setExpandedFiles(new Set(prDiffQuery.data.files.map((f) => f.path)));
      } else {
        setExpandedFiles(new Set());
      }
    }
  }, [showMergedDiff, prDiffQuery.isLoading, prDiffQuery.data, prDiffQuery.error]);

  const handleRefresh = useCallback(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleSelectFile = useCallback((path: string) => {
    setSelectedFile(path);
    // Expand if collapsed
    setExpandedFiles((prev) => {
      if (prev.has(path)) return prev;
      const next = new Set(prev);
      next.add(path);
      return next;
    });
    // Scroll to file section
    const el = fileRefs.current.get(path);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const handleToggleFile = useCallback((path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    setExpandedFiles(new Set(files.map((f) => f.path)));
  }, [files]);

  const handleCollapseAll = useCallback(() => {
    setExpandedFiles(new Set());
  }, []);

  const setFileRef = useCallback((path: string, el: HTMLDivElement | null) => {
    if (el) {
      fileRefs.current.set(path, el);
    } else {
      fileRefs.current.delete(path);
    }
  }, []);

  // Track which file is visible via IntersectionObserver
  useEffect(() => {
    if (!visible || files.length === 0) return;
    const container = contentRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const path = (entry.target as HTMLElement).dataset.filePath;
            if (path) setSelectedFile(path);
            break;
          }
        }
      },
      { root: container, threshold: 0.3 },
    );

    for (const [, el] of fileRefs.current) {
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, [visible, files]);

  const totalAdded = useMemo(() => files.reduce((sum, f) => sum + f.linesAdded, 0), [files]);
  const totalRemoved = useMemo(() => files.reduce((sum, f) => sum + f.linesRemoved, 0), [files]);

  const prBaseSha = prDiffQuery.data?.baseSha;
  const prMergeSha = prDiffQuery.data?.mergeSha;
  const prDataSuccess = prDiffQuery.data?.success;

  const makePrFetchContent = useCallback(
    (file: DiffFileInfo) => () =>
      fetchPrDiffFileContent(
        worktree.id,
        file.path,
        file.status,
        prBaseSha!,
        prMergeSha!,
        file.oldPath,
        serverUrl,
      ),
    [worktree.id, prBaseSha, prMergeSha, serverUrl],
  );

  if (!visible) return null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-white/[0.04]">
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-[#6b7280]">
            {files.length} {files.length === 1 ? "file" : "files"} changed
          </span>
          {(totalAdded > 0 || totalRemoved > 0) && (
            <span className="flex gap-1.5 text-[10px] font-mono">
              {totalAdded > 0 && <span style={{ color: palette.green }}>+{totalAdded}</span>}
              {totalRemoved > 0 && <span style={{ color: palette.red }}>-{totalRemoved}</span>}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {isMerged && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-[#6b7280] select-none">Show merged</span>
              <ToggleSwitch
                checked={showMergedDiff}
                onToggle={() => setShowMergedDiff((prev) => !prev)}
                size="sm"
              />
            </div>
          )}
          {showCommittedToggle && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-[#6b7280] select-none">Show committed</span>
              <ToggleSwitch
                checked={includeCommitted}
                onToggle={() => setIncludeCommitted((prev) => !prev)}
                size="sm"
              />
            </div>
          )}
          <div className="w-px h-4 bg-white/[0.08] mx-1" />
          <Tooltip text={viewMode === "unified" ? "Side-by-side" : "Unified"} position="bottom">
            <button
              type="button"
              onClick={() => setViewMode(viewMode === "unified" ? "split" : "unified")}
              className={`p-1 rounded transition-colors ${detailTab.inactive}`}
            >
              {viewMode === "unified" ? (
                <Columns2 className="w-3.5 h-3.5" />
              ) : (
                <Rows2 className="w-3.5 h-3.5" />
              )}
            </button>
          </Tooltip>
          <Tooltip text="Expand all" position="bottom">
            <button
              type="button"
              onClick={handleExpandAll}
              className={`p-1 rounded transition-colors ${detailTab.inactive}`}
            >
              <ChevronsUpDown className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Tooltip text="Collapse all" position="bottom">
            <button
              type="button"
              onClick={handleCollapseAll}
              className={`p-1 rounded transition-colors ${detailTab.inactive}`}
            >
              <ChevronsDownUp className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Tooltip text="Refresh" position="bottom">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              aria-label="Refresh"
              className={`p-1 rounded transition-colors ${detailTab.inactive} disabled:opacity-50`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Main area */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        {files.length > 0 && (
          <>
            <div
              className={`flex-shrink-0 border-r ${border.subtle} bg-[#0f1116] overflow-hidden shadow-[inset_0_2px_4px_rgba(0,0,0,0.2),inset_-2px_0_4px_rgba(0,0,0,0.15)]`}
              style={{ width: sidebarWidth, minWidth: 140, maxWidth: 480 }}
            >
              <DiffFileSidebar
                files={files}
                selectedFile={selectedFile}
                onSelectFile={handleSelectFile}
              />
            </div>
            <ResizableHandle
              onResize={(delta) => setSidebarWidth((w) => Math.min(480, Math.max(140, w + delta)))}
              onResizeEnd={() =>
                localStorage.setItem("openkit:diff-sidebar-width", String(sidebarWidthRef.current))
              }
            />
          </>
        )}

        {/* Content */}
        <div ref={contentRef} className="flex-1 min-w-0 overflow-y-auto">
          {loading && files.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-xs text-[#6b7280] animate-pulse">Loading changes...</div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-xs text-red-400">{error}</div>
            </div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-1.5">
              <FileCode2 className="w-7 h-7 text-[#4b5563] mb-3" strokeWidth={1.5} />
              <span className="text-[13px] font-medium tracking-[-0.01em] text-[#6b7280]">
                {showMergedDiff ? "Could not load PR changes" : "No changes detected"}
              </span>
              <span className="text-[11px] text-[#4b5563] max-w-[240px] text-center leading-relaxed">
                {showMergedDiff
                  ? "The PR diff could not be fetched from GitHub"
                  : "Start coding or run an agent — diffs will appear here automatically"}
              </span>
            </div>
          ) : (
            files.map((file) => (
              <DiffFileSection
                key={file.path}
                ref={(el) => {
                  setFileRef(file.path, el);
                  // Set data attribute for IntersectionObserver
                  if (el) el.dataset.filePath = file.path;
                }}
                file={file}
                expanded={expandedFiles.has(file.path)}
                onToggle={() => handleToggleFile(file.path)}
                viewMode={viewMode}
                worktreeId={worktree.id}
                includeCommitted={includeCommitted}
                refreshKey={refreshKey}
                fetchContent={
                  showMergedDiff && prDataSuccess ? makePrFetchContent(file) : undefined
                }
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
