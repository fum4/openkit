# Log Retention Limits & List Virtualization — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable retention limits (days + max file size) for activity and ops logs, expose them in settings UI, and virtualize log lists with @tanstack/react-virtual.

**Architecture:** Both log classes (`OpsLog`, `ActivityLog`) gain size-based pruning alongside existing time-based pruning. Config flows through `WorktreeConfig` → server → log classes. UI gets number inputs in existing settings cards. Activity feed and ops log lists get virtualized rendering.

**Tech Stack:** TypeScript, React, @tanstack/react-virtual, Vitest, React Testing Library

**Spec:** `docs/superpowers/specs/2026-03-12-log-retention-limits-design.md`

---

## Chunk 1: Shared Types & Server-Side Pruning

### Task 1: Update shared types

**Files:**

- Modify: `libs/shared/src/activity-event.ts:55-82`
- Modify: `libs/shared/src/worktree-types.ts:59-66`

- [ ] **Step 1: Write failing test for ActivityConfig type accepting optional fields**

Create `libs/shared/src/activity-event.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { DEFAULT_ACTIVITY_CONFIG, type ActivityConfig } from "./activity-event";

describe("ActivityConfig", () => {
  it("should have no default retentionDays", () => {
    expect(DEFAULT_ACTIVITY_CONFIG.retentionDays).toBeUndefined();
  });

  it("should have no default maxSizeMB", () => {
    expect(DEFAULT_ACTIVITY_CONFIG.maxSizeMB).toBeUndefined();
  });

  it("should accept optional retentionDays and maxSizeMB", () => {
    const config: ActivityConfig = {
      ...DEFAULT_ACTIVITY_CONFIG,
      retentionDays: 30,
      maxSizeMB: 50,
    };
    expect(config.retentionDays).toBe(30);
    expect(config.maxSizeMB).toBe(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run shared:test -- --reporter verbose --run activity-event.test`
Expected: FAIL — `retentionDays` is `7` not `undefined`, `maxSizeMB` does not exist on type

- [ ] **Step 3: Update ActivityConfig and defaults**

In `libs/shared/src/activity-event.ts`:

```typescript
// Change ActivityConfig interface (lines 55-61):
export interface ActivityConfig {
  retentionDays?: number; // undefined = unlimited
  maxSizeMB?: number; // undefined = unlimited
  categories: Record<ActivityCategory, boolean>;
  disabledEvents: string[];
  toastEvents: string[];
  osNotificationEvents: string[];
}

// Change DEFAULT_ACTIVITY_CONFIG (lines 63-82):
// Remove retentionDays: 7, do NOT add maxSizeMB — both default to undefined
export const DEFAULT_ACTIVITY_CONFIG: ActivityConfig = {
  categories: {
    agent: true,
    worktree: true,
    system: true,
  },
  disabledEvents: [],
  toastEvents: [
    "creation_started",
    "creation_completed",
    "creation_failed",
    "skill_started",
    "skill_completed",
    "skill_failed",
    "crashed",
    "connection_lost",
  ],
  osNotificationEvents: ["agent_awaiting_input"],
};
```

- [ ] **Step 4: Add opsLog block to WorktreeConfig**

In `libs/shared/src/worktree-types.ts`, add after the `activity` block (line 66):

```typescript
  /** Ops log (debug log) configuration */
  opsLog?: {
    retentionDays?: number;   // undefined = unlimited
    maxSizeMB?: number;       // undefined = unlimited
  };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm nx run shared:test -- --reporter verbose --run activity-event.test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add libs/shared/src/activity-event.ts libs/shared/src/activity-event.test.ts libs/shared/src/worktree-types.ts
git commit -m "feat: make retention limits optional with unlimited defaults, add opsLog config block"
```

---

### Task 2: Update OpsLog with size-based pruning and updateConfig

**Files:**

- Modify: `apps/server/src/ops-log.ts:39-84`
- Create: `apps/server/src/ops-log.test.ts`

- [ ] **Step 1: Write failing tests for OpsLog pruning**

Create `apps/server/src/ops-log.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import path from "path";
import { OpsLog } from "./ops-log";

const TMP_DIR = path.join(__dirname, "__test-ops-log__");
const OPENKIT_DIR = path.join(TMP_DIR, ".openkit");
const LOG_FILE = path.join(OPENKIT_DIR, "ops-log.jsonl");

function makeEvent(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: `test-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    source: "test",
    action: "test.action",
    message: "test message",
    level: "info",
    status: "info",
    ...overrides,
  });
}

function seedLog(lines: string[]): void {
  mkdirSync(OPENKIT_DIR, { recursive: true });
  writeFileSync(LOG_FILE, lines.join("\n") + "\n");
}

function readLogLines(): string[] {
  if (!existsSync(LOG_FILE)) return [];
  return readFileSync(LOG_FILE, "utf-8")
    .split("\n")
    .filter((l) => l.trim());
}

describe("OpsLog", () => {
  beforeEach(() => {
    mkdirSync(OPENKIT_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it("should not prune when no limits are set", () => {
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    seedLog([makeEvent({ timestamp: old }), makeEvent()]);

    const log = new OpsLog(TMP_DIR);
    log.dispose();

    expect(readLogLines()).toHaveLength(2);
  });

  it("should prune entries older than retentionDays", () => {
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();
    seedLog([makeEvent({ timestamp: old }), makeEvent({ timestamp: recent })]);

    const log = new OpsLog(TMP_DIR, { retentionDays: 7 });
    log.dispose();

    const lines = readLogLines();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).timestamp).toBe(recent);
  });

  it("should prune when file exceeds maxSizeMB", () => {
    // Seed with enough data to exceed a tiny size limit
    const events = Array.from({ length: 100 }, () => makeEvent());
    seedLog(events);

    const fileSize = statSync(LOG_FILE).size;
    const halfSizeMB = fileSize / 2 / (1024 * 1024);

    const log = new OpsLog(TMP_DIR, { maxSizeMB: halfSizeMB });
    log.dispose();

    const newSize = statSync(LOG_FILE).size;
    expect(newSize).toBeLessThanOrEqual(halfSizeMB * 1024 * 1024);
  });

  it("should prune on addEvent when size limit is exceeded", () => {
    const log = new OpsLog(TMP_DIR, { maxSizeMB: 0.0001 }); // ~100 bytes

    // Add enough events to exceed the limit
    for (let i = 0; i < 20; i++) {
      log.addEvent({
        source: "test",
        action: "test.action",
        message: `test message ${i}`,
        level: "info",
        status: "info",
      });
    }

    log.dispose();

    const fileSize = statSync(LOG_FILE).size;
    expect(fileSize).toBeLessThanOrEqual(0.0001 * 1024 * 1024 + 500); // Allow some tolerance for last written event
  });

  it("should update config via updateConfig", () => {
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    seedLog([makeEvent({ timestamp: old }), makeEvent()]);

    const log = new OpsLog(TMP_DIR); // no limits
    expect(readLogLines()).toHaveLength(2);

    log.updateConfig({ retentionDays: 7 });
    log.prune();
    log.dispose();

    expect(readLogLines()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run server:test -- --reporter verbose --run ops-log.test`
Expected: FAIL — `updateConfig` does not exist, size pruning doesn't exist, unlimited default doesn't work

- [ ] **Step 3: Update OpsLog implementation**

In `apps/server/src/ops-log.ts`:

1. Update `OpsLogConfig` interface (lines 39-41):

```typescript
export interface OpsLogConfig {
  retentionDays?: number; // undefined = unlimited
  maxSizeMB?: number; // undefined = unlimited
}
```

2. Remove `DEFAULT_CONFIG` constant (lines 43-45). Replace with:

```typescript
const DEFAULT_CONFIG: OpsLogConfig = {};
```

3. In the constructor (lines 71-85), remove the `setInterval` pruning timer. Keep only `this.prune()` on startup:

```typescript
constructor(configDir: string, config?: Partial<OpsLogConfig>) {
  const openkitDir = path.join(configDir, CONFIG_DIR_NAME);
  if (!existsSync(openkitDir)) {
    mkdirSync(openkitDir, { recursive: true });
  }

  this.filePath = path.join(openkitDir, "ops-log.jsonl");
  this.config = { ...DEFAULT_CONFIG, ...config };
  this.prune();
}
```

4. Remove `dispose()` method's interval cleanup (simplify since no timer):

```typescript
dispose(): void {
  // No-op for now; kept for interface compatibility
}
```

5. In `addEvent` (line 99-121), add pruning call after the append:

```typescript
addEvent(partial: Omit<OpsLogEvent, "id" | "timestamp">): OpsLogEvent {
  const event: OpsLogEvent = {
    id: nanoid(),
    timestamp: new Date().toISOString(),
    ...partial,
  };

  try {
    appendFileSync(this.filePath, JSON.stringify(event) + "\n");
    this.pruneIfNeeded();
  } catch {
    // Non-critical: event still streams to listeners.
  }

  this.listeners.forEach((listener) => {
    try { listener(event); } catch { /* Ignore listener errors. */ }
  });

  return event;
}
```

6. Add `pruneIfNeeded` (checks size only — fast path):

```typescript
private pruneIfNeeded(): void {
  if (!this.config.maxSizeMB) return;
  if (!existsSync(this.filePath)) return;

  try {
    const stat = statSync(this.filePath);
    if (stat.size > this.config.maxSizeMB * 1024 * 1024) {
      this.pruneBySizeSync();
    }
  } catch {
    // Ignore stat errors
  }
}
```

7. Add `pruneBySizeSync`:

```typescript
private pruneBySizeSync(): void {
  if (!this.config.maxSizeMB || !existsSync(this.filePath)) return;

  try {
    const maxBytes = this.config.maxSizeMB * 1024 * 1024;
    const content = readFileSync(this.filePath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());

    // Drop oldest entries (from front) until total size fits
    let totalBytes = 0;
    let keepFromIndex = 0;

    // Calculate from newest to oldest
    for (let i = lines.length - 1; i >= 0; i--) {
      totalBytes += Buffer.byteLength(lines[i], "utf-8") + 1; // +1 for newline
      if (totalBytes > maxBytes) {
        keepFromIndex = i + 1;
        break;
      }
    }

    const kept = lines.slice(keepFromIndex);
    writeFileSync(this.filePath, kept.join("\n") + (kept.length > 0 ? "\n" : ""));
  } catch {
    // Ignore pruning failures
  }
}
```

8. Update `prune()` to handle optional retentionDays:

```typescript
prune(): void {
  if (!existsSync(this.filePath)) return;

  try {
    let lines = readFileSync(this.filePath, "utf-8")
      .split("\n")
      .filter((line) => line.trim());

    // Time-based pruning
    if (this.config.retentionDays) {
      const cutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;
      lines = lines.filter((line) => {
        try {
          const parsed = JSON.parse(line) as OpsLogEvent;
          return new Date(parsed.timestamp).getTime() > cutoff;
        } catch {
          return false;
        }
      });
    }

    // Size-based pruning
    if (this.config.maxSizeMB) {
      const maxBytes = this.config.maxSizeMB * 1024 * 1024;
      let totalBytes = 0;
      let keepFromIndex = 0;

      for (let i = lines.length - 1; i >= 0; i--) {
        totalBytes += Buffer.byteLength(lines[i], "utf-8") + 1;
        if (totalBytes > maxBytes) {
          keepFromIndex = i + 1;
          break;
        }
      }
      lines = lines.slice(keepFromIndex);
    }

    writeFileSync(this.filePath, lines.join("\n") + (lines.length > 0 ? "\n" : ""));
  } catch {
    // Ignore pruning failures.
  }
}
```

9. Add `updateConfig` method:

```typescript
updateConfig(config: Partial<OpsLogConfig>): void {
  this.config = { ...this.config, ...config };
}
```

10. Add `statSync` to the fs import at line 1:

```typescript
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx run server:test -- --reporter verbose --run ops-log.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/ops-log.ts apps/server/src/ops-log.test.ts
git commit -m "feat: add size-based pruning and unlimited defaults to OpsLog"
```

---

### Task 3: Update ActivityLog with size-based pruning

**Files:**

- Modify: `apps/server/src/activity-log.ts:14-44,149-169`
- Create: `apps/server/src/activity-log.test.ts`

- [ ] **Step 1: Write failing tests for ActivityLog pruning**

Create `apps/server/src/activity-log.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import path from "path";
import { ActivityLog } from "./activity-log";

const TMP_DIR = path.join(__dirname, "__test-activity-log__");
const OPENKIT_DIR = path.join(TMP_DIR, ".openkit");
const LOG_FILE = path.join(OPENKIT_DIR, "activity.jsonl");

function makeEvent(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: `test-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    category: "system",
    type: "test",
    severity: "info",
    title: "Test event",
    ...overrides,
  });
}

function seedLog(lines: string[]): void {
  mkdirSync(OPENKIT_DIR, { recursive: true });
  writeFileSync(LOG_FILE, lines.join("\n") + "\n");
}

function readLogLines(): string[] {
  if (!existsSync(LOG_FILE)) return [];
  return readFileSync(LOG_FILE, "utf-8")
    .split("\n")
    .filter((l) => l.trim());
}

describe("ActivityLog", () => {
  beforeEach(() => {
    mkdirSync(OPENKIT_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it("should not prune when no limits are set", () => {
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    seedLog([makeEvent({ timestamp: old }), makeEvent()]);

    const log = new ActivityLog(TMP_DIR);
    log.dispose();

    expect(readLogLines()).toHaveLength(2);
  });

  it("should prune entries older than retentionDays", () => {
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();
    seedLog([makeEvent({ timestamp: old }), makeEvent({ timestamp: recent })]);

    const log = new ActivityLog(TMP_DIR, { retentionDays: 7 });
    log.dispose();

    const lines = readLogLines();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).timestamp).toBe(recent);
  });

  it("should prune when file exceeds maxSizeMB", () => {
    const events = Array.from({ length: 100 }, () => makeEvent());
    seedLog(events);

    const fileSize = statSync(LOG_FILE).size;
    const halfSizeMB = fileSize / 2 / (1024 * 1024);

    const log = new ActivityLog(TMP_DIR, { maxSizeMB: halfSizeMB });
    log.dispose();

    const newSize = statSync(LOG_FILE).size;
    expect(newSize).toBeLessThanOrEqual(halfSizeMB * 1024 * 1024);
  });

  it("should prune on addEvent when size limit is exceeded", () => {
    const log = new ActivityLog(TMP_DIR, { maxSizeMB: 0.0001 });

    for (let i = 0; i < 20; i++) {
      log.addEvent({
        category: "system",
        type: "test",
        severity: "info",
        title: `test event ${i}`,
      });
    }

    log.dispose();

    const fileSize = statSync(LOG_FILE).size;
    expect(fileSize).toBeLessThanOrEqual(0.0001 * 1024 * 1024 + 500);
  });

  it("should apply maxSizeMB via updateConfig", () => {
    const events = Array.from({ length: 100 }, () => makeEvent());
    seedLog(events);

    const log = new ActivityLog(TMP_DIR);
    const fileSize = statSync(LOG_FILE).size;

    log.updateConfig({ maxSizeMB: fileSize / 2 / (1024 * 1024) });
    log.prune();
    log.dispose();

    const newSize = statSync(LOG_FILE).size;
    expect(newSize).toBeLessThan(fileSize);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run server:test -- --reporter verbose --run activity-log.test`
Expected: FAIL — no size pruning, default retentionDays of 7 prunes old entries

- [ ] **Step 3: Update ActivityLog implementation**

In `apps/server/src/activity-log.ts`:

1. Add `statSync` to the fs import (line 1):

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from "fs";
```

2. In the constructor (lines 20-44), remove `setInterval` timer:

```typescript
constructor(configDir: string, config?: Partial<ActivityConfig>) {
  const OpenKitDir = path.join(configDir, CONFIG_DIR_NAME);
  if (!existsSync(OpenKitDir)) {
    mkdirSync(OpenKitDir, { recursive: true });
  }
  this.filePath = path.join(OpenKitDir, "activity.jsonl");
  this.config = {
    ...DEFAULT_ACTIVITY_CONFIG,
    ...config,
    categories: {
      ...DEFAULT_ACTIVITY_CONFIG.categories,
      ...config?.categories,
    },
    disabledEvents: config?.disabledEvents ?? DEFAULT_ACTIVITY_CONFIG.disabledEvents,
    toastEvents: config?.toastEvents ?? DEFAULT_ACTIVITY_CONFIG.toastEvents,
    osNotificationEvents:
      config?.osNotificationEvents ?? DEFAULT_ACTIVITY_CONFIG.osNotificationEvents,
  };

  this.prune();
}
```

3. Simplify `dispose()`:

```typescript
dispose(): void {
  // No-op; kept for interface compatibility
}
```

4. Remove `pruneTimer` field (line 18).

5. In `addEvent` (line 58-100), add `this.pruneIfNeeded()` after the `appendFileSync`:

```typescript
// After appendFileSync (line 85):
try {
  appendFileSync(this.filePath, JSON.stringify(event) + "\n");
  this.pruneIfNeeded();
} catch {
  // Non-critical
}
```

6. Add `pruneIfNeeded` and `pruneBySizeSync` methods (same pattern as OpsLog):

```typescript
private pruneIfNeeded(): void {
  if (!this.config.maxSizeMB) return;
  if (!existsSync(this.filePath)) return;

  try {
    const stat = statSync(this.filePath);
    if (stat.size > this.config.maxSizeMB * 1024 * 1024) {
      this.pruneBySizeSync();
    }
  } catch {
    // Ignore stat errors
  }
}

private pruneBySizeSync(): void {
  if (!this.config.maxSizeMB || !existsSync(this.filePath)) return;

  try {
    const maxBytes = this.config.maxSizeMB * 1024 * 1024;
    const content = readFileSync(this.filePath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());

    let totalBytes = 0;
    let keepFromIndex = 0;

    for (let i = lines.length - 1; i >= 0; i--) {
      totalBytes += Buffer.byteLength(lines[i], "utf-8") + 1;
      if (totalBytes > maxBytes) {
        keepFromIndex = i + 1;
        break;
      }
    }

    const kept = lines.slice(keepFromIndex);
    writeFileSync(this.filePath, kept.join("\n") + (kept.length > 0 ? "\n" : ""));
  } catch {
    // Ignore pruning failures
  }
}
```

7. Update `prune()` (lines 149-169) to handle optional retentionDays and add size pruning:

```typescript
prune(): void {
  if (!existsSync(this.filePath)) return;

  try {
    let lines = readFileSync(this.filePath, "utf-8")
      .split("\n")
      .filter((line) => line.trim());

    if (this.config.retentionDays) {
      const cutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;
      lines = lines.filter((line) => {
        try {
          const event = JSON.parse(line) as ActivityEvent;
          return new Date(event.timestamp).getTime() > cutoff;
        } catch {
          return false;
        }
      });
    }

    if (this.config.maxSizeMB) {
      const maxBytes = this.config.maxSizeMB * 1024 * 1024;
      let totalBytes = 0;
      let keepFromIndex = 0;

      for (let i = lines.length - 1; i >= 0; i--) {
        totalBytes += Buffer.byteLength(lines[i], "utf-8") + 1;
        if (totalBytes > maxBytes) {
          keepFromIndex = i + 1;
          break;
        }
      }
      lines = lines.slice(keepFromIndex);
    }

    writeFileSync(this.filePath, lines.join("\n") + (lines.length > 0 ? "\n" : ""));
  } catch {
    // Ignore prune errors
  }
}
```

8. Update `updateConfig` (lines 171-183) to include `maxSizeMB`:

```typescript
updateConfig(config: Partial<ActivityConfig>): void {
  this.config = {
    ...this.config,
    ...config,
    categories: {
      ...this.config.categories,
      ...config.categories,
    },
    disabledEvents: config.disabledEvents ?? this.config.disabledEvents,
    toastEvents: config.toastEvents ?? this.config.toastEvents,
    osNotificationEvents: config.osNotificationEvents ?? this.config.osNotificationEvents,
  };
}
```

(No change needed — spread already handles `maxSizeMB` and `retentionDays`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx run server:test -- --reporter verbose --run activity-log.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/activity-log.ts apps/server/src/activity-log.test.ts
git commit -m "feat: add size-based pruning and unlimited defaults to ActivityLog"
```

---

### Task 4: Wire opsLog config through manager

**Files:**

- Modify: `apps/server/src/manager.ts:256-258,1889-1894`

- [ ] **Step 1: Update OpsLog initialization to use opsLog config**

In `apps/server/src/manager.ts`, change lines 256-258 from:

```typescript
this.opsLog = new OpsLog(this.configDir, {
  retentionDays: this.config.activity?.retentionDays,
});
```

To:

```typescript
this.opsLog = new OpsLog(this.configDir, this.config.opsLog);
```

- [ ] **Step 2: Add opsLog config update in updateConfig method**

In `apps/server/src/manager.ts`, after the `activity` config merge block (around line 1894), add:

```typescript
if (partial.opsLog !== undefined) {
  const mergedOpsLog = mergeIntoObject(existing.opsLog as Record<string, unknown> | undefined, {
    ...(existing.opsLog as Record<string, unknown>),
    ...partial.opsLog,
  });
  existing.opsLog = mergedOpsLog as Record<string, unknown>;
  this.config.opsLog = partial.opsLog;
  this.opsLog.updateConfig(partial.opsLog ?? {});
}
```

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `pnpm nx run server:test -- --reporter verbose --run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/manager.ts
git commit -m "feat: wire opsLog config through manager with updateConfig support"
```

---

## Chunk 2: Settings UI (Safe Apply Flow)

**IMPORTANT:** Retention settings must NOT auto-save. A user temporarily typing "1" in a size field could nuke their logs. These fields use a separate Apply flow with impact estimation and a warning modal.

### Task 5: Add retention impact estimation API

**Files:**

- Modify: `apps/server/src/ops-log.ts` (add `estimateImpact` method)
- Modify: `apps/server/src/activity-log.ts` (add `estimateImpact` method)
- Modify: `apps/server/src/routes/config.ts` (add `POST /api/config/retention-impact` endpoint)
- Create: `apps/server/src/ops-log-impact.test.ts`
- Create: `apps/server/src/activity-log-impact.test.ts`

- [ ] **Step 1: Write failing test for OpsLog.estimateImpact**

Add to `apps/server/src/ops-log.test.ts`:

```typescript
describe("OpsLog.estimateImpact", () => {
  it("should return zero impact when no limits would prune anything", () => {
    seedLog([makeEvent(), makeEvent()]);
    const log = new OpsLog(TMP_DIR);
    const impact = log.estimateImpact({});
    log.dispose();

    expect(impact.entriesToRemove).toBe(0);
    expect(impact.bytesToRemove).toBe(0);
    expect(impact.currentEntries).toBe(2);
  });

  it("should estimate entries removed by retentionDays", () => {
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    seedLog([makeEvent({ timestamp: old }), makeEvent()]);
    const log = new OpsLog(TMP_DIR);
    const impact = log.estimateImpact({ retentionDays: 7 });
    log.dispose();

    expect(impact.entriesToRemove).toBe(1);
    expect(impact.currentEntries).toBe(2);
  });

  it("should estimate entries removed by maxSizeMB", () => {
    const events = Array.from({ length: 100 }, () => makeEvent());
    seedLog(events);
    const log = new OpsLog(TMP_DIR);
    const fileSize = statSync(LOG_FILE).size;
    const impact = log.estimateImpact({ maxSizeMB: fileSize / 2 / (1024 * 1024) });
    log.dispose();

    expect(impact.entriesToRemove).toBeGreaterThan(0);
    expect(impact.bytesToRemove).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run server:test -- --reporter verbose --run ops-log.test`
Expected: FAIL — `estimateImpact` does not exist

- [ ] **Step 3: Implement estimateImpact on OpsLog**

Add to `apps/server/src/ops-log.ts`:

```typescript
estimateImpact(proposed: Partial<OpsLogConfig>): {
  entriesToRemove: number;
  bytesToRemove: number;
  currentEntries: number;
  currentBytes: number;
} {
  const empty = { entriesToRemove: 0, bytesToRemove: 0, currentEntries: 0, currentBytes: 0 };
  if (!existsSync(this.filePath)) return empty;

  try {
    const content = readFileSync(this.filePath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());
    const currentBytes = Buffer.byteLength(content, "utf-8");
    const currentEntries = lines.length;
    let keepLines = [...lines];

    // Simulate time-based pruning
    if (proposed.retentionDays) {
      const cutoff = Date.now() - proposed.retentionDays * 24 * 60 * 60 * 1000;
      keepLines = keepLines.filter((line) => {
        try {
          const parsed = JSON.parse(line) as OpsLogEvent;
          return new Date(parsed.timestamp).getTime() > cutoff;
        } catch {
          return false;
        }
      });
    }

    // Simulate size-based pruning
    if (proposed.maxSizeMB) {
      const maxBytes = proposed.maxSizeMB * 1024 * 1024;
      let totalBytes = 0;
      let keepFromIndex = 0;

      for (let i = keepLines.length - 1; i >= 0; i--) {
        totalBytes += Buffer.byteLength(keepLines[i], "utf-8") + 1;
        if (totalBytes > maxBytes) {
          keepFromIndex = i + 1;
          break;
        }
      }
      keepLines = keepLines.slice(keepFromIndex);
    }

    const keptBytes = keepLines.reduce(
      (sum, line) => sum + Buffer.byteLength(line, "utf-8") + 1,
      0,
    );

    return {
      entriesToRemove: currentEntries - keepLines.length,
      bytesToRemove: currentBytes - keptBytes,
      currentEntries,
      currentBytes,
    };
  } catch {
    return empty;
  }
}
```

- [ ] **Step 4: Implement the same estimateImpact on ActivityLog**

Add the same pattern to `apps/server/src/activity-log.ts`, replacing `OpsLogEvent` with `ActivityEvent` in the type cast. Write a matching test in `apps/server/src/activity-log.test.ts`.

- [ ] **Step 5: Add the API endpoint**

In `apps/server/src/routes/config.ts`, add:

```typescript
router.post("/api/config/retention-impact", async (req, res) => {
  const { target, retentionDays, maxSizeMB } = req.body as {
    target: "activity" | "opsLog";
    retentionDays?: number;
    maxSizeMB?: number;
  };

  if (target !== "activity" && target !== "opsLog") {
    return res.status(400).json({ error: "target must be 'activity' or 'opsLog'" });
  }

  const manager = getManager(req);
  const proposed = { retentionDays, maxSizeMB };
  const impact =
    target === "activity"
      ? manager.getActivityLog().estimateImpact(proposed)
      : manager.getOpsLog().estimateImpact(proposed);

  res.json(impact);
});
```

Note: Ensure `getActivityLog()` is exposed on the manager (similar to existing `getOpsLog()`). If not, add it.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm nx run server:test -- --reporter verbose --run ops-log.test && pnpm nx run server:test -- --reporter verbose --run activity-log.test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/ops-log.ts apps/server/src/ops-log.test.ts apps/server/src/activity-log.ts apps/server/src/activity-log.test.ts apps/server/src/routes/config.ts
git commit -m "feat: add retention impact estimation API endpoint"
```

---

### Task 6: Add retention settings UI with Apply button and warning modal

**Files:**

- Modify: `apps/web-app/src/components/ConfigurationPanel.tsx`
- Modify: `apps/web-app/src/hooks/api.ts` (add `fetchRetentionImpact` API call)

- [ ] **Step 1: Add fetchRetentionImpact to the API hook**

In `apps/web-app/src/hooks/api.ts`, add:

```typescript
async fetchRetentionImpact(target: "activity" | "opsLog", config: { retentionDays?: number; maxSizeMB?: number }) {
  const res = await fetch(`${baseUrl}/api/config/retention-impact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target, ...config }),
  });
  return res.json() as Promise<{
    entriesToRemove: number;
    bytesToRemove: number;
    currentEntries: number;
    currentBytes: number;
  }>;
}
```

- [ ] **Step 2: Write failing test for retention UI**

Create or update `apps/web-app/src/components/ConfigurationPanel.test.tsx`:

```typescript
describe("ConfigurationPanel retention settings", () => {
  it("should render debug log retention inputs in project section", async () => {
    // Render ConfigurationPanel with mock config
    // Assert: inputs with labels "Debug log retention (days)" and "Debug log max size (MB)" exist
    // Assert: placeholder is "Unlimited"
  });

  it("should render notification retention inputs in notifications section", async () => {
    // Assert: inputs with labels "Retention (days)" and "Max size (MB)" exist
  });

  it("should show Apply button only when values differ from saved config", async () => {
    // Render with config { opsLog: { retentionDays: 7 } }
    // Assert: no Apply button visible initially
    // Type "14" into retention days input
    // Assert: Apply button appears
  });

  it("should not auto-save retention fields", async () => {
    // Render, change retention input value, wait 600ms (beyond debounce)
    // Assert: api.saveConfig was NOT called with opsLog changes
  });
});
```

Adapt to existing test patterns. The key assertions:

- Inputs render with correct labels and "Unlimited" placeholder
- Apply button appears when values differ from saved config
- Retention fields do NOT trigger the debounced auto-save

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm nx run web-app:test -- --reporter verbose --run ConfigurationPanel.test`
Expected: FAIL

- [ ] **Step 4: Add retention inputs with Apply button to Project Configuration card**

In `apps/web-app/src/components/ConfigurationPanel.tsx`:

1. Add local state for draft retention values (separate from auto-save `form`):

```typescript
const [draftOpsLog, setDraftOpsLog] = useState<{ retentionDays?: number; maxSizeMB?: number }>({});
const [draftActivity, setDraftActivity] = useState<{ retentionDays?: number; maxSizeMB?: number }>(
  {},
);
const [retentionWarning, setRetentionWarning] = useState<{
  target: "activity" | "opsLog";
  impact: { entriesToRemove: number; bytesToRemove: number };
  config: { retentionDays?: number; maxSizeMB?: number };
} | null>(null);
```

2. Sync drafts when config loads:

```typescript
useEffect(() => {
  if (config) {
    setDraftOpsLog({
      retentionDays: config.opsLog?.retentionDays,
      maxSizeMB: config.opsLog?.maxSizeMB,
    });
    setDraftActivity({
      retentionDays: config.activity?.retentionDays,
      maxSizeMB: config.activity?.maxSizeMB,
    });
  }
}, [config]);
```

3. Helper to check if draft differs from saved:

```typescript
function hasRetentionChanges(
  draft: { retentionDays?: number; maxSizeMB?: number },
  saved: { retentionDays?: number; maxSizeMB?: number } | undefined,
): boolean {
  return draft.retentionDays !== saved?.retentionDays || draft.maxSizeMB !== saved?.maxSizeMB;
}
```

4. Apply handler that checks impact first:

```typescript
async function handleApplyRetention(target: "activity" | "opsLog") {
  const draft = target === "opsLog" ? draftOpsLog : draftActivity;
  const impact = await api.fetchRetentionImpact(target, draft);

  if (impact.entriesToRemove > 0) {
    setRetentionWarning({ target, impact, config: draft });
    return; // Modal will handle confirmation
  }

  // No data loss — apply directly
  await applyRetentionConfig(target, draft);
}

async function applyRetentionConfig(
  target: "activity" | "opsLog",
  retentionConfig: { retentionDays?: number; maxSizeMB?: number },
) {
  if (target === "opsLog") {
    await api.saveConfig({ opsLog: retentionConfig });
  } else {
    await api.saveConfig({ activity: { ...config?.activity, ...retentionConfig } });
  }
  onSaved();
  setRetentionWarning(null);
}
```

5. Inside the Project Configuration card, after auto-install toggle (line 581):

```tsx
<div className="flex gap-4 mt-4 pt-4 border-t border-white/[0.06]">
  <Field label="Debug log retention (days)" description="Leave empty for unlimited">
    <input
      type="number"
      min={1}
      className={fieldInputClass}
      placeholder="Unlimited"
      value={draftOpsLog.retentionDays ?? ""}
      onChange={(e) => {
        const val = e.target.value ? Number(e.target.value) : undefined;
        setDraftOpsLog((prev) => ({ ...prev, retentionDays: val && val > 0 ? val : undefined }));
      }}
    />
  </Field>
  <Field label="Debug log max size (MB)" description="Leave empty for unlimited">
    <input
      type="number"
      min={1}
      className={fieldInputClass}
      placeholder="Unlimited"
      value={draftOpsLog.maxSizeMB ?? ""}
      onChange={(e) => {
        const val = e.target.value ? Number(e.target.value) : undefined;
        setDraftOpsLog((prev) => ({ ...prev, maxSizeMB: val && val > 0 ? val : undefined }));
      }}
    />
  </Field>
  {hasRetentionChanges(draftOpsLog, config?.opsLog) && (
    <button
      type="button"
      className={`self-end ${button.accent} px-3 py-1.5 text-xs rounded-md`}
      onClick={() => handleApplyRetention("opsLog")}
    >
      Apply
    </button>
  )}
</div>
```

6. Exclude `opsLog` from the debounced auto-save. In the auto-save `useEffect` (around line 384), strip `opsLog` before comparing/saving:

```typescript
useEffect(() => {
  if (!form || !config) return;
  // Exclude retention fields from auto-save — they use the Apply flow
  const { opsLog: _opsLog, ...formWithoutRetention } = form;
  const json = JSON.stringify(formWithoutRetention);
  // ... rest of existing logic using formWithoutRetention ...
}, [form, config]);
```

- [ ] **Step 5: Add notification retention inputs to Notifications card**

Same pattern as project section, but for activity config. After the notification groups list (line 1230):

```tsx
<div className="flex gap-4 mt-4 pt-4 border-t border-white/[0.06]">
  <Field label="Retention (days)" description="Leave empty for unlimited">
    <input
      type="number"
      min={1}
      className={fieldInputClass}
      placeholder="Unlimited"
      value={draftActivity.retentionDays ?? ""}
      onChange={(e) => {
        const val = e.target.value ? Number(e.target.value) : undefined;
        setDraftActivity((prev) => ({ ...prev, retentionDays: val && val > 0 ? val : undefined }));
      }}
    />
  </Field>
  <Field label="Max size (MB)" description="Leave empty for unlimited">
    <input
      type="number"
      min={1}
      className={fieldInputClass}
      placeholder="Unlimited"
      value={draftActivity.maxSizeMB ?? ""}
      onChange={(e) => {
        const val = e.target.value ? Number(e.target.value) : undefined;
        setDraftActivity((prev) => ({ ...prev, maxSizeMB: val && val > 0 ? val : undefined }));
      }}
    />
  </Field>
  {hasRetentionChanges(draftActivity, {
    retentionDays: config?.activity?.retentionDays,
    maxSizeMB: config?.activity?.maxSizeMB,
  }) && (
    <button
      type="button"
      className={`self-end ${button.accent} px-3 py-1.5 text-xs rounded-md`}
      onClick={() => handleApplyRetention("activity")}
    >
      Apply
    </button>
  )}
</div>
```

- [ ] **Step 6: Add warning modal**

Use the shared `Modal` component. Add at the bottom of ConfigurationPanel's JSX (before the final closing tags):

```tsx
{
  retentionWarning && (
    <Modal onClose={() => setRetentionWarning(null)}>
      <div className="p-5">
        <h3 className={`text-sm font-semibold ${text.primary} mb-2`}>Apply retention limits?</h3>
        <p className={`text-xs ${text.secondary} mb-4`}>
          This will remove {retentionWarning.impact.entriesToRemove} entries (
          {(retentionWarning.impact.bytesToRemove / 1024).toFixed(1)} KB) from{" "}
          {retentionWarning.target === "opsLog" ? "debug logs" : "activity logs"}. This cannot be
          undone.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className={`${button.ghost} px-3 py-1.5 text-xs rounded-md`}
            onClick={() => setRetentionWarning(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="px-3 py-1.5 text-xs rounded-md bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors"
            onClick={() => applyRetentionConfig(retentionWarning.target, retentionWarning.config)}
          >
            Apply
          </button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm nx run web-app:test -- --reporter verbose --run ConfigurationPanel.test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/web-app/src/components/ConfigurationPanel.tsx apps/web-app/src/components/ConfigurationPanel.test.tsx apps/web-app/src/hooks/api.ts
git commit -m "feat: add retention settings with Apply button and warning modal"
```

---

## Chunk 3: List Virtualization

### Task 7: Install @tanstack/react-virtual

**Files:**

- Modify: `apps/web-app/package.json`

- [ ] **Step 1: Install the package**

```bash
cd apps/web-app && pnpm add @tanstack/react-virtual
```

- [ ] **Step 2: Verify installation**

Run: `pnpm nx run web-app:build -- --mode development 2>&1 | head -20`
Expected: No import errors

- [ ] **Step 3: Commit**

```bash
git add apps/web-app/package.json pnpm-lock.yaml
git commit -m "chore: add @tanstack/react-virtual to web-app"
```

---

### Task 8: Virtualize the activity feed list

**Files:**

- Modify: `apps/web-app/src/components/ActivityFeed.tsx:384-396`

- [ ] **Step 1: Add useVirtualizer to ActivityFeedPanel**

In `apps/web-app/src/components/ActivityFeed.tsx`:

1. Add import:

```typescript
import { useVirtualizer } from "@tanstack/react-virtual";
```

2. Find the scrollable container `<div>` that wraps the event list. It should have `overflow-y-auto` (or similar). Add a ref to it.

3. Replace the direct `.map()` rendering (lines 384-396):

```tsx
// Before:
<div>
  {prioritizedEvents.map((event, index) => (
    <ActivityRow key={event.id} ... />
  ))}
</div>

// After:
```

Use the virtualizer:

```tsx
// Inside the component, add:
const scrollContainerRef = useRef<HTMLDivElement>(null);
const virtualizer = useVirtualizer({
  count: prioritizedEvents.length,
  getScrollElement: () => scrollContainerRef.current,
  estimateSize: () => 72, // Estimated row height in px — adjust based on actual ActivityRow height
  overscan: 10,
});

// In JSX, wrap the scroll container:
<div ref={scrollContainerRef} className="..." style={{ overflowY: "auto" }}>
  {/* ... empty states ... */}
  <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
    {virtualizer.getVirtualItems().map((virtualRow) => {
      const event = prioritizedEvents[virtualRow.index];
      const index = virtualRow.index;
      return (
        <div
          key={event.id}
          data-index={virtualRow.index}
          ref={virtualizer.measureElement}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${virtualRow.start}px)`,
          }}
        >
          <ActivityRow
            event={event}
            showUnreadDot={unseenEventIds.has(event.id)}
            showAttentionDivider={index === 0 && isActionRequiredEvent(event)}
            onNavigateToWorktree={onNavigateToWorktree}
            onNavigateToIssue={onNavigateToIssue}
            onResolveActionRequired={onResolveActionRequired}
          />
        </div>
      );
    })}
  </div>
</div>;
```

Important: Use `measureElement` (dynamic measurement) since ActivityRow heights vary with detail text and expanded hook groups. The `estimateSize` of 72 is a starting estimate — the virtualizer will measure actual heights.

- [ ] **Step 2: Verify it renders correctly**

Run: `pnpm dev:web-app`
Manually verify: Activity feed scrolls smoothly, items render correctly, back-to-top button still works.

- [ ] **Step 3: Commit**

```bash
git add apps/web-app/src/components/ActivityFeed.tsx
git commit -m "feat: virtualize activity feed list with @tanstack/react-virtual"
```

---

### Task 9: Virtualize the ops log list

**Files:**

- Modify: `apps/web-app/src/components/ActivityPage.tsx:1054-end of ops log list`

- [ ] **Step 1: Add useVirtualizer to the ops log section**

In `apps/web-app/src/components/ActivityPage.tsx`:

1. Add import:

```typescript
import { useVirtualizer } from "@tanstack/react-virtual";
```

2. Add a ref for the ops log scroll container and set up the virtualizer inside the component that renders the ops log `<ul>`:

```typescript
const opsLogScrollRef = useRef<HTMLDivElement>(null);
const opsLogVirtualizer = useVirtualizer({
  count: filteredOpsEvents.length,
  getScrollElement: () => opsLogScrollRef.current,
  estimateSize: () => 80,
  overscan: 10,
});
```

3. Replace the ops log `<ul>` rendering (lines 1054 onwards). Wrap with a scrollable div:

```tsx
<div ref={opsLogScrollRef} style={{ overflowY: "auto", height: "100%" }}>
  <div style={{ height: `${opsLogVirtualizer.getTotalSize()}px`, position: "relative" }}>
    {opsLogVirtualizer.getVirtualItems().map((virtualRow) => {
      const event = filteredOpsEvents[virtualRow.index];
      // ... existing event rendering logic (httpStatusCode, etc.) ...
      return (
        <div
          key={event.id}
          data-index={virtualRow.index}
          ref={opsLogVirtualizer.measureElement}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${virtualRow.start}px)`,
          }}
        >
          {/* Existing <li> content, but use <div> instead of <li> since we're outside <ul> */}
          <div className="px-4 py-3 border-b border-white/[0.05]">
            {/* ... existing ops log row content ... */}
          </div>
        </div>
      );
    })}
  </div>
</div>
```

Note: The ops log rows have variable heights due to expandable HTTP payload sections. Use `measureElement` for dynamic measurement. Keep the existing expand/collapse for payloads working — when a row expands, the virtualizer re-measures via the ref.

- [ ] **Step 2: Verify it renders correctly**

Run: `pnpm dev:web-app`
Manually verify: Ops log scrolls smoothly, items render, payload expand/collapse works, filters work.

- [ ] **Step 3: Commit**

```bash
git add apps/web-app/src/components/ActivityPage.tsx
git commit -m "feat: virtualize ops log list with @tanstack/react-virtual"
```

---

## Chunk 4: Documentation & Cleanup

### Task 10: Update documentation

**Files:**

- Modify: `docs/CONFIGURATION.md`
- Modify: `docs/NOTIFICATIONS.md`

- [ ] **Step 1: Update CONFIGURATION.md**

Add the new `opsLog` config fields to the configuration reference:

```markdown
### `opsLog` (optional)

| Field           | Type     | Default   | Description                                               |
| --------------- | -------- | --------- | --------------------------------------------------------- |
| `retentionDays` | `number` | unlimited | Drop debug log entries older than this many days          |
| `maxSizeMB`     | `number` | unlimited | Drop oldest debug log entries when file exceeds this size |
```

Update the `activity` section to document `maxSizeMB` and note that `retentionDays` defaults to unlimited.

- [ ] **Step 2: Update NOTIFICATIONS.md**

Document the retention settings available in the Notifications card in settings.

- [ ] **Step 3: Commit**

```bash
git add docs/CONFIGURATION.md docs/NOTIFICATIONS.md
git commit -m "docs: document retention and size limit settings for logs and notifications"
```

---

### Task 11: Run full test suite and lint

- [ ] **Step 1: Run all tests**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 2: Run lint and format checks**

Run: `pnpm check:lint && pnpm check:format`
Expected: PASS — fix any issues

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: lint and format cleanup"
```
