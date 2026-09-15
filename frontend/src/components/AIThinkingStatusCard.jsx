import React, { useState, useEffect } from 'react';
import { 
  BrainCircuit, 
  Sparkles, 
  Database, 
  Search, 
  Square, 
  AlertCircle, 
  RotateCw,
  Clock
} from 'lucide-react';

export default function AIThinkingStatusCard({
  streamStatus = 'synthesizing',
  statusMessage = '',
  startedAt = null,
  isStreaming = false,
  hasContent = false,
  toolCalls = [],
  references = [],
  onStop = null,
  onRetry = null,
  compact = false
}) {
  const [elapsed, setElapsed] = useState(() => {
    if (!startedAt) return '0.0';
    return Math.max(0, ((Date.now() - startedAt) / 1000)).toFixed(1);
  });

  useEffect(() => {
    if (!isStreaming || !startedAt) return;
    
    // Tick timer every 100ms for smooth live seconds feel
    const timer = setInterval(() => {
      const sec = Math.max(0, ((Date.now() - startedAt) / 1000)).toFixed(1);
      setElapsed(sec);
    }, 100);

    return () => clearInterval(timer);
  }, [isStreaming, startedAt]);

  const elapsedNum = parseFloat(elapsed) || 0;

  // Determine stage title & description
  let stageTitle = '大模型正在深度思考并组织回答...';
  let StageIcon = Sparkles;
  let iconColor = 'text-[var(--color-accent)]';
  let badgeBg = 'bg-[var(--color-accent-soft)]';
  let borderColor = 'border-[var(--color-accent-border)]';

  if (streamStatus === 'tool_executing') {
    stageTitle = statusMessage || '正在自主调用工具检索系统真实数据...';
    StageIcon = Database;
    iconColor = 'text-blue-500';
    badgeBg = 'bg-blue-50 dark:bg-blue-950/40';
    borderColor = 'border-blue-200 dark:border-blue-800/40';
  } else if (streamStatus === 'analyzing') {
    stageTitle = statusMessage || '正在分析问题意图并匹配上下文...';
    StageIcon = Search;
    iconColor = 'text-amber-500';
    badgeBg = 'bg-amber-50 dark:bg-amber-950/40';
    borderColor = 'border-amber-200 dark:border-amber-800/40';
  } else if (streamStatus === 'thinking') {
    stageTitle = statusMessage || '大模型正在进行深度推理与逻辑验证...';
    StageIcon = BrainCircuit;
    iconColor = 'text-purple-500';
    badgeBg = 'bg-purple-50 dark:bg-purple-950/40';
    borderColor = 'border-purple-200 dark:border-purple-800/40';
  } else if (streamStatus === 'synthesizing') {
    stageTitle = statusMessage || (
      toolCalls.length > 0 
        ? `检索已就绪（${references.length > 0 ? `引用 ${references.length} 项数据` : '已查询真实数据库'}），大模型正在深度思考并组织回答...`
        : '正在深度研讨并综合组织回答...'
    );
    StageIcon = Sparkles;
    iconColor = 'text-[var(--color-accent)]';
    badgeBg = 'bg-[var(--color-accent-soft)]';
    borderColor = 'border-[var(--color-accent-border)]';
  } else if (streamStatus === 'generating') {
    stageTitle = '正在流式输出最终回答...';
    StageIcon = Sparkles;
    iconColor = 'text-emerald-500';
    badgeBg = 'bg-emerald-50 dark:bg-emerald-950/40';
    borderColor = 'border-emerald-200 dark:border-emerald-800/40';
  } else if (streamStatus === 'stopped') {
    stageTitle = '已由用户停止生成';
    StageIcon = Square;
    iconColor = 'text-neutral-500';
    badgeBg = 'bg-neutral-100 dark:bg-neutral-800/50';
    borderColor = 'border-neutral-200 dark:border-neutral-700/50';
  } else if (streamStatus === 'error') {
    stageTitle = statusMessage || '生成中断或服务连接异常';
    StageIcon = AlertCircle;
    iconColor = 'text-rose-500';
    badgeBg = 'bg-rose-50 dark:bg-rose-950/40';
    borderColor = 'border-rose-200 dark:border-rose-800/40';
  }

  // If content is already present and streaming, render a compact status bar
  if (hasContent && isStreaming) {
    return (
      <div className="mt-2 pt-2 border-t border-[var(--color-border)]/50 flex items-center justify-between text-[11px] font-mono text-[var(--color-neutral-6)] animate-in fade-in duration-150">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-accent)] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--color-accent)]" />
          </span>
          <span className="text-[var(--color-neutral-8)] font-sans">
            AI 正在生成回答
          </span>
          <span className="text-[10px] text-[var(--color-neutral-5)]">
            (已耗时 {elapsed}s)
          </span>
        </div>

        {onStop && (
          <button
            type="button"
            onClick={onStop}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono text-[var(--color-neutral-6)] hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
            title="中止回答生成"
          >
            <Square className="w-2.5 h-2.5" />
            <span>停止</span>
          </button>
        )}
      </div>
    );
  }

  // If stopped or errored and content is empty or short, show clear card
  if (streamStatus === 'stopped' || streamStatus === 'error') {
    return (
      <div className={`my-2 p-3 rounded-xl border ${borderColor} ${badgeBg} space-y-2 animate-in fade-in duration-200 text-xs`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-mono">
            <StageIcon className={`w-4 h-4 ${iconColor} shrink-0`} />
            <span className="font-medium text-[var(--color-neutral-9)]">
              {stageTitle}
            </span>
          </div>
          {elapsedNum > 0 && (
            <span className="text-[10px] font-mono text-[var(--color-neutral-5)]">
              耗时 {elapsed}s
            </span>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-accent)] text-xs font-mono text-[var(--color-neutral-8)] hover:text-[var(--color-accent)] shadow-2xs transition-all cursor-pointer"
            >
              <RotateCw className="w-3 h-3" />
              <span>重新生成回答</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // Active Thinking / Synthesizing full indicator card (before content starts streaming)
  return (
    <div className={`my-2.5 p-3.5 rounded-xl border ${borderColor} ${badgeBg} shadow-2xs transition-all animate-in fade-in duration-200`}>
      {/* Top Header Row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative shrink-0">
            <StageIcon className={`w-4 h-4 ${iconColor} animate-pulse`} />
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-ping" />
          </div>

          <div className="min-w-0">
            <div className="text-xs font-serif font-medium text-[var(--color-neutral-9)] truncate">
              {stageTitle}
            </div>
          </div>
        </div>

        {/* Live Elapsed Seconds Badge & Stop Button */}
        <div className="flex items-center gap-2 shrink-0 font-mono text-[11px]">
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--color-surface)]/80 border border-[var(--color-border)]/60 text-[var(--color-neutral-7)] tabular-nums shadow-2xs">
            <Clock className="w-3 h-3 text-[var(--color-accent)] shrink-0 animate-spin" style={{ animationDuration: '4s' }} />
            <span>{elapsed}s</span>
          </div>

          {onStop && (
            <button
              type="button"
              onClick={onStop}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--color-surface)] hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-[var(--color-border)] hover:border-rose-300 text-rose-600 text-[10px] transition-colors cursor-pointer"
              title="中止思考与生成"
            >
              <Square className="w-2.5 h-2.5" />
              <span>中止</span>
            </button>
          )}
        </div>
      </div>

      {/* Pulsing Visual Wave Line */}
      <div className="mt-2.5 flex items-center gap-1.5">
        <div className="flex-1 h-1 rounded-full bg-[var(--color-border)]/40 overflow-hidden relative">
          <div className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-[var(--color-accent)] to-transparent" 
               style={{
                 animation: 'pulse 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite'
               }}
          />
        </div>
      </div>

      {/* Long-query Reassurance Hint */}
      {elapsedNum >= 14 && (
        <div className="mt-2.5 pt-2 border-t border-[var(--color-border)]/60 flex items-start gap-1.5 text-[11px] font-sans text-[var(--color-neutral-6)] leading-relaxed animate-in fade-in duration-300">
          <span className="shrink-0 text-amber-500">💡</span>
          <span>
            {elapsedNum >= 30
              ? '模型分析处理数据耗时较长，请继续耐心等待；若网络不稳定，亦可随时点击右侧「中止」后点击「重新生成」。'
              : '大模型正在深入阅读检索出的邮件正文并提炼准确结论，思考中请稍候...'}
          </span>
        </div>
      )}
    </div>
  );
}
