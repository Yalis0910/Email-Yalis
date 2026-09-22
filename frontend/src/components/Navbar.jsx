import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, 
  Layers, 
  FileText, 
  Network, 
  Radar,
  Mail, 
  BookOpen,
  Settings as SettingsIcon,
  RefreshCw,
  Sun,
  Moon,
  Sparkles,
  Menu,
  X,
  Bot,
  Shield,
  User,
  LogOut,
  KeyRound,
  ChevronDown
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import ChangePasswordModal from './ChangePasswordModal';

export default function Navbar({ 
  activeTab, 
  setActiveTab, 
  accounts, 
  selectedAccount, 
  setSelectedAccount,
  onTriggerSync,
  isSyncing,
  isAutoSyncing,
  onSeedDemo,
  theme,
  setTheme
}) {
  const { user, logout, hasPagePermission, isSuperadmin } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const userMenuRef = useRef(null);

  const rawNavItems = [
    { id: 'dashboard', label: '总览看板', icon: LayoutDashboard },
    { id: 'assets', label: '账号资产', icon: Layers },
    { id: 'attachments', label: '附件中心', icon: FileText },
    { id: 'contacts', label: '人脉网络', icon: Network },
    { id: 'sales_playbook', label: '话术资料库', icon: BookOpen },
    { id: 'emails', label: '检索阅读', icon: Mail },
    { id: 'ai_copilot', label: 'AI 助手', icon: Bot },
    { id: 'settings', label: '配置授权', icon: SettingsIcon },
    { id: 'rbac', label: '组织权限', icon: Shield },
  ];

  // Dynamically filter nav items based on user's page permissions
  const navItems = rawNavItems.filter(item => hasPagePermission(item.id));

  // Click outside to close user dropdown
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Prevent scroll when mobile drawer is open & handle Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
        setUserMenuOpen(false);
      }
    };
    if (mobileMenuOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem('yohaku_theme', nextTheme);
  };

  const displayName = user?.display_name || user?.username || '用户';
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <>
      <header className="sticky top-0 z-40 backdrop-blur-md bg-[var(--color-paper)]/90 border-b border-[var(--color-border)] transition-colors duration-200 w-full">
        <div className="w-full px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-2">
            {/* Left side: Mobile Menu Button + Brand Logo */}
            <div className="flex items-center space-x-2 sm:space-x-3 shrink-0">
              {/* Mobile Drawer Hamburger Button */}
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="md:hidden p-1.5 -ml-1 rounded-md text-[var(--color-neutral-7)] hover:text-[var(--color-neutral-10)] hover:bg-[var(--color-surface-subtle)] focus:outline-none transition-colors"
                aria-label="打开侧边导航菜单"
                title="打开侧边导航菜单"
              >
                <Menu className="w-5 h-5" />
              </button>

              {/* Brand Logo in Yohaku Aesthetic */}
              <div 
                className="flex items-center space-x-2 sm:space-x-2.5 cursor-pointer group select-none"
                onClick={() => setActiveTab('dashboard')}
              >
                <img 
                  src="/ai-avatar.png" 
                  alt="Email-Yalis Logo" 
                  className="w-6 h-6 rounded-full object-cover ring-2 ring-[var(--color-accent-soft)] transition-transform group-hover:scale-110 shadow-2xs shrink-0" 
                />
                <span className="text-base sm:text-lg font-serif font-medium tracking-tight text-[var(--color-neutral-10)]">
                  Email-Yalis
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[var(--color-neutral-6)] leading-none transition-colors group-hover:border-[var(--color-accent-border)] group-hover:text-[var(--color-accent)] shrink-0">
                  v1.0.0
                </span>
              </div>
            </div>

            {/* Desktop Nav Links (Hidden on Mobile) */}
            <nav className="hidden md:flex items-center space-x-0.5 lg:space-x-1 xl:space-x-2 shrink-0">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`flex items-center space-x-1.5 px-2.5 lg:px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-all ${
                      isActive
                        ? 'text-[var(--color-accent)] bg-[var(--color-accent-soft)] font-semibold shadow-2xs'
                        : 'text-[var(--color-neutral-7)] hover:text-[var(--color-neutral-10)] hover:bg-[var(--color-surface-subtle)]'
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-neutral-5)]'}`} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Right side: Account selector + Sync + Theme + User Menu */}
            <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
              {/* Account Selector */}
              <select
                value={selectedAccount || ''}
                onChange={(e) => setSelectedAccount(e.target.value || null)}
                className="bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-neutral-8)] text-xs rounded-md px-2 py-1.5 outline-none hover:border-[var(--color-border-hover)] focus:border-[var(--color-accent)] transition-colors max-w-[95px] xs:max-w-[120px] sm:max-w-[170px] truncate font-mono"
              >
                <option value="">全部授权邮箱</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.display_name ? `${acc.display_name} (${acc.email})` : acc.email}
                  </option>
                ))}
              </select>

              {/* Auto Sync Background Badge */}
              {isAutoSyncing && !isSyncing && (
                <div 
                  className="hidden lg:flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 animate-pulse"
                  title="后台正在进行静默增量同步..."
                >
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  <span>后台自动同步中</span>
                </div>
              )}

              {/* Sync Button */}
              <button
                onClick={onTriggerSync}
                disabled={isSyncing || accounts.length === 0}
                className={`flex items-center space-x-1.5 px-2 sm:px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  isSyncing
                    ? 'bg-[var(--color-surface-subtle)] text-[var(--color-neutral-5)] cursor-not-allowed'
                    : 'yohaku-btn-primary'
                }`}
                title={selectedAccount ? "同步当前选中账号邮件与资产" : "一键全部同步所有已绑定账号"}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">
                  {isSyncing ? '同步中' : (selectedAccount ? '同步' : '全部同步')}
                </span>
              </button>

              {/* Demo Data Quick Button (if no accounts) */}
              {accounts.length === 0 && (
                <button
                  onClick={onSeedDemo}
                  className="hidden md:flex items-center space-x-1 px-2.5 py-1.5 rounded-md yohaku-btn-secondary text-xs"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                  <span>载入演示</span>
                </button>
              )}

              {/* Light / Dark Mode Toggle */}
              <button
                onClick={toggleTheme}
                className="p-1.5 rounded-md border border-[var(--color-border)] text-[var(--color-neutral-7)] hover:text-[var(--color-neutral-10)] hover:bg-[var(--color-surface-subtle)] transition-colors"
                title={theme === 'dark' ? '切换为和纸明色主题' : '切换为静墨暗色主题'}
              >
                {theme === 'dark' ? (
                  <Sun className="w-4 h-4" />
                ) : (
                  <Moon className="w-4 h-4" />
                )}
              </button>

              {/* User Profile Dropdown Menu */}
              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center space-x-1.5 p-1 sm:px-2 py-1 rounded-md border border-[var(--color-border)] text-xs text-[var(--color-neutral-8)] hover:bg-[var(--color-surface-subtle)] transition-colors"
                >
                  <div className="w-5 h-5 rounded-full bg-[var(--color-accent)] text-white flex items-center justify-center font-bold text-[10px] shadow-2xs">
                    {initial}
                  </div>
                  <span className="hidden md:inline font-medium max-w-[80px] truncate">
                    {displayName}
                  </span>
                  <ChevronDown className="w-3 h-3 text-[var(--color-neutral-5)]" />
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 mt-2 w-56 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl py-1.5 z-50 ring-1 ring-black/5 dark:ring-white/10 animate-in fade-in zoom-in-95 duration-150">
                    <div className="px-3.5 py-2 border-b border-[var(--color-border)]">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-semibold text-[var(--color-neutral-10)] truncate">
                          {displayName}
                        </span>
                        {isSuperadmin ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-600 border border-amber-500/20">
                            超管
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-[var(--color-neutral-5)] font-mono truncate mt-0.5">
                        {user?.group_name || '普通成员'}
                      </div>
                    </div>

                    <div className="py-1">
                      <button
                        onClick={() => {
                          setUserMenuOpen(false);
                          setIsChangePasswordOpen(true);
                        }}
                        className="w-full px-3.5 py-2 text-xs text-[var(--color-neutral-8)] hover:text-[var(--color-neutral-10)] hover:bg-[var(--color-surface-subtle)] flex items-center space-x-2 transition-colors text-left"
                      >
                        <KeyRound className="w-3.5 h-3.5 text-[var(--color-neutral-5)]" />
                        <span>修改登录密码</span>
                      </button>

                      {hasPagePermission('rbac') && (
                        <button
                          onClick={() => {
                            setUserMenuOpen(false);
                            setActiveTab('rbac');
                          }}
                          className="w-full px-3.5 py-2 text-xs text-[var(--color-neutral-8)] hover:text-[var(--color-neutral-10)] hover:bg-[var(--color-surface-subtle)] flex items-center space-x-2 transition-colors text-left"
                        >
                          <Shield className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                          <span>组织与权限管理</span>
                        </button>
                      )}
                    </div>

                    <div className="pt-1 border-t border-[var(--color-border)]">
                      <button
                        onClick={() => {
                          setUserMenuOpen(false);
                          logout();
                        }}
                        className="w-full px-3.5 py-2 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 flex items-center space-x-2 transition-colors text-left"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>退出当前账号</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Sidebar Overlay Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs md:hidden transition-opacity"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile Sidebar Drawer */}
      <aside
        className={`fixed top-0 left-0 bottom-0 w-64 max-w-[80vw] bg-[var(--color-paper)] border-r border-[var(--color-border)] z-50 flex flex-col justify-between shadow-2xl transition-all duration-300 ease-in-out md:hidden ${
          mobileMenuOpen ? 'translate-x-0 opacity-100 visible' : '-translate-x-full opacity-0 invisible pointer-events-none'
        }`}
        aria-label="移动端侧边导航"
      >
        {/* Drawer Header */}
        <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
          <div 
            className="flex items-center space-x-2.5 cursor-pointer"
            onClick={() => {
              setActiveTab('dashboard');
              setMobileMenuOpen(false);
            }}
          >
            <img 
              src="/ai-avatar.png" 
              alt="Email-Yalis Logo" 
              className="w-5 h-5 rounded-full object-cover ring-2 ring-[var(--color-accent-soft)] shrink-0" 
            />
            <span className="font-serif font-medium tracking-tight text-base text-[var(--color-neutral-10)]">
              Email-Yalis
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[var(--color-neutral-6)] leading-none shrink-0">
              v1.0.0
            </span>
          </div>
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="p-1.5 rounded-md text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-10)] hover:bg-[var(--color-surface-subtle)] transition-colors"
            aria-label="关闭导航"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Items List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <div className="px-2.5 py-1 text-[11px] uppercase tracking-wider text-[var(--color-neutral-5)] font-mono">
            导航菜单
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'text-[var(--color-accent)] bg-[var(--color-accent-soft)] font-semibold shadow-xs'
                    : 'text-[var(--color-neutral-7)] hover:text-[var(--color-neutral-10)] hover:bg-[var(--color-surface-subtle)]'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-neutral-5)]'}`} />
                <span className="truncate">{item.label}</span>
                {isActive && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
                )}
              </button>
            );
          })}
        </div>

        {/* Drawer Footer with User Info */}
        <div className="p-4 border-t border-[var(--color-border)] bg-[var(--color-surface)]/60 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 rounded-full bg-[var(--color-accent)] text-white flex items-center justify-center font-bold text-xs">
                {initial}
              </div>
              <div className="truncate max-w-[110px]">
                <div className="text-xs font-semibold text-[var(--color-neutral-9)] truncate">{displayName}</div>
                <div className="text-[10px] text-[var(--color-neutral-5)] font-mono">{user?.group_name || '成员'}</div>
              </div>
            </div>
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                setIsChangePasswordOpen(true);
              }}
              className="p-1 rounded text-[var(--color-neutral-6)] hover:bg-[var(--color-surface-subtle)]"
              title="修改密码"
            >
              <KeyRound className="w-4 h-4" />
            </button>
          </div>

          <div className="text-xs text-[var(--color-neutral-6)] flex items-center justify-between pt-2 border-t border-[var(--color-border)]/50">
            <span>当前邮箱</span>
            <span className="font-mono text-[var(--color-neutral-8)] truncate max-w-[130px]">
              {selectedAccount
                ? (accounts.find(a => a.id === selectedAccount)?.email || selectedAccount)
                : '全部授权邮箱'}
            </span>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border)]/50">
            <span className="text-xs text-[var(--color-neutral-6)]">外观主题</span>
            <button
              onClick={toggleTheme}
              className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md border border-[var(--color-border)] text-xs text-[var(--color-neutral-8)] hover:bg-[var(--color-surface-subtle)] transition-colors"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                  <span>和纸明色</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5 text-indigo-400" />
                  <span>静墨暗色</span>
                </>
              )}
            </button>
          </div>

          <button
            onClick={() => {
              setMobileMenuOpen(false);
              logout();
            }}
            className="w-full mt-2 py-1.5 rounded-lg border border-rose-500/20 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 flex items-center justify-center space-x-1.5 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>退出登录</span>
          </button>
        </div>
      </aside>

      {/* Change Password Modal */}
      <ChangePasswordModal
        isOpen={isChangePasswordOpen}
        onClose={() => setIsChangePasswordOpen(false)}
      />
    </>
  );
}
