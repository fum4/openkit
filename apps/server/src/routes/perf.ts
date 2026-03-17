import type { Hono } from "hono";

import type { PerfMonitor } from "../perf-monitor";

export function registerPerfRoutes(app: Hono, perfMonitor: PerfMonitor) {
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
          } catch {
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
