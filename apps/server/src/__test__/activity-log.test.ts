import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(""),
  writeFileSync: vi.fn(),
  statSync: vi.fn().mockReturnValue({ size: 0 }),
}));

vi.mock("nanoid", () => {
  let counter = 0;
  return {
    nanoid: vi.fn(() => `test-id-${++counter}`),
  };
});

import { ActivityLog } from "../activity-log";
import * as fs from "fs";
import { nanoid } from "nanoid";

const mockedExistsSync = fs.existsSync as ReturnType<typeof vi.fn>;
const mockedMkdirSync = fs.mkdirSync as ReturnType<typeof vi.fn>;
const mockedAppendFileSync = fs.appendFileSync as ReturnType<typeof vi.fn>;
const mockedReadFileSync = fs.readFileSync as ReturnType<typeof vi.fn>;
const mockedWriteFileSync = fs.writeFileSync as ReturnType<typeof vi.fn>;
const mockedStatSync = fs.statSync as ReturnType<typeof vi.fn>;

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
    mockedStatSync.mockReturnValue({ size: 0 });
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

    log = new ActivityLog("/home/user", { retentionDays: 7 });

    expect(mockedWriteFileSync).toHaveBeenCalled();
  });

  it("does not start an interval timer", () => {
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    log = new ActivityLog("/home/user");

    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  // --- dispose ---

  it("dispose is a no-op and does not throw", () => {
    log = new ActivityLog("/home/user");
    expect(() => log.dispose()).not.toThrow();
    // Can be called multiple times
    expect(() => log.dispose()).not.toThrow();
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

  it("calls pruneIfNeeded after writing when maxSizeMB is set", () => {
    const limitBytes = 100;
    log = new ActivityLog("/home/user", { maxSizeMB: limitBytes / (1024 * 1024) });

    // File is over the limit
    mockedStatSync.mockReturnValue({ size: limitBytes + 1 });
    mockedExistsSync.mockReturnValue(true);
    const existingEvent = makeEvent({ id: "old-1" });
    const existingEvent2 = makeEvent({ id: "old-2" });
    mockedReadFileSync.mockReturnValue(jsonlLines(existingEvent, existingEvent2));
    mockedWriteFileSync.mockClear();

    log.addEvent({
      category: "agent",
      type: "agent_connected",
      severity: "info",
      title: "Trigger prune",
    });

    // pruneBySizeSync should have been called, writing the file
    expect(mockedWriteFileSync).toHaveBeenCalled();
  });

  it("does not call pruneIfNeeded when maxSizeMB is not set", () => {
    log = new ActivityLog("/home/user");
    mockedWriteFileSync.mockClear();

    log.addEvent({
      category: "agent",
      type: "agent_connected",
      severity: "info",
      title: "No prune",
    });

    // writeFileSync should NOT be called (no size pruning)
    expect(mockedWriteFileSync).not.toHaveBeenCalled();
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

  it("does not prune when no limits are set (old entries survive)", () => {
    const now = new Date("2025-06-15T00:00:00.000Z").getTime();
    vi.setSystemTime(now);

    log = new ActivityLog("/home/user");
    mockedWriteFileSync.mockClear();

    const veryOld = makeEvent({
      id: "very-old",
      timestamp: new Date(now - 365 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const old = makeEvent({
      id: "old",
      timestamp: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(jsonlLines(veryOld, old));

    log.prune();

    const written = mockedWriteFileSync.mock.calls[0][1] as string;
    expect(written).toContain(veryOld.id);
    expect(written).toContain(old.id);
  });

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

    log = new ActivityLog("/home/user", { retentionDays: 7 });
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

  it("prune skips time-based pruning when retentionDays is undefined", () => {
    const now = new Date("2025-06-15T00:00:00.000Z").getTime();
    vi.setSystemTime(now);

    // No retentionDays
    log = new ActivityLog("/home/user");
    mockedWriteFileSync.mockClear();

    const oldEvent = makeEvent({
      id: "ancient",
      timestamp: new Date(now - 365 * 24 * 60 * 60 * 1000).toISOString(),
    });
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(jsonlLines(oldEvent));

    log.prune();

    const written = mockedWriteFileSync.mock.calls[0][1] as string;
    expect(written).toContain("ancient");
  });

  it("prune applies size-based pruning after time-based when maxSizeMB is set", () => {
    const now = new Date("2025-06-15T00:00:00.000Z").getTime();
    vi.setSystemTime(now);

    // Very small limit (1 byte) — everything should be pruned by size
    log = new ActivityLog("/home/user", { retentionDays: 365, maxSizeMB: 0.000001 });
    mockedWriteFileSync.mockClear();

    const event1 = makeEvent({ id: "e1", timestamp: new Date(now - 1000).toISOString() });
    const event2 = makeEvent({ id: "e2", timestamp: new Date(now - 500).toISOString() });
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(jsonlLines(event1, event2));

    log.prune();

    // Size prune should remove entries — writeFileSync called twice (time prune + size prune)
    expect(mockedWriteFileSync).toHaveBeenCalledTimes(2);
    // The last write should be an empty file (all removed by size)
    const lastWritten = mockedWriteFileSync.mock.calls[1][1] as string;
    expect(lastWritten).toBe("");
  });

  // --- size-based pruning ---

  it("pruneBySizeSync keeps newest entries that fit within maxSizeMB", () => {
    const now = new Date("2025-06-15T00:00:00.000Z").getTime();
    vi.setSystemTime(now);

    // Large enough to hold a few events but not all
    const oneMB = 1024 * 1024;
    log = new ActivityLog("/home/user", { maxSizeMB: oneMB / (1024 * 1024) }); // 1MB

    // File is over limit
    mockedStatSync.mockReturnValue({ size: oneMB + 1 });
    mockedExistsSync.mockReturnValue(true);
    mockedWriteFileSync.mockClear();

    // Create events - oldest first
    const events = [
      makeEvent({ id: "oldest", timestamp: new Date(now - 3000).toISOString() }),
      makeEvent({ id: "middle", timestamp: new Date(now - 2000).toISOString() }),
      makeEvent({ id: "newest", timestamp: new Date(now - 1000).toISOString() }),
    ];
    mockedReadFileSync.mockReturnValue(jsonlLines(...events));

    log.addEvent({
      category: "agent",
      type: "agent_connected",
      severity: "info",
      title: "Trigger prune",
    });

    // Should have written the file keeping newest entries
    expect(mockedWriteFileSync).toHaveBeenCalled();
  });

  it("size-based pruning: file under limit does not trigger pruneIfNeeded write", () => {
    log = new ActivityLog("/home/user", { maxSizeMB: 10 });

    // File is under the limit
    mockedStatSync.mockReturnValue({ size: 100 });
    mockedWriteFileSync.mockClear();

    log.addEvent({
      category: "agent",
      type: "agent_connected",
      severity: "info",
      title: "No prune needed",
    });

    // writeFileSync should NOT be called (file under limit)
    expect(mockedWriteFileSync).not.toHaveBeenCalled();
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

  it("updateConfig with maxSizeMB changes pruning behavior on next addEvent", () => {
    log = new ActivityLog("/home/user");

    // Initially no size limit — file over any limit, but no pruning
    mockedStatSync.mockReturnValue({ size: 999999999 });
    mockedWriteFileSync.mockClear();

    log.addEvent({
      category: "agent",
      type: "agent_connected",
      severity: "info",
      title: "Before update",
    });
    expect(mockedWriteFileSync).not.toHaveBeenCalled();

    // Now set a very small maxSizeMB
    log.updateConfig({ maxSizeMB: 0.000001 });

    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(jsonlLines(makeEvent({ id: "e1" })));
    mockedWriteFileSync.mockClear();

    log.addEvent({
      category: "agent",
      type: "agent_connected",
      severity: "info",
      title: "After update",
    });

    // Now writeFileSync should be called due to size pruning
    expect(mockedWriteFileSync).toHaveBeenCalled();
  });

  // --- getConfig ---

  it("returns current config", () => {
    log = new ActivityLog("/home/user");
    const config = log.getConfig();
    expect(config.retentionDays).toBeUndefined();
    expect(config.maxSizeMB).toBeUndefined();
    expect(config.categories.agent).toBe(true);
    expect(config.disabledEvents).toEqual([]);
  });

  it("returns config with retentionDays when specified", () => {
    log = new ActivityLog("/home/user", { retentionDays: 14 });
    const config = log.getConfig();
    expect(config.retentionDays).toBe(14);
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

  // --- estimateImpact ---

  it("estimateImpact returns zeros when file does not exist", () => {
    mockedExistsSync.mockReturnValue(false);
    log = new ActivityLog("/home/user");

    const result = log.estimateImpact({ retentionDays: 7 });
    expect(result).toEqual({
      entriesToRemove: 0,
      bytesToRemove: 0,
      currentEntries: 0,
      currentBytes: 0,
    });
  });

  it("estimateImpact returns correct counts for time-based pruning", () => {
    const now = new Date("2025-06-15T00:00:00.000Z").getTime();
    vi.setSystemTime(now);

    log = new ActivityLog("/home/user");

    const oldEvent = makeEvent({
      id: "old",
      timestamp: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const recentEvent = makeEvent({
      id: "recent",
      timestamp: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const content = jsonlLines(oldEvent, recentEvent);
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(content);

    const result = log.estimateImpact({ retentionDays: 7 });

    expect(result.currentEntries).toBe(2);
    expect(result.entriesToRemove).toBe(1); // only the old one
    expect(result.bytesToRemove).toBeGreaterThan(0);
    expect(result.currentBytes).toBeGreaterThan(result.bytesToRemove);
  });

  it("estimateImpact returns correct counts for size-based pruning", () => {
    log = new ActivityLog("/home/user");

    const event1 = makeEvent({ id: "e1", timestamp: "2025-01-01T00:00:00.000Z" });
    const event2 = makeEvent({ id: "e2", timestamp: "2025-06-01T00:00:00.000Z" });
    const content = jsonlLines(event1, event2);
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(content);

    // Very small limit — should remove all or most entries
    const result = log.estimateImpact({ maxSizeMB: 0.000001 });

    expect(result.currentEntries).toBe(2);
    expect(result.entriesToRemove).toBe(2); // all removed
    expect(result.bytesToRemove).toBeGreaterThan(0);
  });

  it("estimateImpact does not modify the file", () => {
    log = new ActivityLog("/home/user");

    const event = makeEvent({ id: "keep-me" });
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(jsonlLines(event));
    mockedWriteFileSync.mockClear();

    log.estimateImpact({ retentionDays: 1 });

    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });

  it("estimateImpact with no proposed limits returns zero removals", () => {
    log = new ActivityLog("/home/user");

    const event1 = makeEvent({ id: "e1", timestamp: "2025-01-01T00:00:00.000Z" });
    const event2 = makeEvent({ id: "e2", timestamp: "2025-06-01T00:00:00.000Z" });
    const content = jsonlLines(event1, event2);
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(content);

    const result = log.estimateImpact({});

    expect(result.currentEntries).toBe(2);
    expect(result.entriesToRemove).toBe(0);
    expect(result.bytesToRemove).toBe(0);
  });

  it("estimateImpact combines time and size pruning", () => {
    const now = new Date("2025-06-15T00:00:00.000Z").getTime();
    vi.setSystemTime(now);

    log = new ActivityLog("/home/user");

    // 3 events: 2 old (would survive time prune with 30 days but fail size), 1 recent
    const events = [
      makeEvent({ id: "e1", timestamp: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString() }),
      makeEvent({ id: "e2", timestamp: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString() }),
      makeEvent({ id: "e3", timestamp: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString() }),
    ];
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(jsonlLines(...events));

    // Prune by time (keep 30 days — all survive), then by size (tiny — removes all)
    const result = log.estimateImpact({ retentionDays: 30, maxSizeMB: 0.000001 });

    expect(result.currentEntries).toBe(3);
    expect(result.entriesToRemove).toBe(3);
  });

  it("estimateImpact returns zeros when readFileSync throws", () => {
    log = new ActivityLog("/home/user");
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("read error");
    });

    const result = log.estimateImpact({ retentionDays: 7 });
    expect(result).toEqual({
      entriesToRemove: 0,
      bytesToRemove: 0,
      currentEntries: 0,
      currentBytes: 0,
    });
  });
});
