import { vi, describe, it, expect, beforeEach } from "vitest";

import { renderHook, waitFor } from "../test/render";
import { useCustomTasks } from "./useCustomTasks";

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

describe("useCustomTasks", () => {
  beforeEach(() => {
    mockServerUrl = "";
  });

  it("returns empty array initially", () => {
    const { result } = renderHook(() => useCustomTasks());

    expect(result.current.tasks).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("fetches tasks from server", async () => {
    const { result } = renderHook(() => useCustomTasks());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // The real server bridge returns an empty tasks array since no tasks have been created
    expect(result.current.tasks).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("does not fetch when serverUrl is null", async () => {
    mockServerUrl = null;
    const { result } = renderHook(() => useCustomTasks());

    // Should remain in initial state — query is disabled
    expect(result.current.tasks).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("exposes refetch function", async () => {
    const { result } = renderHook(() => useCustomTasks());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(typeof result.current.refetch).toBe("function");
  });

  it("exposes updatedAt timestamp after fetch completes", async () => {
    const { result } = renderHook(() => useCustomTasks());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.updatedAt).toBeGreaterThan(0);
  });
});
