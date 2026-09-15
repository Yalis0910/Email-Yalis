import React, { useState, useEffect, useRef } from 'react';
import { 
  Flame, 
  AlertTriangle, 
  Clock, 
  Sparkles, 
  ExternalLink, 
  RefreshCw, 
  Copy, 
  Check, 
  X, 
  Send,
  Building,
  User,
  ChevronRight,
  ChevronLeft,
  TrendingUp,
  ShieldAlert
} from 'lucide-react';
import { api, streamSSE } from '../api/client';

const getPageNumbers = (current, total) => {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages = [];
  pages.push(1);
  if (current > 3) {
    pages.push('...');
  }
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) {
    pages.push(i);
  }
  if (current < total - 2) {
    pages.push('...');
  }
  pages.push(total);
  return pages;
};

export default function FollowUpRadarWidget({ selectedAccount, onOpenContactTimeline }) {
  const [radarData, setRadarData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'urgent' | 'warning'
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(4);
  
  // Follow-up Draft Modal State
  const [draftModalContact, setDraftModalContact] = useState(null);
  const [draftContent, setDraftContent] = useState('');
  const [isDrafting, setIsDrafting] = useState(false);
  const [draftCopied, setDraftCopied] = useState(false);
  const [customPromptHint, setCustomPromptHint] = useState('');
  const abortControllerRef = useRef(null);

  useEffect(() => {
    loadRadar();
  }, [selectedAccount]);

  const loadRadar = async () => {
    try {
      setLoading(true);
      const res = await api.getSalesRadar(selectedAccount || null);
      setRadarData(res);
    } catch (err) {
      console.error('Failed to load sales radar:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleStartDraft = async (contact, customHint = '') => {
    setDraftModalContact(contact);
    setDraftContent('');
    setIsDrafting(true);
    setDraftCopied(false);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    let accumulated = '';
    await streamSSE(
      `/api/sales/contacts/${contact.contact_id}/generate-follow-up`,
      { prompt_hint: customHint },
      {
        signal: abortControllerRef.current.signal,
        onChunk: (delta) => {
          accumulated += delta;
          setDraftContent(accumulated);
        },
        onError: (err) => {
          setDraftContent((prev) => prev + `\n\n[生成失败]: ${err}`);
          setIsDrafting(false);
        },
        onDone: () => {
          setIsDrafting(false);
        }
      }
    );
  };

  const handleCopyDraft = () => {
    if (!draftContent) return;
    navigator.clipboard.writeText(draftContent);
    setDraftCopied(true);
    setTimeout(() => setDraftCopied(false), 2000);
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [activeFilter, selectedAccount]);

  const urgentItems = radarData?.urgent_items || [];
  const warningItems = radarData?.warning_items || [];
  
  let displayedItems = [];
  if (activeFilter === 'urgent') {
    displayedItems = urgentItems;
  } else if (activeFilter === 'warning') {
    displayedItems = warningItems;
  } else {
    displayedItems = [...urgentItems, ...warningItems];
  }

  const totalItems = displayedItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const pagedItems = displayedItems.slice(startIndex, endIndex);

  const getTierBadge = (tier) => {
    if (tier === 'A') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
          A 重点战略
        </span>
      );
    }
    if (tier === 'B') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
          B 培育增长
        </span>
      );
    }
    return (
      <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--color-neutral-3)] text-[var(--color-neutral-7)]">
        {tier} 级
      </span>
    );
  };

  return (
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-sm overflow-hidden mb-6 transition-all">
      {/* Header Banner */}
      <div className="px-5 py-4 border-b border-[var(--color-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[var(--color-neutral-2)]/40">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-red-500/10 text-red-500 flex items-center justify-center border border-red-500/20">
            <Flame className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-[var(--color-neutral-10)]">
                客户跟进雷达 (Follow-up Radar)
              </h3>
              <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
                AI 智能流失预警
              </span>
            </div>
            <p className="text-xs text-[var(--color-neutral-6)] mt-0.5">
              实时监测高价值 A/B 类大客户互动周期与停滞商机，防止潜力大单流失
            </p>
          </div>
        </div>

        {/* Action / Refresh */}
        <div className="flex items-center gap-2">
          <button
            onClick={loadRadar}
            disabled={loading}
            className="p-1.5 text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)] hover:bg-[var(--color-neutral-3)] rounded-lg transition-colors text-xs flex items-center gap-1"
            title="刷新雷达数据"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">刷新</span>
          </button>
        </div>
      </div>

      {/* Top Metric Bar */}
      <div className="grid grid-cols-3 divide-x divide-[var(--color-border)] border-b border-[var(--color-border)] bg-[var(--color-card)] text-center py-3">
        <button
          onClick={() => setActiveFilter('urgent')}
          className={`px-3 py-1 hover:bg-[var(--color-neutral-2)] transition-colors flex flex-col items-center ${activeFilter === 'urgent' ? 'font-semibold text-red-600' : 'text-[var(--color-neutral-8)]'}`}
        >
          <span className="text-xs text-[var(--color-neutral-6)] flex items-center gap-1">
            <Flame className="w-3.5 h-3.5 text-red-500" />
            A 类急需跟进
          </span>
          <span className="text-xl font-mono font-bold text-red-600 dark:text-red-400 mt-0.5">
            {loading ? '...' : (radarData?.summary?.a_tier_overdue || 0)}
          </span>
        </button>

        <button
          onClick={() => setActiveFilter('warning')}
          className={`px-3 py-1 hover:bg-[var(--color-neutral-2)] transition-colors flex flex-col items-center ${activeFilter === 'warning' ? 'font-semibold text-blue-600' : 'text-[var(--color-neutral-8)]'}`}
        >
          <span className="text-xs text-[var(--color-neutral-6)] flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5 text-blue-500" />
            B 类需推进跟进
          </span>
          <span className="text-xl font-mono font-bold text-blue-600 dark:text-blue-400 mt-0.5">
            {loading ? '...' : (radarData?.summary?.b_tier_overdue || 0)}
          </span>
        </button>

        <button
          onClick={() => setActiveFilter('all')}
          className={`px-3 py-1 hover:bg-[var(--color-neutral-2)] transition-colors flex flex-col items-center ${activeFilter === 'all' ? 'font-semibold text-[var(--color-accent)]' : 'text-[var(--color-neutral-8)]'}`}
        >
          <span className="text-xs text-[var(--color-neutral-6)] flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-[var(--color-neutral-6)]" />
            全部预警总数
          </span>
          <span className="text-xl font-mono font-bold text-[var(--color-neutral-9)] mt-0.5">
            {loading ? '...' : ((radarData?.total_urgent || 0) + (radarData?.total_warning || 0))}
          </span>
        </button>
      </div>

      {/* List Content */}
      <div className="p-4">
        {loading ? (
          <div className="py-8 text-center text-xs text-[var(--color-neutral-6)] flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-[var(--color-accent)]" />
            正在检索与计算客户跟进雷达...
          </div>
        ) : displayedItems.length === 0 ? (
          <div className="py-8 text-center text-[var(--color-neutral-6)]">
            <ShieldAlert className="w-8 h-8 mx-auto text-emerald-500/60 mb-2" />
            <p className="text-sm font-medium text-[var(--color-neutral-8)]">当前无超期跟进预警！</p>
            <p className="text-xs text-[var(--color-neutral-6)] mt-1">
              所有 A/B 类大客户互动节奏良好，请继续保持。
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {pagedItems.map((item) => (
              <div 
                key={item.contact_id}
                className="p-3.5 rounded-lg border border-[var(--color-border)] hover:border-[var(--color-border-hover)] bg-[var(--color-surface)] hover:shadow-sm transition-all flex flex-col md:flex-row md:items-center justify-between gap-3"
              >
                {/* Contact Identity & Reason */}
                <div className="flex items-start gap-3 min-w-0">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${
                    item.tier === 'A' 
                      ? 'bg-red-500/10 text-red-600 border border-red-500/20' 
                      : 'bg-blue-500/10 text-blue-600 border border-blue-500/20'
                  }`}>
                    {item.name ? item.name.charAt(0).toUpperCase() : <User className="w-4 h-4" />}
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm text-[var(--color-neutral-10)] truncate">
                        {item.name}
                      </span>
                      {getTierBadge(item.tier)}
                      {item.deal_stage && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--color-neutral-3)] text-[var(--color-neutral-7)]">
                          阶段: {item.deal_stage}
                        </span>
                      )}
                      <span className="text-xs text-red-600 dark:text-red-400 font-mono font-medium flex items-center gap-0.5">
                        <Clock className="w-3 h-3" />
                        已沉寂 {item.days_silent} 天
                      </span>
                    </div>

                    <div className="text-xs text-[var(--color-neutral-6)] mt-0.5 flex flex-wrap items-center gap-2">
                      <span className="truncate">{item.email}</span>
                      {item.domain && (
                        <span className="flex items-center gap-1 font-mono">
                          <Building className="w-3 h-3" />
                          {item.domain}
                        </span>
                      )}
                    </div>

                    {/* Alert & Suggestion */}
                    <div className="mt-2 text-xs">
                      <span className="font-medium text-[var(--color-neutral-9)]">
                        {item.radar_reason}
                      </span>
                      {item.action_suggestion && (
                        <span className="text-[var(--color-neutral-6)] block sm:inline sm:ml-2">
                          💡 建议：{item.action_suggestion}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Action Buttons */}
                <div className="flex items-center gap-2 self-end md:self-center flex-shrink-0">
                  {onOpenContactTimeline && (
                    <button
                      onClick={() => onOpenContactTimeline(item.contact_id, {
                        id: item.contact_id,
                        name: item.name,
                        email: item.email,
                        domain: item.domain,
                        tier: item.tier,
                        tier_reason: item.radar_reason,
                        deal_stage: item.deal_stage,
                        estimated_value: item.estimated_value,
                        account_id: item.account_id,
                        last_interaction: item.last_interaction
                      })}
                      className="px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] text-[var(--color-neutral-7)] hover:text-[var(--color-neutral-10)] hover:bg-[var(--color-neutral-2)] transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <span>往来脉络</span>
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  )}

                  <button
                    onClick={() => handleStartDraft(item)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 shadow-sm transition-all flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>一键生成跟进草稿</span>
                  </button>
                </div>
              </div>
            ))}

            {/* Pagination Controls */}
            {totalItems > pageSize && (
              <div className="pt-3 mt-1 border-t border-[var(--color-border)] flex flex-wrap items-center justify-between gap-y-2 gap-x-4 text-xs text-[var(--color-neutral-6)]">
                <div className="flex items-center gap-2 whitespace-nowrap shrink-0">
                  <span>显示第 <strong className="font-mono text-[var(--color-neutral-9)]">{startIndex + 1} - {endIndex}</strong> 条，共 <strong className="font-mono text-[var(--color-neutral-9)]">{totalItems}</strong> 条待跟进</span>
                  <span className="text-[var(--color-neutral-4)]">|</span>
                  <div className="flex items-center gap-1">
                    <span>每页:</span>
                    {[4, 8, 12, 20].map(size => (
                      <button
                        key={size}
                        onClick={() => {
                          setPageSize(size);
                          setCurrentPage(1);
                        }}
                        className={`px-1.5 py-0.5 rounded font-mono text-[11px] transition-colors cursor-pointer ${
                          pageSize === size 
                            ? 'bg-[var(--color-neutral-9)] text-[var(--color-surface)] font-bold' 
                            : 'hover:bg-[var(--color-neutral-2)] text-[var(--color-neutral-6)]'
                        }`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0 ml-auto">
                  <button
                    disabled={safePage <= 1}
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    className="p-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-neutral-2)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-[var(--color-neutral-7)] cursor-pointer"
                    title="上一页"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>

                  <div className="flex items-center gap-1 px-1">
                    {getPageNumbers(safePage, totalPages).map((p, idx) => (
                      p === '...' ? (
                        <span key={`ellipsis-${idx}`} className="px-1 text-[var(--color-neutral-4)] select-none text-xs">...</span>
                      ) : (
                        <button
                          key={p}
                          onClick={() => setCurrentPage(p)}
                          className={`min-w-[24px] h-6 px-1 rounded-md text-xs font-mono transition-colors flex items-center justify-center cursor-pointer ${
                            safePage === p
                              ? 'bg-[var(--color-accent)] text-white font-bold shadow-xs'
                              : 'hover:bg-[var(--color-neutral-2)] text-[var(--color-neutral-7)]'
                          }`}
                        >
                          {p}
                        </button>
                      )
                    ))}
                  </div>

                  <button
                    disabled={safePage >= totalPages}
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    className="p-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-neutral-2)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-[var(--color-neutral-7)] cursor-pointer"
                    title="下一页"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Draft Modal */}
      {draftModalContact && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-neutral-2)]/50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[var(--color-accent)]/10 text-[var(--color-accent)] flex items-center justify-center">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--color-neutral-10)]">
                    针对 {draftModalContact.name} 的智能跟进草稿
                  </h3>
                  <p className="text-xs text-[var(--color-neutral-6)]">
                    已自动融合客户【{draftModalContact.tier}级】画像与销售对策库高转化战术
                  </p>
                </div>
              </div>

              <button
                onClick={() => setDraftModalContact(null)}
                className="p-1 text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)] rounded-lg hover:bg-[var(--color-neutral-3)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              {/* Optional Prompt Refine Bar */}
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="可输入补充要求 (例如: '重点询问样品反馈'、'告知下周原料要涨价5%')..."
                  value={customPromptHint}
                  onChange={(e) => setCustomPromptHint(e.target.value)}
                  className="flex-1 text-xs px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-neutral-1)] focus:outline-hidden focus:border-[var(--color-accent)]"
                />
                <button
                  disabled={isDrafting}
                  onClick={() => handleStartDraft(draftModalContact, customPromptHint)}
                  className="px-3 py-2 text-xs rounded-lg bg-[var(--color-neutral-3)] hover:bg-[var(--color-neutral-4)] text-[var(--color-neutral-8)] transition-colors flex items-center gap-1"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isDrafting ? 'animate-spin' : ''}`} />
                  重新生成
                </button>
              </div>

              {/* Draft Box */}
              <div className="relative rounded-xl border border-[var(--color-border)] bg-[var(--color-neutral-1)] p-4 min-h-[220px]">
                {draftContent ? (
                  <pre className="text-xs font-sans text-[var(--color-neutral-9)] whitespace-pre-wrap leading-relaxed select-text">
                    {draftContent}
                  </pre>
                ) : (
                  <div className="h-40 flex items-center justify-center text-xs text-[var(--color-neutral-5)] gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-[var(--color-accent)]" />
                    正在调阅往来邮件脉络并起草破冰邮件...
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-[var(--color-border)] flex items-center justify-between bg-[var(--color-neutral-2)]/30">
              <span className="text-xs text-[var(--color-neutral-6)]">
                {isDrafting ? 'AI 正在流式输出中...' : '起草完成，可一键复制至邮箱发信'}
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setDraftModalContact(null)}
                  className="px-3 py-1.5 text-xs text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)] rounded-lg hover:bg-[var(--color-neutral-3)] transition-colors"
                >
                  关闭
                </button>

                <button
                  onClick={handleCopyDraft}
                  disabled={!draftContent || isDrafting}
                  className="px-4 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 shadow-sm flex items-center gap-1.5 transition-all"
                >
                  {draftCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{draftCopied ? '已复制草稿' : '复制邮件草稿'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
