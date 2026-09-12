import React, { useState, useRef, useEffect } from 'react';
import { 
  Gauge, 
  Sparkles, 
  RefreshCw, 
  CheckCircle2, 
  ChevronUp,
  ChevronDown
} from 'lucide-react';

/**
 * Formats token count to human-friendly string (e.g., 224, ~8.7K, ~149K, 512K)
 */
export function formatTokens(num) {
  if (!num && num !== 0) return '0';
  const val = Number(num);
  if (val < 1000) {
    return `${val}`;
  }
  if (val < 100000) {
    const k = (val / 1000).toFixed(1);
    return k.endsWith('.0') ? `${Math.round(val / 1000)}K` : `${k}K`;
  }
  return `${Math.round(val / 1000)}K`;
}

export default function ContextTokenPopover({
  stats = {},
  isCompressing = false,
  onCompress,
  dropUp = true,
  compact = false,
  align = 'offset-left'
}) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef(null);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const total = stats?.total_tokens ?? 0;
  const limit = stats?.limit_tokens ?? stats?.context_limit ?? 524288;
  const percent = stats?.percent ?? stats?.usage_percent ?? (limit > 0 ? (total / limit) * 100 : 0);
  const safePercent = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const calculatedPercent = safePercent.toFixed(1);

  // Status color codes
  const isDanger = safePercent >= 90;
  const isWarning = safePercent >= 50;

  const system_tokens = stats?.system_tokens ?? stats?.breakdown?.system_prompt ?? 0;
  const tools_tokens = stats?.tools_tokens ?? stats?.breakdown?.tools_schema ?? 0;
  const messages_tokens = stats?.messages_tokens ?? stats?.breakdown?.messages ?? 0;
  const summary_tokens = stats?.summary_tokens ?? stats?.breakdown?.context_summary ?? 0;

  const safeLimit = limit > 0 ? limit : 524288;
  const safeTotal = total > 0 ? total : (system_tokens + tools_tokens + messages_tokens + summary_tokens);

  // Calculate percentage for multi-segment progress bar
  const sysPct = Math.min(100, (system_tokens / safeLimit) * 100);
  const toolsPct = Math.min(100, (tools_tokens / safeLimit) * 100);
  const msgPct = Math.min(100, (messages_tokens / safeLimit) * 100);
  const sumPct = Math.min(100, (summary_tokens / safeLimit) * 100);

  const alignClass = {
    'offset-left': '-left-24 sm:-left-28',
    'left': 'left-0',
    'right': 'right-0',
    'center': 'left-1/2 -translate-x-1/2'
  }[align] || '-left-24 sm:-left-28';

  return (
    <div className="relative inline-block" ref={popoverRef}>
      {/* Trigger Button: Only shows percentage when unexpanded */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title={`上下文已用 ${calculatedPercent}% (~${formatTokens(safeTotal)} / ${formatTokens(safeLimit)})`}
        className={`flex items-center gap-1.5 rounded-lg border font-mono transition-all cursor-pointer select-none text-xs ${
          compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs'
        } ${
          isDanger 
            ? 'border-rose-300 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400' 
            : isWarning 
              ? 'border-amber-300 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400'
              : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-subtle)] text-[var(--color-neutral-7)] hover:text-[var(--color-neutral-10)]'
        } ${isOpen ? 'ring-2 ring-[var(--color-accent)]/20 border-[var(--color-accent)]' : ''}`}
      >
        <Gauge className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} shrink-0 ${
          isDanger ? 'text-rose-500 animate-pulse' : isWarning ? 'text-amber-500' : 'text-[var(--color-accent)]'
        }`} />
        
        <span className="font-medium whitespace-nowrap">
          {calculatedPercent}%
        </span>

        {/* Warning Dot Indicator for >50% */}
        {isWarning && (
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
        )}
        {isDanger && (
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping shrink-0" />
        )}

        {dropUp ? (
          <ChevronUp className="w-3 h-3 opacity-40 shrink-0" />
        ) : (
          <ChevronDown className="w-3 h-3 opacity-40 shrink-0" />
        )}
      </button>

      {/* Expanded Popover (Replicating Image 1 Style + Yohaku Theme) */}
      {isOpen && (
        <div
          className={`absolute ${
            dropUp ? 'bottom-full mb-2' : 'top-full mt-2'
          } ${alignClass} z-50 w-[300px] sm:w-[320px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-neutral-9)] shadow-2xl p-4 animate-in fade-in zoom-in-95 duration-150`}
          style={{
            backdropFilter: 'blur(16px)'
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between font-mono text-xs pb-3 border-b border-[var(--color-border)]/50">
            <span className="font-semibold text-[var(--color-neutral-9)] flex items-center gap-1.5">
              <span>上下文已用</span>
              <span className={`text-sm ${
                isDanger ? 'text-rose-500 font-bold' : isWarning ? 'text-amber-500 font-bold' : 'text-[var(--color-accent)]'
              }`}>
                {calculatedPercent}%
              </span>
            </span>
            <span className="text-[var(--color-neutral-6)] text-[11px]">
              ~{formatTokens(safeTotal)} / {formatTokens(safeLimit)}
            </span>
          </div>

          {/* Multi-segment Progress Bar (Image 1 Style) */}
          <div className="mt-3 w-full bg-[var(--color-surface-subtle)] h-2 rounded-full overflow-hidden flex p-0.5 border border-[var(--color-border)]/60">
            {/* 1. System Prompt segment (grey/white) */}
            {sysPct > 0 && (
              <div 
                style={{ width: `${Math.max(1.5, Math.min(100, sysPct))}%` }}
                className="bg-neutral-400 dark:bg-neutral-400 h-full rounded-l-full transition-all"
                title={`系统提示词: ~${formatTokens(system_tokens)}`}
              />
            )}
            {/* 2. Tools definition segment (purple) */}
            {toolsPct > 0 && (
              <div 
                style={{ width: `${Math.max(1, Math.min(100, toolsPct))}%` }}
                className="bg-purple-500 dark:bg-purple-400 h-full transition-all ml-0.5"
                title={`工具: ~${formatTokens(tools_tokens)}`}
              />
            )}
            {/* 3. Messages segment (blue) */}
            {msgPct > 0 && (
              <div 
                style={{ width: `${Math.max(1.5, Math.min(100, msgPct))}%` }}
                className="bg-blue-500 dark:bg-sky-400 h-full transition-all ml-0.5"
                title={`对话消息: ~${formatTokens(messages_tokens)}`}
              />
            )}
            {/* 4. Compressed Summary segment (amber, if present) */}
            {sumPct > 0 && (
              <div 
                style={{ width: `${Math.max(1.5, Math.min(100, sumPct))}%` }}
                className="bg-amber-500 dark:bg-amber-400 h-full rounded-r-full transition-all ml-0.5"
                title={`历史摘要: ~${formatTokens(summary_tokens)}`}
              />
            )}
          </div>

          {/* Detailed Breakdown List (Replicating Image 1 Legend) */}
          <div className="mt-4 space-y-2.5 text-xs font-mono">
            {/* System Prompt */}
            <div className="flex items-center justify-between text-[var(--color-neutral-8)]">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-sm bg-neutral-400 dark:bg-neutral-400 shrink-0" />
                <span className="text-[var(--color-neutral-7)]">系统提示词</span>
              </div>
              <span className="font-medium text-[var(--color-neutral-9)]">
                ~{formatTokens(system_tokens)}
              </span>
            </div>

            {/* Tools Schema */}
            <div className="flex items-center justify-between text-[var(--color-neutral-8)]">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-sm bg-purple-500 dark:bg-purple-400 shrink-0" />
                <span className="text-[var(--color-neutral-7)]">工具</span>
              </div>
              <span className="font-medium text-[var(--color-neutral-9)]">
                ~{formatTokens(tools_tokens)}
              </span>
            </div>

            {/* Conversation Messages */}
            <div className="flex items-center justify-between text-[var(--color-neutral-8)]">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-sm bg-blue-500 dark:bg-sky-400 shrink-0" />
                <span className="text-[var(--color-neutral-7)]">对话消息</span>
              </div>
              <span className="font-medium text-[var(--color-neutral-9)]">
                ~{formatTokens(messages_tokens)}
              </span>
            </div>

            {/* Compressed Context Summary (if exists) */}
            {summary_tokens > 0 && (
              <div className="flex items-center justify-between text-[var(--color-neutral-8)]">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 dark:bg-amber-400 shrink-0" />
                  <span className="text-[var(--color-neutral-7)]">历史记忆摘要</span>
                </div>
                <span className="font-medium text-amber-600 dark:text-amber-400">
                  ~{formatTokens(summary_tokens)}
                </span>
              </div>
            )}
          </div>

          {/* Action & Strategy Footer */}
          <div className="mt-4 pt-3 border-t border-[var(--color-border)]/60 flex flex-col gap-2">
            {/* Auto Compression Status Hint */}
            <div className="flex items-center justify-between text-[11px] text-[var(--color-neutral-6)] font-mono">
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3 h-3" />
                <span>超 50% 自动智能压缩</span>
              </span>
              <span className="text-[10px] text-[var(--color-neutral-4)]">
                阈值: ~{formatTokens(Math.round(safeLimit * 0.5))}
              </span>
            </div>

            {/* Manual Compress Action Button */}
            {onCompress && (
              <button
                type="button"
                onClick={() => {
                  onCompress();
                }}
                disabled={isCompressing || messages_tokens < 200}
                className="w-full mt-1 py-1.5 px-3 rounded-lg bg-[var(--color-accent-soft)] hover:bg-[var(--color-accent)]/15 text-[var(--color-accent)] border border-[var(--color-accent-border)] text-xs font-mono font-medium flex items-center justify-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title={messages_tokens < 200 ? "对话内容较少，暂无需压缩" : "调用大模型将早期历史对话提炼为核心记忆摘要"}
              >
                {isCompressing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>正在提炼核心记忆摘要...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>立即压缩上下文</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
