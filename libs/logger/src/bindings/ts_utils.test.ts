import { describe, expect, it, vi } from "vitest";

import { type LoggerBindings, Logger, normalizeContext } from "./ts_utils";

function createMockBindings(): LoggerBindings {
  return {
    LoggerNew: vi.fn().mockReturnValue(1),
    LoggerInfo: vi.fn(),
    LoggerWarn: vi.fn(),
    LoggerError: vi.fn(),
    LoggerDebug: vi.fn(),
    LoggerSuccess: vi.fn(),
    LoggerStarted: vi.fn(),
    LoggerPlain: vi.fn(),
    LoggerFree: vi.fn(),
    LoggerSetSink: vi.fn(),
    LoggerCloseSink: vi.fn(),
  };
}

describe("normalizeContext", () => {
  it("returns undefined for undefined input", () => {
    expect(normalizeContext(undefined)).toBeUndefined();
  });

  it("passes through context without error field", () => {
    const ctx = { domain: "test", key: "value" };

    expect(normalizeContext(ctx)).toBe(ctx);
  });

  it("passes through context with string error", () => {
    const ctx = { domain: "test", error: "something failed" };

    expect(normalizeContext(ctx)).toBe(ctx);
  });

  it("passes through context with undefined error", () => {
    const ctx = { domain: "test", error: undefined };

    expect(normalizeContext(ctx)).toBe(ctx);
  });

  it("converts Error object to message and stack", () => {
    const err = new Error("boom");
    const ctx = { domain: "test", error: err, extra: 42 };

    const result = normalizeContext(ctx);

    expect(result).toEqual({
      domain: "test",
      error: "boom",
      stack: err.stack,
      extra: 42,
    });
  });

  it("converts Error without stack to just message", () => {
    const err = new Error("boom");
    err.stack = undefined;
    const ctx = { domain: "test", error: err };

    const result = normalizeContext(ctx);

    expect(result).toEqual({ domain: "test", error: "boom" });
  });

  it("converts non-string non-Error to string", () => {
    const ctx = { domain: "test", error: 404 };

    const result = normalizeContext(ctx);

    expect(result).toEqual({ domain: "test", error: "404" });
  });
});

describe("Logger", () => {
  it("creates a Go handle on construction when bindings are available", () => {
    const bindings = createMockBindings();
    new Logger(() => bindings, "SERVER", "HTTP", "info", "dev");

    expect(bindings.LoggerNew).toHaveBeenCalledWith("SERVER", "HTTP", "info", "dev");
  });

  it("defaults subsystem, level, and format", () => {
    const bindings = createMockBindings();
    new Logger(() => bindings, "SERVER");

    expect(bindings.LoggerNew).toHaveBeenCalledWith("SERVER", "", "info", "dev");
  });

  it("does not create a handle when bindings are unavailable", () => {
    const bindings = createMockBindings();
    new Logger(() => null, "SERVER");

    expect(bindings.LoggerNew).not.toHaveBeenCalled();
  });

  it("lazily initializes handle when bindings become available", () => {
    const bindings = createMockBindings();
    let available = false;
    const logger = new Logger(() => (available ? bindings : null), "SERVER");

    logger.info("ignored");
    expect(bindings.LoggerInfo).not.toHaveBeenCalled();

    available = true;
    logger.info("hello");

    expect(bindings.LoggerNew).toHaveBeenCalledOnce();
    expect(bindings.LoggerInfo).toHaveBeenCalledOnce();
  });

  describe("log methods", () => {
    it("calls LoggerInfo for info()", () => {
      const bindings = createMockBindings();
      const logger = new Logger(() => bindings, "S");

      logger.info("msg", { domain: "test" });

      expect(bindings.LoggerInfo).toHaveBeenCalledWith(
        1,
        "msg",
        JSON.stringify({ domain: "test" }),
      );
    });

    it("calls LoggerWarn for warn()", () => {
      const bindings = createMockBindings();
      const logger = new Logger(() => bindings, "S");

      logger.warn("msg");

      expect(bindings.LoggerWarn).toHaveBeenCalledWith(1, "msg", "{}");
    });

    it("calls LoggerError for error()", () => {
      const bindings = createMockBindings();
      const logger = new Logger(() => bindings, "S");

      logger.error("msg");

      expect(bindings.LoggerError).toHaveBeenCalled();
    });

    it("calls LoggerDebug for debug()", () => {
      const bindings = createMockBindings();
      const logger = new Logger(() => bindings, "S");

      logger.debug("msg");

      expect(bindings.LoggerDebug).toHaveBeenCalled();
    });

    it("calls LoggerSuccess for success()", () => {
      const bindings = createMockBindings();
      const logger = new Logger(() => bindings, "S");

      logger.success("msg");

      expect(bindings.LoggerSuccess).toHaveBeenCalled();
    });

    it("calls LoggerStarted for started()", () => {
      const bindings = createMockBindings();
      const logger = new Logger(() => bindings, "S");

      logger.started("msg");

      expect(bindings.LoggerStarted).toHaveBeenCalled();
    });

    it("calls LoggerPlain for plain()", () => {
      const bindings = createMockBindings();
      const logger = new Logger(() => bindings, "S");

      logger.plain("msg");

      expect(bindings.LoggerPlain).toHaveBeenCalled();
    });
  });

  describe("get() subsystem cache", () => {
    it("returns a sub-logger with uppercased subsystem name", () => {
      const bindings = createMockBindings();
      const logger = new Logger(() => bindings, "SERVER");

      logger.get("http");

      expect(bindings.LoggerNew).toHaveBeenCalledWith("SERVER", "HTTP", "info", "dev");
    });

    it("caches sub-loggers by name", () => {
      const bindings = createMockBindings();
      const logger = new Logger(() => bindings, "SERVER");

      const a = logger.get("http");
      const b = logger.get("http");

      expect(a).toBe(b);
      // LoggerNew: once for parent, once for subsystem
      expect(bindings.LoggerNew).toHaveBeenCalledTimes(2);
    });

    it("treats subsystem names case-insensitively", () => {
      const bindings = createMockBindings();
      const logger = new Logger(() => bindings, "SERVER");

      const a = logger.get("Http");
      const b = logger.get("HTTP");

      expect(a).toBe(b);
    });
  });

  describe("cleanup", () => {
    it("calls LoggerFree with the handle", () => {
      const bindings = createMockBindings();
      const logger = new Logger(() => bindings, "S");

      logger.cleanup();

      expect(bindings.LoggerFree).toHaveBeenCalledWith(1);
    });

    it("is a no-op when no handle was created", () => {
      const bindings = createMockBindings();
      const logger = new Logger(() => null, "S");

      logger.cleanup();

      expect(bindings.LoggerFree).not.toHaveBeenCalled();
    });

    it("does not call LoggerFree twice", () => {
      const bindings = createMockBindings();
      const logger = new Logger(() => bindings, "S");

      logger.cleanup();
      logger.cleanup();

      expect(bindings.LoggerFree).toHaveBeenCalledOnce();
    });
  });

  it("normalizes Error context before sending to Go", () => {
    const bindings = createMockBindings();
    const logger = new Logger(() => bindings, "S");
    const err = new Error("fail");
    err.stack = undefined;

    logger.error("oops", { domain: "test", error: err });

    expect(bindings.LoggerError).toHaveBeenCalledWith(
      1,
      "oops",
      JSON.stringify({ domain: "test", error: "fail" }),
    );
  });
});
