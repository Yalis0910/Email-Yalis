import React, { useRef, useEffect } from 'react';
import { 
  ArrowUp, 
  Square, 
  Sparkles, 
  Brain, 
  ChevronDown, 
  Paperclip, 
  X,
  Zap
} from 'lucide-react';
import ModelSelectorDropdown from './ModelSelectorDropdown';
import ThinkingModeSlider from './ThinkingModeSlider';
import ContextTokenPopover from './ContextTokenPopover';

/**
 * DeepSeekInputIsland
 * Recreates the iconic DeepSeek floating multi-functional card:
 * - Floating rounded card with soft shadow & border
 * - Adaptive auto-growing textarea
 * - Integrated R1 Thinking Mode toggle pill
 * - Model selector dropdown & context token pill
 * - Circular Send / Stop action button
 * - Disclaimer text below the card
 */
export default function DeepSeekInputIsland({
  input = '',
  setInput,
  onSend,
  isStreaming = false,
  onStop,
  currentModel,
  onSelectModel,
  enabledModelGroups = {},
  thinkingLevel = 'off',
  onSelectThinkingLevel,
  contextStats,
  isCompressing,
  onCompress,
  activeContactContext,
  onClearContactContext,
  placeholder = "给 AI 邮件助手发送消息... (Enter 发送，Shift + Enter 换行)",
  className = ''
}) {
  const textareaRef = useRef(null);

  // Auto-resize textarea height as user types
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const scrollH = el.scrollHeight;
    el.style.height = `${Math.min(Math.max(scrollH, 48), 200)}px`;
  }, [input]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming && input.trim()) {
        onSend(input);
      }
    }
  };


  return (
    <div className={`w-full max-w-3xl lg:max-w-4xl mx-auto px-4 ${className}`}>
      {/* Active Contact Reference Pill (if set externally) */}
      {activeContactContext && (
        <div className="mb-2 flex items-center justify-between px-3 py-1.5 rounded-lg bg-[var(--color-accent-soft)] border border-[var(--color-accent-border)] text-xs font-mono animate-in fade-in slide-in-from-bottom-1 duration-150 shadow-2xs">
          <div className="flex items-center gap-2 min-w-0 pr-2">
            <span className="text-xs shrink-0">📌</span>
            <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-[var(--color-neutral-5)]">针对联系人探讨:</span>
              <span className="font-medium text-[var(--color-accent)] truncate max-w-[140px]">
                {activeContactContext.name}
              </span>
              {activeContactContext.email && (
                <span className="text-[11px] text-[var(--color-neutral-6)] truncate max-w-[180px]">
                  &lt;{activeContactContext.email}&gt;
                </span>
              )}
              <span className="px-1.5 py-0.2 rounded bg-[var(--color-surface)] text-[10px] text-[var(--color-neutral-6)] border border-[var(--color-border)]">
                共 {activeContactContext.total_count || 0} 封
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClearContactContext}
            className="p-1 rounded text-[var(--color-neutral-5)] hover:text-rose-600 hover:bg-[var(--color-surface)] transition-colors shrink-0 cursor-pointer"
            title="解除联系人背景引用"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Floating Rounded Island Card */}
      <div className="relative rounded-2xl sm:rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg hover:shadow-xl transition-shadow focus-within:border-[var(--color-accent)]/50 focus-within:ring-2 focus-within:ring-[var(--color-accent)]/10 p-3 sm:p-3.5">
        {/* Top Textarea */}
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full resize-none bg-transparent text-xs sm:text-[13px] leading-relaxed text-[var(--color-neutral-9)] placeholder:text-[var(--color-neutral-4)] focus:outline-hidden py-1 px-1 custom-scrollbar min-h-[44px] max-h-[200px]"
        />

        {/* Bottom Action / Configuration Row */}
        <div className="mt-2 pt-2 border-t border-[var(--color-border)]/40 flex items-center justify-between gap-2">
          {/* Left Toolbar Pills */}
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap min-w-0">
            {/* Thinking Mode Level Selector Capsule (关闭 / LOW / MEDIUM / HIGH / MAX) */}
            <ThinkingModeSlider
              thinkingLevel={thinkingLevel}
              onSelectLevel={onSelectThinkingLevel}
              dropUp={true}
              compact={false}
            />

            {/* Model Selector Dropdown */}
            <ModelSelectorDropdown
              currentModel={currentModel}
              onSelectModel={onSelectModel}
              enabledModelGroups={enabledModelGroups}
              dropUp={true}
              compact={true}
            />

            {/* Context Token Popover */}
            <ContextTokenPopover
              stats={contextStats}
              isCompressing={isCompressing}
              onCompress={onCompress}
              dropUp={true}
              compact={true}
            />
          </div>

          {/* Right Circular Send / Stop Button */}
          <div className="shrink-0 flex items-center gap-2">
            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                className="w-8 h-8 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center transition-all cursor-pointer shadow-sm hover:shadow-md animate-pulse"
                title="中止回答生成"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                disabled={!input.trim()}
                onClick={() => {
                  if (input.trim()) onSend(input);
                }}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                  input.trim()
                    ? 'bg-[var(--color-accent)] text-white hover:opacity-90 shadow-sm hover:shadow-md active:scale-95'
                    : 'bg-[var(--color-surface-subtle)] text-[var(--color-neutral-4)] cursor-not-allowed border border-[var(--color-border)]'
                }`}
                title="发送提问 (Enter)"
              >
                <ArrowUp className="w-4 h-4 stroke-[2.5]" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Centered Disclaimer Under Input Island */}
      <div className="mt-2 text-center text-[11px] font-sans text-[var(--color-neutral-4)] select-none">
        <span>内容由 AI 助手大模型生成，请注意核实重要邮件细节与财务账单</span>
      </div>
    </div>
  );
}
