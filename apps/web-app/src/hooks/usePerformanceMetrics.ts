import { useEffect, useRef, useState } from "react";

import type { PerfSnapshot } from "@openkit/shared/perf-types";
import { log } from "../logger";
import { useServerUrlOptional } from "../contexts/ServerContext";
import { getPerfStreamUrl } from "./api";

const MAX_SNAPSHOTS = 150;
const INITIAL_RETRY_MS = 2000;
const MAX_RETRY_MS = 30000;

export function usePerformanceMetrics() {
  const serverUrl = useServerUrlOptional();
  const [snapshots, setSnapshots] = useState<PerfSnapshot[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retryDelayRef = useRef(INITIAL_RETRY_MS);

  useEffect(() => {
    setSnapshots([]);
    setIsConnected(false);
    setError(null);
    retryDelayRef.current = INITIAL_RETRY_MS;

    let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let eventSource: EventSource | null = null;

    const connect = () => {
      eventSource = new EventSource(getPerfStreamUrl(serverUrl));

      eventSource.onopen = () => {
        setIsConnected(true);
        setError(null);
        retryDelayRef.current = INITIAL_RETRY_MS;
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "perf-history") {
            setSnapshots(data.snapshots ?? []);
          } else if (data.type === "perf-snapshot") {
            setSnapshots((prev) => {
              const next = [...prev, data.snapshot];
              return next.length > MAX_SNAPSHOTS ? next.slice(next.length - MAX_SNAPSHOTS) : next;
            });
          }
        } catch (error) {
          log.debug("Performance stream parse failed", {
            domain: "metrics",
            error,
          });
        }
      };

      eventSource.onerror = () => {
        setIsConnected(false);
        setError("Performance monitoring unavailable");
        eventSource?.close();
        eventSource = null;
        const delay = retryDelayRef.current;
        log.debug(`Performance stream disconnected, retrying in ${delay}ms`, { domain: "metrics" });
        retryTimeoutId = setTimeout(connect, delay);
        retryDelayRef.current = Math.min(delay * 2, MAX_RETRY_MS);
      };
    };

    connect();

    return () => {
      eventSource?.close();
      if (retryTimeoutId !== null) clearTimeout(retryTimeoutId);
    };
  }, [serverUrl]);

  const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1]! : null;

  return { snapshots, latest, isConnected, error };
}
