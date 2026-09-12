import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, ChevronDown, ChevronUp, Check, Layers, AlertCircle } from 'lucide-react';

export default function ModelSelectorDropdown({
  currentModel,
  onSelectModel,
  enabledModelGroups = [],
  dropUp = true,
  compact = false
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Flattened count of models
  const totalModelsCount = enabledModelGroups.reduce(
    (acc, g) => acc + (g.models ? g.models.length : 0),
    0
  );

  // Find platform name for current model
  const currentGroup = enabledModelGroups.find(g => 
    g.models && g.models.includes(currentModel)
  );

  return (
    <div className="relative inline-block" ref={containerRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        className={`inline-flex items-center gap-1.5 rounded-lg border transition-all cursor-pointer select-none ${
          isOpen
            ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)] shadow-xs'
            : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-neutral-4)] text-[var(--color-neutral-8)] hover:bg-[var(--color-surface-subtle)]'
        } ${
          compact
            ? 'px-2 py-1 text-[11px] font-mono'
            : 'px-2.5 py-1.5 text-xs font-mono'
        }`}
        title={`当前模型: ${currentModel || '未指定'}`}
      >
        <Sparkles className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-[var(--color-accent)] shrink-0`} />
        
        <span className="truncate max-w-[120px] sm:max-w-[160px] font-medium">
          {currentModel || '选择模型'}
        </span>

        {dropUp ? (
          <ChevronUp className="w-3 h-3 opacity-60 shrink-0" />
        ) : (
          <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
        )}
      </button>

      {/* Popover Dropdown */}
      {isOpen && (
        <div
          className={`absolute z-50 w-64 sm:w-72 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl backdrop-blur-md p-1.5 animate-in fade-in zoom-in-95 duration-100 ${
            dropUp ? 'bottom-full mb-1.5 left-0' : 'top-full mt-1.5 left-0'
          }`}
        >
          {/* Header */}
          <div className="px-2.5 py-1.5 border-b border-[var(--color-border)]/60 flex items-center justify-between text-[11px] font-mono text-[var(--color-neutral-5)]">
            <span className="flex items-center gap-1.5 font-medium text-[var(--color-neutral-7)]">
              <Layers className="w-3 h-3" />
              <span>可用大模型 ({totalModelsCount})</span>
            </span>
            {currentGroup && (
              <span className="truncate max-w-[100px] text-[10px]">
                {currentGroup.platform_name}
              </span>
            )}
          </div>

          {/* Body: Model Groups */}
          <div className="max-h-56 overflow-y-auto py-1 divide-y divide-[var(--color-border)]/40 text-xs">
            {enabledModelGroups.length === 0 || totalModelsCount === 0 ? (
              <div className="p-3 text-center text-xs text-[var(--color-neutral-5)] space-y-1">
                <AlertCircle className="w-4 h-4 mx-auto text-amber-500" />
                <p>暂无启用的模型</p>
                <p className="text-[10px] text-[var(--color-neutral-4)]">
                  请前往「系统设置」-「AI 大模型配置」获取并启用可用模型
                </p>
              </div>
            ) : (
              enabledModelGroups.map(group => {
                if (!group.models || group.models.length === 0) return null;
                return (
                  <div key={group.platform_id} className="py-1 first:pt-0 last:pb-0">
                    {/* Platform Group Header */}
                    <div className="px-2.5 py-1 text-[10px] font-mono text-[var(--color-neutral-5)] flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
                      <span className="font-semibold uppercase tracking-wider truncate">
                        {group.platform_name}
                      </span>
                    </div>

                    {/* Model Items */}
                    <div className="space-y-0.5 mt-0.5">
                      {group.models.map(modelName => {
                        const isSelected = currentModel === modelName;
                        return (
                          <button
                            key={modelName}
                            type="button"
                            onClick={() => {
                              onSelectModel(modelName);
                              setIsOpen(false);
                            }}
                            className={`w-full px-2.5 py-1.5 rounded-lg text-left font-mono text-xs flex items-center justify-between transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)] font-medium'
                                : 'text-[var(--color-neutral-8)] hover:bg-[var(--color-surface-subtle)]'
                            }`}
                          >
                            <span className="truncate pr-2">{modelName}</span>
                            {isSelected && (
                              <Check className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
