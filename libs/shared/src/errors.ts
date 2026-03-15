interface ErrorInfo {
  error: string;
  stack: string | undefined;
}

/**
 * Extract error message and stack trace from an unknown caught value.
 * Handles both Error objects and plain strings/values.
 */
export function toErrorInfo(value: unknown): ErrorInfo {
  if (value instanceof Error) {
    return { error: value.message, stack: value.stack };
  }
  return { error: String(value), stack: undefined };
}

/**
 * Extract a human-readable error message from an unknown caught value.
 */
export function toErrorMessage(value: unknown): string {
  return toErrorInfo(value).error;
}
