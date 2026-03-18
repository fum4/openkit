/**
 * Previously seeded bundled skills into ~/.openkit/skills/ and symlinked them
 * into project directories. Bundled skills have been removed — the work skill
 * is now deployed via builtin-instructions.ts (deployAgentInstructions).
 *
 * This function is retained as a no-op to avoid breaking callers during the
 * transition. It can be removed once all call sites are cleaned up.
 */
export function enableDefaultProjectSkills(_projectDir: string): void {
  // No-op: bundled skills concept removed.
}
