/**
 * Lazy Monaco Editor setup — configures locally-bundled workers on first use.
 *
 * Called once before the first DiffEditor mounts. Uses dynamic imports so
 * Monaco is code-split and only loaded when the diff viewer is opened,
 * avoiding OOM during production builds from eager bundling of the full package.
 */
import { loader } from "@monaco-editor/react";

let configured = false;

export async function ensureMonacoConfigured(): Promise<void> {
  if (configured) return;
  configured = true;

  const [
    monaco,
    { default: editorWorker },
    { default: tsWorker },
    { default: jsonWorker },
    { default: cssWorker },
    { default: htmlWorker },
  ] = await Promise.all([
    import("monaco-editor"),
    import("monaco-editor/esm/vs/editor/editor.worker?worker"),
    import("monaco-editor/esm/vs/language/typescript/ts.worker?worker"),
    import("monaco-editor/esm/vs/language/json/json.worker?worker"),
    import("monaco-editor/esm/vs/language/css/css.worker?worker"),
    import("monaco-editor/esm/vs/language/html/html.worker?worker"),
  ]);

  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === "typescript" || label === "javascript") return new tsWorker();
      if (label === "json") return new jsonWorker();
      if (label === "css" || label === "scss" || label === "less") return new cssWorker();
      if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
      return new editorWorker();
    },
  };

  loader.config({ monaco });
}
