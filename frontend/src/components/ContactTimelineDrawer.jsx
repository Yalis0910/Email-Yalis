import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Calendar, 
  FileText, 
  Search, 
  ArrowDownUp, 
  ExternalLink, 
  ChevronDown, 
  ChevronUp, 
  Mail, 
  Paperclip, 
  Eye, 
  Download,
  Users,
  Clock,
  Send,
  Inbox,
  Sparkles,
  Bot
} from 'lucide-react';
import { api, streamSSE } from '../api/client';
import AttachmentPreviewModal from './AttachmentPreviewModal';
import ContactAIReportDrawer from './ContactAIReportDrawer';
import { useAIConversation } from '../context/AIConversationContext';

export default function ContactTimelineDrawer({ 
  contact, 
  isOpen, 
  onClose, 
  onSelectEmail, 
  onSelectContact,
  defaultReportOpen = false,
  sortBy = 'weight'
}) {
  const [timelineData, setTimelineData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [order, setOrder] = useState('desc'); // 'desc' | 'asc'
  const [searchFilter, setSearchFilter] = useState('');
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [previewAttachment, setPreviewAttachment] = useState(null);

  // AI Report states
  const [isReportDrawerOpen, setIsReportDrawerOpen] = useState(defaultReportOpen);
  const [cachedReport, setCachedReport] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingReportText, setStreamingReportText] = useState('');
  const abortControllerRef = useRef(null);

  // AI Copilot context integration & wide screen detection
  const { openWithContactContext, isDrawerOpen: isCopilotOpen } = useAIConversation();
  const [isWideScreen, setIsWideScreen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1200);

  useEffect(() => {
    const handleResize = () => {
      setIsWideScreen(typeof window !== 'undefined' && window.innerWidth >= 1200);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleOpenAIChat = () => {
    if (!contact) return;
    openWithContactContext(
      contact,
      '请根据我与该联系人的往来历史，全面梳理我们之间的核心合作脉络、重要商议议题以及当前的待跟进事项。'
    );
  };

  // Dedicated ESC key listener: does not trigger timeline data refetch
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !previewAttachment) {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, previewAttachment, onClose]);

  // Timeline data fetching: only runs when drawer is opened, contact changes, or sort order changes
  useEffect(() => {
    if (!isOpen || !contact?.id) {
      setTimelineData(null);
      setExpandedIds(new Set());
      setSearchFilter('');
      setIsReportDrawerOpen(false);
      setCachedReport(null);
      setIsGenerating(false);
      setStreamingReportText('');
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      return;
    }
    if (defaultReportOpen) {
      setIsReportDrawerOpen(true);
    }
    loadTimeline(contact.id, order);
    checkReport(contact.id);
  }, [isOpen, contact?.id, order, defaultReportOpen]);

  const loadTimeline = async (contactId, currentOrder) => {
    try {
      setLoading(true);
      const res = await api.getContactTimeline(contactId, currentOrder);
      setTimelineData(res);
    } catch (err) {
      console.error('Failed to load contact timeline:', err);
    } finally {
      setLoading(false);
    }
  };

  const checkReport = async (contactId) => {
    if (!contactId) return;
    try {
      const res = await api.getContactAIReport(contactId);
      if (res && res.has_report && res.report) {
        setCachedReport(res.report);
      } else {
        setCachedReport(null);
      }
    } catch (_) {
      setCachedReport(null);
    }
  };

  const handleGenerateReport = async (forceRefresh = false) => {
    if (!contact?.id) return;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setIsReportDrawerOpen(true);
    setIsGenerating(true);
    setStreamingReportText('');

    let accumulated = '';
    await streamSSE(
      `/api/contacts/${contact.id}/ai-report/generate${forceRefresh ? '?force_refresh=true' : ''}`,
      {},
      {
        signal: abortControllerRef.current.signal,
        onChunk: (delta) => {
          accumulated += delta;
          setStreamingReportText(accumulated);
        },
        onCached: (data) => {
          setCachedReport(data.report);
          setStreamingReportText('');
          setIsGenerating(false);
        },
        onError: (err) => {
          console.error('Report stream error:', err);
          alert(`生成报告错误: ${err}`);
          setIsGenerating(false);
        },
        onDone: async () => {
          setIsGenerating(false);
          const r = await api.getContactAIReport(contact.id);
          if (r && r.has_report && r.report) {
            setCachedReport(r.report);
          }
        }
      }
    );
  };

  const handleSelectContactFromReport = (summarizedItem) => {
    if (!summarizedItem) return;
    const targetId = summarizedItem.contact_id || summarizedItem.id;
    if (targetId === contact?.id) return;
    
    if (onSelectContact) {
      onSelectContact({
        id: targetId,
        email: summarizedItem.email || summarizedItem.contact_email,
        name: summarizedItem.name || summarizedItem.contact_name,
        domain: summarizedItem.domain,
        inbound_count: summarizedItem.inbound_count,
        outbound_count: summarizedItem.outbound_count,
        first_interaction: summarizedItem.first_interaction,
        last_interaction: summarizedItem.last_interaction,
        weight: summarizedItem.weight
      });
    }
  };

  const toggleExpand = (id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (!isOpen || !contact) return null;

  const stats = timelineData?.stats || {
    total_exchanges: (contact.inbound_count || 0) + (contact.outbound_count || 0),
    inbound_count: contact.inbound_count || 0,
    outbound_count: contact.outbound_count || 0,
    attachment_count: 0
  };

  const allItems = timelineData?.timeline || [];
  const filteredTimeline = searchFilter.trim() === ''
    ? allItems
    : allItems.filter(item => {
        const q = searchFilter.toLowerCase();
        return (
          (item.subject && item.subject.toLowerCase().includes(q)) ||
          (item.snippet && item.snippet.toLowerCase().includes(q)) ||
          (item.from_email && item.from_email.toLowerCase().includes(q)) ||
          (item.to_emails && item.to_emails.toLowerCase().includes(q))
        );
      });

  const displayName = contact.name || contact.email.split('@')[0];

  return (
    <>
      <div 
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-xs flex justify-end transition-all cursor-pointer overflow-x-auto ${
          isCopilotOpen && isWideScreen ? 'pr-0 lg:pr-[480px]' : ''
        }`}
        onClick={(e) => {
          e.stopPropagation();
          onClose?.();
        }}
      >
      {/* Secondary AI Report Drawer (Rendered on the LEFT of timeline drawer) */}
      <ContactAIReportDrawer
        currentContact={contact}
        isOpen={isReportDrawerOpen}
        onClose={() => setIsReportDrawerOpen(false)}
        onSelectContact={handleSelectContactFromReport}
        isGenerating={isGenerating}
        streamingReportText={streamingReportText}
        onRegenerate={() => handleGenerateReport(true)}
        cachedReport={cachedReport}
        selectedAccount={contact.account_id}
        sortBy={sortBy}
      />

      {/* Primary Contact Timeline Drawer (Rendered on the RIGHT) */}
      <div 
        className="w-full sm:w-[540px] md:w-[620px] bg-[var(--color-surface)] border-l border-[var(--color-border)] shadow-2xl h-full flex flex-col overflow-hidden animate-in slide-in-from-right duration-200 cursor-default shrink-0 z-20"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="p-5 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex-shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-3.5 min-w-0 pr-2">
              <div className="w-12 h-12 rounded-full bg-[var(--color-surface-subtle)] border border-[var(--color-border)] flex items-center justify-center font-serif text-lg font-medium text-[var(--color-accent)] flex-shrink-0">
                {displayName.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-medium text-[var(--color-neutral-10)] truncate" title={displayName}>
                    {displayName}
                  </h3>
                  {contact.domain && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[var(--color-surface-subtle)] text-[var(--color-neutral-6)] border border-[var(--color-border)]">
                      {contact.domain}
                    </span>
                  )}
                </div>
                <p className="text-xs font-mono text-[var(--color-neutral-6)] mt-0.5 truncate">
                  {contact.email}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Contact-bound AI Chat Button */}
              <button
                onClick={handleOpenAIChat}
                className="px-2.5 py-1.5 rounded-lg border border-[var(--color-accent-border)] bg-[var(--color-surface)] text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] text-xs font-mono font-medium flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer"
                title="以当前联系人及全部往来历史为背景，唤起 AI 展开专属探讨"
              >
                <Bot className="w-3.5 h-3.5" />
                <span>AI 对话</span>
              </button>

              {/* AI Report Action Button */}
              {isGenerating ? (
                <button
                  disabled
                  className="px-2.5 py-1.5 rounded-lg bg-[var(--color-accent-soft)] border border-[var(--color-accent-border)] text-[var(--color-accent)] text-xs font-mono font-medium flex items-center gap-1.5 shadow-2xs cursor-wait"
                >
                  <Sparkles className="w-3.5 h-3.5 animate-spin" />
                  <span>正在分析...</span>
                </button>
              ) : cachedReport ? (
                <button
                  onClick={() => setIsReportDrawerOpen(prev => !prev)}
                  className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono font-medium flex items-center gap-1.5 shadow-2xs transition-all ${
                    isReportDrawerOpen
                      ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                      : 'bg-[var(--color-surface)] text-[var(--color-accent)] border-[var(--color-accent-border)] hover:bg-[var(--color-accent-soft)]'
                  }`}
                  title={isReportDrawerOpen ? '点击收起 AI 画像报告' : '点击查看已生成的 AI 画像报告'}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{isReportDrawerOpen ? '收起报告' : '查看报告'}</span>
                </button>
              ) : (
                <button
                  onClick={() => handleGenerateReport(false)}
                  className="px-2.5 py-1.5 rounded-lg bg-[var(--color-accent)] hover:opacity-90 text-white text-xs font-mono font-medium flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer"
                  title="深度研读历史往来邮件，提炼人物画像与关系历程"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>AI 总结</span>
                </button>
              )}

              <button
                onClick={onClose}
                className="text-[var(--color-neutral-5)] hover:text-[var(--color-neutral-9)] p-1.5 rounded-md hover:bg-[var(--color-surface-subtle)] transition-colors"
                title="关闭侧边栏 (Esc 或点击遮罩层)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-4 gap-2 mt-4 pt-3.5 border-t border-[var(--color-border)]/60 text-center font-mono">
            <div className="p-2 rounded bg-[var(--color-surface-subtle)] border border-[var(--color-border)]">
              <div className="text-[10px] text-[var(--color-neutral-5)]">往来总计</div>
              <div className="text-sm font-medium text-[var(--color-neutral-10)] mt-0.5 tabular-nums">
                {stats.total_exchanges}
              </div>
            </div>
            <div className="p-2 rounded bg-[var(--color-surface-subtle)] border border-[var(--color-border)]">
              <div className="text-[10px] text-[var(--color-neutral-5)] flex items-center justify-center gap-0.5">
                <Inbox className="w-2.5 h-2.5" />
                <span>对方来信</span>
              </div>
              <div className="text-sm font-medium text-[var(--color-neutral-9)] mt-0.5 tabular-nums">
                {stats.inbound_count}
              </div>
            </div>
            <div className="p-2 rounded bg-[var(--color-surface-subtle)] border border-[var(--color-border)]">
              <div className="text-[10px] text-[var(--color-accent)] flex items-center justify-center gap-0.5">
                <Send className="w-2.5 h-2.5" />
                <span>我方发出</span>
              </div>
              <div className="text-sm font-medium text-[var(--color-accent)] mt-0.5 tabular-nums">
                {stats.outbound_count}
              </div>
            </div>
            <div className="p-2 rounded bg-[var(--color-surface-subtle)] border border-[var(--color-border)]">
              <div className="text-[10px] text-[var(--color-neutral-5)] flex items-center justify-center gap-0.5">
                <Paperclip className="w-2.5 h-2.5" />
                <span>携带附件</span>
              </div>
              <div className="text-sm font-medium text-[var(--color-neutral-9)] mt-0.5 tabular-nums">
                {stats.attachment_count}
              </div>
            </div>
          </div>
        </div>

        {/* Toolbar: Search & Sort Switcher */}
        <div className="px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface-subtle)]/50 flex items-center justify-between gap-3 flex-shrink-0">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-neutral-5)]" />
            <input
              type="text"
              placeholder="在此往来记录中搜索..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-9)] text-xs rounded-md pl-8 pr-3 py-1.5 outline-none focus:border-[var(--color-accent)] transition-colors"
            />
          </div>

          <button
            onClick={() => setOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-xs font-mono text-[var(--color-neutral-7)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent-border)] transition-colors flex-shrink-0"
            title="点击切换时间正序/倒序"
          >
            <ArrowDownUp className="w-3.5 h-3.5" />
            <span>{order === 'desc' ? '最新在前 ↓' : '最早在前 ↑'}</span>
          </button>
        </div>

        {/* Drawer Body: Flow Timeline */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {loading && !timelineData ? (
            <div className="py-24 text-center">
              <div className="w-6 h-6 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs font-mono text-[var(--color-neutral-6)] mt-2">正在梳理交流脉络...</p>
            </div>
          ) : filteredTimeline.length === 0 ? (
            <div className="py-24 text-center text-xs font-mono text-[var(--color-neutral-5)]">
              {searchFilter ? '未检索到匹配的往来信件' : '暂无历史交流邮件记录'}
            </div>
          ) : (
            <div className="relative pl-7 space-y-5 before:absolute before:left-[11px] before:top-3 before:bottom-3 before:w-[2px] before:bg-[var(--color-border)]">
              {filteredTimeline.map((item, idx) => {
                const isOutbound = item.direction === 'outbound';
                const isExpanded = expandedIds.has(item.id);
                const hasAttachments = item.attachments && item.attachments.length > 0;

                return (
                  <div key={item.id} className="relative group">
                    {/* Timeline Node Marker */}
                    <div 
                      className={`absolute -left-7 top-3 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-transform group-hover:scale-110 ${
                        isOutbound 
                          ? 'bg-[var(--color-accent-soft)] border-[var(--color-accent)] text-[var(--color-accent)]' 
                          : 'bg-[var(--color-surface)] border-[var(--color-neutral-5)] text-[var(--color-neutral-7)]'
                      }`}
                    >
                      {isOutbound ? (
                        <ArrowUpRight className="w-2.5 h-2.5" />
                      ) : (
                        <ArrowDownLeft className="w-2.5 h-2.5" />
                      )}
                    </div>

                    {/* Flow Card */}
                    <div 
                      className={`p-4 rounded-xl transition-all border ${
                        isOutbound
                          ? 'bg-[var(--color-surface-subtle)]/70 border-[var(--color-accent-border)]/60 hover:border-[var(--color-accent)]'
                          : 'bg-[var(--color-surface)] border-[var(--color-border)] hover:border-[var(--color-neutral-5)] shadow-xs'
                      }`}
                    >
                      {/* Card Header Row */}
                      <div className="flex items-center justify-between text-xs mb-2">
                        <div className="flex items-center gap-2">
                          <span 
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium ${
                              isOutbound
                                ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-accent-border)]'
                                : 'bg-[var(--color-surface-subtle)] text-[var(--color-neutral-7)] border border-[var(--color-border)]'
                            }`}
                          >
                            {isOutbound ? '我方发出' : '对方来信'}
                          </span>
                          <span className="text-[11px] font-mono text-[var(--color-neutral-5)] tabular-nums">
                            {item.formatted_date || item.date_str?.slice(0, 16)}
                          </span>
                        </div>

                        {/* Open Email Modal button */}
                        {onSelectEmail && (
                          <button
                            onClick={() => {
                              onSelectEmail(item.id);
                            }}
                            className="text-xs font-mono text-[var(--color-accent)] hover:underline flex items-center gap-1 transition-colors"
                            title="直接打开新弹窗阅读此邮件"
                          >
                            <span>检索阅读</span>
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        )}
                      </div>

                      {/* Subject */}
                      <h4 
                        onClick={() => onSelectEmail && onSelectEmail(item.id)}
                        className={`text-sm font-medium text-[var(--color-neutral-10)] font-serif tracking-tight ${onSelectEmail ? 'cursor-pointer hover:text-[var(--color-accent)] transition-colors' : ''}`}
                        title={onSelectEmail ? '点击打开弹窗阅读' : undefined}
                      >
                        {item.subject}
                      </h4>

                      {/* Snippet */}
                      <p className="text-xs text-[var(--color-neutral-6)] mt-1.5 line-clamp-2 leading-relaxed font-sans">
                        {item.snippet}
                      </p>

                      {/* Attachments Pills if any */}
                      {hasAttachments && (
                        <div className="mt-3 pt-2.5 border-t border-[var(--color-border)]/60 flex flex-wrap gap-1.5">
                          {item.attachments.map((att) => (
                            <button
                              key={att.id}
                              onClick={() => setPreviewAttachment({ ...att, email_subject: item.subject })}
                              className="yohaku-tag flex items-center gap-1.5 py-0.5 px-2 bg-[var(--color-surface)] hover:border-[var(--color-accent)] transition-colors text-[10px]"
                              title="点击预览该附件"
                            >
                              <Paperclip className="w-2.5 h-2.5 text-[var(--color-accent)]" />
                              <span className="truncate max-w-[140px]">{att.filename}</span>
                              <span className="text-[9px] text-[var(--color-neutral-5)] tabular-nums">
                                ({(att.file_size / 1024).toFixed(0)}K)
                              </span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Expand/Collapse body trigger */}
                      <div className="mt-3 pt-2 flex items-center justify-between text-[11px] font-mono text-[var(--color-neutral-5)]">
                        <button
                          onClick={() => toggleExpand(item.id)}
                          className="hover:text-[var(--color-neutral-9)] flex items-center gap-1 transition-colors"
                        >
                          <span>{isExpanded ? '收起正文' : '展开正文预览'}</span>
                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                        <span>ID: {item.id.slice(0, 10)}...</span>
                      </div>

                      {/* Expanded inline email body */}
                      {isExpanded && (
                        <div className="mt-2.5 pt-2.5 border-t border-[var(--color-border)]/60">
                          <pre className="p-3 bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-md font-mono text-xs text-[var(--color-neutral-8)] whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto select-text">
                            {item.body_text || item.snippet || '（无正文内容）'}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Drawer Footer */}
        <div className="p-3 px-5 border-t border-[var(--color-border)] bg-[var(--color-surface-subtle)]/40 flex items-center justify-between text-[11px] font-mono text-[var(--color-neutral-6)] flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-[var(--color-neutral-5)]" />
            <span>首次建联: {stats.first_interaction || '-'}</span>
          </div>
          <div>最近往来: {stats.last_interaction || '-'}</div>
        </div>
      </div>
    </div>

    {/* Attachment Preview Modal (Rendered outside the drawer backdrop to prevent event bubbling) */}
    <AttachmentPreviewModal
      attachment={previewAttachment}
      isOpen={!!previewAttachment}
      onClose={() => setPreviewAttachment(null)}
      onSelectEmail={onSelectEmail}
    />
  </>
);
}