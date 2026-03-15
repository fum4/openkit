import { describe, it, expect, vi, afterEach } from "vitest";
import { Logger } from "./index";
import type { LogEntry } from "./index";

describe("Logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("construction", () => {
    it("creates a logger with system name", () => {
      const logger = new Logger("server");

      expect(logger).toBeDefined();
      logger.cleanup();
    });

    it("creates a subsystem logger via get()", () => {
      const logger = new Logger("server");
      const sub = logger.get("port-manager");

      expect(sub).toBeDefined();
      expect(sub).not.toBe(logger);

      logger.cleanup();
    });

    it("caches subsystem loggers", () => {
      const logger = new Logger("server");

      const first = logger.get("nats");
      const second = logger.get("nats");

      expect(first).toBe(second);

      logger.cleanup();
    });

    it("normalizes subsystem names to uppercase", () => {
      const logger = new Logger("server");

      const lower = logger.get("nats");
      const upper = logger.get("NATS");

      expect(lower).toBe(upper);

      logger.cleanup();
    });
  });

  describe("log methods do not throw", () => {
    it("info()", () => {
      const logger = new Logger("test");
      expect(() => logger.info("hello")).not.toThrow();
      logger.cleanup();
    });

    it("warn()", () => {
      const logger = new Logger("test");
      expect(() => logger.warn("warning")).not.toThrow();
      logger.cleanup();
    });

    it("error()", () => {
      const logger = new Logger("test");
      expect(() => logger.error("error")).not.toThrow();
      logger.cleanup();
    });

    it("debug()", () => {
      const logger = new Logger("test");
      expect(() => logger.debug("debug")).not.toThrow();
      logger.cleanup();
    });

    it("success()", () => {
      const logger = new Logger("test");
      expect(() => logger.success("done")).not.toThrow();
      logger.cleanup();
    });

    it("plain()", () => {
      const logger = new Logger("test");
      expect(() => logger.plain("raw")).not.toThrow();
      logger.cleanup();
    });
  });

  describe("context passing", () => {
    it("accepts context with domain", () => {
      const logger = new Logger("test");
      expect(() => logger.info("msg", { domain: "test", port: 3000 })).not.toThrow();
      logger.cleanup();
    });

    it("accepts context with string error", () => {
      const logger = new Logger("test");
      expect(() => logger.error("failed", { domain: "test", error: "boom" })).not.toThrow();
      logger.cleanup();
    });

    it("accepts context with Error object and extracts message + stack", () => {
      const sink = vi.fn();
      const unsub = Logger.addSink(sink);
      const logger = new Logger("test");

      const err = new Error("something broke");
      logger.error("failed", { domain: "test", error: err });

      const entry = sink.mock.calls[0][0];
      expect(entry.metadata.error).toBe("something broke");
      expect(entry.metadata.stack).toContain("something broke");

      unsub();
      logger.cleanup();
    });
  });

  describe("sink dispatch", () => {
    it("dispatches log entries to registered sinks", () => {
      const sink = vi.fn();
      const unsub = Logger.addSink(sink);
      const logger = new Logger("test");

      logger.info("test message");

      expect(sink).toHaveBeenCalledTimes(1);
      const entry: LogEntry = sink.mock.calls[0][0];
      expect(entry.system).toBe("test");
      expect(entry.subsystem).toBe("");
      expect(entry.level).toBe("info");
      expect(entry.message).toBe("test message");

      unsub();
      logger.cleanup();
    });

    it("includes timestamp in sink entries", () => {
      const sink = vi.fn();
      const unsub = Logger.addSink(sink);
      const logger = new Logger("test");

      logger.info("msg");

      expect(sink.mock.calls[0][0].timestamp).toBeInstanceOf(Date);

      unsub();
      logger.cleanup();
    });

    it("dispatches metadata from context (excluding domain)", () => {
      const sink = vi.fn();
      const unsub = Logger.addSink(sink);
      const logger = new Logger("test");

      logger.info("started", { domain: "server", port: 3000 });

      expect(sink.mock.calls[0][0].metadata).toEqual({ port: 3000 });

      unsub();
      logger.cleanup();
    });

    it("extracts domain from context into dedicated field", () => {
      const sink = vi.fn();
      const unsub = Logger.addSink(sink);
      const logger = new Logger("test");

      logger.info("connected", { domain: "GitHub", repo: "foo/bar" });

      const entry: LogEntry = sink.mock.calls[0][0];
      expect(entry.domain).toBe("GitHub");
      expect(entry.metadata).toEqual({ repo: "foo/bar" });

      unsub();
      logger.cleanup();
    });

    it("sets metadata to undefined when context only has domain", () => {
      const sink = vi.fn();
      const unsub = Logger.addSink(sink);
      const logger = new Logger("test");

      logger.info("connected", { domain: "GitHub" });

      const entry: LogEntry = sink.mock.calls[0][0];
      expect(entry.domain).toBe("GitHub");
      expect(entry.metadata).toBeUndefined();

      unsub();
      logger.cleanup();
    });

    it("unsubscribe removes the sink", () => {
      const sink = vi.fn();
      const unsub = Logger.addSink(sink);
      const logger = new Logger("test");

      unsub();
      logger.info("after unsub");

      expect(sink).not.toHaveBeenCalled();

      logger.cleanup();
    });

    it("multiple sinks all receive entries", () => {
      const sink1 = vi.fn();
      const sink2 = vi.fn();
      const unsub1 = Logger.addSink(sink1);
      const unsub2 = Logger.addSink(sink2);
      const logger = new Logger("test");

      logger.info("msg");

      expect(sink1).toHaveBeenCalledTimes(1);
      expect(sink2).toHaveBeenCalledTimes(1);

      unsub1();
      unsub2();
      logger.cleanup();
    });

    it("sink errors do not break logging", () => {
      const badSink = vi.fn().mockImplementation(() => {
        throw new Error("sink exploded");
      });
      const goodSink = vi.fn();
      const unsub1 = Logger.addSink(badSink);
      const unsub2 = Logger.addSink(goodSink);
      const logger = new Logger("test");

      logger.info("msg");

      expect(goodSink).toHaveBeenCalledTimes(1);

      unsub1();
      unsub2();
      logger.cleanup();
    });

    it("success dispatches as info level to sinks", () => {
      const sink = vi.fn();
      const unsub = Logger.addSink(sink);
      const logger = new Logger("test");

      logger.success("done");

      expect(sink.mock.calls[0][0].level).toBe("info");

      unsub();
      logger.cleanup();
    });

    it("plain dispatches as info level to sinks", () => {
      const sink = vi.fn();
      const unsub = Logger.addSink(sink);
      const logger = new Logger("test");

      logger.plain("raw");

      expect(sink.mock.calls[0][0].level).toBe("info");

      unsub();
      logger.cleanup();
    });

    it("warn dispatches as warn level to sinks", () => {
      const sink = vi.fn();
      const unsub = Logger.addSink(sink);
      const logger = new Logger("test");

      logger.warn("careful");

      expect(sink.mock.calls[0][0].level).toBe("warn");

      unsub();
      logger.cleanup();
    });

    it("error dispatches as error level to sinks", () => {
      const sink = vi.fn();
      const unsub = Logger.addSink(sink);
      const logger = new Logger("test");

      logger.error("broken");

      expect(sink.mock.calls[0][0].level).toBe("error");

      unsub();
      logger.cleanup();
    });

    it("debug dispatches as debug level to sinks", () => {
      const sink = vi.fn();
      const unsub = Logger.addSink(sink);
      const logger = new Logger("test");

      logger.debug("trace");

      expect(sink.mock.calls[0][0].level).toBe("debug");

      unsub();
      logger.cleanup();
    });
  });

  describe("context extraction", () => {
    it("extracts no metadata when no context given", () => {
      const sink = vi.fn();
      const unsub = Logger.addSink(sink);
      const logger = new Logger("test");

      logger.info("no context");

      expect(sink.mock.calls[0][0].metadata).toBeUndefined();
      expect(sink.mock.calls[0][0].domain).toBeUndefined();

      unsub();
      logger.cleanup();
    });

    it("extracts domain and metadata from context", () => {
      const sink = vi.fn();
      const unsub = Logger.addSink(sink);
      const logger = new Logger("test");

      logger.info("with context", { domain: "test-domain", key: "value", num: 42 });

      const entry: LogEntry = sink.mock.calls[0][0];
      expect(entry.domain).toBe("test-domain");
      expect(entry.metadata).toEqual({ key: "value", num: 42 });

      unsub();
      logger.cleanup();
    });
  });

  describe("subsystem loggers dispatch with subsystem info", () => {
    it("includes subsystem name in sink entries", () => {
      const sink = vi.fn();
      const unsub = Logger.addSink(sink);
      const logger = new Logger("server");
      const sub = logger.get("port-manager");

      sub.info("allocating");

      expect(sink.mock.calls[0][0].system).toBe("server");
      expect(sink.mock.calls[0][0].subsystem).toBe("PORT-MANAGER");

      unsub();
      logger.cleanup();
    });
  });
});
