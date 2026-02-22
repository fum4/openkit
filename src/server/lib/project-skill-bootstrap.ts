import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from "fs";
import os from "os";
import path from "path";

import { ensureBundledSkills } from "../verification-skills";
import { SKILL_AGENT_SPECS } from "./tool-configs";

const DEFAULT_PROJECT_SKILLS = ["work-on-task"] as const;

function deploySkillToProjectDir(projectDir: string, skillName: string, targetPath: string): void {
  for (const spec of Object.values(SKILL_AGENT_SPECS)) {
    if (!spec.project) continue;

    const deployDir = path.join(projectDir, spec.project);
    const linkPath = path.join(deployDir, skillName);

    try {
      mkdirSync(deployDir, { recursive: true });
      try {
        const stat = lstatSync(linkPath);

        // If a copied skill directory already exists, treat it as enabled.
        if (stat.isDirectory() && !stat.isSymbolicLink()) continue;

        if (stat.isSymbolicLink()) {
          const resolved = path.resolve(path.dirname(linkPath), readlinkSync(linkPath));
          if (resolved === path.resolve(targetPath)) continue;
          unlinkSync(linkPath);
          symlinkSync(targetPath, linkPath);
          continue;
        }
      } catch {
        // Path does not exist yet.
      }

      if (!existsSync(linkPath)) {
        symlinkSync(targetPath, linkPath);
      }
    } catch {
      // Best effort: skip paths we can't write to.
    }
  }
}

export function enableDefaultProjectSkills(projectDir: string): void {
  ensureBundledSkills();

  for (const skillName of DEFAULT_PROJECT_SKILLS) {
    const targetPath = path.join(os.homedir(), ".dawg", "skills", skillName);
    if (!existsSync(targetPath)) continue;
    deploySkillToProjectDir(projectDir, skillName, targetPath);
  }
}
