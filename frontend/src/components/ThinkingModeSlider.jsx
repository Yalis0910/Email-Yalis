import React, { useState, useRef, useEffect, useId } from 'react';
import { BrainCircuit, ChevronUp, ChevronDown } from 'lucide-react';

export const THINKING_LEVELS = [
  {
    id: 'off',
    name: '关闭思考',
    shortName: '关闭',
    tag: '标准响应',
    color: '#64748b',
    textColor: 'text-slate-600 dark:text-slate-400',
    borderColor: 'border-slate-300 dark:border-slate-700',
    bgColor: 'bg-slate-500/10',
    glowColor: 'shadow-slate-500/20',
    thumbClass: 'bg-slate-500 ring-slate-400',
    trackGradient: 'from-slate-400 to-slate-500',
    hint: '标准直出模式，不启用链式推理，响应最敏捷。'
  },
  {
    id: 'low',
    name: '浅度思考',
    shortName: '浅度',
    tag: '快速推理',
    color: '#059669',
    textColor: 'text-emerald-600 dark:text-emerald-400',
    borderColor: 'border-emerald-500/30',
    bgColor: 'bg-emerald-500/15',
    glowColor: 'shadow-emerald-500/25',
    thumbClass: 'bg-emerald-500 ring-emerald-300',
    trackGradient: 'from-slate-400 via-emerald-400 to-emerald-500',
    hint: '轻量快速推理（约 1024 Token 预算），适合日常问答与要点速读。'
  },
  {
    id: 'medium',
    name: '平衡思考',
    shortName: '平衡',
    tag: '稳健分析',
    color: '#0284c7',
    textColor: 'text-sky-600 dark:text-sky-400',
    borderColor: 'border-sky-500/30',
    bgColor: 'bg-sky-500/15',
    glowColor: 'shadow-sky-500/25',
    thumbClass: 'bg-sky-500 ring-sky-300',
    trackGradient: 'from-emerald-400 via-sky-400 to-sky-600',
    hint: '稳健推导（约 4096 Token 预算），兼顾推导深度与速度，适合长邮件梳理。'
  },
  {
    id: 'high',
    name: '深度思考',
    shortName: '深度',
    tag: '极限推导',
    color: '#7c3aed',
    textColor: 'text-purple-600 dark:text-purple-400',
    borderColor: 'border-purple-500/30',
    bgColor: 'bg-purple-500/15',
    glowColor: 'shadow-purple-500/30',
    thumbClass: 'bg-purple-600 ring-purple-300',
    trackGradient: 'from-sky-500 via-indigo-500 to-purple-600',
    hint: '最大推理预算（全链路推导），适合复杂财务核算与深度跨邮件因果引用。'
  }
];

export default function ThinkingModeSlider({
  thinkingLevel = 'off',
  onSelectLevel,
  dropUp = true,
  compact = false
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  const sliderId = useId ? useId().replace(/[^a-zA-Z0-9]/g, '') : 'thk';

  const currentIndex = Math.max(
    0,
    THINKING_LEVELS.findIndex(l => l.id === thinkingLevel)
  );
  const currentConfig = THINKING_LEVELS[currentIndex] || THINKING_LEVELS[0];

  // Close popup when clicking outside
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

  const handleSliderChange = (e) => {
    const val = parseInt(e.target.value, 10);
    const target = THINKING_LEVELS[val];
    if (target && onSelectLevel) {
      onSelectLevel(target.id);
    }
  };

  return (
    <div className="relative inline-block" ref={containerRef}>
      {/* Trigger Capsule Button */}
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        className={`inline-flex items-center gap-1.5 rounded-lg border transition-all cursor-pointer select-none ${
          currentConfig.bgColor
        } ${currentConfig.borderColor} ${currentConfig.textColor} ${
          isOpen ? 'shadow-xs ring-1 ring-offset-0' : 'hover:opacity-90'
        } ${
          compact
            ? 'px-2 py-1 text-[11px] font-mono'
            : 'px-2.5 py-1.5 text-xs font-mono'
        }`}
        title={`当前思考模式: ${currentConfig.name} - ${currentConfig.hint}`}
      >
        <BrainCircuit
          className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} shrink-0`}
          style={{ color: currentConfig.color }}
        />

        <span className="font-medium whitespace-nowrap">
          {compact ? currentConfig.shortName : `思考: ${currentConfig.shortName}`}
        </span>

        {dropUp ? (
          <ChevronUp className="w-3 h-3 opacity-60 shrink-0" />
        ) : (
          <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
        )}
      </button>

      {/* Popover Slider Panel */}
      {isOpen && (
        <div
          className={`absolute z-50 w-64 sm:w-72 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl backdrop-blur-md p-3 animate-in fade-in zoom-in-95 duration-100 ${
            dropUp ? 'bottom-full mb-2 left-0' : 'top-full mt-2 left-0'
          }`}
        >
          {/* Scoped CSS for solid, non-transparent thumb with distinct level color */}
          <style>{`
            .thk-slider-${sliderId} {
              -webkit-appearance: none;
              appearance: none;
              width: 100%;
              height: 24px;
              background: transparent;
              outline: none;
              cursor: pointer;
              margin: 0;
              padding: 0;
            }
            .thk-slider-${sliderId}::-webkit-slider-runnable-track {
              height: 8px;
              background: transparent;
              border: none;
            }
            .thk-slider-${sliderId}::-moz-range-track {
              height: 8px;
              background: transparent;
              border: none;
            }
            .thk-slider-${sliderId}::-webkit-slider-thumb {
              -webkit-appearance: none;
              appearance: none;
              width: 20px;
              height: 20px;
              border-radius: 50%;
              background-color: ${currentConfig.color};
              border: 3px solid #ffffff;
              box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35), 0 0 10px ${currentConfig.color}80;
              cursor: pointer;
              margin-top: -6px;
              transition: transform 0.15s ease, background-color 0.2s ease, box-shadow 0.2s ease;
            }
            .thk-slider-${sliderId}::-webkit-slider-thumb:hover {
              transform: scale(1.18);
              box-shadow: 0 3px 8px rgba(0, 0, 0, 0.45), 0 0 14px ${currentConfig.color};
            }
            .thk-slider-${sliderId}::-webkit-slider-thumb:active {
              transform: scale(1.25);
            }
            .thk-slider-${sliderId}::-moz-range-thumb {
              width: 20px;
              height: 20px;
              border-radius: 50%;
              background-color: ${currentConfig.color};
              border: 3px solid #ffffff;
              box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35), 0 0 10px ${currentConfig.color}80;
              cursor: pointer;
              transition: transform 0.15s ease, background-color 0.2s ease;
            }
            .thk-slider-${sliderId}::-moz-range-thumb:hover {
              transform: scale(1.18);
            }
          `}</style>

          {/* Header */}
          <div className="flex items-center justify-between pb-2.5 border-b border-[var(--color-border)]/60 text-xs font-mono">
            <span className="flex items-center gap-1.5 font-medium text-[var(--color-neutral-8)]">
              <BrainCircuit className="w-3.5 h-3.5" style={{ color: currentConfig.color }} />
              <span>思维推理强度</span>
            </span>

            {/* Current Level Pill */}
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium border ${currentConfig.bgColor} ${currentConfig.borderColor} ${currentConfig.textColor}`}
            >
              {currentConfig.name} · {currentConfig.tag}
            </span>
          </div>

          {/* Stepped Slider Area */}
          <div className="pt-3 pb-1 px-1">
            <div className="relative flex items-center">
              {/* Colored Track Bar */}
              <div className="absolute inset-x-0 h-2 rounded-full bg-[var(--color-surface-subtle)] border border-[var(--color-border)] overflow-hidden">
                <div
                  className={`h-full transition-all duration-200 bg-gradient-to-r ${currentConfig.trackGradient}`}
                  style={{ width: `${(currentIndex / 3) * 100}%` }}
                />
              </div>

              {/* Step indicator notch dots on the track */}
              <div className="absolute inset-x-2.5 flex justify-between pointer-events-none">
                {[0, 1, 2, 3].map(i => (
                  <span
                    key={i}
                    className={`w-1.5 h-1.5 rounded-full transition-colors duration-150 ${
                      i <= currentIndex ? 'bg-white/90 shadow-2xs' : 'bg-[var(--color-neutral-4)]/70'
                    }`}
                  />
                ))}
              </div>

              {/* Native Range Slider with prominent colored thumb */}
              <input
                type="range"
                min="0"
                max="3"
                step="1"
                value={currentIndex}
                onChange={handleSliderChange}
                className={`thk-slider-${sliderId} relative z-10`}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
