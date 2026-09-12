import React, { useState, useEffect, useRef } from 'react';
import { 
  Sparkles, 
  Send, 
  RefreshCw, 
  Copy, 
  Check, 
  ChevronDown, 
  ChevronUp, 
  AlertCircle,
  Clock,
  DollarSign,
  ListTodo,
  FileText
} from 'lucide-react';
import { api, streamSSE } from '../api/client';
import MarkdownRenderer from './MarkdownRenderer';

const TONES = [
  { key: 'professional', label: '专业得体' },
  { key: 'friendly', label: '热情友善' },
  { key: 'concise', label: '极简干练' },
  { key: 'decline', label: '委婉谢绝' },
  { key: 'clarify', label: '追问确认' }
];

export default function AIEmailCapsule({ emailId }) {
  const [activeTab, setActiveTab] = useState(null); // null | 'summary' | 'reply'
  const [cachedInsight, setCachedInsight] = useState(null);
  
  // Summary state
  const [summaryText, setSummaryText] = useState('');
  const [actionItems, setActionItems] = useState([]);
  const [isSummarizing, setIsSummarizing] = useState(false);
  
  // Reply state
  const [selectedTone, setSelectedTone] = useState('professional');
  const [userNotes, setUserNotes] = useState('');
  const [replyDraft, setReplyDraft] = useState('');
  const [isDrafting, setIsDrafting] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const [errorMsg, setErrorMsg] = useState(null);
  const abortControllerRef = useRef(null);

  useEffect(() => {
    // Reset or load cached on emailId change
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setActiveTab(null);
    setSummaryText('');
    setActionItems([]);
    setReplyDraft('');
    setErrorMsg(null);
    checkCache(emailId);
  }, [emailId]);

  const checkCache = async (id) => {
    if (!id) return;
    try {
      const res = await api.getEmailAIInsights(id);
      if (res && res.has_insight && res.insight) {
        setCachedInsight(res.insight);
        setSummaryText(res.insight.summary || '');
        setActionItems(res.insight.action_items || []);
        if (res.insight.reply_draft) {
          setReplyDraft(res.insight.reply_draft);
        }
      } else {
        setCachedInsight(null);
      }
    } catch (_) {
      setCachedInsight(null);
    }
  };

  const handleStartSummary = async (forceRefresh = false) => {
    setActiveTab('summary');
    setErrorMsg(null);
    if (!forceRefresh && cachedInsight && cachedInsight.summary) {
      setSummaryText(cachedInsight.summary);
      setActionItems(cachedInsight.action_items || []);
      return;
    }

    setSummaryText('');
    setActionItems([]);
    setIsSummarizing(true);
    abortControllerRef.current = new AbortController();

    let accumulated = '';

    await streamSSE(
      `/api/ai/emails/${emailId}/summarize${forceRefresh ? '?force_refresh=true' : ''}`,
      {},
      {
        signal: abortControllerRef.current.signal,
        onChunk: (delta) => {
          accumulated += delta;
          setSummaryText(accumulated);
        },
        onCached: (data) => {
          setSummaryText(data.summary || '');
          setActionItems(data.action_items || []);
        },
        onError: (err) => {
          setErrorMsg(err);
        },
        onDone: () => {
          setIsSummarizing(false);
          checkCache(emailId);
        }
      }
    );
  };

  const handleStartReply = async () => {
    setActiveTab('reply');
    setErrorMsg(null);
    setReplyDraft('');
    setIsDrafting(true);
    abortControllerRef.current = new AbortController();

    let accumulated = '';

    await streamSSE(
      `/api/ai/emails/${emailId}/reply`,
      { tone: selectedTone, user_notes: userNotes },
      {
        signal: abortControllerRef.current.signal,
        onChunk: (delta) => {
          accumulated += delta;
          setReplyDraft(accumulated);
        },
        onError: (err) => {
          setErrorMsg(err);
        },
        onDone: () => {
          setIsDrafting(false);
        }
      }
    );
  };

  const handleCopyReply = () => {
    if (!replyDraft) return;
    navigator.clipboard.writeText(replyDraft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleToggleActionItem = (idx) => {
    setActionItems(prev => prev.map((item, i) => i === idx ? { ...item, done: !item.done } : item));
  };

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-subtle)]/50 transition-all">
      {/* Action Toolbar Header */}
      <div className="px-4 py-2 flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--color-neutral-7)]">
            <img src="/ai-avatar.png" alt="AI" className="w-4 h-4 rounded-full object-cover border border-[var(--color-accent)]/40" />
            <span className="font-serif font-medium">AI 助手</span>
          </span>

          <div className="h-3.5 w-px bg-[var(--color-border)]" />

          {/* Buttons */}
          <button
            onClick={() => {
              if (activeTab === 'summary') {
                setActiveTab(null);
              } else {
                handleStartSummary(false);
              }
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all font-mono text-xs ${
              activeTab === 'summary'
                ? 'bg-[var(--color-accent)] text-white shadow-sm font-medium'
                : 'text-[var(--color-neutral-8)] hover:bg-[var(--color-surface)] border border-[var(--color-border)]'
            }`}
          >
            <Sparkles className={`w-3 h-3 ${isSummarizing ? 'animate-spin' : ''}`} />
            <span>{cachedInsight ? 'AI 速读摘要 (已就绪)' : 'AI 智能速读'}</span>
            {activeTab === 'summary' ? <ChevronUp className="w-3 h-3 ml-0.5" /> : <ChevronDown className="w-3 h-3 ml-0.5" />}
          </button>

          <button
            onClick={() => {
              if (activeTab === 'reply') {
                setActiveTab(null);
              } else {
                setActiveTab('reply');
              }
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all font-mono text-xs ${
              activeTab === 'reply'
                ? 'bg-[var(--color-accent)] text-white shadow-sm font-medium'
                : 'text-[var(--color-neutral-8)] hover:bg-[var(--color-surface)] border border-[var(--color-border)]'
            }`}
          >
            <Send className={`w-3 h-3 ${isDrafting ? 'animate-pulse' : ''}`} />
            <span>起草智能回复</span>
            {activeTab === 'reply' ? <ChevronUp className="w-3 h-3 ml-0.5" /> : <ChevronDown className="w-3 h-3 ml-0.5" />}
          </button>
        </div>

        {activeTab && (
          <button
            onClick={() => setActiveTab(null)}
            className="text-[11px] font-mono text-[var(--color-neutral-5)] hover:text-[var(--color-neutral-8)]"
          >
            收起面板
          </button>
        )}
      </div>

      {/* Error Alert */}
      {errorMsg && (
        <div className="mx-4 my-2 p-2.5 rounded bg-rose-500/10 border border-rose-500/20 text-xs text-rose-700 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-[10px] underline">关闭</button>
        </div>
      )}

      {/* Tab Content: Summary */}
      {activeTab === 'summary' && (
        <div className="px-4 py-3 border-t border-[var(--color-border)] bg-[var(--color-surface)] animate-fadeIn max-h-[50vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-xs font-serif font-medium text-[var(--color-neutral-9)]">
              <span>邮件智能速读与关键提炼</span>
              {isSummarizing && (
                <span className="text-[10px] font-mono text-[var(--color-accent)] animate-pulse">
                  (AI 正在流式分析...)
                </span>
              )}
            </div>
            <button
              onClick={() => handleStartSummary(true)}
              disabled={isSummarizing}
              className="text-[11px] font-mono text-[var(--color-neutral-6)] hover:text-[var(--color-accent)] flex items-center gap-1 transition-colors"
              title="重新向大模型请求分析"
            >
              <RefreshCw className={`w-3 h-3 ${isSummarizing ? 'animate-spin' : ''}`} />
              <span>重新生成</span>
            </button>
          </div>

          <div className="bg-[var(--color-surface-subtle)]/70 p-3.5 rounded-lg border border-[var(--color-border)] max-h-[260px] sm:max-h-[300px] overflow-y-auto">
            {summaryText ? (
              <MarkdownRenderer content={summaryText} />
            ) : isSummarizing ? (
              <span className="text-xs text-[var(--color-neutral-6)] font-mono animate-pulse">正在连接大模型解析正文...</span>
            ) : (
              <span className="text-xs text-[var(--color-neutral-5)] font-mono">暂无分析内容</span>
            )}
          </div>
        </div>
      )}

      {/* Tab Content: Smart Reply */}
      {activeTab === 'reply' && (
        <div className="px-4 py-3 border-t border-[var(--color-border)] bg-[var(--color-surface)] animate-fadeIn space-y-3 max-h-[50vh] overflow-y-auto">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Tone Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-mono text-[var(--color-neutral-6)]">语气风格:</span>
              <div className="inline-flex p-0.5 rounded bg-[var(--color-surface-subtle)] border border-[var(--color-border)]">
                {TONES.map(t => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setSelectedTone(t.key)}
                    className={`px-2 py-0.5 rounded text-[11px] font-mono transition-all ${
                      selectedTone === t.key
                        ? 'bg-[var(--color-surface)] text-[var(--color-accent)] font-medium shadow-xs'
                        : 'text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)]'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Generate / Regene button */}
            <button
              onClick={handleStartReply}
              disabled={isDrafting}
              className="yohaku-btn-primary px-3 py-1 text-xs font-mono flex items-center gap-1.5"
            >
              <Sparkles className={`w-3 h-3 ${isDrafting ? 'animate-spin' : ''}`} />
              <span>{isDrafting ? '正在起草...' : replyDraft ? '重新起草' : '生成回复草稿'}</span>
            </button>
          </div>

          {/* User direction input */}
          <div>
            <input
              type="text"
              value={userNotes}
              onChange={(e) => setUserNotes(e.target.value)}
              placeholder="可选补充指示（例如：同意下周三下午开会，并附上我的微信号...）"
              className="w-full px-2.5 py-1.5 text-xs font-sans rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-neutral-9)] focus:outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-neutral-4)]"
            />
          </div>

          {/* Draft output area */}
          {replyDraft && (
            <div className="relative group">
              <div className="p-3.5 pr-24 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-xs text-[var(--color-neutral-9)] font-sans leading-relaxed whitespace-pre-wrap max-h-[260px] sm:max-h-[320px] overflow-y-auto overscroll-contain">
                {replyDraft}
              </div>
              <div className="absolute right-2 top-2 z-10">
                <button
                  onClick={handleCopyReply}
                  className="px-2.5 py-1 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[11px] font-mono text-[var(--color-neutral-7)] hover:text-[var(--color-accent)] shadow-xs flex items-center gap-1 transition-all cursor-pointer"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? '已复制' : '复制草稿'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
