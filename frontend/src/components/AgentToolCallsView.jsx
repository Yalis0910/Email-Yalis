import React, { useState } from 'react';
import { Wrench, ChevronDown, ChevronRight, CheckCircle2, Loader2, Database, Mail, User, CreditCard, Paperclip, Globe, FileText, Award, BookOpen } from 'lucide-react';

const TOOL_ICONS = {
  search_emails: Mail,
  read_email_detail: FileText,
  get_contact_info: User,
  query_subscriptions: CreditCard,
  query_digital_assets: Database,
  inspect_attachment: Paperclip,
  search_web: Globe,
  query_customer_tier: Award,
  search_sales_playbook: BookOpen
};

const TOOL_NAMES = {
  search_emails: '检索往来邮件',
  read_email_detail: '读取邮件正文详情',
  get_contact_info: '查询联系人档案',
  query_subscriptions: '查询财务与订阅',
  query_digital_assets: '查询数字资产平台',
  inspect_attachment: '解析附件内容',
  search_web: '互联网外部检索',
  query_customer_tier: '查询客户评级',
  search_sales_playbook: '检索外贸对策库'
};

export default function AgentToolCallsView({ toolCalls = [] }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!toolCalls || toolCalls.length === 0) return null;

  const isAnyRunning = toolCalls.some(t => t.status === 'running');

  return (
    <div className="mb-2.5 rounded-md border border-[var(--color-border)]/80 bg-[var(--color-surface)]/80 text-[11px] overflow-hidden shadow-2xs">
      {/* Header Bar */}
      <button
        type="button"
        onClick={() => setIsExpanded(prev => !prev)}
        className="w-full px-2.5 py-1.5 flex items-center justify-between text-[var(--color-neutral-7)] hover:bg-[var(--color-surface-subtle)] transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-1.5 font-mono">
          {isAnyRunning ? (
            <Loader2 className="w-3.5 h-3.5 text-[var(--color-accent)] animate-spin" />
          ) : (
            <Wrench className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          )}
          <span className="font-medium text-[var(--color-neutral-8)]">
            {isAnyRunning
              ? 'Agent 正在自主调用工具查询数据库...'
              : `已调用 ${toolCalls.length} 个工具查询真实数据`}
          </span>
        </div>

        <div className="flex items-center gap-1 text-[var(--color-neutral-5)]">
          <span className="text-[10px] font-sans">
            {isExpanded ? '收起' : '展开详情'}
          </span>
          {isExpanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </div>
      </button>

      {/* Expanded Details or Running State */}
      {(isExpanded || isAnyRunning) && (
        <div className="px-2.5 py-2 border-t border-[var(--color-border)]/60 bg-[var(--color-surface-subtle)]/40 space-y-1.5 font-mono">
          {toolCalls.map((tool, idx) => {
            const Icon = TOOL_ICONS[tool.tool_name] || Database;
            const friendlyName = TOOL_NAMES[tool.tool_name] || tool.tool_name;

            return (
              <div
                key={tool.id || idx}
                className="flex items-start justify-between gap-2 p-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)]/50"
              >
                <div className="flex items-start gap-1.5 min-w-0">
                  <div className="mt-0.5 shrink-0">
                    {tool.status === 'running' ? (
                      <Loader2 className="w-3 h-3 text-[var(--color-accent)] animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                    )}
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <Icon className="w-3 h-3 text-[var(--color-neutral-6)]" />
                      <span className="font-semibold text-[var(--color-neutral-9)]">
                        {friendlyName}
                      </span>
                      <span className="text-[9px] text-[var(--color-neutral-5)] px-1 rounded bg-[var(--color-surface-subtle)]">
                        {tool.tool_name}
                      </span>
                    </div>

                    {tool.summary && (
                      <div className="text-[10px] text-[var(--color-neutral-7)] font-sans">
                        {tool.summary}
                      </div>
                    )}

                    {tool.args && Object.keys(tool.args).length > 0 && (
                      <div className="text-[9px] text-[var(--color-neutral-5)] truncate max-w-[340px]">
                        入参: {JSON.stringify(tool.args)}
                      </div>
                    )}
                  </div>
                </div>

                <div className="shrink-0 text-[9px] font-sans">
                  {tool.status === 'running' ? (
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 font-medium">执行中</span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 font-medium">已完成</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
