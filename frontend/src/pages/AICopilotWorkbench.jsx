import React, { useState, useEffect, useRef } from 'react';
import { 
  Bot, 
  Sparkles, 
  Send, 
  RefreshCw, 
  Square, 
  Mail, 
  ExternalLink, 
  Trash2, 
  Copy, 
  Check,
  Plus,
  MessageSquare,
  Clock,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  X
} from 'lucide-react';
import { api } from '../api/client';
import { useAIConversation } from '../context/AIConversationContext';
import { useChatAutoScroll } from '../hooks/useChatAutoScroll';
import MarkdownRenderer from '../components/MarkdownRenderer';
import AgentToolCallsView from '../components/AgentToolCallsView';
import ModelSelectorDropdown from '../components/ModelSelectorDropdown';
import ThinkingModeSlider from '../components/ThinkingModeSlider';
import ThinkingBlock from '../components/ThinkingBlock';
import ContextTokenPopover from '../components/ContextTokenPopover';

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr.replace(' ', 'T'));
  if (isNaN(date.getTime())) return dateStr;
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return '刚刚';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}小时前`;
  if (diffSec < 86400 * 2) return '昨天';
  
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  if (date.getFullYear() === now.getFullYear()) {
    return `${m}-${d}`;
  }
  return `${date.getFullYear()}-${m}-${d}`;
}

const QUICK_PROMPTS = [
  '🔍 帮我查找最近的报销发票与电子账单',
  '💳 统计我当前订阅的所有 SaaS 服务与花费',
  '👥 总结最近往来最频繁的联系人与合作事项',
  '🌐 联网检索某家服务商或技术平台的最新背景与官网'
];

export default function AICopilotWorkbench({ selectedAccount, onSelectEmail }) {
  const {
    conversations,
    activeConvId,
    activeConversation,
    messages,
    isStreaming,
    isLoadingHistory,
    enabledModelGroups,
    currentModel,
    setCurrentModel,
    thinkingLevel,
    setThinkingLevel,
    selectConversation,
    newConversation,
    deleteConversation,
    sendMessage,
    stopStreaming,
    clearCurrentMessages,
    activeContactContext,
    clearContactContext,
    draftPrompt,
    setDraftPrompt,
    contextStats,
    isCompressing,
    compressActiveConversation
  } = useAIConversation();

  const [input, setInput] = useState('');
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [aiConfig, setAiConfig] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const inputRef = useRef(null);

  // Sync draft prompt if invoked externally
  useEffect(() => {
    if (draftPrompt) {
      setInput(draftPrompt);
      setDraftPrompt('');
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.style.height = 'auto';
          const scrollH = inputRef.current.scrollHeight;
          inputRef.current.style.height = `${Math.min(scrollH, 180)}px`;
        }
      }, 150);
    }
  }, [draftPrompt, setDraftPrompt]);

  const {
    containerRef,
    messagesEndRef,
    showScrollBottom,
    scrollToBottom,
    handleScroll,
    handleWheel,
    handleTouchStart,
    handleTouchMove
  } = useChatAutoScroll({
    messages,
    isStreaming,
    activeConvId
  });

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const res = await api.getAISettings();
      if (res && res.settings) {
        setAiConfig(res.settings);
      }
    } catch (_) {}
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInput(val);
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      const scrollH = inputRef.current.scrollHeight;
      const maxH = 180;
      if (scrollH > maxH) {
        inputRef.current.style.height = `${maxH}px`;
        inputRef.current.style.overflowY = 'auto';
      } else {
        inputRef.current.style.height = `${scrollH}px`;
        inputRef.current.style.overflowY = 'hidden';
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = async (customText = null) => {
    const textToSend = (customText || input).trim();
    if (!textToSend || isStreaming) return;
    setInput('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.overflowY = 'hidden';
    }
    scrollToBottom('smooth');
    await sendMessage(textToSend, selectedAccount);
  };

  const handleCopyMessage = (text, idx) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const handleDeleteSession = (e, convId) => {
    e.stopPropagation();
    if (window.confirm('确认删除这条对话记录吗？删除后不可恢复。')) {
      deleteConversation(convId);
    }
  };

  const renderMessageContent = (text) => {
    return <MarkdownRenderer content={text} onSelectEmail={onSelectEmail} />;
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4 pb-12">
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3 pt-1">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-serif font-normal text-[var(--color-neutral-10)] tracking-tight">
              AI 邮件资产助手工作台
            </h1>
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/20">
              Copilot 2.0
            </span>
          </div>
          <p className="text-xs font-serif text-[var(--color-neutral-6)] mt-1">
            基于本地 SQLite FTS5 全文索引与资产台账，支持多会话隔离、历史回顾与跨邮件引用溯源。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <ModelSelectorDropdown
            currentModel={currentModel}
            onSelectModel={setCurrentModel}
            enabledModelGroups={enabledModelGroups}
            dropUp={false}
            compact={true}
          />
        </div>
      </div>

      {/* Main Container: Left Sidebar (History Sessions) + Right Chat Area */}
      <div className="yohaku-card flex h-[calc(100vh-210px)] min-h-[560px] overflow-hidden p-0 border border-[var(--color-border)] rounded-xl shadow-xs">
        {/* Left Sidebar: Conversations History */}
        <div
          className={`${
            isSidebarOpen ? 'w-64 sm:w-72' : 'w-0'
          } transition-all duration-200 border-r border-[var(--color-border)] bg-[var(--color-surface-subtle)] flex flex-col shrink-0 overflow-hidden select-none`}
        >
          {/* New Conversation Button */}
          <div className="p-3 border-b border-[var(--color-border)]/60 bg-[var(--color-surface-subtle)]">
            <button
              onClick={() => {
                newConversation();
                setTimeout(() => inputRef.current?.focus(), 100);
              }}
              className="w-full py-2 px-3 rounded-lg bg-[var(--color-accent)] text-white hover:opacity-95 text-xs sm:text-sm font-sans font-medium flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>新建对话</span>
            </button>
          </div>

          {/* History List Section Header */}
          <div className="px-3 pt-3 pb-1.5 flex items-center justify-between text-[11px] font-mono text-[var(--color-neutral-5)]">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>历史对话 ({conversations.length})</span>
            </span>
          </div>

          {/* History Scrollable List */}
          <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
            {conversations.length === 0 ? (
              <div className="py-12 text-center text-[var(--color-neutral-4)] text-xs font-serif">
                暂无历史对话记录<br />
                点击上方「新建对话」发起
              </div>
            ) : (
              conversations.map((conv) => {
                const isActive = conv.id === activeConvId;
                return (
                  <div
                    key={conv.id}
                    onClick={() => selectConversation(conv.id)}
                    className={`group relative flex items-center justify-between px-3 py-2.5 rounded-lg text-xs cursor-pointer transition-all ${
                      isActive
                        ? 'bg-[var(--color-surface)] text-[var(--color-accent)] border border-[var(--color-accent)]/25 shadow-xs font-medium'
                        : 'text-[var(--color-neutral-8)] hover:bg-[var(--color-surface)]/70 hover:text-[var(--color-neutral-10)]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                      <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-neutral-5)] group-hover:text-[var(--color-neutral-7)]'}`} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-sans font-medium">
                          {conv.title || '新对话'}
                        </div>
                        <div className="text-[10px] font-mono text-[var(--color-neutral-5)] mt-0.5 flex items-center gap-1.5">
                          <span>{formatRelativeTime(conv.updated_at || conv.created_at)}</span>
                          {conv.message_count > 0 && (
                            <>
                              <span>·</span>
                              <span>{conv.message_count} 条</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Delete Icon */}
                    <button
                      onClick={(e) => handleDeleteSession(e, conv.id)}
                      className="p-1 rounded text-[var(--color-neutral-4)] hover:text-rose-600 hover:bg-rose-50 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                      title="删除对话"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Chat Pane */}
        <div className="flex-1 flex flex-col min-w-0 bg-[var(--color-surface)]">
          {/* Chat Window Header */}
          <div className="px-4 py-2.5 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-surface)] shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="p-1.5 rounded text-[var(--color-neutral-6)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-neutral-9)] transition-colors"
                title={isSidebarOpen ? '收起历史列表' : '展开历史列表'}
              >
                {isSidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
              </button>
              <div className="min-w-0 flex items-center gap-2">
                <span className="font-serif font-medium text-sm text-[var(--color-neutral-9)] truncate">
                  {activeConversation ? activeConversation.title : (activeContactContext ? `👤 往来研讨：${activeContactContext.name}` : '新对话')}
                </span>
                {activeConvId && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-surface-subtle)] text-[var(--color-neutral-5)] border border-[var(--color-border)]">
                    {messages.length} 轮互动
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={clearCurrentMessages}
                className="p-1.5 rounded text-[var(--color-neutral-5)] hover:text-rose-600 hover:bg-[var(--color-surface-subtle)] transition-colors"
                title="清空当前对话"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Messages Stream */}
          <div className="relative flex-1 min-h-0 flex flex-col">
            <div 
              ref={containerRef}
              onScroll={handleScroll}
              onWheel={handleWheel}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              className="flex-1 overflow-y-auto p-6 space-y-6"
            >
              {isLoadingHistory ? (
                <div className="flex flex-col items-center justify-center h-full text-center space-y-2 text-[var(--color-neutral-5)]">
                  <RefreshCw className="w-6 h-6 animate-spin text-[var(--color-accent)]" />
                  <p className="text-xs font-mono">正在加载历史对话记录...</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center space-y-4 text-[var(--color-neutral-5)] py-12">
                  <img 
                    src="/ai-avatar.png" 
                    alt="AI Avatar" 
                    className="w-16 h-16 rounded-full object-cover border-2 border-[var(--color-accent)]/30 shadow-sm" 
                  />
                  <div className="space-y-1">
                    <h3 className="text-base font-serif font-medium text-[var(--color-neutral-9)]">
                      您好！我是您的 AI 邮件资产助手
                    </h3>
                    <p className="text-xs font-serif max-w-md mx-auto text-[var(--color-neutral-6)]">
                      您可以向我提问关于邮件往来、消费账单、SaaS 账号与联系人合作的任何问题。
                    </p>
                  </div>

                  {/* Quick Prompts */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl w-full pt-4">
                    {QUICK_PROMPTS.map((prompt, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleSend(prompt)}
                        className="p-3 text-left text-xs font-sans rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)]/60 hover:bg-[var(--color-surface-subtle)] hover:border-[var(--color-accent)]/40 text-[var(--color-neutral-8)] hover:text-[var(--color-accent)] transition-all cursor-pointer shadow-2xs"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {activeConversation?.context_summary && (
                    <div className="flex items-center justify-center my-3 animate-in fade-in duration-200">
                      <div className="px-3.5 py-1.5 rounded-full bg-[var(--color-surface-subtle)] border border-[var(--color-accent-border)]/60 text-[11px] font-mono text-[var(--color-neutral-7)] flex items-center gap-2 shadow-2xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                        <span>⚡ 上下文已智能语义压缩 · 早期历史已提炼为记忆摘要</span>
                      </div>
                    </div>
                  )}
                  {messages.map((m, idx) => {
                    const hasAssistantContent = Boolean(
                    (m.content && m.content.trim()) ||
                    m.thinking_content ||
                    m.is_thinking ||
                    (m.tool_calls && m.tool_calls.length > 0) ||
                    (m.references && m.references.length > 0)
                  );

                  if (m.role === 'assistant' && !hasAssistantContent) {
                    return null;
                  }

                  return (
                    <div
                      key={m.id || idx}
                      className={`flex gap-3.5 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      {m.role === 'assistant' && (
                        <img 
                          src="/ai-avatar.png" 
                          alt="AI Avatar" 
                          className="w-8 h-8 rounded-full object-cover border border-[var(--color-accent)]/30 shadow-xs shrink-0 mt-0.5" 
                        />
                      )}

                      <div className={`max-w-[85%] rounded-xl p-4 space-y-3 ${
                        m.role === 'user'
                          ? 'user-message-bubble bg-[var(--color-accent)] text-white shadow-sm selection:bg-white selection:text-[#141312]'
                          : 'bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[var(--color-neutral-10)]'
                      }`}>
                        {m.role === 'assistant' ? (
                          <div>
                            {/* Thinking Process Block (Collapsible) */}
                            {(m.thinking_content || m.is_thinking) && (
                              <ThinkingBlock
                                thinkingContent={m.thinking_content}
                                isThinking={m.is_thinking}
                                duration={m.thinking_duration}
                              />
                            )}

                            {/* Agent Tool Calls Section */}
                            {m.tool_calls && m.tool_calls.length > 0 && (
                              <AgentToolCallsView toolCalls={m.tool_calls} />
                            )}
                            {renderMessageContent(m.content)}

                            {/* Cited references */}
                            {m.references && m.references.length > 0 && (
                              <div className="mt-4 pt-3 border-t border-[var(--color-border)]/70">
                                <div className="text-[11px] font-mono text-[var(--color-neutral-6)] mb-2 flex items-center gap-1.5">
                                  <Mail className="w-3 h-3 text-[var(--color-accent)]" />
                                  <span>相关本地邮件引用 ({m.references.length} 项，点击查看正文):</span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {m.references.map((ref) => (
                                    <div
                                      key={ref.id}
                                      onClick={() => onSelectEmail && onSelectEmail(ref.id)}
                                      className="p-2 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-accent)] cursor-pointer transition-all text-left group"
                                    >
                                      <div className="text-xs font-medium text-[var(--color-neutral-9)] group-hover:text-[var(--color-accent)] truncate">
                                        {ref.subject}
                                      </div>
                                      <div className="text-[10px] font-mono text-[var(--color-neutral-5)] truncate mt-0.5 flex items-center justify-between">
                                        <span>{ref.from}</span>
                                        <span className="tabular-nums">{ref.date}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Message Actions - only show when content is present */}
                            {m.content && m.content.trim().length > 0 && (
                              <div className="mt-2.5 pt-1 flex items-center justify-end">
                                <button
                                  onClick={() => handleCopyMessage(m.content, idx)}
                                  className="text-[10px] font-mono text-[var(--color-neutral-5)] hover:text-[var(--color-accent)] flex items-center gap-1 cursor-pointer"
                                >
                                  {copiedIdx === idx ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                                  <span>{copiedIdx === idx ? '已复制' : '复制回答'}</span>
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="whitespace-pre-wrap leading-relaxed text-sm font-sans">{m.content}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
                </>
              )}

              {isStreaming && !messages.some(m => m.role === 'assistant' && (
                (m.content && m.content.trim()) ||
                m.thinking_content ||
                m.is_thinking ||
                (m.tool_calls && m.tool_calls.length > 0)
              )) && (
                <div className="flex items-center gap-3 animate-in fade-in duration-200 pl-0.5">
                  <img 
                    src="/ai-avatar.png" 
                    alt="AI Avatar" 
                    className="w-8 h-8 rounded-full object-cover border border-[var(--color-accent)]/30 shadow-xs shrink-0 mt-0.5" 
                  />
                  <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-xs font-mono text-[var(--color-neutral-6)] shadow-2xs">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-[var(--color-accent)]" />
                    <span>Copilot 正在检索分析并生成回答...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Quick Scroll to Bottom Floating Button */}
            {showScrollBottom && (
              <button
                type="button"
                onClick={() => scrollToBottom('smooth')}
                className="absolute bottom-4 right-8 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] shadow-md hover:shadow-xl text-xs font-mono text-[var(--color-neutral-8)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] transition-all cursor-pointer group animate-in fade-in zoom-in-95 duration-150"
                title="回到底部"
              >
                <ChevronDown className="w-3.5 h-3.5 group-hover:translate-y-0.5 transition-transform" />
                <span>回到底部</span>
                {isStreaming && (
                  <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-ping" />
                )}
              </button>
            )}
          </div>

          {/* Input Bar */}
          <div className="p-4 border-t border-[var(--color-border)] bg-[var(--color-surface)] space-y-2.5">
            {/* Input Toolbar */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ModelSelectorDropdown
                  currentModel={currentModel}
                  onSelectModel={setCurrentModel}
                  enabledModelGroups={enabledModelGroups}
                  dropUp={true}
                  compact={false}
                />
                <ThinkingModeSlider
                  thinkingLevel={thinkingLevel}
                  onSelectLevel={setThinkingLevel}
                  dropUp={true}
                  compact={false}
                />
                <ContextTokenPopover
                  stats={contextStats}
                  isCompressing={isCompressing}
                  onCompress={compressActiveConversation}
                  dropUp={true}
                  compact={false}
                />
              </div>
              <div className="text-[11px] font-mono text-[var(--color-neutral-4)]">
                <span>Shift + Enter 换行 · Enter 发送</span>
              </div>
            </div>

            {/* Active Contact Background Reference Pill */}
            {activeContactContext && (
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--color-accent-soft)]/70 border border-[var(--color-accent-border)] text-xs font-mono animate-in fade-in slide-in-from-bottom-1 duration-150">
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <span className="text-sm shrink-0">📌</span>
                  <div className="min-w-0 flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-[var(--color-neutral-5)]">引用背景:</span>
                    <span className="font-medium text-[var(--color-accent)] truncate max-w-[150px]" title={activeContactContext.name}>
                      {activeContactContext.name}
                    </span>
                    {activeContactContext.email && (
                      <span className="text-xs text-[var(--color-neutral-6)] truncate max-w-[200px]" title={activeContactContext.email}>
                        &lt;{activeContactContext.email}&gt;
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded bg-[var(--color-surface)] text-[11px] text-[var(--color-neutral-7)] border border-[var(--color-border)] shrink-0">
                      共 {activeContactContext.total_count || 0} 封往来
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={clearContactContext}
                  className="p-1 rounded text-[var(--color-neutral-5)] hover:text-rose-600 hover:bg-[var(--color-surface)] transition-colors shrink-0 cursor-pointer"
                  title="解除联系人背景引用"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="flex items-end gap-3"
            >
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="向本地邮件库提问（例如：帮我汇总上个月在海外服务器上的所有扣费记录与发票）..."
                className="flex-1 px-4 py-2.5 text-xs sm:text-sm font-sans rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-neutral-10)] focus:outline-none focus:border-[var(--color-accent)] shadow-xs placeholder:text-[var(--color-neutral-4)] resize-none leading-relaxed transition-[height] duration-75 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--color-neutral-3)] hover:[&::-webkit-scrollbar-thumb]:bg-[var(--color-neutral-4)]"
                style={{ minHeight: '44px', maxHeight: '180px', overflowY: 'hidden' }}
              />

              {isStreaming ? (
                <button
                  type="button"
                  onClick={stopStreaming}
                  className="h-[44px] px-4 rounded-lg bg-rose-600 text-white text-xs font-mono flex items-center gap-1.5 shadow-sm hover:bg-rose-700 transition-all shrink-0 cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>中止</span>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="h-[44px] yohaku-btn-primary px-5 text-xs sm:text-sm font-mono flex items-center gap-2 shadow-sm disabled:opacity-40 transition-all shrink-0 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span>发送</span>
                </button>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
