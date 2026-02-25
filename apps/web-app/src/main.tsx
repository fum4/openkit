import "./index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { ServerProvider } from "./contexts/ServerContext";
import { ToastProvider } from "./contexts/ToastContext";

const queryClient = new QueryClient({
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
          <App />
        </ToastProvider>
      </ServerProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
