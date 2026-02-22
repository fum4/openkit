import { existsSync, readFileSync } from "fs";
import path from "path";

import { ACTIVITY_TYPES } from "../server/activity-event";
import { APP_NAME, CONFIG_DIR_NAME } from "../constants";
import { log } from "../logger";

type ActivitySeverity = "info" | "success" | "warning" | "error";
const WORKFLOW_PHASES = [
  "task-started",
  "pre-hooks-started",
  "pre-hooks-completed",
  "implementation-started",
  "implementation-completed",
  "post-hooks-started",
  "post-hooks-completed",
] as const;

type WorkflowPhase = (typeof WORKFLOW_PHASES)[number];
const WORKFLOW_PHASE_SET = new Set<WorkflowPhase>(WORKFLOW_PHASES);

interface ParsedAwaitInputArgs {
  message: string;
  detail?: string;
  worktreeId?: string;
  severity: ActivitySeverity;
}

interface ParsedPhaseArgs {
  phase: WorkflowPhase;
  message?: string;
  detail?: string;
  worktreeId?: string;
  severity: ActivitySeverity;
}

interface ParsedCheckFlowArgs {
  worktreeId?: string;
  json: boolean;
}

interface FlowComplianceReport {
  worktreeId: string;
  compliant: boolean;
  phases?: {
    missing?: string[];
    outOfOrder?: Array<{ previous: string; current: string }>;
  };
  warnings?: string[];
  missingActions?: string[];
}

function printActivityHelp() {
  log.plain(`${APP_NAME} activity — emit activity events for agents

Usage:
  ${APP_NAME} activity await-input --message "<what you need>" [--worktree <id>] [--detail "<extra context>"] [--severity warning|info|error|success]
  ${APP_NAME} activity await-input "<what you need>" [--worktree <id>]
  ${APP_NAME} activity phase --phase <${WORKFLOW_PHASES.join("|")}> [--worktree <id>] [--detail "<extra context>"] [--message "<custom title>"] [--severity info|success|warning|error]
  ${APP_NAME} activity phase <${WORKFLOW_PHASES.join("|")}> [--worktree <id>]
  ${APP_NAME} activity check-flow --worktree <id> [--json]

Notes:
  - This command requires a running OpenKit server in the current project.
  - If --worktree is omitted, OpenKit tries to infer it from the current path where possible.`);
}

function parseValueArg(arg: string, name: string): string | null {
  if (arg.startsWith(`--${name}=`)) {
    return arg.slice(name.length + 3);
  }
  return null;
}

function parseAwaitInputArgs(rawArgs: string[]): ParsedAwaitInputArgs {
  let message: string | null = null;
  let detail: string | undefined;
  let worktreeId: string | undefined;
  let severity: ActivitySeverity = "warning";
  const positional: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];

    const messageValue = parseValueArg(arg, "message");
    if (messageValue !== null) {
      message = messageValue;
      continue;
    }
    const detailValue = parseValueArg(arg, "detail");
    if (detailValue !== null) {
      detail = detailValue;
      continue;
    }
    const worktreeValue = parseValueArg(arg, "worktree");
    if (worktreeValue !== null) {
      worktreeId = worktreeValue;
      continue;
    }
    const severityValue = parseValueArg(arg, "severity");
    if (severityValue !== null) {
      if (
        severityValue === "info" ||
        severityValue === "success" ||
        severityValue === "warning" ||
        severityValue === "error"
      ) {
        severity = severityValue;
        continue;
      }
      throw new Error(`Invalid severity "${severityValue}"`);
    }

    if (arg === "--message" || arg === "--detail" || arg === "--worktree" || arg === "--severity") {
      const next = rawArgs[i + 1];
      if (!next) {
        throw new Error(`Missing value for ${arg}`);
      }
      i++;
      if (arg === "--message") {
        message = next;
      } else if (arg === "--detail") {
        detail = next;
      } else if (arg === "--worktree") {
        worktreeId = next;
      } else if (
        next === "info" ||
        next === "success" ||
        next === "warning" ||
        next === "error"
      ) {
        severity = next;
      } else {
        throw new Error(`Invalid severity "${next}"`);
      }
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option "${arg}"`);
    }

    positional.push(arg);
  }

  const finalMessage = (message ?? positional.join(" ")).trim();
  if (!finalMessage) {
    throw new Error("Message is required");
  }

  const finalDetail = detail?.trim();
  const finalWorktreeId = worktreeId?.trim();
  return {
    message: finalMessage,
    detail: finalDetail && finalDetail.length > 0 ? finalDetail : undefined,
    worktreeId: finalWorktreeId && finalWorktreeId.length > 0 ? finalWorktreeId : undefined,
    severity,
  };
}

function parsePhaseArgs(rawArgs: string[]): ParsedPhaseArgs {
  let phase: WorkflowPhase | null = null;
  let message: string | undefined;
  let detail: string | undefined;
  let worktreeId: string | undefined;
  let severity: ActivitySeverity = "info";
  const positional: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];

    const phaseValue = parseValueArg(arg, "phase");
    if (phaseValue !== null) {
      if (!WORKFLOW_PHASE_SET.has(phaseValue as WorkflowPhase)) {
        throw new Error(`Invalid phase "${phaseValue}"`);
      }
      phase = phaseValue as WorkflowPhase;
      continue;
    }
    const messageValue = parseValueArg(arg, "message");
    if (messageValue !== null) {
      message = messageValue;
      continue;
    }
    const detailValue = parseValueArg(arg, "detail");
    if (detailValue !== null) {
      detail = detailValue;
      continue;
    }
    const worktreeValue = parseValueArg(arg, "worktree");
    if (worktreeValue !== null) {
      worktreeId = worktreeValue;
      continue;
    }
    const severityValue = parseValueArg(arg, "severity");
    if (severityValue !== null) {
      if (
        severityValue === "info" ||
        severityValue === "success" ||
        severityValue === "warning" ||
        severityValue === "error"
      ) {
        severity = severityValue;
        continue;
      }
      throw new Error(`Invalid severity "${severityValue}"`);
    }

    if (
      arg === "--phase" ||
      arg === "--message" ||
      arg === "--detail" ||
      arg === "--worktree" ||
      arg === "--severity"
    ) {
      const next = rawArgs[i + 1];
      if (!next) throw new Error(`Missing value for ${arg}`);
      i++;
      if (arg === "--phase") {
        if (!WORKFLOW_PHASE_SET.has(next as WorkflowPhase)) {
          throw new Error(`Invalid phase "${next}"`);
        }
        phase = next as WorkflowPhase;
      } else if (arg === "--message") {
        message = next;
      } else if (arg === "--detail") {
        detail = next;
      } else if (arg === "--worktree") {
        worktreeId = next;
      } else if (
        next === "info" ||
        next === "success" ||
        next === "warning" ||
        next === "error"
      ) {
        severity = next;
      } else {
        throw new Error(`Invalid severity "${next}"`);
      }
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option "${arg}"`);
    }

    positional.push(arg);
  }

  const positionalPhase = positional.shift();
  if (!phase && positionalPhase) {
    if (!WORKFLOW_PHASE_SET.has(positionalPhase as WorkflowPhase)) {
      throw new Error(`Invalid phase "${positionalPhase}"`);
    }
    phase = positionalPhase as WorkflowPhase;
  }
  if (!phase) {
    throw new Error(`Workflow phase is required. Expected one of: ${WORKFLOW_PHASES.join(", ")}`);
  }
  if (positional.length > 0) {
    throw new Error(`Unexpected arguments: ${positional.join(" ")}`);
  }

  const finalDetail = detail?.trim();
  const finalWorktreeId = worktreeId?.trim();
  const finalMessage = message?.trim();
  return {
    phase,
    message: finalMessage && finalMessage.length > 0 ? finalMessage : undefined,
    detail: finalDetail && finalDetail.length > 0 ? finalDetail : undefined,
    worktreeId: finalWorktreeId && finalWorktreeId.length > 0 ? finalWorktreeId : undefined,
    severity,
  };
}

function parseCheckFlowArgs(rawArgs: string[]): ParsedCheckFlowArgs {
  let worktreeId: string | undefined;
  let json = false;
  const positional: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];

    const worktreeValue = parseValueArg(arg, "worktree");
    if (worktreeValue !== null) {
      worktreeId = worktreeValue;
      continue;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--worktree") {
      const next = rawArgs[i + 1];
      if (!next) throw new Error("Missing value for --worktree");
      i++;
      worktreeId = next;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option "${arg}"`);
    }
    positional.push(arg);
  }

  if (!worktreeId && positional.length > 0) {
    worktreeId = positional.shift();
  }
  if (positional.length > 0) {
    throw new Error(`Unexpected arguments: ${positional.join(" ")}`);
  }

  const finalWorktreeId = worktreeId?.trim();
  return {
    worktreeId: finalWorktreeId && finalWorktreeId.length > 0 ? finalWorktreeId : undefined,
    json,
  };
}

function inferWorktreeIdFromCwd(): string | null {
  const normalized = process.cwd().replace(/\\/g, "/");
  const marker = `/${CONFIG_DIR_NAME}/worktrees/`;
  const idx = normalized.indexOf(marker);
  if (idx < 0) return null;
  const rest = normalized.slice(idx + marker.length);
  const candidate = rest.split("/")[0]?.trim();
  return candidate || null;
}

function findRunningServerUrl(startDir: string): string | null {
  let currentDir = startDir;
  const { root } = path.parse(currentDir);

  while (true) {
    const serverJsonPath = path.join(currentDir, CONFIG_DIR_NAME, "server.json");
    if (existsSync(serverJsonPath)) {
      try {
        const data = JSON.parse(readFileSync(serverJsonPath, "utf-8")) as {
          url?: string;
          pid?: number;
        };
        if (data.url && typeof data.pid === "number") {
          process.kill(data.pid, 0);
          return data.url;
        }
      } catch {
        // Ignore stale/invalid server.json and continue searching upwards.
      }
    }

    if (currentDir === root) return null;
    currentDir = path.dirname(currentDir);
  }
}

async function emitAwaitingInputEvent(args: ParsedAwaitInputArgs): Promise<void> {
  const serverUrl = findRunningServerUrl(process.cwd());
  if (!serverUrl) {
    throw new Error("No running OpenKit server found for this project");
  }

  const worktreeId = args.worktreeId ?? inferWorktreeIdFromCwd() ?? undefined;
  const body = {
    category: "agent",
    type: ACTIVITY_TYPES.AGENT_AWAITING_INPUT,
    severity: args.severity,
    title: args.message,
    detail: args.detail,
    worktreeId,
    metadata: {
      requiresUserAction: true,
      awaitingUserInput: true,
      source: "cli",
    },
  } as const;

  const response = await fetch(`${serverUrl}/api/activity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
  if (!response.ok || payload.success !== true) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
}

async function emitWorkflowPhaseEvent(args: ParsedPhaseArgs): Promise<void> {
  const serverUrl = findRunningServerUrl(process.cwd());
  if (!serverUrl) {
    throw new Error("No running OpenKit server found for this project");
  }
  const worktreeId = args.worktreeId ?? inferWorktreeIdFromCwd();
  if (!worktreeId) {
    throw new Error("worktreeId is required (pass --worktree or run from a worktree directory)");
  }
  const body = {
    category: "agent",
    type: ACTIVITY_TYPES.WORKFLOW_PHASE,
    severity: args.severity,
    title: args.message ?? `Workflow phase: ${args.phase}`,
    detail: args.detail,
    worktreeId,
    metadata: {
      phase: args.phase,
      source: "cli",
    },
  } as const;

  const response = await fetch(`${serverUrl}/api/activity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
  if (!response.ok || payload.success !== true) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
}

function printFlowComplianceReport(report: FlowComplianceReport): void {
  log.plain(
    `Workflow compliance for ${report.worktreeId}: ${report.compliant ? "PASS" : "FAIL"}`,
  );
  const missingPhases = report.phases?.missing ?? [];
  if (missingPhases.length > 0) {
    log.plain(`Missing phases: ${missingPhases.join(", ")}`);
  }
  const outOfOrder = report.phases?.outOfOrder ?? [];
  if (outOfOrder.length > 0) {
    log.plain(
      `Out-of-order phases: ${outOfOrder.map((item) => `${item.previous} > ${item.current}`).join(", ")}`,
    );
  }
  const warnings = report.warnings ?? [];
  if (warnings.length > 0) {
    for (const warning of warnings) {
      log.plain(`Warning: ${warning}`);
    }
  }
  const missingActions = report.missingActions ?? [];
  if (missingActions.length > 0) {
    log.plain("Required actions:");
    for (const action of missingActions) {
      log.plain(`- ${action}`);
    }
  }
}

async function runCheckFlow(args: ParsedCheckFlowArgs): Promise<void> {
  const serverUrl = findRunningServerUrl(process.cwd());
  if (!serverUrl) {
    throw new Error("No running OpenKit server found for this project");
  }
  const worktreeId = args.worktreeId ?? inferWorktreeIdFromCwd();
  if (!worktreeId) {
    throw new Error("worktreeId is required (pass --worktree or run from a worktree directory)");
  }

  const response = await fetch(
    `${serverUrl}/api/worktrees/${encodeURIComponent(worktreeId)}/flow-compliance`,
  );
  const payload = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    report?: FlowComplianceReport;
    error?: string;
  };
  if (!response.ok || payload.success !== true || !payload.report) {
    throw new Error(payload.error || `Failed to check flow compliance (HTTP ${response.status})`);
  }

  if (args.json) {
    log.plain(JSON.stringify(payload.report, null, 2));
  } else {
    printFlowComplianceReport(payload.report);
  }

  if (!payload.report.compliant) {
    throw new Error("Workflow compliance check failed");
  }
}

export async function runActivity(rawArgs: string[]) {
  if (rawArgs.length === 0 || rawArgs.includes("--help") || rawArgs.includes("-h")) {
    printActivityHelp();
    return;
  }

  const subcommand = rawArgs[0]?.toLowerCase();
  if (subcommand === "await-input") {
    const parsed = parseAwaitInputArgs(rawArgs.slice(1));
    await emitAwaitingInputEvent(parsed);
    log.success("Posted awaiting-input activity event");
    return;
  }
  if (subcommand === "phase") {
    const parsed = parsePhaseArgs(rawArgs.slice(1));
    await emitWorkflowPhaseEvent(parsed);
    log.success(`Posted workflow phase "${parsed.phase}"`);
    return;
  }
  if (subcommand === "check-flow") {
    const parsed = parseCheckFlowArgs(rawArgs.slice(1));
    await runCheckFlow(parsed);
    log.success("Workflow compliance check passed");
    return;
  }
  throw new Error(`Unknown activity subcommand "${rawArgs[0]}"`);
}
