import type { Hono } from "hono";

import { log } from "../logger";
import type { PerfMonitor } from "../perf-monitor";

export function registerPerfRoutes(app: Hono, perfMonitor: PerfMonitor) {
  app.post("/api/perf/kill", async (c) => {
    try {
      const body = await c.req.json();
      const serverPid = process.pid;
      const pids: number[] = Array.isArray(body.pids)
        ? body.pids.filter((p: unknown) => typeof p === "number" && p > 0 && p !== serverPid)
        : [];
      if (pids.length === 0) {
        return c.json({ success: false, error: "No valid PIDs provided" }, 400);
      }

      const results: { pid: number; killed: boolean; error?: string }[] = [];
      for (const pid of pids) {
        try {
          process.kill(pid, "SIGKILL");
          results.push({ pid, killed: true });
          log.info(`Killed process ${pid}`, { domain: "perf" });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push({ pid, killed: false, error: msg });
          log.warn(`Failed to kill process ${pid}: ${msg}`, { domain: "perf" });
        }
      }

      return c.json({ success: true, results });
    } catch (err) {
      return c.json(
        { success: false, error: err instanceof Error ? err.message : "Invalid request" },
        400,
      );
    }
  });

  app.get("/api/perf", (c) => {
    return c.json({ snapshots: perfMonitor.getHistory() });
  });

  app.get("/api/perf/current", (c) => {
    return c.json({ snapshot: perfMonitor.getLatest() });
  });

  app.get("/api/perf/stream", (c) => {
    const stream = new ReadableStream({
      start(controller) {
        // Always send history on connect (even if empty) to kick-start the
        // stream — @hono/node-server may not begin piping until the first
        // chunk is enqueued synchronously inside start().
        const history = perfMonitor.getHistory();
        controller.enqueue(
          `data: ${JSON.stringify({ type: "perf-history", snapshots: history })}\n\n`,
        );

        // Subscribe to live updates
        const unsubscribe = perfMonitor.subscribe((snapshot) => {
          try {
            controller.enqueue(`data: ${JSON.stringify({ type: "perf-snapshot", snapshot })}\n\n`);
          } catch (error) {
            log.debug("Perf SSE enqueue failed, unsubscribing", { domain: "metrics", error });
            unsubscribe();
          }
        });

        c.req.raw.signal.addEventListener("abort", () => {
          unsubscribe();
          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });
}
