/**
 * Centralized theme configuration.
 *
 * All color values used across the UI live here so you can tweak
 * the entire look from a single file.  Values are Tailwind class
 * fragments — they get interpolated into className strings.
 */

// ─── Color Palette ─────────────────────────────────────────────
export const palette = {
  // Backgrounds (neutral slate family)
  bg0: "#0c0e12", // deepest — page bg
  bg1: "#12151a", // panels
  bg2: "#1a1e25", // elevated surfaces (cards, modals, hovers)
  bg3: "#242930", // input fields, pressed states

  // Borders
  border0: "rgba(255,255,255,0.06)", // subtle dividers
  border1: "rgba(255,255,255,0.10)", // input borders
  border2: "rgba(255,255,255,0.15)", // hover/active borders

  // Text
  text0: "#f0f2f5", // primary
  text1: "#9ca3af", // secondary
  text2: "#6b7280", // muted
  text3: "#4b5563", // dimmed/disabled

  // Accent — teal/greenish-blue
  accent: "#2dd4bf", // primary accent (teal-400)
  accentMuted: "#14b8a6", // slightly deeper (teal-500)
  accentBg: "rgba(45,212,191,0.10)", // accent tinted backgrounds
  accentBgHover: "rgba(45,212,191,0.18)",

  // Semantic
  green: "#34d399",
  red: "#f87171",
  orange: "#fb923c",
  yellow: "#fbbf24",
  purple: "#a78bfa",
  cyan: "#22d3ee",
} as const;

// ─── Surface / Layout ────────────────────────────────────────────
export const surface = {
  /** Page background (visible between panels & behind header) */
  page: "bg-surface-page",
  /** Both panels (sidebar + detail) */
  panel: "bg-surface-panel",
  /** Selected sidebar item */
  panelSelected: "bg-surface-raised",
  /** Sidebar item hover */
  panelHover: "bg-white/[0.04]",
  /** Inline editable text hover */
  editableHover: "bg-surface-input",
  /** Modal overlay */
  overlay: "bg-black/60",
  /** Modal card */
  modal: "bg-surface-raised",
} as const;

// ─── Borders ─────────────────────────────────────────────────────
export const border = {
  /** Default subtle divider inside panels */
  subtle: "border-white/[0.06]",
  /** Panel section dividers (toolbar, header rows) */
  section: "border-white/[0.08]",
  /** Modal border */
  modal: "border-white/[0.10]",
  /** Input borders */
  input: "border-white/[0.10]",
  /** Selected sidebar accent */
  accent: "border-accent",
  /** Focus ring on inputs */
  focusPrimary: "border-white/[0.20]",
  focusCommit: "border-white/[0.20]",
  focusPr: "border-white/[0.20]",
} as const;

// ─── Input fields ────────────────────────────────────────────────
export const input = {
  bg: "bg-surface-input",
  /** Sidebar inputs — borderless, ghost-like, blends into panel */
  bgSidebar: "bg-white/[0.04]",
  /** Inputs inside detail panel (edit mode, commit, PR) */
  bgDetail: "bg-surface-input",
  text: "text-white",
  placeholder: "placeholder-gray-500",
  placeholderSubtle: "placeholder-[#4b5563]",
  ring: "ring-white/[0.15]",
  ringCommit: "ring-white/[0.15]",
  ringPr: "ring-white/[0.15]",
} as const;

// ─── Text hierarchy ──────────────────────────────────────────────
export const text = {
  primary: "text-[#f0f2f5]",
  secondary: "text-[#9ca3af]",
  muted: "text-[#6b7280]",
  dimmed: "text-[#4b5563]",
  body: "text-[#f0f2f5]",
  error: "text-red-400",
  errorBanner: "text-red-300",
} as const;

// ─── Status indicators ──────────────────────────────────────────
export const status = {
  running: {
    dot: "bg-emerald-400",
    glow: "shadow-[0_0_6px_rgba(52,211,153,0.45)]",
    badge: "text-emerald-400 bg-emerald-900/30",
  },
  stopped: {
    dot: "bg-[#4b5563]",
    badge: "text-[#9ca3af] bg-white/[0.06]",
  },
  creating: {
    dot: "bg-yellow-400",
    badge: "text-yellow-400 bg-yellow-900/30",
  },
  deleting: {
    dot: "bg-red-400",
  },
  uncommitted: {
    dot: "bg-orange-400",
  },
} as const;

// ─── Action buttons (ghost style) ───────────────────────────────
// Reduced palette: accent (teal) for constructive, red for destructive, neutral for rest
export const action = {
  start: {
    text: "text-accent",
    hover: "hover:bg-accent/10",
  },
  stop: {
    text: "text-red-400",
    hover: "hover:bg-red-900/30",
  },
  delete: {
    text: "text-[#6b7280]",
    hover: "hover:bg-red-900/20 hover:text-red-400",
  },
  commit: {
    text: "text-[#9ca3af]",
    textActive: "text-accent",
    hover: "hover:bg-white/[0.06]",
    bgActive: "bg-white/[0.08]",
    bgSubmit: "bg-accent/10",
    bgSubmitHover: "hover:bg-accent/20",
  },
  push: {
    text: "text-[#9ca3af]",
    hover: "hover:bg-white/[0.06]",
  },
  pr: {
    text: "text-[#9ca3af]",
    textActive: "text-accent",
    hover: "hover:bg-white/[0.06]",
    bgActive: "bg-accent/10",
    bgSubmit: "bg-accent/10",
    bgSubmitHover: "hover:bg-accent/20",
  },
  rename: {
    text: "text-[#9ca3af]",
    hover: "hover:bg-white/[0.06]",
  },
  cancel: {
    text: "text-[#6b7280]",
    textHover: "hover:text-[#9ca3af]",
  },
} as const;

// ─── Primary button ─────────────────────────────────────────────
export const button = {
  primary: "bg-accent/15 text-accent hover:bg-accent/25 font-medium disabled:pointer-events-none",
  secondary:
    "bg-white/[0.06] text-[#9ca3af] hover:bg-white/[0.10] hover:text-white disabled:pointer-events-none",
  confirm: "text-red-400 bg-red-900/30 hover:bg-red-900/50 disabled:pointer-events-none",
  warning: "text-amber-300 bg-amber-900/30 hover:bg-amber-900/50 disabled:pointer-events-none",
} as const;

// ─── Tabs (create form Branch / Jira) ───────────────────────────
export const tab = {
  active: "text-white bg-white/[0.08]",
  inactive: "text-[#6b7280] hover:text-[#9ca3af]",
} as const;

// ─── Integration badges ─────────────────────────────────────────
export const badge = {
  running: "bg-accent/20 text-accent",
  jira: "text-blue-400",
  jiraHover: "hover:text-blue-300",
  jiraStatus: "bg-blue-900/30",
  linear: "text-[#5E6AD2]",
  linearHover: "hover:text-[#7B85E0]",
  linearStatus: "bg-[#5E6AD2]/20",
  localIssue: "text-amber-400",
  localIssueHover: "hover:text-amber-300",
  prOpen: "text-emerald-400 bg-emerald-900/30",
  prDraft: "text-[#9ca3af] bg-white/[0.06]",
  prMerged: "text-purple-400 bg-purple-900/30",
  prClosed: "text-red-400 bg-red-900/30",
  unpushed: "text-white",
} as const;

// ─── Integration colors (use these everywhere for consistency) ──
export const integration = {
  jira: "text-blue-400",
  linear: "text-[#5E6AD2]",
  localIssue: "text-amber-400",
  worktree: "text-teal-400",
  mcp: "text-purple-400",
} as const;

// ─── Header bar ─────────────────────────────────────────────────
export const header = {
  bg: "bg-surface-page",
  ports: "text-[#4b5563]",
  portsDiscover: "text-accent/70 hover:text-accent",
  rescan: "text-[#6b7280] hover:text-[#9ca3af]",
  connection: "text-[#6b7280]",
  connectedDot: "bg-emerald-400",
  disconnectedDot: "bg-[#4b5563]",
} as const;

// ─── Navigation bar ─────────────────────────────────────────────
export const nav = {
  bg: "bg-surface-page",
  active: "text-white bg-white/[0.08]",
  inactive: "text-[#6b7280] hover:text-[#9ca3af]",
} as const;

// ─── Settings / Configuration ───────────────────────────────────
export const settings = {
  label: "text-[#9ca3af]",
  description: "text-[#6b7280]",
  card: "bg-white/[0.03]",
} as const;

// ─── Jira priority / type ────────────────────────────────────────
export const jiraPriority: Record<string, string> = {
  highest: "text-red-400",
  high: "text-orange-400",
  medium: "text-yellow-400",
  low: "text-emerald-400",
  lowest: "text-blue-400",
};

// ─── Linear priority / state type ───────────────────────────────
export const linearPriority: Record<number, { label: string; color: string }> = {
  0: { label: "None", color: "text-[#6b7280]" },
  1: { label: "Urgent", color: "text-red-400" },
  2: { label: "High", color: "text-orange-400" },
  3: { label: "Medium", color: "text-yellow-400" },
  4: { label: "Low", color: "text-blue-400" },
};

export const linearStateType: Record<string, string> = {
  backlog: "text-[#6b7280] bg-white/[0.06]",
  unstarted: "text-[#6b7280] bg-white/[0.06]",
  started: "text-yellow-400 bg-yellow-900/30",
  completed: "text-emerald-400 bg-emerald-900/30",
  cancelled: "text-red-400 bg-red-900/30",
  canceled: "text-red-400 bg-red-900/30",
};

export const jiraType: Record<string, string> = {
  bug: "text-red-400 bg-red-900/30",
  story: "text-emerald-400 bg-emerald-900/30",
  task: "text-blue-400 bg-blue-900/30",
  subtask: "text-[#9ca3af] bg-white/[0.06]",
  epic: "text-purple-400 bg-purple-900/30",
};

export const jiraTypeColor: Record<string, string> = {
  bug: "text-red-400",
  story: "text-emerald-400",
  task: "text-blue-400",
  subtask: "text-[#9ca3af]",
  epic: "text-purple-400",
};

export const jiraStatus: Record<string, string> = {
  "to do": "text-[#6b7280] bg-white/[0.06]",
  open: "text-[#6b7280] bg-white/[0.06]",
  backlog: "text-[#6b7280] bg-white/[0.06]",
  reopened: "text-[#6b7280] bg-white/[0.06]",
  "in progress": "text-yellow-400 bg-yellow-900/30",
  "in review": "text-blue-400 bg-blue-900/30",
  review: "text-blue-400 bg-blue-900/30",
  done: "text-emerald-400 bg-emerald-900/30",
  closed: "text-emerald-400 bg-emerald-900/30",
  resolved: "text-emerald-400 bg-emerald-900/30",
};

// ─── Custom tasks ───────────────────────────────────────────────
export const customTask = {
  accent: "text-amber-400",
  accentBg: "bg-amber-400/10",
  accentBorder: "border-amber-400/30",
  badge: "text-amber-400 bg-amber-900/30",
  button: "bg-amber-400/15 text-amber-400 hover:bg-amber-400/25 font-medium",
  status: {
    todo: "text-[#6b7280] bg-white/[0.06]",
    "in-progress": "text-amber-400 bg-amber-900/30",
    done: "text-emerald-400 bg-emerald-900/30",
  } as Record<string, string>,
  priority: {
    high: "text-red-400",
    medium: "text-yellow-400",
    low: "text-blue-400",
  } as Record<string, string>,
  priorityDot: {
    high: "bg-red-400",
    medium: "bg-yellow-400",
    low: "bg-blue-400",
  } as Record<string, string>,
  labelColors: [
    { text: "text-rose-300", bg: "bg-rose-900/30" },
    { text: "text-sky-300", bg: "bg-sky-900/30" },
    { text: "text-emerald-300", bg: "bg-emerald-900/30" },
    { text: "text-amber-300", bg: "bg-amber-900/30" },
    { text: "text-violet-300", bg: "bg-violet-900/30" },
    { text: "text-teal-300", bg: "bg-teal-900/30" },
    { text: "text-pink-300", bg: "bg-pink-900/30" },
    { text: "text-lime-300", bg: "bg-lime-900/30" },
    { text: "text-indigo-300", bg: "bg-indigo-900/30" },
    { text: "text-orange-300", bg: "bg-orange-900/30" },
    { text: "text-cyan-300", bg: "bg-cyan-900/30" },
    { text: "text-fuchsia-300", bg: "bg-fuchsia-900/30" },
    { text: "text-red-300", bg: "bg-red-900/30" },
    { text: "text-green-300", bg: "bg-green-900/30" },
    { text: "text-blue-300", bg: "bg-blue-900/30" },
    { text: "text-purple-300", bg: "bg-purple-900/30" },
    { text: "text-yellow-300", bg: "bg-yellow-900/30" },
  ],
} as const;

export function getLabelColor(label: string) {
  let hash = 2166136261;
  for (let i = 0; i < label.length; i++) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return customTask.labelColors[(hash >>> 0) % customTask.labelColors.length];
}

// ─── Agent Rules ────────────────────────────────────────────────
export const agentRule = {
  accent: "text-cyan-400",
  accentBg: "bg-cyan-400/10",
  accentBorder: "border-cyan-400/30",
} as const;

// ─── Skills ─────────────────────────────────────────────────────
export const skill = {
  accent: "text-pink-400",
  accentBg: "bg-pink-400/10",
  accentBorder: "border-pink-400/30",
  badge: "text-pink-400 bg-pink-900/30",
  button: "bg-pink-400/15 text-pink-400 hover:bg-pink-400/25 font-medium",
} as const;

// ─── Plugins ────────────────────────────────────────────────────
export const plugin = {
  accent: "text-[#D4A574]",
  accentBorder: "border-[#D4A574]/30",
  badge: "text-[#D4A574] bg-[#D4A574]/15",
} as const;

// ─── MCP Servers ────────────────────────────────────────────────
export const mcpServer = {
  accent: "text-purple-400",
  accentBg: "bg-purple-400/10",
  accentBorder: "border-purple-400/30",
  badge: "text-purple-400 bg-purple-900/30",
  button: "bg-purple-400/15 text-purple-400 hover:bg-purple-400/25 font-medium",
  deployed: "bg-teal-400",
  partial: "bg-teal-400/50",
  notDeployed: "bg-[#4b5563]",
} as const;

// ─── Notes ──────────────────────────────────────────────────────
export const notes = {
  tabActive: "text-white bg-white/[0.08]",
  tabInactive: "text-[#6b7280] hover:text-[#9ca3af]",
  personalIcon: "text-[#9ca3af]",
  personalAccent: "bg-white/[0.02]",
  personalBorder: "border-white/[0.06]",
  aiIcon: "text-purple-400",
  aiAccent: "bg-white/[0.02]",
  aiBorder: "border-white/[0.06]",
  emptyText: "text-[#4b5563]",
  todoCheckbox: "border-teal-400/40",
  todoChecked: "bg-teal-400/20 border-teal-400/60",
  todoCheckIcon: "text-teal-400",
} as const;

// ─── Hooks ──────────────────────────────────────────────────────
export const hooks = {
  accent: "text-emerald-400",
  accentMuted: "text-emerald-500",
  accentBg: "bg-emerald-400/10",
  accentBorder: "border-emerald-400/30",
  badge: "text-emerald-400 bg-emerald-900/30",
  button: "bg-emerald-400/15 text-emerald-400 hover:bg-emerald-400/25 font-medium",
  passed: "text-emerald-400 bg-emerald-900/30",
  failed: "text-red-400 bg-red-900/30",
  pending: "text-[#6b7280] bg-white/[0.06]",
  running: "text-yellow-400 bg-yellow-900/30",
  skipped: "text-[#4b5563] bg-white/[0.03]",
} as const;

// ─── Activity feed ──────────────────────────────────────────
export const activity = {
  categoryColor: {
    agent: "text-purple-400",
    worktree: "text-teal-400",
    system: "text-red-400",
  } as Record<string, string>,
  categoryBg: {
    agent: "bg-purple-400/10",
    worktree: "bg-teal-400/10",
    system: "bg-red-400/10",
  } as Record<string, string>,
  severityDot: {
    success: "bg-emerald-400",
    warning: "bg-amber-400",
    error: "bg-red-400",
  } as Record<string, string>,
} as const;

// ─── Detail panel tabs (Logs / Terminal) ────────────────────────
export const detailTab = {
  active: "text-white bg-white/[0.08]",
  inactive: "text-[#6b7280] hover:text-[#9ca3af]",
} as const;

// ─── Error banner ────────────────────────────────────────────────
export const errorBanner = {
  bg: "bg-red-900/30",
  panelBg: "bg-red-900/20",
  border: "border-red-900/30",
} as const;

// ─── Info banner (teal accent) ───────────────────────────────────
export const infoBanner = {
  bg: "bg-[#2dd4bf]/[0.04]",
  border: "border-[#2dd4bf]/[0.12]",
  text: "text-[#2dd4bf]",
  textMuted: "text-[#2dd4bf]/60",
  hoverBg: "hover:bg-[#2dd4bf]/10",
} as const;
