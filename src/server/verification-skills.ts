import { existsSync, mkdirSync, writeFileSync } from "fs";
import os from "os";
import path from "path";

import { BUNDLED_SKILLS } from "../instructions";

function getRegistryDir(): string {
  return path.join(os.homedir(), ".dawg", "skills");
}

export function ensureBundledSkills(): void {
  const registryDir = getRegistryDir();

  for (const skill of BUNDLED_SKILLS) {
    const skillDir = path.join(registryDir, skill.dirName);
    const skillMdPath = path.join(skillDir, "SKILL.md");

    if (existsSync(skillMdPath)) continue;

    mkdirSync(skillDir, { recursive: true });
    writeFileSync(skillMdPath, skill.content);
  }
}
