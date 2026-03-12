import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("fs", () => ({
  appendFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "test-id-001"),
}));

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { nanoid } from "nanoid";

import type { CommandMonitorEvent } from "./runtime/command-monitor";
import type { FetchMonitorEvent } from "./runtime/fetch-monitor";

const mockedExistsSync = vi.mocked(existsSync);
const mockedMkdirSync = vi.mocked(mkdirSync);
const mockedAppendFileSync = vi.mocked(appendFileSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);
const mockedNanoid = vi.mocked(nanoid);

function buildJsonl(events: Record<string, unknown>[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

describe("OpsLog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-11T12:00:00.000Z"));
    vi.clearAllMocks();

    mockedExistsSync.mockReturnValue(false);
    mockedNanoid.mockReturnValue("test-id-001");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function createOpsLog(configDir = "/tmp/project", config?: { retentionDays?: number }) {
    const { OpsLog } = await import("./ops-log");
    const log = new OpsLog(configDir, config);
    return log;
  }

  // ── constructor ──────────────────────────────────────────────────────

  describe("constructor", () => {
    it("creates the config directory when it does not exist", async () => {
      mockedExistsSync.mockReturnValue(false);
      await createOpsLog("/tmp/project");

      expect(mockedMkdirSync).toHaveBeenCalledWith("/tmp/project/.openkit", { recursive: true });
    });

    it("skips mkdir when the config directory already exists", async () => {
      mockedExistsSync.mockReturnValue(true);
      await createOpsLog("/tmp/project");

      // existsSync is called for both the dir check and prune; mkdirSync should not be called
      expect(mockedMkdirSync).not.toHaveBeenCalled();
    });

    it("sets up file path correctly", async () => {
      const log = await createOpsLog("/home/user/proj");
      // Verify by calling addEvent and checking appendFileSync path
      log.addEvent({
        source: "test",
        action: "test",
        message: "hi",
        level: "info",
        status: "info",
      });

      expect(mockedAppendFileSync).toHaveBeenCalledWith(
        "/home/user/proj/.openkit/ops-log.jsonl",
        expect.any(String),
      );
      log.dispose();
    });

    it("calls prune during construction", async () => {
      // When file exists, prune reads + writes
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue("");
      await createOpsLog("/tmp/project");

      // prune should have been invoked: readFileSync called at least once
      expect(mockedReadFileSync).toHaveBeenCalled();
    });

    it("starts a prune interval", async () => {
      const log = await createOpsLog("/tmp/project");

      // Reset mocks after construction
      mockedReadFileSync.mockClear();
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue("");

      // Advance 1 hour to trigger the interval
      vi.advanceTimersByTime(60 * 60 * 1000);

      expect(mockedReadFileSync).toHaveBeenCalled();
      log.dispose();
    });
  });

  // ── dispose ──────────────────────────────────────────────────────────

  describe("dispose", () => {
    it("clears the prune interval", async () => {
      const log = await createOpsLog("/tmp/project");
      log.dispose();

      mockedReadFileSync.mockClear();
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue("");

      vi.advanceTimersByTime(60 * 60 * 1000);

      // prune should NOT have been called after dispose
      expect(mockedReadFileSync).not.toHaveBeenCalled();
    });

    it("can be called multiple times safely", async () => {
      const log = await createOpsLog("/tmp/project");
      log.dispose();
      log.dispose();
      // No error thrown
    });
  });

  // ── subscribe ────────────────────────────────────────────────────────

  describe("subscribe", () => {
    it("adds a listener and returns an unsubscribe function", async () => {
      const log = await createOpsLog();
      const listener = vi.fn();

      const unsubscribe = log.subscribe(listener);
      log.addEvent({ source: "s", action: "a", message: "m", level: "info", status: "info" });

      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      log.addEvent({ source: "s", action: "a", message: "m2", level: "info", status: "info" });

      expect(listener).toHaveBeenCalledTimes(1);
      log.dispose();
    });

    it("supports multiple listeners", async () => {
      const log = await createOpsLog();
      const l1 = vi.fn();
      const l2 = vi.fn();

      log.subscribe(l1);
      log.subscribe(l2);
      log.addEvent({ source: "s", action: "a", message: "m", level: "info", status: "info" });

      expect(l1).toHaveBeenCalledTimes(1);
      expect(l2).toHaveBeenCalledTimes(1);
      log.dispose();
    });
  });

  // ── addEvent ─────────────────────────────────────────────────────────

  describe("addEvent", () => {
    it("creates an event with id and timestamp", async () => {
      const log = await createOpsLog();
      mockedNanoid.mockReturnValue("unique-abc");

      const event = log.addEvent({
        source: "test",
        action: "test.run",
        message: "hello",
        level: "info",
        status: "info",
      });

      expect(event.id).toBe("unique-abc");
      expect(event.timestamp).toBe("2026-03-11T12:00:00.000Z");
      expect(event.source).toBe("test");
      log.dispose();
    });

    it("appends JSON line to file", async () => {
      const log = await createOpsLog();
      log.addEvent({ source: "s", action: "a", message: "m", level: "info", status: "info" });

      const written = mockedAppendFileSync.mock.calls[0]?.[1] as string;
      const parsed = JSON.parse(written.trimEnd());
      expect(parsed.source).toBe("s");
      expect(written.endsWith("\n")).toBe(true);
      log.dispose();
    });

    it("notifies listeners with the full event", async () => {
      const log = await createOpsLog();
      const listener = vi.fn();
      log.subscribe(listener);

      const event = log.addEvent({
        source: "x",
        action: "y",
        message: "z",
        level: "debug",
        status: "started",
      });

      expect(listener).toHaveBeenCalledWith(event);
      log.dispose();
    });

    it("does not break when appendFileSync throws", async () => {
      const log = await createOpsLog();
      mockedAppendFileSync.mockImplementation(() => {
        throw new Error("disk full");
      });

      const listener = vi.fn();
      log.subscribe(listener);

      const event = log.addEvent({
        source: "s",
        action: "a",
        message: "m",
        level: "info",
        status: "info",
      });

      // Event is still returned and listeners still called
      expect(event.id).toBe("test-id-001");
      expect(listener).toHaveBeenCalledTimes(1);
      log.dispose();
    });

    it("does not break when a listener throws", async () => {
      const log = await createOpsLog();
      const badListener = vi.fn(() => {
        throw new Error("listener crash");
      });
      const goodListener = vi.fn();

      log.subscribe(badListener);
      log.subscribe(goodListener);

      const event = log.addEvent({
        source: "s",
        action: "a",
        message: "m",
        level: "info",
        status: "info",
      });

      expect(event).toBeDefined();
      expect(goodListener).toHaveBeenCalledTimes(1);
      log.dispose();
    });
  });

  // ── addCommandEvent ──────────────────────────────────────────────────

  describe("addCommandEvent", () => {
    function makeCommandEvent(overrides: Partial<CommandMonitorEvent> = {}): CommandMonitorEvent {
      return {
        runId: "run-1",
        phase: "start",
        timestamp: "2026-03-11T12:00:00.000Z",
        source: "cli",
        command: "git",
        args: ["status"],
        ...overrides,
      };
    }

    it("maps start phase to started status with info level", async () => {
      const log = await createOpsLog();
      const event = log.addCommandEvent(makeCommandEvent({ phase: "start" }));

      expect(event.status).toBe("started");
      expect(event.level).toBe("info");
      expect(event.message).toBe("Started: git status");
      log.dispose();
    });

    it("maps success phase to succeeded status with info level", async () => {
      const log = await createOpsLog();
      const event = log.addCommandEvent(
        makeCommandEvent({ phase: "success", exitCode: 0, durationMs: 150 }),
      );

      expect(event.status).toBe("succeeded");
      expect(event.level).toBe("info");
      expect(event.message).toBe("Succeeded: git status");
      log.dispose();
    });

    it("maps failure phase to failed status with error level", async () => {
      const log = await createOpsLog();
      const event = log.addCommandEvent(
        makeCommandEvent({ phase: "failure", error: "exit code 1" }),
      );

      expect(event.status).toBe("failed");
      expect(event.level).toBe("error");
      expect(event.message).toBe("Failed: git status (exit code 1)");
      log.dispose();
    });

    it("failure message omits error detail when not present", async () => {
      const log = await createOpsLog();
      const event = log.addCommandEvent(makeCommandEvent({ phase: "failure" }));

      expect(event.message).toBe("Failed: git status");
      log.dispose();
    });

    it("populates command payload", async () => {
      const log = await createOpsLog();
      const event = log.addCommandEvent(
        makeCommandEvent({ cwd: "/tmp", pid: 1234, exitCode: 0, signal: null }),
      );

      expect(event.command).toEqual({
        command: "git",
        args: ["status"],
        cwd: "/tmp",
        pid: 1234,
        exitCode: 0,
        signal: null,
        durationMs: undefined,
        stdout: undefined,
        stderr: undefined,
      });
      log.dispose();
    });

    it("uses 'command' as default source when source is empty", async () => {
      const log = await createOpsLog();
      const event = log.addCommandEvent(makeCommandEvent({ source: "" }));

      expect(event.source).toBe("command");
      log.dispose();
    });

    it("passes projectName through", async () => {
      const log = await createOpsLog();
      const event = log.addCommandEvent(makeCommandEvent(), "my-project");

      expect(event.projectName).toBe("my-project");
      log.dispose();
    });
  });

  // ── addFetchEvent ────────────────────────────────────────────────────

  describe("addFetchEvent", () => {
    function makeFetchEvent(overrides: Partial<FetchMonitorEvent> = {}): FetchMonitorEvent {
      return {
        runId: "run-2",
        phase: "success",
        timestamp: "2026-03-11T12:00:00.000Z",
        source: "jira",
        method: "GET",
        url: "https://api.example.com/items",
        path: "/items",
        statusCode: 200,
        durationMs: 50,
        ...overrides,
      };
    }

    it("maps successful fetch with 200 to info level / succeeded status", async () => {
      const log = await createOpsLog();
      const event = log.addFetchEvent(makeFetchEvent({ statusCode: 200 }));

      expect(event.level).toBe("info");
      expect(event.status).toBe("succeeded");
      expect(event.message).toBe("GET /items -> 200");
      log.dispose();
    });

    it("maps 4xx status codes to warning level / failed status", async () => {
      const log = await createOpsLog();
      const event = log.addFetchEvent(makeFetchEvent({ statusCode: 404 }));

      expect(event.level).toBe("warning");
      expect(event.status).toBe("failed");
      expect(event.message).toBe("GET /items -> 404");
      log.dispose();
    });

    it("maps 5xx status codes to error level / failed status", async () => {
      const log = await createOpsLog();
      const event = log.addFetchEvent(makeFetchEvent({ statusCode: 502 }));

      expect(event.level).toBe("error");
      expect(event.status).toBe("failed");
      expect(event.message).toBe("GET /items -> 502");
      log.dispose();
    });

    it("maps failure phase to error level with error message", async () => {
      const log = await createOpsLog();
      const event = log.addFetchEvent(
        makeFetchEvent({ phase: "failure", error: "ECONNREFUSED", statusCode: undefined }),
      );

      expect(event.level).toBe("error");
      expect(event.status).toBe("failed");
      expect(event.message).toBe("GET /items -> ECONNREFUSED");
      log.dispose();
    });

    it("uses 'request failed' when failure phase has no error", async () => {
      const log = await createOpsLog();
      const event = log.addFetchEvent(
        makeFetchEvent({ phase: "failure", error: undefined, statusCode: undefined }),
      );

      expect(event.message).toBe("GET /items -> request failed");
      log.dispose();
    });

    it("defaults method to GET when not provided", async () => {
      const log = await createOpsLog();
      const event = log.addFetchEvent(makeFetchEvent({ method: undefined as unknown as string }));

      expect(event.message).toMatch(/^GET /);
      log.dispose();
    });

    it("uses url as fallback when path is empty", async () => {
      const log = await createOpsLog();
      const event = log.addFetchEvent(makeFetchEvent({ path: "", url: "https://example.com/foo" }));

      expect(event.message).toBe("GET https://example.com/foo -> 200");
      log.dispose();
    });

    it("includes request/response metadata when present", async () => {
      const log = await createOpsLog();
      const event = log.addFetchEvent(
        makeFetchEvent({
          requestContentType: "application/json",
          requestPayload: '{"a":1}',
          requestPayloadTruncated: true,
          responseContentType: "application/json",
          responsePayload: '{"b":2}',
          responsePayloadTruncated: true,
        }),
      );

      expect(event.metadata).toMatchObject({
        requestContentType: "application/json",
        requestPayload: '{"a":1}',
        requestPayloadTruncated: true,
        responseContentType: "application/json",
        responsePayload: '{"b":2}',
        responsePayloadTruncated: true,
      });
      log.dispose();
    });
  });

  // ── addNotificationEvent ─────────────────────────────────────────────

  describe("addNotificationEvent", () => {
    it("creates an info notification event", async () => {
      const log = await createOpsLog();
      const event = log.addNotificationEvent("deploy complete", "info");

      expect(event.source).toBe("notification");
      expect(event.action).toBe("notification.emit");
      expect(event.level).toBe("info");
      expect(event.status).toBe("info");
      expect(event.message).toBe("deploy complete");
      log.dispose();
    });

    it("creates an error notification event with failed status", async () => {
      const log = await createOpsLog();
      const event = log.addNotificationEvent("build broke", "error", { buildId: 42 });

      expect(event.level).toBe("error");
      expect(event.status).toBe("failed");
      expect(event.metadata).toEqual({ buildId: 42 });
      log.dispose();
    });

    it("creates a warning notification event with info status", async () => {
      const log = await createOpsLog();
      const event = log.addNotificationEvent("slow query", "warning");

      expect(event.level).toBe("warning");
      expect(event.status).toBe("info");
      log.dispose();
    });
  });

  // ── getEvents ────────────────────────────────────────────────────────

  describe("getEvents", () => {
    it("returns empty array when file does not exist", async () => {
      const log = await createOpsLog();
      mockedExistsSync.mockReturnValue(false);

      expect(log.getEvents()).toEqual([]);
      log.dispose();
    });

    it("returns empty array for empty file", async () => {
      const log = await createOpsLog();
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue("");

      expect(log.getEvents()).toEqual([]);
      log.dispose();
    });

    it("parses JSONL and returns events sorted newest-first", async () => {
      const log = await createOpsLog();
      mockedExistsSync.mockReturnValue(true);

      const events = [
        {
          id: "1",
          timestamp: "2026-03-10T10:00:00Z",
          source: "a",
          action: "a",
          message: "first",
          level: "info",
          status: "info",
        },
        {
          id: "2",
          timestamp: "2026-03-11T10:00:00Z",
          source: "b",
          action: "b",
          message: "second",
          level: "info",
          status: "info",
        },
      ];
      mockedReadFileSync.mockReturnValue(buildJsonl(events));

      const result = log.getEvents();
      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe("2");
      expect(result[1]!.id).toBe("1");
      log.dispose();
    });

    it("skips corrupt JSONL lines", async () => {
      const log = await createOpsLog();
      mockedExistsSync.mockReturnValue(true);

      const content =
        JSON.stringify({
          id: "1",
          timestamp: "2026-03-11T10:00:00Z",
          source: "a",
          action: "a",
          message: "ok",
          level: "info",
          status: "info",
        }) +
        "\n{bad json\n" +
        JSON.stringify({
          id: "2",
          timestamp: "2026-03-11T11:00:00Z",
          source: "b",
          action: "b",
          message: "ok2",
          level: "info",
          status: "info",
        }) +
        "\n";

      mockedReadFileSync.mockReturnValue(content);
      const result = log.getEvents();

      expect(result).toHaveLength(2);
      log.dispose();
    });

    it("filters by since", async () => {
      const log = await createOpsLog();
      mockedExistsSync.mockReturnValue(true);

      const events = [
        {
          id: "1",
          timestamp: "2026-03-09T10:00:00Z",
          source: "a",
          action: "a",
          message: "old",
          level: "info",
          status: "info",
        },
        {
          id: "2",
          timestamp: "2026-03-11T10:00:00Z",
          source: "b",
          action: "b",
          message: "new",
          level: "info",
          status: "info",
        },
      ];
      mockedReadFileSync.mockReturnValue(buildJsonl(events));

      const result = log.getEvents({ since: "2026-03-10T00:00:00Z" });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("2");
      log.dispose();
    });

    it("filters by level", async () => {
      const log = await createOpsLog();
      mockedExistsSync.mockReturnValue(true);

      const events = [
        {
          id: "1",
          timestamp: "2026-03-11T10:00:00Z",
          source: "a",
          action: "a",
          message: "a",
          level: "info",
          status: "info",
        },
        {
          id: "2",
          timestamp: "2026-03-11T10:00:00Z",
          source: "b",
          action: "b",
          message: "b",
          level: "error",
          status: "failed",
        },
      ];
      mockedReadFileSync.mockReturnValue(buildJsonl(events));

      const result = log.getEvents({ level: "error" });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("2");
      log.dispose();
    });

    it("filters by status", async () => {
      const log = await createOpsLog();
      mockedExistsSync.mockReturnValue(true);

      const events = [
        {
          id: "1",
          timestamp: "2026-03-11T10:00:00Z",
          source: "a",
          action: "a",
          message: "a",
          level: "info",
          status: "started",
        },
        {
          id: "2",
          timestamp: "2026-03-11T10:00:00Z",
          source: "b",
          action: "b",
          message: "b",
          level: "info",
          status: "succeeded",
        },
      ];
      mockedReadFileSync.mockReturnValue(buildJsonl(events));

      const result = log.getEvents({ status: "started" });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("1");
      log.dispose();
    });

    it("filters by source (partial match)", async () => {
      const log = await createOpsLog();
      mockedExistsSync.mockReturnValue(true);

      const events = [
        {
          id: "1",
          timestamp: "2026-03-11T10:00:00Z",
          source: "http-client",
          action: "a",
          message: "a",
          level: "info",
          status: "info",
        },
        {
          id: "2",
          timestamp: "2026-03-11T10:00:00Z",
          source: "cli",
          action: "b",
          message: "b",
          level: "info",
          status: "info",
        },
      ];
      mockedReadFileSync.mockReturnValue(buildJsonl(events));

      const result = log.getEvents({ source: "http" });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("1");
      log.dispose();
    });

    it("filters by search across multiple fields", async () => {
      const log = await createOpsLog();
      mockedExistsSync.mockReturnValue(true);

      const events = [
        {
          id: "1",
          timestamp: "2026-03-11T10:00:00Z",
          source: "cli",
          action: "cmd",
          message: "ran deploy",
          level: "info",
          status: "info",
          projectName: "acme",
        },
        {
          id: "2",
          timestamp: "2026-03-11T10:00:00Z",
          source: "cli",
          action: "cmd",
          message: "ran test",
          level: "info",
          status: "info",
          projectName: "beta",
        },
      ];
      mockedReadFileSync.mockReturnValue(buildJsonl(events));

      // Search by projectName
      const result = log.getEvents({ search: "acme" });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("1");
      log.dispose();
    });

    it("search matches command fields", async () => {
      const log = await createOpsLog();
      mockedExistsSync.mockReturnValue(true);

      const events = [
        {
          id: "1",
          timestamp: "2026-03-11T10:00:00Z",
          source: "cli",
          action: "cmd",
          message: "ran something",
          level: "info",
          status: "info",
          command: { command: "pnpm", args: ["install", "--frozen-lockfile"], cwd: "/app" },
        },
      ];
      mockedReadFileSync.mockReturnValue(buildJsonl(events));

      expect(log.getEvents({ search: "frozen-lockfile" })).toHaveLength(1);
      expect(log.getEvents({ search: "pnpm" })).toHaveLength(1);
      expect(log.getEvents({ search: "/app" })).toHaveLength(1);
      log.dispose();
    });

    it("search is case-insensitive", async () => {
      const log = await createOpsLog();
      mockedExistsSync.mockReturnValue(true);

      const events = [
        {
          id: "1",
          timestamp: "2026-03-11T10:00:00Z",
          source: "cli",
          action: "cmd",
          message: "Deploy SUCCESS",
          level: "info",
          status: "info",
        },
      ];
      mockedReadFileSync.mockReturnValue(buildJsonl(events));

      expect(log.getEvents({ search: "deploy success" })).toHaveLength(1);
      log.dispose();
    });

    it("ignores empty search and source strings", async () => {
      const log = await createOpsLog();
      mockedExistsSync.mockReturnValue(true);

      const events = [
        {
          id: "1",
          timestamp: "2026-03-11T10:00:00Z",
          source: "a",
          action: "a",
          message: "a",
          level: "info",
          status: "info",
        },
      ];
      mockedReadFileSync.mockReturnValue(buildJsonl(events));

      expect(log.getEvents({ search: "  ", source: "  " })).toHaveLength(1);
      log.dispose();
    });

    it("applies limit", async () => {
      const log = await createOpsLog();
      mockedExistsSync.mockReturnValue(true);

      const events = Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        timestamp: `2026-03-11T${String(i).padStart(2, "0")}:00:00Z`,
        source: "s",
        action: "a",
        message: "m",
        level: "info",
        status: "info",
      }));
      mockedReadFileSync.mockReturnValue(buildJsonl(events));

      const result = log.getEvents({ limit: 3 });
      expect(result).toHaveLength(3);
      // Should be the 3 newest
      expect(result[0]!.id).toBe("9");
      log.dispose();
    });

    it("clamps limit to at least 1", async () => {
      const log = await createOpsLog();
      mockedExistsSync.mockReturnValue(true);

      const events = [
        {
          id: "1",
          timestamp: "2026-03-11T10:00:00Z",
          source: "a",
          action: "a",
          message: "a",
          level: "info",
          status: "info",
        },
      ];
      mockedReadFileSync.mockReturnValue(buildJsonl(events));

      const result = log.getEvents({ limit: 0 });
      expect(result).toHaveLength(1);
      log.dispose();
    });

    it("combines multiple filters", async () => {
      const log = await createOpsLog();
      mockedExistsSync.mockReturnValue(true);

      const events = [
        {
          id: "1",
          timestamp: "2026-03-11T10:00:00Z",
          source: "http",
          action: "a",
          message: "ok",
          level: "info",
          status: "succeeded",
        },
        {
          id: "2",
          timestamp: "2026-03-11T10:00:00Z",
          source: "http",
          action: "a",
          message: "bad",
          level: "error",
          status: "failed",
        },
        {
          id: "3",
          timestamp: "2026-03-11T10:00:00Z",
          source: "cli",
          action: "a",
          message: "bad",
          level: "error",
          status: "failed",
        },
        {
          id: "4",
          timestamp: "2026-03-09T10:00:00Z",
          source: "http",
          action: "a",
          message: "old bad",
          level: "error",
          status: "failed",
        },
      ];
      mockedReadFileSync.mockReturnValue(buildJsonl(events));

      const result = log.getEvents({
        since: "2026-03-10T00:00:00Z",
        level: "error",
        status: "failed",
        source: "http",
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("2");
      log.dispose();
    });

    it("returns empty array when readFileSync throws", async () => {
      const log = await createOpsLog();
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockImplementation(() => {
        throw new Error("read error");
      });

      expect(log.getEvents()).toEqual([]);
      log.dispose();
    });
  });

  // ── getRecentEvents ──────────────────────────────────────────────────

  describe("getRecentEvents", () => {
    it("delegates to getEvents with default limit of 200", async () => {
      const log = await createOpsLog();
      mockedExistsSync.mockReturnValue(true);

      const events = Array.from({ length: 300 }, (_, i) => ({
        id: String(i),
        timestamp: new Date(Date.now() - i * 1000).toISOString(),
        source: "s",
        action: "a",
        message: "m",
        level: "info",
        status: "info",
      }));
      mockedReadFileSync.mockReturnValue(buildJsonl(events));

      const result = log.getRecentEvents();
      expect(result).toHaveLength(200);
      log.dispose();
    });

    it("accepts a custom count", async () => {
      const log = await createOpsLog();
      mockedExistsSync.mockReturnValue(true);

      const events = Array.from({ length: 50 }, (_, i) => ({
        id: String(i),
        timestamp: new Date(Date.now() - i * 1000).toISOString(),
        source: "s",
        action: "a",
        message: "m",
        level: "info",
        status: "info",
      }));
      mockedReadFileSync.mockReturnValue(buildJsonl(events));

      const result = log.getRecentEvents(5);
      expect(result).toHaveLength(5);
      log.dispose();
    });
  });

  // ── prune ────────────────────────────────────────────────────────────

  describe("prune", () => {
    it("does nothing when file does not exist", async () => {
      mockedExistsSync.mockReturnValue(false);
      const log = await createOpsLog();

      expect(mockedReadFileSync).not.toHaveBeenCalled();
      expect(mockedWriteFileSync).not.toHaveBeenCalled();
      log.dispose();
    });

    it("removes events older than retentionDays", async () => {
      // First call (constructor) - file does not exist
      mockedExistsSync.mockReturnValueOnce(false); // dir check
      mockedExistsSync.mockReturnValueOnce(false); // prune check

      const { OpsLog } = await import("./ops-log");
      const log = new OpsLog("/tmp/proj", { retentionDays: 3 });

      // Now set up for manual prune call
      mockedExistsSync.mockReturnValue(true);

      const now = new Date("2026-03-11T12:00:00.000Z");
      const oldEvent = {
        id: "old",
        timestamp: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString(),
        source: "s",
        action: "a",
        message: "old",
        level: "info",
        status: "info",
      };
      const newEvent = {
        id: "new",
        timestamp: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        source: "s",
        action: "a",
        message: "new",
        level: "info",
        status: "info",
      };
      mockedReadFileSync.mockReturnValue(buildJsonl([oldEvent, newEvent]));
      mockedWriteFileSync.mockClear();

      log.prune();

      expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);
      const written = mockedWriteFileSync.mock.calls[0]![1] as string;
      expect(written).toContain('"id":"new"');
      expect(written).not.toContain('"id":"old"');
      log.dispose();
    });

    it("writes empty string when all events are pruned", async () => {
      mockedExistsSync.mockReturnValueOnce(false); // dir check
      mockedExistsSync.mockReturnValueOnce(false); // prune check

      const { OpsLog } = await import("./ops-log");
      const log = new OpsLog("/tmp/proj", { retentionDays: 1 });

      mockedExistsSync.mockReturnValue(true);

      const oldEvent = {
        id: "old",
        timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        source: "s",
        action: "a",
        message: "old",
        level: "info",
        status: "info",
      };
      mockedReadFileSync.mockReturnValue(buildJsonl([oldEvent]));
      mockedWriteFileSync.mockClear();

      log.prune();

      const written = mockedWriteFileSync.mock.calls[0]![1] as string;
      expect(written).toBe("");
      log.dispose();
    });

    it("discards corrupt lines during prune", async () => {
      mockedExistsSync.mockReturnValueOnce(false);
      mockedExistsSync.mockReturnValueOnce(false);

      const { OpsLog } = await import("./ops-log");
      const log = new OpsLog("/tmp/proj");

      mockedExistsSync.mockReturnValue(true);

      const validEvent = {
        id: "ok",
        timestamp: new Date(Date.now() - 1000).toISOString(),
        source: "s",
        action: "a",
        message: "m",
        level: "info",
        status: "info",
      };
      const content = JSON.stringify(validEvent) + "\n{corrupt\n";
      mockedReadFileSync.mockReturnValue(content);
      mockedWriteFileSync.mockClear();

      log.prune();

      const written = mockedWriteFileSync.mock.calls[0]![1] as string;
      expect(written).toContain('"id":"ok"');
      expect(written).not.toContain("corrupt");
      log.dispose();
    });

    it("silently handles read errors during prune", async () => {
      mockedExistsSync.mockReturnValueOnce(false);
      mockedExistsSync.mockReturnValueOnce(false);

      const { OpsLog } = await import("./ops-log");
      const log = new OpsLog("/tmp/proj");

      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockImplementation(() => {
        throw new Error("disk error");
      });

      // Should not throw
      expect(() => log.prune()).not.toThrow();
      log.dispose();
    });
  });
});
