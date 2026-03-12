import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(""),
  writeFileSync: vi.fn(),
}));

vi.mock("nanoid", () => {
  let counter = 0;
  return {
    nanoid: vi.fn(() => `test-id-${++counter}`),
  };
});

import { ActivityLog } from "./activity-log";
import * as fs from "fs";
import { nanoid } from "nanoid";

const mockedExistsSync = fs.existsSync as ReturnType<typeof vi.fn>;
const mockedMkdirSync = fs.mkdirSync as ReturnType<typeof vi.fn>;
const mockedAppendFileSync = fs.appendFileSync as ReturnType<typeof vi.fn>;
const mockedReadFileSync = fs.readFileSync as ReturnType<typeof vi.fn>;
const mockedWriteFileSync = fs.writeFileSync as ReturnType<typeof vi.fn>;

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    timestamp: new Date().toISOString(),
    category: "agent" as const,
    type: "agent_connected",
    severity: "info" as const,
    title: "Agent connected",
    ...overrides,
  };
}

function jsonlLines(...events: Record<string, unknown>[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

describe("ActivityLog", () => {
  let log: ActivityLog;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockedExistsSync.mockReturnValue(false);
    mockedReadFileSync.mockReturnValue("");
    (nanoid as ReturnType<typeof vi.fn>).mockImplementation(
      (() => {
        let c = 0;
        return () => `test-id-${++c}`;
      })(),
    );
  });

  afterEach(() => {
    log?.dispose();
    vi.useRealTimers();
  });

  // --- constructor ---

  it("creates .openkit directory if it does not exist", () => {
    mockedExistsSync.mockReturnValue(false);
    log = new ActivityLog("/home/user");

    expect(mockedMkdirSync).toHaveBeenCalledWith(expect.stringContaining(".openkit"), {
      recursive: true,
    });
  });

  it("does not create .openkit directory if it already exists", () => {
    mockedExistsSync.mockReturnValue(true);
    log = new ActivityLog("/home/user");

    expect(mockedMkdirSync).not.toHaveBeenCalled();
  });

  it("merges partial config with defaults", () => {
    log = new ActivityLog("/home/user", {
      retentionDays: 14,
      categories: { agent: false, worktree: true, system: true },
    });

    const config = log.getConfig();
    expect(config.retentionDays).toBe(14);
    expect(config.categories.agent).toBe(false);
    expect(config.categories.worktree).toBe(true);
    expect(config.toastEvents).toContain("creation_started");
    expect(config.osNotificationEvents).toContain("agent_awaiting_input");
  });

  it("calls prune on construction", () => {
    mockedExistsSync.mockReturnValue(true);
    const oldEvent = makeEvent({
      timestamp: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    mockedReadFileSync.mockReturnValue(JSON.stringify(oldEvent) + "\n");

    log = new ActivityLog("/home/user");

    expect(mockedWriteFileSync).toHaveBeenCalled();
  });

  it("starts an hourly prune interval", () => {
    log = new ActivityLog("/home/user");

    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("");

    vi.advanceTimersByTime(60 * 60 * 1000);
    // prune was called on construction + once by interval
    // On construction the file didn't exist so writeFileSync wasn't called,
    // but after advancing the timer with existsSync returning true, it should be called
    expect(mockedWriteFileSync).toHaveBeenCalled();
  });

  // --- dispose ---

  it("clears prune interval on dispose", () => {
    log = new ActivityLog("/home/user");
    log.dispose();

    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("");
    mockedWriteFileSync.mockClear();

    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });

  // --- addEvent ---

  it("persists event to file and notifies listeners when category is enabled", () => {
    log = new ActivityLog("/home/user");
    const listener = vi.fn();
    log.subscribe(listener);

    const event = log.addEvent({
      category: "agent",
      type: "agent_connected",
      severity: "info",
      title: "Connected",
    });

    expect(event.id).toBe("test-id-1");
    expect(event.timestamp).toBeDefined();
    expect(mockedAppendFileSync).toHaveBeenCalledWith(
      expect.stringContaining("activity.jsonl"),
      expect.stringContaining('"agent_connected"'),
    );
    expect(listener).toHaveBeenCalledWith(event);
  });

  it("skips persistence and notification when category is disabled", () => {
    log = new ActivityLog("/home/user", {
      categories: { agent: false, worktree: true, system: true },
    });
    const listener = vi.fn();
    log.subscribe(listener);

    const event = log.addEvent({
      category: "agent",
      type: "agent_connected",
      severity: "info",
      title: "Connected",
    });

    expect(event.id).toBeDefined();
    expect(mockedAppendFileSync).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it("skips persistence and notification when event type is in disabledEvents", () => {
    log = new ActivityLog("/home/user", {
      disabledEvents: ["agent_connected"],
    });
    const listener = vi.fn();
    log.subscribe(listener);

    log.addEvent({
      category: "agent",
      type: "agent_connected",
      severity: "info",
      title: "Connected",
    });

    expect(mockedAppendFileSync).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not break when a listener throws", () => {
    log = new ActivityLog("/home/user");
    const badListener = vi.fn(() => {
      throw new Error("boom");
    });
    const goodListener = vi.fn();
    log.subscribe(badListener);
    log.subscribe(goodListener);

    const event = log.addEvent({
      category: "agent",
      type: "agent_connected",
      severity: "info",
      title: "Connected",
    });

    expect(badListener).toHaveBeenCalled();
    expect(goodListener).toHaveBeenCalledWith(event);
  });

  it("does not break when file write throws", () => {
    log = new ActivityLog("/home/user");
    mockedAppendFileSync.mockImplementation(() => {
      throw new Error("disk full");
    });
    const listener = vi.fn();
    log.subscribe(listener);

    const event = log.addEvent({
      category: "agent",
      type: "agent_connected",
      severity: "info",
      title: "Connected",
    });

    expect(event.id).toBeDefined();
    expect(listener).toHaveBeenCalledWith(event);
  });

  // --- subscribe / unsubscribe ---

  it("unsubscribe removes listener", () => {
    log = new ActivityLog("/home/user");
    const listener = vi.fn();
    const unsub = log.subscribe(listener);

    unsub();

    log.addEvent({
      category: "agent",
      type: "agent_connected",
      severity: "info",
      title: "Connected",
    });

    expect(listener).not.toHaveBeenCalled();
  });

  // --- getEvents ---

  it("returns empty array when file does not exist", () => {
    log = new ActivityLog("/home/user");
    mockedExistsSync.mockReturnValue(false);

    expect(log.getEvents()).toEqual([]);
  });

  it("filters events by since", () => {
    log = new ActivityLog("/home/user");
    const old = makeEvent({ timestamp: "2025-01-01T00:00:00.000Z" });
    const recent = makeEvent({ timestamp: "2025-06-01T00:00:00.000Z" });
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(jsonlLines(old, recent));

    const result = log.getEvents({ since: "2025-03-01T00:00:00.000Z" });
    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toBe("2025-06-01T00:00:00.000Z");
  });

  it("filters events by category", () => {
    log = new ActivityLog("/home/user");
    const agent = makeEvent({ category: "agent" });
    const system = makeEvent({ category: "system" });
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(jsonlLines(agent, system));

    const result = log.getEvents({ category: "system" });
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("system");
  });

  it("limits results", () => {
    log = new ActivityLog("/home/user");
    const events = Array.from({ length: 5 }, (_, i) =>
      makeEvent({ id: `e-${i}`, timestamp: new Date(2025, 0, i + 1).toISOString() }),
    );
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(jsonlLines(...events));

    const result = log.getEvents({ limit: 2 });
    expect(result).toHaveLength(2);
  });

  it("sorts results newest first", () => {
    log = new ActivityLog("/home/user");
    const older = makeEvent({ id: "a", timestamp: "2025-01-01T00:00:00.000Z" });
    const newer = makeEvent({ id: "b", timestamp: "2025-06-01T00:00:00.000Z" });
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(jsonlLines(older, newer));

    const result = log.getEvents();
    expect(result[0].id).toBe("b");
    expect(result[1].id).toBe("a");
  });

  it("applies combined filters (since + category + limit)", () => {
    log = new ActivityLog("/home/user");
    const events = [
      makeEvent({ id: "1", category: "agent", timestamp: "2025-01-01T00:00:00.000Z" }),
      makeEvent({ id: "2", category: "system", timestamp: "2025-06-01T00:00:00.000Z" }),
      makeEvent({ id: "3", category: "agent", timestamp: "2025-06-02T00:00:00.000Z" }),
      makeEvent({ id: "4", category: "agent", timestamp: "2025-06-03T00:00:00.000Z" }),
    ];
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(jsonlLines(...events));

    const result = log.getEvents({
      since: "2025-03-01T00:00:00.000Z",
      category: "agent",
      limit: 1,
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("4");
  });

  it("skips corrupt JSONL lines gracefully", () => {
    log = new ActivityLog("/home/user");
    const valid = makeEvent({ id: "good" });
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify(valid) + "\n" + "NOT_JSON\n" + "{bad json\n");

    const result = log.getEvents();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("good");
  });

  it("returns empty array when readFileSync throws", () => {
    log = new ActivityLog("/home/user");
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("EACCES");
    });

    expect(log.getEvents()).toEqual([]);
  });

  // --- getRecentEvents ---

  it("delegates to getEvents with default limit of 50", () => {
    log = new ActivityLog("/home/user");
    const events = Array.from({ length: 60 }, (_, i) =>
      makeEvent({ id: `e-${i}`, timestamp: new Date(2025, 0, 1, 0, i).toISOString() }),
    );
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(jsonlLines(...events));

    const result = log.getRecentEvents();
    expect(result).toHaveLength(50);
  });

  it("accepts a custom count", () => {
    log = new ActivityLog("/home/user");
    const events = Array.from({ length: 10 }, (_, i) =>
      makeEvent({ id: `e-${i}`, timestamp: new Date(2025, 0, 1, 0, i).toISOString() }),
    );
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(jsonlLines(...events));

    const result = log.getRecentEvents(3);
    expect(result).toHaveLength(3);
  });

  // --- prune ---

  it("removes events older than retentionDays", () => {
    const now = new Date("2025-06-15T00:00:00.000Z").getTime();
    vi.setSystemTime(now);

    log = new ActivityLog("/home/user", { retentionDays: 7 });

    // Reset mocks after constructor prune
    mockedWriteFileSync.mockClear();

    const old = makeEvent({
      timestamp: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const recent = makeEvent({
      timestamp: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(),
    });
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(jsonlLines(old, recent));

    log.prune();

    expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);
    const written = mockedWriteFileSync.mock.calls[0][1] as string;
    expect(written).not.toContain(old.timestamp);
    expect(written).toContain(recent.timestamp);
  });

  it("prune writes empty string when all events are expired", () => {
    const now = new Date("2025-06-15T00:00:00.000Z").getTime();
    vi.setSystemTime(now);

    log = new ActivityLog("/home/user");
    mockedWriteFileSync.mockClear();

    const old = makeEvent({
      timestamp: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(jsonlLines(old));

    log.prune();

    const written = mockedWriteFileSync.mock.calls[0][1] as string;
    expect(written).toBe("");
  });

  // --- updateConfig ---

  it("updates config and changes addEvent behavior", () => {
    log = new ActivityLog("/home/user");
    const listener = vi.fn();
    log.subscribe(listener);

    // Initially agent category is enabled
    log.addEvent({
      category: "agent",
      type: "agent_connected",
      severity: "info",
      title: "Connected",
    });
    expect(listener).toHaveBeenCalledTimes(1);

    // Disable agent category
    log.updateConfig({ categories: { agent: false, worktree: true, system: true } });
    listener.mockClear();
    mockedAppendFileSync.mockClear();

    log.addEvent({
      category: "agent",
      type: "agent_connected",
      severity: "info",
      title: "Connected again",
    });
    expect(listener).not.toHaveBeenCalled();
    expect(mockedAppendFileSync).not.toHaveBeenCalled();
  });

  // --- getConfig ---

  it("returns current config", () => {
    log = new ActivityLog("/home/user");
    const config = log.getConfig();
    expect(config.retentionDays).toBe(7);
    expect(config.categories.agent).toBe(true);
    expect(config.disabledEvents).toEqual([]);
  });

  // --- isToastEvent / isOsNotificationEvent ---

  it("isToastEvent returns true for events in toastEvents list", () => {
    log = new ActivityLog("/home/user");
    expect(log.isToastEvent("creation_started")).toBe(true);
    expect(log.isToastEvent("creation_completed")).toBe(true);
    expect(log.isToastEvent("skill_failed")).toBe(true);
    expect(log.isToastEvent("crashed")).toBe(true);
    expect(log.isToastEvent("connection_lost")).toBe(true);
  });

  it("isToastEvent returns false for events not in toastEvents list", () => {
    log = new ActivityLog("/home/user");
    expect(log.isToastEvent("agent_connected")).toBe(false);
    expect(log.isToastEvent("random_event")).toBe(false);
  });

  it("isOsNotificationEvent returns true for events in osNotificationEvents list", () => {
    log = new ActivityLog("/home/user");
    expect(log.isOsNotificationEvent("agent_awaiting_input")).toBe(true);
  });

  it("isOsNotificationEvent returns false for events not in osNotificationEvents list", () => {
    log = new ActivityLog("/home/user");
    expect(log.isOsNotificationEvent("agent_connected")).toBe(false);
    expect(log.isOsNotificationEvent("creation_started")).toBe(false);
  });

  it("isToastEvent reflects updated config", () => {
    log = new ActivityLog("/home/user");
    expect(log.isToastEvent("custom_event")).toBe(false);

    log.updateConfig({ toastEvents: ["custom_event"] });
    expect(log.isToastEvent("custom_event")).toBe(true);
    // Previous defaults should be gone since the array is replaced
    expect(log.isToastEvent("creation_started")).toBe(false);
  });
});
