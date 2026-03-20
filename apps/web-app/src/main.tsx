/**
 * Application entry point. Bootstraps React Query, global error handling,
 * and renders the root App component.
 */
import "./index.css";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "react-hot-toast";

import App from "./App";
import { GlobalErrorToasts, reportPersistentErrorToast } from "./errorToasts";
import { ServerProvider } from "./contexts/ServerContext";
import { ToastProvider } from "./contexts/ToastContext";

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      reportPersistentErrorToast(error, "Failed to load data", {
        scope: `query:${query.queryHash}`,
      });
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      const key = mutation.options.mutationKey;
      const scope = Array.isArray(key) ? key.join(":") : "unknown-mutation";
      reportPersistentErrorToast(error, "Request failed", { scope: `mutation:${scope}` });
    },
  }),
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ServerProvider>
        <ToastProvider>
          <GlobalErrorToasts />
          <Toaster
            containerStyle={{ bottom: 80, right: 34 }}
            position="bottom-center"
            toastOptions={{
              className: "rounded-xl border border-slate-700 bg-slate-900 text-slate-100",
              duration: 4500,
              removeDelay: 0,
              style: {
                background: "#0f1013",
                color: "#f1f5f9",
                border: "1px solid #334155",
              },
            }}
          />
          <App />
        </ToastProvider>
      </ServerProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
