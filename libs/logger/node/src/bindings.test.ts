import { describe, it, expect, beforeEach } from "vitest";

describe("bindings", () => {
  beforeEach(async () => {
    // Reset module cache so getBindings() re-evaluates
    const { vi } = await import("vitest");
    vi.resetModules();
  });

  it("loads native bindings when koffi and dylib are available", async () => {
    const { getBindings } = await import("./bindings");
    const bindings = getBindings();

    // In this test environment, Go library is built and koffi is installed
    expect(bindings.available).toBe(true);
  });

  it("returns a valid handle from LoggerNew", async () => {
    const { getBindings } = await import("./bindings");
    const bindings = getBindings();

    const handle = bindings.LoggerNew("test", "", "info", "dev");

    expect(handle).toBeGreaterThan(0);
  });

  it("log functions do not throw", async () => {
    const { getBindings } = await import("./bindings");
    const bindings = getBindings();

    const handle = bindings.LoggerNew("test", "", "info", "dev");

    expect(() => bindings.LoggerInfo(handle, "msg", "{}")).not.toThrow();
    expect(() => bindings.LoggerWarn(handle, "msg", "{}")).not.toThrow();
    expect(() => bindings.LoggerError(handle, "msg", "{}")).not.toThrow();
    expect(() => bindings.LoggerDebug(handle, "msg", "{}")).not.toThrow();
    expect(() => bindings.LoggerSuccess(handle, "msg", "{}")).not.toThrow();
    expect(() => bindings.LoggerPlain(handle, "msg", "{}")).not.toThrow();
    expect(() => bindings.LoggerFree(handle)).not.toThrow();
  });

  it("caches bindings across calls", async () => {
    const { getBindings } = await import("./bindings");

    const first = getBindings();
    const second = getBindings();

    expect(first).toBe(second);
  });

  it("increments handles for multiple loggers", async () => {
    const { getBindings } = await import("./bindings");
    const bindings = getBindings();

    const handle1 = bindings.LoggerNew("test1", "", "info", "dev");
    const handle2 = bindings.LoggerNew("test2", "", "info", "dev");

    expect(handle2).toBeGreaterThan(handle1);

    bindings.LoggerFree(handle1);
    bindings.LoggerFree(handle2);
  });
});
