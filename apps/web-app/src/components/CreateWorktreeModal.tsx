import { useEffect, useRef, useState } from "react";
import { AlertTriangle, GitBranch } from "lucide-react";

import { useApi } from "../hooks/useApi";
import { input, text } from "../theme";
import { Button } from "./Button";
import { JiraIcon, LinearIcon } from "../icons";
import { Modal } from "./Modal";
import { WorktreeExistsModal } from "./WorktreeExistsModal";

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md bg-red-900/20 px-3 py-2">
      <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-px" />
      <p className="text-[11px] text-red-300">{message}</p>
    </div>
  );
}

interface CreateWorktreeModalProps {
  mode: "branch" | "jira" | "linear";
  hasBranchNameRule?: boolean;
  onCreated: (worktreeId: string) => void;
  onClose: () => void;
  onSetupNeeded?: () => void;
}

/** Sanitize a branch name into a valid worktree name (letters, numbers, spaces, hyphens). */
function sanitizeWorktreeName(branchName: string): string {
  return branchName
    .replace(/[^a-zA-Z0-9 -]/g, "-") // swap invalid chars (e.g. `/`, `_`, `.`) with hyphens
    .replace(/-{2,}/g, "-") // collapse consecutive hyphens
    .replace(/^-+|-+$/g, ""); // trim leading/trailing hyphens
}

function resolveCreatedWorktreeId(result: {
  worktreeId?: string;
  worktree?: { id: string };
}): string | null {
  return result.worktreeId ?? result.worktree?.id ?? null;
}

function requiresWorktreeRecoveryPrompt(result: {
  success: boolean;
  code?: string;
  worktreeId?: string;
  error?: string;
}): boolean {
  if (result.success || !result.worktreeId) return false;
  if (result.code === "WORKTREE_RECOVERY_REQUIRED") return true;
  return (result.error ?? "").includes("cannot lock ref 'refs/heads/");
}

export function CreateWorktreeModal({
  mode,
  hasBranchNameRule,
  onCreated,
  onClose,
  onSetupNeeded,
}: CreateWorktreeModalProps) {
  const api = useApi();

  // Branch form state
  const [branch, setBranch] = useState("");
  const [name, setName] = useState("");
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Jira form state
  const [taskId, setTaskId] = useState("");
  const [jiraBranch, setJiraBranch] = useState("");
  const [jiraBranchManuallyEdited, setJiraBranchManuallyEdited] = useState(false);

  // Linear form state
  const [linearId, setLinearId] = useState("");
  const [linearBranch, setLinearBranch] = useState("");
  const [linearBranchManuallyEdited, setLinearBranchManuallyEdited] = useState(false);

  // Worktree exists modal state
  const [existingWorktree, setExistingWorktree] = useState<{ id: string; branch: string } | null>(
    null,
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (mode === "branch" && !nameManuallyEdited) {
      setName(sanitizeWorktreeName(branch.trim()));
    }
  }, [branch, nameManuallyEdited, mode]);

  useEffect(() => {
    if (mode === "jira" && !jiraBranchManuallyEdited && !hasBranchNameRule) {
      setJiraBranch(taskId.trim());
    }
  }, [taskId, jiraBranchManuallyEdited, mode, hasBranchNameRule]);

  useEffect(() => {
    if (mode === "linear" && !linearBranchManuallyEdited && !hasBranchNameRule) {
      setLinearBranch(linearId.trim());
    }
  }, [linearId, linearBranchManuallyEdited, mode, hasBranchNameRule]);

  const handleNameChange = (value: string) => {
    setName(value);
    setNameManuallyEdited(true);
    if (error) setError(null);
  };

  const handleJiraBranchChange = (value: string) => {
    setJiraBranch(value);
    setJiraBranchManuallyEdited(true);
  };

  const handleLinearBranchChange = (value: string) => {
    setLinearBranch(value);
    setLinearBranchManuallyEdited(true);
  };

  const handleBranchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branch.trim() || isCreating) return;

    setIsCreating(true);
    setError(null);

    const resolvedBranch = branch.trim();
    const resolvedName = name.trim() || resolvedBranch;
    const result = await api.createWorktree(resolvedBranch, resolvedName);
    setIsCreating(false);

    const createdWorktreeId = resolveCreatedWorktreeId(result);
    if (result.success && createdWorktreeId) {
      onCreated(createdWorktreeId);
      onClose();
    } else if (result.success) {
      setError("Worktree was created, but the response did not include a worktree id.");
    } else if (
      (result.code === "WORKTREE_EXISTS" || requiresWorktreeRecoveryPrompt(result)) &&
      result.worktreeId
    ) {
      setExistingWorktree({ id: result.worktreeId, branch: resolvedBranch });
    } else {
      const errorMsg = result.error || "Failed to create worktree";
      if (errorMsg.includes("no commits") || errorMsg.includes("invalid reference")) {
        onClose();
        onSetupNeeded?.();
      } else {
        setError(errorMsg);
      }
    }
  };

  const handleJiraSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskId.trim() || isCreating) return;

    setIsCreating(true);
    setError(null);

    const result = await api.createFromJira(taskId.trim(), jiraBranch.trim() || undefined);
    setIsCreating(false);

    const createdWorktreeId = resolveCreatedWorktreeId(result);
    if (result.success && createdWorktreeId) {
      onCreated(createdWorktreeId);
      onClose();
    } else if (result.success) {
      setError("Worktree was created, but the response did not include a worktree id.");
    } else if (
      (result.code === "WORKTREE_EXISTS" || requiresWorktreeRecoveryPrompt(result)) &&
      result.worktreeId
    ) {
      setExistingWorktree({ id: result.worktreeId, branch: jiraBranch.trim() || taskId.trim() });
    } else {
      const errorMsg = result.error || "Failed to create from Jira";
      if (errorMsg.includes("no commits") || errorMsg.includes("invalid reference")) {
        onClose();
        onSetupNeeded?.();
      } else {
        setError(errorMsg);
      }
    }
  };

  const handleLinearSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linearId.trim() || isCreating) return;

    setIsCreating(true);
    setError(null);

    const result = await api.createFromLinear(linearId.trim(), linearBranch.trim() || undefined);
    setIsCreating(false);

    const createdWorktreeId = resolveCreatedWorktreeId(result);
    if (result.success && createdWorktreeId) {
      onCreated(createdWorktreeId);
      onClose();
    } else if (result.success) {
      setError("Worktree was created, but the response did not include a worktree id.");
    } else if (
      (result.code === "WORKTREE_EXISTS" || requiresWorktreeRecoveryPrompt(result)) &&
      result.worktreeId
    ) {
      setExistingWorktree({
        id: result.worktreeId,
        branch: linearBranch.trim() || linearId.trim(),
      });
    } else {
      const errorMsg = result.error || "Failed to create from Linear";
      if (errorMsg.includes("no commits") || errorMsg.includes("invalid reference")) {
        onClose();
        onSetupNeeded?.();
      } else {
        setError(errorMsg);
      }
    }
  };

  const focusBorder = "focus:border-white/[0.15]";
  const inputClass = `w-full px-2.5 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.06] ${input.text} placeholder-[#4b5563] outline-none focus:bg-white/[0.05] ${focusBorder} transition-all text-xs`;

  return (
    <>
      <Modal
        title={
          mode === "branch"
            ? "Create Worktree"
            : mode === "jira"
              ? "Pull from Jira"
              : "Pull from Linear"
        }
        icon={
          mode === "branch" ? (
            <GitBranch className="w-5 h-5 text-accent" />
          ) : mode === "jira" ? (
            <JiraIcon className="w-5 h-5 text-blue-400" />
          ) : (
            <LinearIcon className="w-5 h-5 text-[#5E6AD2]" />
          )
        }
        onClose={onClose}
        onSubmit={
          mode === "branch"
            ? handleBranchSubmit
            : mode === "jira"
              ? handleJiraSubmit
              : handleLinearSubmit
        }
        footer={
          <>
            <Button onClick={onClose} disabled={isCreating}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={mode === "jira" ? "jira" : mode === "linear" ? "linear" : "primary"}
              disabled={
                mode === "branch"
                  ? !branch.trim()
                  : mode === "jira"
                    ? !taskId.trim()
                    : !linearId.trim()
              }
              loading={isCreating}
            >
              {mode === "branch" ? "Create Worktree" : "Pull & Create"}
            </Button>
          </>
        }
      >
        {mode === "branch" ? (
          <div className="space-y-3">
            <div>
              <label className={`block text-xs font-medium ${text.muted} mb-1.5`}>
                Branch name
              </label>
              <input
                ref={inputRef}
                type="text"
                value={branch}
                onChange={(e) => {
                  setBranch(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="feat/my-feature"
                className={inputClass}
                disabled={isCreating}
              />
              <p className={`mt-1 text-[11px] ${text.dimmed}`}>
                Will be created from the base branch if it doesn't exist
              </p>
            </div>
            <div>
              <label className={`block text-xs font-medium ${text.muted} mb-1.5`}>
                Worktree name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Defaults to branch name"
                className={`${inputClass}${error ? " border-red-400/60" : ""}`}
                disabled={isCreating}
              />
            </div>
            {error && <ErrorBanner message={error} />}
          </div>
        ) : mode === "jira" ? (
          <div className="space-y-3">
            <p className={`text-xs ${text.secondary} leading-relaxed`}>
              Pull a Jira issue into your workspace and create a linked worktree.
            </p>
            <div>
              <label className={`block text-xs font-medium ${text.muted} mb-1.5`}>Task ID</label>
              <input
                ref={inputRef}
                type="text"
                value={taskId}
                onChange={(e) => setTaskId(e.target.value)}
                placeholder="PROJ-123"
                className={inputClass}
                disabled={isCreating}
              />
            </div>
            <div>
              <label className={`block text-xs font-medium ${text.muted} mb-1.5`}>
                Branch name
              </label>
              <input
                type="text"
                value={jiraBranch}
                onChange={(e) => handleJiraBranchChange(e.target.value)}
                placeholder={
                  hasBranchNameRule ? "Leave empty to auto-generate" : "Defaults to task ID"
                }
                className={inputClass}
                disabled={isCreating}
              />
              {hasBranchNameRule && (
                <p className={`mt-1 text-[11px] ${text.dimmed}`}>
                  Branch name will be generated from issue details
                </p>
              )}
            </div>
            {error && <ErrorBanner message={error} />}
          </div>
        ) : (
          <div className="space-y-3">
            <p className={`text-xs ${text.secondary} leading-relaxed`}>
              Pull a Linear issue into your workspace and create a linked worktree.
            </p>
            <div>
              <label className={`block text-xs font-medium ${text.muted} mb-1.5`}>Issue ID</label>
              <input
                ref={inputRef}
                type="text"
                value={linearId}
                onChange={(e) => setLinearId(e.target.value)}
                placeholder="ENG-123"
                className={inputClass}
                disabled={isCreating}
              />
            </div>
            <div>
              <label className={`block text-xs font-medium ${text.muted} mb-1.5`}>
                Branch name
              </label>
              <input
                type="text"
                value={linearBranch}
                onChange={(e) => handleLinearBranchChange(e.target.value)}
                placeholder={
                  hasBranchNameRule ? "Leave empty to auto-generate" : "Defaults to issue ID"
                }
                className={inputClass}
                disabled={isCreating}
              />
              {hasBranchNameRule && (
                <p className={`mt-1 text-[11px] ${text.dimmed}`}>
                  Branch name will be generated from issue details
                </p>
              )}
            </div>
            {error && <ErrorBanner message={error} />}
          </div>
        )}
      </Modal>

      {existingWorktree && (
        <WorktreeExistsModal
          worktreeId={existingWorktree.id}
          branch={existingWorktree.branch}
          onResolved={() => {
            setExistingWorktree(null);
            onCreated(existingWorktree.id);
            onClose();
          }}
          onCancel={() => setExistingWorktree(null)}
        />
      )}
    </>
  );
}
