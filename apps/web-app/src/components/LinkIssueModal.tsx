import { Link, ListTodo, Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";

import type { CustomTaskSummary, JiraIssueSummary, LinearIssueSummary } from "../types";
import { useApi } from "../hooks/useApi";
import { integration, tab, text } from "../theme";
import { JiraIcon, LinearIcon } from "../icons";
import { Modal } from "./Modal";

type IssueSource = "local" | "jira" | "linear";

interface LinkIssueModalProps {
  onClose: () => void;
  onLink: (source: IssueSource, issueId: string) => Promise<{ success: boolean; error?: string }>;
  jiraConfigured: boolean;
  linearConfigured: boolean;
}

export function LinkIssueModal({
  onClose,
  onLink,
  jiraConfigured,
  linearConfigured,
}: LinkIssueModalProps) {
  const api = useApi();
  const [search, setSearch] = useState("");
  const [isLinking, setIsLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [localTasks, setLocalTasks] = useState<CustomTaskSummary[]>([]);
  const [jiraIssues, setJiraIssues] = useState<JiraIssueSummary[]>([]);
  const [linearIssues, setLinearIssues] = useState<LinearIssueSummary[]>([]);

  // Determine available tabs
  const availableTabs: IssueSource[] = ["local"];
  if (jiraConfigured) availableTabs.push("jira");
  if (linearConfigured) availableTabs.push("linear");

  const [activeTab, setActiveTab] = useState<IssueSource>("local");

  // Fetch all issues on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const results = await Promise.all([
        api.fetchCustomTasks(),
        jiraConfigured ? api.fetchJiraIssues() : Promise.resolve({ issues: [] }),
        linearConfigured ? api.fetchLinearIssues() : Promise.resolve({ issues: [] }),
      ]);
      if (cancelled) return;
      setLocalTasks(results[0].tasks ?? []);
      setJiraIssues(results[1].issues ?? []);
      setLinearIssues(results[2].issues ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [api, jiraConfigured, linearConfigured]);

  const lowerSearch = search.toLowerCase();

  // Filter unlinked local tasks only
  const filteredLocal = localTasks
    .filter((t) => !t.linkedWorktreeId)
    .filter(
      (t) =>
        !search ||
        t.title.toLowerCase().includes(lowerSearch) ||
        t.id.toLowerCase().includes(lowerSearch),
    );

  const filteredJira = jiraIssues.filter(
    (i) =>
      !search ||
      i.summary.toLowerCase().includes(lowerSearch) ||
      i.key.toLowerCase().includes(lowerSearch),
  );

  const filteredLinear = linearIssues.filter(
    (i) =>
      !search ||
      i.title.toLowerCase().includes(lowerSearch) ||
      i.identifier.toLowerCase().includes(lowerSearch),
  );

  const handleLink = async (source: IssueSource, issueId: string) => {
    setIsLinking(true);
    setError(null);
    const result = await onLink(source, issueId);
    setIsLinking(false);
    if (result.success) {
      onClose();
    } else {
      setError(result.error ?? "Failed to link issue");
    }
  };

  const itemClass = `w-full text-left px-3 py-2.5 rounded-lg hover:bg-white/[0.04] transition-colors flex items-center gap-3`;

  return (
    <Modal
      title="Link Issue"
      icon={<Link className="w-4 h-4 text-violet-400" />}
      onClose={onClose}
      width="md"
    >
      <div className="space-y-3">
        {/* Tabs */}
        {availableTabs.length > 1 && (
          <div className="flex gap-1">
            {availableTabs.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setActiveTab(t)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors duration-150 ${
                  activeTab === t ? tab.active : tab.inactive
                }`}
              >
                {t === "local" ? "Local Tasks" : t === "jira" ? "Jira" : "Linear"}
              </button>
            ))}
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search
            className={`absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${text.dimmed}`}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search issues..."
            className={`w-full pl-9 pr-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-xs ${text.primary} placeholder-[#4b5563] outline-none focus:border-white/[0.15] transition-colors`}
            autoFocus
          />
        </div>

        {/* Issue list */}
        <div className="max-h-72 overflow-y-auto space-y-0.5">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
            </div>
          ) : (
            <>
              {activeTab === "local" &&
                (filteredLocal.length === 0 ? (
                  <p className={`text-xs ${text.muted} text-center py-6`}>
                    {search ? "No matching tasks" : "No unlinked tasks available"}
                  </p>
                ) : (
                  filteredLocal.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      disabled={isLinking}
                      onClick={() => handleLink("local", task.id)}
                      className={itemClass}
                    >
                      <ListTodo className={`w-4 h-4 flex-shrink-0 ${integration.localIssue}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-mono ${text.muted}`}>{task.id}</span>
                          <span className={`text-xs ${text.primary} truncate`}>{task.title}</span>
                        </div>
                      </div>
                      <span className={`text-[10px] ${text.dimmed} flex-shrink-0`}>
                        {task.status}
                      </span>
                    </button>
                  ))
                ))}

              {activeTab === "jira" &&
                (filteredJira.length === 0 ? (
                  <p className={`text-xs ${text.muted} text-center py-6`}>
                    {search ? "No matching issues" : "No Jira issues available"}
                  </p>
                ) : (
                  filteredJira.map((issue) => (
                    <button
                      key={issue.key}
                      type="button"
                      disabled={isLinking}
                      onClick={() => handleLink("jira", issue.key)}
                      className={itemClass}
                    >
                      <JiraIcon className={`w-4 h-4 flex-shrink-0 ${integration.jira}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-mono ${text.muted}`}>{issue.key}</span>
                          <span className={`text-xs ${text.primary} truncate`}>
                            {issue.summary}
                          </span>
                        </div>
                      </div>
                      <span className={`text-[10px] ${text.dimmed} flex-shrink-0`}>
                        {issue.status}
                      </span>
                    </button>
                  ))
                ))}

              {activeTab === "linear" &&
                (filteredLinear.length === 0 ? (
                  <p className={`text-xs ${text.muted} text-center py-6`}>
                    {search ? "No matching issues" : "No Linear issues available"}
                  </p>
                ) : (
                  filteredLinear.map((issue) => (
                    <button
                      key={issue.identifier}
                      type="button"
                      disabled={isLinking}
                      onClick={() => handleLink("linear", issue.identifier)}
                      className={itemClass}
                    >
                      <LinearIcon className={`w-4 h-4 flex-shrink-0 ${integration.linear}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-mono ${text.muted}`}>
                            {issue.identifier}
                          </span>
                          <span className={`text-xs ${text.primary} truncate`}>{issue.title}</span>
                        </div>
                      </div>
                      <span className={`text-[10px] ${text.dimmed} flex-shrink-0`}>
                        {issue.state.name}
                      </span>
                    </button>
                  ))
                ))}
            </>
          )}
        </div>

        {error && <p className={`${text.error} text-[11px]`}>{error}</p>}
      </div>
    </Modal>
  );
}
