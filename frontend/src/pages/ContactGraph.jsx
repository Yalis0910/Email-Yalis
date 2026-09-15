import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import { 
  Users, 
  Search, 
  ChevronRight, 
  Sparkles, 
  Flame, 
  Zap, 
  RefreshCw, 
  X, 
  Check, 
  Clock, 
  AlertTriangle, 
  Building, 
  Copy, 
  Send,
  Sliders,
  Layers,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight
} from 'lucide-react';
import { api, streamSSE } from '../api/client';
import ContactTimelineDrawer from '../components/ContactTimelineDrawer';

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

export default function ContactGraph({ 
  selectedAccount, 
  onSelectEmail,
  initialContact,
  onClearInitialContact
}) {
  // Left: Radar State & Mode
  const [radarData, setRadarData] = useState(null);
  const [radarLoading, setRadarLoading] = useState(true);
  const [leftViewMode, setLeftViewMode] = useState('chart'); // 'chart' (四象限图) | 'list' (跟进清单)
  const [radarFilter, setRadarFilter] = useState('all'); // 'all' | 'urgent' | 'warning'
  const [radarPage, setRadarPage] = useState(1);
  const [radarPageSize, setRadarPageSize] = useState(5);
  const [radarJumpPage, setRadarJumpPage] = useState('');

  // Right: Original Contacts List State
  const [contacts, setContacts] = useState([]);
  const [totalContacts, setTotalContacts] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [contactLoading, setContactLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('weight'); // 'weight' | 'recent'
  const [selectedTier, setSelectedTier] = useState('all'); // 'all' | 'A' | 'B' | 'C' | 'overdue'

  // Timeline Drawer State
  const [selectedContactForTimeline, setSelectedContactForTimeline] = useState(null);
  const [isReportOpenDirectly, setIsReportOpenDirectly] = useState(false);

  // AI Draft Modal State
  const [draftModalContact, setDraftModalContact] = useState(null);
  const [draftContent, setDraftContent] = useState('');
  const [isDrafting, setIsDrafting] = useState(false);
  const [draftCopied, setDraftCopied] = useState(false);
  const [customPromptHint, setCustomPromptHint] = useState('');
  const draftAbortRef = useRef(null);

  // Batch Tiering Modal States
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState(null);
  const [batchSummary, setBatchSummary] = useState(null);
  const [tierStats, setTierStats] = useState(null);
  const [isStatsLoading, setIsStatsLoading] = useState(false);
  const [batchMode, setBatchMode] = useState('all_funnel');
  const [batchLimit, setBatchLimit] = useState(30);
  const [batchLogs, setBatchLogs] = useState([]);
  const [batchDuration, setBatchDuration] = useState(null);
  const batchAbortRef = useRef(null);

  // Initial Contact Auto Open
  useEffect(() => {
    if (!initialContact) return;
    if (initialContact.email || initialContact.name) {
      setSelectedContactForTimeline(initialContact);
      onClearInitialContact?.();
      return;
    }
    if (initialContact.id) {
      const found = contacts.find(c => c.id === initialContact.id);
      if (found) {
        setSelectedContactForTimeline(found);
        onClearInitialContact?.();
        return;
      }
      let isMounted = true;
      api.getContactTimeline(initialContact.id)
        .then(res => {
          if (isMounted && res?.contact) {
            setSelectedContactForTimeline(res.contact);
          }
        })
        .catch(err => console.error('Failed to load initial contact timeline:', err))
        .finally(() => {
          if (isMounted) onClearInitialContact?.();
        });
      return () => { isMounted = false; };
    }
  }, [initialContact, contacts, onClearInitialContact]);

  // Load Left Radar Data
  const loadRadar = useCallback(async () => {
    try {
      setRadarLoading(true);
      const res = await api.getSalesRadar(selectedAccount || null);
      setRadarData(res);
    } catch (err) {
      console.error('Failed to load sales radar:', err);
    } finally {
      setRadarLoading(false);
    }
  }, [selectedAccount]);

  // Load Right Contacts List
  const loadContacts = useCallback(async (isAppend = false, targetPage = 1) => {
    try {
      if (isAppend) {
        setLoadingMore(true);
      } else {
        setContactLoading(true);
      }
      const res = await api.getContacts({
        account_id: selectedAccount || '',
        search: search.trim() || undefined,
        sort_by: sortBy,
        tier: selectedTier !== 'all' ? selectedTier : undefined,
        page: targetPage,
        limit: 80
      });
      const items = res?.items || [];
      const total = res?.total || 0;
      setTotalContacts(total);
      if (isAppend) {
        setContacts(prev => [...prev, ...items]);
        setPage(targetPage);
      } else {
        setContacts(items);
        setPage(1);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setContactLoading(false);
      setLoadingMore(false);
    }
  }, [selectedAccount, search, sortBy, selectedTier]);

  const loadTierStats = useCallback(async () => {
    setIsStatsLoading(true);
    try {
      const res = await api.getTierStats(selectedAccount || null);
      setTierStats(res);
    } catch (err) {
      console.error('Failed to load tier stats:', err);
    } finally {
      setIsStatsLoading(false);
    }
  }, [selectedAccount]);

  useEffect(() => {
    loadRadar();
  }, [loadRadar]);

  useEffect(() => {
    loadContacts(false, 1);
  }, [loadContacts]);

  // Handle drawer close
  const handleCloseTimeline = useCallback(() => {
    setSelectedContactForTimeline(null);
    setIsReportOpenDirectly(false);
  }, []);

  const handleSelectContact = useCallback((newContact) => {
    setSelectedContactForTimeline(newContact);
  }, []);

  // Handle AI Drafting
  const handleStartDraft = async (contact, customHint = '') => {
    setDraftModalContact(contact);
    setDraftContent('');
    setIsDrafting(true);
    setDraftCopied(false);
    if (draftAbortRef.current) {
      draftAbortRef.current.abort();
    }
    draftAbortRef.current = new AbortController();

    const targetId = contact.contact_id || contact.id;
    let accumulated = '';
    await streamSSE(
      `/api/sales/contacts/${targetId}/generate-follow-up`,
      { prompt_hint: customHint },
      {
        signal: draftAbortRef.current.signal,
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

  // Batch Tiering
  const handleOpenBatchModal = () => {
    setBatchModalOpen(true);
    loadTierStats();
  };

  const handleRunBatchTiering = async (overrideMode, overrideLimit) => {
    const runMode = overrideMode || batchMode;
    const runLimit = overrideLimit || batchLimit;

    setIsBatchRunning(true);
    setBatchProgress({ processed: 0, total: tierStats?.total || 1, current: '启动智能分级漏斗...' });
    setBatchSummary(null);
    setBatchLogs([]);
    setBatchDuration(null);

    if (batchAbortRef.current) {
      batchAbortRef.current.abort();
    }
    batchAbortRef.current = new AbortController();

    await streamSSE(
      '/api/sales/batch-tier',
      { account_id: selectedAccount || null, limit: runLimit, mode: runMode },
      {
        signal: batchAbortRef.current.signal,
        onEvent: (evt) => {
          if (evt.type === 'start') {
            setBatchProgress({ processed: 0, total: evt.total, current: '开始处理联系人...' });
          } else if (evt.type === 'triage') {
            setBatchProgress(prev => ({
              ...(prev || {}),
              total: evt.total,
              processed: evt.fast_classified,
              current: evt.message
            }));
            setBatchLogs(prev => [
              { id: 'triage-' + Date.now(), type: 'triage', message: evt.message, count: evt.fast_classified },
              ...prev.slice(0, 25)
            ]);
          } else if (evt.type === 'progress') {
            setBatchProgress({
              processed: evt.processed,
              total: evt.total,
              ai_processed: evt.ai_processed,
              ai_total: evt.ai_total,
              current: `${evt.name || evt.current} -> 【${evt.tier} 级】`
            });
            setBatchLogs(prev => [
              {
                id: evt.current + '-' + Date.now(),
                email: evt.current,
                name: evt.name,
                tier: evt.tier,
                reason: evt.reason,
                deal_stage: evt.deal_stage,
                is_deep: evt.is_deep,
                locked: evt.locked
              },
              ...prev.slice(0, 25)
            ]);
          } else if (evt.type === 'done') {
            setBatchSummary(evt.summary);
            setBatchDuration(evt.duration_seconds);
            setIsBatchRunning(false);
            loadContacts();
            loadRadar();
            loadTierStats();
          }
        },
        onError: (err) => {
          if (err !== 'AbortError' && !err?.includes?.('abort') && !err?.includes?.('aborted')) {
            alert('批量分级执行异常: ' + err);
          }
          setIsBatchRunning(false);
          loadTierStats();
        },
        onDone: () => {
          setIsBatchRunning(false);
        }
      }
    );
  };

  const handleStopBatchTiering = () => {
    if (batchAbortRef.current) {
      batchAbortRef.current.abort();
      batchAbortRef.current = null;
    }
    setIsBatchRunning(false);
    loadContacts();
    loadRadar();
    loadTierStats();
  };

  const handleOpenReportList = async () => {
    try {
      const res = await api.getSummarizedContacts(selectedAccount || undefined, sortBy);
      const items = res.items || [];
      if (items.length > 0) {
        const topSummary = items[0];
        const matched = contacts.find(c => c.id === topSummary.contact_id);
        const targetContact = matched || {
          id: topSummary.contact_id,
          account_id: topSummary.account_id,
          email: topSummary.email,
          name: topSummary.name,
          domain: topSummary.domain,
          inbound_count: topSummary.inbound_count,
          outbound_count: topSummary.outbound_count,
          first_interaction: topSummary.first_interaction,
          last_interaction: topSummary.last_interaction,
          weight: topSummary.weight
        };
        setIsReportOpenDirectly(true);
        setSelectedContactForTimeline(targetContact);
      } else if (contacts.length > 0) {
        setIsReportOpenDirectly(true);
        setSelectedContactForTimeline(contacts[0]);
      } else {
        alert('暂无联系人数据');
      }
    } catch (err) {
      console.error('Failed to open report list:', err);
      if (contacts.length > 0) {
        setIsReportOpenDirectly(true);
        setSelectedContactForTimeline(contacts[0]);
      }
    }
  };

  // ECharts Scatter Quadrant Configuration
  const scatterPoints = radarData?.scatter_points || [];
  const summary = radarData?.summary || {};
  const urgentItems = radarData?.urgent_items || [];
  const warningItems = radarData?.warning_items || [];

  const getScatterChartOption = () => {
    const pointsData = scatterPoints.map(p => {
      const tierVal = p.tier === 'A' ? 4 : (p.tier === 'B' ? 3 : (p.tier === 'C' ? 2 : 1));
      let color = '#9ca3af';
      if (p.urgency === 'urgent') color = '#ef4444';
      else if (p.urgency === 'warning') color = '#f59e0b';
      else if (p.urgency === 'healthy') color = '#10b981';
      else if (p.tier === 'C') color = '#3b82f6';

      const symbolSize = Math.max(12, Math.min(32, Math.sqrt(p.email_total || 1) * 3.2));

      return {
        name: p.name,
        value: [p.days_silent, tierVal, p.email_total],
        itemStyle: {
          color: color,
          borderColor: '#ffffff',
          borderWidth: 1.5,
          shadowBlur: 6,
          shadowColor: 'rgba(0,0,0,0.1)'
        },
        symbolSize: symbolSize,
        item: p
      };
    });

    const maxDays = Math.max(75, ...scatterPoints.map(p => p.days_silent || 0));

    return {
      tooltip: {
        trigger: 'item',
        backgroundColor: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
        textStyle: { color: 'var(--color-neutral-9)', fontSize: 12, fontFamily: 'var(--font-sans)' },
        padding: 10,
        formatter: (params) => {
          const item = params.data?.item;
          if (!item) return '';
          const tierName = item.tier === 'A' ? '⭐ A级战略大客' : (item.tier === 'B' ? '📈 B级培育客户' : (item.tier === 'C' ? '🌱 C级潜在' : 'D级普通'));
          return `
            <div style="font-weight:600;font-size:13px;margin-bottom:2px;color:var(--color-neutral-10);">${item.name}</div>
            <div style="font-size:11px;color:var(--color-neutral-6);margin-bottom:4px;">${item.email} ${item.domain ? `· ${item.domain}` : ''}</div>
            <div style="font-size:11px;line-height:1.5;">
              <b>分级:</b> ${tierName}<br/>
              <b>交互信件:</b> ${item.email_total || 0} 封<br/>
              <b>沉寂周期:</b> <span style="color:${item.days_silent > 15 ? '#ef4444' : '#10b981'};font-weight:600;">已沉寂 ${item.days_silent} 天</span>
            </div>
            ${item.action_suggestion ? `<div style="margin-top:4px;padding-top:4px;border-top:1px dashed #ddd;font-size:11px;color:#d97706;">💡 ${item.action_suggestion}</div>` : ''}
            <div style="margin-top:4px;font-size:10px;color:var(--color-accent);font-family:monospace;">👉 点击此点可打开往来交流脉络</div>
          `;
        }
      },
      grid: {
        top: 30,
        right: 35,
        bottom: 40,
        left: 60
      },
      xAxis: {
        name: '沉寂天数',
        nameLocation: 'middle',
        nameGap: 24,
        type: 'value',
        min: 0,
        max: maxDays + 10,
        splitLine: {
          lineStyle: { type: 'dashed', color: 'rgba(150,150,150,0.18)' }
        },
        axisLabel: {
          formatter: '{value}天',
          fontSize: 10,
          color: 'var(--color-neutral-6)'
        }
      },
      yAxis: {
        name: '客户价值分级',
        type: 'value',
        min: 0.5,
        max: 4.5,
        interval: 1,
        splitLine: {
          lineStyle: { type: 'dashed', color: 'rgba(150,150,150,0.18)' }
        },
        axisLabel: {
          formatter: (val) => {
            if (val === 4) return '⭐ A级战略';
            if (val === 3) return '📈 B级主力';
            if (val === 2) return '🌱 C级潜在';
            if (val === 1) return 'D级普通';
            return '';
          },
          fontSize: 10,
          color: 'var(--color-neutral-7)'
        }
      },
      series: [
        {
          type: 'scatter',
          data: pointsData,
          markArea: {
            silent: true,
            data: [
              // Top-Right: Urgent Lost
              [
                {
                  name: '🚨 高危失联区 (超期沉寂)',
                  itemStyle: { color: 'rgba(239, 68, 68, 0.05)' },
                  label: {
                    position: 'insideTopRight',
                    color: '#ef4444',
                    fontSize: 10,
                    fontWeight: 600,
                    offset: [-6, 6]
                  },
                  coord: [15, 2.5]
                },
                { coord: [maxDays + 10, 4.5] }
              ],
              // Top-Left: Core Active
              [
                {
                  name: '🔥 核心热络区 (推进中)',
                  itemStyle: { color: 'rgba(16, 185, 129, 0.05)' },
                  label: {
                    position: 'insideTopLeft',
                    color: '#10b981',
                    fontSize: 10,
                    fontWeight: 600,
                    offset: [6, 6]
                  },
                  coord: [0, 2.5]
                },
                { coord: [15, 4.5] }
              ],
              // Bottom-Left: Incubating
              [
                {
                  name: '🌱 潜在新客区',
                  itemStyle: { color: 'rgba(59, 130, 246, 0.04)' },
                  label: {
                    position: 'insideBottomLeft',
                    color: '#3b82f6',
                    fontSize: 10,
                    offset: [6, -6]
                  },
                  coord: [0, 0.5]
                },
                { coord: [15, 2.5] }
              ],
              // Bottom-Right: Dormant
              [
                {
                  name: '💤 边缘休眠区',
                  itemStyle: { color: 'rgba(156, 163, 175, 0.03)' },
                  label: {
                    position: 'insideBottomRight',
                    color: '#9ca3af',
                    fontSize: 10,
                    offset: [-6, -6]
                  },
                  coord: [15, 0.5]
                },
                { coord: [maxDays + 10, 2.5] }
              ]
            ]
          }
        }
      ]
    };
  };

  const onChartClick = (params) => {
    if (params.data && params.data.item) {
      const item = params.data.item;
      // Match contact
      const matched = contacts.find(c => c.id === item.contact_id || c.email === item.email);
      const target = matched || {
        id: item.contact_id,
        account_id: item.account_id,
        email: item.email,
        name: item.name,
        domain: item.domain,
        inbound_count: item.inbound_count,
        outbound_count: item.outbound_count,
        last_interaction: item.last_interaction,
        tier: item.tier
      };
      setIsReportOpenDirectly(false);
      setSelectedContactForTimeline(target);
    }
  };

  // Radar List items
  const radarItems = radarFilter === 'urgent' 
    ? urgentItems 
    : (radarFilter === 'warning' ? warningItems : [...urgentItems, ...warningItems]);
  const radarTotalPages = Math.max(1, Math.ceil(radarItems.length / radarPageSize));
  const pagedRadarItems = radarItems.slice((radarPage - 1) * radarPageSize, radarPage * radarPageSize);

  const handleRadarJump = (e) => {
    e.preventDefault();
    const p = parseInt(radarJumpPage, 10);
    if (p >= 1 && p <= radarTotalPages) {
      setRadarPage(p);
      setRadarJumpPage('');
    }
  };

  const handleRadarPageSizeChange = (newSize) => {
    setRadarPageSize(newSize);
    setRadarPage(1);
  };

  return (
    <div className="space-y-6 pb-16">
      {/* Header */}
      <div className="border-b border-[var(--color-border)] pb-4 pt-2">
        <h1 className="text-2xl sm:text-3xl font-serif font-normal text-[var(--color-neutral-10)] tracking-tight">
          人脉网络拓扑与跟进雷达
        </h1>
        <p className="text-xs font-serif text-[var(--color-neutral-6)] mt-1">
          基于往来信件频次与客户健康度构建的动态关系网络与流失预警雷达。
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Follow-up Radar / Health Quadrant (Replaces old dandelion force graph) */}
        <div className="lg:col-span-8 yohaku-card p-5 flex flex-col justify-between h-[600px] relative">
          <div className="flex flex-col h-full min-h-0">
            {/* Radar Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[var(--color-border)] flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-red-500/10 text-red-500 flex items-center justify-center border border-red-500/20 flex-shrink-0">
                  <Flame className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-[var(--color-neutral-10)] flex items-center gap-2">
                    <span>客户跟进雷达 (Follow-up Radar)</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-red-500/10 text-red-600">
                      流失预警
                    </span>
                  </h3>
                  <p className="text-[10px] text-[var(--color-neutral-6)] font-mono">
                    实时监测 A/B 类大客户互动沉寂周期，防止商机断档
                  </p>
                </div>
              </div>

              {/* View Switcher & Quick Stats */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 text-[10px] font-mono mr-1">
                  <span className="text-red-600 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20">
                    A超期: {summary?.a_tier_overdue || 0}
                  </span>
                  <span className="text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                    B待跟进: {summary?.b_tier_overdue || 0}
                  </span>
                </div>

                <div className="inline-flex p-0.5 rounded-md bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[11px] font-mono">
                  <button
                    onClick={() => setLeftViewMode('chart')}
                    className={`px-2.5 py-0.5 rounded transition-all cursor-pointer ${
                      leftViewMode === 'chart'
                        ? 'bg-[var(--color-surface)] text-[var(--color-neutral-10)] shadow-xs font-medium'
                        : 'text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)]'
                    }`}
                  >
                    流失预警四象限
                  </button>
                  <button
                    onClick={() => setLeftViewMode('list')}
                    className={`px-2.5 py-0.5 rounded transition-all cursor-pointer ${
                      leftViewMode === 'list'
                        ? 'bg-[var(--color-surface)] text-[var(--color-neutral-10)] shadow-xs font-medium'
                        : 'text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)]'
                    }`}
                  >
                    跟进推进清单
                  </button>
                </div>
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 w-full h-full min-h-0 pt-2">
              {radarLoading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="w-5 h-5 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : leftViewMode === 'chart' ? (
                /* Mode 1: Quadrant Scatter Chart */
                <div className="h-full w-full">
                  <ReactECharts
                    option={getScatterChartOption()}
                    style={{ height: '100%', width: '100%' }}
                    onEvents={{ click: onChartClick }}
                  />
                </div>
              ) : (
                /* Mode 2: Actionable Follow-up List */
                <div className="flex flex-col h-full justify-between">
                  <div>
                    {/* Sub-filter tabs */}
                    <div className="flex items-center gap-1 mb-2.5 text-[11px] font-mono">
                      {[
                        { id: 'all', label: `全部预警 (${(summary?.a_tier_overdue || 0) + (summary?.b_tier_overdue || 0)})` },
                        { id: 'urgent', label: `🚨 A级高危 (${summary?.a_tier_overdue || 0})` },
                        { id: 'warning', label: `⚠️ B级待跟进 (${summary?.b_tier_overdue || 0})` }
                      ].map(t => (
                        <button
                          key={t.id}
                          onClick={() => {
                            setRadarFilter(t.id);
                            setRadarPage(1);
                          }}
                          className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${
                            radarFilter === t.id
                              ? 'bg-[var(--color-accent)] text-white font-medium shadow-2xs'
                              : 'bg-[var(--color-surface-subtle)] text-[var(--color-neutral-7)] hover:text-[var(--color-neutral-10)] border border-[var(--color-border)]'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>

                    {/* Follow-up Cards */}
                    <div className="space-y-2.5 overflow-y-auto max-h-[390px] pr-1">
                      {pagedRadarItems.length === 0 ? (
                        <div className="py-20 text-center text-xs font-mono text-[var(--color-neutral-5)]">
                          当前无待跟进预警
                        </div>
                      ) : (
                        pagedRadarItems.map((item) => (
                          <div 
                            key={item.contact_id || item.email}
                            className="py-2.5 px-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)]/50 hover:bg-[var(--color-surface-subtle)] transition-all flex items-center justify-between gap-3"
                          >
                            {/* Left: Badge, Name, Email, Days Silent */}
                            <div className="flex items-center gap-2 min-w-0 flex-wrap">
                              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold font-mono flex-shrink-0 ${
                                item.tier === 'A' 
                                  ? 'bg-red-500/15 text-red-600 border border-red-500/30' 
                                  : item.tier === 'B' 
                                  ? 'bg-blue-500/15 text-blue-600 border border-blue-500/30'
                                  : item.tier === 'C'
                                  ? 'bg-emerald-500/15 text-emerald-600'
                                  : 'bg-[var(--color-neutral-3)] text-[var(--color-neutral-6)]'
                              }`}>
                                {item.tier || 'D'}
                              </span>
                              <span className="text-xs font-medium text-[var(--color-neutral-10)] truncate max-w-[140px]">
                                {item.name}
                              </span>
                              <span className="text-[10px] text-[var(--color-neutral-6)] font-mono truncate max-w-[180px]">
                                {item.email}
                              </span>
                              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full flex-shrink-0 ${
                                item.days_silent >= 30 ? 'bg-red-500/10 text-red-600 font-semibold' : 'bg-amber-500/10 text-amber-600'
                              }`}>
                                沉寂 {item.days_silent} 天
                              </span>
                            </div>

                            {/* Right: Actions */}
                            <div className="flex items-center gap-1.5 flex-shrink-0 font-mono">
                              <button
                                onClick={() => setSelectedContactForTimeline({
                                  id: item.contact_id,
                                  account_id: item.account_id,
                                  email: item.email,
                                  name: item.name,
                                  domain: item.domain
                                })}
                                className="px-2.5 py-1 text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-subtle)] text-[var(--color-neutral-8)] transition-all cursor-pointer"
                              >
                                往来脉络 &gt;
                              </button>
                              <button
                                onClick={() => handleStartDraft(item)}
                                className="px-3 py-1 text-xs rounded-md bg-[var(--color-accent)] text-white hover:opacity-90 flex items-center gap-1 shadow-2xs transition-all cursor-pointer"
                              >
                                <Sparkles className="w-3 h-3" />
                                <span>生成草稿</span>
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Radar Full Pagination Toolbar */}
                  {radarItems.length > 0 && (
                    <div className="pt-2.5 border-t border-[var(--color-border)] flex flex-col md:flex-row items-center justify-between gap-2 text-xs font-mono text-[var(--color-neutral-7)]">
                      {/* Left: Total & Page Info */}
                      <div className="flex items-center gap-2 tabular-nums text-[11px] flex-shrink-0">
                        <span>
                          共 <strong className="text-[var(--color-neutral-10)] font-medium">{radarItems.length}</strong> 条预警
                        </span>
                        <span className="text-[var(--color-neutral-4)]">|</span>
                        <span>
                          第 <strong className="text-[var(--color-neutral-10)] font-medium">{radarPage}</strong> / {radarTotalPages} 页
                        </span>
                      </div>

                      {/* Right: Controls */}
                      <div className="flex items-center flex-wrap justify-end gap-1.5 sm:gap-2">
                        {/* Page Size Selector */}
                        <div className="flex items-center gap-1 text-[11px] text-[var(--color-neutral-6)]">
                          <span>每页</span>
                          <select
                            value={radarPageSize}
                            onChange={(e) => handleRadarPageSizeChange(Number(e.target.value))}
                            className="bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-9)] text-xs rounded px-1.5 py-0.5 outline-none focus:border-[var(--color-accent)] cursor-pointer"
                          >
                            <option value={4}>4 条</option>
                            <option value={5}>5 条</option>
                            <option value={8}>8 条</option>
                            <option value={10}>10 条</option>
                          </select>
                        </div>

                        {/* Navigation Buttons */}
                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={() => setRadarPage(1)}
                            disabled={radarPage <= 1}
                            className="p-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-subtle)] text-[var(--color-neutral-7)] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                            title="第一页"
                          >
                            <ChevronsLeft className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => setRadarPage(p => Math.max(1, p - 1))}
                            disabled={radarPage <= 1}
                            className="px-1.5 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-subtle)] text-[var(--color-neutral-7)] disabled:opacity-30 disabled:pointer-events-none transition-colors flex items-center gap-0.5 text-[11px] cursor-pointer"
                            title="上一页"
                          >
                            <ChevronLeft className="w-3 h-3" />
                            <span>上一页</span>
                          </button>

                          <div className="flex items-center gap-0.5 mx-0.5">
                            {getPageNumbers(radarPage, radarTotalPages).map((p, idx) => (
                              p === '...' ? (
                                <span key={`ellipsis-${idx}`} className="px-1 text-[var(--color-neutral-4)] select-none text-xs">...</span>
                              ) : (
                                <button
                                  key={p}
                                  onClick={() => setRadarPage(p)}
                                  className={`min-w-[24px] h-6 px-1 rounded text-xs tabular-nums transition-colors cursor-pointer ${
                                    radarPage === p
                                      ? 'bg-[var(--color-accent)] text-white font-medium shadow-xs'
                                      : 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-7)] hover:bg-[var(--color-surface-subtle)]'
                                  }`}
                                >
                                  {p}
                                </button>
                              )
                            ))}
                          </div>

                          <button
                            onClick={() => setRadarPage(p => Math.min(radarTotalPages, p + 1))}
                            disabled={radarPage >= radarTotalPages}
                            className="px-1.5 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-subtle)] text-[var(--color-neutral-7)] disabled:opacity-30 disabled:pointer-events-none transition-colors flex items-center gap-0.5 text-[11px] cursor-pointer"
                            title="下一页"
                          >
                            <span>下一页</span>
                            <ChevronRight className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => setRadarPage(radarTotalPages)}
                            disabled={radarPage >= radarTotalPages}
                            className="p-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-subtle)] text-[var(--color-neutral-7)] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                            title="最后一页"
                          >
                            <ChevronsRight className="w-3 h-3" />
                          </button>
                        </div>

                        {/* Jump form */}
                        <form onSubmit={handleRadarJump} className="flex items-center gap-1 ml-0.5">
                          <span className="text-[11px] text-[var(--color-neutral-5)]">跳至</span>
                          <input
                            type="number"
                            min={1}
                            max={radarTotalPages}
                            value={radarJumpPage}
                            onChange={(e) => setRadarJumpPage(e.target.value)}
                            placeholder={String(radarPage)}
                            className="w-10 bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-9)] text-xs rounded px-1 py-0.5 text-center outline-none focus:border-[var(--color-accent)] tabular-nums"
                          />
                          <span className="text-[11px] text-[var(--color-neutral-5)]">页</span>
                          <button
                            type="submit"
                            disabled={!radarJumpPage}
                            className="px-1.5 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-subtle)] text-[11px] text-[var(--color-neutral-8)] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                          >
                            跳转
                          </button>
                        </form>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: 客户与人脉台账 (Original Contact List preserved 100%) */}
        <div className="lg:col-span-4 yohaku-card p-5 flex flex-col justify-between h-[600px]">
          <div className="flex flex-col h-full min-h-0">
            {/* Header Title */}
            <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-[var(--color-border)] flex-shrink-0">
              <h3 className="text-xs font-mono uppercase tracking-wider text-[var(--color-neutral-8)] font-medium flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                <span>客户与人脉台账</span>
              </h3>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleOpenBatchModal}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono font-medium border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-subtle)] text-[var(--color-neutral-8)] shadow-2xs transition-all cursor-pointer"
                  title="打开客户 A/B/C/D 智能批量分级面板"
                >
                  <Zap className="w-3 h-3 text-amber-500" />
                  <span>批量分级</span>
                </button>
                <button
                  onClick={handleOpenReportList}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono font-medium bg-[var(--color-accent)] text-white hover:opacity-90 shadow-2xs transition-all cursor-pointer"
                  title="直接展开已总结的 AI 画像报告列表与详情"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>报告列表</span>
                </button>
              </div>
            </div>

            {/* Search Box */}
            <div className="relative mb-2 flex-shrink-0">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-neutral-5)]" />
              <input
                type="text"
                placeholder="搜索姓名、邮箱或域名..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-9)] text-xs rounded-md pl-8 pr-3 py-1.5 outline-none focus:border-[var(--color-accent)] transition-colors placeholder:text-[var(--color-neutral-5)]"
              />
            </div>

            {/* Tier Filter Pills */}
            <div className="flex items-center gap-1 mb-2 pb-1 overflow-x-auto text-[10px] font-mono scrollbar-none flex-shrink-0">
              {[
                { id: 'all', label: '全部' },
                { id: 'A', label: '⭐ A重点' },
                { id: 'B', label: '📈 B培育' },
                { id: 'C', label: '🌱 C孵化' },
                { id: 'overdue', label: '🚨 需跟进' }
              ].map((pill) => (
                <button
                  key={pill.id}
                  onClick={() => setSelectedTier(pill.id)}
                  className={`px-2 py-0.5 rounded-full whitespace-nowrap transition-all cursor-pointer ${
                    selectedTier === pill.id
                      ? 'bg-[var(--color-accent)] text-white font-medium shadow-2xs'
                      : 'bg-[var(--color-surface-subtle)] text-[var(--color-neutral-7)] hover:text-[var(--color-neutral-10)] border border-[var(--color-border)]'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            {/* Sorting Switcher */}
            <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-[var(--color-border)]/60 text-xs font-mono flex-shrink-0">
              <span className="text-[10px] text-[var(--color-neutral-6)] tabular-nums" title={`总共识别 ${totalContacts.toLocaleString()} 位联系人`}>
                {search.trim() || selectedTier !== 'all'
                  ? `匹配 ${totalContacts.toLocaleString()} 位 (已列出 ${contacts.length})`
                  : `已列出 ${contacts.length} 位 / 共 ${totalContacts.toLocaleString()} 位`}
              </span>
              <div className="inline-flex p-0.5 rounded-md bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[10px]">
                <button
                  onClick={() => setSortBy('weight')}
                  className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                    sortBy === 'weight'
                      ? 'bg-[var(--color-surface)] text-[var(--color-neutral-10)] shadow-xs font-medium'
                      : 'text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)]'
                  }`}
                >
                  按频次
                </button>
                <button
                  onClick={() => setSortBy('recent')}
                  className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                    sortBy === 'recent'
                      ? 'bg-[var(--color-surface)] text-[var(--color-neutral-10)] shadow-xs font-medium'
                      : 'text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)]'
                  }`}
                >
                  按最近
                </button>
              </div>
            </div>

            {/* Contacts Scrollable List */}
            <div className="space-y-1 overflow-y-auto flex-1 pr-1 divide-y divide-[var(--color-border)]/40">
              {contactLoading && contacts.length === 0 ? (
                <div className="py-20 text-center text-xs font-mono text-[var(--color-neutral-5)]">
                  正在加载联系人...
                </div>
              ) : contacts.length === 0 ? (
                <div className="py-20 text-center text-xs font-mono text-[var(--color-neutral-5)]">
                  未匹配到相关联系人
                </div>
              ) : (
                contacts.map((c) => {
                  const tier = c.tier || 'D';
                  return (
                    <div
                      key={c.id}
                      onClick={() => {
                        setIsReportOpenDirectly(false);
                        setSelectedContactForTimeline(c);
                      }}
                      className="pt-2 pb-1.5 px-2 rounded-lg cursor-pointer transition-all hover:bg-[var(--color-surface-subtle)] group flex items-center justify-between"
                      title="点击查看历史交流脉络流程图与CRM档案"
                    >
                      <div className="flex items-center space-x-2 min-w-0">
                        {/* Tier Mini Badge */}
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold font-mono flex-shrink-0 ${
                          tier === 'A' 
                            ? 'bg-red-500/15 text-red-600 border border-red-500/30' 
                            : tier === 'B' 
                            ? 'bg-blue-500/15 text-blue-600 border border-blue-500/30'
                            : tier === 'C'
                            ? 'bg-emerald-500/15 text-emerald-600'
                            : 'bg-[var(--color-neutral-3)] text-[var(--color-neutral-6)]'
                        }`}>
                          {tier}
                        </span>

                        <div className="min-w-0">
                          <div className="text-xs font-medium text-[var(--color-neutral-10)] truncate max-w-[125px] group-hover:text-[var(--color-accent)] transition-colors flex items-center gap-1">
                            <span>{c.name || c.email}</span>
                            {c.deal_stage && c.deal_stage !== 'lead' && (
                              <span className="text-[9px] px-1 py-0.2 rounded bg-[var(--color-neutral-3)] text-[var(--color-neutral-7)] font-mono">
                                {c.deal_stage}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-[var(--color-neutral-6)] font-mono truncate max-w-[125px]">
                            {c.domain || c.email}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0 font-mono">
                        <div className="text-right">
                          <div className="text-xs font-medium text-[var(--color-accent)] tabular-nums">
                            {c.inbound_count + c.outbound_count} 封
                          </div>
                          <div className="text-[9px] text-[var(--color-neutral-5)]">
                            {c.last_interaction ? c.last_interaction.slice(5) : `权重 ${c.weight.toFixed(1)}`}
                          </div>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-[var(--color-neutral-4)] group-hover:text-[var(--color-accent)] group-hover:translate-x-0.5 transition-all" />
                      </div>
                    </div>
                  );
                })
              )}
              {contacts.length > 0 && contacts.length < totalContacts && (
                <div className="pt-2 pb-2 text-center">
                  <button
                    onClick={() => loadContacts(true, page + 1)}
                    disabled={loadingMore}
                    className="w-full py-1.5 px-2 text-[11px] font-mono text-[var(--color-accent)] hover:bg-[var(--color-surface-subtle)] border border-dashed border-[var(--color-border)] rounded-md transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {loadingMore ? (
                      <span>正在加载下批联系人...</span>
                    ) : (
                      <span>加载更多联系人 (还有 {(totalContacts - contacts.length).toLocaleString()} 位)</span>
                    )}
                  </button>
                </div>
              )}
              {contacts.length > 0 && contacts.length >= totalContacts && (
                <div className="py-2.5 text-center text-[10px] font-mono text-[var(--color-neutral-5)]">
                  已展示全部 {totalContacts.toLocaleString()} 位联系人
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* AI Draft Modal */}
      {draftModalContact && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
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
                    已自动融合客户【{draftModalContact.tier} 级】画像与销售对策库高转化战术
                  </p>
                </div>
              </div>

              <button
                onClick={() => setDraftModalContact(null)}
                className="p-1 text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)] rounded-lg hover:bg-[var(--color-neutral-3)] cursor-pointer"
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
                  placeholder="输入补充要求 (例如: '重点询问样品反馈'、'告知下周原料要涨价5%')..."
                  value={customPromptHint}
                  onChange={(e) => setCustomPromptHint(e.target.value)}
                  className="flex-1 text-xs px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-neutral-1)] focus:outline-none focus:border-[var(--color-accent)]"
                />
                <button
                  disabled={isDrafting}
                  onClick={() => handleStartDraft(draftModalContact, customPromptHint)}
                  className="px-3 py-2 text-xs rounded-lg bg-[var(--color-neutral-3)] hover:bg-[var(--color-neutral-4)] text-[var(--color-neutral-8)] transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isDrafting ? 'animate-spin' : ''}`} />
                  <span>重新生成</span>
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
                  className="px-3 py-1.5 text-xs text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)] rounded-lg hover:bg-[var(--color-neutral-3)] transition-colors cursor-pointer"
                >
                  关闭
                </button>

                <button
                  onClick={handleCopyDraft}
                  disabled={!draftContent || isDrafting}
                  className="px-4 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 shadow-sm flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  {draftCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{draftCopied ? '已复制草稿' : '复制邮件草稿'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Batch Tiering Modal */}
      {batchModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-2xl max-w-xl w-full p-6 animate-in fade-in zoom-in-95 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between pb-3.5 border-b border-[var(--color-border)] flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center flex-shrink-0">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--color-neutral-10)]">
                    客户智能批量分级 (A / B / C / D)
                  </h3>
                  <p className="text-xs text-[var(--color-neutral-6)]">
                    基于发收频次与往来邮件深度，构建外贸客户分层
                  </p>
                </div>
              </div>

              {!isBatchRunning && (
                <button
                  onClick={() => setBatchModalOpen(false)}
                  className="p-1 rounded-lg text-[var(--color-neutral-5)] hover:text-[var(--color-neutral-9)] hover:bg-[var(--color-neutral-2)] transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>

            <div className="py-4 space-y-4 overflow-y-auto flex-1">
              {!isBatchRunning && !batchSummary && (
                <>
                  <div className="p-3.5 rounded-xl bg-[var(--color-surface-subtle)] border border-[var(--color-border)] space-y-2">
                    <div className="text-xs font-medium text-[var(--color-neutral-8)]">当前联系人分级概况</div>
                    {isStatsLoading ? (
                      <div className="py-3 text-center text-xs text-[var(--color-neutral-5)] font-mono">
                        统计中...
                      </div>
                    ) : (
                      <div className="grid grid-cols-4 gap-2 text-center text-xs font-mono">
                        <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                          <div className="text-[10px] text-red-600 font-bold">A 级</div>
                          <div className="text-base font-bold text-red-700">{tierStats?.tier_counts?.A ?? tierStats?.tier_a ?? 0}</div>
                        </div>
                        <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
                          <div className="text-[10px] text-blue-600 font-bold">B 级</div>
                          <div className="text-base font-bold text-blue-700">{tierStats?.tier_counts?.B ?? tierStats?.tier_b ?? 0}</div>
                        </div>
                        <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                          <div className="text-[10px] text-emerald-600 font-bold">C 级</div>
                          <div className="text-base font-bold text-emerald-700">{tierStats?.tier_counts?.C ?? tierStats?.tier_c ?? 0}</div>
                        </div>
                        <div className="p-2 rounded-lg bg-neutral-500/10 border border-neutral-500/20">
                          <div className="text-[10px] text-neutral-600 font-bold">未定/D级</div>
                          <div className="text-base font-bold text-neutral-700">
                            {(tierStats?.tier_counts?.D ?? tierStats?.tier_d ?? 0) + (tierStats?.unrated ?? 0)}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium text-[var(--color-neutral-8)]">评估范围与模式</div>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'all_funnel', label: '全量智能漏斗', desc: '全盘重评' },
                        { id: 'top_active', label: '高频活跃客群', desc: '前 30 名' },
                        { id: 'unrated', label: '仅评估未评级', desc: '增量补充' }
                      ].map(m => (
                        <button
                          key={m.id}
                          onClick={() => setBatchMode(m.id)}
                          className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                            batchMode === m.id
                              ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5 ring-1 ring-[var(--color-accent)]'
                              : 'border-[var(--color-border)] hover:bg-[var(--color-surface-subtle)]'
                          }`}
                        >
                          <div className="text-xs font-medium text-[var(--color-neutral-9)]">{m.label}</div>
                          <div className="text-[10px] text-[var(--color-neutral-5)] mt-0.5">{m.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {isBatchRunning && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-mono text-[var(--color-neutral-7)]">
                      <span>{batchProgress?.current || '正在评估...'}</span>
                      <span>
                        {batchProgress?.processed || 0} / {batchProgress?.total || 1}
                      </span>
                    </div>
                    <div className="h-2 w-full bg-[var(--color-neutral-2)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[var(--color-accent)] transition-all duration-300 rounded-full"
                        style={{
                          width: `${Math.min(100, Math.round(((batchProgress?.processed || 0) / (batchProgress?.total || 1)) * 100))}%`
                        }}
                      />
                    </div>
                  </div>

                  <div className="h-44 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-neutral-1)] p-2.5 font-mono text-[11px] space-y-1">
                    {batchLogs.map(log => (
                      <div key={log.id} className="text-[var(--color-neutral-7)]">
                        {log.name ? `[${log.tier}级] ${log.name} (${log.email}): ${log.reason}` : log.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {batchSummary && (
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 text-xs flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    <span>智能分级已完成！耗时 {batchDuration || 0} 秒</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center text-xs font-mono">
                    <div className="p-2 rounded bg-red-500/10">A级: {batchSummary.A || 0}</div>
                    <div className="p-2 rounded bg-blue-500/10">B级: {batchSummary.B || 0}</div>
                    <div className="p-2 rounded bg-emerald-500/10">C级: {batchSummary.C || 0}</div>
                    <div className="p-2 rounded bg-neutral-500/10">D级: {batchSummary.D || 0}</div>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-[var(--color-border)] flex items-center justify-between">
              {isBatchRunning ? (
                <button
                  onClick={handleStopBatchTiering}
                  className="px-3 py-1.5 text-xs text-red-600 bg-red-500/10 rounded-lg hover:bg-red-500/20 transition-colors cursor-pointer"
                >
                  终止评估
                </button>
              ) : batchSummary ? (
                <button
                  onClick={() => setBatchModalOpen(false)}
                  className="ml-auto px-4 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 cursor-pointer"
                >
                  完成
                </button>
              ) : (
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    onClick={() => setBatchModalOpen(false)}
                    className="px-3 py-1.5 text-xs text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)] cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => handleRunBatchTiering()}
                    className="px-4 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Zap className="w-3.5 h-3.5 text-amber-300" />
                    <span>开始智能分级</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Contact Timeline Drawer */}
      <ContactTimelineDrawer
        contact={selectedContactForTimeline}
        isOpen={!!selectedContactForTimeline}
        onClose={handleCloseTimeline}
        onSelectEmail={onSelectEmail}
        onSelectContact={handleSelectContact}
        defaultReportOpen={isReportOpenDirectly}
        sortBy={sortBy}
        onTierUpdated={() => {
          loadContacts();
          loadRadar();
        }}
        selectedAccount={selectedAccount}
      />
    </div>
  );
}
