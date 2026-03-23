import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

const DEFAULT_ERROR_MESSAGE = "Something went wrong";
const DEFAULT_DEDUPE_WINDOW_MS = 1200;
const recentErrorMap = new Map<string, number>();
export const OPENKIT_ERROR_TOAST_EVENT = "OpenKit:error-toast";

export interface ErrorToastContent {
  title?: string;
  description?: string;
  message?: string;
}

type ErrorToastInput = string | ErrorToastContent;

interface ErrorToastOptions {
  scope?: string;
  dedupeWindowMs?: number;
}

export interface ErrorToastEventDetail {
  message: string;
  title?: string;
  description?: string;
  scope?: string;
}

function normalizeMessage(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function buildDedupeKey(message: string, scope?: string): string {
  const normalizedScope = scope?.trim() || "global";
  return `${normalizedScope}:${normalizeMessage(message).toLowerCase()}`;
}

function toErrorToastContent(input: ErrorToastInput): ErrorToastContent {
  if (typeof input === "string") {
    const normalizedMessage = normalizeMessage(input);
    return { message: normalizedMessage };
  }

  const title = input.title ? normalizeMessage(input.title) : undefined;
  const description = input.description ? normalizeMessage(input.description) : undefined;
  const message = input.message ? normalizeMessage(input.message) : undefined;

  if (title && description) return { title, description };
  if (message) return { message };
  if (title) return { message: title };
  if (description) return { message: description };
  return { message: "" };
}

function contentToDedupeText(content: ErrorToastContent): string {
  if (content.title && content.description) return `${content.title} ${content.description}`;
  if (content.message) return content.message;
  if (content.title) return content.title;
  if (content.description) return content.description;
  return "";
}

/** Text that clamps to ~4 lines with a "Show more" toggle. */
function ClampedText({ text, className }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) setClamped(el.scrollHeight > el.clientHeight + 2);
  }, [text]);

  return (
    <div>
      <p
        ref={ref}
        className={`leading-relaxed ${className ?? ""} ${expanded ? "" : "line-clamp-4"}`}
      >
        {text}
      </p>
      {clamped && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1 text-[11px] text-red-200/50 hover:text-red-200/80 transition-colors"
        >
          Show more
        </button>
      )}
    </div>
  );
}

export function getErrorMessage(error: unknown, fallback = DEFAULT_ERROR_MESSAGE): string {
  if (typeof error === "string" && error.trim().length > 0) return error.trim();
  if (error instanceof Error && error.message.trim().length > 0) return error.message.trim();
  return fallback;
}

export function showPersistentErrorToast(
  input: ErrorToastInput,
  options?: ErrorToastOptions,
): void {
  const content = toErrorToastContent(input);
  const dedupeText = contentToDedupeText(content);
  if (!dedupeText) return;

  const dedupeWindowMs = options?.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
  const dedupeKey = buildDedupeKey(dedupeText, options?.scope);
  const now = Date.now();
  const lastShownAt = recentErrorMap.get(dedupeKey);
  if (lastShownAt !== undefined && now - lastShownAt < dedupeWindowMs) return;
  recentErrorMap.set(dedupeKey, now);

  if (typeof window !== "undefined") {
    const detail: ErrorToastEventDetail = {
      message: dedupeText,
      title: content.title,
      description: content.description,
      scope: options?.scope,
    };
    window.dispatchEvent(
      new CustomEvent<ErrorToastEventDetail>(OPENKIT_ERROR_TOAST_EVENT, { detail }),
    );
  }

  toast.custom(
    (toastInstance) => (
      <div className="pointer-events-auto flex min-w-[320px] max-w-[440px] items-start gap-3 rounded-xl bg-[#341417] px-4 py-3 text-sm text-red-100/75 shadow-2xl">
        <button
          aria-label="Dismiss error toast"
          className="-ml-1 rounded p-1 text-red-200/45 transition hover:bg-red-900/20 hover:text-white"
          onClick={() => toast.remove(toastInstance.id)}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          {content.title && content.description ? (
            <>
              <p className="leading-relaxed font-medium text-red-100/90">{content.title}</p>
              <ClampedText text={content.description} className="mt-1 text-xs text-red-100/70" />
            </>
          ) : (
            <ClampedText text={content.message ?? content.title ?? content.description ?? ""} />
          )}
        </div>
      </div>
    ),
    {
      duration: 5000,
      position: "bottom-right",
      removeDelay: 0,
    },
  );
}

export function reportPersistentErrorToast(
  error: unknown,
  fallback = DEFAULT_ERROR_MESSAGE,
  options?: ErrorToastOptions,
): void {
  showPersistentErrorToast(getErrorMessage(error, fallback), options);
}

export function reportDetailedErrorToast(
  title: string,
  error: unknown,
  options?: ErrorToastOptions,
): void {
  showPersistentErrorToast(
    {
      title,
      description: getErrorMessage(error, DEFAULT_ERROR_MESSAGE),
    },
    options,
  );
}

export function GlobalErrorToasts() {
  useEffect(() => {
    const onUnhandledError = (event: ErrorEvent) => {
      // Cross-origin script errors (e.g. Monaco CDN workers) surface as "Script error."
      // with no actionable info — suppress them.
      if (event.message === "Script error.") return;
      reportPersistentErrorToast(event.error ?? event.message, DEFAULT_ERROR_MESSAGE, {
        scope: "window:error",
      });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      reportPersistentErrorToast(event.reason, DEFAULT_ERROR_MESSAGE, {
        scope: "window:unhandledrejection",
      });
    };

    window.addEventListener("error", onUnhandledError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onUnhandledError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
