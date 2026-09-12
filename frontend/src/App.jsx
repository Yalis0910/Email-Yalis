import React, { useState, useEffect, useRef, useCallback } from 'react';
import Navbar from './components/Navbar';
import Dashboard from './pages/Dashboard';
import DigitalAssets from './pages/DigitalAssets';
import Attachments from './pages/Attachments';
import ContactGraph from './pages/ContactGraph';
import MailSearch from './pages/MailSearch';
import Settings from './pages/Settings';
import AICopilotWorkbench from './pages/AICopilotWorkbench';
import RBACManagement from './pages/RBACManagement';
import Login from './pages/Login';
import GlobalAICopilotDrawer from './components/GlobalAICopilotDrawer';
import EmailDetailModal from './components/EmailDetailModal';
import ErrorBoundary from './components/ErrorBoundary';
import { AIConversationProvider, useAIConversation } from './context/AIConversationContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { api } from './api/client';

function AppContent() {
  const { isAuthenticated, isLoading, hasPagePermission, user } = useAuth();
  const { isDrawerOpen: isCopilotDrawerOpen, setIsDrawerOpen: setIsCopilotDrawerOpen } = useAIConversation();

  const [activeTab, setActiveTab] = useState('dashboard');
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [syncingAccountIds, setSyncingAccountIds] = useState([]);
  const [manualSyncAccountIds, setManualSyncAccountIds] = useState([]);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const isSyncing = (manualSyncAccountIds.length > 0 || isSyncingAll) && syncingAccountIds.some(id => manualSyncAccountIds.includes(id));
  const isAutoSyncing = syncingAccountIds.some(id => !manualSyncAccountIds.includes(id));
  const [toastNotice, setToastNotice] = useState(null);
  const [targetEmailId, setTargetEmailId] = useState(null);
  const [modalEmailId, setModalEmailId] = useState(null);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);

  const showToast = (msg) => {
    setToastNotice(msg);
    setTimeout(() => {
      setToastNotice(null);
    }, 4500);
  };
  
  // Track active SSE EventSources to prevent duplicates and handle cleanup
  const activeListenersRef = useRef(new Map());

  // Theme state: default to 'light' (Yohaku warm paper aesthetic)
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('yohaku_theme') || 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Clean up all EventSources on unmount
  useEffect(() => {
    return () => {
      activeListenersRef.current.forEach(es => es.close());
      activeListenersRef.current.clear();
    };
  }, []);

  // Load accounts when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      loadAccounts(true);
    } else {
      setAccounts([]);
      setSelectedAccount(null);
    }
  }, [isAuthenticated, user?.id]);

  // Route/Tab guard: ensure current active tab is permitted
  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      if (!hasPagePermission(activeTab)) {
        setActiveTab('dashboard');
      }
    }
  }, [isAuthenticated, isLoading, activeTab, hasPagePermission]);

  // Central listener to attach to an account's SSE stream
  const listenAccountSync = (accId, accEmail, batchInfo = null) => {
    if (activeListenersRef.current.has(accId)) {
      return activeListenersRef.current.get(accId);
    }

    const sseUrl = api.getSyncStreamUrl(accId);
    const eventSource = new EventSource(sseUrl);
    activeListenersRef.current.set(accId, eventSource);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const isManual = manualSyncAccountIds.includes(accId) || isSyncingAll;

        setAccounts(prevList => {
          let hasChanges = false;
          const next = prevList.map(a => {
            if (a.id === accId || a.id === data.account_id) {
              if (
                a.sync_status !== data.status ||
                a.sync_progress_current !== data.current ||
                a.sync_progress_total !== data.total ||
                a.sync_message !== data.message
              ) {
                hasChanges = true;
                return {
                  ...a,
                  sync_status: data.status,
                  sync_progress_current: data.current,
                  sync_progress_total: data.total,
                  sync_message: data.message
                };
              }
            }
            return a;
          });
          return hasChanges ? next : prevList;
        });

        if (data.status === 'completed' || data.status === 'error') {
          eventSource.close();
          activeListenersRef.current.delete(accId);
          setSyncingAccountIds(prev => prev.filter(id => id !== accId));
          setManualSyncAccountIds(prev => prev.filter(id => id !== accId));
          if (data.status === 'completed') {
            showToast(isManual ? `账号 [${accEmail}] 同步已完成` : `已自动完成后台增量同步 (${accEmail})`);
          }
          loadAccounts(false);
        }
      } catch (e) {
        console.error('SSE data parse error:', e);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      activeListenersRef.current.delete(accId);
      setSyncingAccountIds(prev => prev.filter(id => id !== accId));
      loadAccounts(false);
    };

    return eventSource;
  };

  const loadAccounts = async (shouldAutoListen = false) => {
    try {
      const res = await api.getAccounts();
      const accountList = res || [];
      setAccounts(accountList);

      // If selected account is not in the list of authorized accounts, reset it
      if (selectedAccount && !accountList.some(a => a.id === selectedAccount)) {
        setSelectedAccount(null);
      }

      // Auto-detect and restore sync state
      const activeSyncing = accountList.filter(a => a.sync_status === 'syncing');
      if (activeSyncing.length > 0) {
        const activeIds = activeSyncing.map(a => a.id);
        setSyncingAccountIds(prev => [...new Set([...prev, ...activeIds])]);

        if (shouldAutoListen) {
          activeSyncing.forEach(acc => {
            listenAccountSync(acc.id, acc.email);
          });
        }
      } else {
        if (syncingAccountIds.length > 0 && !isSyncingAll) {
          setSyncingAccountIds([]);
        }
      }
    } catch (err) {
      console.error('Failed to load accounts:', err);
    }
  };

  const hasSyncing = syncingAccountIds.length > 0 || accounts.some(a => a.sync_status === 'syncing');

  // Lightweight polling fallback: runs every 3s only while accounts are actively syncing
  useEffect(() => {
    if (!isAuthenticated || !hasSyncing) return;

    const interval = setInterval(async () => {
      try {
        const res = await api.getAccounts();
        if (res && res.length > 0) {
          setAccounts(prevList => {
            const isDiff = res.length !== prevList.length || res.some((acc, idx) => {
              const prev = prevList[idx];
              return !prev ||
                prev.id !== acc.id ||
                prev.sync_status !== acc.sync_status ||
                prev.sync_progress_current !== acc.sync_progress_current ||
                prev.sync_progress_total !== acc.sync_progress_total;
            });
            return isDiff ? res : prevList;
          });

          const stillSyncing = res.filter(a => a.sync_status === 'syncing');
          if (stillSyncing.length === 0) {
            setSyncingAccountIds([]);
            setIsSyncingAll(false);
          }
        }
      } catch (_) {}
    }, 3000);

    return () => clearInterval(interval);
  }, [hasSyncing, isAuthenticated]);

  // Trigger sync for a single specific account
  const handleTriggerSync = async (specificAccId = null, force = true) => {
    const accId = specificAccId || selectedAccount || (accounts[0] && accounts[0].id);
    if (!accId) {
      alert('请先授权绑定或选择一个可用邮箱账号！');
      if (hasPagePermission('settings')) {
        setActiveTab('settings');
      }
      return;
    }

    const targetAcc = accounts.find(a => a.id === accId);
    const accEmail = targetAcc?.email || accId;

    try {
      setSyncingAccountIds(prev => [...new Set([...prev, accId])]);
      setManualSyncAccountIds(prev => [...new Set([...prev, accId])]);

      await api.triggerSync(accId, false, null, force);
      listenAccountSync(accId, accEmail);
    } catch (err) {
      setSyncingAccountIds(prev => prev.filter(id => id !== accId));
      setManualSyncAccountIds(prev => prev.filter(id => id !== accId));
      alert(`账号 [${accEmail}] 触发同步失败: ${err.message}`);
    }
  };

  // Trigger sync for ALL authorized accounts sequentially
  const handleTriggerSyncAll = async () => {
    if (!accounts || accounts.length === 0) {
      alert('当前没有可操作的授权邮箱！');
      if (hasPagePermission('settings')) {
        setActiveTab('settings');
      }
      return;
    }

    setIsSyncingAll(true);
    const allIds = accounts.map(a => a.id);
    setSyncingAccountIds(allIds);
    setManualSyncAccountIds(allIds);

    for (let i = 0; i < accounts.length; i++) {
      const acc = accounts[i];
      const batchLabel = `(${i + 1}/${accounts.length})`;

      try {
        await api.triggerSync(acc.id, false, null, true);

        await new Promise((resolve) => {
          const sseUrl = api.getSyncStreamUrl(acc.id);
          const eventSource = new EventSource(sseUrl);
          const timeoutId = setTimeout(() => {
            eventSource.close();
            resolve();
          }, 300000);

          eventSource.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              setAccounts(prevList =>
                prevList.map(a => (a.id === acc.id ? { ...a, sync_status: data.status, sync_progress_current: data.current, sync_progress_total: data.total, sync_message: data.message } : a))
              );
              if (data.status === 'completed' || data.status === 'error') {
                clearTimeout(timeoutId);
                eventSource.close();
                resolve();
              }
            } catch (e) {
              console.error(e);
            }
          };

          eventSource.onerror = () => {
            clearTimeout(timeoutId);
            eventSource.close();
            resolve();
          };
        });
      } catch (err) {
        console.error(`Sync account ${acc.email} error:`, err);
      } finally {
        setSyncingAccountIds(prev => prev.filter(id => id !== acc.id));
        await loadAccounts(false);
      }
    }

    setIsSyncingAll(false);
    showToast(`已完成全部 ${accounts.length} 个账号的最新邮件同步与资产分析！`);
    await loadAccounts(false);
  };

  const handleStopSync = async (specificAccId = null) => {
    try {
      if (specificAccId) {
        await api.stopSync(specificAccId);
        setSyncingAccountIds(prev => prev.filter(id => id !== specificAccId));
        setManualSyncAccountIds(prev => prev.filter(id => id !== specificAccId));
      } else {
        await api.stopSyncAll();
        setSyncingAccountIds([]);
        setManualSyncAccountIds([]);
        setIsSyncingAll(false);
      }
      showToast('已停止邮件同步任务');
      await loadAccounts(false);
    } catch (err) {
      console.error('Stop sync error:', err);
    }
  };


  const handleSeedDemo = async () => {
    try {
      const res = await api.seedDemoData();
      alert('演示数据注入成功！已生成数字资产与账单附件。');
      await loadAccounts();
      setActiveTab('dashboard');
    } catch (err) {
      alert('注入失败: ' + err.message);
    }
  };

  const handleSelectEmail = useCallback((emailId) => {
    setModalEmailId(emailId);
    setIsEmailModalOpen(true);
  }, []);

  const handleCloseEmailModal = useCallback(() => {
    setIsEmailModalOpen(false);
    setModalEmailId(null);
  }, []);

  // 1. Loading screen
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--color-paper)] flex items-center justify-center transition-colors">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-8 h-8 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
          <span className="text-xs font-mono text-[var(--color-neutral-6)] tracking-wider">
            验证身份与加载工作区...
          </span>
        </div>
      </div>
    );
  }

  // 2. Unauthenticated -> Show Login Page
  if (!isAuthenticated) {
    return <Login />;
  }

  // 3. Authenticated -> Main Workstation
  return (
    <div className="min-h-screen bg-[var(--color-paper)] text-[var(--color-neutral-9)] flex flex-col transition-colors duration-200 selection:bg-[var(--color-accent-soft)] selection:text-[var(--color-accent)] w-full max-w-[100vw] overflow-x-hidden">
      {/* Top Navigation */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        accounts={accounts}
        selectedAccount={selectedAccount}
        setSelectedAccount={setSelectedAccount}
        onTriggerSync={() => {
          if (selectedAccount) {
            handleTriggerSync(selectedAccount);
          } else {
            handleTriggerSyncAll();
          }
        }}
        onTriggerSyncAll={handleTriggerSyncAll}
        isSyncing={isSyncing}
        isSyncingAll={isSyncingAll}
        isAutoSyncing={isAutoSyncing}
        onSeedDemo={handleSeedDemo}
        theme={theme}
        setTheme={setTheme}
      />

      {/* Main Content View with Yohaku Whitespace (余白) */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-3 sm:px-6 lg:px-8 pt-6 min-w-0 overflow-x-hidden">
        {activeTab === 'dashboard' && hasPagePermission('dashboard') && (
          <Dashboard
            selectedAccount={selectedAccount}
            onNavigate={(tab) => setActiveTab(tab)}
          />
        )}

        {activeTab === 'assets' && hasPagePermission('assets') && (
          <DigitalAssets
            selectedAccount={selectedAccount}
            onSelectEmail={handleSelectEmail}
          />
        )}

        {activeTab === 'attachments' && hasPagePermission('attachments') && (
          <Attachments
            selectedAccount={selectedAccount}
            onSelectEmail={handleSelectEmail}
          />
        )}

        {activeTab === 'contacts' && hasPagePermission('contacts') && (
          <ContactGraph
            selectedAccount={selectedAccount}
            onSelectEmail={handleSelectEmail}
          />
        )}

        {activeTab === 'emails' && hasPagePermission('emails') && (
          <MailSearch
            selectedAccount={selectedAccount}
            initialEmailId={targetEmailId}
          />
        )}

        {activeTab === 'ai_copilot' && hasPagePermission('ai_copilot') && (
          <AICopilotWorkbench
            selectedAccount={selectedAccount}
            onSelectEmail={handleSelectEmail}
          />
        )}

        {activeTab === 'settings' && hasPagePermission('settings') && (
          <Settings
            accounts={accounts}
            loadAccounts={loadAccounts}
            onTriggerSync={(accId) => handleTriggerSync(accId, true)}
            onTriggerSyncAll={handleTriggerSyncAll}
            syncingAccountIds={syncingAccountIds}
            isSyncing={isSyncing}
            isSyncingAll={isSyncingAll}
            onSeedDemo={handleSeedDemo}
            onStopSync={handleStopSync}
          />
        )}

        {activeTab === 'rbac' && hasPagePermission('rbac') && (
          <RBACManagement />
        )}
      </main>

      {/* Global Bottom-Right Floating AI Copilot Drawer */}
      {hasPagePermission('ai_copilot') && (
        <GlobalAICopilotDrawer
          isOpen={isCopilotDrawerOpen}
          onToggle={() => setIsCopilotDrawerOpen(!isCopilotDrawerOpen)}
          selectedAccount={selectedAccount}
          onSelectEmail={handleSelectEmail}
          onNavigateToWorkbench={() => setActiveTab('ai_copilot')}
        />
      )}


      {/* Universal Direct Email Detail Reading Modal */}
      <ErrorBoundary onReset={handleCloseEmailModal}>
        <EmailDetailModal
          emailId={modalEmailId}
          isOpen={isEmailModalOpen}
          onClose={handleCloseEmailModal}
        />
      </ErrorBoundary>

      {/* Floating Silent Background Notification Toast */}
      {toastNotice && (
        <div className="fixed bottom-6 left-6 z-50 bg-[var(--color-surface)] border border-[var(--color-border)] shadow-xl px-4 py-3 rounded-lg text-xs font-mono text-[var(--color-neutral-9)] flex items-center gap-2.5 animate-in fade-in slide-in-from-bottom-3 duration-300">
          <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 animate-ping" />
          <span>{toastNotice}</span>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AIConversationProvider>
        <AppContent />
      </AIConversationProvider>
    </AuthProvider>
  );
}
