import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, 
  Paperclip, 
  ChevronLeft, 
  ChevronRight, 
  FileText, 
  ExternalLink,
  Eye,
  Download
} from 'lucide-react';
import { api } from '../api/client';
import AttachmentPreviewModal from '../components/AttachmentPreviewModal';
import AIEmailCapsule from '../components/AIEmailCapsule';

export default function MailSearch({ selectedAccount, initialEmailId }) {
  const targetId = typeof initialEmailId === 'object' ? initialEmailId?.id : initialEmailId;
  const activeEmailIdRef = useRef(targetId || null);

  const [emails, setEmails] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [search, setSearch] = useState('');
  const [folder, setFolder] = useState('ALL'); // 'ALL' | 'INBOX' | 'SENT'
  const [onlyAttachments, setOnlyAttachments] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [viewMode, setViewMode] = useState('html'); // 'html' | 'text'
  const [previewAttachment, setPreviewAttachment] = useState(null);

  useEffect(() => {
    loadEmails();
  }, [selectedAccount, search, folder, onlyAttachments, page]);

  useEffect(() => {
    const id = typeof initialEmailId === 'object' ? initialEmailId?.id : initialEmailId;
    if (id) {
      activeEmailIdRef.current = id;
      loadEmailDetail(id);
    }
  }, [initialEmailId]);

  const loadEmails = async () => {
    try {
      setLoading(true);
      const res = await api.getEmails({
        account_id: selectedAccount || '',
        q: search,
        folder: folder !== 'ALL' ? folder : undefined,
        has_attachments: onlyAttachments ? 1 : undefined,
        page,
        limit: 25
      });
      setEmails(res.items || []);
      setTotal(res.total || 0);

      // Determine what to select:
      // If an email has been explicitly targeted or active, preserve it! DO NOT jump to res.items[0]!
      const currentTarget = activeEmailIdRef.current;
      if (currentTarget) {
        if (!selectedEmail || selectedEmail.id !== currentTarget) {
          loadEmailDetail(currentTarget);
        }
      } else if (res.items && res.items.length > 0) {
        activeEmailIdRef.current = res.items[0].id;
        loadEmailDetail(res.items[0].id);
      } else {
        setSelectedEmail(null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadEmailDetail = async (emailId) => {
    if (!emailId) return;
    try {
      setDetailLoading(true);
      activeEmailIdRef.current = emailId;
      const res = await api.getEmailDetail(emailId);
      setSelectedEmail(res);
      if (res.body_html) {
        setViewMode('html');
      } else {
        setViewMode('text');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDetailLoading(false);
    }
  };

  const getSafeHtml = (html) => {
    if (!html) return '';
    const baseInject = `
      <base target="_blank" />
      <style>
        html, body {
          min-height: 100%;
          overflow-y: auto !important;
          background-color: #ffffff;
        }
        body {
          margin: 0;
          padding: 18px;
          word-break: break-word;
          box-sizing: border-box;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.2); border-radius: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        img { max-width: 100% !important; height: auto !important; }
        table { max-width: 100% !important; }
      </style>
    `;

    if (html.includes('<head>')) {
      return html.replace('<head>', `<head>${baseInject}`);
    } else if (html.includes('<head ')) {
      return html.replace(/<head[^>]*>/, `$&${baseInject}`);
    } else if (html.includes('<html')) {
      return html.replace(/<html[^>]*>/, `$&<head>${baseInject}</head>`);
    } else {
      return `<!DOCTYPE html><html><head><meta charset="utf-8">${baseInject}</head><body>${html}</body></html>`;
    }
  };

  const openInNewTab = () => {
    if (!selectedEmail) return;
    const content = selectedEmail.body_html || `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${selectedEmail.subject || '邮件'}</title><style>body{padding:24px;font-family:monospace;white-space:pre-wrap;}</style></head><body>${selectedEmail.body_text || selectedEmail.snippet || ''}</body></html>`;
    const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-4 pb-16">
      {/* Top Search Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3 pt-2">
        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-neutral-5)]" />
          <input
            type="text"
            placeholder="全文检索 (支持中英文关键词、发件人、收件人、主题)..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-9)] text-xs rounded-md pl-8 pr-3 py-2 outline-none focus:border-[var(--color-accent)] transition-colors"
          />
        </div>

        <div className="flex items-center space-x-3 text-xs font-mono text-[var(--color-neutral-6)]">
          {/* Folder Filter Tabs */}
          <div className="inline-flex p-0.5 rounded-md bg-[var(--color-surface-subtle)] border border-[var(--color-border)]">
            {[
              { id: 'ALL', label: '全部' },
              { id: 'INBOX', label: '收件箱' },
              { id: 'SENT', label: '已发送' },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => { setFolder(f.id); setPage(1); }}
                className={`px-2.5 py-1 rounded transition-all ${
                  folder === f.id
                    ? 'bg-[var(--color-surface)] text-[var(--color-neutral-10)] shadow-xs font-medium'
                    : 'text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <label className="flex items-center space-x-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={onlyAttachments}
              onChange={(e) => { setOnlyAttachments(e.target.checked); setPage(1); }}
              className="rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-0 w-3.5 h-3.5"
            />
            <span>含附件</span>
          </label>

          <span className="tabular-nums">
            {total} 封
          </span>
        </div>
      </div>

      {/* Dual Pane Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 h-[calc(100vh-140px)] min-h-[720px]">
        {/* Left Pane: Email List */}
        <div className="lg:col-span-5 yohaku-card p-3 flex flex-col justify-between overflow-hidden">
          <div className="overflow-y-auto space-y-1.5 pr-1 flex-1 divide-y divide-[var(--color-border)]/50">
            {/* If a traced email is loaded but not in current page, pin it at the top */}
            {selectedEmail && !emails.some(m => m.id === selectedEmail.id) && (
              <div
                key={`traced-${selectedEmail.id}`}
                onClick={() => {
                  activeEmailIdRef.current = selectedEmail.id;
                  loadEmailDetail(selectedEmail.id);
                }}
                className="p-3 mb-2 rounded-md cursor-pointer bg-[var(--color-surface-subtle)] border-l-2 border-[var(--color-accent)] pl-2.5 shadow-xs"
              >
                <div className="flex items-center justify-between text-xs mb-1">
                  <div className="flex items-center gap-1.5 truncate max-w-[210px]">
                    <span className="text-[10px] px-1 py-0.2 rounded font-mono bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-medium">
                      当前溯源
                    </span>
                    <span className="font-medium text-[var(--color-neutral-10)] truncate">
                      {selectedEmail.from_name || selectedEmail.from_email}
                    </span>
                  </div>
                  <span className="text-[10px] text-[var(--color-neutral-5)] font-mono tabular-nums flex-shrink-0">
                    {selectedEmail.date_str ? selectedEmail.date_str.slice(0, 16) : ''}
                  </span>
                </div>

                <div className="text-xs text-[var(--color-neutral-9)] truncate font-serif font-medium">
                  {selectedEmail.subject || '（无主题）'}
                </div>

                <p className="text-[11px] text-[var(--color-neutral-6)] truncate mt-1 leading-normal">
                  {selectedEmail.snippet}
                </p>
              </div>
            )}

            {loading ? (
              <div className="py-20 text-center">
                <div className="w-5 h-5 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs font-mono text-[var(--color-neutral-6)] mt-2">正在检索...</p>
              </div>
            ) : emails.length === 0 ? (
              <div className="text-center py-20 text-xs font-mono text-[var(--color-neutral-5)]">
                未检索到匹配的邮件
              </div>
            ) : (
              emails.map((m) => {
                const isSelected = selectedEmail?.id === m.id;
                const isSent = m.labels && m.labels.includes('SENT');
                return (
                  <div
                    key={m.id}
                    onClick={() => {
                      activeEmailIdRef.current = m.id;
                      loadEmailDetail(m.id);
                    }}
                    className={`p-3 rounded-md cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-[var(--color-surface-subtle)] border-l-2 border-[var(--color-accent)] pl-2.5'
                        : 'hover:bg-[var(--color-surface-subtle)]/60'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs mb-1">
                      <div className="flex items-center gap-1.5 truncate max-w-[210px]">
                        <span className={`text-[10px] px-1 py-0.2 rounded font-mono ${
                          isSent 
                            ? 'bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[var(--color-neutral-8)]' 
                            : 'text-[var(--color-neutral-5)]'
                        }`}>
                          {isSent ? '已发' : '来自'}
                        </span>
                        <span className="font-medium text-[var(--color-neutral-10)] truncate">
                          {isSent ? (m.to_emails || m.from_email) : (m.from_name || m.from_email)}
                        </span>
                      </div>
                      <span className="text-[10px] text-[var(--color-neutral-5)] font-mono tabular-nums flex-shrink-0">
                        {m.date_str ? m.date_str.slice(0, 16) : ''}
                      </span>
                    </div>

                    <div className="text-xs text-[var(--color-neutral-9)] truncate font-serif">
                      {m.subject || '（无主题）'}
                    </div>

                    <p className="text-[11px] text-[var(--color-neutral-6)] truncate mt-1 leading-normal">
                      {m.snippet}
                    </p>

                    <div className="flex items-center justify-between mt-2 text-[10px] text-[var(--color-neutral-5)] font-mono">
                      <span className="truncate max-w-[180px]">{isSent ? `至: ${m.to_emails}` : m.from_email}</span>
                      {m.has_attachments === 1 && (
                        <span className="flex items-center gap-1 text-[var(--color-accent)]">
                          <Paperclip className="w-3 h-3" />
                          <span>附件</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Pagination */}
          <div className="pt-2.5 border-t border-[var(--color-border)] flex items-center justify-between text-xs font-mono text-[var(--color-neutral-6)] tabular-nums">
            <span>页码 {page} / {Math.ceil(total / 25) || 1}</span>
            <div className="flex items-center space-x-1">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                className="p-1 rounded hover:bg-[var(--color-surface-subtle)] disabled:opacity-30"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                disabled={page >= Math.ceil(total / 25)}
                onClick={() => setPage(p => p + 1)}
                className="p-1 rounded hover:bg-[var(--color-surface-subtle)] disabled:opacity-30"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Pane: Reading Canvas */}
        <div className="lg:col-span-7 yohaku-card p-6 flex flex-col overflow-hidden">
          {detailLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-5 h-5 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : selectedEmail ? (
            <div className="flex flex-col h-full overflow-hidden">
              {/* Email Header Info */}
              <div className="border-b border-[var(--color-border)] pb-4 flex-shrink-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    {selectedEmail.labels && selectedEmail.labels.includes('SENT') && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[var(--color-neutral-8)]">
                        已发送
                      </span>
                    )}
                    <h2 className="text-base sm:text-lg font-serif font-medium text-[var(--color-neutral-10)] tracking-tight">
                      {selectedEmail.subject || '（无主题）'}
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={openInNewTab}
                      title="在新窗口打开完整邮件"
                      className="flex items-center gap-1 px-2 py-0.5 text-xs font-mono text-[var(--color-neutral-7)] hover:text-[var(--color-neutral-10)] hover:bg-[var(--color-surface-subtle)] rounded border border-[var(--color-border)] transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">新窗口</span>
                    </button>
                    <div className="inline-flex p-0.5 rounded-md bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-xs font-mono">
                      <button
                        onClick={() => setViewMode('html')}
                        disabled={!selectedEmail.body_html}
                        className={`px-2 py-0.5 rounded transition-all ${
                          viewMode === 'html' ? 'bg-[var(--color-surface)] text-[var(--color-neutral-10)] shadow-xs' : 'text-[var(--color-neutral-6)] disabled:opacity-40'
                        }`}
                      >
                        排版
                      </button>
                      <button
                        onClick={() => setViewMode('text')}
                        className={`px-2 py-0.5 rounded transition-all ${
                          viewMode === 'text' ? 'bg-[var(--color-surface)] text-[var(--color-neutral-10)] shadow-xs' : 'text-[var(--color-neutral-6)]'
                        }`}
                      >
                        纯文本
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-3 space-y-1 text-xs font-mono text-[var(--color-neutral-6)]">
                  <div>
                    <span className="text-[var(--color-neutral-5)]">发件: </span>
                    <span className="text-[var(--color-neutral-9)]">{selectedEmail.from_name} </span>
                    <span className="text-[var(--color-neutral-6)]">&lt;{selectedEmail.from_email}&gt;</span>
                  </div>
                  <div>
                    <span className="text-[var(--color-neutral-5)]">收件: </span>
                    <span className="text-[var(--color-neutral-8)]">{selectedEmail.to_emails}</span>
                  </div>
                  <div>
                    <span className="text-[var(--color-neutral-5)]">时间: </span>
                    <span className="text-[var(--color-neutral-8)] tabular-nums">{selectedEmail.date_str}</span>
                  </div>
                </div>

                {/* Attachments Chips */}
                {selectedEmail.attachments && selectedEmail.attachments.length > 0 && (
                  <div className="mt-3 pt-2.5 border-t border-[var(--color-border)]/60">
                    <div className="text-[11px] font-mono text-[var(--color-neutral-6)] mb-1.5 flex items-center gap-1.5">
                      <Paperclip className="w-3 h-3 text-[var(--color-accent)]" />
                      <span>邮件附件 ({selectedEmail.attachments.length} 项):</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedEmail.attachments.map((att) => (
                        <div
                          key={att.id}
                          className="yohaku-tag flex items-center gap-2 py-1 px-2.5 bg-[var(--color-surface-subtle)] hover:border-[var(--color-accent-border)] transition-colors group"
                        >
                          <FileText className="w-3.5 h-3.5 text-[var(--color-accent)] flex-shrink-0" />
                          <span 
                            onClick={() => setPreviewAttachment({ ...att, email_subject: selectedEmail.subject })}
                            className="max-w-[180px] truncate cursor-pointer hover:text-[var(--color-accent)] transition-colors font-medium"
                            title={att.filename}
                          >
                            {att.filename}
                          </span>
                          <span className="text-[10px] text-[var(--color-neutral-5)] tabular-nums flex-shrink-0 font-mono">
                            ({(att.file_size / 1024).toFixed(0)} KB)
                          </span>
                          
                          <div className="flex items-center gap-1 pl-1 border-l border-[var(--color-border)] ml-0.5">
                            <button
                              onClick={() => setPreviewAttachment({ ...att, email_subject: selectedEmail.subject })}
                              className="text-[var(--color-neutral-6)] hover:text-[var(--color-accent)] p-0.5 rounded transition-colors"
                              title="在线预览"
                            >
                              <Eye className="w-3 h-3" />
                            </button>
                            <a
                              href={api.getAttachmentDownloadUrl(att.id)}
                              download={att.filename}
                              className="text-[var(--color-neutral-6)] hover:text-[var(--color-accent)] p-0.5 rounded transition-colors"
                              title="下载到本地"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Download className="w-3 h-3" />
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* AI Smart Capsule: Summary & Reply */}
              <AIEmailCapsule emailId={selectedEmail.id} />

              {/* Reader Body */}
              <div className="flex-1 min-h-0 mt-4">
                {viewMode === 'html' && selectedEmail.body_html ? (
                  <iframe
                    title="email-preview"
                    srcDoc={getSafeHtml(selectedEmail.body_html)}
                    className="w-full h-full border border-[var(--color-border)] rounded-lg bg-white shadow-xs"
                    sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                  />
                ) : (
                  <div className="h-full overflow-y-auto">
                    <pre className="p-4 bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-lg font-mono text-xs text-[var(--color-neutral-8)] whitespace-pre-wrap leading-relaxed">
                      {selectedEmail.body_text || selectedEmail.snippet || '（正文为空）'}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-[var(--color-neutral-5)] space-y-1 font-mono text-xs">
              <p>从左侧列表中选取邮件阅读详情</p>
            </div>
          )}
        </div>
      </div>

      {/* Attachment Preview Modal */}
      <AttachmentPreviewModal
        attachment={previewAttachment}
        isOpen={!!previewAttachment}
        onClose={() => setPreviewAttachment(null)}
      />
    </div>
  );
}
