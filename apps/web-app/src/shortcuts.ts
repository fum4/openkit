/**
 * Keyboard shortcuts: types, defaults, and utilities.
 *
 * The "project-tab" shortcut is special: it stores only the modifier
 * combo (e.g. "meta"). The actual key is the project number (1, 2, 3…)
 * which is appended automatically at match time.
 */

export type ShortcutAction =
  | "project-tab"
  | "nav-worktrees"
  | "nav-issues"
  | "nav-agents"
  | "nav-activity"
  | "nav-integrations"
  | "nav-settings";

/** Fired by useShortcuts — includes the tab number for project-tab. */
export type ShortcutEvent =
  | { action: "project-tab"; tabIndex: number }
  | { action: Exclude<ShortcutAction, "project-tab"> };

export interface ShortcutBinding {
  key: string;
  metaKey: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export interface ShortcutDef {
  id: ShortcutAction;
  label: string;
  group: "navigation" | "projects";
  defaultBinding: ShortcutBinding;
}

/**
 * For project-tab the `key` field is empty — only modifiers matter.
 * The UI displays it as "⌘ 1–3" (or whatever the modifier is).
 */
export const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  {
    id: "project-tab",
    label: "Go to project tab",
    group: "projects",
    defaultBinding: { key: "", metaKey: true },
  },
  {
    id: "nav-worktrees",
    label: "Go to Worktrees",
    group: "navigation",
    defaultBinding: { key: "w", metaKey: true },
  },
  {
    id: "nav-issues",
    label: "Go to Issues",
    group: "navigation",
    defaultBinding: { key: "i", metaKey: true },
  },
  {
    id: "nav-agents",
    label: "Go to Agents",
    group: "navigation",
    defaultBinding: { key: "a", metaKey: true },
  },
  {
    id: "nav-activity",
    label: "Go to Activity",
    group: "navigation",
    defaultBinding: { key: "l", metaKey: true },
  },
  {
    id: "nav-integrations",
    label: "Go to Integrations",
    group: "navigation",
    defaultBinding: { key: "e", metaKey: true },
  },
  {
    id: "nav-settings",
    label: "Go to Settings",
    group: "navigation",
    defaultBinding: { key: "s", metaKey: true },
  },
];

export const SHORTCUT_DEFAULTS: Record<ShortcutAction, ShortcutBinding> = Object.fromEntries(
  DEFAULT_SHORTCUTS.map((s) => [s.id, s.defaultBinding]),
) as Record<ShortcutAction, ShortcutBinding>;

const MODIFIER_MAP: Record<string, string> = {
  cmd: "meta",
  meta: "meta",
  shift: "shift",
  alt: "alt",
  opt: "alt",
  option: "alt",
};

const DISPLAY_SYMBOLS: Record<string, string> = {
  meta: "\u2318",
  shift: "\u21E7",
  alt: "\u2325",
};

/** Parse "Cmd+W" or "meta+shift+a" into a ShortcutBinding. */
export function parseShortcutString(str: string): ShortcutBinding {
  const parts = str.split("+").map((p) => p.trim().toLowerCase());
  const binding: ShortcutBinding = { key: "", metaKey: false };

  for (const part of parts) {
    const mapped = MODIFIER_MAP[part];
    if (mapped === "meta") binding.metaKey = true;
    else if (mapped === "shift") binding.shiftKey = true;
    else if (mapped === "alt") binding.altKey = true;
    else binding.key = part;
  }

  return binding;
}

/** Format a binding for display using symbols like ⌘ ⇧ ⌥. */
export function formatShortcut(binding: ShortcutBinding): string {
  const parts: string[] = [];
  if (binding.metaKey) parts.push(DISPLAY_SYMBOLS.meta);
  if (binding.altKey) parts.push(DISPLAY_SYMBOLS.alt);
  if (binding.shiftKey) parts.push(DISPLAY_SYMBOLS.shift);
  if (binding.key) parts.push(binding.key.toUpperCase());
  return parts.join(" ");
}

/**
 * Format the project-tab binding for display.
 * Shows only the modifier(s), e.g. "⌘".
 */
export function formatProjectTabShortcut(binding: ShortcutBinding): string {
  const parts: string[] = [];
  if (binding.metaKey) parts.push(DISPLAY_SYMBOLS.meta);
  if (binding.altKey) parts.push(DISPLAY_SYMBOLS.alt);
  if (binding.shiftKey) parts.push(DISPLAY_SYMBOLS.shift);
  return parts.join(" ") || DISPLAY_SYMBOLS.meta;
}

/** Check if a KeyboardEvent matches a binding. */
export function matchesEvent(binding: ShortcutBinding, event: KeyboardEvent): boolean {
  if (event.metaKey !== binding.metaKey) return false;
  if (event.shiftKey !== (binding.shiftKey ?? false)) return false;
  if (event.altKey !== (binding.altKey ?? false)) return false;
  return event.key.toLowerCase() === binding.key.toLowerCase();
}

/**
 * Check if a KeyboardEvent matches the project-tab modifier combo.
 * Returns the tab index (0-based) if it matches, or -1 otherwise.
 */
export function matchesProjectTab(binding: ShortcutBinding, event: KeyboardEvent): number {
  if (event.metaKey !== binding.metaKey) return -1;
  if (event.shiftKey !== (binding.shiftKey ?? false)) return -1;
  if (event.altKey !== (binding.altKey ?? false)) return -1;

  const digit = parseInt(event.key, 10);
  if (isNaN(digit) || digit < 1 || digit > 9) return -1;
  return digit - 1;
}

/** Serialize to storage format: "meta+w", "meta+shift+a". */
export function serializeBinding(binding: ShortcutBinding): string {
  const parts: string[] = [];
  if (binding.metaKey) parts.push("meta");
  if (binding.altKey) parts.push("alt");
  if (binding.shiftKey) parts.push("shift");
  if (binding.key) parts.push(binding.key.toLowerCase());
  return parts.join("+");
}

/**
 * Serialize project-tab binding — only modifiers, no key.
 * e.g. "meta" or "meta+alt".
 */
export function serializeProjectTabBinding(binding: ShortcutBinding): string {
  const parts: string[] = [];
  if (binding.metaKey) parts.push("meta");
  if (binding.altKey) parts.push("alt");
  if (binding.shiftKey) parts.push("shift");
  return parts.join("+") || "meta";
}

/** Returns the conflicting action ID, or null if no conflict. */
export function detectConflict(
  actionId: ShortcutAction,
  newBinding: ShortcutBinding,
  allBindings: Record<string, string>,
): string | null {
  const newSerialized = serializeBinding(newBinding);
  for (const [id, serialized] of Object.entries(allBindings)) {
    if (id === actionId) continue;
    if (id === "project-tab") continue; // project-tab uses different matching
    if (serialized === newSerialized) return id;
  }
  // Also check defaults for actions not in allBindings
  for (const def of DEFAULT_SHORTCUTS) {
    if (def.id === actionId || def.id === "project-tab") continue;
    if (allBindings[def.id]) continue;
    if (serializeBinding(def.defaultBinding) === newSerialized) return def.id;
  }
  return null;
}

/** Build the full bindings map: user overrides merged with defaults. */
export function resolveBindings(
  overrides: Record<string, string> | undefined,
): Record<ShortcutAction, ShortcutBinding> {
  const result = { ...SHORTCUT_DEFAULTS };
  if (overrides) {
    for (const [id, serialized] of Object.entries(overrides)) {
      if (id in result) {
        result[id as ShortcutAction] = parseShortcutString(serialized);
      }
    }
  }
  return result;
}
