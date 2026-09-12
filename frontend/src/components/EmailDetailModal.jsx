import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, 
  ExternalLink, 
  Paperclip, 
  FileText, 
  Eye, 
  Download, 
  Mail, 
  Loader2, 
  AlertCircle 
} from 'lucide-react';
import { api } from '../api/client';
import AttachmentPreviewModal from './AttachmentPreviewModal';
import AIEmailCapsule from './AIEmailCapsule';

const getSafeHtml = (html) => {
  if (!html) return '';
  const baseInject = `
    <base target="_blank">
    <style>
      body { 
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        margin: 16px;
        color: #1a1a1a;
        line-height: 1.6;
        word-break: break-word;
      }
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

export default function EmailDetailModal({ emailId, isOpen, onClose }) {
  const [email, setEmail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState('html'); // 'html' | 'text'
  const [previewAttachment, setPreviewAttachment] = useState(null);

  const safeHtml = useMemo(() => {
    return getSafeHtml(email?.body_html);
  }, [email?.body_html]);

  // Dedicated ESC key listener: does not trigger data refetch
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

  // Data fetching effect: only runs when modal is opened or emailId actually changes
  useEffect(() => {
    if (!isOpen || !emailId) {
      setEmail(null);
      setError(null);
      setLoading(false);
      return;
    }

    let isMounted = true;

    const fetchDetail = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await api.getEmailDetail(emailId);
        if (isMounted) {
          setEmail(data);
          setViewMode(data.body_html ? 'html' : 'text');
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || '获取邮件详情失败');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchDetail();

    return () => {
      isMounted = false;
    };
  }, [isOpen, emailId]);

  if (!isOpen) return null;

  const openInNewTab = () => {
    if (!email) return;
    const content = email.body_html || `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${email.subject || '邮件'}</title><style>body{padding:24px;font-family:monospace;white-space:pre-wrap;}</style></head><body>${email.body_text || email.snippet || ''}</body></html>`;
    const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  return (
    <>
      <div 
        className="fixed inset-0 z-[60] bg-black/45 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 transition-all cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          onClose?.();
        }}
      >
        <div 
          className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl w-full max-w-5xl h-[88vh] max-h-[900px] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 cursor-default"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-5 py-3.5 border-b border-[var(--color-border)] flex items-center justify-between gap-3 bg-[var(--color-surface)] flex-shrink-0">
            <div className="flex items-center space-x-3 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-[var(--color-surface-subtle)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-accent)] flex-shrink-0">
                <Mail className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {email?.labels && email.labels.includes('SENT') && (
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[var(--color-neutral-8)]">
                      已发送
                    </span>
                  )}
                  <h3 className="text-sm sm:text-base font-serif font-medium text-[var(--color-neutral-10)] truncate tracking-tight" title={email?.subject}>
                    {email?.subject || (loading ? '正在读取邮件详情...' : '（无主题）')}
                  </h3>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {email && (
                <>
                  <button
                    onClick={openInNewTab}
                    title="在新窗口打开完整邮件"
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-mono text-[var(--color-neutral-7)] hover:text-[var(--color-neutral-10)] hover:bg-[var(--color-surface-subtle)] rounded border border-[var(--color-border)] transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">新窗口</span>
                  </button>

                  <div className="inline-flex p-0.5 rounded-md bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-xs font-mono">
                    <button
                      onClick={() => setViewMode('html')}
                      disabled={!email.body_html}
                      className={`px-2 py-0.5 rounded transition-all ${
                        viewMode === 'html' ? 'bg-[var(--color-surface)] text-[var(--color-neutral-10)] shadow-xs font-medium' : 'text-[var(--color-neutral-6)] disabled:opacity-40'
                      }`}
                    >
                      排版
                    </button>
                    <button
                      onClick={() => setViewMode('text')}
                      className={`px-2 py-0.5 rounded transition-all ${
                        viewMode === 'text' ? 'bg-[var(--color-surface)] text-[var(--color-neutral-10)] shadow-xs font-medium' : 'text-[var(--color-neutral-6)]'
                      }`}
                    >
                      纯文本
                    </button>
                  </div>
                </>
              )}

              <button
                onClick={onClose}
                className="text-[var(--color-neutral-5)] hover:text-[var(--color-neutral-9)] p-1 rounded-md hover:bg-[var(--color-surface-subtle)] transition-colors ml-1"
                title="关闭 (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Subheader Metadata */}
          {email && (
            <div className="px-5 py-2.5 bg-[var(--color-surface-subtle)]/50 border-b border-[var(--color-border)]/80 text-xs font-mono text-[var(--color-neutral-6)] space-y-1 flex-shrink-0">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <div className="truncate">
                  <span className="text-[var(--color-neutral-5)]">发件: </span>
                  <span className="text-[var(--color-neutral-9)] font-medium">{email.from_name || email.from_email} </span>
                  <span className="text-[var(--color-neutral-6)]">&lt;{email.from_email}&gt;</span>
                </div>
                <div className="text-[var(--color-neutral-5)] tabular-nums flex-shrink-0">
                  {email.date_str}
                </div>
              </div>

              {email.to_emails && (
                <div className="truncate">
                  <span className="text-[var(--color-neutral-5)]">收件: </span>
                  <span className="text-[var(--color-neutral-8)]">{email.to_emails}</span>
                </div>
              )}

              {/* Attachments Bar */}
              {email.attachments && email.attachments.length > 0 && (
                <div className="pt-2 border-t border-[var(--color-border)]/50 flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-[var(--color-neutral-5)] flex items-center gap-1">
                    <Paperclip className="w-3 h-3 text-[var(--color-accent)]" />
                    <span>附件 ({email.attachments.length}):</span>
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {email.attachments.map((att) => (
                      <div
                        key={att.id}
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[11px]"
                      >
                        <FileText className="w-3 h-3 text-[var(--color-accent)] flex-shrink-0" />
                        <span 
                          onClick={() => setPreviewAttachment({ ...att, email_subject: email.subject })}
                          className="max-w-[160px] truncate cursor-pointer hover:text-[var(--color-accent)] font-medium transition-colors"
                          title={att.filename}
                        >
                          {att.filename}
                        </span>
                        <span className="text-[10px] text-[var(--color-neutral-5)] tabular-nums">
                          ({(att.file_size / 1024).toFixed(0)} KB)
                        </span>
                        <div className="flex items-center gap-0.5 ml-1 pl-1 border-l border-[var(--color-border)]">
                          <button
                            onClick={() => setPreviewAttachment({ ...att, email_subject: email.subject })}
                            className="text-[var(--color-neutral-6)] hover:text-[var(--color-accent)] p-0.5 rounded transition-colors"
                            title="在线预览附件"
                          >
                            <Eye className="w-3 h-3" />
                          </button>
                          <a
                            href={api.getAttachmentDownloadUrl(att.id)}
                            download={att.filename}
                            className="text-[var(--color-neutral-6)] hover:text-[var(--color-accent)] p-0.5 rounded transition-colors"
                            title="下载附件"
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
          )}

          {/* AI Capsule */}
          {email && !loading && !error && (
            <div className="flex-shrink-0">
              <AIEmailCapsule emailId={email.id} />
            </div>
          )}

          {/* Reading Canvas */}
          <div className="flex-1 min-h-0 p-4 sm:p-5 overflow-hidden bg-[var(--color-surface)]">
            {loading && !email ? (
              <div className="flex flex-col items-center justify-center h-full space-y-3">
                <Loader2 className="w-6 h-6 text-[var(--color-accent)] animate-spin" />
                <p className="text-xs font-mono text-[var(--color-neutral-6)]">正在加载邮件正文...</p>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-full space-y-3 text-center">
                <AlertCircle className="w-8 h-8 text-amber-500" />
                <p className="text-sm font-medium text-[var(--color-neutral-9)]">{error}</p>
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 text-xs font-mono rounded bg-[var(--color-surface-subtle)] border border-[var(--color-border)] hover:bg-[var(--color-surface)]"
                >
                  关闭
                </button>
              </div>
            ) : email ? (
              viewMode === 'html' && email.body_html ? (
                <iframe
                  title="email-content"
                  srcDoc={safeHtml}
                  className="w-full h-full border border-[var(--color-border)] rounded-lg bg-white shadow-xs"
                  sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                />
              ) : (
                <div className="h-full overflow-y-auto">
                  <pre className="p-4 sm:p-6 bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-lg font-mono text-xs text-[var(--color-neutral-8)] whitespace-pre-wrap leading-relaxed">
                    {email.body_text || email.snippet || '（正文为空）'}
                  </pre>
                </div>
              )
            ) : null}
          </div>
        </div>
      </div>

      {/* Embedded Attachment Preview if an attachment is clicked inside this modal */}
      {previewAttachment && (
        <AttachmentPreviewModal
          attachment={previewAttachment}
          isOpen={!!previewAttachment}
          onClose={() => setPreviewAttachment(null)}
        />
      )}
    </>
  );
}
