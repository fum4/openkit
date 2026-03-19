/**
 * File list sidebar for the diff viewer tab.
 *
 * Groups files by directory into a collapsible folder tree.
 * Displays status icons, line-count badges, and highlights the
 * currently-visible file.
 */
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import { useMemo, useState } from "react";

import { palette } from "../../theme";
import type { DiffFileInfo } from "../../types";
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
}

export function DiffFileSidebar({ files, selectedFile, onSelectFile }: DiffFileSidebarProps) {
  const tree = useMemo(() => compactTree(buildFolderTree(files)), [files]);

  return (
    <div className="h-full overflow-y-auto py-1">
      <FolderContents
        node={tree}
        selectedFile={selectedFile}
        onSelectFile={onSelectFile}
        depth={0}
      />
    </div>
  );
}

function FolderContents({
  node,
  selectedFile,
  onSelectFile,
  depth,
}: {
  node: FolderNode;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  depth: number;
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
        />
      ))}
      {node.files.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          isSelected={file.path === selectedFile}
          onSelect={onSelectFile}
          depth={depth}
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
}: {
  node: FolderNode;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  depth: number;
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
}: {
  file: DiffFileInfo;
  isSelected: boolean;
  onSelect: (path: string) => void;
  depth: number;
}) {
  const color = DIFF_STATUS_COLORS[file.status];
  const fileName = file.path.split("/").pop() ?? file.path;

  return (
    <button
      type="button"
      onClick={() => onSelect(file.path)}
      className={`w-full text-left py-1.5 text-[11px] flex items-center gap-2 transition-colors duration-100 ${
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
      {(file.linesAdded > 0 || file.linesRemoved > 0) && !file.isBinary && (
        <span className="flex-shrink-0 flex gap-1 text-[10px] font-mono">
          {file.linesAdded > 0 && <span style={{ color: palette.green }}>+{file.linesAdded}</span>}
          {file.linesRemoved > 0 && (
            <span style={{ color: palette.red }}>-{file.linesRemoved}</span>
          )}
        </span>
      )}
    </button>
  );
}
