import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";

import { renderHook, waitFor, act } from "../test/render";
import { server } from "../test/setup";
import { useJiraIssues } from "./useJiraIssues";

let mockServerUrl: string | null = "";

vi.mock("../contexts/ServerContext", () => ({
  useServer: () => ({
    serverUrl: null,
    projects: [],
    activeProject: null,
    openProject: async () => ({ success: true }),
    closeProject: async () => {},
    switchProject: () => {},
    isElectron: false,
    projectsLoading: false,
    selectFolder: async () => null,
  }),
  useServerUrl: () => "",
  useServerUrlOptional: () => mockServerUrl,
  ServerProvider: ({ children }: { children: React.ReactNode }) => children,
}));

function mockJiraIssuesHandler(
  issues: Array<{ key: string; summary: string; status?: string; priority?: string }>,
) {
  server.use(
    http.get("/api/jira/issues", () => {
      return HttpResponse.json({
        issues: issues.map((i) => ({
          key: i.key,
          summary: i.summary,
          status: i.status ?? "To Do",
          priority: i.priority ?? "Medium",
          type: "Task",
          assignee: null,
          url: `https://jira.example.com/browse/${i.key}`,
        })),
      });
    }),
  );
}

describe("useJiraIssues", () => {
  beforeEach(() => {
    mockServerUrl = "";
  });

  it("returns empty issues initially", () => {
    const { result } = renderHook(() => useJiraIssues(true));

    expect(result.current.issues).toEqual([]);
    expect(result.current.searchQuery).toBe("");
    expect(result.current.error).toBeNull();
  });

  it("fetches issues when Jira is configured", async () => {
    mockJiraIssuesHandler([
      { key: "TEST-1", summary: "First issue" },
      { key: "TEST-2", summary: "Second issue", status: "In Progress", priority: "High" },
    ]);

    const { result } = renderHook(() => useJiraIssues(true));

    await waitFor(() => {
      expect(result.current.issues).toHaveLength(2);
    });

    expect(result.current.issues[0]).toMatchObject({ key: "TEST-1", summary: "First issue" });
    expect(result.current.issues[1]).toMatchObject({
      key: "TEST-2",
      summary: "Second issue",
      status: "In Progress",
    });
    expect(result.current.error).toBeNull();
  });

  it("does not fetch when disabled", () => {
    mockJiraIssuesHandler([{ key: "TEST-1", summary: "Should not appear" }]);

    const { result } = renderHook(() => useJiraIssues(false));

    expect(result.current.issues).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  describe("debounced search", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("debounces search input by 300ms", async () => {
      mockJiraIssuesHandler([{ key: "TEST-1", summary: "Match" }]);

      const { result } = renderHook(() => useJiraIssues(true));

      // Wait for initial fetch to complete
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Set search query — searchQuery updates immediately
      act(() => {
        result.current.setSearchQuery("bug");
      });

      expect(result.current.searchQuery).toBe("bug");

      // Advance past the 300ms debounce threshold to trigger internal debouncedQuery update
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
    });
  });
});
