import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  Search, 
  FileCode, 
  FileSpreadsheet, 
  Receipt, 
  FileArchive, 
  Image as ImageIcon,
  ExternalLink,
  Eye,
  Download,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight
} from 'lucide-react';
import { api } from '../api/client';
import AttachmentPreviewModal from '../components/AttachmentPreviewModal';

const CATEGORY_MAP = [
  { key: '', label: '全部附件' },
  { key: 'invoice', label: '发票凭证' },
  { key: 'document', label: '文档合同' },
  { key: 'spreadsheet', label: '数据表格' },
  { key: 'image', label: '图像设计' },
  { key: 'archive', label: '归档压缩' },
  { key: 'code', label: '代码配置' },
];

const CATEGORY_NAME_DICT = {
  invoice: '发票凭证',
  document: '文档合同',
  spreadsheet: '数据表格',
  image: '图像设计',
  archive: '归档压缩',
  code: '代码配置',
  other: '其他附件'
};

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

export default function Attachments({ selectedAccount, onSelectEmail }) {
  const [attachments, setAttachments] = useState([]);
  const [selectedCat, setSelectedCat] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [jumpPage, setJumpPage] = useState('');
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [previewAttachment, setPreviewAttachment] = useState(null);
  const [catCounts, setCatCounts] = useState({});
  const [overallTotal, setOverallTotal] = useState(0);

  useEffect(() => {
    setPage(1);
    loadCategoryStats();
  }, [selectedAccount]);

  const loadCategoryStats = async () => {
    try {
      const res = await api.getAttachmentCategories(selectedAccount);
      const map = {};
      let sum = 0;
      (res || []).forEach(item => {
        map[item.category] = item.count;
        sum += item.count;
      });
      setCatCounts(map);
      setOverallTotal(sum);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadAttachments();
  }, [selectedAccount, selectedCat, search, page, pageSize]);

  const loadAttachments = async () => {
    try {
      setLoading(true);
      const res = await api.getAttachments({
        account_id: selectedAccount || '',
        category: selectedCat,
        search,
        page,
        limit: pageSize
      });
      setAttachments(res.items || []);
      setTotal(res.total || 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'invoice': return Receipt;
      case 'document': return FileText;
      case 'spreadsheet': return FileSpreadsheet;
      case 'image': return ImageIcon;
      case 'archive': return FileArchive;
      case 'code': return FileCode;
      default: return FileText;
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

  return (
    <div className="space-y-6 pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2 border-b border-[var(--color-border)] pb-4 pt-2">
        <div>
          <h1 className="text-2xl sm:text-3xl font-serif font-normal text-[var(--color-neutral-10)] tracking-tight">
            附件文件资产中心
          </h1>
          <p className="text-xs font-serif text-[var(--color-neutral-6)] mt-1">
            集中归纳从邮件中提取的合同文本、发票凭单、表格数据与设计归档。
          </p>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-neutral-5)]" />
          <input
            type="text"
            placeholder="按附件名检索..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-9)] text-xs rounded-md pl-8 pr-3 py-1.5 outline-none focus:border-[var(--color-accent)] transition-colors"
          />
        </div>
      </div>

      {/* Category Filter Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full scrollbar-none">
        {CATEGORY_MAP.map((c) => {
          const isActive = selectedCat === c.key;
          const count = c.key === '' ? overallTotal : (catCounts[c.key] || 0);
          return (
            <button
              key={c.key}
              onClick={() => { setSelectedCat(c.key); setPage(1); }}
              className={`px-3 py-1 rounded-md text-xs font-mono transition-all flex items-center gap-1.5 ${
                isActive
                  ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-accent-border)] font-medium'
                  : 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)]'
              }`}
            >
              <span>{c.label}</span>
              <span className="text-[10px] tabular-nums opacity-75">({count})</span>
            </button>
          );
        })}
      </div>

      {/* File Grid */}
      {loading ? (
        <div className="py-20 text-center">
          <div className="w-5 h-5 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-mono text-[var(--color-neutral-6)] mt-2">正在载入文件清单...</p>
        </div>
      ) : attachments.length === 0 ? (
        <div className="yohaku-card p-12 text-center text-xs text-[var(--color-neutral-5)] font-mono">
          未检索到匹配的附件资产
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {attachments.map((file) => {
            const Icon = getCategoryIcon(file.category);
            return (
              <div key={file.id} className="yohaku-card p-4 flex flex-col justify-between group">
                <div>
                  <div className="flex items-start space-x-3">
                    <button
                      onClick={() => setPreviewAttachment(file)}
                      className="w-8 h-8 rounded-md bg-[var(--color-surface-subtle)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-accent)] hover:border-[var(--color-accent)] transition-colors flex-shrink-0 cursor-pointer"
                      title="点击在线预览"
                    >
                      <Icon className="w-4 h-4" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <h4 
                        onClick={() => setPreviewAttachment(file)}
                        className="text-xs font-medium text-[var(--color-neutral-10)] truncate cursor-pointer hover:text-[var(--color-accent)] transition-colors" 
                        title={file.filename}
                      >
                        {file.filename}
                      </h4>
                      <p className="text-[10px] text-[var(--color-neutral-6)] font-mono mt-0.5 tabular-nums">
                        {formatBytes(file.file_size)} • {CATEGORY_NAME_DICT[file.category] || file.category || '其他'}
                      </p>
                    </div>
                  </div>

                  {file.email_subject && (
                    <div className="mt-3 p-2.5 rounded-md bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[11px] text-[var(--color-neutral-6)]">
                      <div className="truncate text-[var(--color-neutral-8)] font-medium">
                        来源: {file.email_subject}
                      </div>
                      <div className="text-[10px] text-[var(--color-neutral-5)] truncate mt-0.5 font-mono">
                        发件: {file.email_from || '-'}
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-3 pt-2.5 border-t border-[var(--color-border)] flex items-center justify-between text-[10px] font-mono">
                  <span className="text-[var(--color-neutral-5)] tabular-nums">
                    {file.created_at?.slice(0, 10) || '-'}
                  </span>
                  
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPreviewAttachment(file)}
                      className="text-[var(--color-neutral-7)] hover:text-[var(--color-accent)] flex items-center gap-1 transition-colors px-1 py-0.5"
                      title="在线预览附件"
                    >
                      <Eye className="w-3 h-3" />
                      <span>预览</span>
                    </button>
                    
                    <a
                      href={api.getAttachmentDownloadUrl(file.id)}
                      download={file.filename}
                      className="text-[var(--color-neutral-7)] hover:text-[var(--color-accent)] flex items-center gap-1 transition-colors px-1 py-0.5"
                      title="下载附件到本地"
                    >
                      <Download className="w-3 h-3" />
                      <span>下载</span>
                    </a>

                    {file.email_id && onSelectEmail && (
                      <button
                        onClick={() => onSelectEmail(file.email_id)}
                        className="text-[var(--color-accent)] hover:underline flex items-center gap-0.5 ml-0.5"
                        title="查看原始邮件"
                      >
                        <span>溯源</span>
                        <ExternalLink className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Toolbar */}
      {!loading && total > 0 && (
        <div className="yohaku-card p-4 flex flex-col md:flex-row items-center justify-between gap-4 text-xs font-mono text-[var(--color-neutral-7)]">
          {/* Left: Total & Page Info */}
          <div className="flex items-center gap-2.5 tabular-nums">
            <span>
              共 <strong className="text-[var(--color-neutral-10)] font-medium">{total}</strong> 个附件
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
                className="p-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-subtle)] text-[var(--color-neutral-7)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
                title="第一页"
              >
                <ChevronsLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page <= 1}
                className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-subtle)] text-[var(--color-neutral-7)] disabled:opacity-30 disabled:pointer-events-none transition-colors flex items-center gap-0.5 text-[11px]"
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
                      className={`min-w-[28px] h-7 px-1.5 rounded text-xs tabular-nums transition-colors ${
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
                className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-subtle)] text-[var(--color-neutral-7)] disabled:opacity-30 disabled:pointer-events-none transition-colors flex items-center gap-0.5 text-[11px]"
                title="下一页"
              >
                <span>下一页</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handlePageChange(totalPages)}
                disabled={page >= totalPages}
                className="p-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-subtle)] text-[var(--color-neutral-7)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
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
                className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-subtle)] text-[11px] text-[var(--color-neutral-8)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                跳转
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Attachment Preview Modal */}
      <AttachmentPreviewModal
        attachment={previewAttachment}
        isOpen={!!previewAttachment}
        onClose={() => setPreviewAttachment(null)}
        onSelectEmail={onSelectEmail}
      />
    </div>
  );
}
