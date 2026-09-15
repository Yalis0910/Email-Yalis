import React, { useState, useEffect, useMemo } from 'react';
import { 
  BookOpen, 
  Search, 
  Plus, 
  Copy, 
  Check, 
  Edit2, 
  Trash2, 
  Sparkles, 
  Tag, 
  Lightbulb, 
  FileText, 
  X, 
  CheckCircle2, 
  AlertCircle,
  TrendingUp,
  RefreshCw,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

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

const SCENARIOS = [
  { id: 'all', label: '全部话术', icon: '📚' },
  { id: 'cold_outreach', label: '破冰开发', icon: '🌐', desc: '新客建联、价值切入与痛点破冰开发信' },
  { id: 'objection_price', label: '价格异议', icon: '💰', desc: '客户嫌贵、要求大幅降价、预算超支应对' },
  { id: 'payment_terms', label: '账期付款', icon: '📅', desc: 'OA 60/90天要求、不愿付定金、信用证条款抗辩' },
  { id: 'delivery_leadtime', label: '交期交付', icon: '⏱️', desc: '交期紧迫、赶船期、样品/大货加急协调' },
  { id: 'competitor', label: '竞品对抗', icon: '🥊', desc: '对手低价恶意竞争、参数对比与差异化胜出' },
  { id: 'reactivation', label: '沉默激活', icon: '🧊', desc: '报价后已读不回、长期断联客户破冰激活' },
  { id: 'closing', label: '成单锦囊', icon: '🏆', desc: '临门一脚催促定金、锁单保价与确认PI' },
  { id: 'after_sales', label: '售后客诉', icon: '🛡️', desc: '货损索赔、退款博弈与品质抗辩快反通道' },
  { id: 'custom', label: '自定义实战', icon: '✍️', desc: '业务团队日常沉淀的行业特色回复锦囊' },
];

const SCENARIO_MAP = Object.fromEntries(SCENARIOS.map(s => [s.id, s]));

export default function SalesPlaybook() {
  const { hasActionPermission, isSuperadmin } = useAuth();
  const canEdit = isSuperadmin || hasActionPermission('action:system_ops') || true; // Sales reps can manage playbooks

  const [playbooks, setPlaybooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedScenario, setSelectedScenario] = useState('all');
  const [copiedId, setCopiedId] = useState(null);
  const [expandedIds, setExpandedIds] = useState(new Set());

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create'); // 'create' | 'edit'
  const [editingPlaybook, setEditingPlaybook] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const [formData, setFormData] = useState({
    title: '',
    scenario_type: 'objection_price',
    trigger_patterns_str: '',
    response_strategy: '',
    template_text: ''
  });

  useEffect(() => {
    loadPlaybooks();
  }, []);

  const toggleExpand = (id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const loadPlaybooks = async () => {
    setLoading(true);
    try {
      const data = await api.getSalesPlaybooks();
      setPlaybooks(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load playbooks:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyTemplate = (e, id, text) => {
    e?.stopPropagation?.();
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId(null);
    }, 2000);
  };

  const openCreateModal = () => {
    setModalMode('create');
    setEditingPlaybook(null);
    setFormData({
      title: '',
      scenario_type: selectedScenario === 'all' ? 'objection_price' : selectedScenario,
      trigger_patterns_str: '',
      response_strategy: '',
      template_text: ''
    });
    setFormError('');
    setIsModalOpen(true);
  };

  const openEditModal = (pb) => {
    setModalMode('edit');
    setEditingPlaybook(pb);
    const patterns = Array.isArray(pb.trigger_patterns) 
      ? pb.trigger_patterns.join(', ') 
      : (pb.trigger_pattern || pb.trigger_patterns || '');
    const template = pb.reply_template || pb.template_text || '';
    setFormData({
      title: pb.title || '',
      scenario_type: pb.scenario_type || 'custom',
      trigger_patterns_str: patterns,
      response_strategy: pb.response_strategy || '',
      template_text: template
    });
    setFormError('');
    setIsModalOpen(true);
  };

  const handleInsertPlaceholder = (ph) => {
    setFormData(prev => ({
      ...prev,
      template_text: prev.template_text + ph
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.title.trim()) {
      setFormError('请输入话术标题');
      return;
    }
    if (!formData.template_text.trim()) {
      setFormError('请输入回复模版内容');
      return;
    }

    const patterns = formData.trigger_patterns_str
      .split(/[,，\n]/)
      .map(p => p.trim())
      .filter(Boolean);

    const payload = {
      title: formData.title.trim(),
      scenario_type: formData.scenario_type,
      trigger_pattern: patterns.join(', '),
      trigger_patterns: patterns,
      response_strategy: formData.response_strategy.trim(),
      reply_template: formData.template_text.trim(),
      template_text: formData.template_text.trim()
    };

    setSubmitting(true);
    setFormError('');
    try {
      if (modalMode === 'create') {
        const created = await api.createSalesPlaybook(payload);
        setPlaybooks(prev => [created, ...prev]);
      } else {
        const updated = await api.updateSalesPlaybook(editingPlaybook.id, payload);
        setPlaybooks(prev => prev.map(p => p.id === updated.id ? updated : p));
      }
      setIsModalOpen(false);
    } catch (err) {
      setFormError(err.message || '保存失败，请检查网络');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.deleteSalesPlaybook(id);
      setPlaybooks(prev => prev.filter(p => p.id !== id));
      setDeleteConfirmId(null);
    } catch (err) {
      alert('删除失败: ' + err.message);
    }
  };

  // Filtered list
  const filteredPlaybooks = useMemo(() => {
    return playbooks.filter(pb => {
      if (selectedScenario !== 'all' && pb.scenario_type !== selectedScenario) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const matchTitle = pb.title?.toLowerCase().includes(q);
      const matchStrategy = pb.response_strategy?.toLowerCase().includes(q);
      const template = pb.reply_template || pb.template_text || '';
      const matchTemplate = template.toLowerCase().includes(q);
      const patterns = Array.isArray(pb.trigger_patterns) 
        ? pb.trigger_patterns.join(' ') 
        : (pb.trigger_pattern || pb.trigger_patterns || '');
      const matchPattern = patterns.toLowerCase().includes(q);
      return matchTitle || matchStrategy || matchTemplate || matchPattern;
    });
  }, [playbooks, selectedScenario, searchQuery]);

  // Counts by scenario
  const scenarioCounts = useMemo(() => {
    const counts = { all: playbooks.length };
    SCENARIOS.forEach(s => {
      if (s.id !== 'all') {
        counts[s.id] = playbooks.filter(p => p.scenario_type === s.id).length;
      }
    });
    return counts;
  }, [playbooks]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedScenario, searchQuery]);

  const totalItems = filteredPlaybooks.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const pagedPlaybooks = filteredPlaybooks.slice(startIndex, endIndex);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 max-w-7xl mx-auto w-full space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[var(--color-border)] pb-6">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <span className="p-2 rounded-xl bg-amber-500/10 text-amber-600 border border-amber-500/20">
              <BookOpen className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-neutral-9)]">
              外贸实战话术与异议应答库
            </h1>
            <span className="px-2 py-0.5 rounded-full text-xs font-mono font-medium bg-[var(--color-surface-hover)] text-[var(--color-neutral-6)] border border-[var(--color-border)]">
              Sales Playbook
            </span>
          </div>
          <p className="text-sm text-[var(--color-neutral-6)]">
            沉淀高胜率外贸谈判、价格博弈与催款逼单战术。在 AI 撰写回信与 Copilot 问答时，系统将智能检索并注入最匹配的话术！
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={loadPlaybooks}
            disabled={loading}
            className="p-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-[var(--color-neutral-7)] transition-colors"
            title="刷新话术库"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {canEdit && (
            <button
              onClick={openCreateModal}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-neutral-9)] hover:opacity-90 text-[var(--color-surface)] text-sm font-medium transition-all shadow-sm active:scale-[0.98]"
            >
              <Plus className="w-4 h-4" />
              <span>新增实战话术</span>
            </button>
          )}
        </div>
      </div>

      {/* AI Synergy Callout Card */}
      <div className="p-4 rounded-xl border border-indigo-500/20 bg-gradient-to-r from-indigo-500/5 via-amber-500/5 to-transparent flex items-start gap-3.5">
        <Sparkles className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
        <div className="text-xs text-[var(--color-neutral-7)] leading-relaxed space-y-1">
          <p className="font-semibold text-[var(--color-neutral-9)]">
            🤖 AI 自动感知与策略注入已开启
          </p>
          <p>
            当客户在邮件中表达 <span className="font-mono text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 px-1 py-0.5 rounded">"target price / too high"</span>、
            <span className="font-mono text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 px-1 py-0.5 rounded">"payment terms / OA"</span> 或 
            <span className="font-mono text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 px-1 py-0.5 rounded">"urgent delivery"</span> 时，
            AI 在一键草拟回复时会自动匹配并采用以下策略模板，大幅降低新人谈单门槛并提升成单转化率。
          </p>
        </div>
      </div>

      {/* Controls: Search & Category Tabs */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-[var(--color-neutral-4)] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索标题、触发关键词、应对战术或回复内容..."
              className="w-full pl-9 pr-8 py-2 rounded-lg text-sm bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-9)] placeholder-[var(--color-neutral-4)] focus:outline-none focus:ring-1 focus:ring-[var(--color-neutral-9)] transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-neutral-4)] hover:text-[var(--color-neutral-7)]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="text-xs text-[var(--color-neutral-5)] font-mono">
            共收录 <span className="font-bold text-[var(--color-neutral-9)]">{filteredPlaybooks.length}</span> 条实战锦囊
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {SCENARIOS.map(sc => {
            const isSelected = selectedScenario === sc.id;
            const count = scenarioCounts[sc.id] || 0;
            return (
              <button
                key={sc.id}
                onClick={() => setSelectedScenario(sc.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all border ${
                  isSelected
                    ? 'bg-[var(--color-neutral-9)] text-[var(--color-surface)] border-[var(--color-neutral-9)] shadow-sm'
                    : 'bg-[var(--color-surface)] text-[var(--color-neutral-6)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                <span>{sc.icon}</span>
                <span>{sc.label}</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  isSelected 
                    ? 'bg-white/20 text-white' 
                    : 'bg-[var(--color-surface-hover)] text-[var(--color-neutral-5)]'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Playbooks Grid */}
      {loading ? (
        <div className="py-24 text-center">
          <RefreshCw className="w-8 h-8 mx-auto animate-spin text-[var(--color-neutral-4)] mb-3" />
          <p className="text-sm text-[var(--color-neutral-5)]">加载话术策略库中...</p>
        </div>
      ) : filteredPlaybooks.length === 0 ? (
        <div className="py-20 text-center border border-dashed border-[var(--color-border)] rounded-2xl bg-[var(--color-surface)] p-8">
          <FolderOpen className="w-10 h-10 text-[var(--color-neutral-4)] mx-auto mb-3" />
          <p className="text-base font-medium text-[var(--color-neutral-8)]">未找到匹配的话术模版</p>
          <p className="text-xs text-[var(--color-neutral-5)] mt-1 max-w-sm mx-auto">
            {searchQuery ? '换个关键词试试，或清空搜索条件' : '当前分类暂无话术，点击右上角即可新增你的实战经验！'}
          </p>
          {canEdit && !searchQuery && (
            <button
              onClick={openCreateModal}
              className="mt-4 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-[var(--color-neutral-9)] text-[var(--color-surface)] text-xs font-medium"
            >
              <Plus className="w-3.5 h-3.5" />
              创建第一条话术
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {pagedPlaybooks.map(pb => {
            const scenarioInfo = SCENARIO_MAP[pb.scenario_type] || { label: pb.scenario_type, icon: '💡' };
            const patterns = Array.isArray(pb.trigger_patterns) 
              ? pb.trigger_patterns 
              : (typeof pb.trigger_patterns === 'string' ? JSON.parse(pb.trigger_patterns || '[]') : (pb.trigger_pattern ? pb.trigger_pattern.split(',').map(s => s.trim()).filter(Boolean) : []));
            const template = pb.reply_template || pb.template_text || '';
            const isCopied = copiedId === pb.id;
            const isExpanded = expandedIds.has(pb.id);

            return (
              <div 
                key={pb.id}
                className="flex flex-col bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-3.5 hover:border-[var(--color-neutral-4)] transition-all shadow-xs group space-y-2.5"
              >
                {/* Header: Scenario, Update Date & Actions */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                      <span>{scenarioInfo.icon}</span>
                      <span>{scenarioInfo.label}</span>
                    </span>

                    <span className="text-[11px] text-[var(--color-neutral-5)] font-mono">
                      更新于: {pb.updated_at ? pb.updated_at.split(' ')[0] : '系统预设'}
                    </span>

                    {pb.win_rate_boost && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        <TrendingUp className="w-3 h-3" />
                        {pb.win_rate_boost}
                      </span>
                    )}

                    {pb.source_deal_id && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-500/10 text-indigo-600 border border-indigo-500/20" title="从成交订单复盘提炼生成">
                        <Sparkles className="w-2.5 h-2.5" />
                        复盘提炼
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => handleCopyTemplate(e, pb.id, template)}
                      disabled={!template}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium transition-all ${
                        isCopied
                          ? 'bg-emerald-500 text-white shadow-xs'
                          : 'border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-neutral-7)] disabled:opacity-40 disabled:cursor-not-allowed'
                      }`}
                      title={template ? "复制模版正文" : "暂无可复制模版"}
                    >
                      {isCopied ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>已复制</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>复制</span>
                        </>
                      )}
                    </button>

                    {canEdit && (
                      <>
                        <button
                          onClick={() => openEditModal(pb)}
                          className="p-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-neutral-6)] transition-colors"
                          title="编辑"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        
                        {deleteConfirmId === pb.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDelete(pb.id)}
                              className="px-2 py-0.5 rounded bg-rose-500 text-white text-[11px] font-medium"
                            >
                              确认
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(null)}
                              className="px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[11px]"
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirmId(pb.id)}
                            className="p-1 rounded-md border border-[var(--color-border)] hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30 text-[var(--color-neutral-5)] transition-colors"
                            title="删除"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <h3 className="text-sm font-bold text-[var(--color-neutral-9)] leading-snug">
                  {pb.title}
                </h3>

                {/* Trigger Pattern Badges */}
                {patterns.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Tag className="w-3 h-3 text-[var(--color-neutral-4)] shrink-0" />
                    {patterns.map((pt, idx) => (
                      <span 
                        key={idx}
                        className="px-1.5 py-0.2 rounded text-[10.5px] font-mono bg-[var(--color-surface-hover)] text-[var(--color-neutral-7)] border border-[var(--color-border)]"
                      >
                        {pt}
                      </span>
                    ))}
                  </div>
                )}

                {/* Strategy Box */}
                {pb.response_strategy && (
                  <div className="px-3 py-2 rounded-lg bg-[var(--color-surface-hover)]/60 border border-[var(--color-border)] text-xs text-[var(--color-neutral-8)]">
                    <div className="flex items-start gap-1.5">
                      <Lightbulb className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                      <p className="leading-relaxed font-sans text-[var(--color-neutral-7)]">
                        <span className="font-semibold text-[var(--color-neutral-9)] mr-1">核心战术:</span>
                        {pb.response_strategy}
                      </p>
                    </div>
                  </div>
                )}

                {/* Collapsible Template Section */}
                <div>
                  <button
                    type="button"
                    onClick={() => toggleExpand(pb.id)}
                    className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg bg-[var(--color-surface-hover)]/70 hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-xs text-[var(--color-neutral-7)] transition-all cursor-pointer group/btn"
                  >
                    <span className="flex items-center gap-1.5 font-medium text-[var(--color-neutral-8)]">
                      <FileText className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                      <span>{isExpanded ? '收起模版范文' : '展开推荐回复模版'}</span>
                      {template && (
                        <span className="text-[10px] font-mono text-[var(--color-neutral-5)]">
                          ({template.length} 字符)
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-1 text-[11px] text-[var(--color-neutral-5)] group-hover/btn:text-[var(--color-neutral-8)]">
                      <span>{isExpanded ? '收起' : '查看范文'}</span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="mt-2 space-y-1.5 animate-in fade-in duration-150">
                      <div className="flex items-center justify-between text-[11px] px-1 text-[var(--color-neutral-6)]">
                        <span className="font-semibold text-[var(--color-neutral-8)] flex items-center gap-1">
                          📝 官方推荐回复范文 (Email Template)
                        </span>
                        <button
                          onClick={(e) => handleCopyTemplate(e, pb.id, template)}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
                            isCopied
                              ? 'bg-emerald-500 text-white'
                              : 'border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-[var(--color-neutral-7)]'
                          }`}
                        >
                          {isCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          <span>{isCopied ? '已复制' : '复制此模版'}</span>
                        </button>
                      </div>
                      <div className="relative rounded-lg bg-[var(--color-bg)]/90 border border-[var(--color-border)] p-3 text-xs font-mono text-[var(--color-neutral-8)] leading-relaxed whitespace-pre-wrap max-h-52 overflow-y-auto select-text shadow-inner">
                        {template || '（暂无模版正文，点击右上角编辑补充）'}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Pagination Toolbar */}
        {totalItems > pageSize && (
          <div className="pt-3 border-t border-[var(--color-border)] flex flex-wrap items-center justify-between gap-y-2 gap-x-4 text-xs text-[var(--color-neutral-6)]">
            <div className="flex items-center gap-2 whitespace-nowrap shrink-0">
              <span>显示第 <strong className="font-mono text-[var(--color-neutral-9)]">{startIndex + 1} - {endIndex}</strong> 条，共 <strong className="font-mono text-[var(--color-neutral-9)]">{totalItems}</strong> 条话术</span>
              <span className="text-[var(--color-neutral-4)]">|</span>
              <div className="flex items-center gap-1">
                <span>每页:</span>
                {[4, 6, 10, 20].map(size => (
                  <button
                    key={size}
                    onClick={() => {
                      setPageSize(size);
                      setCurrentPage(1);
                    }}
                    className={`px-1.5 py-0.5 rounded font-mono text-[11px] transition-colors cursor-pointer ${
                      pageSize === size 
                        ? 'bg-[var(--color-neutral-9)] text-[var(--color-surface)] font-bold' 
                        : 'hover:bg-[var(--color-surface-hover)] text-[var(--color-neutral-6)]'
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
                className="p-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-[var(--color-neutral-7)] cursor-pointer"
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
                          ? 'bg-[var(--color-neutral-9)] text-[var(--color-surface)] font-bold shadow-xs'
                          : 'hover:bg-[var(--color-surface-hover)] text-[var(--color-neutral-7)]'
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
                className="p-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-[var(--color-neutral-7)] cursor-pointer"
                title="下一页"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    )}

      {/* Create / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-amber-500" />
                <h2 className="text-base font-bold text-[var(--color-neutral-9)]">
                  {modalMode === 'create' ? '新增实战话术策略' : '编辑话术策略'}
                </h2>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg text-[var(--color-neutral-5)] hover:text-[var(--color-neutral-9)] hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4 flex-1">
              {formError && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Scenario Type */}
              <div>
                <label className="block text-xs font-semibold text-[var(--color-neutral-8)] mb-1.5">
                  异议 / 谈判场景分类
                </label>
                <select
                  value={formData.scenario_type}
                  onChange={e => setFormData({ ...formData, scenario_type: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg text-sm bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-9)] focus:outline-none focus:ring-1 focus:ring-[var(--color-neutral-9)]"
                >
                  {SCENARIOS.filter(s => s.id !== 'all').map(s => (
                    <option key={s.id} value={s.id}>
                      {s.icon} {s.label} - {s.desc}
                    </option>
                  ))}
                </select>
              </div>

              {/* Title */}
              <div>
                <label className="block text-xs font-semibold text-[var(--color-neutral-8)] mb-1.5">
                  话术标题 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={e => setFormData({ ...formData, title: e.target.value })}
                  placeholder="例如：客户以竞品低价威胁时：价值拆解与认证背书反击"
                  className="w-full px-3 py-2 rounded-lg text-sm bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-9)] focus:outline-none focus:ring-1 focus:ring-[var(--color-neutral-9)]"
                />
              </div>

              {/* Trigger Patterns */}
              <div>
                <label className="block text-xs font-semibold text-[var(--color-neutral-8)] mb-1.5">
                  触发关键词 (逗号或换行分隔，AI 检测到此词汇时将自动匹配)
                </label>
                <input
                  type="text"
                  value={formData.trigger_patterns_str}
                  onChange={e => setFormData({ ...formData, trigger_patterns_str: e.target.value })}
                  placeholder="如: competitor quote, cheaper price, other supplier, 降价"
                  className="w-full px-3 py-2 rounded-lg text-sm font-mono bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-9)] focus:outline-none focus:ring-1 focus:ring-[var(--color-neutral-9)]"
                />
              </div>

              {/* Response Strategy */}
              <div>
                <label className="block text-xs font-semibold text-[var(--color-neutral-8)] mb-1.5">
                  核心应答战术思路 (业务代表与 AI 应掌握的心理博弈策略)
                </label>
                <textarea
                  rows={2}
                  value={formData.response_strategy}
                  onChange={e => setFormData({ ...formData, response_strategy: e.target.value })}
                  placeholder="简述核心论点：不盲目降价、指出低价竞品在材质/质检/寿命上的隐性短板，提供梯度采购方案..."
                  className="w-full px-3 py-2 rounded-lg text-xs bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-9)] focus:outline-none focus:ring-1 focus:ring-[var(--color-neutral-9)] leading-relaxed"
                />
              </div>

              {/* Template Text */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-[var(--color-neutral-8)]">
                    实战邮件模版内容 (中英双语 / 英文) <span className="text-rose-500">*</span>
                  </label>
                  <div className="flex items-center gap-1 text-[11px] text-[var(--color-neutral-5)]">
                    <span>快捷占位符:</span>
                    <button
                      type="button"
                      onClick={() => handleInsertPlaceholder('{{customer_name}}')}
                      className="px-1.5 py-0.5 rounded bg-[var(--color-surface-hover)] hover:bg-[var(--color-border)] text-[var(--color-neutral-7)] font-mono"
                    >
                      客户名
                    </button>
                    <button
                      type="button"
                      onClick={() => handleInsertPlaceholder('{{product_name}}')}
                      className="px-1.5 py-0.5 rounded bg-[var(--color-surface-hover)] hover:bg-[var(--color-border)] text-[var(--color-neutral-7)] font-mono"
                    >
                      产品
                    </button>
                    <button
                      type="button"
                      onClick={() => handleInsertPlaceholder('{{discount_percent}}%')}
                      className="px-1.5 py-0.5 rounded bg-[var(--color-surface-hover)] hover:bg-[var(--color-border)] text-[var(--color-neutral-7)] font-mono"
                    >
                      折扣率
                    </button>
                  </div>
                </div>
                <textarea
                  rows={8}
                  value={formData.template_text}
                  onChange={e => setFormData({ ...formData, template_text: e.target.value })}
                  placeholder="输入完整实战应答模版..."
                  className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-9)] focus:outline-none focus:ring-1 focus:ring-[var(--color-neutral-9)] leading-relaxed"
                />
              </div>

              <div className="pt-3 border-t border-[var(--color-border)] flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-[var(--color-border)] text-xs text-[var(--color-neutral-7)] hover:bg-[var(--color-surface-hover)]"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-lg bg-[var(--color-neutral-9)] text-[var(--color-surface)] text-xs font-semibold hover:opacity-90 transition-all flex items-center gap-1.5"
                >
                  {submitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{modalMode === 'create' ? '立即保存话术' : '更新话术'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
