import React, { useState, useEffect } from 'react';
import { 
  X, 
  Download, 
  ExternalLink, 
  FileText, 
  Image as ImageIcon, 
  FileSpreadsheet, 
  Receipt, 
  FileArchive, 
  FileCode, 
  Loader2,
  Table,
  FileCode2,
  Mail,
  CloudDownload,
  AlertCircle,
  RotateCw
} from 'lucide-react';
import { api } from '../api/client';

export default function AttachmentPreviewModal({ attachment, isOpen, onClose, onSelectEmail }) {
  const [contentData, setContentData] = useState(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [contentError, setContentError] = useState(null);
  const [viewFormat, setViewFormat] = useState('table'); // 'table' | 'raw'
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [retryNonce, setRetryNonce] = useState(0);

  // ESC key listener to close attachment preview
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !attachment) {
      setContentData(null);
      setContentError(null);
      return;
    }

    setImageLoading(true);
    setImageError(false);
    setPdfLoading(true);

    const filename = attachment.filename || '';
    const ext = filename.split('.').pop().toLowerCase();
    const isTextual = ['csv', 'txt', 'json', 'log', 'md', 'xml', 'js', 'py', 'html'].includes(ext) ||
                      (attachment.mime_type && (attachment.mime_type.startsWith('text/') || attachment.mime_type.includes('json')));

    if (isTextual) {
      fetchTextContent(attachment.id);
    }
  }, [isOpen, attachment?.id, retryNonce]);

  if (!isOpen || !attachment) return null;

  const fetchTextContent = async (id) => {
    try {
      setLoadingContent(true);
      setContentError(null);
      const res = await api.getAttachmentContent(id);
      setContentData(res.content || '');
    } catch (err) {
      setContentError(err.message || '读取文件内容失败');
    } finally {
      setLoadingContent(false);
    }
  };

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const filename = attachment.filename || '未知文件';
  const ext = filename.split('.').pop().toLowerCase();
  const rawPreviewUrl = api.getAttachmentPreviewUrl(attachment.id);
  const previewUrl = retryNonce > 0 
    ? `${rawPreviewUrl}${rawPreviewUrl.includes('?') ? '&' : '?'}_r=${retryNonce}` 
    : rawPreviewUrl;
  const downloadUrl = api.getAttachmentDownloadUrl(attachment.id);

  const isPdf = ext === 'pdf' || attachment.mime_type === 'application/pdf';
  const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext) ||
                  (attachment.mime_type && attachment.mime_type.startsWith('image/'));
  const isCsv = ext === 'csv';
  const isTextual = ['txt', 'json', 'log', 'md', 'xml', 'js', 'py', 'html', 'csv'].includes(ext) ||
                    (attachment.mime_type && (attachment.mime_type.startsWith('text/') || attachment.mime_type.includes('json')));

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

  const Icon = getCategoryIcon(attachment.category);

  // Simple CSV parser for preview
  const parseCsv = (text) => {
    if (!text) return { headers: [], rows: [] };
    const lines = text.trim().split(/\r?\n/);
    if (lines.length === 0) return { headers: [], rows: [] };
    
    const parseLine = (line) => {
      const result = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          inQuotes = !inQuotes;
        } else if (c === ',' && !inQuotes) {
          result.push(cur.trim());
          cur = '';
        } else {
          cur += c;
        }
      }
      result.push(cur.trim());
      return result;
    };

    const headers = parseLine(lines[0]);
    const rows = lines.slice(1).map(parseLine).filter(r => r.length > 0 && r.some(c => c !== ''));
    return { headers, rows };
  };

  return (
    <div 
      className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 transition-all cursor-pointer"
      onClick={(e) => {
        e.stopPropagation();
        onClose?.();
      }}
    >
      <div 
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-[var(--color-border)] flex items-center justify-between gap-3 bg-[var(--color-surface)] flex-shrink-0">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[var(--color-surface-subtle)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-accent)] flex-shrink-0">
              <Icon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-[var(--color-neutral-10)] truncate" title={filename}>
                {filename}
              </h3>
              <div className="flex items-center gap-2 text-[11px] font-mono text-[var(--color-neutral-6)] mt-0.5">
                <span className="tabular-nums">{formatBytes(attachment.file_size)}</span>
                <span>•</span>
                <span className="uppercase">{ext}</span>
                {attachment.email_subject && (
                  <>
                    <span>•</span>
                    <span className="truncate max-w-[200px] text-[var(--color-neutral-7)]" title={attachment.email_subject}>
                      来源: {attachment.email_subject}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* View format toggle for CSV */}
            {isCsv && contentData && (
              <div className="inline-flex p-0.5 rounded-md bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-xs font-mono mr-1">
                <button
                  onClick={() => setViewFormat('table')}
                  className={`px-2 py-0.5 rounded flex items-center gap-1 transition-all ${
                    viewFormat === 'table' ? 'bg-[var(--color-surface)] text-[var(--color-neutral-10)] shadow-xs font-medium' : 'text-[var(--color-neutral-6)]'
                  }`}
                >
                  <Table className="w-3 h-3" />
                  <span>表格</span>
                </button>
                <button
                  onClick={() => setViewFormat('raw')}
                  className={`px-2 py-0.5 rounded flex items-center gap-1 transition-all ${
                    viewFormat === 'raw' ? 'bg-[var(--color-surface)] text-[var(--color-neutral-10)] shadow-xs font-medium' : 'text-[var(--color-neutral-6)]'
                  }`}
                >
                  <FileCode2 className="w-3 h-3" />
                  <span>纯文本</span>
                </button>
              </div>
            )}

            {/* Email tracing button if available */}
            {attachment.email_id && onSelectEmail && (
              <button
                onClick={() => {
                  onClose();
                  onSelectEmail(attachment.email_id);
                }}
                className="hidden sm:flex items-center gap-1 px-2.5 py-1 text-xs font-mono text-[var(--color-neutral-7)] hover:text-[var(--color-accent)] hover:bg-[var(--color-surface-subtle)] rounded-md border border-[var(--color-border)] transition-colors"
                title="弹窗阅读此附件的原始邮件"
              >
                <Mail className="w-3.5 h-3.5" />
                <span>溯源信件</span>
              </button>
            )}

            {/* Open in new window */}
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              className="hidden sm:flex items-center gap-1 px-2.5 py-1 text-xs font-mono text-[var(--color-neutral-7)] hover:text-[var(--color-neutral-10)] hover:bg-[var(--color-surface-subtle)] rounded-md border border-[var(--color-border)] transition-colors"
              title="在新标签页中打开"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>新窗口</span>
            </a>

            {/* Direct download */}
            <a
              href={downloadUrl}
              download={filename}
              className="yohaku-btn-primary px-3 py-1 text-xs flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>下载</span>
            </a>

            {/* Close */}
            <button
              onClick={onClose}
              className="text-[var(--color-neutral-5)] hover:text-[var(--color-neutral-9)] p-1 rounded-md hover:bg-[var(--color-surface-subtle)] transition-colors ml-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 min-h-[440px] max-h-[76vh] overflow-auto bg-[var(--color-surface)] flex flex-col justify-center relative">
          {/* PDF Viewer */}
          {isPdf && (
            <div className="relative w-full h-[76vh] flex flex-col bg-[var(--color-surface-subtle)]/30">
              {pdfLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-8 bg-[var(--color-surface)]/90 backdrop-blur-xs z-20">
                  <div className="w-12 h-12 rounded-2xl bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 flex items-center justify-center text-[var(--color-accent)] mb-3 shadow-xs">
                    <Loader2 className="w-6 h-6 animate-spin text-[var(--color-accent)]" />
                  </div>
                  <h4 className="text-sm font-medium text-[var(--color-neutral-10)]">
                    {!attachment.storage_path ? '正在从云端拉取 PDF 文档...' : '正在载入 PDF 文档...'}
                  </h4>
                  <p className="text-xs font-mono text-[var(--color-neutral-6)] mt-1.5 tabular-nums">
                    {formatBytes(attachment.file_size)} • PDF 文档
                    {!attachment.storage_path && ' • 首次预览需自云端同步'}
                  </p>
                </div>
              )}
              <iframe
                src={previewUrl}
                title={filename}
                onLoad={() => setPdfLoading(false)}
                className="w-full flex-1 border-0 bg-white"
              />
            </div>
          )}

          {/* Image Viewer */}
          {isImage && (
            <div className="relative p-6 flex flex-col items-center justify-center min-h-[440px] max-h-[76vh] bg-[var(--color-surface-subtle)]/40 overflow-hidden select-none">
              {/* Image Loading State */}
              {imageLoading && !imageError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-8 bg-[var(--color-surface)]/85 backdrop-blur-xs z-20 animate-in fade-in duration-200">
                  <div className="relative flex items-center justify-center mb-4">
                    <div className="w-14 h-14 rounded-2xl bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 flex items-center justify-center text-[var(--color-accent)] shadow-sm">
                      <CloudDownload className="w-7 h-7 animate-pulse text-[var(--color-accent)]" />
                    </div>
                    <div className="absolute -inset-1.5 rounded-2xl border border-[var(--color-accent)]/30 animate-ping opacity-20 pointer-events-none" />
                  </div>

                  <h4 className="text-sm font-medium text-[var(--color-neutral-10)] flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-[var(--color-accent)]" />
                    <span>{!attachment.storage_path ? '正在从云端邮箱拉取附件并加载...' : '正在载入高清图片...'}</span>
                  </h4>

                  <p className="text-xs font-mono text-[var(--color-neutral-6)] mt-2 tabular-nums">
                    {formatBytes(attachment.file_size)} • {ext.toUpperCase()}
                    {!attachment.storage_path && ' • 首次预览需自 Gmail 传输'}
                  </p>

                  <div className="mt-4 max-w-sm text-center px-3.5 py-2 rounded-lg bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[11px] font-mono text-[var(--color-neutral-6)] leading-relaxed shadow-2xs">
                    💡 大图首次加载需自远端邮箱实时同步，下载后将自动持久化至本地硬盘，后续查看立即可见。
                  </div>
                </div>
              )}

              {/* Image Error State */}
              {imageError && (
                <div className="py-16 text-center px-4 z-20">
                  <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-600 mx-auto mb-3">
                    <AlertCircle className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-medium text-[var(--color-neutral-10)]">图片预览加载失败</h4>
                  <p className="text-xs font-mono text-[var(--color-neutral-6)] mt-1.5 max-w-md mx-auto leading-relaxed">
                    可能由于云端网络波动或连接超时。您可以尝试重新加载，或直接下载原图。
                  </p>
                  <div className="mt-5 flex items-center justify-center gap-3">
                    <button
                      onClick={() => {
                        setImageLoading(true);
                        setImageError(false);
                        setRetryNonce(prev => prev + 1);
                      }}
                      className="yohaku-btn-secondary px-3.5 py-1.5 text-xs font-mono flex items-center gap-1.5"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      <span>重试加载</span>
                    </button>
                    <a
                      href={downloadUrl}
                      download={filename}
                      className="yohaku-btn-primary px-3.5 py-1.5 text-xs font-mono flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>直接下载原图</span>
                    </a>
                  </div>
                </div>
              )}

              {/* The Actual Image */}
              <img
                key={`${attachment.id}-${retryNonce}`}
                src={previewUrl}
                alt={filename}
                onLoad={() => {
                  setImageLoading(false);
                  setImageError(false);
                }}
                onError={() => {
                  setImageLoading(false);
                  setImageError(true);
                }}
                className={`max-h-[70vh] max-w-full object-contain rounded-md shadow-sm border border-[var(--color-border)] transition-opacity duration-300 ${
                  imageLoading || imageError ? 'opacity-0 h-0 w-0 pointer-events-none' : 'opacity-100'
                }`}
              />
            </div>
          )}

          {/* CSV / Text Viewer */}
          {isTextual && !isPdf && !isImage && (
            <div className="flex-1 flex flex-col h-full">
              {loadingContent ? (
                <div className="py-24 text-center">
                  <Loader2 className="w-6 h-6 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin mx-auto text-[var(--color-accent)]" />
                  <p className="text-xs font-mono text-[var(--color-neutral-6)] mt-2">正在加载文件内容...</p>
                </div>
              ) : contentError ? (
                <div className="p-8 text-center text-xs font-mono text-rose-600">
                  <p>{contentError}</p>
                  <a
                    href={downloadUrl}
                    className="mt-3 inline-block yohaku-btn-secondary px-3 py-1.5 text-xs"
                  >
                    直接下载文件
                  </a>
                </div>
              ) : isCsv && viewFormat === 'table' ? (
                (() => {
                  const { headers, rows } = parseCsv(contentData);
                  return (
                    <div className="overflow-auto p-4 max-h-[76vh]">
                      <table className="w-full text-left text-xs border border-[var(--color-border)] rounded-md overflow-hidden">
                        <thead className="bg-[var(--color-surface-subtle)] text-[var(--color-neutral-8)] font-mono text-[11px] border-b border-[var(--color-border)] sticky top-0">
                          <tr>
                            <th className="px-3 py-2 border-r border-[var(--color-border)] w-10 text-center text-[var(--color-neutral-5)]">#</th>
                            {headers.map((h, i) => (
                              <th key={i} className="px-3 py-2 border-r border-[var(--color-border)] font-medium">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--color-border)] font-mono text-[11px] text-[var(--color-neutral-9)] bg-[var(--color-surface)]">
                          {rows.map((row, rIdx) => (
                            <tr key={rIdx} className="hover:bg-[var(--color-surface-subtle)]/60 transition-colors">
                              <td className="px-3 py-1.5 border-r border-[var(--color-border)] text-center text-[var(--color-neutral-5)] tabular-nums">
                                {rIdx + 1}
                              </td>
                              {row.map((cell, cIdx) => (
                                <td key={cIdx} className="px-3 py-1.5 border-r border-[var(--color-border)] truncate max-w-xs">
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="text-[10px] font-mono text-[var(--color-neutral-5)] mt-2">
                        共解析 {rows.length} 行数据
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="p-4 max-h-[76vh] overflow-auto">
                  <pre className="p-4 rounded-lg text-xs font-mono bg-[var(--color-surface-subtle)] text-[var(--color-neutral-9)] leading-relaxed border border-[var(--color-border)] whitespace-pre-wrap break-all select-text">
                    {contentData || '（文件为空）'}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Unsupported binary format placeholder */}
          {!isPdf && !isImage && !isTextual && (
            <div className="py-20 text-center px-4">
              <div className="w-12 h-12 rounded-xl bg-[var(--color-surface-subtle)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-accent)] mx-auto mb-3">
                <Icon className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-medium text-[var(--color-neutral-10)]">{filename}</h4>
              <p className="text-xs font-mono text-[var(--color-neutral-6)] mt-1">
                {formatBytes(attachment.file_size)} • {attachment.mime_type || '二进制归档'}
              </p>
              <p className="text-xs font-serif text-[var(--color-neutral-6)] mt-3 max-w-sm mx-auto">
                当前格式暂不支持在浏览器内嵌预览，推荐直接下载至本地系统进行查阅。
              </p>
              <a
                href={downloadUrl}
                download={filename}
                className="mt-5 inline-flex items-center gap-1.5 yohaku-btn-primary px-4 py-2 text-xs font-mono"
              >
                <Download className="w-4 h-4" />
                <span>立即下载至本地</span>
              </a>
            </div>
          )}
        </div>

        {/* Modal Footer Tip */}
        <div className="px-5 py-2.5 border-t border-[var(--color-border)] bg-[var(--color-surface-subtle)]/40 flex items-center justify-between text-[11px] font-mono text-[var(--color-neutral-6)] flex-shrink-0">
          <div className="flex items-center gap-2">
            {(imageLoading && isImage) || (pdfLoading && isPdf) || loadingContent ? (
              <>
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-amber-600 dark:text-amber-400 font-medium">
                  {!attachment.storage_path ? '正在自远端 Gmail 服务器安全拉取...' : '正在加载中...'}
                </span>
              </>
            ) : imageError || contentError ? (
              <>
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                <span className="text-rose-600">云端传输异常</span>
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-emerald-600 dark:text-emerald-400">
                  本地存储就绪
                </span>
              </>
            )}
          </div>
          <div className="text-[10px] text-[var(--color-neutral-5)]">
            余白极简资产系统 • 本地私密托管
          </div>
        </div>
      </div>
    </div>
  );
}