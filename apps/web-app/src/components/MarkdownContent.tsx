import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { text } from "../theme";

interface MarkdownContentProps {
  content: string;
  className?: string;
  /** Base URL to prepend to relative image/link paths (e.g. serverUrl for proxied Jira images) */
  baseUrl?: string;
  /** Callback when an inline image is clicked (src, alt). If provided, opens preview instead of browser. */
  onImageClick?: (src: string, alt: string) => void;
}

function preserveBlankLines(src: string): string {
  return src.replace(/\n{3,}/g, (m) => "\n\n" + "&nbsp;\n\n".repeat(m.length - 2));
}

function resolveUrl(src: string | undefined, baseUrl?: string): string {
  if (!src) return "";
  if (baseUrl && src.startsWith("/")) return `${baseUrl}${src}`;
  return src;
}

function InlineImage({
  src,
  alt,
  baseUrl,
  onImageClick,
}: {
  src?: string;
  alt?: string;
  baseUrl?: string;
  onImageClick?: (src: string, alt: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const url = resolveUrl(src, baseUrl);
  const label = alt || "attachment";

  if (failed || !url) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[11px] ${text.muted} bg-white/[0.04] px-2 py-0.5 rounded`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="w-3 h-3"
        >
          <path
            fillRule="evenodd"
            d="M4 2a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V6.621a1.5 1.5 0 0 0-.44-1.06L9.94 2.439A1.5 1.5 0 0 0 8.878 2H4Z"
            clipRule="evenodd"
          />
        </svg>
        {label}
      </span>
    );
  }

  const thumbnail = (
    <span className="rounded overflow-hidden block relative">
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center bg-white/[0.03]">
          <svg
            className={`animate-spin w-3 h-3 ${text.dimmed}`}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        </span>
      )}
      <img
        src={url}
        alt={label}
        className={`w-36 h-28 object-cover transition-transform hover:scale-105 ${loading ? "opacity-0" : "opacity-100"}`}
        loading="lazy"
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setFailed(true);
        }}
      />
    </span>
  );

  return (
    <span className="inline-block my-1">
      {onImageClick ? (
        <button
          type="button"
          onClick={() => onImageClick(url, label)}
          className="flex flex-col w-36"
        >
          {thumbnail}
        </button>
      ) : (
        <a href={url} target="_blank" rel="noopener noreferrer" className="flex flex-col w-36">
          {thumbnail}
        </a>
      )}
    </span>
  );
}

export function MarkdownContent({
  content,
  className,
  baseUrl,
  onImageClick,
}: MarkdownContentProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          h1: ({ children }) => (
            <h1 className={`text-base font-semibold ${text.primary} mb-3 mt-4 first:mt-0`}>
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className={`text-sm font-semibold ${text.primary} mb-2 mt-3 first:mt-0`}>
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className={`text-xs font-semibold ${text.primary} mb-2 mt-3 first:mt-0`}>
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className={`text-xs font-medium ${text.primary} mb-1.5 mt-2 first:mt-0`}>
              {children}
            </h4>
          ),
          h5: ({ children }) => (
            <h5 className={`text-xs font-medium ${text.secondary} mb-1 mt-2 first:mt-0`}>
              {children}
            </h5>
          ),
          h6: ({ children }) => (
            <h6 className={`text-xs font-medium ${text.muted} mb-1 mt-2 first:mt-0`}>{children}</h6>
          ),
          p: ({ children }) => (
            <p className={`text-xs ${text.secondary} leading-relaxed mb-2 last:mb-0`}>{children}</p>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:text-accent-muted underline underline-offset-2"
            >
              {children}
            </a>
          ),
          code: ({ className: codeClassName, children }) => {
            const isBlock = codeClassName?.startsWith("language-");
            if (isBlock) {
              return <code className={`text-[11px] ${text.secondary}`}>{children}</code>;
            }
            return (
              <code className={`text-[11px] ${text.primary} bg-white/[0.08] px-1 py-0.5 rounded`}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="bg-white/[0.04] border border-white/[0.06] rounded-md px-3 py-2 overflow-x-auto mb-2 last:mb-0">
              {children}
            </pre>
          ),
          ul: ({ children }) => (
            <ul
              className={`text-xs ${text.secondary} list-disc list-outside ml-4 mb-2 last:mb-0 space-y-0.5`}
            >
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol
              className={`text-xs ${text.secondary} list-decimal list-outside ml-4 mb-2 last:mb-0 space-y-0.5`}
            >
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote
              className={`border-l-2 border-white/[0.15] pl-3 ${text.muted} mb-2 last:mb-0`}
            >
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto mb-2 last:mb-0">
              <table className="text-xs border-collapse border border-white/[0.08] w-full">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-white/[0.04]">{children}</thead>,
          th: ({ children }) => (
            <th
              className={`text-left px-2 py-1.5 border border-white/[0.08] ${text.primary} font-medium text-[11px]`}
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className={`px-2 py-1.5 border border-white/[0.08] ${text.secondary} text-[11px]`}>
              {children}
            </td>
          ),
          hr: () => <hr className="border-white/[0.08] my-3" />,
          strong: ({ children }) => (
            <strong className={`font-semibold ${text.primary}`}>{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          img: ({ src, alt }) => (
            <InlineImage src={src} alt={alt ?? ""} baseUrl={baseUrl} onImageClick={onImageClick} />
          ),
        }}
      >
        {preserveBlankLines(content)}
      </ReactMarkdown>
    </div>
  );
}
