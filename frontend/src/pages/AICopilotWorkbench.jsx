import React, { useState, useEffect, useRef } from 'react';
import { 
  Sparkles, 
  Send, 
  RefreshCw, 
  Square, 
  Mail, 
  Trash2, 
  Copy, 
  Check, 
  Plus, 
  MessageSquare, 
  Clock, 
  PanelLeftClose, 
  PanelLeftOpen, 
  ChevronDown, 
  RotateCw, 
  X,
  Brain,
  Search
} from 'lucide-react';
import { api } from '../api/client';
import { useAIConversation } from '../context/AIConversationContext';
import { useChatAutoScroll } from '../hooks/useChatAutoScroll';
import MarkdownRenderer from '../components/MarkdownRenderer';
import DeepSeekThinkingBar from '../components/DeepSeekThinkingBar';
import DeepSeekToolPill from '../components/DeepSeekToolPill';
import DeepSeekInputIsland from '../components/DeepSeekInputIsland';
import AIThinkingStatusCard from '../components/AIThinkingStatusCard';
import DeepSeekCitedReferences from '../components/DeepSeekCitedReferences';

const QUICK_PROMPTS = [
  '🔍 帮我检索我最近成交订单的是哪一名客户',
  '💳 统计我当前订阅的所有海外 SaaS 服务与开销',
  '👥 提取最近往来最频繁的外贸客户与合作进展',
  '💡 查询最近关于项目合同与发票收据的最新邮件'
];

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

function groupConversationsByDate(conversations) {
  const groups = {
    today: [],
    past7Days: [],
    older: []
  };

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOf7DaysAgo = startOfToday - 7 * 86400 * 1000;

  (conversations || []).forEach(conv => {
    const rawTime = conv.updated_at || conv.created_at;
    const time = rawTime ? new Date(rawTime.replace(' ', 'T')).getTime() : 0;
    if (time >= startOfToday) {
      groups.today.push(conv);
    } else if (time >= startOf7DaysAgo) {
      groups.past7Days.push(conv);
    } else {
      groups.older.push(conv);
    }
  });

  return [
    { label: '今天', items: groups.today },
    { label: '前 7 天', items: groups.past7Days },
    { label: '更早', items: groups.older }
  ].filter(g => g.items.length > 0);
}

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
    regenerateResponse,
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Sync draft prompt if invoked externally
  useEffect(() => {
    if (draftPrompt) {
      setInput(draftPrompt);
      setDraftPrompt('');
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

  const handleSend = async (customText = null) => {
    const textToSend = (customText || input).trim();
    if (!textToSend || isStreaming) return;
    setInput('');
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

  const groupedConversations = groupConversationsByDate(conversations);

  return (
    <div className="max-w-7xl mx-auto space-y-4 pb-6">
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3 pt-1">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-serif font-medium text-[var(--color-neutral-10)] tracking-tight">
              AI 邮件助手工作台
            </h1>
          </div>
          <p className="text-xs font-serif text-[var(--color-neutral-6)] mt-0.5">
            深度集成本地 SQLite 全文索引、智能体工具链与外贸业务记忆，全景呈现思维链与真实引用数据。
          </p>
        </div>
      </div>

      {/* Main Container: Left Sidebar (History Sessions) + Right DeepSeek Chat Viewport */}
      <div className="yohaku-card flex h-[calc(100vh-170px)] min-h-[620px] overflow-hidden p-0 border border-[var(--color-border)] rounded-2xl shadow-sm bg-[var(--color-surface)] relative">
        
        {/* Left Sidebar: DeepSeek Style Session Groups & New Chat */}
        <div
          className={`${
            isSidebarOpen ? 'w-64 sm:w-72' : 'w-0'
          } transition-all duration-200 border-r border-[var(--color-border)] bg-[var(--color-surface-subtle)] flex flex-col shrink-0 overflow-hidden select-none`}
        >
          {/* Top New Conversation Button */}
          <div className="p-3 border-b border-[var(--color-border)]/60 bg-[var(--color-surface-subtle)]">
            <button
              onClick={() => newConversation()}
              className="w-full py-2.5 px-3.5 rounded-xl bg-[var(--color-surface)] hover:bg-[var(--color-surface)]/80 text-[var(--color-neutral-9)] hover:text-[var(--color-accent)] border border-[var(--color-border)] hover:border-[var(--color-accent)]/40 text-xs sm:text-[13px] font-sans font-medium flex items-center justify-center gap-2 shadow-2xs hover:shadow-xs transition-all cursor-pointer group"
            >
              <Plus className="w-4 h-4 text-[var(--color-accent)] group-hover:rotate-90 transition-transform duration-200" />
              <span>开启新对话</span>
            </button>
          </div>

          {/* Grouped History List */}
          <div className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4 custom-scrollbar">
            {conversations.length === 0 ? (
              <div className="py-16 text-center text-[var(--color-neutral-4)] text-xs font-serif">
                暂无历史对话记录<br />
                点击上方「开启新对话」开始交流
              </div>
            ) : (
              groupedConversations.map((group) => (
                <div key={group.label} className="space-y-1">
                  <div className="px-2.5 py-1 text-[11px] font-mono font-medium text-[var(--color-neutral-4)]">
                    {group.label}
                  </div>
                  {group.items.map((conv) => {
                    const isActive = conv.id === activeConvId;
                    return (
                      <div
                        key={conv.id}
                        onClick={() => selectConversation(conv.id)}
                        className={`group relative flex items-center justify-between px-3 py-2 rounded-xl text-xs cursor-pointer transition-all ${
                          isActive
                            ? 'bg-[var(--color-surface)] text-[var(--color-accent)] font-medium border border-[var(--color-accent)]/30 shadow-2xs'
                            : 'text-[var(--color-neutral-7)] hover:bg-[var(--color-surface)] hover:text-[var(--color-neutral-10)]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                          <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-neutral-4)] group-hover:text-[var(--color-neutral-6)]'}`} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-sans text-xs">
                              {conv.title || '新对话'}
                            </div>
                          </div>
                        </div>

                        {/* Delete Session Icon */}
                        <button
                          onClick={(e) => handleDeleteSession(e, conv.id)}
                          className="p-1 rounded text-[var(--color-neutral-4)] hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors opacity-0 group-hover:opacity-100 shrink-0 cursor-pointer"
                          title="删除对话"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Chat Canvas: DeepSeek Flat Centered Stream with Floating Input Island */}
        <div className="flex-1 flex flex-col min-w-0 bg-[var(--color-surface)] relative overflow-hidden">
          
          {/* Top Subtle Canvas Header */}
          <div className="px-4 sm:px-6 py-2.5 border-b border-[var(--color-border)]/60 flex items-center justify-between bg-[var(--color-surface)] shrink-0 z-10">
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="p-1.5 rounded-lg text-[var(--color-neutral-6)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-neutral-9)] transition-colors cursor-pointer"
                title={isSidebarOpen ? '收起侧边栏' : '展开侧边栏'}
              >
                {isSidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
              </button>
              
              <div className="min-w-0 flex items-center gap-2">
                <span className="font-serif font-medium text-xs sm:text-sm text-[var(--color-neutral-9)] truncate">
                  {activeConversation ? activeConversation.title : (activeContactContext ? `👤 研讨: ${activeContactContext.name}` : '新对话')}
                </span>
                {activeConvId && (
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--color-surface-subtle)] text-[var(--color-neutral-5)] border border-[var(--color-border)]">
                    {messages.length} 轮互动
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => newConversation()}
                className="p-1.5 rounded-lg text-[var(--color-neutral-5)] hover:text-[var(--color-accent)] hover:bg-[var(--color-surface-subtle)] transition-colors cursor-pointer"
                title="开启新对话"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                onClick={clearCurrentMessages}
                className="p-1.5 rounded-lg text-[var(--color-neutral-5)] hover:text-rose-600 hover:bg-[var(--color-surface-subtle)] transition-colors cursor-pointer"
                title="清空当前消息"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Centered Scrollable Messages Viewport (with generous bottom padding for floating input) */}
          <div 
            ref={containerRef}
            onScroll={handleScroll}
            onWheel={handleWheel}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            className="flex-1 overflow-y-auto px-4 sm:px-6 pt-4 pb-48 custom-scrollbar"
          >
            <div className="max-w-3xl lg:max-w-4xl mx-auto w-full space-y-7">
              {isLoadingHistory ? (
                <div className="flex flex-col items-center justify-center py-24 text-center space-y-2 text-[var(--color-neutral-5)]">
                  <RefreshCw className="w-6 h-6 animate-spin text-[var(--color-accent)]" />
                  <p className="text-xs font-mono">正在加载历史对话记录...</p>
                </div>
              ) : messages.length === 0 ? (
                /* DeepSeek Clean Greeting State */
                <div className="flex flex-col items-center justify-center py-16 sm:py-24 text-center space-y-6">
                  <div className="relative">
                    <img 
                      src="/ai-avatar.png" 
                      alt="AI Avatar" 
                      className="w-14 h-14 sm:w-16 sm:h-16 rounded-full object-cover border-2 border-[var(--color-accent)]/30 shadow-md" 
                    />
                    <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center shadow-xs">
                      <Sparkles className="w-3 h-3 text-[var(--color-accent)]" />
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <h3 className="text-base sm:text-lg font-serif font-medium text-[var(--color-neutral-10)]">
                      您好！我是您的 AI 邮件资产助手
                    </h3>
                    <p className="text-xs font-serif max-w-md mx-auto text-[var(--color-neutral-6)] leading-relaxed">
                      基于本地全量邮件与数字资产数据库，随时为您查询客户往来、订单确认、账单发票与深度数据分析。
                    </p>
                  </div>

                  {/* DeepSeek Quick Prompts Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-xl w-full pt-2">
                    {QUICK_PROMPTS.map((prompt, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleSend(prompt)}
                        className="p-3 text-left text-xs font-sans rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)]/60 hover:bg-[var(--color-surface)] hover:border-[var(--color-accent)]/50 text-[var(--color-neutral-8)] hover:text-[var(--color-neutral-10)] transition-all cursor-pointer shadow-2xs hover:shadow-xs group"
                      >
                        <span className="group-hover:translate-x-0.5 inline-block transition-transform">
                          {prompt}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                /* DeepSeek Flat Message Stream */
                <>
                  {activeConversation?.context_summary && (
                    <div className="flex items-center justify-center my-3 animate-in fade-in duration-200">
                      <div className="px-3.5 py-1.5 rounded-full bg-[var(--color-surface-subtle)] border border-[var(--color-accent-border)]/60 text-[11px] font-mono text-[var(--color-neutral-7)] flex items-center gap-2 shadow-2xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                        <span>⚡ 上下文已智能语义压缩 · 早期历史已提炼为长效记忆</span>
                      </div>
                    </div>
                  )}

                  {messages.map((m, idx) => {
                    const isCurrentStreaming = isStreaming && idx === messages.length - 1;
                    const hasAssistantContent = Boolean(
                      (m.content && m.content.trim()) ||
                      m.thinking_content ||
                      m.is_thinking ||
                      (m.tool_calls && m.tool_calls.length > 0) ||
                      (m.references && m.references.length > 0) ||
                      isCurrentStreaming ||
                      m.stream_status === 'stopped' ||
                      m.stream_status === 'error'
                    );

                    if (m.role === 'assistant' && !hasAssistantContent) {
                      return null;
                    }

                    if (m.role === 'user') {
                      /* DeepSeek Style User Message Bubble */
                      return (
                        <div key={m.id || idx} className="flex justify-end my-3">
                          <div className="max-w-[85%] sm:max-w-[78%] rounded-2xl px-4 py-2.5 bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[var(--color-neutral-9)] text-xs sm:text-[13px] leading-relaxed shadow-2xs">
                            <div className="whitespace-pre-wrap font-sans select-text">{m.content}</div>
                          </div>
                        </div>
                      );
                    }

                    /* DeepSeek Style Flat Assistant Message */
                    return (
                      <div key={m.id || idx} className="my-5 select-text">
                        {/* Assistant Header: Avatar + Label */}
                        <div className="flex items-center gap-2 mb-2">
                          <img 
                            src="/ai-avatar.png" 
                            alt="AI Avatar" 
                            className="w-6 h-6 rounded-full object-cover border border-[var(--color-accent)]/30 shadow-2xs" 
                          />
                          <span className="text-xs font-serif font-medium text-[var(--color-neutral-9)]">
                            AI 邮件资产助手
                          </span>
                          {currentModel && (
                            <span className="text-[10px] font-mono text-[var(--color-neutral-4)] px-1.5 py-0.2 rounded bg-[var(--color-surface-subtle)] border border-[var(--color-border)]/60">
                              {currentModel}
                            </span>
                          )}
                        </div>

                        {/* Flat Body Container (No Card Borders!) */}
                        <div className="pl-8 space-y-3">
                          {/* DeepSeek R1 Thinking Bar */}
                          {(m.thinking_content || m.is_thinking) && (
                            <DeepSeekThinkingBar
                              thinkingContent={m.thinking_content}
                              isThinking={m.is_thinking}
                              duration={m.thinking_duration}
                              defaultExpanded={Boolean(m.is_thinking)}
                            />
                          )}

                          {/* DeepSeek Search / Tool Execution Pill */}
                          {m.tool_calls && m.tool_calls.length > 0 && (
                            <DeepSeekToolPill
                              toolCalls={m.tool_calls}
                              references={m.references || []}
                              isStreaming={isCurrentStreaming}
                              hasContent={Boolean(m.content && m.content.trim())}
                            />
                          )}

                          {/* Active Status Card (analyzing, synthesizing, stopped, error) */}
                          {((isCurrentStreaming && (!m.content || !m.content.trim()) && !m.is_thinking) || (m.stream_status === 'stopped' || m.stream_status === 'error')) && (
                            <AIThinkingStatusCard
                              streamStatus={m.stream_status || (m.tool_calls?.length > 0 ? 'synthesizing' : 'analyzing')}
                              statusMessage={m.status_message}
                              startedAt={m.started_at}
                              isStreaming={isCurrentStreaming}
                              hasContent={Boolean(m.content && m.content.trim())}
                              toolCalls={m.tool_calls || []}
                              references={m.references || []}
                              onStop={isCurrentStreaming ? stopStreaming : null}
                              onRetry={() => regenerateResponse(idx, selectedAccount)}
                            />
                          )}

                          {/* Pure Flat Markdown Answer */}
                          {m.content && m.content.trim().length > 0 && (
                            <div className="relative font-sans text-xs sm:text-[13px] leading-relaxed text-[var(--color-neutral-9)]">
                              {renderMessageContent(m.content)}
                              {isCurrentStreaming && (
                                <span className="inline-block w-1.5 h-4 ml-1 bg-[var(--color-accent)] animate-pulse align-middle" />
                              )}
                            </div>
                          )}

                          {/* DeepSeek Cited References Shelf & Collapsible Grid */}
                          {m.references && m.references.length > 0 && (
                            <DeepSeekCitedReferences
                              references={m.references}
                              messageContent={m.content}
                              onSelectEmail={onSelectEmail}
                              isDrawer={false}
                            />
                          )}

                          {/* Bottom Action Row (Copy, Regenerate, Duration) */}
                          {!isCurrentStreaming && (m.content || m.tool_calls?.length > 0) && (
                            <div className="mt-2.5 pt-1.5 flex items-center justify-between text-[11px] font-mono text-[var(--color-neutral-4)] select-none">
                              <div className="flex items-center gap-2">
                                {m.total_duration ? (
                                  <span>耗时 {m.total_duration}s</span>
                                ) : (m.thinking_duration > 0 ? (
                                  <span>思考 {m.thinking_duration}s</span>
                                ) : null)}
                                {m.is_interrupted && (
                                  <span className="text-amber-600 bg-amber-500/10 px-1.5 py-0.2 rounded font-sans text-[10px]">
                                    已中止
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => regenerateResponse(idx, selectedAccount)}
                                  className="hover:text-[var(--color-accent)] flex items-center gap-1 cursor-pointer transition-colors"
                                  title="以此轮问题重新生成回答"
                                >
                                  <RotateCw className="w-3 h-3" />
                                  <span>重新生成</span>
                                </button>

                                {m.content && m.content.trim().length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => handleCopyMessage(m.content, idx)}
                                    className="hover:text-[var(--color-accent)] flex items-center gap-1 cursor-pointer transition-colors"
                                  >
                                    {copiedIdx === idx ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                                    <span>{copiedIdx === idx ? '已复制' : '复制回答'}</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Quick Scroll to Bottom Floating Button */}
          {showScrollBottom && (
            <button
              type="button"
              onClick={() => scrollToBottom('smooth')}
              className="absolute bottom-40 right-8 z-30 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] shadow-md hover:shadow-xl text-xs font-mono text-[var(--color-neutral-8)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] transition-all cursor-pointer group animate-in fade-in zoom-in-95 duration-150"
              title="回到底部"
            >
              <ChevronDown className="w-3.5 h-3.5 group-hover:translate-y-0.5 transition-transform" />
              <span>回到底部</span>
              {isStreaming && (
                <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-ping" />
              )}
            </button>
          )}

          {/* DeepSeek Signature Floating Multi-functional Input Island with Gradient Fade */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col justify-end pb-3 pt-12 bg-gradient-to-t from-[var(--color-surface)] via-[var(--color-surface)]/90 to-transparent">
            <div className="pointer-events-auto">
              <DeepSeekInputIsland
                input={input}
                setInput={setInput}
                onSend={handleSend}
                isStreaming={isStreaming}
                onStop={stopStreaming}
                currentModel={currentModel}
                onSelectModel={setCurrentModel}
                enabledModelGroups={enabledModelGroups}
                thinkingLevel={thinkingLevel}
                onSelectThinkingLevel={setThinkingLevel}
                contextStats={contextStats}
                isCompressing={isCompressing}
                onCompress={compressActiveConversation}
                activeContactContext={activeContactContext}
                onClearContactContext={clearContactContext}
              />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
