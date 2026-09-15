import React, { useState } from 'react';
import { Search, ChevronDown, ChevronRight, CheckCircle2, Loader2, Database, Paperclip, ExternalLink, Mail } from 'lucide-react';

const TOOL_DISPLAY_CONFIG = {
  search_emails: { label: '检索本地邮件库', icon: Mail },
  inspect_attachment: { label: '深度解析附件', icon: Paperclip },
  get_contact_info: { label: '获取联系人画像', icon: Database },
  query_subscriptions: { label: '查询 SaaS 订阅', icon: Database },
  query_digital_assets: { label: '查询数字资产', icon: Database },
  search_web: { label: '互联网外部检索', icon: Search }
};

/**
 * DeepSeekToolPill
 * Recreates DeepSeek's signature compact search / tool execution pill:
 * - Collapsed single-line pill: "🔍 已调用 3 个工具检索数据 展开 v"
 * - Expandable clean drawer showing each tool call, keyword query, and results
 */
export default function DeepSeekToolPill({
  toolCalls = [],
  references = [],
  isStreaming = false,
  hasContent = false,
  className = ''
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!toolCalls || toolCalls.length === 0) return null;

  const totalCalls = toolCalls.length;
  // All done if message is no longer actively streaming, has answer content, or all tool calls are finished
  const isAllDone = (!isStreaming || hasContent) || toolCalls.every(tc => 
    tc.status === 'completed' || tc.status === 'done' || tc.result || tc.summary
  );

  return (
    <div className={`my-2 select-text font-sans text-xs ${className}`}>
      {/* DeepSeek Style Minimalist Pill Button */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="group inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-subtle)] hover:bg-[var(--color-surface)] hover:border-[var(--color-accent-border)] text-[var(--color-neutral-7)] hover:text-[var(--color-neutral-10)] transition-all cursor-pointer shadow-2xs"
      >
        <div className="flex items-center gap-1.5">
          {!isAllDone ? (
            <Loader2 className="w-3.5 h-3.5 text-[var(--color-accent)] animate-spin" />
          ) : (
            <Search className="w-3.5 h-3.5 text-[var(--color-accent)]" />
          )}
          <span className="font-medium">
            {isAllDone ? `已调用 ${totalCalls} 个工具检索真实数据` : `正在调用工具检索本地数据 (${totalCalls})...`}
          </span>
          {references.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)] text-[10px] font-mono font-medium">
              引用 {references.length} 项
            </span>
          )}
        </div>

        <span className="text-[11px] text-[var(--color-neutral-5)] group-hover:text-[var(--color-neutral-8)] flex items-center gap-0.5 ml-1">
          {isExpanded ? (
            <>
              <span>收起</span>
              <ChevronDown className="w-3.5 h-3.5" />
            </>
          ) : (
            <>
              <span>展开明细</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </>
          )}
        </span>
      </button>

      {/* Expanded Tool Details Card */}
      {isExpanded && (
        <div className="mt-2.5 p-3 rounded-xl bg-[var(--color-surface-subtle)]/70 border border-[var(--color-border)] space-y-2 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="text-[11px] font-mono text-[var(--color-neutral-5)] mb-1 flex items-center justify-between border-b border-[var(--color-border)]/50 pb-1.5">
            <span>本地系统调用的智能体工具清单:</span>
            <span>共 {toolCalls.length} 次操作</span>
          </div>

          <div className="space-y-1.5">
            {toolCalls.map((tc, idx) => {
              const cfg = TOOL_DISPLAY_CONFIG[tc.tool_name] || { label: tc.tool_name, icon: Database };
              const IconComponent = cfg.icon;
              const isExecuting = !isAllDone && tc.status === 'running' && !tc.result && !tc.summary && tc.status !== 'completed' && tc.status !== 'done';

              return (
                <div
                  key={tc.id || idx}
                  className="p-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] flex items-start gap-2.5 text-xs text-[var(--color-neutral-8)]"
                >
                  <div className="mt-0.5 shrink-0">
                    {isExecuting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--color-accent)]" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[var(--color-neutral-9)] flex items-center gap-1">
                        <IconComponent className="w-3 h-3 text-[var(--color-neutral-5)]" />
                        {cfg.label}
                      </span>
                      <span className="text-[10px] font-mono text-[var(--color-neutral-4)]">
                        {tc.tool_name}
                      </span>
                    </div>

                    {/* Arguments & Keywords */}
                    {tc.args && Object.keys(tc.args).length > 0 && (
                      <div className="mt-1 text-[11px] font-mono text-[var(--color-neutral-6)] flex items-center gap-1.5 flex-wrap">
                        {tc.args.keywords && (
                          <span className="px-1.5 py-0.5 rounded bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[var(--color-neutral-7)]">
                            关键词: <span className="font-semibold text-[var(--color-neutral-9)]">{tc.args.keywords}</span>
                          </span>
                        )}
                        {tc.args.contact_email && (
                          <span className="px-1.5 py-0.5 rounded bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[var(--color-neutral-7)]">
                            联系人: {tc.args.contact_email}
                          </span>
                        )}
                        {tc.args.query && (
                          <span className="px-1.5 py-0.5 rounded bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[var(--color-neutral-7)]">
                            检索词: {tc.args.query}
                          </span>
                        )}
                        {tc.args.filename && (
                          <span className="px-1.5 py-0.5 rounded bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[var(--color-neutral-7)]">
                            附件: {tc.args.filename}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Result Summary */}
                    {tc.summary && (
                      <div className="mt-1 text-[11px] text-[var(--color-neutral-7)] font-sans">
                        {tc.summary}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
