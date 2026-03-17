import { useEffect } from "react";

/**
 * Listens for external file-change events pushed via SSE and calls the
 * provided callback when the given category matches.
 */
export function useFileChangeEvent(category: string, onChanged: () => void): void {
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail === category) {
        onChanged();
      }
    };
    window.addEventListener("OpenKit:file-changed", handler);
    return () => window.removeEventListener("OpenKit:file-changed", handler);
  }, [category, onChanged]);
}
