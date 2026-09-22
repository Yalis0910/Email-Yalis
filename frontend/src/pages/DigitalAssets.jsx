import React, { useState, useEffect } from 'react';
import { 
  Search, 
  Download, 
  Layers, 
  CreditCard, 
  ExternalLink, 
  Check,
  Sparkles,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight
} from 'lucide-react';
import { api } from '../api/client';

const CATEGORIES = [
  { key: '', label: '全部' },
  { key: 'dev_ops', label: '开发运维' },
  { key: 'ai_tools', label: 'AI 工具' },
  { key: 'productivity', label: '协同办公' },
  { key: 'finance', label: '财务支付' },
  { key: 'entertainment', label: '影音娱乐' },
  { key: 'ecommerce', label: '电商消费' },
  { key: 'social', label: '社交人脉' },
  { key: 'other', label: '其他平台' },
];

const CATEGORY_LABEL_MAP = Object.fromEntries(CATEGORIES.map(c => [c.key, c.label]));

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

export default function DigitalAssets({ selectedAccount, onSelectEmail }) {
  const [activeSubTab, setActiveSubTab] = useState('assets'); // 'assets' | 'subscriptions'
  const [assets, setAssets] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [jumpPage, setJumpPage] = useState('');
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ assets: 0, subscriptions: 0 });
  const [categoryCounts, setCategoryCounts] = useState({});
  const [isScanningAI, setIsScanningAI] = useState(false);

  // Prefetch baseline counts for both tabs and category distribution on account change or mount
  useEffect(() => {
    setPage(1);
    loadTabCounts();
  }, [selectedAccount]);

  const loadTabCounts = async () => {
    try {
      const [assetsRes, subsRes, catsRes] = await Promise.all([
        api.getDigitalAssets({ account_id: selectedAccount || '', limit: 1 }),
        api.getSubscriptions({ account_id: selectedAccount || '', limit: 1 }),
        api.getDigitalAssetCategories(selectedAccount || '')
      ]);
      setCounts({
        assets: assetsRes?.total || 0,
        subscriptions: Array.isArray(subsRes) ? subsRes.length : (subsRes?.total || 0)
      });
      const catMap = {};
      (catsRes || []).forEach(item => {
        catMap[item.category] = item.count;
      });
      setCategoryCounts(catMap);
    } catch (err) {
      console.error('Failed to load asset counts:', err);
    }
  };

  useEffect(() => {
    if (activeSubTab === 'assets') {
      loadAssets();
    } else {
      loadSubscriptions();
    }
  }, [selectedAccount, activeSubTab, selectedCategory, search, page, pageSize]);

  const loadAssets = async () => {
    try {
      setLoading(true);
      const res = await api.getDigitalAssets({
        account_id: selectedAccount || '',
        category: selectedCategory,
        search,
        page,
        limit: pageSize
      });
      setAssets(res.items || []);
      setTotal(res.total || 0);
      if (!search && !selectedCategory) {
        setCounts(prev => ({ ...prev, assets: res.total || 0 }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadSubscriptions = async () => {
    try {
      setLoading(true);
      const res = await api.getSubscriptions({
        account_id: selectedAccount || '',
        search,
        page,
        limit: pageSize
      });
      if (Array.isArray(res)) {
        setSubscriptions(res);
        setTotal(res.length);
        if (!search) {
          setCounts(prev => ({ ...prev, subscriptions: res.length }));
        }
      } else {
        setSubscriptions(res.items || []);
        setTotal(res.total || 0);
        if (!search) {
          setCounts(prev => ({ ...prev, subscriptions: res.total || 0 }));
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages && newPage !== page) {
      setPage(newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handlePageSizeChange = (newSize) => {
    setPageSize(newSize);
    setPage(1);
  };

  const handleJump = (e) => {
    e.preventDefault();
    const p = parseInt(jumpPage, 10);
    if (!isNaN(p) && p >= 1 && p <= totalPages) {
      handlePageChange(p);
      setJumpPage('');
    }
  };

  const handleExport = () => {
    const url = api.getExportAssetsUrl(selectedAccount);
    window.open(url, '_blank');
  };

  const handleScanAI = async () => {
    try {
      setIsScanningAI(true);
      const res = await api.scanAssetsWithAI(selectedAccount);
      if (res.error) {
        alert('AI 扫描失败: ' + res.error);
      } else {
        const newAssetCount = (res.new_assets || []).length;
        const newSubCount = (res.new_subscriptions || []).length;
        alert(`AI 扫描完成！共分析候选邮件 ${res.scanned_count} 封，新补全挖掘出 ${newAssetCount} 个 SaaS 资产与 ${newSubCount} 条订阅账单！`);
        await loadTabCounts();
        if (activeSubTab === 'assets') {
          await loadAssets();
        } else {
          await loadSubscriptions();
        }
      }
    } catch (err) {
      alert('AI 扫描出错: ' + err.message);
    } finally {
      setIsScanningAI(false);
    }
  };

  return (
    <div className="space-y-6 pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2 border-b border-[var(--color-border)] pb-4 pt-2">
        <div>
          <h1 className="text-2xl sm:text-3xl font-serif font-normal text-[var(--color-neutral-10)] tracking-tight">
            账号服务与订阅台账
          </h1>
          <p className="text-xs font-serif text-[var(--color-neutral-6)] mt-1">
            由邮件系统启发式规则与 AI 大模型深度解析的平台凭据与经常性财务账单。
          </p>
        </div>

        <div className="flex items-center gap-2 self-start">
          <button
            onClick={handleScanAI}
            disabled={isScanningAI}
            className="yohaku-btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5 disabled:opacity-50"
            title="利用大模型从模糊或长尾邮件中深度提取 SaaS 资产与消费账单"
          >
            <Sparkles className={`w-3.5 h-3.5 ${isScanningAI ? 'animate-spin' : ''}`} />
            <span>{isScanningAI ? 'AI 深度扫描中...' : '✨ AI 深度扫描补全'}</span>
          </button>

          <button
            onClick={handleExport}
            className="yohaku-btn-secondary px-3 py-1.5 text-xs flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>导出 CSV 台账</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 min-w-0">
        {/* Subtabs */}
        <div className="flex p-1 rounded-lg bg-[var(--color-surface-subtle)] border border-[var(--color-border)] max-w-full overflow-x-auto">
          <button
            onClick={() => { setActiveSubTab('assets'); setPage(1); setJumpPage(''); }}
            className={`flex-1 sm:flex-initial text-center whitespace-nowrap px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              activeSubTab === 'assets'
                ? 'bg-[var(--color-surface)] text-[var(--color-neutral-10)] shadow-sm'
                : 'text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)]'
            }`}
          >
            SaaS 与服务账号 ({activeSubTab === 'assets' && (search || selectedCategory) ? total : counts.assets})
          </button>
          <button
            onClick={() => { setActiveSubTab('subscriptions'); setPage(1); setJumpPage(''); }}
            className={`flex-1 sm:flex-initial text-center whitespace-nowrap px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              activeSubTab === 'subscriptions'
                ? 'bg-[var(--color-surface)] text-[var(--color-neutral-10)] shadow-sm'
                : 'text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)]'
            }`}
          >
            经常性扣费与订阅 ({activeSubTab === 'subscriptions' && search ? total : counts.subscriptions})
          </button>
        </div>

        {/* Search Input */}
        <div className="relative w-full md:w-64">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-neutral-5)]" />
          <input
            type="text"
            placeholder={activeSubTab === 'assets' ? "按服务名、域名检索..." : "按订阅项目检索..."}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-9)] text-xs rounded-md pl-8 pr-3 py-1.5 outline-none focus:border-[var(--color-accent)] transition-colors"
          />
        </div>
      </div>

      {/* Category Pills */}
      {activeSubTab === 'assets' && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full scrollbar-none">
          {CATEGORIES.map((cat) => {
            const catCount = cat.key === '' ? counts.assets : (categoryCounts[cat.key] || 0);
            return (
              <button
                key={cat.key}
                onClick={() => { setSelectedCategory(cat.key); setPage(1); }}
                className={`px-2.5 py-1 rounded-md text-xs font-mono transition-all flex items-center gap-1.5 ${
                  selectedCategory === cat.key
                    ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-accent-border)] font-medium'
                    : 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)]'
                }`}
              >
                <span>{cat.label}</span>
                <span className="text-[10px] tabular-nums opacity-75">
                  ({catCount})
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Main Content Area */}
      {loading ? (
        <div className="py-20 text-center">
          <div className="w-5 h-5 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-mono text-[var(--color-neutral-6)] mt-2">正在载入台账...</p>
        </div>
      ) : activeSubTab === 'assets' ? (
        assets.length === 0 ? (
          <div className="yohaku-card p-12 text-center text-xs text-[var(--color-neutral-5)] font-mono">
            未检索到匹配的数字服务资产
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {assets.map((item) => (
              <div key={item.id} className="yohaku-card p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-9 h-9 rounded-md bg-[var(--color-surface-subtle)] border border-[var(--color-border)] flex items-center justify-center text-xs font-mono font-bold text-[var(--color-accent)]">
                        {item.platform_name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="text-sm font-medium text-[var(--color-neutral-10)]">
                          {item.platform_name}
                        </h3>
                        {item.domain && (
                          <a
                            href={`https://${item.domain}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] font-mono text-[var(--color-neutral-6)] hover:text-[var(--color-accent)] flex items-center gap-1"
                          >
                            <span>{item.domain}</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                    </div>
                    <span className="yohaku-tag text-[10px]">
                      {CATEGORY_LABEL_MAP[item.category] || item.category || '其他平台'}
                    </span>
                  </div>

                  <div className="mt-4 pt-3 border-t border-[var(--color-border)]/60 space-y-1 text-xs font-mono">
                    <div className="flex justify-between text-[var(--color-neutral-6)]">
                      <span>绑定账号:</span>
                      <span className="text-[var(--color-neutral-8)] truncate max-w-[150px]">{item.registered_email || '-'}</span>
                    </div>
                    <div className="flex justify-between text-[var(--color-neutral-6)]">
                      <span>首次检测:</span>
                      <span className="text-[var(--color-neutral-8)] tabular-nums">{item.first_detected_at?.slice(0, 10) || '-'}</span>
                    </div>
                    <div className="flex justify-between text-[var(--color-neutral-6)]">
                      <span>最近活跃:</span>
                      <span className="text-[var(--color-neutral-8)] tabular-nums">{item.last_activity_at?.slice(0, 10) || '-'}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-[var(--color-border)] flex items-center justify-between text-[11px]">
                  <span className="text-[var(--color-neutral-6)] font-mono flex items-center gap-1">
                    <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                    <span>置信度 {(item.confidence_score * 100).toFixed(0)}%</span>
                  </span>
                  {item.source_email_id && onSelectEmail && (
                    <button
                      onClick={() => onSelectEmail(item.source_email_id)}
                      className="text-[var(--color-accent)] hover:underline font-mono"
                    >
                      溯源信件 &rarr;
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        // Subscriptions Table in Editorial Yohaku Style
        subscriptions.length === 0 ? (
          <div className="yohaku-card p-12 text-center text-xs text-[var(--color-neutral-5)] font-mono">
            未检索到订阅支出记录
          </div>
        ) : (
          <div className="yohaku-card overflow-hidden">
            <div className="overflow-x-auto w-full">
              <table className="w-full min-w-[500px] text-left text-xs text-[var(--color-neutral-8)]">
                <thead className="bg-[var(--color-surface-subtle)] text-[var(--color-neutral-6)] font-mono uppercase text-[10px] tracking-wider border-b border-[var(--color-border)]">
                  <tr>
                    <th className="px-5 py-3 font-normal">服务项目</th>
                    <th className="px-5 py-3 font-normal">计费周期</th>
                    <th className="px-5 py-3 font-normal">扣费金额</th>
                    <th className="px-5 py-3 font-normal">记账日期</th>
                    <th className="px-5 py-3 font-normal text-right">关联凭证</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]/60">
                  {subscriptions.map((sub) => (
                    <tr key={sub.id} className="hover:bg-[var(--color-surface-subtle)]/50 transition-colors">
                      <td className="px-5 py-3.5 font-medium text-[var(--color-neutral-10)]">
                        {sub.service_name}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="yohaku-tag text-[10px]">
                          {sub.cycle === 'monthly' ? '按月循环' : sub.cycle === 'yearly' ? '按年支付' : '单次扣款'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-mono font-medium text-[var(--color-neutral-10)] tabular-nums">
                        {sub.currency} {sub.amount.toFixed(2)}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-[var(--color-neutral-6)] tabular-nums">
                        {sub.invoice_date || '-'}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {sub.source_email_id && onSelectEmail && (
                          <button
                            onClick={() => onSelectEmail(sub.source_email_id)}
                            className="text-[var(--color-accent)] hover:underline font-mono"
                          >
                            查看凭证
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* Pagination Toolbar */}
      {!loading && total > 0 && (
        <div className="yohaku-card p-4 flex flex-col md:flex-row items-center justify-between gap-4 text-xs font-mono text-[var(--color-neutral-7)]">
          {/* Left: Total & Page Info */}
          <div className="flex items-center gap-2.5 tabular-nums">
            <span>
              共 <strong className="text-[var(--color-neutral-10)] font-medium">{total}</strong> {activeSubTab === 'subscriptions' ? '条账单记录' : '个服务资产'}
            </span>
            <span className="text-[var(--color-neutral-4)]">|</span>
            <span>
              第 <strong className="text-[var(--color-neutral-10)] font-medium">{page}</strong> / {totalPages} 页
            </span>
          </div>

          {/* Right: Controls */}
          <div className="flex items-center flex-wrap justify-center gap-2 sm:gap-3">
            {/* Page Size Selector */}
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-neutral-6)]">
              <span>每页</span>
              <select
                value={pageSize}
                onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                className="bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-9)] text-xs rounded px-2 py-1 outline-none focus:border-[var(--color-accent)] cursor-pointer"
              >
                <option value={30}>30 条</option>
                <option value={60}>60 条</option>
                <option value={90}>90 条</option>
                <option value={120}>120 条</option>
              </select>
            </div>

            {/* Pagination Navigation */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => handlePageChange(1)}
                disabled={page <= 1}
                className="p-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-subtle)] text-[var(--color-neutral-7)] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                title="第一页"
              >
                <ChevronsLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page <= 1}
                className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-subtle)] text-[var(--color-neutral-7)] disabled:opacity-30 disabled:pointer-events-none transition-colors flex items-center gap-0.5 text-[11px] cursor-pointer"
                title="上一页"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>上一页</span>
              </button>

              <div className="flex items-center gap-1 mx-0.5">
                {getPageNumbers(page, totalPages).map((p, idx) => (
                  p === '...' ? (
                    <span key={`ellipsis-${idx}`} className="px-1 text-[var(--color-neutral-4)] select-none text-xs">...</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => handlePageChange(p)}
                      className={`min-w-[28px] h-7 px-1.5 rounded text-xs tabular-nums transition-colors cursor-pointer ${
                        page === p
                          ? 'bg-[var(--color-accent)] text-white font-medium shadow-sm'
                          : 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-7)] hover:bg-[var(--color-surface-subtle)]'
                      }`}
                    >
                      {p}
                    </button>
                  )
                ))}
              </div>

              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= totalPages}
                className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-subtle)] text-[var(--color-neutral-7)] disabled:opacity-30 disabled:pointer-events-none transition-colors flex items-center gap-0.5 text-[11px] cursor-pointer"
                title="下一页"
              >
                <span>下一页</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handlePageChange(totalPages)}
                disabled={page >= totalPages}
                className="p-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-subtle)] text-[var(--color-neutral-7)] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                title="最后一页"
              >
                <ChevronsRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Jump Input */}
            <form onSubmit={handleJump} className="flex items-center gap-1.5 ml-1">
              <span className="text-[11px] text-[var(--color-neutral-5)]">跳至</span>
              <input
                type="number"
                min={1}
                max={totalPages}
                value={jumpPage}
                onChange={(e) => setJumpPage(e.target.value)}
                placeholder={String(page)}
                className="w-12 bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-9)] text-xs rounded px-1.5 py-1 text-center outline-none focus:border-[var(--color-accent)] tabular-nums"
              />
              <span className="text-[11px] text-[var(--color-neutral-5)]">页</span>
              <button
                type="submit"
                disabled={!jumpPage}
                className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-subtle)] text-[11px] text-[var(--color-neutral-8)] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
              >
                跳转
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
