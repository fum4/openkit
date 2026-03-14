import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";

import { renderHook, waitFor, act } from "../test/render";
import { server } from "../test/setup";
import { useLinearIssues } from "./useLinearIssues";

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

function mockLinearIssuesHandler(
  issues: Array<{ identifier: string; title: string; status?: string; priority?: number }>,
) {
  server.use(
    http.get("/api/linear/issues", () => {
      return HttpResponse.json({
        issues: issues.map((i) => ({
          identifier: i.identifier,
          title: i.title,
          state: { name: i.status ?? "Todo" },
          priority: i.priority ?? 2,
          assignee: null,
          url: `https://linear.app/team/issue/${i.identifier}`,
        })),
      });
    }),
  );
}

describe("useLinearIssues", () => {
  beforeEach(() => {
    mockServerUrl = "";
  });

  it("returns empty issues initially", () => {
    const { result } = renderHook(() => useLinearIssues(true));

    expect(result.current.issues).toEqual([]);
    expect(result.current.searchQuery).toBe("");
    expect(result.current.error).toBeNull();
  });

  it("fetches issues when Linear is configured", async () => {
    mockLinearIssuesHandler([
      { identifier: "ENG-1", title: "First task" },
      { identifier: "ENG-2", title: "Second task", status: "In Progress", priority: 1 },
    ]);

    const { result } = renderHook(() => useLinearIssues(true));

    await waitFor(() => {
      expect(result.current.issues).toHaveLength(2);
    });

    expect(result.current.issues[0]).toMatchObject({
      identifier: "ENG-1",
      title: "First task",
    });
    expect(result.current.issues[1]).toMatchObject({
      identifier: "ENG-2",
      title: "Second task",
    });
    expect(result.current.error).toBeNull();
  });

  it("does not fetch when disabled", () => {
    mockLinearIssuesHandler([{ identifier: "ENG-1", title: "Should not appear" }]);

    const { result } = renderHook(() => useLinearIssues(false));

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
      mockLinearIssuesHandler([{ identifier: "ENG-1", title: "Match" }]);

      const { result } = renderHook(() => useLinearIssues(true));

      // Wait for initial fetch to complete
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Set search query — searchQuery updates immediately
      act(() => {
        result.current.setSearchQuery("auth");
      });

      expect(result.current.searchQuery).toBe("auth");

      // Advance past the 300ms debounce threshold to trigger internal debouncedQuery update
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
    });
  });
});
