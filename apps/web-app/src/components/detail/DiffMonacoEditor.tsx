/**
 * Monaco DiffEditor wrapper for the diff viewer tab.
 *
 * Renders a read-only diff view with a custom dark theme matching
 * the OpenKit color palette. Supports unified and side-by-side modes.
 */
import { DiffEditor } from "@monaco-editor/react";
import type { DiffOnMount } from "@monaco-editor/react";
import { useCallback, useState } from "react";
import { palette } from "../../theme";

const OPENKIT_THEME = "openkit-dark";
const MIN_EDITOR_HEIGHT = 80;

/** File extension to Monaco language mapping for common extensions. */
const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  md: "markdown",
  css: "css",
  scss: "scss",
  html: "html",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  sql: "sql",
  graphql: "graphql",
  svg: "xml",
  toml: "ini",
};

function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_LANGUAGE[ext] ?? "plaintext";
}

let themeRegistered = false;

interface DiffMonacoEditorProps {
  original: string;
  modified: string;
  filePath: string;
  viewMode: "unified" | "split";
  onReady?: () => void;
}

export function DiffMonacoEditor({
  original,
  modified,
  filePath,
  viewMode,
  onReady,
}: DiffMonacoEditorProps) {
  const language = detectLanguage(filePath);
  const [editorHeight, setEditorHeight] = useState(MIN_EDITOR_HEIGHT);

  const handleMount: DiffOnMount = useCallback((editor, monaco) => {
    if (!themeRegistered) {
      monaco.editor.defineTheme(OPENKIT_THEME, {
        base: "vs-dark",
        inherit: true,
        rules: [],
        colors: {
          "editor.background": palette.bg1,
          "diffEditor.insertedTextBackground": "#22543d25",
          "diffEditor.insertedLineBackground": "#22543d18",
          "diffEditor.removedTextBackground": "#74202025",
          "diffEditor.removedLineBackground": "#74202018",
          "diffEditorGutter.insertedLineBackground": "#22543d35",
          "diffEditorGutter.removedLineBackground": "#74202035",
          "diffEditorOverview.insertedForeground": "#34d39960",
          "diffEditorOverview.removedForeground": "#f8717160",
          "editorLineNumber.foreground": palette.text2,
          "editor.lineHighlightBackground": "#00000000",
          "editorOverviewRuler.addedForeground": "#34d39950",
          "editorOverviewRuler.deletedForeground": "#f8717150",
          "editorOverviewRuler.modifiedForeground": "#fbbf2450",
        },
      });
      themeRegistered = true;
    }
    monaco.editor.setTheme(OPENKIT_THEME);

    const updateHeight = () => {
      const modifiedHeight = editor.getModifiedEditor().getContentHeight();
      const originalHeight = editor.getOriginalEditor().getContentHeight();
      const contentHeight = Math.max(Math.max(modifiedHeight, originalHeight), MIN_EDITOR_HEIGHT);
      setEditorHeight(contentHeight);
    };

    // Give Monaco a tick to compute the diff and measure content, then show
    setTimeout(() => {
      updateHeight();
      onReady?.();
    });
  }, []);

  return (
    <div style={{ height: editorHeight }}>
      <DiffEditor
        height={editorHeight}
        language={language}
        original={original}
        modified={modified}
        theme={OPENKIT_THEME}
        onMount={handleMount}
        keepCurrentOriginalModel
        keepCurrentModifiedModel
        options={{
          readOnly: true,
          renderSideBySide: viewMode === "split",
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          scrollbar: {
            vertical: "hidden",
            horizontal: "auto",
            alwaysConsumeMouseWheel: false,
          },
          fixedOverflowWidgets: true,
          lineNumbers: "on",
          glyphMargin: false,
          folding: true,
          lineDecorationsWidth: 0,
          renderOverviewRuler: false,
          hideUnchangedRegions: { enabled: true },
          fontSize: 12,
          contextmenu: false,
          // Use inline diff for single-line changes so added/removed lines
          // align horizontally instead of nesting
          useInlineViewWhenSpaceIsLimited: false,
          renderIndicators: true,
          renderMarginRevertIcon: false,
        }}
      />
    </div>
  );
}
