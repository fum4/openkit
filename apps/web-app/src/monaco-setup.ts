/**
 * Configure Monaco Editor to use locally-bundled workers instead of CDN.
 *
 * Without this, @monaco-editor/react loads Monaco from jsDelivr CDN by default,
 * which causes cross-origin "Script error." events when workers fail to load.
 * This setup uses the locally installed `monaco-editor` package and Vite's
 * `?worker` import to create blob-URL workers that avoid CORS issues.
 */
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";

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
