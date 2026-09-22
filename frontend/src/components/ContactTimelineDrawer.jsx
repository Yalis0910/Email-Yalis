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
  Bot,
  Trophy,
  ThumbsDown,
  Lock,
  Unlock,
  Check, 
  Copy, 
  Zap,
  BookOpen,
  RefreshCw
} from 'lucide-react';
import { api, streamSSE } from '../api/client';
import AttachmentPreviewModal from './AttachmentPreviewModal';
import ContactAIReportDrawer from './ContactAIReportDrawer';
import { useAIConversation } from '../context/AIConversationContext';

// Module-level in-memory cache for instant contact switching (SWR)
const timelineCache = new Map(); // key: `${contactId}_${order}` -> timelineData
const reportCache = new Map();   // key: contactId -> reportData

export default function ContactTimelineDrawer({ 
  contact, 
  isOpen, 
  onClose, 
  onSelectEmail, 
  onSelectContact,
  defaultReportOpen = false,
  sortBy = 'weight',
  onTierUpdated,
  selectedAccount
}) {
  const [timelineData, setTimelineData] = useState(() => {
    if (contact?.id) {
      return timelineCache.get(`${contact.id}_desc`) || null;
    }
    return null;
  });
  const [loading, setLoading] = useState(false);
  const [order, setOrder] = useState('desc'); // 'desc' | 'asc'
  const [searchFilter, setSearchFilter] = useState('');
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [previewAttachment, setPreviewAttachment] = useState(null);
  const [renderLimit, setRenderLimit] = useState(40);
  const [isReportLoading, setIsReportLoading] = useState(false);

  // CRM Tiering & Deal Review states
  const [contactTier, setContactTier] = useState(contact?.tier || 'D');
  const [tierLocked, setTierLocked] = useState(Boolean(contact?.tier_locked));
  const [dealStage, setDealStage] = useState(contact?.deal_stage || 'lead');
  const [tierReason, setTierReason] = useState(contact?.tier_reason || '');
  const [isEvaluatingTier, setIsEvaluatingTier] = useState(false);

  // Deal Review modal states
  const [dealReviewOpen, setDealReviewOpen] = useState(false);
  const [dealStatus, setDealStatus] = useState('won'); // 'won' | 'lost'
  const [dealAmount, setDealAmount] = useState(contact?.estimated_value || '');
  const [dealCurrency, setDealCurrency] = useState('USD');
  const [dealNotes, setDealNotes] = useState('');
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewResult, setReviewResult] = useState(null);
  const [isSavingPlaybook, setIsSavingPlaybook] = useState(false);
  const [savedPlaybookId, setSavedPlaybookId] = useState(null);

  const timelineAbortRef = useRef(null);
  const reportAbortRef = useRef(null);

  // 1. Immediately sync CRM states from the freshest incoming contact prop
  useEffect(() => {
    if (contact) {
      setContactTier(contact.tier || 'D');
      setTierLocked(Boolean(contact.tier_locked));
      setDealStage(contact.deal_stage || 'lead');
      setTierReason(contact.tier_reason || '');
      setDealAmount(contact.estimated_value || '');
      setReviewResult(null);
      setSavedPlaybookId(null);
    }
  }, [contact?.id, contact?.tier, contact?.tier_locked, contact?.deal_stage, contact?.tier_reason, contact?.estimated_value]);

  // 2. Sync when timelineData finishes loading with potential enriched contact fields
  useEffect(() => {
    if (timelineData?.contact && timelineData.contact.id === contact?.id) {
      const c = timelineData.contact;
      if (c.tier !== undefined) setContactTier(c.tier || 'D');
      if (c.tier_locked !== undefined) setTierLocked(Boolean(c.tier_locked));
      if (c.deal_stage !== undefined) setDealStage(c.deal_stage || 'lead');
      if (c.tier_reason !== undefined) setTierReason(c.tier_reason || '');
      if (c.estimated_value !== undefined) setDealAmount(c.estimated_value || '');
    }
  }, [timelineData, contact?.id]);

  // AI Report states
  const [isReportDrawerOpen, setIsReportDrawerOpen] = useState(defaultReportOpen);
  const [cachedReport, setCachedReport] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingReportText, setStreamingReportText] = useState('');
  const abortControllerRef = useRef(null);

  // AI Copilot context integration & wide screen detection (620px timeline + 560px copilot = 1180px)
  const { openWithContactContext, isDrawerOpen: isCopilotOpen } = useAIConversation();
  const [isWideScreen, setIsWideScreen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1180);

  useEffect(() => {
    const handleResize = () => {
      setIsWideScreen(typeof window !== 'undefined' && window.innerWidth >= 1180);
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

  // Timeline data fetching: with in-memory caching (SWR), request abortion, and instant header render
  useEffect(() => {
    if (!isOpen || !contact?.id) {
      setTimelineData(null);
      setExpandedIds(new Set());
      setSearchFilter('');
      setIsReportDrawerOpen(false);
      setCachedReport(null);
      setIsGenerating(false);
      setStreamingReportText('');
      setRenderLimit(40);
      if (timelineAbortRef.current) timelineAbortRef.current.abort();
      if (reportAbortRef.current) reportAbortRef.current.abort();
      if (abortControllerRef.current) abortControllerRef.current.abort();
      return;
    }

    if (defaultReportOpen) {
      setIsReportDrawerOpen(true);
    }

    setRenderLimit(40);
    setSearchFilter('');
    setExpandedIds(new Set());

    // Instant SWR memory cache check
    const cacheKey = `${contact.id}_${order}`;
    const cachedTimeline = timelineCache.get(cacheKey);
    if (cachedTimeline) {
      setTimelineData(cachedTimeline);
      setLoading(false);
    } else {
      setTimelineData(null);
      setLoading(true);
    }

    const cachedRep = reportCache.get(contact.id);
    if (cachedRep !== undefined) {
      setCachedReport(cachedRep);
    } else {
      setCachedReport(null);
    }

    loadTimeline(contact.id, order);
    checkReport(contact.id);

    return () => {
      if (timelineAbortRef.current) timelineAbortRef.current.abort();
      if (reportAbortRef.current) reportAbortRef.current.abort();
    };
  }, [isOpen, contact?.id, order, defaultReportOpen]);

  const loadTimeline = async (contactId, currentOrder) => {
    if (timelineAbortRef.current) {
      timelineAbortRef.current.abort();
    }
    const ac = new AbortController();
    timelineAbortRef.current = ac;

    const cacheKey = `${contactId}_${currentOrder}`;
    const hasCached = timelineCache.has(cacheKey);
    if (!hasCached) {
      setLoading(true);
    }

    try {
      const res = await api.getContactTimeline(contactId, currentOrder, { signal: ac.signal });
      if (!ac.signal.aborted && contact?.id === contactId) {
        timelineCache.set(cacheKey, res);
        setTimelineData(res);
      }
    } catch (err) {
      if (err.name !== 'AbortError' && !err?.message?.includes?.('abort')) {
        console.error('Failed to load contact timeline:', err);
      }
    } finally {
      if (!ac.signal.aborted && contact?.id === contactId) {
        setLoading(false);
      }
    }
  };

  const handleUpdateTier = async (newTier) => {
    if (!contact?.id) return;
    try {
      setContactTier(newTier);
      setTierLocked(true);
      // Invalidate timeline cache for this contact to reflect updated tier
      timelineCache.delete(`${contact.id}_asc`);
      timelineCache.delete(`${contact.id}_desc`);
      await api.updateContactTier(contact.id, {
        tier: newTier,
        tier_locked: true,
        deal_stage: dealStage
      });
      onTierUpdated?.();
    } catch (err) {
      console.error('Failed to update tier:', err);
    }
  };

  const handleToggleLock = async () => {
    if (!contact?.id) return;
    try {
      const nextLocked = !tierLocked;
      setTierLocked(nextLocked);
      await api.updateContactTier(contact.id, {
        tier: contactTier,
        tier_locked: nextLocked,
        deal_stage: dealStage
      });
      onTierUpdated?.();
    } catch (err) {
      console.error('Failed to toggle lock:', err);
    }
  };

  const handleEvaluateTier = async () => {
    if (!contact?.id) return;
    try {
      setIsEvaluatingTier(true);
      const res = await api.evaluateContactTier(contact.id, true);
      if (res && res.success) {
        setContactTier(res.tier);
        setTierReason(res.tier_reason || '');
        setDealStage(res.deal_stage || 'lead');
        setTierLocked(false);
        onTierUpdated?.();
      } else {
        alert('评估评级失败: ' + (res?.error || '诊断未返回有效评级结果'));
      }
    } catch (err) {
      alert('评估评级失败: ' + (err.message || err));
    } finally {
      setIsEvaluatingTier(false);
    }
  };

  const handleRunDealReview = async () => {
    if (!contact?.id) return;
    try {
      setIsReviewing(true);
      setSavedPlaybookId(null);
      const res = await api.reviewContactDeal(contact.id, {
        deal_status: dealStatus,
        deal_amount: parseFloat(dealAmount) || 0,
        currency: dealCurrency,
        user_notes: dealNotes
      });
      if (res && res.success) {
        setReviewResult(res);
        setDealStage(dealStatus);
        if (dealStatus === 'won') {
          setContactTier('A');
        }
        onTierUpdated?.();
      } else {
        alert('复盘失败: ' + (res?.error || '未知错误'));
      }
    } catch (err) {
      alert('复盘执行异常: ' + err);
    } finally {
      setIsReviewing(false);
    }
  };

  const handleSavePlaybook = async (pb) => {
    if (!pb || !pb.title || !pb.reply_template) return;
    try {
      setIsSavingPlaybook(true);
      const res = await api.createSalesPlaybook({
        scenario_type: pb.scenario_type || 'custom',
        title: pb.title,
        trigger_pattern: pb.trigger_pattern || '',
        response_strategy: pb.response_strategy || '',
        reply_template: pb.reply_template,
        source_contact_id: contact?.id
      });
      setSavedPlaybookId(res?.id || 'saved');
    } catch (err) {
      alert('沉淀入话术库失败: ' + (err?.message || err));
    } finally {
      setIsSavingPlaybook(false);
    }
  };

  const checkReport = async (contactId) => {
    if (!contactId) return;
    if (reportAbortRef.current) {
      reportAbortRef.current.abort();
    }
    const ac = new AbortController();
    reportAbortRef.current = ac;

    const hasCached = reportCache.has(contactId);
    if (!hasCached) {
      setIsReportLoading(true);
    }

    try {
      const res = await api.getContactAIReport(contactId, { signal: ac.signal });
      if (!ac.signal.aborted && contact?.id === contactId) {
        const report = (res && res.has_report && res.report) ? res.report : null;
        reportCache.set(contactId, report);
        setCachedReport(report);
      }
    } catch (err) {
      if (err.name !== 'AbortError' && !err?.message?.includes?.('abort')) {
        setCachedReport(null);
      }
    } finally {
      if (!ac.signal.aborted && contact?.id === contactId) {
        setIsReportLoading(false);
      }
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
          reportCache.set(contact.id, data.report);
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
            reportCache.set(contact.id, r.report);
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
        account_id: summarizedItem.account_id,
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

  // Immediate contact metadata fallback while timelineData is loading
  const isTimelineMatching = timelineData?.contact?.id === contact?.id;
  const currentContact = {
    ...(contact || {}),
    ...(isTimelineMatching ? timelineData.contact : {})
  };

  const stats = (isTimelineMatching && timelineData?.stats) ? timelineData.stats : {
    total_exchanges: (contact?.inbound_count || 0) + (contact?.outbound_count || 0),
    inbound_count: contact?.inbound_count || 0,
    outbound_count: contact?.outbound_count || 0,
    attachment_count: isTimelineMatching ? (timelineData?.stats?.attachment_count || 0) : 0,
    first_interaction: contact?.first_interaction,
    last_interaction: contact?.last_interaction
  };

  const allItems = isTimelineMatching ? (timelineData?.timeline || []) : [];
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

  const displayName = currentContact.name || (currentContact.email ? currentContact.email.split('@')[0] : '联系人');

  return (
    <>
      <div 
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-xs flex justify-end transition-all cursor-pointer overflow-x-auto ${
          isCopilotOpen && isWideScreen ? 'pr-[560px]' : ''
        }`}
        onClick={(e) => {
          e.stopPropagation();
          onClose?.();
        }}
      >
      {/* Secondary AI Report Drawer (Rendered on the LEFT of timeline drawer) */}
      <ContactAIReportDrawer
        currentContact={currentContact}
        isOpen={isReportDrawerOpen}
        onClose={() => setIsReportDrawerOpen(false)}
        onSelectContact={handleSelectContactFromReport}
        isGenerating={isGenerating}
        streamingReportText={streamingReportText}
        onRegenerate={() => handleGenerateReport(true)}
        cachedReport={cachedReport}
        isReportLoading={isReportLoading}
        selectedAccount={selectedAccount}
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
                  {currentContact.domain && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[var(--color-surface-subtle)] text-[var(--color-neutral-6)] border border-[var(--color-border)]">
                      {currentContact.domain}
                    </span>
                  )}
                </div>
                <p className="text-xs font-mono text-[var(--color-neutral-6)] mt-0.5 truncate">
                  {currentContact.email}
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

          {/* CRM Customer Tier & Deal Stage Management Bar */}
          <div className="mt-3 pt-3 border-t border-[var(--color-border)]/60 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-[var(--color-neutral-6)]">客户分级:</span>
              <div className="inline-flex rounded-lg border border-[var(--color-border)] p-0.5 bg-[var(--color-surface-subtle)] font-mono text-[11px]">
                {[
                  { key: 'A', label: 'A 战略', color: 'text-red-600 font-bold' },
                  { key: 'B', label: 'B 培育', color: 'text-blue-600 font-medium' },
                  { key: 'C', label: 'C 孵化', color: 'text-emerald-600' },
                  { key: 'D', label: 'D 其它', color: 'text-gray-500' },
                ].map(t => (
                  <button
                    key={t.key}
                    onClick={() => handleUpdateTier(t.key)}
                    className={`px-2 py-0.5 rounded transition-all ${
                      contactTier === t.key
                        ? 'bg-[var(--color-surface)] shadow-xs ' + t.color
                        : 'text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)]'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Lock Toggle Button */}
              <button
                onClick={handleToggleLock}
                className={`p-1 rounded border transition-colors ${
                  tierLocked
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-600'
                    : 'bg-transparent border-transparent text-[var(--color-neutral-5)] hover:text-[var(--color-neutral-8)]'
                }`}
                title={tierLocked ? '当前评级已手动锁定（AI批量扫描不会覆盖）' : '当前未锁定（点击锁定评级）'}
              >
                {tierLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
              </button>
            </div>

            <div className="flex items-center gap-2">
              {/* Single Contact AI Tier Re-eval */}
              <button
                onClick={handleEvaluateTier}
                disabled={isEvaluatingTier}
                className="px-2 py-1 rounded text-[11px] font-mono border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-subtle)] text-[var(--color-neutral-7)] flex items-center gap-1 transition-colors"
                title="调用大模型重新对该联系人往来邮件进行意向与价值诊断"
              >
                <Sparkles className={`w-3 h-3 text-[var(--color-accent)] ${isEvaluatingTier ? 'animate-spin' : ''}`} />
                <span>{isEvaluatingTier ? '诊断中...' : 'AI 诊断评级'}</span>
              </button>

              {/* Deal Won / Lost Review Button */}
              <button
                onClick={() => setDealReviewOpen(true)}
                className="px-2.5 py-1 rounded text-[11px] font-mono font-medium border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center gap-1 transition-colors"
                title="标记成单或丢单并开展全链条复盘归因，自动沉淀销售话术"
              >
                <Trophy className="w-3 h-3" />
                <span>成单/丢单复盘</span>
              </button>
            </div>
          </div>

          {tierReason && (
            <div className="mt-2 text-[11px] text-[var(--color-neutral-6)] bg-[var(--color-surface-subtle)] px-2.5 py-1 rounded border border-[var(--color-border)]/50 truncate" title={tierReason}>
              💡 评级依据: {tierReason}
            </div>
          )}
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
          {loading && allItems.length === 0 ? (
            <div className="space-y-4 animate-pulse">
              <div className="text-xs font-mono text-[var(--color-neutral-5)] text-center py-2 flex items-center justify-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-ping" />
                <span>正在梳理交流脉络...</span>
              </div>
              {[1, 2, 3].map((s) => (
                <div key={s} className="p-4 rounded-xl border border-[var(--color-border)]/60 bg-[var(--color-surface)] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="w-16 h-4 bg-[var(--color-surface-subtle)] rounded" />
                    <div className="w-24 h-3 bg-[var(--color-surface-subtle)] rounded" />
                  </div>
                  <div className="w-3/4 h-4 bg-[var(--color-surface-subtle)] rounded" />
                  <div className="w-full h-8 bg-[var(--color-surface-subtle)] rounded" />
                </div>
              ))}
            </div>
          ) : filteredTimeline.length === 0 ? (
            <div className="py-24 text-center text-xs font-mono text-[var(--color-neutral-5)]">
              {searchFilter ? '未检索到匹配的往来信件' : '暂无历史交流邮件记录'}
            </div>
          ) : (
            <div className="relative pl-7 space-y-5 before:absolute before:left-[11px] before:top-3 before:bottom-3 before:w-[2px] before:bg-[var(--color-border)]">
              {filteredTimeline.slice(0, renderLimit).map((item, idx) => {
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

              {filteredTimeline.length > renderLimit && (
                <div className="pt-2 pb-2 text-center">
                  <button
                    onClick={() => setRenderLimit(prev => prev + 50)}
                    className="w-full py-2 px-3 text-xs font-mono text-[var(--color-accent)] hover:bg-[var(--color-surface-subtle)] border border-dashed border-[var(--color-border)] rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <span>加载更多往来记录 (已展示 {Math.min(renderLimit, filteredTimeline.length)} 封 / 还有 {filteredTimeline.length - renderLimit} 封)</span>
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
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

    {/* Deal Review Modal */}
    {dealReviewOpen && (
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
        <div className="bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)] shadow-2xl max-w-2xl w-full max-h-[88vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
          <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-neutral-2)]/50">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center">
                <Trophy className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-neutral-10)]">
                  成单与丢单经验复盘归因 ({currentContact?.name || currentContact?.email})
                </h3>
                <p className="text-xs text-[var(--color-neutral-6)]">
                  回溯全链条往来邮件，深度复盘成单关键要素或丢单归因，提炼实战话术入库
                </p>
              </div>
            </div>
            <button
              onClick={() => { setDealReviewOpen(false); setReviewResult(null); }}
              className="p-1 text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)] rounded-lg hover:bg-[var(--color-neutral-3)]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5 overflow-y-auto flex-1 space-y-4 text-xs">
            {/* Options Row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--color-neutral-8)] mb-1">交易结果</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setDealStatus('won')}
                    className={`flex-1 py-1.5 px-3 rounded-lg border text-xs font-medium flex items-center justify-center gap-1 transition-all ${
                      dealStatus === 'won'
                        ? 'bg-emerald-500 text-white border-emerald-600 shadow-xs'
                        : 'bg-[var(--color-surface)] text-[var(--color-neutral-7)] border-[var(--color-border)]'
                    }`}
                  >
                    <Trophy className="w-3.5 h-3.5" />
                    <span>成单赢单</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDealStatus('lost')}
                    className={`flex-1 py-1.5 px-3 rounded-lg border text-xs font-medium flex items-center justify-center gap-1 transition-all ${
                      dealStatus === 'lost'
                        ? 'bg-red-500 text-white border-red-600 shadow-xs'
                        : 'bg-[var(--color-surface)] text-[var(--color-neutral-7)] border-[var(--color-border)]'
                    }`}
                  >
                    <ThumbsDown className="w-3.5 h-3.5" />
                    <span>丢单流失</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--color-neutral-8)] mb-1">订单/商机金额 (可选)</label>
                <input
                  type="number"
                  placeholder="例如: 8500"
                  value={dealAmount}
                  onChange={(e) => setDealAmount(e.target.value)}
                  className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-9)] text-xs rounded-lg px-3 py-1.5 outline-none focus:border-[var(--color-accent)]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--color-neutral-8)] mb-1">币种</label>
                <select
                  value={dealCurrency}
                  onChange={(e) => setDealCurrency(e.target.value)}
                  className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-9)] text-xs rounded-lg px-3 py-1.5 outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="USD">USD (美元)</option>
                  <option value="CNY">CNY (人民币)</option>
                  <option value="EUR">EUR (欧元)</option>
                  <option value="GBP">GBP (英镑)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--color-neutral-8)] mb-1">业务员补充说明 / 线下谈判要点 (可选)</label>
              <textarea
                rows={2}
                placeholder="例如: '客户最终接受了我们的交期保证与付款条件，但要求我们承担产地证费用...' 或 '对方反馈竞品比我们便宜8%，因预算削减选择对方...'"
                value={dealNotes}
                onChange={(e) => setDealNotes(e.target.value)}
                className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-9)] text-xs rounded-lg p-2.5 outline-none focus:border-[var(--color-accent)]"
              />
            </div>

            {/* Submit Action button */}
            {!reviewResult && (
              <button
                disabled={isReviewing}
                onClick={handleRunDealReview}
                className="w-full py-2 rounded-lg bg-[var(--color-accent)] text-white text-xs font-medium hover:opacity-90 transition-all flex items-center justify-center gap-1.5 shadow-sm"
              >
                <Sparkles className={`w-3.5 h-3.5 ${isReviewing ? 'animate-spin' : ''}`} />
                <span>{isReviewing ? 'AI 正在通读往来信件并进行深度复盘...' : '🚀 开始 AI 全链条复盘分析与话术提炼'}</span>
              </button>
            )}

            {/* Review Result Display */}
            {reviewResult && (
              <div className="space-y-3 pt-2 animate-in fade-in">
                <div className="p-3.5 rounded-xl bg-[var(--color-neutral-2)] border border-[var(--color-border)] space-y-2">
                  <div className="font-medium text-[var(--color-neutral-10)] text-sm">
                    {dealStatus === 'won' ? '🏆 成单归因复盘报告' : '💔 丢单归因复盘报告'}
                  </div>
                  <pre className="text-xs font-sans text-[var(--color-neutral-8)] whitespace-pre-wrap leading-relaxed">
                    {reviewResult.core_reasons}
                  </pre>
                  {reviewResult.key_timeline && (
                    <pre className="text-xs font-sans text-[var(--color-neutral-7)] whitespace-pre-wrap leading-relaxed pt-2 border-t border-[var(--color-border)]">
                      {reviewResult.key_timeline}
                    </pre>
                  )}
                  {reviewResult.lessons_learned && (
                    <pre className="text-xs font-sans text-amber-700 dark:text-amber-300 whitespace-pre-wrap leading-relaxed pt-2 border-t border-[var(--color-border)]">
                      {reviewResult.lessons_learned}
                    </pre>
                  )}
                </div>

                {reviewResult.extracted_playbook && (
                  <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 space-y-2.5">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-200">
                        <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
                        <span>💡 AI 提炼实战话术建议（未入库）:</span>
                      </div>

                      {savedPlaybookId ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                          <Check className="w-3.5 h-3.5" />
                          已成功沉淀入话术库
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={isSavingPlaybook}
                          onClick={() => handleSavePlaybook(reviewResult.extracted_playbook)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white transition-all shadow-xs disabled:opacity-50 cursor-pointer"
                        >
                          {isSavingPlaybook ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              <span>沉淀入库中...</span>
                            </>
                          ) : (
                            <>
                              <BookOpen className="w-3.5 h-3.5" />
                              <span>⭐ 采纳并沉淀入话术库</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-[var(--color-neutral-9)]">
                        {reviewResult.extracted_playbook.title}
                      </span>
                    </div>

                    <p className="text-xs text-[var(--color-neutral-7)] leading-relaxed">
                      <b className="text-[var(--color-neutral-8)]">应对策略:</b> {reviewResult.extracted_playbook.response_strategy}
                    </p>
                    <div className="p-3 rounded-lg bg-[var(--color-card)] border border-[var(--color-border)] text-xs font-mono text-[var(--color-neutral-8)] whitespace-pre-wrap leading-relaxed">
                      {reviewResult.extracted_playbook.reply_template}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="px-5 py-3 border-t border-[var(--color-border)] flex items-center justify-end gap-2 bg-[var(--color-neutral-2)]/30">
            <button
              onClick={() => { setDealReviewOpen(false); setReviewResult(null); }}
              className="px-4 py-1.5 text-xs text-[var(--color-neutral-7)] hover:bg-[var(--color-neutral-3)] rounded-lg transition-colors"
            >
              完成并关闭
            </button>
          </div>
        </div>
      </div>
    )}

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