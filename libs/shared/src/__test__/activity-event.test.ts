import { describe, it, expect } from "vitest";
import { DEFAULT_ACTIVITY_CONFIG, type ActivityConfig } from "../activity-event";

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
