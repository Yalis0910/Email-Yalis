import React, { useState, useEffect } from 'react';
import { 
  Check, 
  AlertCircle, 
  Trash2, 
  RefreshCw, 
  Sparkles, 
  ExternalLink, 
  HelpCircle, 
  Mail, 
  Lock, 
  ShieldCheck,
  Zap,
  Info,
  Bot,
  Cpu,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  Clock,
  Server,
  Sliders,
  Plus,
  Star,
  Layers,
  Square,
  Loader2,
  KeyRound,
  X
} from 'lucide-react';
import { api } from '../api/client';
import ModelSelectModal from '../components/ModelSelectModal';

const IMAP_PRESETS = {
  qq: {
    id: 'qq',
    name: 'QQ 邮箱',
    host: 'imap.qq.com',
    port: 993,
    ssl: true,
    emailPlaceholder: 'QQ号码@qq.com',
    pwdLabel: '16 位专属授权码 (非 QQ 登录密码)',
    pwdPlaceholder: '输入在 QQ 邮箱生成的 16 位授权码',
    guide: '需在 QQ 邮箱网页版「设置 -> 账户」开启 POP3/IMAP 服务，并发送短信获取 16 位专属授权码。'
  },
  163: {
    id: '163',
    name: '163 网易',
    host: 'imap.163.com',
    port: 993,
    ssl: true,
    emailPlaceholder: 'username@163.com',
    pwdLabel: '客户端授权密码 (非网页登录密码)',
    pwdPlaceholder: '输入在 163 设置中生成的授权密码',
    guide: '需在 163 邮箱网页端「设置 -> POP3/SMTP/IMAP」开启服务并新增专属「客户端授权密码」。'
  },
  outlook: {
    id: 'outlook',
    name: 'Outlook / 365',
    host: 'outlook.office365.com',
    port: 993,
    ssl: true,
    emailPlaceholder: 'username@outlook.com',
    pwdLabel: '邮箱密码或应用专用密码',
    pwdPlaceholder: '登录密码或微软应用密码',
    guide: '支持 Outlook、Hotmail、Office 365 邮箱。若开启了两步验证，请在微软账户安全中心生成应用密码。'
  },
  gmail: {
    id: 'gmail',
    name: 'Gmail (应用密码)',
    host: 'imap.gmail.com',
    port: 993,
    ssl: true,
    emailPlaceholder: 'username@gmail.com',
    pwdLabel: '16 位 Google 应用专用密码',
    pwdPlaceholder: '例如：abcd efgh ijkl mnop',
    guide: '需开启 Google 两步验证，在 myaccount.google.com/apppasswords 生成 16 位应用专用密码。',
    link: 'https://myaccount.google.com/apppasswords'
  },
  exmail: {
    id: 'exmail',
    name: '企业邮箱',
    host: 'imap.exmail.qq.com',
    port: 993,
    ssl: true,
    emailPlaceholder: 'name@yourcompany.com',
    pwdLabel: '企业邮箱客户端专用密码',
    pwdPlaceholder: '输入企业微信或企邮授权密码',
    guide: '腾讯企业邮默认 imap.exmail.qq.com:993；阿里企业邮请填写 imap.qiye.aliyun.com:993。'
  },
  custom: {
    id: 'custom',
    name: '自定义 IMAP',
    host: '',
    port: 993,
    ssl: true,
    emailPlaceholder: 'user@custom-domain.com',
    pwdLabel: '邮箱密码或专用授权码',
    pwdPlaceholder: '输入密码',
    guide: '支持任何遵循标准 IMAP 协议的自建邮局（Mailcow、Postfix）或运营商企业邮箱。'
  }
};

const AI_PRESETS = {
  deepseek: {
    name: 'DeepSeek',
    url: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    desc: '超高性价比与严密推理，推荐国内首选'
  },
  custom: {
    name: '自定义 OpenAI 接口',
    url: '',
    model: '',
    desc: '支持任何兼容 OpenAI /chat/completions 规范的第三方模型接口'
  }
};

export default function Settings({ 
  accounts, 
  loadAccounts, 
  onTriggerSync, 
  onTriggerSyncAll, 
  syncingAccountIds = [], 
  isSyncing, 
  isSyncingAll, 
  onSeedDemo,
  onStopSync 
}) {
  // Multi-Platform AI Settings State
  const [platforms, setPlatforms] = useState([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [defaultPlatformId, setDefaultPlatformId] = useState('');
  const [defaultContextWindow, setDefaultContextWindow] = useState(524288);
  const [showApiKeyMap, setShowApiKeyMap] = useState({});
  const [testingPlatformId, setTestingPlatformId] = useState(null);
  const [testResultsMap, setTestResultsMap] = useState({});
  const [activeModalPlatform, setActiveModalPlatform] = useState(null);
  const [isModelModalOpen, setIsModelModalOpen] = useState(false);
  const [savingAi, setSavingAi] = useState(false);
  const [aiMsg, setAiMsg] = useState(null);

  // Generic IMAP Form State
  const [imapProvider, setImapProvider] = useState('qq');
  const [imapEmail, setImapEmail] = useState('');
  const [imapPassword, setImapPassword] = useState('');
  const [imapHost, setImapHost] = useState(IMAP_PRESETS.qq.host);
  const [imapPort, setImapPort] = useState(IMAP_PRESETS.qq.port);
  const [useSsl, setUseSsl] = useState(true);
  const [showAdvancedImap, setShowAdvancedImap] = useState(false);
  const [connectingImap, setConnectingImap] = useState(false);
  const [imapMsg, setImapMsg] = useState(null);

  // Auto-Sync Settings State
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [autoSyncInterval, setAutoSyncInterval] = useState(30);
  const [autoSyncLastRun, setAutoSyncLastRun] = useState('');
  const [savingAutoSync, setSavingAutoSync] = useState(false);
  const [autoSyncMsg, setAutoSyncMsg] = useState(null);
  const [triggeringAuto, setTriggeringAuto] = useState(false);

  // Account Deletion Feedback States
  const [deletingAccountId, setDeletingAccountId] = useState(null);
  const [deleteModalAccount, setDeleteModalAccount] = useState(null);
  const [accountActionNotice, setAccountActionNotice] = useState(null);

  // Account Password Edit States
  const [editPasswordAccount, setEditPasswordAccount] = useState(null);
  const [newAppPassword, setNewAppPassword] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [updatePasswordError, setUpdatePasswordError] = useState(null);

  useEffect(() => {
    loadAiPlatforms();
    loadAutoSyncSettings();
  }, []);

  const loadAiPlatforms = async () => {
    try {
      const res = await api.getAIPlatforms();
      if (res && res.platforms) {
        setPlatforms(res.platforms);
        setDefaultModel(res.default_model || '');
        setDefaultPlatformId(res.default_platform_id || '');
        setDefaultContextWindow(res.default_context_window || 524288);
      }
    } catch (err) {
      console.error('Failed to load AI platforms:', err);
    }
  };

  const handleUpdatePlatform = (id, field, value) => {
    setPlatforms(prev => prev.map(p => {
      if (p.id !== id) return p;
      return { ...p, [field]: value };
    }));
  };

  const toggleShowApiKey = (id) => {
    setShowApiKeyMap(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleAddPlatform = (presetType = 'custom') => {
    const PRESETS = {
      deepseek: {
        name: 'DeepSeek',
        base_url: 'https://api.deepseek.com/v1',
        enabled_models: ['deepseek-chat', 'deepseek-reasoner']
      },
      siliconflow: {
        name: 'SiliconFlow 硅基流动',
        base_url: 'https://api.siliconflow.cn/v1',
        enabled_models: []
      },
      agnes: {
        name: 'Agnes AI',
        base_url: 'https://api.agnes.ai/v1',
        enabled_models: []
      },
      ollama: {
        name: 'Ollama (本地)',
        base_url: 'http://localhost:11434/v1',
        enabled_models: []
      },
      custom: {
        name: '自定义 OpenAI 接口',
        base_url: '',
        enabled_models: []
      }
    };
    const target = PRESETS[presetType] || PRESETS.custom;
    const newId = `plt_${Date.now()}`;
    const newPlatform = {
      id: newId,
      name: target.name,
      base_url: target.base_url,
      api_key: '',
      api_key_masked: '',
      has_api_key: false,
      enabled_models: target.enabled_models || [],
      is_active: true
    };
    setPlatforms(prev => [...prev, newPlatform]);
    if (!defaultModel && newPlatform.enabled_models.length > 0) {
      setDefaultModel(newPlatform.enabled_models[0]);
      setDefaultPlatformId(newId);
    }
  };

  const handleDeletePlatform = (id) => {
    if (platforms.length <= 1) {
      alert('至少需要保留一个 AI 模型平台配置');
      return;
    }
    if (window.confirm('确认移除该平台配置吗？')) {
      const remaining = platforms.filter(p => p.id !== id);
      setPlatforms(remaining);
      if (defaultPlatformId === id) {
        const nextDefault = remaining[0]?.enabled_models?.[0] || '';
        setDefaultModel(nextDefault);
        setDefaultPlatformId(remaining[0]?.id || '');
      }
    }
  };

  const handleOpenModelModal = (platform) => {
    if (!platform.base_url || !platform.base_url.trim()) {
      alert('请先填写该平台的 Base URL 接口地址');
      return;
    }
    setActiveModalPlatform(platform);
    setIsModelModalOpen(true);
  };

  const handleSavePlatformModels = (newModelsList) => {
    if (!activeModalPlatform) return;
    const pId = activeModalPlatform.id;
    setPlatforms(prev => prev.map(p => {
      if (p.id !== pId) return p;
      return { ...p, enabled_models: newModelsList };
    }));
    // If current default model is not in enabled models, default to first enabled
    if (!defaultModel || !newModelsList.includes(defaultModel)) {
      if (newModelsList.length > 0) {
        setDefaultModel(newModelsList[0]);
        setDefaultPlatformId(pId);
      }
    }
    setIsModelModalOpen(false);
    setActiveModalPlatform(null);
  };

  const handleRemoveModelChip = (platformId, modelName) => {
    setPlatforms(prev => prev.map(p => {
      if (p.id !== platformId) return p;
      return {
        ...p,
        enabled_models: (p.enabled_models || []).filter(m => m !== modelName)
      };
    }));
    if (defaultModel === modelName) {
      const allOther = platforms.flatMap(p => 
        (p.id === platformId ? (p.enabled_models || []).filter(m => m !== modelName) : (p.enabled_models || []))
      );
      setDefaultModel(allOther[0] || '');
    }
  };

  const handleSetDefaultModel = (platformId, modelName) => {
    setDefaultModel(modelName);
    setDefaultPlatformId(platformId);
  };

  const handleTestPlatform = async (platform) => {
    try {
      setTestingPlatformId(platform.id);
      setTestResultsMap(prev => ({ ...prev, [platform.id]: null }));
      const modelToTest = (platform.enabled_models && platform.enabled_models[0]) || 'deepseek-chat';
      const res = await api.testAIConnection({
        ai_base_url: platform.base_url,
        ai_api_key: platform.api_key || undefined,
        ai_model: modelToTest
      });
      setTestResultsMap(prev => ({ ...prev, [platform.id]: res }));
    } catch (err) {
      setTestResultsMap(prev => ({ ...prev, [platform.id]: { success: false, error: err.message } }));
    } finally {
      setTestingPlatformId(null);
    }
  };

  const handleSaveAllPlatforms = async () => {
    try {
      setSavingAi(true);
      setAiMsg(null);
      const res = await api.saveAIPlatforms({
        platforms,
        default_model: defaultModel,
        default_platform_id: defaultPlatformId,
        default_context_window: defaultContextWindow
      });
      setAiMsg({ type: 'success', text: '多平台 AI 接入配置与启用模型已成功保存！' });
      if (res && res.platforms) {
        setPlatforms(res.platforms);
        setDefaultModel(res.default_model || '');
        setDefaultPlatformId(res.default_platform_id || '');
        setDefaultContextWindow(res.default_context_window || 524288);
      }
      setTimeout(() => setAiMsg(null), 4000);
    } catch (err) {
      setAiMsg({ type: 'error', text: '保存失败: ' + err.message });
    } finally {
      setSavingAi(false);
    }
  };


  const loadAutoSyncSettings = async () => {
    try {
      const res = await api.getAutoSyncSettings();
      if (res) {
        setAutoSyncEnabled(res.auto_sync_enabled);
        setAutoSyncInterval(res.auto_sync_interval_minutes || 30);
        setAutoSyncLastRun(res.auto_sync_last_run || '');
      }
    } catch (err) {
      console.error('Failed to load auto sync settings:', err);
    }
  };

  const handleSaveAutoSync = async (newEnabled, newInterval) => {
    try {
      setSavingAutoSync(true);
      setAutoSyncMsg(null);
      const res = await api.updateAutoSyncSettings(newEnabled, newInterval);
      setAutoSyncEnabled(res.auto_sync_enabled);
      setAutoSyncInterval(res.auto_sync_interval_minutes);
      setAutoSyncLastRun(res.auto_sync_last_run || '');
      setAutoSyncMsg({ 
        type: 'success', 
        text: `自动同步已${newEnabled ? `开启（每 ${newInterval} 分钟静默增量同步一次）` : '关闭'}` 
      });
      setTimeout(() => setAutoSyncMsg(null), 3500);
    } catch (err) {
      setAutoSyncMsg({ type: 'error', text: '保存失败: ' + err.message });
    } finally {
      setSavingAutoSync(false);
    }
  };

  const handleTriggerAutoNow = async () => {
    try {
      setTriggeringAuto(true);
      setAutoSyncMsg(null);
      const res = await api.triggerAutoSyncNow();
      setAutoSyncMsg({ 
        type: 'success', 
        text: `增量同步已执行完成！已同步账号: ${res.synced_accounts?.join(', ') || '无新邮件'}` 
      });
      await loadAccounts();
      await loadAutoSyncSettings();
      setTimeout(() => setAutoSyncMsg(null), 5000);
    } catch (err) {
      setAutoSyncMsg({ type: 'error', text: '后台同步异常: ' + err.message });
    } finally {
      setTriggeringAuto(false);
    }
  };

  const handleSelectProvider = (key) => {
    setImapProvider(key);
    const p = IMAP_PRESETS[key];
    if (p) {
      setImapHost(p.host);
      setImapPort(p.port);
      setUseSsl(p.ssl);
    }
    setImapMsg(null);
  };

  // Connect via Generic IMAP
  const handleConnectImap = async (e) => {
    e.preventDefault();
    if (!imapEmail.trim() || !imapPassword.trim()) {
      alert('请完整填写邮箱地址与密码/授权码');
      return;
    }
    if (!imapHost.trim()) {
      alert('请填写有效的 IMAP 服务器地址');
      return;
    }

    try {
      setConnectingImap(true);
      setImapMsg(null);
      const res = await api.connectImap({
        email: imapEmail.trim(),
        password: imapPassword.trim(),
        provider: imapProvider,
        imap_host: imapHost.trim(),
        imap_port: parseInt(imapPort, 10) || 993,
        use_ssl: useSsl
      });
      setImapMsg({ type: 'success', text: res.message || '邮箱连接成功并已接入！' });
      setImapEmail('');
      setImapPassword('');
      await loadAccounts();
    } catch (err) {
      setImapMsg({ type: 'error', text: err.message });
    } finally {
      setConnectingImap(false);
    }
  };



  const handleDeleteAccount = (acc) => {
    setDeleteModalAccount(acc);
  };

  const handleConfirmDelete = async () => {
    if (!deleteModalAccount) return;
    const target = deleteModalAccount;
    setDeletingAccountId(target.id);
    setAccountActionNotice({
      type: 'loading',
      text: `正在彻底移除账号 ${target.email} 及其关联的全部邮件与资产数据，请稍候...`
    });

    try {
      const res = await api.deleteAccount(target.id);
      setDeleteModalAccount(null);
      setAccountActionNotice({
        type: 'success',
        text: res.message || `账号 ${target.email} 及其关联邮件资产已成功彻底清除！`
      });
      await loadAccounts();
      setTimeout(() => setAccountActionNotice(null), 5000);
    } catch (err) {
      setAccountActionNotice({
        type: 'error',
        text: `移除失败: ${err.message || '网络请求超时或服务异常'}`
      });
    } finally {
      setDeletingAccountId(null);
    }
  };

  const handleSaveNewPassword = async (e) => {
    e.preventDefault();
    if (!editPasswordAccount || !newAppPassword.trim()) return;

    try {
      setUpdatingPassword(true);
      setUpdatePasswordError(null);
      const res = await api.connectImap({
        email: editPasswordAccount.email,
        password: newAppPassword.trim(),
        provider: editPasswordAccount.provider || 'custom',
        imap_host: editPasswordAccount.imap_host || 'imap.gmail.com',
        imap_port: editPasswordAccount.imap_port || 993,
        use_ssl: editPasswordAccount.use_ssl !== 0
      });
      setEditPasswordAccount(null);
      setAccountActionNotice({
        type: 'success',
        text: `账号 ${editPasswordAccount.email} 的连接凭据已成功更新！原有数据完好保留。`
      });
      setTimeout(() => setAccountActionNotice(null), 5000);
      await loadAccounts();
    } catch (err) {
      setUpdatePasswordError(err.message || '更新密码失败，请检查密码或服务配置是否正确');
    } finally {
      setUpdatingPassword(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-16">
      {/* Header */}
      <div className="border-b border-[var(--color-border)] pb-4 pt-2">
        <h1 className="text-2xl sm:text-3xl font-serif font-normal text-[var(--color-neutral-10)] tracking-tight">
          系统配置与多邮箱资产接入
        </h1>
        <p className="text-xs font-serif text-[var(--color-neutral-6)] mt-1">
          接入您的主流邮箱（QQ、163、Outlook、企业邮、Gmail 等），自动索引全部信件并生成可视化资产台账。
        </p>
      </div>

      {/* Universal IMAP Provider Support */}
      <div className="yohaku-card p-6 space-y-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <h3 className="text-sm font-serif font-medium text-[var(--color-neutral-10)]">
                通用邮箱标准 IMAP 接入（全量支持国内外主流邮箱服务商）
              </h3>
            </div>
            <p className="text-[11px] text-[var(--color-neutral-6)] mt-1">
              通过标准 SSL 加密信道安全读取邮件。支持自动探测所有文件夹，包含收件箱、发件箱与归档，自动过滤垃圾邮件。
            </p>
          </div>

          {/* Provider Preset Selector Pills */}
          <div className="space-y-2">
            <label className="text-[11px] font-mono text-[var(--color-neutral-6)] block">选择邮箱服务商预设：</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono">
              {Object.entries(IMAP_PRESETS).map(([key, p]) => {
                const isSelected = imapProvider === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleSelectProvider(key)}
                    className={`px-3 py-2 rounded-md border text-left transition-all flex items-center justify-between ${
                      isSelected
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-medium shadow-xs'
                        : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-neutral-8)] hover:border-[var(--color-neutral-5)] hover:bg-[var(--color-surface-subtle)]'
                    }`}
                  >
                    <span>{p.name}</span>
                    {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Provider Guide Box */}
          <div className="bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-md p-4 text-xs text-[var(--color-neutral-7)] space-y-2">
            <div className="font-medium text-[var(--color-neutral-9)] flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
              <span>{IMAP_PRESETS[imapProvider]?.name} 授权指引：</span>
            </div>
            <p className="text-[11px] text-[var(--color-neutral-6)] leading-relaxed pl-5">
              {IMAP_PRESETS[imapProvider]?.guide}
            </p>
            {IMAP_PRESETS[imapProvider]?.link && (
              <div className="pl-5 pt-1">
                <a
                  href={IMAP_PRESETS[imapProvider].link}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--color-accent)] underline font-medium inline-flex items-center gap-0.5 text-[11px]"
                >
                  <span>直达密码生成页面</span>
                  <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                </a>
              </div>
            )}
          </div>

          {/* Form */}
          <form onSubmit={handleConnectImap} className="space-y-3.5 pt-1">
            <div className="space-y-1 text-xs">
              <label className="font-mono text-[11px] text-[var(--color-neutral-6)]">电子邮箱地址：</label>
              <input
                type="email"
                placeholder={IMAP_PRESETS[imapProvider]?.emailPlaceholder || 'yourname@domain.com'}
                value={imapEmail}
                onChange={(e) => setImapEmail(e.target.value)}
                className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-9)] text-xs rounded-md px-3 py-2 outline-none font-mono focus:border-[var(--color-accent)]"
                required
              />
            </div>

            <div className="space-y-1 text-xs">
              <label className="font-mono text-[11px] text-[var(--color-neutral-6)]">
                {IMAP_PRESETS[imapProvider]?.pwdLabel || '密码或授权码'}：
              </label>
              <input
                type="text"
                placeholder={IMAP_PRESETS[imapProvider]?.pwdPlaceholder || '输入授权密码'}
                value={imapPassword}
                onChange={(e) => setImapPassword(e.target.value)}
                className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-9)] text-xs rounded-md px-3 py-2 outline-none font-mono focus:border-[var(--color-accent)]"
                required
              />
            </div>

            {/* Advanced Host/Port Settings (Always editable if custom or toggled) */}
            {(imapProvider === 'custom' || showAdvancedImap) && (
              <div className="p-3.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-subtle)] space-y-3">
                <div className="text-[11px] font-mono text-[var(--color-neutral-8)] font-medium flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                  <span>服务器连接参数</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs font-mono">
                  <div className="sm:col-span-2 space-y-1">
                    <label className="text-[10px] text-[var(--color-neutral-6)]">IMAP 主机地址：</label>
                    <input
                      type="text"
                      placeholder="imap.example.com"
                      value={imapHost}
                      onChange={(e) => setImapHost(e.target.value)}
                      className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-9)] text-xs rounded px-2.5 py-1.5 outline-none focus:border-[var(--color-accent)]"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-[var(--color-neutral-6)]">端口号：</label>
                    <input
                      type="number"
                      placeholder="993"
                      value={imapPort}
                      onChange={(e) => setImapPort(e.target.value)}
                      className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-9)] text-xs rounded px-2.5 py-1.5 outline-none focus:border-[var(--color-accent)]"
                      required
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1 text-xs font-mono text-[var(--color-neutral-7)]">
                  <input
                    type="checkbox"
                    id="use_ssl_checkbox"
                    checked={useSsl}
                    onChange={(e) => setUseSsl(e.target.checked)}
                    className="rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-0"
                  />
                  <label htmlFor="use_ssl_checkbox" className="cursor-pointer select-none">
                    使用 SSL/TLS 加密连接 (推荐，通常端口为 993)
                  </label>
                </div>
              </div>
            )}

            {imapProvider !== 'custom' && (
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => setShowAdvancedImap(!showAdvancedImap)}
                  className="text-[11px] font-mono text-[var(--color-neutral-6)] hover:text-[var(--color-accent)] inline-flex items-center gap-1 underline transition-colors"
                >
                  <Sliders className="w-3 h-3" />
                  <span>{showAdvancedImap ? '收起高级连接参数' : '展开/自定义服务器主机与端口'}</span>
                </button>
              </div>
            )}

            <div className="pt-2">
              <button
                type="submit"
                disabled={connectingImap}
                className="yohaku-btn-primary px-5 py-2 text-xs flex items-center gap-1.5 disabled:opacity-50"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>{connectingImap ? '正在验证连接并探测文件夹...' : `连接并绑定 ${IMAP_PRESETS[imapProvider]?.name || '邮箱'}`}</span>
              </button>
            </div>
          </form>

          {imapMsg && (
            <div className={`p-3 rounded-md text-xs font-mono leading-relaxed ${
              imapMsg.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
            }`}>
              {imapMsg.text}
            </div>
          )}
        </div>

      {/* Multi-Platform AI Model Configuration Card */}
      <div className="yohaku-card p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <img 
              src="/ai-avatar.png" 
              alt="AI Avatar" 
              className="w-10 h-10 rounded-full object-cover border border-[var(--color-accent)]/30 shadow-xs shrink-0" 
            />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-serif font-medium text-[var(--color-neutral-10)]">
                  AI 大模型多平台接入管理
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/20">
                  OpenAI 兼容规范
                </span>
              </div>
              <p className="text-[11px] text-[var(--color-neutral-6)] mt-0.5">
                支持接入 DeepSeek、硅基流动、Agnes AI、Ollama、OneAPI 等多个平台。点击各平台的【获取模型列表】探测并勾选启用模型。
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono bg-emerald-500/10 text-emerald-700 border border-emerald-500/20">
              <Layers className="w-3.5 h-3.5" />
              <span>已启用 {platforms.reduce((acc, p) => acc + (p.enabled_models?.length || 0), 0)} 个模型</span>
            </span>
          </div>
        </div>

        {/* Platform Cards List */}
        <div className="space-y-4">
          {platforms.map((platform, pIdx) => {
            const isTestingThis = testingPlatformId === platform.id;
            const pTestResult = testResultsMap[platform.id];
            const isShowKey = !!showApiKeyMap[platform.id];

            return (
              <div
                key={platform.id}
                className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-neutral-4)] transition-all space-y-3.5 shadow-2xs"
              >
                {/* Platform Header */}
                <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-[var(--color-border)]/50">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-md bg-[var(--color-surface-subtle)] border border-[var(--color-border)] flex items-center justify-center text-[10px] font-mono font-medium text-[var(--color-neutral-6)]">
                      {pIdx + 1}
                    </span>
                    <input
                      type="text"
                      value={platform.name}
                      onChange={(e) => handleUpdatePlatform(platform.id, 'name', e.target.value)}
                      placeholder="平台名称（如：DeepSeek 官方）"
                      className="text-xs font-mono font-semibold text-[var(--color-neutral-9)] bg-transparent border-b border-transparent hover:border-[var(--color-border)] focus:border-[var(--color-accent)] focus:outline-none px-1 py-0.5 rounded transition-all"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Fetch Models Button */}
                    <button
                      type="button"
                      onClick={() => handleOpenModelModal(platform)}
                      className="px-2.5 py-1 text-xs font-mono rounded-md bg-[var(--color-accent)]/10 text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white border border-[var(--color-accent)]/20 transition-all flex items-center gap-1.5 cursor-pointer"
                      title="连接此平台的 /models 接口探测可用模型并勾选"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>获取模型列表</span>
                    </button>

                    {/* Test Platform Connection Button */}
                    <button
                      type="button"
                      onClick={() => handleTestPlatform(platform)}
                      disabled={isTestingThis || !platform.base_url}
                      className="px-2.5 py-1 text-xs font-mono rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-neutral-7)] hover:text-[var(--color-neutral-10)] hover:bg-[var(--color-surface-subtle)] transition-all flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                      title="测试连通性"
                    >
                      {isTestingThis ? (
                        <RefreshCw className="w-3 h-3 animate-spin text-[var(--color-accent)]" />
                      ) : (
                        <Zap className="w-3 h-3 text-[var(--color-accent)]" />
                      )}
                      <span>{isTestingThis ? '测试中...' : '测试连通'}</span>
                    </button>

                    {/* Delete Platform */}
                    {platforms.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleDeletePlatform(platform.id)}
                        className="p-1 rounded-md text-[var(--color-neutral-4)] hover:text-rose-600 hover:bg-rose-500/10 transition-all cursor-pointer"
                        title="删除该平台"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Base URL and API Key Inputs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-[11px] font-mono text-[var(--color-neutral-7)]">
                      API Base URL
                    </label>
                    <input
                      type="text"
                      value={platform.base_url}
                      onChange={(e) => handleUpdatePlatform(platform.id, 'base_url', e.target.value)}
                      placeholder="https://api.deepseek.com/v1"
                      className="w-full px-3 py-1.5 text-xs font-mono rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-neutral-10)] focus:outline-none focus:border-[var(--color-accent)] shadow-2xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="block text-[11px] font-mono text-[var(--color-neutral-7)]">
                        API Key
                      </label>
                      {platform.has_api_key && !platform.api_key && (
                        <span className="text-[10px] text-[var(--color-neutral-5)] font-mono">
                          已保存: {platform.api_key_masked}
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type={isShowKey ? 'text' : 'password'}
                        value={platform.api_key}
                        onChange={(e) => handleUpdatePlatform(platform.id, 'api_key', e.target.value)}
                        placeholder={platform.has_api_key ? '留空保持已有密钥不变' : 'sk-... (本地 Ollama 可留空)'}
                        className="w-full pl-3 pr-8 py-1.5 text-xs font-mono rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-neutral-10)] focus:outline-none focus:border-[var(--color-accent)] shadow-2xs"
                      />
                      <button
                        type="button"
                        onClick={() => toggleShowApiKey(platform.id)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-neutral-4)] hover:text-[var(--color-neutral-8)] cursor-pointer"
                      >
                        {isShowKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Enabled Models Tag Cloud */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className="text-[var(--color-neutral-7)] flex items-center gap-1.5">
                      <span>已启用模型</span>
                      <span className="text-[10px] text-[var(--color-neutral-4)]">
                        ({platform.enabled_models?.length || 0}) · 点击 ⭐ 设为系统默认主模型
                      </span>
                    </span>
                  </div>

                  {platform.enabled_models && platform.enabled_models.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 p-2 rounded-lg bg-[var(--color-surface-subtle)]/40 border border-[var(--color-border)]/60">
                      {platform.enabled_models.map((modelName) => {
                        const isDefault = defaultModel === modelName;
                        return (
                          <div
                            key={modelName}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono transition-all ${
                              isDefault
                                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30 font-medium shadow-2xs'
                                : 'bg-[var(--color-surface)] text-[var(--color-neutral-8)] border border-[var(--color-border)] hover:border-[var(--color-neutral-4)]'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => handleSetDefaultModel(platform.id, modelName)}
                              className="focus:outline-none cursor-pointer"
                              title={isDefault ? '当前系统默认模型' : '点击设为系统默认模型'}
                            >
                              <Star
                                className={`w-3.5 h-3.5 ${
                                  isDefault
                                    ? 'text-amber-500 fill-amber-500'
                                    : 'text-[var(--color-neutral-4)] hover:text-amber-500'
                                }`}
                              />
                            </button>
                            
                            <span className="select-all">{modelName}</span>
                            
                            {isDefault && (
                              <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300">
                                默认
                              </span>
                            )}

                            <button
                              type="button"
                              onClick={() => handleRemoveModelChip(platform.id, modelName)}
                              className="p-0.5 rounded hover:bg-rose-500/10 hover:text-rose-600 text-[var(--color-neutral-4)] transition-colors cursor-pointer ml-0.5"
                              title="取消启用此模型"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div
                      onClick={() => handleOpenModelModal(platform)}
                      className="p-3 rounded-lg border border-dashed border-[var(--color-border)] hover:border-[var(--color-accent)] bg-[var(--color-surface-subtle)]/20 text-center cursor-pointer transition-colors group"
                    >
                      <p className="text-xs font-mono text-[var(--color-neutral-5)] group-hover:text-[var(--color-accent)] flex items-center justify-center gap-1.5">
                        <Layers className="w-3.5 h-3.5" />
                        <span>暂无启用的模型，点击此处「获取模型列表」自动探测或补充模型</span>
                      </p>
                    </div>
                  )}
                </div>

                {/* Test Feedback for this Platform */}
                {pTestResult && (
                  <div className={`p-2.5 rounded-lg text-xs font-mono space-y-1 ${
                    pTestResult.success
                      ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-500/20'
                      : 'bg-rose-500/10 text-rose-800 dark:text-rose-300 border border-rose-500/20'
                  }`}>
                    <div className="flex items-center gap-1.5 font-medium">
                      {pTestResult.success ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                      )}
                      <span>{pTestResult.success ? `连通成功！响应延迟: ${pTestResult.latency_ms} ms` : '测试连通失败'}</span>
                    </div>
                    {pTestResult.success && pTestResult.reply && (
                      <div className="text-[11px] opacity-80 pl-5 truncate">
                        模型回应: "{pTestResult.reply.trim()}"
                      </div>
                    )}
                    {!pTestResult.success && pTestResult.error && (
                      <div className="text-[11px] pl-5 break-all">
                        {pTestResult.error}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Quick Add Platform Presets */}
        <div className="p-3 rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-subtle)]/30 flex items-center justify-between flex-wrap gap-2">
          <div className="text-xs font-mono text-[var(--color-neutral-6)] flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5 text-[var(--color-accent)]" />
            <span>新增模型平台:</span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => handleAddPlatform('deepseek')}
              className="px-2.5 py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-xs font-mono text-[var(--color-neutral-8)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-all cursor-pointer"
            >
              + DeepSeek
            </button>
            <button
              type="button"
              onClick={() => handleAddPlatform('siliconflow')}
              className="px-2.5 py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-xs font-mono text-[var(--color-neutral-8)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-all cursor-pointer"
            >
              + 硅基流动
            </button>
            <button
              type="button"
              onClick={() => handleAddPlatform('agnes')}
              className="px-2.5 py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-xs font-mono text-[var(--color-neutral-8)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-all cursor-pointer"
            >
              + Agnes AI
            </button>
            <button
              type="button"
              onClick={() => handleAddPlatform('ollama')}
              className="px-2.5 py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-xs font-mono text-[var(--color-neutral-8)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-all cursor-pointer"
            >
              + Ollama (本地)
            </button>
            <button
              type="button"
              onClick={() => handleAddPlatform('custom')}
              className="px-2.5 py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-xs font-mono text-[var(--color-neutral-8)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-all cursor-pointer"
            >
              + 自定义兼容平台
            </button>
          </div>
        </div>

        {/* Global Feedback Message */}
        {aiMsg && (
          <div className={`p-3 rounded-lg text-xs flex items-center gap-2 font-mono ${
            aiMsg.type === 'success'
              ? 'bg-emerald-500/10 text-emerald-700 border border-emerald-500/20'
              : 'bg-rose-500/10 text-rose-700 border border-rose-500/20'
          }`}>
            {aiMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
            )}
            <span>{aiMsg.text}</span>
          </div>
        )}

        {/* Context Window Default Limit Configuration */}
        <div className="p-3.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)]/50 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <span className="text-xs font-mono font-medium text-[var(--color-neutral-9)] flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                <span>大模型默认上下文上限</span>
              </span>
              <p className="text-[11px] font-serif text-[var(--color-neutral-6)] mt-0.5">
                设置系统大模型的默认上下文 Token 额度。当对话历史累计超过 50% 时将自动调用模型执行结构化语义压缩。
              </p>
            </div>
            
            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                { label: '128K', value: 131072 },
                { label: '256K', value: 262144 },
                { label: '512K (推荐)', value: 524288 },
                { label: '1M', value: 1048576 }
              ].map(preset => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setDefaultContextWindow(preset.value)}
                  className={`px-2.5 py-1 rounded-md text-xs font-mono transition-all cursor-pointer ${
                    defaultContextWindow === preset.value
                      ? 'bg-[var(--color-accent)] text-white shadow-xs font-medium'
                      : 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-7)] hover:border-[var(--color-accent)]/50'
                  }`}
                >
                  {preset.label}
                </button>
              ))}

              <div className="flex items-center gap-1 ml-1">
                <input
                  type="number"
                  min="32768"
                  max="4194304"
                  step="1024"
                  value={defaultContextWindow}
                  onChange={(e) => setDefaultContextWindow(Number(e.target.value) || 524288)}
                  className="w-24 px-2 py-1 text-xs font-mono rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-neutral-9)] focus:outline-none focus:border-[var(--color-accent)] shadow-2xs"
                  placeholder="524288"
                />
                <span className="text-xs font-mono text-[var(--color-neutral-5)]">Tokens</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Save Bar */}
        <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border)]/60">
          <div className="text-xs font-mono text-[var(--color-neutral-5)]">
            默认主模型: <span className="text-[var(--color-neutral-9)] font-semibold">{defaultModel || '未设定'}</span>
          </div>

          <button
            type="button"
            onClick={handleSaveAllPlatforms}
            disabled={savingAi}
            className="yohaku-btn-primary px-5 py-2 text-xs font-mono flex items-center gap-2 disabled:opacity-50 cursor-pointer shadow-xs"
          >
            {savingAi ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            <span>{savingAi ? '正在保存中...' : '保存全部 AI 平台配置'}</span>
          </button>
        </div>
      </div>

      {/* Background Auto-Sync Settings Card */}
      <div className="yohaku-card p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[var(--color-surface-subtle)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-accent)] shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-serif font-medium text-[var(--color-neutral-10)] flex items-center gap-2">
                <span>后台自动化定时增量同步</span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono ${
                  autoSyncEnabled ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-[var(--color-surface-subtle)] text-[var(--color-neutral-6)]'
                }`}>
                  {autoSyncEnabled ? `每 ${autoSyncInterval} 分钟自动同步` : '已关闭'}
                </span>
              </h3>
              <p className="text-[11px] text-[var(--color-neutral-6)] mt-0.5">
                在后台异步增量拉取所有已绑定邮箱的最新信件与资产，静默无感运行，不打扰当前阅读与操作。
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleTriggerAutoNow}
              disabled={triggeringAuto || accounts.length === 0}
              className="px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-xs font-mono text-[var(--color-neutral-8)] hover:bg-[var(--color-surface-subtle)] hover:border-[var(--color-accent)] transition-all flex items-center gap-1.5 disabled:opacity-50"
              title="立即测试并触发一次后台增量同步"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${triggeringAuto ? 'animate-spin text-[var(--color-accent)]' : ''}`} />
              <span>{triggeringAuto ? '正在增量拉取...' : '立即增量同步'}</span>
            </button>

            {/* Toggle Switch */}
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={autoSyncEnabled}
                onChange={(e) => handleSaveAutoSync(e.target.checked, autoSyncInterval)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-[var(--color-surface-subtle)] border border-[var(--color-border)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--color-accent)]"></div>
            </label>
          </div>
        </div>

        {/* Interval Selector */}
        <div className="p-3.5 rounded-md bg-[var(--color-surface-subtle)] border border-[var(--color-border)] flex items-center justify-between flex-wrap gap-3 text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-neutral-7)]">同步执行周期：</span>
            <select
              value={autoSyncInterval}
              disabled={!autoSyncEnabled || savingAutoSync}
              onChange={(e) => handleSaveAutoSync(autoSyncEnabled, parseInt(e.target.value, 10))}
              className="bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-9)] rounded px-2.5 py-1 outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
            >
              <option value={15}>每 15 分钟</option>
              <option value={30}>每 30 分钟 (推荐)</option>
              <option value={60}>每 1 小时</option>
              <option value={120}>每 2 小时</option>
              <option value={360}>每 6 小时</option>
            </select>
          </div>

          <div className="text-[11px] text-[var(--color-neutral-5)]">
            上次自动同步：<span className="font-mono text-[var(--color-neutral-8)]">{autoSyncLastRun || '尚未执行'}</span>
          </div>
        </div>

        {autoSyncMsg && (
          <div className={`p-2.5 rounded-md text-xs font-mono flex items-center gap-1.5 ${
            autoSyncMsg.type === 'success' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-700 border border-rose-500/20'
          }`}>
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>{autoSyncMsg.text}</span>
          </div>
        )}
      </div>

      {/* Linked Accounts List */}
      <div className="yohaku-card p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3 pb-1 border-b border-[var(--color-border)]/50">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-serif font-medium text-[var(--color-neutral-10)]">
              已接入的邮箱账号 ({accounts.length})
            </h3>
            {accounts.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onTriggerSyncAll}
                  disabled={isSyncingAll}
                  className="px-3 py-1 rounded-md text-xs font-mono border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-neutral-8)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] transition-all flex items-center gap-1.5 shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
                  title="一键同步所有已接入的邮箱账号"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-[var(--color-accent)] ${isSyncingAll ? 'animate-spin' : ''}`} />
                  <span className="font-medium">{isSyncingAll ? '全部同步中...' : '全部同步'}</span>
                </button>
                {(isSyncingAll || syncingAccountIds.length > 0 || accounts.some(a => a.sync_status === 'syncing')) && (
                  <button
                    type="button"
                    onClick={() => onStopSync && onStopSync(null)}
                    className="px-2.5 py-1 rounded-md text-xs font-mono border border-rose-500/30 bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 transition-all flex items-center gap-1 shadow-xs cursor-pointer"
                    title="立即停止所有正在运行的同步任务"
                  >
                    <Square className="w-3 h-3 fill-current" />
                    <span>停止同步</span>
                  </button>
                )}
              </div>
            )}
          </div>
          {isSyncingAll && (
            <span className="text-[11px] font-mono text-[var(--color-accent)] flex items-center gap-1 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
              正在同步所有账号...
            </span>
          )}
        </div>

        {/* Action Notice Banner (Deleting/Success/Error feedback) */}
        {accountActionNotice && (
          <div className={`p-3 rounded-lg text-xs font-mono flex items-center gap-2.5 transition-all shadow-xs ${
            accountActionNotice.type === 'loading'
              ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30'
              : accountActionNotice.type === 'success'
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
              : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/30'
          }`}>
            {accountActionNotice.type === 'loading' && <Loader2 className="w-4 h-4 animate-spin shrink-0 text-amber-600" />}
            {accountActionNotice.type === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />}
            {accountActionNotice.type === 'error' && <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />}
            <span className="leading-relaxed font-medium">{accountActionNotice.text}</span>
          </div>
        )}

        {accounts.length === 0 ? (
          <div className="py-6 text-center text-xs font-mono text-[var(--color-neutral-5)]">
            尚未绑定账号。您可通过上方通用邮箱接入表单绑定您的邮箱。
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]/60">
            {accounts.map((acc) => {
              const isAccSyncing = syncingAccountIds.includes(acc.id) || acc.sync_status === 'syncing';
              const providerLabel = {
                qq: 'QQ 邮箱',
                163: '163 网易',
                outlook: 'Outlook',
                gmail: 'Gmail',
                exmail: '企业邮',
                custom: 'IMAP'
              }[acc.provider] || (acc.account_type === 'imap' ? 'IMAP' : 'Gmail');

              return (
                <div key={acc.id} className="py-3 flex items-center justify-between">
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-[var(--color-surface-subtle)] border border-[var(--color-border)] flex items-center justify-center text-xs font-mono font-medium text-[var(--color-neutral-8)] shrink-0">
                      {acc.avatar_url ? (
                        <img src={acc.avatar_url} alt="" className="w-full h-full object-cover rounded-full" />
                      ) : (
                        acc.email.slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-[var(--color-neutral-10)] flex items-center gap-2 flex-wrap">
                        <span>{acc.display_name || acc.email}</span>
                        <span className="text-[11px] text-[var(--color-neutral-6)] font-mono">({acc.email})</span>
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[var(--color-neutral-7)]">
                          {providerLabel}
                        </span>
                        {isAccSyncing && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-mono bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-medium">
                            <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                            <span>同步中</span>
                          </span>
                        )}
                        {deletingAccountId === acc.id && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-mono bg-rose-500/10 text-rose-600 font-medium animate-pulse">
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            <span>正在彻底删除中...</span>
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-[var(--color-neutral-5)] font-mono mt-0.5 space-x-3 flex flex-wrap items-center">
                        <span>已索引: <b className="text-[var(--color-neutral-8)] tabular-nums">{acc.total_synced || 0}</b> 封</span>
                        <span>最近同步: {acc.last_synced_at || '未同步'}</span>
                        <span className={isAccSyncing ? 'text-[var(--color-accent)] font-medium' : 'text-[var(--color-neutral-6)]'}>
                          ({acc.sync_message || '就绪'})
                        </span>
                      </div>
                      {isAccSyncing && acc.sync_progress_total > 0 && (
                        <div className="w-48 sm:w-64 mt-1.5 space-y-0.5">
                          <div className="flex justify-between text-[9px] font-mono text-[var(--color-accent)] tabular-nums">
                            <span>{acc.sync_progress_current || 0} / {acc.sync_progress_total} 封</span>
                            <span>{Math.min(100, Math.round(((acc.sync_progress_current || 0) / acc.sync_progress_total) * 100))}%</span>
                          </div>
                          <div className="w-full h-1 bg-[var(--color-surface-subtle)] rounded-full overflow-hidden border border-[var(--color-border)]/40">
                            <div
                              className="h-full bg-[var(--color-accent)] transition-all duration-300 rounded-full"
                              style={{ width: `${Math.min(100, Math.round(((acc.sync_progress_current || 0) / acc.sync_progress_total) * 100))}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-1.5">
                    {isAccSyncing ? (
                      <button
                        onClick={() => onStopSync && onStopSync(acc.id)}
                        className="px-2 py-1 rounded-md text-[11px] font-mono border border-rose-500/30 bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 transition-all flex items-center gap-1 cursor-pointer"
                        title="点击停止该账号的同步状态"
                      >
                        <Square className="w-2.5 h-2.5 fill-current" />
                        <span>停止</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => onTriggerSync(acc.id)}
                        disabled={isAccSyncing || isSyncingAll || deletingAccountId === acc.id}
                        className="p-1.5 rounded-md transition-colors text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)] hover:bg-[var(--color-surface-subtle)] cursor-pointer disabled:opacity-50"
                        title={`同步账号 ${acc.email}`}
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setEditPasswordAccount(acc);
                        setNewAppPassword('');
                        setUpdatePasswordError(null);
                      }}
                      disabled={isAccSyncing || isSyncingAll || deletingAccountId === acc.id}
                      className="p-1.5 rounded-md transition-colors text-[var(--color-neutral-6)] hover:text-[var(--color-accent)] hover:bg-[var(--color-surface-subtle)] cursor-pointer disabled:opacity-50"
                      title={`修改账号 ${acc.email} 的连接密码/授权码`}
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteAccount(acc)}
                      disabled={deletingAccountId === acc.id || isAccSyncing}
                      className="p-1.5 rounded-md text-[var(--color-neutral-5)] hover:text-rose-600 hover:bg-rose-500/10 transition-colors disabled:opacity-50 cursor-pointer"
                      title={deletingAccountId === acc.id ? "正在删除数据..." : "移除账号"}
                    >
                      {deletingAccountId === acc.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-600" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Model Selection & Enabling Modal */}
      <ModelSelectModal
        isOpen={isModelModalOpen}
        onClose={() => {
          setIsModelModalOpen(false);
          setActiveModalPlatform(null);
        }}
        platform={activeModalPlatform}
        onSaveModels={handleSavePlatformModels}
      />

      {/* Account Deletion Confirmation Modal */}
      {deleteModalAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4 font-mono">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-full bg-rose-500/10 text-rose-600 border border-rose-500/20 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="space-y-1 min-w-0">
                <h3 className="text-sm font-semibold text-[var(--color-neutral-10)]">
                  确认彻底移除该邮箱账号？
                </h3>
                <p className="text-xs text-[var(--color-neutral-6)] leading-relaxed break-all">
                  目标账号：<span className="text-[var(--color-neutral-9)] font-medium">{deleteModalAccount.email}</span>
                </p>
              </div>
            </div>

            <div className="p-3.5 bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-lg text-xs space-y-2 text-[var(--color-neutral-7)]">
              <div className="flex justify-between items-center">
                <span>关联邮件总量：</span>
                <span className="text-[var(--color-neutral-9)] font-bold">{deleteModalAccount.total_synced || 0} 封</span>
              </div>
              <div className="text-[11px] text-rose-600 dark:text-rose-400 pt-1 leading-relaxed border-t border-[var(--color-border)]/60">
                ⚠️ 此操作将永久清除该账号在系统中的所有邮件记录、附件、数字资产与订阅账单数据，不可撤销！
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={Boolean(deletingAccountId)}
                onClick={() => setDeleteModalAccount(null)}
                className="px-4 py-1.5 text-xs rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-subtle)] text-[var(--color-neutral-8)] transition-all cursor-pointer disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={Boolean(deletingAccountId)}
                onClick={handleConfirmDelete}
                className="px-4 py-1.5 text-xs rounded-md bg-rose-600 hover:bg-rose-700 text-white font-medium shadow-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {deletingAccountId ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>正在彻底清除...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>确认彻底删除</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Account Password Update Modal */}
      {editPasswordAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4 font-mono">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-accent)]/20 shrink-0">
                <KeyRound className="w-5 h-5" />
              </div>
              <div className="space-y-1 min-w-0">
                <h3 className="text-sm font-semibold text-[var(--color-neutral-10)]">
                  更新邮箱连接凭据 / 密码
                </h3>
                <p className="text-xs text-[var(--color-neutral-6)] leading-relaxed break-all">
                  目标邮箱：<span className="text-[var(--color-neutral-9)] font-medium">{editPasswordAccount.email}</span>
                </p>
              </div>
            </div>

            <div className="p-3 bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-lg text-xs space-y-1 text-[var(--color-neutral-7)]">
              <p className="flex items-center gap-1 font-medium text-[var(--color-neutral-9)]">
                💡 无损切换，保留数据
              </p>
              <p className="text-[11px] leading-relaxed text-[var(--color-neutral-6)]">
                更新密码只会更新底层的 IMAP 登录凭据；该邮箱已索引的 <b className="text-[var(--color-neutral-9)]">{editPasswordAccount.total_synced || 0}</b> 封邮件、联系人与数字资产数据将<b>完全保留</b>，绝不会被删除。
              </p>
            </div>

            <form onSubmit={handleSaveNewPassword} className="space-y-3 pt-1">
              <div>
                <label className="block text-xs font-medium text-[var(--color-neutral-8)] mb-1">
                  新应用专用密码 / 授权码
                </label>
                <input
                  type="password"
                  value={newAppPassword}
                  onChange={(e) => setNewAppPassword(e.target.value)}
                  placeholder="请输入新生成的 16 位应用密码"
                  required
                  autoFocus
                  className="w-full px-3 py-2 text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-neutral-9)] focus:outline-none focus:border-[var(--color-accent)] font-mono"
                />
              </div>

              {updatePasswordError && (
                <div className="p-2.5 rounded-md text-xs bg-rose-500/10 text-rose-600 border border-rose-500/20 leading-relaxed flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{updatePasswordError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={updatingPassword}
                  onClick={() => {
                    setEditPasswordAccount(null);
                    setNewAppPassword('');
                    setUpdatePasswordError(null);
                  }}
                  className="px-4 py-1.5 text-xs rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-subtle)] text-[var(--color-neutral-8)] transition-all cursor-pointer disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={updatingPassword || !newAppPassword.trim()}
                  className="px-4 py-1.5 text-xs rounded-md bg-[var(--color-accent)] hover:bg-[var(--color-accent)]/90 text-white font-medium shadow-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {updatingPassword ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>验证并保存中...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>验证并保存</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
