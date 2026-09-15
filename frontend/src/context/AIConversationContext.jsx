import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { api, streamSSE } from '../api/client';

const AIConversationContext = createContext(null);

export function AIConversationProvider({ children }) {
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  
  // Drawer visibility state accessible app-wide
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Active contact context bound to current conversation or pending send
  const [activeContactContext, setActiveContactContext] = useState(null);

  // Prefilled prompt for input box
  const [draftPrompt, setDraftPrompt] = useState('');

  // Multi-platform model selection state
  const [enabledModelGroups, setEnabledModelGroups] = useState([]);
  const [currentModel, setCurrentModel] = useState('');
  
  // Thinking / reasoning effort level: 'off' | 'low' | 'medium' | 'high'
  const [thinkingLevel, setThinkingLevelState] = useState(() => {
    try {
      return localStorage.getItem('email_yalis_thinking_level') || 'off';
    } catch (_) {
      return 'off';
    }
  });

  const setThinkingLevel = (lvl) => {
    setThinkingLevelState(lvl);
    try {
      localStorage.setItem('email_yalis_thinking_level', lvl);
    } catch (_) {}
  };
  
  const abortControllerRef = useRef(null);

  // Context Token Statistics State (replicates image 1)
  const [contextStats, setContextStats] = useState({
    system_tokens: 2200,
    tools_tokens: 1800,
    messages_tokens: 0,
    summary_tokens: 0,
    total_tokens: 4000,
    limit_tokens: 524288,
    percent: 0.8,
    is_compressed: false,
    context_summary: ''
  });
  const [isCompressing, setIsCompressing] = useState(false);

  // Fast client-side token estimator for live typing / instant feedback
  const estimateClientTokens = (text) => {
    if (!text) return 0;
    const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) || []).length;
    const nonCjk = text.length - cjk;
    return Math.max(1, Math.round(cjk / 1.2 + nonCjk / 3.8));
  };

  // Load conversations and models on mount
  useEffect(() => {
    loadConversations(true);
    loadEnabledModels();
  }, []);

  const loadEnabledModels = async () => {
    try {
      const res = await api.getEnabledAIModels();
      if (res) {
        const groups = res.grouped || [];
        setEnabledModelGroups(groups);
        
        // Pick default model or first available model
        const fallbackModel = res.default_model || (res.models && res.models[0]) || '';
        setCurrentModel(prev => prev || fallbackModel);
        return res;
      }
    } catch (err) {
      console.error('Failed to load enabled AI models:', err);
    }
    return null;
  };

  const loadConversations = async (autoSelectFirst = false) => {
    try {
      const list = await api.getAIConversations();
      const safeList = Array.isArray(list) ? list : [];
      setConversations(safeList);

      if (autoSelectFirst && safeList.length > 0) {
        // Automatically select the most recent conversation
        await selectConversation(safeList[0].id);
      }
      return safeList;
    } catch (err) {
      console.error('Failed to load AI conversations:', err);
      return [];
    }
  };

  const selectConversation = async (convId) => {
    if (!convId) {
      setActiveConvId(null);
      setMessages([]);
      setActiveContactContext(null);
      return;
    }

    // If currently streaming, abort previous
    if (isStreaming && abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
    }

    setActiveConvId(convId);
    setIsLoadingHistory(true);
    try {
      const data = await api.getAIConversation(convId);
      if (data && Array.isArray(data.messages)) {
        setMessages(data.messages);
      } else {
        setMessages([]);
      }
      if (data && data.contact_id) {
        setActiveContactContext({
          id: data.contact_id,
          name: data.contact_name,
          email: data.contact_email,
          total_count: data.contact_exchanges
        });
      } else {
        setActiveContactContext(null);
      }
    } catch (err) {
      console.error('Failed to load conversation history:', err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const newConversation = () => {
    if (isStreaming && abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
    }
    setActiveConvId(null);
    setMessages([]);
    setActiveContactContext(null);
    setDraftPrompt('');
  };

  const openWithContactContext = async (contact, promptText = '') => {
    if (!contact) return;
    const contactName = contact.name || contact.email?.split('@')[0] || '联系人';
    const totalExchanges = (contact.inbound_count || 0) + (contact.outbound_count || 0);

    const contactCtxObj = {
      id: contact.id,
      name: contactName,
      email: contact.email,
      domain: contact.domain,
      total_count: totalExchanges
    };

    setActiveContactContext(contactCtxObj);
    setIsDrawerOpen(true);

    if (promptText) {
      setDraftPrompt(promptText);
    }

    // Always start a fresh pending conversation for this contact dialogue
    // Do not create conversation in database upfront (lazy persistence on first message sent)
    setActiveConvId(null);
    setMessages([]);
  };

  const deleteConversation = async (convId) => {
    try {
      await api.deleteAIConversation(convId);
      const remaining = conversations.filter(c => c.id !== convId);
      setConversations(remaining);

      if (activeConvId === convId) {
        if (remaining.length > 0) {
          await selectConversation(remaining[0].id);
        } else {
          setActiveConvId(null);
          setMessages([]);
        }
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
      alert('删除会话失败: ' + err.message);
    }
  };

  const stopStreaming = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsStreaming(false);
    setMessages(prev => {
      const updated = [...prev];
      const lastIdx = updated.length - 1;
      if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
        const start = updated[lastIdx].started_at;
        const totalDuration = start ? Math.max(1, Math.round((Date.now() - start) / 1000)) : 0;
        updated[lastIdx] = {
          ...updated[lastIdx],
          stream_status: 'stopped',
          status_message: '已由用户停止生成',
          is_interrupted: true,
          is_thinking: false,
          total_duration: totalDuration
        };
      }
      return updated;
    });
  };

  const clearCurrentMessages = () => {
    if (window.confirm('确认清空当前对话中的消息记录？')) {
      if (activeConvId) {
        deleteConversation(activeConvId);
      } else {
        setMessages([]);
      }
    }
  };

  const sendMessage = async (text, accountId = null, modelOverride = null, thinkingOverride = null, historyOverride = null) => {
    const query = (text || '').trim();
    if (!query || isStreaming) return;

    const currentHistory = historyOverride || [...messages];
    const newMessages = [...currentHistory, { role: 'user', content: query, created_at: new Date().toISOString() }];
    setMessages(newMessages);
    setIsStreaming(true);

    const assistantIndex = newMessages.length;
    const startTime = Date.now();
    setMessages([...newMessages, { 
      role: 'assistant', 
      content: '', 
      thinking_content: '',
      is_thinking: false,
      thinking_duration: 0,
      references: [], 
      tool_calls: [], 
      created_at: new Date().toISOString(),
      started_at: startTime,
      last_active_at: startTime,
      stream_status: 'analyzing',
      status_message: '正在分析问题意图并检索上下文...',
      is_interrupted: false,
      error_message: null
    }]);

    abortControllerRef.current = new AbortController();
    let accumulatedText = '';
    let accumulatedThinking = '';
    let thinkingStartTime = null;
    let thinkingDuration = 0;
    let currentRefs = [];
    let currentTools = [];
    let establishedConvId = activeConvId;

    const chosenModel = modelOverride || currentModel || undefined;
    const chosenThinking = thinkingOverride || thinkingLevel || 'off';

    await streamSSE(
      '/api/ai/copilot/chat',
      {
        query,
        history: currentHistory.slice(-24).map(m => ({ role: m.role, content: m.content })),
        account_id: accountId || undefined,
        conversation_id: activeConvId || undefined,
        contact_id: activeContactContext?.id || undefined,
        model: chosenModel,
        thinking_level: chosenThinking
      },
      {
        signal: abortControllerRef.current.signal,
        onConversation: (convId) => {
          establishedConvId = convId;
          setActiveConvId(convId);
        },
        onStatus: (statusData) => {
          setMessages(prev => {
            const updated = [...prev];
            if (updated[assistantIndex]) {
              updated[assistantIndex] = {
                ...updated[assistantIndex],
                stream_status: statusData.stage || updated[assistantIndex].stream_status,
                status_message: statusData.message || updated[assistantIndex].status_message,
                last_active_at: Date.now()
              };
            }
            return updated;
          });
        },
        onThinking: (delta) => {
          if (!thinkingStartTime) {
            thinkingStartTime = Date.now();
          }
          accumulatedThinking += delta;
          thinkingDuration = Math.max(1, Math.round((Date.now() - thinkingStartTime) / 1000));
          setMessages(prev => {
            const updated = [...prev];
            if (updated[assistantIndex]) {
              updated[assistantIndex] = {
                ...updated[assistantIndex],
                thinking_content: accumulatedThinking,
                is_thinking: true,
                stream_status: 'thinking',
                status_message: `正在深度推理思考 (${thinkingDuration}s)...`,
                thinking_duration: thinkingDuration,
                last_active_at: Date.now()
              };
            }
            return updated;
          });
        },
        onToolStart: (toolData) => {
          currentTools = [...currentTools, {
            id: toolData.id,
            tool_name: toolData.tool_name,
            args: toolData.args,
            status: 'running',
            summary: null
          }];
          setMessages(prev => {
            const updated = [...prev];
            if (updated[assistantIndex]) {
              updated[assistantIndex] = {
                ...updated[assistantIndex],
                stream_status: 'tool_executing',
                status_message: `正在调用工具检索数据 (${toolData.tool_name})...`,
                tool_calls: [...currentTools],
                last_active_at: Date.now()
              };
            }
            return updated;
          });
        },
        onToolResult: (toolData) => {
          currentTools = currentTools.map(t =>
            t.id === toolData.id ? { ...t, status: 'completed', summary: toolData.summary, result: toolData.summary } : t
          );
          if (!currentTools.some(t => t.id === toolData.id)) {
            currentTools.push({
              id: toolData.id,
              tool_name: toolData.tool_name,
              status: 'completed',
              summary: toolData.summary,
              result: toolData.summary
            });
          }
          setMessages(prev => {
            const updated = [...prev];
            if (updated[assistantIndex]) {
              updated[assistantIndex] = {
                ...updated[assistantIndex],
                tool_calls: [...currentTools],
                stream_status: 'synthesizing',
                status_message: '数据检索完成，大模型正在深度思考并组织回答...',
                last_active_at: Date.now()
              };
            }
            return updated;
          });
        },
        onReferences: (refs) => {
          currentRefs = refs || [];
          setMessages(prev => {
            const updated = [...prev];
            if (updated[assistantIndex]) {
              updated[assistantIndex] = {
                ...updated[assistantIndex],
                references: currentRefs,
                tool_calls: [...currentTools],
                last_active_at: Date.now()
              };
            }
            return updated;
          });
        },
        onChunk: (delta) => {
          accumulatedText += delta;
          setMessages(prev => {
            const updated = [...prev];
            if (updated[assistantIndex]) {
              updated[assistantIndex] = {
                ...updated[assistantIndex],
                content: accumulatedText,
                stream_status: 'generating',
                status_message: 'AI 正在输出回答...',
                is_thinking: false,
                references: currentRefs,
                tool_calls: [...currentTools],
                last_active_at: Date.now()
              };
            }
            return updated;
          });
        },
        onCompressing: (msg) => {
          setIsCompressing(true);
        },
        onCompressed: (data) => {
          setIsCompressing(false);
          if (data && data.stats) {
            setContextStats(data.stats);
          }
        },
        onContextStats: (stats) => {
          if (stats) {
            setContextStats(stats);
          }
        },
        onError: (err) => {
          setIsCompressing(false);
          const totalDur = Math.max(1, Math.round((Date.now() - startTime) / 1000));
          setMessages(prev => {
            const updated = [...prev];
            if (updated[assistantIndex]) {
              updated[assistantIndex] = {
                ...updated[assistantIndex],
                is_thinking: false,
                stream_status: 'error',
                error_message: err,
                status_message: `生成中断: ${err}`,
                total_duration: totalDur
              };
            }
            return updated;
          });
        },
        onDone: async () => {
          setIsStreaming(false);
          setIsCompressing(false);
          const totalDur = Math.max(1, Math.round((Date.now() - startTime) / 1000));
          currentTools = currentTools.map(t => ({
            ...t,
            status: 'completed',
            summary: t.summary || '检索完成'
          }));
          setMessages(prev => {
            const updated = [...prev];
            if (updated[assistantIndex]) {
              const prevStatus = updated[assistantIndex].stream_status;
              updated[assistantIndex] = {
                ...updated[assistantIndex],
                is_thinking: false,
                stream_status: (prevStatus === 'error' || prevStatus === 'stopped') ? prevStatus : 'done',
                status_message: prevStatus === 'stopped' ? '已由用户停止生成' : (prevStatus === 'error' ? updated[assistantIndex].status_message : '回答生成完成'),
                tool_calls: [...currentTools],
                total_duration: totalDur
              };
            }
            return updated;
          });
          await loadConversations(false);
          if (establishedConvId && !activeConvId) {
            setActiveConvId(establishedConvId);
          }
        }
      }
    );
  };

  const regenerateResponse = async (targetIndex = null, accountId = null) => {
    if (isStreaming) return;

    let queryToResend = '';
    let sliceUntil = messages.length;

    if (targetIndex !== null && targetIndex >= 0 && targetIndex < messages.length) {
      if (messages[targetIndex].role === 'assistant' && targetIndex > 0) {
        queryToResend = messages[targetIndex - 1].content;
        sliceUntil = targetIndex - 1;
      } else if (messages[targetIndex].role === 'user') {
        queryToResend = messages[targetIndex].content;
        sliceUntil = targetIndex;
      }
    } else {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          queryToResend = messages[i].content;
          sliceUntil = i;
          break;
        }
      }
    }

    if (!queryToResend) return;

    const rolledBackHistory = messages.slice(0, sliceUntil);
    setMessages(rolledBackHistory);
    await sendMessage(queryToResend, accountId, null, null, rolledBackHistory);
  };

  const activeConversation = conversations.find(c => c.id === activeConvId) || null;

  // Recalculate live context statistics when not in active stream
  useEffect(() => {
    let limit = 524288;
    for (const g of enabledModelGroups) {
      if (g.models && g.models.includes(currentModel)) {
        limit = g.context_window || 524288;
        break;
      }
    }

    const sysTokens = 2200 + (activeContactContext ? 1200 : 0);
    const toolsTokens = 1800;
    const summary = activeConversation?.context_summary || '';
    const sumTokens = summary ? estimateClientTokens(summary) : 0;
    
    let msgTokens = 0;
    for (const m of messages) {
      msgTokens += estimateClientTokens(m.content || '') + 4;
      if (m.thinking_content) {
        msgTokens += Math.round(estimateClientTokens(m.thinking_content) * 0.2);
      }
    }

    const total = sysTokens + toolsTokens + msgTokens + sumTokens;
    const pct = Number(((total / limit) * 100).toFixed(1));

    setContextStats({
      system_tokens: sysTokens,
      tools_tokens: toolsTokens,
      messages_tokens: msgTokens,
      summary_tokens: sumTokens,
      total_tokens: total,
      limit_tokens: limit,
      percent: Math.min(100, pct),
      is_compressed: Boolean(summary),
      context_summary: summary,
      compressed_at: activeConversation?.compressed_at || null
    });
  }, [messages, activeConversation, currentModel, enabledModelGroups, activeContactContext]);

  // Compress active conversation
  const compressActiveConversation = async () => {
    if (!activeConvId) return;
    setIsCompressing(true);
    try {
      const res = await api.compressAIConversation(activeConvId);
      if (res && res.success) {
        if (res.stats) {
          setContextStats(res.stats);
        }
        await loadConversations(false);
      } else {
        alert(res?.error || '当前对话轮次较少，暂无需压缩');
      }
    } catch (err) {
      console.error('Failed to compress conversation:', err);
      alert('压缩执行失败: ' + err.message);
    } finally {
      setIsCompressing(false);
    }
  };

  return (
    <AIConversationContext.Provider
      value={{
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
        isDrawerOpen,
        setIsDrawerOpen,
        openDrawer: () => setIsDrawerOpen(true),
        closeDrawer: () => setIsDrawerOpen(false),
        activeContactContext,
        setActiveContactContext,
        clearContactContext: () => setActiveContactContext(null),
        draftPrompt,
        setDraftPrompt,
        openWithContactContext,
        loadEnabledModels,
        loadConversations,
        selectConversation,
        newConversation,
        deleteConversation,
        sendMessage,
        regenerateResponse,
        stopStreaming,
        clearCurrentMessages,
        contextStats,
        setContextStats,
        isCompressing,
        compressActiveConversation
      }}
    >
      {children}
    </AIConversationContext.Provider>
  );
}

export function useAIConversation() {
  const context = useContext(AIConversationContext);
  if (!context) {
    throw new Error('useAIConversation must be used within an AIConversationProvider');
  }
  return context;
}
