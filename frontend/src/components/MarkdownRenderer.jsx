import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Mail } from 'lucide-react';

export default function MarkdownRenderer({ content, onSelectEmail, className = '' }) {
  if (!content) return null;

  // Sanitize any raw tool_call XML tags leaked from LLM
  const sanitizedContent = content
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<tool_call>[\s\S]*/gi, '');

  // Pre-process [REF:id|title|date] into markdown links: [title](email-ref://id?date=date)
  // Also handles [REF:id\|title\|date] inside markdown tables where pipe characters are escaped
  const processedContent = sanitizedContent.replace(
    /\[REF:([^|\\\]]+)(?:\\?\|)([^|\\\]]+)(?:\\?\|)([^\]]*)\]/g,
    (_, id, title, date) => `[${title.trim()}](email-ref://${id.trim()}?date=${encodeURIComponent((date || '').trim())})`
  );

  return (
    <div className={`markdown-body font-sans text-xs sm:text-[13px] leading-relaxed text-[var(--color-neutral-8)] ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => url}
        components={{
          h1: ({ node, ...props }) => (
            <h1 className="text-base sm:text-lg font-serif font-medium text-[var(--color-neutral-10)] mt-4 mb-2 pb-1.5 border-b border-[var(--color-border)]" {...props} />
          ),
          h2: ({ node, ...props }) => (
            <h2 className="text-sm sm:text-base font-serif font-medium text-[var(--color-neutral-10)] mt-3.5 mb-1.5" {...props} />
          ),
          h3: ({ node, ...props }) => (
            <h3 className="text-xs sm:text-sm font-serif font-medium text-[var(--color-neutral-10)] mt-3 mb-1" {...props} />
          ),
          h4: ({ node, ...props }) => (
            <h4 className="text-xs font-serif font-medium text-[var(--color-neutral-9)] mt-2 mb-1" {...props} />
          ),
          p: ({ node, ...props }) => (
            <p className="my-1.5 leading-relaxed text-[var(--color-neutral-8)]" {...props} />
          ),
          ul: ({ node, ...props }) => (
            <ul className="list-disc list-outside pl-5 space-y-1 my-2" {...props} />
          ),
          ol: ({ node, ...props }) => (
            <ol className="list-decimal list-outside pl-5 space-y-1 my-2" {...props} />
          ),
          li: ({ node, ...props }) => (
            <li className="leading-relaxed" {...props} />
          ),
          blockquote: ({ node, ...props }) => (
            <blockquote className="border-l-2 border-[var(--color-accent)] pl-3 my-2 text-xs italic text-[var(--color-neutral-7)] bg-[var(--color-surface-subtle)]/50 py-1.5 rounded-r" {...props} />
          ),
          strong: ({ node, ...props }) => (
            <strong className="font-semibold text-[var(--color-neutral-10)]" {...props} />
          ),
          hr: ({ node, ...props }) => (
            <hr className="my-3 border-t border-[var(--color-border)]" {...props} />
          ),
          table: ({ node, ...props }) => (
            <div className="overflow-x-auto my-2.5">
              <table className="w-full text-xs border-collapse border border-[var(--color-border)] rounded-md" {...props} />
            </div>
          ),
          thead: ({ node, ...props }) => (
            <thead className="bg-[var(--color-surface-subtle)] text-[var(--color-neutral-9)] font-medium" {...props} />
          ),
          th: ({ node, ...props }) => (
            <th className="border border-[var(--color-border)] px-3 py-1.5 text-left font-medium" {...props} />
          ),
          td: ({ node, ...props }) => (
            <td className="border border-[var(--color-border)] px-3 py-1.5" {...props} />
          ),
          code: ({ node, inline, className, children, ...props }) => {
            const isInline = inline || !String(children).includes('\n');
            if (isInline) {
              return (
                <code className="px-1.5 py-0.5 rounded text-[11px] font-mono bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[var(--color-accent)] font-normal" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <pre className="p-3 my-2 rounded-lg text-xs font-mono bg-[var(--color-surface-subtle)] border border-[var(--color-border)] overflow-x-auto text-[var(--color-neutral-9)] leading-relaxed">
                <code {...props}>{children}</code>
              </pre>
            );
          },
          a: ({ node, href, children, ...props }) => {
            if (href && href.startsWith('email-ref://')) {
              const emailId = href.replace('email-ref://', '').split('?')[0];
              return (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onSelectEmail) onSelectEmail(emailId);
                  }}
                  className="inline-flex items-center gap-1 mx-1 px-1.5 py-0.5 rounded bg-[var(--color-accent)]/10 text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white border border-[var(--color-accent)]/20 text-xs font-mono transition-colors align-baseline cursor-pointer"
                  title="点击打开此邮件正文"
                >
                  <Mail className="w-3 h-3 shrink-0" />
                  <span className="max-w-[180px] truncate">{children}</span>
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--color-accent)] underline hover:opacity-85" {...props}>
                {children}
              </a>
            );
          },
          input: ({ node, ...props }) => {
            if (props.type === 'checkbox') {
              return <input type="checkbox" disabled className="mr-1.5 rounded accent-[var(--color-accent)] align-middle" {...props} />;
            }
            return <input {...props} />;
          }
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}
