import React, { useState, useEffect, useMemo } from 'react';
import { 
  Sparkles, 
  RefreshCw, 
  Copy, 
  Check, 
  Search, 
  Users, 
  Clock, 
  PanelRightClose, 
  X, 
  FileText, 
  Tag, 
  AlertCircle,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  UserCheck,
  Briefcase,
  ListTodo
} from 'lucide-react';
import { api } from '../api/client';
import MarkdownRenderer from './MarkdownRenderer';

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr.replace(' ', 'T'));
  if (isNaN(date.getTime())) return dateStr;
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return '刚刚';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}小时前`;
  if (diffSec < 86400 * 2) return '昨天';
  
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${m}-${d}`;
}

export default function ContactAIReportDrawer({
  currentContact,
  isOpen,
  onClose,
  onSelectContact,
  isGenerating,
  streamingReportText,
  onRegenerate,
  cachedReport,
  selectedAccount,
  sortBy = 'weight'
}) {
  const [summarizedList, setSummarizedList] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [copied, setCopied] = useState(false);
  const [currentSortBy, setCurrentSortBy] = useState(sortBy);

  useEffect(() => {
    if (sortBy) {
      setCurrentSortBy(sortBy);
    }
  }, [sortBy]);

  // Load summarized contacts list whenever drawer is opened or report changes
  useEffect(() => {
    if (isOpen) {
      loadSummarizedContacts(currentSortBy);
    }
  }, [isOpen, cachedReport, isGenerating, currentSortBy, selectedAccount]);

  const loadSummarizedContacts = async (sortOrder = currentSortBy) => {
    try {
      setListLoading(true);
      const res = await api.getSummarizedContacts(selectedAccount || undefined, sortOrder);
      setSummarizedList(res.items || []);
    } catch (err) {
      console.error('Failed to load summarized contacts:', err);
    } finally {
      setListLoading(false);
    }
  };

  const sortedAndFilteredList = useMemo(() => {
    let list = [...summarizedList];
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      list = list.filter(item => 
        (item.name && item.name.toLowerCase().includes(q)) ||
        (item.email && item.email.toLowerCase().includes(q)) ||
        (item.domain && item.domain.toLowerCase().includes(q))
      );
    }
    list.sort((a, b) => {
      if (currentSortBy === 'recent') {
        const timeA = new Date(a.last_interaction || a.updated_at || 0).getTime();
        const timeB = new Date(b.last_interaction || b.updated_at || 0).getTime();
        return timeB - timeA;
      } else {
        const countA = (a.inbound_count || 0) + (a.outbound_count || 0);
        const countB = (b.inbound_count || 0) + (b.outbound_count || 0);
        if (countB !== countA) return countB - countA;
        return (b.weight || 0) - (a.weight || 0);
      }
    });
    return list;
  }, [summarizedList, searchFilter, currentSortBy]);

  if (!isOpen) return null;

  const currentDisplayName = currentContact?.name || currentContact?.email?.split('@')[0] || '联系人';
  const displayReportText = isGenerating ? streamingReportText : (cachedReport?.report_markdown || '');

  const handleCopy = () => {
    if (!displayReportText) return;
    navigator.clipboard.writeText(displayReportText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Helper to render markdown sections with icons
  const renderStructuredReport = (text) => {
    if (!text) return null;
    
    // Split by `### `
    const rawSections = text.split(/(?=^###\s+)/m);
    
    if (rawSections.length <= 1 && isGenerating) {
      return (
        <div className="p-4 bg-[var(--color-surface-subtle)]/60 rounded-xl border border-[var(--color-border)]">
          <MarkdownRenderer content={text} />
          <span className="inline-block w-1.5 h-4 ml-1 bg-[var(--color-accent)] animate-pulse align-middle" />
        </div>
      );
    }

    // If no headings found, render whole content directly via MarkdownRenderer
    if (rawSections.length <= 1) {
      return (
        <div className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xs">
          <MarkdownRenderer content={text} />
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {rawSections.map((section, idx) => {
          const trimmed = section.trim();
          if (!trimmed) return null;

          const lines = trimmed.split('\n');
          const headingLine = lines[0].replace(/^###\s+/, '').trim();
          const bodyLines = lines.slice(1).join('\n').trim();

          // Icon based on section title
          let SectionIcon = FileText;
          let badgeColor = 'text-[var(--color-neutral-7)] bg-[var(--color-surface-subtle)] border-[var(--color-border)]';
          
          if (headingLine.includes('画像') || headingLine.includes('角色')) {
            SectionIcon = UserCheck;
            badgeColor = 'text-rose-700 bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:border-rose-900/40 dark:text-rose-300';
          } else if (headingLine.includes('历程') || headingLine.includes('阶段') || headingLine.includes('演进')) {
            SectionIcon = TrendingUp;
            badgeColor = 'text-blue-700 bg-blue-50 border-blue-200 dark:bg-blue-950/40 dark:border-blue-900/40 dark:text-blue-300';
          } else if (headingLine.includes('议题') || headingLine.includes('讨论点')) {
            SectionIcon = Tag;
            badgeColor = 'text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-900/40 dark:text-amber-300';
          } else if (headingLine.includes('资产') || headingLine.includes('交易') || headingLine.includes('账单')) {
            SectionIcon = Briefcase;
            badgeColor = 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-900/40 dark:text-emerald-300';
          } else if (headingLine.includes('待办') || headingLine.includes('建议') || headingLine.includes('跟进')) {
            SectionIcon = ListTodo;
            badgeColor = 'text-purple-700 bg-purple-50 border-purple-200 dark:bg-purple-950/40 dark:border-purple-900/40 dark:text-purple-300';
          }

          return (
            <div 
              key={idx}
              className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xs transition-all hover:border-[var(--color-neutral-4)]"
            >
              <div className="flex items-center gap-2 mb-2.5 pb-2 border-b border-[var(--color-border)]/60">
                <span className={`p-1 rounded-md border ${badgeColor}`}>
                  <SectionIcon className="w-3.5 h-3.5" />
                </span>
                <h4 className="text-xs sm:text-sm font-serif font-medium text-[var(--color-neutral-10)] tracking-tight">
                  {headingLine}
                </h4>
              </div>

              <div className="text-xs sm:text-[13px] text-[var(--color-neutral-8)]">
                {bodyLines ? (
                  <MarkdownRenderer content={bodyLines} />
                ) : (
                  <span className="text-[var(--color-neutral-5)] italic">（提炼中...）</span>
                )}
              </div>
            </div>
          );
        })}
        {isGenerating && (
          <div className="flex items-center gap-2 py-2 text-xs font-mono text-[var(--color-accent)]">
            <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-ping" />
            <span>AI 正在继续撰写报告分析...</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div 
      className="w-full sm:w-[620px] md:w-[700px] lg:w-[760px] bg-[var(--color-surface)] border-l border-[var(--color-border)] shadow-2xl h-full flex flex-row overflow-hidden animate-in slide-in-from-right duration-200 cursor-default shrink-0 z-10"
      onClick={(e) => e.stopPropagation()}
    >
      {/* ================= Master Column: Summarized Contacts List ================= */}
      <div className="w-56 sm:w-64 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface-subtle)]/70 flex flex-col h-full select-none">
        {/* Master Header */}
        <div className="p-3.5 border-b border-[var(--color-border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[var(--color-accent)]" />
            <h3 className="text-xs font-serif font-medium text-[var(--color-neutral-9)]">
              已总结联系人
            </h3>
          </div>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-7)]">
            {summarizedList.length}
          </span>
        </div>

        {/* Master Sort Switcher */}
        <div className="px-3 py-1.5 border-b border-[var(--color-border)]/60 bg-[var(--color-surface-subtle)] flex items-center justify-between text-xs font-mono">
          <span className="text-[10px] text-[var(--color-neutral-6)]">排序:</span>
          <div className="inline-flex p-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[10px]">
            <button
              onClick={() => setCurrentSortBy('weight')}
              className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                currentSortBy === 'weight'
                  ? 'bg-[var(--color-accent)] text-white shadow-2xs font-medium'
                  : 'text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)]'
              }`}
            >
              按频次
            </button>
            <button
              onClick={() => setCurrentSortBy('recent')}
              className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                currentSortBy === 'recent'
                  ? 'bg-[var(--color-accent)] text-white shadow-2xs font-medium'
                  : 'text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)]'
              }`}
            >
              按最近
            </button>
          </div>
        </div>

        {/* Master Search Filter */}
        <div className="p-2.5 border-b border-[var(--color-border)]/60">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-neutral-5)]" />
            <input
              type="text"
              placeholder="过滤已总结人选..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-9)] text-xs rounded-md pl-8 pr-2 py-1 outline-none focus:border-[var(--color-accent)] transition-colors placeholder:text-[var(--color-neutral-5)]"
            />
          </div>
        </div>

        {/* Master List */}
        <div className="flex-1 overflow-y-auto divide-y divide-[var(--color-border)]/40 p-1.5 space-y-0.5">
          {listLoading && summarizedList.length === 0 ? (
            <div className="py-16 text-center text-xs font-mono text-[var(--color-neutral-5)]">
              <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-2 text-[var(--color-accent)]" />
              <span>加载中...</span>
            </div>
          ) : sortedAndFilteredList.length === 0 ? (
            <div className="py-16 text-center text-xs font-serif text-[var(--color-neutral-5)] px-4">
              {searchFilter ? '未匹配到相关联系人' : '暂无已总结的联系人记录'}
            </div>
          ) : (
            sortedAndFilteredList.map((item) => {
              const isSelected = item.contact_id === currentContact?.id;
              const displayName = item.name || item.email.split('@')[0];
              const letter = displayName.slice(0, 1).toUpperCase();

              return (
                <div
                  key={item.contact_id}
                  onClick={() => onSelectContact && onSelectContact(item)}
                  className={`group p-2 rounded-lg cursor-pointer transition-all flex items-center justify-between ${
                    isSelected
                      ? 'bg-[var(--color-surface)] border border-[var(--color-accent-border)] shadow-xs'
                      : 'hover:bg-[var(--color-surface)]/70 text-[var(--color-neutral-8)]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-1">
                    <div className={`w-8 h-8 rounded-full border flex items-center justify-center font-serif text-xs font-medium shrink-0 ${
                      isSelected
                        ? 'bg-[var(--color-accent-soft)] border-[var(--color-accent)] text-[var(--color-accent)]'
                        : 'bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-neutral-7)]'
                    }`}>
                      {letter}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-medium truncate ${isSelected ? 'text-[var(--color-accent)]' : 'text-[var(--color-neutral-9)]'}`}>
                          {displayName}
                        </span>
                        <span className="text-[9px] font-mono text-[var(--color-neutral-5)] shrink-0 ml-1">
                          {currentSortBy === 'weight'
                            ? `${(item.inbound_count || 0) + (item.outbound_count || 0)} 封`
                            : (item.last_interaction ? item.last_interaction.slice(5, 10) : formatRelativeTime(item.updated_at))
                          }
                        </span>
                      </div>

                      <div className="text-[10px] font-mono text-[var(--color-neutral-5)] truncate mt-0.5">
                        {item.domain || item.email}
                      </div>

                      {item.summary_tags && item.summary_tags.length > 0 && (
                        <div className="flex items-center gap-1 mt-1 overflow-hidden">
                          {item.summary_tags.slice(0, 2).map((tag, tIdx) => (
                            <span 
                              key={tIdx}
                              className="px-1 py-0.2 rounded text-[9px] font-mono bg-[var(--color-surface-subtle)] text-[var(--color-neutral-6)] border border-[var(--color-border)] truncate max-w-[80px]"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform ${
                    isSelected 
                      ? 'text-[var(--color-accent)] translate-x-0.5' 
                      : 'text-[var(--color-neutral-4)] group-hover:text-[var(--color-neutral-7)]'
                  }`} />
                </div>
              );
            })
          )}
        </div>

        {/* Master Footer */}
        <div className="p-2.5 border-t border-[var(--color-border)] text-center text-[10px] font-mono text-[var(--color-neutral-5)]">
          共 {summarizedList.length} 位已归档画像
        </div>
      </div>

      {/* ================= Detail Column: Selected Contact AI Report ================= */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--color-surface)]">
        {/* Detail Header */}
        <div className="p-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-[var(--color-accent-soft)] border border-[var(--color-accent-border)] flex items-center justify-center font-serif text-base font-medium text-[var(--color-accent)] shrink-0">
              {currentDisplayName.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-serif font-medium text-[var(--color-neutral-10)] truncate" title={currentDisplayName}>
                  {currentDisplayName}
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/20 shrink-0">
                  AI 深度画像报告
                </span>
              </div>
              <p className="text-[11px] font-mono text-[var(--color-neutral-6)] mt-0.5 truncate">
                {currentContact?.email}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Copy button */}
            {displayReportText && (
              <button
                onClick={handleCopy}
                className="p-1.5 rounded-md border border-[var(--color-border)] text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)] hover:bg-[var(--color-surface-subtle)] transition-colors text-xs flex items-center gap-1"
                title="复制整篇报告文本"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline font-mono text-[11px]">{copied ? '已复制' : '复制'}</span>
              </button>
            )}

            {/* Regenerate button */}
            <button
              onClick={onRegenerate}
              disabled={isGenerating}
              className="p-1.5 rounded-md border border-[var(--color-border)] text-[var(--color-neutral-6)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent-border)] hover:bg-[var(--color-surface-subtle)] transition-colors text-xs flex items-center gap-1 disabled:opacity-50"
              title="重新向大模型请求分析"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin text-[var(--color-accent)]' : ''}`} />
              <span className="hidden sm:inline font-mono text-[11px]">{isGenerating ? '生成中' : '重新生成'}</span>
            </button>

            {/* Collapse only report panel */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-[var(--color-neutral-5)] hover:text-[var(--color-neutral-9)] hover:bg-[var(--color-surface-subtle)] transition-colors ml-1"
              title="仅收起此报告面板（保留右侧时间线）"
            >
              <PanelRightClose className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Metadata info bar */}
        <div className="px-4 py-2 border-b border-[var(--color-border)]/60 bg-[var(--color-surface-subtle)]/40 flex items-center justify-between text-[11px] font-mono text-[var(--color-neutral-6)] shrink-0">
          <div className="flex items-center gap-2">
            <Clock className="w-3 h-3 text-[var(--color-neutral-5)]" />
            <span>报告生成时间: {cachedReport?.updated_at || '实时生成中'}</span>
          </div>
          {cachedReport?.model_name && (
            <div className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-7)]">
              模型: {cachedReport.model_name}
            </div>
          )}
        </div>

        {/* Detail Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {isGenerating && !streamingReportText ? (
            <div className="py-24 text-center space-y-3">
              <div className="w-7 h-7 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs font-serif text-[var(--color-neutral-8)]">
                正在深度研读历史往来邮件并提炼关系画像...
              </p>
              <p className="text-[11px] font-mono text-[var(--color-neutral-5)]">
                包括角色画像、阶段历程、高频议题、账单交易与跟进建议
              </p>
            </div>
          ) : displayReportText ? (
            renderStructuredReport(displayReportText)
          ) : (
            <div className="py-24 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-[var(--color-surface-subtle)] border border-[var(--color-border)] flex items-center justify-center mx-auto text-[var(--color-neutral-4)]">
                <Sparkles className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-serif font-medium text-[var(--color-neutral-9)]">
                  暂无该联系人的 AI 总结报告
                </h4>
                <p className="text-xs font-serif text-[var(--color-neutral-5)] max-w-xs mx-auto">
                  点击下方按钮，由大模型深度分析全部邮件往来，生成专属人脉画像。
                </p>
              </div>
              <button
                onClick={onRegenerate}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white text-xs font-medium font-sans hover:opacity-90 shadow-sm transition-all"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>立即生成深度画像总结</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
