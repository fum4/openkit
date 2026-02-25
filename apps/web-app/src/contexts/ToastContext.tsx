import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";

export interface ToastChild {
  key: string;
  message: string;
  status: "loading" | "success" | "error";
  filePath?: string;
}

export interface Toast {
  id: string;
  message: string;
  level: "error" | "info" | "success";
  groupKey?: string;
  isLoading?: boolean;
  projectName?: string;
  worktreeId?: string;
  children?: ToastChild[];
  isExpanded?: boolean;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (
    message: string,
    level?: "error" | "info" | "success",
    projectName?: string,
    worktreeId?: string,
  ) => void;
  upsertToast: (
    groupKey: string,
    message: string,
    level: "error" | "info" | "success",
    isLoading: boolean,
    projectName?: string,
    worktreeId?: string,
  ) => void;
  upsertGroupedToast: (
    groupKey: string,
    child: ToastChild,
    projectName?: string,
    worktreeId?: string,
  ) => void;
  toggleToastExpanded: (id: string) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    // Clean up timer
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const scheduleAutoDismiss = useCallback(
    (id: string, level: "error" | "info" | "success") => {
      // Clear any existing timer for this toast
      const existing = timersRef.current.get(id);
      if (existing) clearTimeout(existing);

      const timeout = level === "error" ? 10000 : 5000;
      const timer = setTimeout(() => {
        removeToast(id);
        timersRef.current.delete(id);
      }, timeout);
      timersRef.current.set(id, timer);
    },
    [removeToast],
  );

  const addToast = useCallback(
    (
      message: string,
      level: "error" | "info" | "success" = "error",
      projectName?: string,
      worktreeId?: string,
    ) => {
      const id = String(++nextId);
      setToasts((prev) => [...prev, { id, message, level, projectName, worktreeId }]);
      scheduleAutoDismiss(id, level);
    },
    [scheduleAutoDismiss],
  );

  const upsertToast = useCallback(
    (
      groupKey: string,
      message: string,
      level: "error" | "info" | "success",
      isLoading: boolean,
      projectName?: string,
      worktreeId?: string,
    ) => {
      setToasts((prev) => {
        const existingIndex = prev.findIndex((t) => t.groupKey === groupKey);
        if (existingIndex >= 0) {
          // Update in-place
          const updated = [...prev];
          const existing = updated[existingIndex];
          updated[existingIndex] = {
            ...existing,
            message,
            level,
            isLoading,
            projectName: projectName ?? existing.projectName,
            worktreeId: worktreeId ?? existing.worktreeId,
          };

          // Reschedule auto-dismiss if no longer loading
          if (!isLoading) {
            scheduleAutoDismiss(existing.id, level);
          } else {
            // Cancel any existing timer for loading toasts
            const timer = timersRef.current.get(existing.id);
            if (timer) {
              clearTimeout(timer);
              timersRef.current.delete(existing.id);
            }
          }

          return updated;
        }

        // Create new toast
        const id = String(++nextId);
        const toast: Toast = { id, message, level, groupKey, isLoading, projectName, worktreeId };

        if (!isLoading) {
          scheduleAutoDismiss(id, level);
        }

        return [...prev, toast];
      });
    },
    [scheduleAutoDismiss],
  );

  const upsertGroupedToast = useCallback(
    (groupKey: string, child: ToastChild, projectName?: string, worktreeId?: string) => {
      setToasts((prev) => {
        const existingIndex = prev.findIndex((t) => t.groupKey === groupKey);

        if (existingIndex >= 0) {
          const updated = [...prev];
          const existing = updated[existingIndex];
          const children = [...(existing.children ?? [])];
          const childIndex = children.findIndex((c) => c.key === child.key);
          if (childIndex >= 0) {
            children[childIndex] = child;
          } else {
            children.push(child);
          }

          const completed = children.filter((c) => c.status !== "loading").length;
          const total = children.length;
          const anyFailed = children.some((c) => c.status === "error");
          const allDone = children.every((c) => c.status !== "loading");
          const level = anyFailed ? "error" : allDone ? "success" : "info";
          const isLoading = !allDone;
          const message = allDone
            ? `${total} hook${total !== 1 ? "s" : ""} completed`
            : `Running hooks (${completed}/${total})...`;

          updated[existingIndex] = {
            ...existing,
            message,
            level,
            isLoading,
            children,
            projectName: projectName ?? existing.projectName,
            worktreeId: worktreeId ?? existing.worktreeId,
          };

          if (!isLoading) {
            scheduleAutoDismiss(existing.id, level);
          } else {
            const timer = timersRef.current.get(existing.id);
            if (timer) {
              clearTimeout(timer);
              timersRef.current.delete(existing.id);
            }
          }

          return updated;
        }

        // Create new grouped toast
        const id = String(++nextId);
        const isLoading = child.status === "loading";
        const level = child.status === "error" ? "error" : isLoading ? "info" : "success";
        const message = isLoading ? "Running hooks (0/1)..." : "1 hook completed";
        const toast: Toast = {
          id,
          message,
          level,
          groupKey,
          isLoading,
          projectName,
          worktreeId,
          children: [child],
        };

        if (!isLoading) {
          scheduleAutoDismiss(id, level);
        }

        return [...prev, toast];
      });
    },
    [scheduleAutoDismiss],
  );

  const toggleToastExpanded = useCallback((id: string) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, isExpanded: !t.isExpanded } : t)));
  }, []);

  return (
    <ToastContext.Provider
      value={{
        toasts,
        addToast,
        upsertToast,
        upsertGroupedToast,
        toggleToastExpanded,
        removeToast,
      }}
    >
      {children}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
