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
  ChevronDown,
  RotateCw,
  Copy,
  Check
} from 'lucide-react';
import { useAIConversation } from '../context/AIConversationContext';
import { useChatAutoScroll } from '../hooks/useChatAutoScroll';
import MarkdownRenderer from './MarkdownRenderer';
import DeepSeekThinkingBar from './DeepSeekThinkingBar';
import DeepSeekToolPill from './DeepSeekToolPill';
import DeepSeekInputIsland from './DeepSeekInputIsland';
import AIThinkingStatusCard from './AIThinkingStatusCard';
import DeepSeekCitedReferences from './DeepSeekCitedReferences';

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
  const [showSessionDropdown, setShowSessionDropdown] = useState(false);

  const handleCopyMessage = (text, idx) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  // Sync draft prompt if invoked externally (e.g. from contact timeline drawer)
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

  const handleCloseDrawer = () => {
    setShowSessionDropdown(false);
    onToggle();
  };

  const renderMessageContent = (text) => {
    return <MarkdownRenderer content={text} onSelectEmail={onSelectEmail} />;
  };

  return (
    <>
      {/* Floating Toggle Button (visible when drawer is closed) */}
      {!isOpen && (
        <button
          onClick={onToggle}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-3.5 py-2.5 rounded-full bg-[var(--color-surface)] text-[var(--color-neutral-9)] border border-[var(--color-border)] shadow-md hover:shadow-lg hover:border-[var(--color-accent)]/50 transition-all cursor-pointer group"
          title="打开 AI Copilot 助手"
        >
          <div className="relative">
            <img 
              src="/ai-avatar.png" 
              alt="AI" 
              className="w-5 h-5 rounded-full object-cover" 
            />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white" />
          </div>
          <span className="text-xs font-serif font-medium tracking-wide">
            AI Copilot
          </span>
          <span className="text-[10px] font-mono text-[var(--color-neutral-5)] group-hover:text-[var(--color-accent)]">
            随时问答邮件资产
          </span>
        </button>
      )}



      {/* Slide-out Drawer Panel */}
      {isOpen && (
        <div className="fixed top-0 right-0 bottom-0 w-full sm:w-[500px] md:w-[560px] bg-[var(--color-surface)] shadow-2xl z-50 flex flex-col border-l border-[var(--color-border)] animate-in slide-in-from-right duration-250 ease-out">
          
          {/* Drawer Top Header */}
          <div className="px-4 py-3 border-b border-[var(--color-border)]/70 flex items-center justify-between bg-[var(--color-surface)] shrink-0 z-10">
            <div className="flex items-center gap-2 min-w-0">
              <img 
                src="/ai-avatar.png" 
                alt="AI" 
                className="w-6 h-6 rounded-full object-cover border border-[var(--color-accent)]/30 shrink-0" 
              />
              <div className="relative min-w-0">
                <button
                  type="button"
                  onClick={() => setShowSessionDropdown(!showSessionDropdown)}
                  className="flex items-center gap-1.5 text-xs font-serif font-medium text-[var(--color-neutral-10)] hover:text-[var(--color-accent)] transition-colors cursor-pointer truncate max-w-[240px]"
                >
                  <span className="truncate">
                    {activeConversation ? activeConversation.title : (activeContactContext ? `👤 研讨: ${activeContactContext.name}` : '新对话')}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 shrink-0 text-[var(--color-neutral-5)]" />
                </button>

                {/* Dropdown for Switching Sessions in Drawer */}
                {showSessionDropdown && (
                  <div className="absolute top-full left-0 mt-1.5 w-64 max-h-72 overflow-y-auto rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-xl p-1.5 z-30 space-y-1 custom-scrollbar animate-in fade-in zoom-in-95 duration-100">
                    <button
                      type="button"
                      onClick={() => {
                        newConversation();
                        setShowSessionDropdown(false);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-sans font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors text-left cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>开启新对话</span>
                    </button>
                    <div className="border-t border-[var(--color-border)]/60 my-1" />
                    {conversations.map(conv => (
                      <button
                        key={conv.id}
                        type="button"
                        onClick={() => {
                          selectConversation(conv.id);
                          setShowSessionDropdown(false);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left cursor-pointer transition-colors truncate ${
                          conv.id === activeConvId
                            ? 'bg-[var(--color-surface-subtle)] text-[var(--color-accent)] font-medium'
                            : 'text-[var(--color-neutral-8)] hover:bg-[var(--color-surface-subtle)]'
                        }`}
                      >
                        <span className="truncate">{conv.title || '新对话'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right Action Icons */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => newConversation()}
                className="p-1.5 rounded-lg text-[var(--color-neutral-6)] hover:text-[var(--color-accent)] hover:bg-[var(--color-surface-subtle)] transition-colors cursor-pointer"
                title="开启新对话"
              >
                <Plus className="w-4 h-4" />
              </button>
              {onNavigateToWorkbench && (
                <button
                  type="button"
                  onClick={() => {
                    if (input && input.trim()) {
                      setDraftPrompt(input);
                    }
                    onToggle();
                    onNavigateToWorkbench();
                  }}
                  title="在全屏工作台中打开"
                  className="p-1.5 rounded-lg text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)] hover:bg-[var(--color-surface-subtle)] transition-colors cursor-pointer"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={clearCurrentMessages}
                className="p-1.5 rounded-lg text-[var(--color-neutral-5)] hover:text-rose-600 hover:bg-[var(--color-surface-subtle)] transition-colors cursor-pointer"
                title="清空当前消息"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleCloseDrawer}
                className="p-1.5 rounded-lg text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)] hover:bg-[var(--color-surface-subtle)] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Quick Prompts Horizontal Scroll */}
          <div className="px-3 py-2 border-b border-[var(--color-border)]/60 bg-[var(--color-surface-subtle)]/30 overflow-x-auto shrink-0 no-scrollbar">
            <div className="flex gap-1.5 flex-nowrap">
              {QUICK_PROMPTS.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSend(p)}
                  disabled={isStreaming}
                  className="text-[11px] font-sans px-2.5 py-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-neutral-8)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-all whitespace-nowrap shadow-2xs cursor-pointer shrink-0"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Messages Scroll Area with DeepSeek Flat Stream & Bottom Padding */}
          <div className="relative flex-1 min-h-0 flex flex-col">
            <div 
              ref={containerRef}
              onScroll={handleScroll}
              onWheel={handleWheel}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              className="flex-1 overflow-y-auto px-4 pt-3 pb-44 space-y-5 custom-scrollbar"
            >
              {isLoadingHistory ? (
                <div className="flex flex-col items-center justify-center py-20 text-center space-y-2 text-[var(--color-neutral-5)]">
                  <RefreshCw className="w-5 h-5 animate-spin text-[var(--color-accent)]" />
                  <p className="text-xs font-mono">加载历史记录中...</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center space-y-3 text-[var(--color-neutral-5)]">
                  <img 
                    src="/ai-avatar.png" 
                    alt="AI Avatar" 
                    className="w-12 h-12 rounded-full object-cover border border-[var(--color-accent)]/30 shadow-xs" 
                  />
                  <div className="space-y-1">
                    <h4 className="font-serif font-medium text-xs sm:text-sm text-[var(--color-neutral-9)]">
                      欢迎使用 Email-Yalis 智能邮件助手
                    </h4>
                    <p className="text-[11px] font-serif max-w-[280px] mx-auto text-[var(--color-neutral-5)] leading-relaxed">
                      随时向我提问关于邮件往来、消费账单、SaaS 账号与客户合作的任何问题。
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {activeConversation?.context_summary && (
                    <div className="flex items-center justify-center my-2 animate-in fade-in duration-200">
                      <div className="px-2.5 py-1 rounded-full bg-[var(--color-surface-subtle)] border border-[var(--color-accent-border)]/60 text-[10px] font-mono text-[var(--color-neutral-7)] flex items-center gap-1.5 shadow-2xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                        <span>⚡ 上下文已智能语义压缩</span>
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
                      /* DeepSeek Style User Message Bubble in Drawer */
                      return (
                        <div key={m.id || idx} className="flex justify-end my-2">
                          <div className="max-w-[85%] rounded-2xl px-3.5 py-2 bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[var(--color-neutral-9)] text-xs leading-relaxed shadow-2xs">
                            <div className="whitespace-pre-wrap font-sans select-text">{m.content}</div>
                          </div>
                        </div>
                      );
                    }

                    /* DeepSeek Style Flat Assistant Message in Drawer */
                    return (
                      <div key={m.id || idx} className="my-4 select-text">
                        {/* Assistant Header */}
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <img 
                            src="/ai-avatar.png" 
                            alt="AI" 
                            className="w-5 h-5 rounded-full object-cover border border-[var(--color-accent)]/30 shadow-2xs shrink-0" 
                          />
                          <span className="text-xs font-serif font-medium text-[var(--color-neutral-9)]">
                            AI 邮件资产助手
                          </span>
                        </div>

                        {/* Flat Body (No Card Borders) */}
                        <div className="pl-6 space-y-2.5">
                          {/* DeepSeek R1 Thinking Bar */}
                          {(m.thinking_content || m.is_thinking) && (
                            <DeepSeekThinkingBar
                              thinkingContent={m.thinking_content}
                              isThinking={m.is_thinking}
                              duration={m.thinking_duration}
                              defaultExpanded={Boolean(m.is_thinking)}
                            />
                          )}

                          {/* DeepSeek Tool Call Pill */}
                          {m.tool_calls && m.tool_calls.length > 0 && (
                            <DeepSeekToolPill
                              toolCalls={m.tool_calls}
                              references={m.references || []}
                              isStreaming={isCurrentStreaming}
                              hasContent={Boolean(m.content && m.content.trim())}
                            />
                          )}

                          {/* Status Card (analyzing, synthesizing, stopped, error) */}
                          {((isCurrentStreaming && (!m.content || !m.content.trim()) && !m.is_thinking) || (m.stream_status === 'stopped' || m.stream_status === 'error')) && (
                            <AIThinkingStatusCard
                              streamStatus={m.stream_status || (m.tool_calls?.length > 0 ? 'synthesizing' : 'analyzing')}
                              statusMessage={m.status_message}
                              startedAt={m.started_at}
                              isStreaming={isCurrentStreaming}
                              hasContent={Boolean(m.content && m.content.trim())}
                              toolCalls={m.tool_calls || []}
                              references={m.references || []}
                              compact={true}
                              onStop={isCurrentStreaming ? stopStreaming : null}
                              onRetry={() => regenerateResponse(idx, selectedAccount)}
                            />
                          )}

                          {/* Pure Flat Markdown Answer */}
                          {m.content && m.content.trim().length > 0 && (
                            <div className="relative font-sans text-xs leading-relaxed text-[var(--color-neutral-9)]">
                              {renderMessageContent(m.content)}
                              {isCurrentStreaming && (
                                <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-[var(--color-accent)] animate-pulse align-middle" />
                              )}
                            </div>
                          )}

                          {/* DeepSeek Cited References */}
                          {m.references && m.references.length > 0 && (
                            <DeepSeekCitedReferences
                              references={m.references}
                              messageContent={m.content}
                              onSelectEmail={onSelectEmail}
                              isDrawer={true}
                            />
                          )}

                          {/* Action Row */}
                          {!isCurrentStreaming && (m.content || m.tool_calls?.length > 0) && (
                            <div className="mt-2 pt-1 flex items-center justify-between text-[10px] font-mono text-[var(--color-neutral-4)] select-none">
                              <div>
                                {m.total_duration ? (
                                  <span>耗时 {m.total_duration}s</span>
                                ) : (m.thinking_duration > 0 ? (
                                  <span>思考 {m.thinking_duration}s</span>
                                ) : null)}
                              </div>

                              <div className="flex items-center gap-2.5">
                                <button
                                  type="button"
                                  onClick={() => regenerateResponse(idx, selectedAccount)}
                                  className="hover:text-[var(--color-accent)] flex items-center gap-1 cursor-pointer transition-colors"
                                  title="重新生成"
                                >
                                  <RotateCw className="w-2.5 h-2.5" />
                                  <span>重试</span>
                                </button>
                                {m.content && m.content.trim().length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => handleCopyMessage(m.content, idx)}
                                    className="hover:text-[var(--color-accent)] flex items-center gap-1 cursor-pointer transition-colors"
                                  >
                                    {copiedIdx === idx ? <Check className="w-2.5 h-2.5 text-emerald-600" /> : <Copy className="w-2.5 h-2.5" />}
                                    <span>{copiedIdx === idx ? '已复制' : '复制'}</span>
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

            {/* Quick Scroll to Bottom Floating Button */}
            {showScrollBottom && (
              <button
                type="button"
                onClick={() => scrollToBottom('smooth')}
                className="absolute bottom-36 right-6 z-30 flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] shadow-md hover:shadow-lg text-[10px] font-mono text-[var(--color-neutral-8)] hover:text-[var(--color-accent)] transition-all cursor-pointer group"
                title="回到底部"
              >
                <ChevronDown className="w-3 h-3 group-hover:translate-y-0.5 transition-transform" />
                <span>回到底部</span>
                {isStreaming && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-ping" />
                )}
              </button>
            )}

            {/* DeepSeek Floating Input Island in Drawer with Gradient Backdrop */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col justify-end pb-2 pt-8 bg-gradient-to-t from-[var(--color-surface)] via-[var(--color-surface)]/95 to-transparent">
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
                  placeholder="提问邮件往来、账单或订单..."
                />
              </div>
            </div>

          </div>
        </div>
      )}
    </>
  );
}
