/**
 * File list sidebar for the diff viewer tab.
 *
 * Groups files by directory into a collapsible folder tree.
 * Displays status icons, line-count badges, and highlights the
 * currently-visible file. When showStagingActions is true, splits
 * the list into "Staged Changes" and "Changes" sections with
 * per-file stage/unstage hover actions.
 */
import { ChevronDown, ChevronRight, Folder, FolderOpen, Minus, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { palette } from "../../theme";
import type { DiffFileInfo } from "../../types";
import { Tooltip } from "../Tooltip";
import { DIFF_STATUS_COLORS, DIFF_STATUS_LABELS } from "./diff-constants";

interface FolderNode {
  name: string;
  path: string;
  files: DiffFileInfo[];
  children: FolderNode[];
}

/** Group a flat file list into a folder tree. */
function buildFolderTree(files: DiffFileInfo[]): FolderNode {
  const root: FolderNode = { name: "", path: "", files: [], children: [] };

  for (const file of files) {
    const parts = file.path.split("/");
    let current = root;

    // Walk directory segments, creating folder nodes as needed
    for (let i = 0; i < parts.length - 1; i++) {
      const dirName = parts[i];
      const dirPath = parts.slice(0, i + 1).join("/");
      let child = current.children.find((c) => c.name === dirName);
      if (!child) {
        child = { name: dirName, path: dirPath, files: [], children: [] };
        current.children.push(child);
      }
      current = child;
    }

    current.files.push(file);
  }

  return root;
}

/** Flatten single-child folder chains: a/b/c → a/b/c (one node). */
function compactTree(node: FolderNode): FolderNode {
  // Recursively compact children first
  node.children = node.children.map(compactTree);

  // If a folder has exactly one child folder and no files, merge them
  while (node.children.length === 1 && node.files.length === 0 && node.name !== "") {
    const child = node.children[0];
    node.name = `${node.name}/${child.name}`;
    node.path = child.path;
    node.files = child.files;
    node.children = child.children;
  }

  return node;
}

interface DiffFileSidebarProps {
  files: DiffFileInfo[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  onStageFile?: (path: string) => void;
  onUnstageFile?: (path: string) => void;
  onStageAll?: () => void;
  showStagingActions?: boolean;
}

export function DiffFileSidebar({
  files,
  selectedFile,
  onSelectFile,
  onStageFile,
  onUnstageFile,
  onStageAll,
  showStagingActions,
}: DiffFileSidebarProps) {
  const stagedFiles = useMemo(() => files.filter((f) => f.staged === true), [files]);
  const unstagedFiles = useMemo(() => files.filter((f) => f.staged !== true), [files]);
  const stagedTree = useMemo(() => compactTree(buildFolderTree(stagedFiles)), [stagedFiles]);
  const unstagedTree = useMemo(() => compactTree(buildFolderTree(unstagedFiles)), [unstagedFiles]);
  const tree = useMemo(() => compactTree(buildFolderTree(files)), [files]);

  return (
    <div className="h-full overflow-y-auto py-1">
      {showStagingActions ? (
        <>
          {stagedFiles.length > 0 && (
            <>
              <SectionHeader title="Staged Changes" count={stagedFiles.length} />
              <FolderContents
                node={stagedTree}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
                depth={0}
                onAction={onUnstageFile}
                showAction
              />
            </>
          )}
          <SectionHeader
            title="Changes"
            count={unstagedFiles.length}
            action={onStageAll}
            actionIcon="plus"
          />
          <FolderContents
            node={unstagedTree}
            selectedFile={selectedFile}
            onSelectFile={onSelectFile}
            depth={0}
            onAction={onStageFile}
            showAction
          />
        </>
      ) : (
        <FolderContents
          node={tree}
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
          depth={0}
        />
      )}
    </div>
  );
}

function SectionHeader({
  title,
  count,
  action,
  actionIcon,
}: {
  title: string;
  count: number;
  action?: () => void;
  actionIcon?: "plus";
}) {
  return (
    <div className="group flex items-center justify-between px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#4b5563]">
      <span>
        {title} ({count})
      </span>
      {action && actionIcon === "plus" && (
        <Tooltip text="Stage all" position="bottom">
          <button
            type="button"
            onClick={action}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/[0.08]"
          >
            <Plus className="w-3 h-3 text-[#6b7280] hover:text-white" />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

function FolderContents({
  node,
  selectedFile,
  onSelectFile,
  depth,
  onAction,
  showAction,
}: {
  node: FolderNode;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  depth: number;
  onAction?: (path: string) => void;
  showAction?: boolean;
}) {
  return (
    <>
      {node.children.map((child) => (
        <FolderSection
          key={child.path}
          node={child}
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
          depth={depth}
          onAction={onAction}
          showAction={showAction}
        />
      ))}
      {node.files.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          isSelected={file.path === selectedFile}
          onSelect={onSelectFile}
          depth={depth}
          onAction={onAction}
          showAction={showAction}
        />
      ))}
    </>
  );
}

function FolderSection({
  node,
  selectedFile,
  onSelectFile,
  depth,
  onAction,
  showAction,
}: {
  node: FolderNode;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  depth: number;
  onAction?: (path: string) => void;
  showAction?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const FolderIcon = expanded ? FolderOpen : Folder;

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full text-left px-3 py-1 text-[11px] flex items-center gap-1.5 text-[#6b7280] hover:text-[#9ca3af] hover:bg-white/[0.03] transition-colors duration-100"
        style={{ paddingLeft: `${depth * 12 + 12}px` }}
      >
        <Chevron className="w-3 h-3 flex-shrink-0" />
        <FolderIcon className="w-3 h-3 flex-shrink-0 text-[#6b7280]" />
        <span className="truncate">{node.name}</span>
      </button>
      {expanded && (
        <FolderContents
          node={node}
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
          depth={depth + 1}
          onAction={onAction}
          showAction={showAction}
        />
      )}
    </>
  );
}

function FileRow({
  file,
  isSelected,
  onSelect,
  depth,
  onAction,
  showAction,
}: {
  file: DiffFileInfo;
  isSelected: boolean;
  onSelect: (path: string) => void;
  depth: number;
  onAction?: (path: string) => void;
  showAction?: boolean;
}) {
  const color = DIFF_STATUS_COLORS[file.status];
  const fileName = file.path.split("/").pop() ?? file.path;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(file.path)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(file.path);
        }
      }}
      className={`group w-full text-left py-1.5 text-[11px] flex items-center gap-2 transition-colors duration-100 cursor-pointer ${
        isSelected
          ? "bg-white/[0.08] text-white"
          : "text-[#9ca3af] hover:bg-white/[0.04] hover:text-white"
      }`}
      style={{ paddingLeft: `${depth * 12 + 12}px`, paddingRight: "12px" }}
    >
      <span
        className="flex-shrink-0 w-4 text-center font-mono text-[10px] font-semibold"
        style={{ color }}
        title={file.status}
      >
        {DIFF_STATUS_LABELS[file.status]}
      </span>
      <span className="min-w-0 flex-1 truncate" title={file.path}>
        {fileName}
      </span>
      {/* Right side: diff stats or stage/unstage action, swapped on hover */}
      {showAction && onAction ? (
        <span className="flex-shrink-0 flex items-center justify-end w-12 h-4">
          {/* Diff stats — visible by default, hidden on hover */}
          <span className="group-hover:hidden flex gap-1 text-[10px] font-mono">
            {!file.isBinary && file.linesAdded > 0 && (
              <span style={{ color: palette.green }}>+{file.linesAdded}</span>
            )}
            {!file.isBinary && file.linesRemoved > 0 && (
              <span style={{ color: palette.red }}>-{file.linesRemoved}</span>
            )}
          </span>
          {/* Stage/unstage button — hidden by default, shown on hover */}
          <Tooltip text={file.staged ? "Unstage" : "Stage"} position="right">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAction(file.path);
              }}
              className="hidden group-hover:flex items-center p-0.5 rounded hover:bg-white/[0.08]"
            >
              {file.staged ? (
                <Minus className="w-3.5 h-3.5 text-[#6b7280] hover:text-white" />
              ) : (
                <Plus className="w-3.5 h-3.5 text-[#6b7280] hover:text-white" />
              )}
            </button>
          </Tooltip>
        </span>
      ) : (
        !file.isBinary &&
        (file.linesAdded > 0 || file.linesRemoved > 0) && (
          <span className="flex-shrink-0 flex gap-1 text-[10px] font-mono">
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
  );
}
