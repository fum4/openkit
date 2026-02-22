import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { execFileSync } from "child_process";
import os from "os";
import path from "path";
import type { Hono } from "hono";

import type { WorktreeManager } from "../manager";
import { type AgentId, SKILL_AGENT_SPECS, resolveSkillDeployDir } from "../lib/tool-configs";
import { BUNDLED_SKILLS } from "../../instructions";

// ─── SKILL.md parsing ───────────────────────────────────────────

interface SkillFrontmatter {
  name: string;
  description: string;
  allowedTools: string;
  context: string;
  agent: string;
  model: string;
  argumentHint: string;
  disableModelInvocation: boolean;
  userInvocable: boolean;
  mode: boolean;
}

const EMPTY_FRONTMATTER: SkillFrontmatter = {
  name: "",
  description: "",
  allowedTools: "",
  context: "",
  agent: "",
  model: "",
  argumentHint: "",
  disableModelInvocation: false,
  userInvocable: true,
  mode: false,
};

function parseBool(value: string, defaultValue: boolean): boolean {
  const v = value.toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  return defaultValue;
}

function parseSkillMd(content: string): { frontmatter: SkillFrontmatter; body: string } {
  const fm: SkillFrontmatter = { ...EMPTY_FRONTMATTER };

  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: fm, body: content };
  }

  const yamlBlock = match[1];
  const body = match[2];

  for (const line of yamlBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    switch (key) {
      case "name":
        fm.name = value;
        break;
      case "description":
        fm.description = value;
        break;
      case "allowed-tools":
        fm.allowedTools = value;
        break;
      case "context":
        fm.context = value;
        break;
      case "agent":
        fm.agent = value;
        break;
      case "model":
        fm.model = value;
        break;
      case "argument-hint":
        fm.argumentHint = value;
        break;
      case "disable-model-invocation":
        fm.disableModelInvocation = parseBool(value, false);
        break;
      case "user-invocable":
        fm.userInvocable = parseBool(value, true);
        break;
      case "mode":
        fm.mode = parseBool(value, false);
        break;
    }
  }

  return { frontmatter: fm, body };
}

function buildSkillMd(frontmatter: SkillFrontmatter, body: string): string {
  const lines = ["---"];
  if (frontmatter.name) lines.push(`name: ${frontmatter.name}`);
  if (frontmatter.description) lines.push(`description: ${frontmatter.description}`);
  if (frontmatter.allowedTools) lines.push(`allowed-tools: ${frontmatter.allowedTools}`);
  if (frontmatter.context) lines.push(`context: ${frontmatter.context}`);
  if (frontmatter.agent) lines.push(`agent: ${frontmatter.agent}`);
  if (frontmatter.model) lines.push(`model: ${frontmatter.model}`);
  if (frontmatter.argumentHint) lines.push(`argument-hint: ${frontmatter.argumentHint}`);
  if (frontmatter.disableModelInvocation) lines.push(`disable-model-invocation: true`);
  if (!frontmatter.userInvocable) lines.push(`user-invocable: false`);
  if (frontmatter.mode) lines.push(`mode: true`);
  lines.push("---");
  if (body) lines.push("", body);
  return lines.join("\n") + "\n";
}

// ─── Registry ───────────────────────────────────────────────────

function getRegistryDir(): string {
  return path.join(os.homedir(), ".dawg", "skills");
}

interface SkillInfo {
  name: string;
  displayName: string;
  description: string;
  path: string;
  builtIn: boolean;
}

const BUILT_IN_SKILLS = new Map(BUNDLED_SKILLS.map((skill) => [skill.dirName, skill.content]));

function listRegistrySkills(): SkillInfo[] {
  const dir = getRegistryDir();
  if (!existsSync(dir)) return [];

  const skills: SkillInfo[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = path.join(dir, entry.name, "SKILL.md");
      if (!existsSync(skillMdPath)) continue;

      try {
        const content = readFileSync(skillMdPath, "utf-8");
        const { frontmatter } = parseSkillMd(content);
        skills.push({
          name: entry.name,
          displayName: frontmatter.name || entry.name,
          description: frontmatter.description || "",
          path: path.join(dir, entry.name),
          builtIn: BUILT_IN_SKILLS.has(entry.name),
        });
      } catch {
        // Skip unreadable
      }
    }
  } catch {
    // Dir not readable
  }
  return skills;
}

// ─── Deploy helpers ─────────────────────────────────────────────

function isSymlinkToRegistry(deployDir: string, skillName: string): boolean {
  const linkPath = path.join(deployDir, skillName);
  const expectedTarget = path.join(getRegistryDir(), skillName);
  try {
    const stat = lstatSync(linkPath);
    if (!stat.isSymbolicLink()) return false;
    const target = readlinkSync(linkPath);
    const resolved = path.resolve(path.dirname(linkPath), target);
    return resolved === expectedTarget || target === expectedTarget;
  } catch {
    return false;
  }
}

function createDeploy(deployDir: string, skillName: string): { success: boolean; error?: string } {
  const linkPath = path.join(deployDir, skillName);
  const targetPath = path.join(getRegistryDir(), skillName);

  if (!existsSync(targetPath)) {
    return { success: false, error: "Skill not found in registry" };
  }

  try {
    mkdirSync(deployDir, { recursive: true });

    // Remove existing symlink if present
    try {
      const stat = lstatSync(linkPath);
      if (stat.isSymbolicLink()) {
        unlinkSync(linkPath);
      } else if (stat.isDirectory()) {
        return {
          success: false,
          error: "A non-symlink directory already exists at the deploy path",
        };
      }
    } catch {
      // ENOENT — nothing there, fine
    }

    symlinkSync(targetPath, linkPath);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Failed to create symlink" };
  }
}

function removeDeploy(deployDir: string, skillName: string): { success: boolean; error?: string } {
  const linkPath = path.join(deployDir, skillName);
  try {
    const stat = lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      unlinkSync(linkPath);
    } else if (stat.isDirectory()) {
      rmSync(linkPath, { recursive: true });
    } else {
      return { success: false, error: "Target is not a skill deployment managed by dawg" };
    }
    return { success: true };
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return { success: true };
    return { success: false, error: err.message ?? "Failed to remove deployment" };
  }
}

// ─── Recursive copy ─────────────────────────────────────────────

function copyDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      writeFileSync(destPath, readFileSync(srcPath));
    }
  }
}

// ─── Scan for skills in filesystem ──────────────────────────────

interface SkillScanResult {
  name: string;
  displayName: string;
  description: string;
  skillPath: string;
  alreadyInRegistry: boolean;
}

const SKILL_DIR_NAMES = new Set(
  Object.values(SKILL_AGENT_SPECS).flatMap((spec) =>
    [spec.global, spec.project].filter(Boolean).map((p) => {
      // Extract the parent dir name (e.g. '.claude' from '.claude/skills')
      const parts = p!.replace(/^~\//, "").split("/");
      return parts[0];
    }),
  ),
);

function scanForSkills(
  roots: string[],
  maxDepth: number,
  knownSkills: Set<string>,
): SkillScanResult[] {
  const results: SkillScanResult[] = [];
  const seen = new Set<string>();
  const registryDir = getRegistryDir();

  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const name = entry.name;
        if (
          name === "node_modules" ||
          name === ".git" ||
          name === "dist" ||
          name === "build" ||
          name === ".dawg"
        )
          continue;

        const fullPath = path.join(dir, name);

        // Check all known skill directory parents (e.g. .claude, .cursor, .gemini, etc.)
        if (SKILL_DIR_NAMES.has(name)) {
          const skillsDir = path.join(fullPath, "skills");
          if (existsSync(skillsDir)) {
            try {
              for (const skillEntry of readdirSync(skillsDir, { withFileTypes: true })) {
                if (!skillEntry.isDirectory()) continue;

                // Skip symlinks pointing to our registry
                const entryPath = path.join(skillsDir, skillEntry.name);
                try {
                  const stat = lstatSync(entryPath);
                  if (stat.isSymbolicLink()) {
                    const target = readlinkSync(entryPath);
                    const resolved = path.resolve(skillsDir, target);
                    if (resolved.startsWith(registryDir)) continue;
                  }
                } catch {
                  /* not a symlink */
                }

                const skillMdPath = path.join(skillsDir, skillEntry.name, "SKILL.md");
                if (!existsSync(skillMdPath)) continue;

                if (seen.has(skillEntry.name)) continue;
                seen.add(skillEntry.name);

                try {
                  const content = readFileSync(skillMdPath, "utf-8");
                  const { frontmatter } = parseSkillMd(content);
                  results.push({
                    name: skillEntry.name,
                    displayName: frontmatter.name || skillEntry.name,
                    description: frontmatter.description || "",
                    skillPath: path.join(skillsDir, skillEntry.name),
                    alreadyInRegistry: knownSkills.has(skillEntry.name),
                  });
                } catch {
                  // Skip unreadable
                }
              }
            } catch {
              /* skills dir not readable */
            }
          }
          continue;
        }

        walk(fullPath, depth + 1);
      }
    } catch {
      /* dir not readable */
    }
  }

  for (const root of roots) {
    walk(root, 0);
  }
  return results;
}

// ─── Per-agent deployment status helper ─────────────────────────

type AgentDeploymentMap = Record<AgentId, { global?: boolean; project?: boolean }>;

function getSkillAgentDeployment(skillName: string, projectDir: string): AgentDeploymentMap {
  const result = {} as AgentDeploymentMap;
  for (const [agentId, spec] of Object.entries(SKILL_AGENT_SPECS)) {
    const agent = agentId as AgentId;
    const agentResult: { global?: boolean; project?: boolean } = {};

    if (spec.global) {
      const dir = resolveSkillDeployDir(agent, "global", projectDir);
      if (dir) agentResult.global = isSymlinkToRegistry(dir, skillName);
    }

    if (spec.project) {
      const dir = resolveSkillDeployDir(agent, "project", projectDir);
      if (dir) {
        const linkPath = path.join(dir, skillName);
        // Check both symlink and direct copy
        agentResult.project =
          isSymlinkToRegistry(dir, skillName) ||
          (() => {
            try {
              const stat = lstatSync(linkPath);
              return stat.isDirectory() && !stat.isSymbolicLink();
            } catch {
              return false;
            }
          })();
      }
    }

    result[agent] = agentResult;
  }
  return result;
}

// ─── Routes ─────────────────────────────────────────────────────

export function registerSkillRoutes(app: Hono, manager: WorktreeManager) {
  const projectDir = manager.getConfigDir();

  // ── Static GET routes (before parameterized :name) ────────────

  // List all skills (registry)
  app.get("/api/skills", (c) => {
    const registrySkills = listRegistrySkills();
    return c.json({ skills: registrySkills });
  });

  // Deployment status for all skills (per-agent matrix)
  app.get("/api/skills/deployment-status", (c) => {
    const skills = listRegistrySkills();
    const status: Record<string, { inRegistry: boolean; agents: AgentDeploymentMap }> = {};

    for (const skill of skills) {
      status[skill.name] = {
        inRegistry: true,
        agents: getSkillAgentDeployment(skill.name, projectDir),
      };
    }

    return c.json({ status });
  });

  // Get skill detail
  app.get("/api/skills/:name", (c) => {
    const name = c.req.param("name");
    const skillDir = path.join(getRegistryDir(), name);
    const skillMdPath = path.join(skillDir, "SKILL.md");

    if (!existsSync(skillMdPath)) {
      return c.json({ error: "Skill not found" }, 404);
    }

    const skillMd = readFileSync(skillMdPath, "utf-8");
    const { frontmatter } = parseSkillMd(skillMd);

    const refPath = path.join(skillDir, "reference.md");
    const examplesPath = path.join(skillDir, "examples.md");
    const hasReference = existsSync(refPath);
    const hasExamples = existsSync(examplesPath);

    return c.json({
      skill: {
        name,
        displayName: frontmatter.name || name,
        description: frontmatter.description || "",
        path: skillDir,
        builtIn: BUILT_IN_SKILLS.has(name),
        originalSkillMd: BUILT_IN_SKILLS.get(name),
        skillMd,
        frontmatter,
        hasReference,
        referenceMd: hasReference ? readFileSync(refPath, "utf-8") : undefined,
        hasExamples,
        examplesMd: hasExamples ? readFileSync(examplesPath, "utf-8") : undefined,
      },
    });
  });

  // ── Static POST routes (before parameterized :name) ───────────

  // Create skill in registry
  app.post("/api/skills", async (c) => {
    const body = await c.req.json<{
      name: string;
      description?: string;
      allowedTools?: string;
      context?: string;
      agent?: string;
      model?: string;
      argumentHint?: string;
      disableModelInvocation?: boolean;
      userInvocable?: boolean;
      mode?: boolean;
      instructions?: string;
    }>();

    if (!body.name?.trim()) {
      return c.json({ success: false, error: "Name is required" }, 400);
    }

    const dirName = body.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-");
    const skillDir = path.join(getRegistryDir(), dirName);

    if (existsSync(skillDir)) {
      return c.json({ success: false, error: `Skill "${dirName}" already exists` }, 409);
    }

    mkdirSync(skillDir, { recursive: true });

    const frontmatter: SkillFrontmatter = {
      name: body.name.trim(),
      description: body.description?.trim() ?? "",
      allowedTools: body.allowedTools?.trim() ?? "",
      context: body.context?.trim() ?? "",
      agent: body.agent?.trim() ?? "",
      model: body.model?.trim() ?? "",
      argumentHint: body.argumentHint?.trim() ?? "",
      disableModelInvocation: body.disableModelInvocation ?? false,
      userInvocable: body.userInvocable ?? true,
      mode: body.mode ?? false,
    };

    const content = buildSkillMd(frontmatter, body.instructions?.trim() ?? "");
    writeFileSync(path.join(skillDir, "SKILL.md"), content);

    return c.json({
      success: true,
      skill: {
        name: dirName,
        displayName: frontmatter.name,
        description: frontmatter.description,
        path: skillDir,
        builtIn: false,
      },
    });
  });

  // Scan for skills
  app.post("/api/skills/scan", async (c) => {
    const body: { mode?: "project" | "folder" | "device"; scanPath?: string } = await c.req
      .json()
      .catch(() => ({}));

    const mode = body.mode ?? "project";

    // Collect all already-known skill names
    const knownSkills = new Set(listRegistrySkills().map((s) => s.name));
    // Also check all agent deploy dirs
    for (const [agentId] of Object.entries(SKILL_AGENT_SPECS)) {
      for (const scope of ["global", "project"] as const) {
        const dir = resolveSkillDeployDir(agentId as AgentId, scope, projectDir);
        if (dir && existsSync(dir)) {
          try {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
              if (entry.isDirectory() || entry.isSymbolicLink()) knownSkills.add(entry.name);
            }
          } catch {
            /* dir not readable */
          }
        }
      }
    }

    let scanRoots: string[];
    let maxDepth: number;

    if (mode === "project") {
      scanRoots = [projectDir];
      maxDepth = 4;
    } else if (mode === "folder" && body.scanPath) {
      scanRoots = [body.scanPath];
      maxDepth = 8;
    } else {
      scanRoots = [os.homedir()];
      maxDepth = 5;
    }

    const skills = scanForSkills(scanRoots, maxDepth, knownSkills);
    return c.json({ discovered: skills });
  });

  // Import scanned skills into registry
  app.post("/api/skills/import", async (c) => {
    const body = await c.req.json<{
      skills: Array<{ name: string; skillPath: string }>;
    }>();

    if (!Array.isArray(body.skills)) {
      return c.json({ success: false, error: "skills array is required" }, 400);
    }

    const registryDir = getRegistryDir();
    mkdirSync(registryDir, { recursive: true });
    const imported: string[] = [];

    for (const s of body.skills) {
      if (!s.name || !s.skillPath) continue;
      const targetDir = path.join(registryDir, s.name);
      if (existsSync(targetDir)) continue;
      if (!existsSync(s.skillPath)) continue;

      try {
        copyDir(s.skillPath, targetDir);
        imported.push(s.name);
      } catch {
        // Skip failed copies
      }
    }

    return c.json({ success: true, imported });
  });

  // Install skill from GitHub via `npx skills add`
  app.post("/api/skills/install", async (c) => {
    const body = await c.req.json<{
      repo: string;
      skill?: string;
      agents: AgentId[];
      scope: "global" | "project";
    }>();

    if (!body.repo?.trim()) {
      return c.json({ success: false, error: "repo is required" }, 400);
    }

    const args = ["skills", "add", body.repo.trim()];
    if (body.skill) args.push("-s", body.skill);
    for (const agent of body.agents ?? []) {
      args.push("-a", agent);
    }
    if (body.scope === "global") args.push("--global");

    try {
      execFileSync("npx", args, {
        encoding: "utf-8",
        timeout: 60_000,
        cwd: projectDir,
      });

      // After install, scan agent directories for newly added skills and import to registry
      const registryDir = getRegistryDir();
      mkdirSync(registryDir, { recursive: true });
      const installed: string[] = [];

      for (const agent of body.agents ?? []) {
        const dir = resolveSkillDeployDir(agent, body.scope, projectDir);
        if (!dir || !existsSync(dir)) continue;
        try {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const skillMdPath = path.join(dir, entry.name, "SKILL.md");
            if (!existsSync(skillMdPath)) continue;
            const registryTarget = path.join(registryDir, entry.name);
            if (!existsSync(registryTarget)) {
              copyDir(path.join(dir, entry.name), registryTarget);
              installed.push(entry.name);
            }
          }
        } catch {
          /* skip */
        }
      }

      return c.json({ success: true, installed });
    } catch (e) {
      return c.json({
        success: false,
        error: e instanceof Error ? e.message : "Failed to install skill",
      });
    }
  });

  // Check if `npx skills` is available
  app.get("/api/skills/npx-available", (c) => {
    try {
      execFileSync("npx", ["skills", "--version"], {
        encoding: "utf-8",
        timeout: 10_000,
        stdio: "pipe",
      });
      return c.json({ available: true });
    } catch {
      return c.json({ available: false });
    }
  });

  // ── Parameterized routes ──────────────────────────────────────

  // Update skill
  app.patch("/api/skills/:name", async (c) => {
    const name = c.req.param("name");
    const body = await c.req.json<{
      skillMd?: string;
      referenceMd?: string;
      examplesMd?: string;
      frontmatter?: Partial<SkillFrontmatter>;
    }>();

    const skillDir = path.join(getRegistryDir(), name);
    const skillMdPath = path.join(skillDir, "SKILL.md");

    if (!existsSync(skillMdPath)) {
      return c.json({ success: false, error: "Skill not found" }, 404);
    }

    // Handle frontmatter-only updates: merge into existing SKILL.md
    if (body.frontmatter && body.skillMd === undefined) {
      const current = readFileSync(skillMdPath, "utf-8");
      const parsed = parseSkillMd(current);
      const merged = { ...parsed.frontmatter, ...body.frontmatter };
      writeFileSync(skillMdPath, buildSkillMd(merged, parsed.body));
    } else if (body.skillMd !== undefined) {
      writeFileSync(skillMdPath, body.skillMd);
    }

    if (body.referenceMd !== undefined) {
      const refPath = path.join(skillDir, "reference.md");
      if (body.referenceMd) {
        writeFileSync(refPath, body.referenceMd);
      } else if (existsSync(refPath)) {
        rmSync(refPath);
      }
    }

    if (body.examplesMd !== undefined) {
      const examplesPath = path.join(skillDir, "examples.md");
      if (body.examplesMd) {
        writeFileSync(examplesPath, body.examplesMd);
      } else if (existsSync(examplesPath)) {
        rmSync(examplesPath);
      }
    }

    return c.json({ success: true });
  });

  // Delete skill from registry + cleanup symlinks across ALL agents
  app.delete("/api/skills/:name", (c) => {
    const name = c.req.param("name");
    const registryDir = getRegistryDir();
    const skillDir = path.join(registryDir, name);

    if (!existsSync(skillDir)) {
      return c.json({ success: false, error: "Skill not found" }, 404);
    }

    // Cleanup symlinks across all agents
    for (const [agentId] of Object.entries(SKILL_AGENT_SPECS)) {
      for (const scope of ["global", "project"] as const) {
        const dir = resolveSkillDeployDir(agentId as AgentId, scope, projectDir);
        if (dir && isSymlinkToRegistry(dir, name)) {
          removeDeploy(dir, name);
        }
      }
    }

    rmSync(skillDir, { recursive: true });
    return c.json({ success: true });
  });

  // Deploy skill (create symlink) — accepts agent + scope
  app.post("/api/skills/:name/deploy", async (c) => {
    const name = c.req.param("name");
    const body = await c.req.json<{ agent: AgentId; scope: "global" | "project" }>();

    const deployDir = resolveSkillDeployDir(body.agent, body.scope, projectDir);
    if (!deployDir) {
      return c.json(
        { success: false, error: `No deploy path for ${body.agent} ${body.scope}` },
        400,
      );
    }

    const result = createDeploy(deployDir, name);
    return c.json(result, result.success ? 200 : 500);
  });

  // Undeploy skill (remove symlink) — accepts agent + scope
  app.post("/api/skills/:name/undeploy", async (c) => {
    const name = c.req.param("name");
    const body = await c.req.json<{ agent: AgentId; scope: "global" | "project" }>();

    const deployDir = resolveSkillDeployDir(body.agent, body.scope, projectDir);
    if (!deployDir) {
      return c.json(
        { success: false, error: `No deploy path for ${body.agent} ${body.scope}` },
        400,
      );
    }

    const result = removeDeploy(deployDir, name);
    return c.json(result, result.success ? 200 : 500);
  });
}
