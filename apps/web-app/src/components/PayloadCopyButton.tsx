import { Copy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type PayloadCopyButtonProps = {
  copyText: string;
  ariaLabel: string;
  className?: string;
};

const COPY_RESET_DELAY_MS = 3000;

export function PayloadCopyButton({ copyText, ariaLabel, className }: PayloadCopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(() => {
    if (!copyText) return;

    void navigator.clipboard
      .writeText(copyText)
      .then(() => {
        setCopied(true);
        if (resetTimerRef.current) {
          clearTimeout(resetTimerRef.current);
        }
        resetTimerRef.current = setTimeout(() => {
          setCopied(false);
          resetTimerRef.current = null;
        }, COPY_RESET_DELAY_MS);
      })
      .catch(() => {
        // Ignore clipboard failures.
      });
  }, [copyText]);

  useEffect(
    () => () => {
      if (!resetTimerRef.current) return;
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    },
    [],
  );

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`inline-flex items-center justify-center leading-none ${className ?? ""}`}
      aria-label={ariaLabel}
    >
      {copied ? (
        <span className="inline-flex items-center text-[9px] leading-none">Copied</span>
      ) : (
        <Copy className="w-[13px] h-[13px]" />
      )}
    </button>
  );
}
