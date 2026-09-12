import React, { useState, useEffect, useRef } from 'react';
import { BrainCircuit, ChevronDown, ChevronUp, Sparkles, RefreshCw } from 'lucide-react';

export default function ThinkingBlock({
  thinkingContent,
  isThinking = false,
  duration = 0
}) {
  // If thinking is active, keep it open. Once finished, collapse by default.
  const [isOpen, setIsOpen] = useState(isThinking);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (isThinking) {
      setIsOpen(true);
    }
  }, [isThinking]);

  // Auto-scroll to bottom while thinking
  useEffect(() => {
    if (isThinking && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thinkingContent, isThinking]);

  if (!thinkingContent && !isThinking) {
    return null;
  }

  const charCount = (thinkingContent || '').length;

  return (
    <div className="mb-2.5 rounded-lg border border-[var(--color-border)]/80 bg-[var(--color-surface-subtle)]/40 overflow-hidden text-xs transition-all">
      {/* Collapsible Header Capsule */}
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        className="w-full px-3 py-2 flex items-center justify-between font-mono text-[11px] text-[var(--color-neutral-7)] hover:text-[var(--color-neutral-10)] hover:bg-[var(--color-surface-subtle)]/60 transition-colors cursor-pointer select-none"
      >
        <div className="flex items-center gap-2 truncate">
          {isThinking ? (
            <RefreshCw className="w-3.5 h-3.5 text-purple-600 animate-spin shrink-0" />
          ) : (
            <BrainCircuit className="w-3.5 h-3.5 text-purple-500 shrink-0" />
          )}

          <span className="font-medium">
            {isThinking
              ? `正在深度推理思考 (${duration || 1}s)...`
              : `已深度思考 (${duration > 0 ? `${duration} 秒 · ` : ''}${charCount} 字)`}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 opacity-70">
          <span className="text-[10px]">
            {isOpen ? '收起思考过程' : '展开思维链'}
          </span>
          {isOpen ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </div>
      </button>

      {/* Expanded Thinking Content Box */}
      {isOpen && (
        <div
          ref={scrollRef}
          className="px-3.5 py-2.5 border-t border-[var(--color-border)]/60 bg-[var(--color-surface)]/80 max-h-56 overflow-y-auto font-mono text-[11px] leading-relaxed text-[var(--color-neutral-7)] whitespace-pre-wrap select-text animate-in fade-in duration-100"
        >
          {thinkingContent || (
            <span className="italic text-[var(--color-neutral-4)]">
              推理模型正在组织上下文脉络...
            </span>
          )}
          {isThinking && (
            <span className="inline-block w-1.5 h-3.5 ml-1 bg-purple-500 animate-pulse align-middle" />
          )}
        </div>
      )}
    </div>
  );
}
