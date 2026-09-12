import React, { useState, useEffect, useRef } from 'react';
import { 
  Bot, 
  Sparkles, 
  X, 
  Send, 
  RefreshCw, 
  ExternalLink, 
  Maximize2, 
  Mail, 
  ChevronRight,
  User,
  AlertCircle,
  Square,
  Plus,
  Trash2,
  ChevronDown
} from 'lucide-react';
import { useAIConversation } from '../context/AIConversationContext';
import { useChatAutoScroll } from '../hooks/useChatAutoScroll';
import MarkdownRenderer from './MarkdownRenderer';
import AgentToolCallsView from './AgentToolCallsView';
import ModelSelectorDropdown from './ModelSelectorDropdown';
import ThinkingModeSlider from './ThinkingModeSlider';
import ThinkingBlock from './ThinkingBlock';
import ContextTokenPopover from './ContextTokenPopover';

const QUICK_PROMPTS = [
  '🔍 帮我查找最近的报销发票与电子账单',
  '💳 统计我当前订阅的所有 SaaS 服务与花费',
  '👥 总结最近往来最频繁的联系人与合作事项',
  '💡 提取关于项目合同与报价相关的最新邮件'
];

export default function GlobalAICopilotDrawer({ 
  isOpen, 
  onToggle, 
  selectedAccount, 
  onSelectEmail,
  onNavigateToWorkbench 
}) {
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
  const inputRef = useRef(null);

  // Sync draft prompt if invoked externally (e.g. from contact timeline drawer)
  useEffect(() => {
    if (draftPrompt) {
      setInput(draftPrompt);
      setDraftPrompt('');
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.style.height = 'auto';
          const scrollH = inputRef.current.scrollHeight;
          inputRef.current.style.height = `${Math.min(scrollH, 140)}px`;
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
    activeConvId,
    isOpen
  });

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInput(val);
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      const scrollH = inputRef.current.scrollHeight;
      const maxH = 140;
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

  const handleSend = async (textToSend) => {
    const query = (textToSend || input).trim();
    if (!query || isStreaming) return;

    setInput('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.overflowY = 'hidden';
    }
    scrollToBottom('smooth');
    await sendMessage(query, selectedAccount);
  };

  const handleCloseDrawer = () => {
    // If the conversation has no messages yet (unsent draft / unconfirmed session), clean up completely
    if (!activeConvId || messages.length === 0) {
      setInput('');
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
        inputRef.current.style.overflowY = 'hidden';
      }
      clearContactContext();
      setDraftPrompt('');
      newConversation();
    }
    onToggle();
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleCloseDrawer();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, activeConvId, messages.length]);

  // Helper to render text with clickable citation badges and markdown
  const renderMessageContent = (text) => {
    return <MarkdownRenderer content={text} onSelectEmail={onSelectEmail} />;
  };

  return (
    <>
      {/* Floating Launcher Button */}
      {!isOpen && (
        <button
          onClick={onToggle}
          className="fixed right-6 bottom-6 z-40 flex items-center gap-2.5 px-3 py-2 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] shadow-lg hover:shadow-xl hover:border-[var(--color-accent)] transition-all group cursor-pointer"
        >
          <img 
            src="/ai-avatar.png" 
            alt="AI" 
            className="w-7 h-7 rounded-full object-cover border border-[var(--color-accent)]/40 shadow-xs group-hover:scale-110 transition-transform" 
          />
          <div className="text-left pr-1">
            <div className="text-xs font-mono font-medium text-[var(--color-neutral-9)] flex items-center gap-1.5">
              <span>AI Copilot</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <div className="text-[10px] text-[var(--color-neutral-5)] font-serif">
              随时向邮件库提问
            </div>
          </div>
        </button>
      )}

      {/* Slide-out Drawer Panel */}
      {isOpen && (
        <div className="fixed right-0 top-0 bottom-0 w-full sm:w-[480px] z-50 bg-[var(--color-surface)] border-l border-[var(--color-border)] shadow-2xl flex flex-col animate-slideLeft">
          {/* Header */}
          <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-surface-subtle)]/60 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <img 
                src="/ai-avatar.png" 
                alt="AI" 
                className="w-8 h-8 rounded-full object-cover border border-[var(--color-accent)]/30 shadow-xs shrink-0" 
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-mono font-medium text-[var(--color-neutral-10)] truncate">
                    Email-Yalis Copilot
                  </h3>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-[var(--color-accent)]/10 text-[var(--color-accent)] shrink-0">
                    已同步
                  </span>
                </div>
                {/* Conversation Selector in Drawer */}
                <div className="flex items-center gap-1.5 mt-0.5">
                  <select
                    value={activeConvId || ''}
                    onChange={(e) => {
                      if (e.target.value === '__new__') {
                        newConversation();
                      } else {
                        selectConversation(e.target.value);
                      }
                    }}
                    className="text-[11px] font-sans px-1.5 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-neutral-8)] focus:outline-none focus:border-[var(--color-accent)] max-w-[160px] truncate"
                  >
                    <option value="">+ 新建对话</option>
                    {conversations.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.title || '新对话'} ({c.message_count || 0})
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      newConversation();
                      setTimeout(() => inputRef.current?.focus(), 100);
                    }}
                    className="p-1 rounded text-[var(--color-neutral-5)] hover:text-[var(--color-accent)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
                    title="新建对话"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {onNavigateToWorkbench && (
                <button
                  onClick={() => {
                    if (input && input.trim()) {
                      setDraftPrompt(input);
                    }
                    onToggle();
                    onNavigateToWorkbench();
                  }}
                  title="在全屏工作台中打开"
                  className="p-1.5 rounded text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={handleCloseDrawer}
                className="p-1.5 rounded text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Quick Prompts Bar */}
          <div className="p-2.5 border-b border-[var(--color-border)]/60 bg-[var(--color-surface-subtle)]/30 overflow-x-auto shrink-0">
            <div className="flex gap-1.5 flex-nowrap overflow-x-auto pb-0.5 no-scrollbar">
              {QUICK_PROMPTS.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSend(p)}
                  disabled={isStreaming}
                  className="text-[11px] font-sans px-2.5 py-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-neutral-8)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-all whitespace-nowrap shadow-2xs cursor-pointer shrink-0"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Messages Area */}
          <div className="relative flex-1 min-h-0 flex flex-col">
            <div 
              ref={containerRef}
              onScroll={handleScroll}
              onWheel={handleWheel}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              className="flex-1 overflow-y-auto p-4 space-y-4 font-sans text-xs"
            >
              {isLoadingHistory ? (
                <div className="flex flex-col items-center justify-center h-full text-center space-y-2 text-[var(--color-neutral-5)]">
                  <RefreshCw className="w-5 h-5 animate-spin text-[var(--color-accent)]" />
                  <p className="text-xs font-mono">加载历史记录中...</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center space-y-3 text-[var(--color-neutral-5)] py-12">
                  <img 
                    src="/ai-avatar.png" 
                    alt="AI Avatar" 
                    className="w-12 h-12 rounded-full object-cover border border-[var(--color-accent)]/30 shadow-xs" 
                  />
                  <div className="space-y-1">
                    <h4 className="font-serif font-medium text-xs text-[var(--color-neutral-9)]">
                      欢迎使用 Email-Yalis 智能邮件助手
                    </h4>
                    <p className="text-[11px] font-serif max-w-[280px] mx-auto text-[var(--color-neutral-5)]">
                      您可以随时提问关于邮件往来、消费账单、SaaS 账号与联系人合作的任何问题。
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {activeConversation?.context_summary && (
                    <div className="flex items-center justify-center my-2 animate-in fade-in duration-200">
                      <div className="px-2.5 py-1 rounded-full bg-[var(--color-surface-subtle)] border border-[var(--color-accent-border)]/60 text-[10px] font-mono text-[var(--color-neutral-7)] flex items-center gap-1.5 shadow-2xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                        <span>⚡ 上下文已智能压缩 · 早期历史已提炼为记忆摘要</span>
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
                      className={`flex gap-2.5 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      {m.role === 'assistant' && (
                        <img 
                          src="/ai-avatar.png" 
                          alt="AI" 
                          className="w-7 h-7 rounded-full object-cover border border-[var(--color-accent)]/30 shadow-xs shrink-0 mt-0.5" 
                        />
                      )}

                      <div className={`max-w-[85%] rounded-lg p-3 space-y-2 ${
                        m.role === 'user'
                          ? 'user-message-bubble bg-[var(--color-accent)] text-white shadow-xs selection:bg-white selection:text-[#141312]'
                          : 'bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[var(--color-neutral-9)]'
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
                            {/* References Section */}
                            {m.references && m.references.length > 0 && (
                              <div className="mt-2.5 pt-2 border-t border-[var(--color-border)]/60">
                                <div className="text-[10px] font-mono text-[var(--color-neutral-5)] mb-1 flex items-center gap-1">
                                  <Mail className="w-2.5 h-2.5 text-[var(--color-accent)]" />
                                  <span>检索命中来源 ({m.references.length} 封邮件):</span>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {m.references.map((ref) => (
                                    <button
                                      key={ref.id}
                                      onClick={() => onSelectEmail && onSelectEmail(ref.id)}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-accent)] text-[10px] font-mono text-[var(--color-neutral-8)] hover:text-[var(--color-accent)] transition-all max-w-[200px] truncate cursor-pointer"
                                      title={`${ref.subject} (${ref.from})`}
                                    >
                                      <span className="truncate">{ref.subject}</span>
                                      <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
                        )}
                      </div>

                      {m.role === 'user' && (
                        <div className="w-6 h-6 rounded-full bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[var(--color-neutral-7)] flex items-center justify-center shrink-0 mt-0.5">
                          <User className="w-3.5 h-3.5" />
                        </div>
                      )}
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
                <div className="flex items-center gap-2.5 animate-in fade-in duration-200">
                  <img 
                    src="/ai-avatar.png" 
                    alt="AI" 
                    className="w-7 h-7 rounded-full object-cover border border-[var(--color-accent)]/30 shadow-xs shrink-0 mt-0.5" 
                  />
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-xs font-mono text-[var(--color-neutral-6)] shadow-2xs">
                    <RefreshCw className="w-3 h-3 animate-spin text-[var(--color-accent)]" />
                    <span>Copilot 正在检索并整理回答...</span>
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
                className="absolute bottom-3 right-4 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] shadow-md hover:shadow-lg text-xs font-mono text-[var(--color-neutral-8)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] transition-all cursor-pointer group animate-in fade-in zoom-in-95 duration-150"
                title="回到底部"
              >
                <ChevronDown className="w-3.5 h-3.5 group-hover:translate-y-0.5 transition-transform" />
                <span className="text-[11px]">回到底部</span>
                {isStreaming && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-ping" />
                )}
              </button>
            )}
          </div>

          {/* Input Footer */}
          <div className="p-3 border-t border-[var(--color-border)] bg-[var(--color-surface)] space-y-2 shrink-0">
            {/* Input Toolbar */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <ModelSelectorDropdown
                  currentModel={currentModel}
                  onSelectModel={setCurrentModel}
                  enabledModelGroups={enabledModelGroups}
                  dropUp={true}
                  compact={true}
                />
                <ThinkingModeSlider
                  thinkingLevel={thinkingLevel}
                  onSelectLevel={setThinkingLevel}
                  dropUp={true}
                  compact={true}
                />
                <ContextTokenPopover
                  stats={contextStats}
                  isCompressing={isCompressing}
                  onCompress={compressActiveConversation}
                  dropUp={true}
                  compact={true}
                />
              </div>
              <span className="text-[10px] font-mono text-[var(--color-neutral-4)] hidden sm:inline">
                Shift + Enter 换行 · Enter 发送
              </span>
            </div>

            {/* Active Contact Background Reference Pill */}
            {activeContactContext && (
              <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[var(--color-accent-soft)]/70 border border-[var(--color-accent-border)] text-xs font-mono animate-in fade-in slide-in-from-bottom-1 duration-150">
                <div className="flex items-center gap-1.5 min-w-0 pr-2">
                  <span className="text-xs shrink-0">📌</span>
                  <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-[var(--color-neutral-5)]">引用背景:</span>
                    <span className="font-medium text-[var(--color-accent)] truncate max-w-[130px]" title={activeContactContext.name}>
                      {activeContactContext.name}
                    </span>
                    {activeContactContext.email && (
                      <span className="text-[11px] text-[var(--color-neutral-6)] truncate max-w-[150px]" title={activeContactContext.email}>
                        &lt;{activeContactContext.email}&gt;
                      </span>
                    )}
                    <span className="px-1.5 py-0.2 rounded bg-[var(--color-surface)] text-[10px] text-[var(--color-neutral-7)] border border-[var(--color-border)] shrink-0">
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
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="flex items-end gap-2"
            >
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="提问邮件内容、订阅服务、账单发票..."
                className="flex-1 px-3 py-2 text-xs font-sans rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-neutral-10)] focus:outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-neutral-4)] resize-none leading-relaxed transition-[height] duration-75 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--color-neutral-3)] hover:[&::-webkit-scrollbar-thumb]:bg-[var(--color-neutral-4)]"
                style={{ minHeight: '38px', maxHeight: '140px', overflowY: 'hidden' }}
              />

              {isStreaming ? (
                <button
                  type="button"
                  onClick={stopStreaming}
                  className="h-[38px] px-3 rounded-md bg-rose-600 text-white text-xs font-mono flex items-center gap-1 shadow-sm hover:bg-rose-700 cursor-pointer shrink-0"
                  title="中止生成"
                >
                  <Square className="w-3 h-3" />
                  <span>停止</span>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="h-[38px] px-3.5 rounded-md bg-[var(--color-accent)] text-white text-xs font-mono flex items-center gap-1 shadow-sm hover:opacity-90 disabled:opacity-40 transition-all cursor-pointer shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              )}
            </form>

            <div className="text-[10px] text-center font-serif text-[var(--color-neutral-4)]">
              全屏与侧边栏实时同步 · 引用卡片可点击直达邮件详情
            </div>
          </div>
        </div>
      )}
    </>
  );
}
