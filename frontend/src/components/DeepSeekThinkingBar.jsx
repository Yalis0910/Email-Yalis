import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Sparkles, Brain } from 'lucide-react';

/**
 * DeepSeekThinkingBar
 * Recreates the authentic DeepSeek R1 thinking process block:
 * - Collapsed summary bar: "已深度思考 (用时 X 秒)" or "正在深度思考..."
 * - Signature left vertical bar (border-l-2)
 * - Muted, elegant monospace/sans typography for thoughts
 */
export default function DeepSeekThinkingBar({
  thinkingContent = '',
  isThinking = false,
  duration = 0,
  defaultExpanded = false,
  className = ''
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [liveDuration, setLiveDuration] = useState(duration || 0);

  // Keep live duration ticking while thinking
  useEffect(() => {
    let interval = null;
    if (isThinking) {
      setIsExpanded(true); // Auto-expand when actively thinking
      const start = Date.now();
      interval = setInterval(() => {
        setLiveDuration(Math.max(1, Math.floor((Date.now() - start) / 1000)));
      }, 500);
    } else {
      if (duration) setLiveDuration(duration);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isThinking, duration]);

  if (!thinkingContent && !isThinking) return null;

  const charCount = (thinkingContent || '').length;

  return (
    <div className={`my-2.5 select-text font-sans text-xs transition-all ${className}`}>
      {/* DeepSeek Style Collapsible Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="group inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-[var(--color-surface-subtle)] text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)] transition-colors cursor-pointer text-xs font-sans"
      >
        <div className="flex items-center gap-1.5">
          {isThinking ? (
            <Sparkles className="w-3.5 h-3.5 text-[var(--color-accent)] animate-spin" style={{ animationDuration: '3s' }} />
          ) : (
            <Brain className="w-3.5 h-3.5 text-[var(--color-neutral-5)] group-hover:text-[var(--color-accent)] transition-colors" />
          )}
          <span className="font-medium text-[var(--color-neutral-7)] group-hover:text-[var(--color-neutral-9)]">
            {isThinking
              ? `正在深度思考 (${liveDuration}s · ${charCount} 字)`
              : `已深度思考 (${liveDuration} 秒 · ${charCount} 字)`}
          </span>
        </div>

        <span className="text-[10px] text-[var(--color-neutral-5)] flex items-center gap-0.5 ml-1 font-mono">
          {isExpanded ? (
            <>
              <span>收起</span>
              <ChevronDown className="w-3 h-3 text-[var(--color-neutral-5)]" />
            </>
          ) : (
            <>
              <span>展开</span>
              <ChevronRight className="w-3 h-3 text-[var(--color-neutral-5)]" />
            </>
          )}
        </span>
      </button>

      {/* DeepSeek Signature Left Vertical Line Block */}
      {isExpanded && (
        <div className="mt-1.5 pl-3.5 ml-2.5 border-l-2 border-[var(--color-neutral-3)] dark:border-[var(--color-neutral-7)] animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="text-[12px] leading-relaxed text-[var(--color-neutral-6)] dark:text-[var(--color-neutral-4)] whitespace-pre-wrap font-sans font-normal max-h-[360px] overflow-y-auto pr-2 custom-scrollbar">
            {thinkingContent || (
              <span className="italic text-[var(--color-neutral-5)] flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-ping" />
                模型正在进行思维链推理...
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
