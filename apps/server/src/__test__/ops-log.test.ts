import { mkdirSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OpsLog } from "../ops-log";
import type { OpsLogEvent } from "../ops-log";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `ops-log-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeEventPartial(
  overrides: Partial<OpsLogEvent> = {},
): Omit<OpsLogEvent, "id" | "timestamp"> {
  return {
    source: "test",
    action: "test.action",
    message: "test message",
    level: "info",
    status: "info",
    ...overrides,
  };
}

function seedEvents(
  logFilePath: string,
  events: Array<Partial<OpsLogEvent> & { timestamp: string }>,
): void {
  const lines = events.map((e) =>
    JSON.stringify({
      id: `seed-${Math.random().toString(36).slice(2)}`,
      source: e.source ?? "test",
      action: e.action ?? "test.action",
      message: e.message ?? "seeded event",
      level: e.level ?? "info",
      status: e.status ?? "info",
      ...e,
    }),
  );
  writeFileSync(logFilePath, lines.join("\n") + "\n");
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("OpsLog", () => {
  let tempDir: string;
  let log: OpsLog;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    log?.dispose();
  });

  // ── no limits ──────────────────────────────────────────────────────────────

  describe("no limits configured (default)", () => {
    it("retains old entries when no retentionDays is set", () => {
      const openkitDir = path.join(tempDir, ".openkit");
      mkdirSync(openkitDir, { recursive: true });
      const filePath = path.join(openkitDir, "ops-log.jsonl");

      seedEvents(filePath, [{ source: "old", timestamp: daysAgo(365) }]);

      // Startup prune with no retentionDays — old entries must survive.
      log = new OpsLog(tempDir);

      const events = log.getEvents({ limit: 5000 });
      expect(events).toHaveLength(1);
      expect(events[0]!.source).toBe("old");
    });

    it("retains large files when no maxSizeMB is set", () => {
      log = new OpsLog(tempDir);

      for (let i = 0; i < 50; i++) {
        log.addEvent({ ...makeEventPartial(), message: `event-${i} ${"x".repeat(200)}` });
      }

      const events = log.getEvents({ limit: 5000 });
      expect(events).toHaveLength(50);
    });
  });

  // ── time-based pruning ────────────────────────────────────────────────────

  describe("time-based pruning (retentionDays)", () => {
    it("removes entries older than retentionDays on construction", () => {
      const openkitDir = path.join(tempDir, ".openkit");
      mkdirSync(openkitDir, { recursive: true });
      const filePath = path.join(openkitDir, "ops-log.jsonl");

      seedEvents(filePath, [
        { source: "recent", timestamp: daysAgo(1) },
        { source: "borderline", timestamp: daysAgo(6) },
        { source: "old", timestamp: daysAgo(10) },
        { source: "ancient", timestamp: daysAgo(30) },
      ]);

      log = new OpsLog(tempDir, { retentionDays: 7 });

      const events = log.getEvents({ limit: 5000 });
      const sources = events.map((e) => e.source);
      expect(sources).toContain("recent");
      expect(sources).toContain("borderline");
      expect(sources).not.toContain("old");
      expect(sources).not.toContain("ancient");
    });

    it("does not remove entries within retentionDays", () => {
      log = new OpsLog(tempDir, { retentionDays: 7 });
      log.addEvent({ ...makeEventPartial(), source: "fresh" });

      const events = log.getEvents();
      expect(events[0]!.source).toBe("fresh");
    });

    it("prune() is a no-op on a missing log file", () => {
      log = new OpsLog(tempDir, { retentionDays: 1 });
      // File only exists if events have been added.
      expect(() => log.prune()).not.toThrow();
    });

    it("prune() with fake timers removes entries exactly at the boundary", () => {
      vi.useFakeTimers();

      try {
        vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));

        const openkitDir = path.join(tempDir, ".openkit");
        mkdirSync(openkitDir, { recursive: true });
        const filePath = path.join(openkitDir, "ops-log.jsonl");

        seedEvents(filePath, [
          { source: "within", timestamp: new Date("2026-01-12T12:00:00Z").toISOString() }, // 3 days ago
          { source: "outside", timestamp: new Date("2026-01-06T12:00:00Z").toISOString() }, // 9 days ago
        ]);

        log = new OpsLog(tempDir, { retentionDays: 7 });
        log.prune(); // explicit call to confirm

        const events = log.getEvents({ limit: 5000 });
        const sources = events.map((e) => e.source);
        expect(sources).toContain("within");
        expect(sources).not.toContain("outside");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ── size-based pruning ────────────────────────────────────────────────────

  describe("size-based pruning (maxSizeMB)", () => {
    it("removes oldest entries to fit within maxSizeMB on construction", () => {
      const openkitDir = path.join(tempDir, ".openkit");
      mkdirSync(openkitDir, { recursive: true });
      const filePath = path.join(openkitDir, "ops-log.jsonl");

      // 20 large events (each ~1 KB), oldest first
      const entries = Array.from({ length: 20 }, (_, i) => ({
        source: `event-${i}`,
        timestamp: daysAgo(20 - i),
        message: "x".repeat(1000),
      }));
      seedEvents(filePath, entries);

      log = new OpsLog(tempDir, { maxSizeMB: 0.005 }); // ~5 KB

      const surviving = log.getEvents({ limit: 5000 });
      const sources = surviving.map((e) => e.source);
      expect(sources).toContain("event-19"); // newest survives
      expect(sources).not.toContain("event-0"); // oldest pruned
    });

    it("does not prune when file is within maxSizeMB limit", () => {
      log = new OpsLog(tempDir, { maxSizeMB: 10 });
      log.addEvent(makeEventPartial());
      log.addEvent(makeEventPartial());

      const events = log.getEvents({ limit: 5000 });
      expect(events).toHaveLength(2);
    });

    it("keeps only newest entries that fit within size limit", () => {
      const openkitDir = path.join(tempDir, ".openkit");
      mkdirSync(openkitDir, { recursive: true });
      const filePath = path.join(openkitDir, "ops-log.jsonl");

      const entries = Array.from({ length: 10 }, (_, i) => ({
        source: `entry-${i}`,
        timestamp: daysAgo(10 - i),
        message: "a".repeat(400),
      }));
      seedEvents(filePath, entries);

      log = new OpsLog(tempDir, { maxSizeMB: 0.0015 });

      const surviving = log.getEvents({ limit: 5000 });
      expect(surviving.length).toBeGreaterThan(0);
      expect(surviving.length).toBeLessThan(10);
      const sources = surviving.map((e) => e.source);
      expect(sources).toContain("entry-9"); // newest must survive
    });
  });

  // ── pruneIfNeeded on addEvent ─────────────────────────────────────────────

  describe("size pruning triggered by addEvent", () => {
    it("prunes file after addEvent when size limit is exceeded", () => {
      const openkitDir = path.join(tempDir, ".openkit");
      mkdirSync(openkitDir, { recursive: true });
      const filePath = path.join(openkitDir, "ops-log.jsonl");

      const entries = Array.from({ length: 5 }, (_, i) => ({
        source: `old-${i}`,
        timestamp: daysAgo(5 - i),
        message: "b".repeat(200),
      }));
      seedEvents(filePath, entries);

      log = new OpsLog(tempDir, { maxSizeMB: 0.001 }); // very small

      log.addEvent({ ...makeEventPartial(), source: "new-event", message: "c".repeat(200) });

      const events = log.getEvents({ limit: 5000 });
      const sources = events.map((e) => e.source);
      expect(sources).toContain("new-event");
    });

    it("does not prune when maxSizeMB is not set", () => {
      log = new OpsLog(tempDir); // No maxSizeMB

      for (let i = 0; i < 10; i++) {
        log.addEvent({ ...makeEventPartial(), source: `event-${i}`, message: "d".repeat(200) });
      }

      const events = log.getEvents({ limit: 5000 });
      expect(events).toHaveLength(10);
    });
  });

  // ── updateConfig ──────────────────────────────────────────────────────────

  describe("updateConfig", () => {
    it("applies new retentionDays after updateConfig and prune()", () => {
      log = new OpsLog(tempDir); // No retention initially
      const openkitDir = path.join(tempDir, ".openkit");
      const filePath = path.join(openkitDir, "ops-log.jsonl");

      // Add an event so the directory/file exists, then overwrite with old timestamp.
      log.addEvent(makeEventPartial());
      seedEvents(filePath, [{ source: "stale", timestamp: daysAgo(30) }]);

      const before = log.getEvents({ limit: 5000 });
      expect(before).toHaveLength(1);

      log.updateConfig({ retentionDays: 7 });
      log.prune();

      const after = log.getEvents({ limit: 5000 });
      expect(after).toHaveLength(0);
    });

    it("applies new maxSizeMB after updateConfig and prune()", () => {
      const openkitDir = path.join(tempDir, ".openkit");
      mkdirSync(openkitDir, { recursive: true });
      const filePath = path.join(openkitDir, "ops-log.jsonl");

      const entries = Array.from({ length: 20 }, (_, i) => ({
        source: `e-${i}`,
        timestamp: daysAgo(20 - i),
        message: "e".repeat(1000),
      }));
      seedEvents(filePath, entries);

      log = new OpsLog(tempDir); // No size limit initially

      const before = log.getEvents({ limit: 5000 });
      expect(before).toHaveLength(20);

      log.updateConfig({ maxSizeMB: 0.005 });
      log.prune();

      const after = log.getEvents({ limit: 5000 });
      expect(after.length).toBeLessThan(20);
      const sources = after.map((e) => e.source);
      expect(sources).toContain("e-19"); // newest survives
    });

    it("merges partial updates without clearing unrelated fields", () => {
      log = new OpsLog(tempDir, { retentionDays: 30, maxSizeMB: 100 });

      // Update only retentionDays.
      log.updateConfig({ retentionDays: 14 });

      // With 100 MB limit, 5 small events should all survive.
      for (let i = 0; i < 5; i++) {
        log.addEvent(makeEventPartial());
      }
      const events = log.getEvents({ limit: 5000 });
      expect(events).toHaveLength(5);
    });
  });

  // ── estimateImpact ────────────────────────────────────────────────────────

  describe("estimateImpact", () => {
    it("returns zero counts when no file exists", () => {
      log = new OpsLog(tempDir);

      const result = log.estimateImpact({ retentionDays: 7 });

      expect(result).toEqual({
        entriesToRemove: 0,
        bytesToRemove: 0,
        currentEntries: 0,
        currentBytes: 0,
      });
    });

    it("estimates entries removed by retentionDays without modifying the file", () => {
      const openkitDir = path.join(tempDir, ".openkit");
      mkdirSync(openkitDir, { recursive: true });
      const filePath = path.join(openkitDir, "ops-log.jsonl");

      seedEvents(filePath, [
        { source: "recent", timestamp: daysAgo(2) },
        { source: "old-1", timestamp: daysAgo(10) },
        { source: "old-2", timestamp: daysAgo(20) },
      ]);

      log = new OpsLog(tempDir); // No limits

      const result = log.estimateImpact({ retentionDays: 7 });

      expect(result.currentEntries).toBe(3);
      expect(result.entriesToRemove).toBe(2);
      expect(result.bytesToRemove).toBeGreaterThan(0);

      // File must be unmodified.
      const after = log.getEvents({ limit: 5000 });
      expect(after).toHaveLength(3);
    });

    it("estimates entries removed by maxSizeMB without modifying the file", () => {
      const openkitDir = path.join(tempDir, ".openkit");
      mkdirSync(openkitDir, { recursive: true });
      const filePath = path.join(openkitDir, "ops-log.jsonl");

      const entries = Array.from({ length: 10 }, (_, i) => ({
        source: `e-${i}`,
        timestamp: daysAgo(10 - i),
        message: "f".repeat(500),
      }));
      seedEvents(filePath, entries);

      log = new OpsLog(tempDir); // No limits

      const result = log.estimateImpact({ maxSizeMB: 0.002 });

      expect(result.currentEntries).toBe(10);
      expect(result.entriesToRemove).toBeGreaterThan(0);
      expect(result.bytesToRemove).toBeGreaterThan(0);

      // File must be unmodified.
      const after = log.getEvents({ limit: 5000 });
      expect(after).toHaveLength(10);
    });

    it("combines retentionDays and maxSizeMB in impact estimate", () => {
      const openkitDir = path.join(tempDir, ".openkit");
      mkdirSync(openkitDir, { recursive: true });
      const filePath = path.join(openkitDir, "ops-log.jsonl");

      const entries = Array.from({ length: 10 }, (_, i) => ({
        source: `e-${i}`,
        timestamp: daysAgo(10 - i),
        message: "g".repeat(500),
      }));
      seedEvents(filePath, entries);

      log = new OpsLog(tempDir);

      // Time-based removes oldest 8 (keeping 2 days), then size limit may remove more.
      const result = log.estimateImpact({ retentionDays: 2, maxSizeMB: 0.0001 });

      expect(result.entriesToRemove).toBeGreaterThanOrEqual(8);
    });

    it("returns entriesToRemove=0 when proposed config removes nothing", () => {
      log = new OpsLog(tempDir, { retentionDays: 365 });
      log.addEvent(makeEventPartial());
      log.addEvent(makeEventPartial());

      const result = log.estimateImpact({ retentionDays: 365, maxSizeMB: 100 });

      expect(result.entriesToRemove).toBe(0);
      expect(result.bytesToRemove).toBe(0);
    });

    it("does not modify the file across multiple calls (idempotent)", () => {
      log = new OpsLog(tempDir);

      for (let i = 0; i < 5; i++) {
        log.addEvent({ ...makeEventPartial(), source: `s-${i}` });
      }

      const before = log.getEvents({ limit: 5000 });

      log.estimateImpact({ retentionDays: 1 });
      log.estimateImpact({ retentionDays: 1 });
      log.estimateImpact({ maxSizeMB: 0.001 });

      const after = log.getEvents({ limit: 5000 });
      expect(after).toHaveLength(before.length);
    });

    it("reports correct currentEntries and currentBytes", () => {
      log = new OpsLog(tempDir);
      log.addEvent(makeEventPartial());
      log.addEvent(makeEventPartial());

      const result = log.estimateImpact({}); // no changes proposed

      expect(result.currentEntries).toBe(2);
      expect(result.currentBytes).toBeGreaterThan(0);
    });
  });

  // ── dispose ───────────────────────────────────────────────────────────────

  describe("dispose", () => {
    it("is a no-op and does not throw", () => {
      log = new OpsLog(tempDir);
      expect(() => log.dispose()).not.toThrow();
    });

    it("can be called multiple times safely", () => {
      log = new OpsLog(tempDir);
      log.dispose();
      expect(() => log.dispose()).not.toThrow();
    });
  });

  // ── subscribe ─────────────────────────────────────────────────────────────

  describe("subscribe", () => {
    it("notifies listeners when an event is added", () => {
      log = new OpsLog(tempDir);
      const received: OpsLogEvent[] = [];
      log.subscribe((e) => received.push(e));

      log.addEvent(makeEventPartial());

      expect(received).toHaveLength(1);
      expect(received[0]!.source).toBe("test");
    });

    it("returns an unsubscribe function that stops notifications", () => {
      log = new OpsLog(tempDir);
      const received: OpsLogEvent[] = [];
      const unsub = log.subscribe((e) => received.push(e));

      log.addEvent(makeEventPartial());
      unsub();
      log.addEvent(makeEventPartial());

      expect(received).toHaveLength(1);
    });

    it("supports multiple concurrent listeners", () => {
      log = new OpsLog(tempDir);
      const r1: OpsLogEvent[] = [];
      const r2: OpsLogEvent[] = [];
      log.subscribe((e) => r1.push(e));
      log.subscribe((e) => r2.push(e));

      log.addEvent(makeEventPartial());

      expect(r1).toHaveLength(1);
      expect(r2).toHaveLength(1);
    });
  });

  // ── addEvent ──────────────────────────────────────────────────────────────

  describe("addEvent", () => {
    it("creates an event with generated id and current timestamp", () => {
      log = new OpsLog(tempDir);
      const before = new Date();

      const event = log.addEvent(makeEventPartial());

      const after = new Date();
      const ts = new Date(event.timestamp);
      expect(event.id).toBeDefined();
      expect(event.id.length).toBeGreaterThan(0);
      expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(ts.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("persists the event to the log file", () => {
      log = new OpsLog(tempDir);
      log.addEvent({ ...makeEventPartial(), source: "persist-test" });

      // Reconstruct from disk.
      const log2 = new OpsLog(tempDir);
      const events = log2.getEvents();
      log2.dispose();

      expect(events[0]!.source).toBe("persist-test");
    });

    it("returns the full event including id and timestamp", () => {
      log = new OpsLog(tempDir);
      const event = log.addEvent({ ...makeEventPartial(), message: "hello" });

      expect(event.message).toBe("hello");
      expect(event.id).toBeTruthy();
      expect(event.timestamp).toBeTruthy();
    });
  });
});
