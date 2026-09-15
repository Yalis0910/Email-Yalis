import React, { useState, useMemo, useRef } from 'react';
import { 
  Mail, 
  ExternalLink, 
  ChevronDown, 
  ChevronUp, 
  ChevronLeft, 
  ChevronRight, 
  Search, 
  Sparkles,
  Layers
} from 'lucide-react';

/**
 * DeepSeekCitedReferences
 * 
 * Solves citation clutter when queries return dozens of email references (e.g. 19+ emails).
 * Features:
 * - Ultra-compact horizontal scrolling shelf by default (~56px height instead of 800px)
 * - Prioritizes directly cited emails (found in message text [REF:...]) at the top
 * - Expandable into a neat scrollable multi-column grid with search filtering
 * - Smooth wheel scrolling and click-to-preview email
 */
export default function DeepSeekCitedReferences({
  references = [],
  messageContent = '',
  onSelectEmail,
  isDrawer = false,
  className = ''
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const scrollRef = useRef(null);

  // 1. Identify which references were directly cited in the markdown body
  const citedIdSet = useMemo(() => {
    if (!messageContent || !references || references.length === 0) return new Set();
    const set = new Set();
    
    // Check [REF:email_id|...] pattern (including escaped \| inside markdown tables)
    const refMatches = messageContent.matchAll(/\[REF:([^|\\\]]+)/g);
    for (const m of refMatches) {
      if (m[1]) set.add(m[1].trim());
    }
    
    // Check email-ref://email_id pattern
    const uriMatches = messageContent.matchAll(/email-ref:\/\/([^? )]+)/g);
    for (const m of uriMatches) {
      if (m[1]) set.add(m[1].trim());
    }

    // Check if exact ID occurs in message text
    for (const r of references) {
      if (r.id && messageContent.includes(r.id)) {
        set.add(r.id);
      }
    }
    return set;
  }, [messageContent, references]);

  // 2. Sort directly cited references first, followed by others
  const sortedReferences = useMemo(() => {
    if (!references || references.length === 0) return [];
    return [...references].sort((a, b) => {
      const aCited = citedIdSet.has(a.id);
      const bCited = citedIdSet.has(b.id);
      if (aCited && !bCited) return -1;
      if (!aCited && bCited) return 1;
      return 0;
    });
  }, [references, citedIdSet]);

  // 3. Filter references if user types in search box during expanded mode
  const filteredReferences = useMemo(() => {
    if (!filterQuery.trim()) return sortedReferences;
    const q = filterQuery.toLowerCase();
    return sortedReferences.filter(r => 
      (r.subject && r.subject.toLowerCase().includes(q)) ||
      (r.from && r.from.toLowerCase().includes(q)) ||
      (r.date && r.date.toLowerCase().includes(q))
    );
  }, [sortedReferences, filterQuery]);

  if (!references || references.length === 0) return null;

  const totalCount = references.length;
  const directlyCitedCount = references.filter(r => citedIdSet.has(r.id)).length;

  // Horizontal scroll controls
  const scroll = (direction) => {
    if (scrollRef.current) {
      const offset = direction === 'left' ? -260 : 260;
      scrollRef.current.scrollBy({ left: offset, behavior: 'smooth' });
    }
  };

  // Turn vertical mousewheel into horizontal scrolling when hovering the strip
  const handleWheel = (e) => {
    if (scrollRef.current) {
      if (e.deltaY !== 0 && !e.shiftKey) {
        const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
        const canScrollLeft = scrollLeft > 0 && e.deltaY < 0;
        const canScrollRight = scrollLeft < scrollWidth - clientWidth - 2 && e.deltaY > 0;
        if (canScrollLeft || canScrollRight) {
          e.preventDefault();
          scrollRef.current.scrollLeft += e.deltaY;
        }
      }
    }
  };

  return (
    <div className={`mt-3 pt-2.5 border-t border-[var(--color-border)]/60 select-none ${className}`}>
      {/* Header Bar */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--color-neutral-6)]">
          <Mail className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
          <span className="font-medium text-[var(--color-neutral-8)]">相关本地邮件引用</span>
          <span className="px-1.5 py-0.2 rounded-full bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[10px] text-[var(--color-neutral-7)]">
            共 {totalCount} 封
          </span>
          {directlyCitedCount > 0 && (
            <span className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)] text-[10px] font-sans">
              <Sparkles className="w-2.5 h-2.5" />
              正文直接引用 {directlyCitedCount}
            </span>
          )}
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-1.5 text-[11px]">
          {/* Scroll arrows for horizontal mode (only if not expanded and > 2 items) */}
          {!isExpanded && totalCount > 2 && (
            <div className="hidden sm:flex items-center gap-0.5 mr-1 text-[var(--color-neutral-5)]">
              <button
                type="button"
                onClick={() => scroll('left')}
                className="p-1 rounded hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-neutral-8)] transition-colors cursor-pointer"
                title="向左滚动"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => scroll('right')}
                className="p-1 rounded hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-neutral-8)] transition-colors cursor-pointer"
                title="向右滚动"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Expand / Collapse Toggle (if totalCount > 2) */}
          {totalCount > 2 && (
            <button
              type="button"
              onClick={() => {
                setIsExpanded(!isExpanded);
                if (isExpanded) setFilterQuery('');
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] hover:bg-[var(--color-surface)] hover:border-[var(--color-accent)]/40 text-[var(--color-neutral-7)] hover:text-[var(--color-accent)] transition-all cursor-pointer font-sans text-[11px]"
            >
              {isExpanded ? (
                <>
                  <span>收起为横栏</span>
                  <ChevronUp className="w-3 h-3" />
                </>
              ) : (
                <>
                  <span>展开全部 ({totalCount})</span>
                  <ChevronDown className="w-3 h-3" />
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Mode 1: Collapsed Horizontal Scroll Shelf (Default - Clean & Space-saving) */}
      {!isExpanded ? (
        <div 
          ref={scrollRef}
          onWheel={handleWheel}
          className="flex items-stretch gap-2 overflow-x-auto pb-1.5 pt-0.5 scroll-smooth custom-scrollbar select-text"
          style={{ scrollbarWidth: 'thin' }}
        >
          {sortedReferences.map((ref, i) => {
            const isCited = citedIdSet.has(ref.id);
            return (
              <div
                key={ref.id || i}
                onClick={() => onSelectEmail && onSelectEmail(ref.id)}
                className={`group flex flex-col justify-between shrink-0 p-2 rounded-xl border transition-all cursor-pointer shadow-2xs text-left ${
                  isDrawer ? 'w-52' : 'w-60'
                } ${
                  isCited
                    ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5 hover:bg-[var(--color-surface)] hover:border-[var(--color-accent)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface-subtle)]/70 hover:bg-[var(--color-surface)] hover:border-[var(--color-neutral-4)]'
                }`}
                title={`${ref.subject || ''}\n发件人: ${ref.from || ''}\n时间: ${ref.date || ''}\n点击打开邮件正文`}
              >
                {/* Top line: Index badge & Subject */}
                <div className="flex items-start gap-1.5">
                  <span
                    className={`w-4 h-4 rounded text-[9px] font-mono shrink-0 flex items-center justify-center font-medium mt-0.5 transition-colors ${
                      isCited
                        ? 'bg-[var(--color-accent)] text-white'
                        : 'bg-[var(--color-surface-subtle)] text-[var(--color-neutral-6)] border border-[var(--color-border)] group-hover:border-[var(--color-accent)]/40 group-hover:text-[var(--color-accent)]'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-[var(--color-neutral-9)] group-hover:text-[var(--color-accent)] truncate leading-tight">
                      {ref.subject || '（无主题）'}
                    </div>
                  </div>
                  <ExternalLink className="w-3 h-3 text-[var(--color-neutral-4)] group-hover:text-[var(--color-accent)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                </div>

                {/* Bottom line: Sender & Date */}
                <div className="text-[10px] font-mono text-[var(--color-neutral-5)] truncate mt-1.5 flex items-center justify-between gap-1">
                  <span className="truncate max-w-[120px]">{ref.from || '未知发件人'}</span>
                  <span className="tabular-nums shrink-0 opacity-80">{(ref.date || '').slice(0, 10)}</span>
                </div>
              </div>
            );
          })}

          {/* Quick Expand End-Card if many items */}
          {totalCount > 4 && (
            <div
              onClick={() => setIsExpanded(true)}
              className={`flex flex-col items-center justify-center shrink-0 p-2 rounded-xl border border-dashed border-[var(--color-border)] hover:border-[var(--color-accent)]/50 bg-[var(--color-surface-subtle)]/40 hover:bg-[var(--color-surface)] cursor-pointer transition-all text-center group ${
                isDrawer ? 'w-24' : 'w-28'
              }`}
            >
              <Layers className="w-4 h-4 text-[var(--color-neutral-5)] group-hover:text-[var(--color-accent)] mb-1 transition-colors" />
              <span className="text-[11px] font-medium text-[var(--color-neutral-7)] group-hover:text-[var(--color-accent)]">
                更多 {totalCount - 3} 封
              </span>
              <span className="text-[9px] text-[var(--color-neutral-4)] mt-0.5">点击展开</span>
            </div>
          )}
        </div>
      ) : (
        /* Mode 2: Expanded Structured Multi-Column Grid (Constrained scrollable box) */
        <div className="space-y-2 select-text">
          {/* Search bar inside expanded mode if totalCount > 6 */}
          {totalCount > 6 && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[var(--color-neutral-4)] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="在当前引用来源中过滤主题、发件人或日期..."
                className="w-full pl-8 pr-3 py-1 rounded-lg text-xs bg-[var(--color-surface)] border border-[var(--color-border)] focus:border-[var(--color-accent)] focus:outline-none text-[var(--color-neutral-9)] placeholder:text-[var(--color-neutral-4)]"
              />
              {filterQuery && (
                <button
                  type="button"
                  onClick={() => setFilterQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[var(--color-neutral-4)] hover:text-[var(--color-neutral-7)]"
                >
                  清除
                </button>
              )}
            </div>
          )}

          {/* Grid Container (max-h-72 with smooth custom scrollbar) */}
          <div className={`max-h-72 overflow-y-auto pr-1 custom-scrollbar grid gap-2 ${
            isDrawer ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
          }`}>
            {filteredReferences.map((ref, i) => {
              const isCited = citedIdSet.has(ref.id);
              return (
                <div
                  key={ref.id || i}
                  onClick={() => onSelectEmail && onSelectEmail(ref.id)}
                  className={`group p-2 rounded-xl border transition-all cursor-pointer shadow-2xs text-left ${
                    isCited
                      ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5 hover:bg-[var(--color-surface)] hover:border-[var(--color-accent)]'
                      : 'border-[var(--color-border)] bg-[var(--color-surface-subtle)]/70 hover:bg-[var(--color-surface)] hover:border-[var(--color-neutral-4)]'
                  }`}
                >
                  <div className="flex items-start gap-1.5">
                    <span
                      className={`w-4 h-4 rounded text-[9px] font-mono shrink-0 flex items-center justify-center font-medium mt-0.5 ${
                        isCited
                          ? 'bg-[var(--color-accent)] text-white'
                          : 'bg-[var(--color-surface-subtle)] text-[var(--color-neutral-6)] border border-[var(--color-border)] group-hover:border-[var(--color-accent)]/40 group-hover:text-[var(--color-accent)]'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-[var(--color-neutral-9)] group-hover:text-[var(--color-accent)] truncate leading-tight">
                        {ref.subject || '（无主题）'}
                      </div>
                    </div>
                    <ExternalLink className="w-3 h-3 text-[var(--color-neutral-4)] group-hover:text-[var(--color-accent)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                  </div>

                  <div className="text-[10px] font-mono text-[var(--color-neutral-5)] truncate mt-1 flex items-center justify-between gap-1 pl-5">
                    <span className="truncate max-w-[130px]">{ref.from || '未知发件人'}</span>
                    <span className="tabular-nums shrink-0 opacity-80">{(ref.date || '').slice(0, 16)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {filteredReferences.length === 0 && (
            <div className="py-4 text-center text-xs text-[var(--color-neutral-4)] font-sans">
              未匹配到符合 "{filterQuery}" 的引用邮件
            </div>
          )}
        </div>
      )}
    </div>
  );
}
