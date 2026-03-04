import { Component, type ReactNode } from "react";

import { text } from "../theme";

interface PanelErrorBoundaryProps {
  children: ReactNode;
  resetKey?: string;
  label?: string;
}

interface PanelErrorBoundaryState {
  error: Error | null;
}

export class PanelErrorBoundary extends Component<
  PanelErrorBoundaryProps,
  PanelErrorBoundaryState
> {
  state: PanelErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    // Keep detailed traces in browser devtools and persist last UI error for quick retrieval.
    console.error("[OpenKit] Panel render error:", error);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(
          "OpenKit:lastUiError",
          JSON.stringify({
            at: new Date().toISOString(),
            label: this.props.label ?? "panel",
            message: error.message,
            stack: error.stack ?? "",
          }),
        );
      } catch {
        // Ignore storage failures.
      }
    }
  }

  componentDidUpdate(prevProps: PanelErrorBoundaryProps): void {
    if (
      this.state.error &&
      this.props.resetKey !== undefined &&
      this.props.resetKey !== prevProps.resetKey
    ) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="flex-1 min-h-0 p-6 overflow-auto">
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
          <p className="text-sm text-red-300 font-medium">UI crashed while rendering this panel</p>
          <p className={`text-xs mt-2 ${text.secondary}`}>
            {this.state.error.message || "Unknown error"}
          </p>
          <p className={`text-[11px] mt-2 ${text.dimmed}`}>
            Check DevTools console. Last error is also saved in
            `localStorage["OpenKit:lastUiError"]`.
          </p>
        </div>
      </div>
    );
  }
}
