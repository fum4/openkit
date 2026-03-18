import { readdirSync, readFileSync } from "fs";
import path from "path";

/**
 * Scans .env* files in a project directory and creates port-reference templates.
 * For each env var value containing a discovered port number, creates a template
 * like `http://localhost:${3000}/api` where `${3000}` is replaced with the offset
 * port at spawn time.
 */
export function detectEnvMapping(
  projectDir: string,
  discoveredPorts: number[],
): Record<string, string> {
  if (discoveredPorts.length === 0) return {};

  const mapping: Record<string, string> = {};

  const scanFile = (filePath: string) => {
    const content = readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;

      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      // Strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      // Check if value contains any discovered port
      let template = value;
      let hasPort = false;
      for (const port of discoveredPorts) {
        const portStr = String(port);
        if (template.includes(portStr)) {
          template = template.replaceAll(portStr, `\${${portStr}}`);
          hasPort = true;
        }
      }

      if (hasPort) {
        mapping[key] = template;
      }
    }
  };

  const scanDir = (dir: string) => {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === ".git") continue;
          scanDir(path.join(dir, entry.name));
        } else if (entry.isFile() && entry.name.startsWith(".env")) {
          scanFile(path.join(dir, entry.name));
        }
      }
    } catch {
      // Directory may not be readable
    }
  };

  scanDir(projectDir);
  return mapping;
}

/**
 * Resolves env var templates by replacing `${port}` placeholders with offset ports.
 */
export function resolveEnvTemplates(
  envMapping: Record<string, string>,
  offset: number,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, template] of Object.entries(envMapping)) {
    resolved[key] = template.replace(/\$\{(\d+)\}/g, (_, portStr) => {
      return String(parseInt(portStr, 10) + offset);
    });
  }
  return resolved;
}
