import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, 
  Search, 
  RefreshCw, 
  Check, 
  CheckSquare, 
  Square, 
  Plus, 
  AlertCircle, 
  Layers, 
  Sparkles 
} from 'lucide-react';
import { api } from '../api/client';

export default function ModelSelectModal({
  isOpen,
  onClose,
  platform,
  onSaveModels
}) {
  const [loading, setLoading] = useState(false);
  const [fetchedModels, setFetchedModels] = useState([]);
  const [selectedModels, setSelectedModels] = useState(new Set());
  const [search, setSearch] = useState('');
  const [customInput, setCustomInput] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    if (isOpen && platform) {
      setSearch('');
      setCustomInput('');
      setErrorMsg(null);
      setSelectedModels(new Set(platform.enabled_models || []));
      fetchModels();
    }
  }, [isOpen, platform?.id]);

  const fetchModels = async () => {
    if (!platform) return;
    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await api.fetchPlatformModels({
        base_url: platform.base_url,
        api_key: platform.api_key,
        platform_id: platform.id
      });
      if (res && res.success && res.models) {
        setFetchedModels(res.models);
      } else {
        setFetchedModels([]);
        setErrorMsg(res?.error || '未能从该服务商自动探测到可用模型列表');
      }
    } catch (err) {
      setFetchedModels([]);
      setErrorMsg(err.message || '网络请求失败，无法连接到模型列表接口');
    } finally {
      setLoading(false);
    }
  };

  // Combine fetched models with any previously enabled ones so they don't disappear
  const allAvailableModels = useMemo(() => {
    const set = new Set(fetchedModels);
    (platform?.enabled_models || []).forEach(m => set.add(m));
    Array.from(selectedModels).forEach(m => set.add(m));
    return Array.from(set);
  }, [fetchedModels, platform?.enabled_models, selectedModels]);

  const filteredModels = useMemo(() => {
    if (!search.trim()) return allAvailableModels;
    const q = search.toLowerCase().trim();
    return allAvailableModels.filter(m => m.toLowerCase().includes(q));
  }, [allAvailableModels, search]);

  if (!isOpen || !platform) return null;

  const toggleModel = (modelName) => {
    setSelectedModels(prev => {
      const next = new Set(prev);
      if (next.has(modelName)) {
        next.delete(modelName);
      } else {
        next.add(modelName);
      }
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    setSelectedModels(prev => {
      const next = new Set(prev);
      filteredModels.forEach(m => next.add(m));
      return next;
    });
  };

  const handleDeselectAllFiltered = () => {
    setSelectedModels(prev => {
      const next = new Set(prev);
      filteredModels.forEach(m => next.delete(m));
      return next;
    });
  };

  const handleAddCustomModel = (e) => {
    e?.preventDefault();
    const val = customInput.trim();
    if (!val) return;
    setFetchedModels(prev => (prev.includes(val) ? prev : [val, ...prev]));
    setSelectedModels(prev => new Set(prev).add(val));
    setCustomInput('');
  };

  const handleConfirm = () => {
    const list = Array.from(selectedModels);
    onSaveModels(list);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="w-full max-w-xl bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-surface-subtle)]/40 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[var(--color-accent)]/10 text-[var(--color-accent)] flex items-center justify-center shrink-0">
              <Layers className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-serif font-medium text-[var(--color-neutral-10)] truncate">
                选择可用模型 · {platform.name || 'AI 平台'}
              </h3>
              <p className="text-[11px] font-mono text-[var(--color-neutral-6)] truncate mt-0.5">
                {platform.base_url}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--color-neutral-5)] hover:text-[var(--color-neutral-9)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search & Actions Bar */}
        <div className="p-4 border-b border-[var(--color-border)]/60 bg-[var(--color-surface)] space-y-3 shrink-0">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-neutral-5)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="快速过滤搜索模型（例如: deepseek, gpt-4, claude, qwen...）"
                className="w-full pl-9 pr-3 py-1.5 text-xs font-mono rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)]/60 text-[var(--color-neutral-10)] focus:outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-neutral-4)]"
              />
            </div>
            <button
              onClick={fetchModels}
              disabled={loading}
              className="px-2.5 py-1.5 rounded-lg border border-[var(--color-border)] hover:border-[var(--color-accent)] text-xs font-mono text-[var(--color-neutral-7)] hover:text-[var(--color-accent)] transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="重新获取模型列表"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[var(--color-accent)]' : ''}`} />
              <span className="hidden sm:inline">刷新</span>
            </button>
          </div>

          <div className="flex items-center justify-between text-xs font-mono text-[var(--color-neutral-6)]">
            <div className="flex items-center gap-3">
              <span>共发现 {allAvailableModels.length} 个模型</span>
              {filteredModels.length !== allAvailableModels.length && (
                <span>匹配 {filteredModels.length} 个</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAllFiltered}
                className="text-[11px] hover:text-[var(--color-accent)] transition-colors cursor-pointer"
              >
                全选
              </button>
              <span className="opacity-30">|</span>
              <button
                type="button"
                onClick={handleDeselectAllFiltered}
                className="text-[11px] hover:text-[var(--color-accent)] transition-colors cursor-pointer"
              >
                清空
              </button>
            </div>
          </div>
        </div>

        {/* Model List Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1.5 min-h-[180px]">
          {loading ? (
            <div className="py-16 text-center space-y-3 text-[var(--color-neutral-5)]">
              <RefreshCw className="w-6 h-6 animate-spin text-[var(--color-accent)] mx-auto" />
              <p className="text-xs font-mono">正在连接服务商 /models 接口探测可用模型...</p>
            </div>
          ) : errorMsg && allAvailableModels.length === 0 ? (
            <div className="py-10 px-4 text-center space-y-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/10 text-amber-600 flex items-center justify-center mx-auto">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h4 className="text-xs font-medium text-[var(--color-neutral-9)]">自动拉取模型未返回结果</h4>
                <p className="text-[11px] font-mono text-[var(--color-neutral-6)] max-w-md mx-auto break-all">
                  {errorMsg}
                </p>
              </div>
              <p className="text-[11px] text-[var(--color-neutral-5)]">
                提示：部分第三方反代或中转服务未开放公开 `/models` 接口。您可在下方直接手动输入模型标识进行添加。
              </p>
            </div>
          ) : filteredModels.length === 0 ? (
            <div className="py-12 text-center text-xs font-mono text-[var(--color-neutral-5)]">
              未找到与 "{search}" 匹配的模型
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {filteredModels.map((m) => {
                const isSelected = selectedModels.has(m);
                return (
                  <div
                    key={m}
                    onClick={() => toggleModel(m)}
                    className={`px-3 py-2 rounded-lg border text-xs font-mono flex items-center gap-2.5 transition-all cursor-pointer select-none ${
                      isSelected
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5 text-[var(--color-accent)] font-medium shadow-2xs'
                        : 'border-[var(--color-border)]/80 hover:border-[var(--color-neutral-4)] bg-[var(--color-surface)] text-[var(--color-neutral-8)]'
                    }`}
                  >
                    {isSelected ? (
                      <CheckSquare className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-[var(--color-neutral-4)] shrink-0" />
                    )}
                    <span className="truncate" title={m}>{m}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Custom Model Input Addon */}
        <div className="px-4 py-3 border-t border-[var(--color-border)]/60 bg-[var(--color-surface-subtle)]/30 shrink-0">
          <form onSubmit={handleAddCustomModel} className="flex items-center gap-2">
            <input
              type="text"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder="手动补充自定义模型名 (如: deepseek-reasoner 或 qwen-plus)..."
              className="flex-1 px-3 py-1.5 text-xs font-mono rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-neutral-9)] focus:outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-neutral-4)]"
            />
            <button
              type="submit"
              disabled={!customInput.trim()}
              className="px-3 py-1.5 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] text-xs font-mono text-[var(--color-neutral-8)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] disabled:opacity-40 transition-all flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>添加</span>
            </button>
          </form>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-[var(--color-border)] flex items-center justify-between bg-[var(--color-surface)] shrink-0">
          <div className="text-xs font-mono text-[var(--color-neutral-7)] flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[var(--color-accent)]" />
            <span>已选定 <strong>{selectedModels.size}</strong> 个可用模型</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-[var(--color-border)] text-xs font-mono text-[var(--color-neutral-7)] hover:bg-[var(--color-surface-subtle)] transition-all cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="yohaku-btn-primary px-4 py-1.5 text-xs font-mono flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>确认启用模型</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
