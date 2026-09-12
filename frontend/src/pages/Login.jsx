import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Lock, User, ArrowRight, ShieldCheck, AlertCircle, Sparkles } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim()) {
      setError('请输入用户名');
      return;
    }
    if (!password) {
      setError('请输入登录密码');
      return;
    }

    try {
      setIsLoading(true);
      setError('');
      await login(username.trim(), password);
    } catch (err) {
      setError(err.message || '登录失败，请检查账号密码');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFillDemo = () => {
    setUsername('admin');
    setPassword('admin123');
    setError('');
  };

  return (
    <div className="min-h-screen bg-[var(--color-paper)] flex flex-col items-center justify-center p-4 sm:p-6 transition-colors duration-200">
      {/* Background Subtle Gradient Blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden flex items-center justify-center opacity-40">
        <div className="w-[500px] h-[500px] rounded-full bg-[var(--color-accent-soft)] blur-3xl -translate-y-24 translate-x-12" />
        <div className="w-[400px] h-[400px] rounded-full bg-indigo-500/5 blur-3xl translate-y-36 -translate-x-24" />
      </div>

      <div className="w-full max-w-md relative z-10 animate-in fade-in zoom-in-95 duration-300">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center space-x-3">
            <div className="w-3.5 h-3.5 rounded-full bg-[var(--color-accent)] ring-4 ring-[var(--color-accent-soft)]" />
            <span className="text-2xl font-serif font-medium tracking-tight text-[var(--color-neutral-10)]">
              Email-Yalis
            </span>
          </div>
        </div>

        {/* Login Card */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-xl shadow-black/5 p-6 sm:p-8 backdrop-blur-sm">
          <div className="mb-6 flex items-center justify-between border-b border-[var(--color-border)]/60 pb-4">
            <div>
              <h1 className="text-lg font-semibold text-[var(--color-neutral-9)]">
                账户登录
              </h1>
              <p className="text-xs text-[var(--color-neutral-6)] mt-0.5">
                请输入已分配的工号账号与口令凭证
              </p>
            </div>
            <div className="p-2 rounded-xl bg-[var(--color-surface-subtle)] text-[var(--color-accent)]">
              <ShieldCheck className="w-5 h-5" />
            </div>
          </div>

          {error && (
            <div className="mb-5 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs flex items-center gap-2.5 animate-in shake">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username Input */}
            <div>
              <label className="block text-xs font-medium text-[var(--color-neutral-7)] mb-1.5">
                账号 / 用户名
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[var(--color-neutral-5)]">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="例如: admin"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] text-[var(--color-neutral-10)] placeholder-[var(--color-neutral-5)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30 focus:border-[var(--color-accent)] transition-all font-mono"
                  autoFocus
                />
              </div>
            </div>

            {/* Password Input */}
            <div>
              <label className="block text-xs font-medium text-[var(--color-neutral-7)] mb-1.5">
                登录密码
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[var(--color-neutral-5)]">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] text-[var(--color-neutral-10)] placeholder-[var(--color-neutral-5)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30 focus:border-[var(--color-accent)] transition-all font-mono"
                />
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full mt-2 py-2.5 px-4 rounded-lg bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent)]/90 font-medium text-sm flex items-center justify-center space-x-2 shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>正在验证凭据...</span>
                </>
              ) : (
                <>
                  <span>安全登录</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Quick Demo Credentials Tip */}
          <div className="mt-6 pt-4 border-t border-[var(--color-border)]/60 flex items-center justify-between text-xs text-[var(--color-neutral-6)]">
            <span className="flex items-center gap-1.5 text-[11px]">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              初始超管: <code className="font-mono text-[var(--color-neutral-8)]">admin / admin123</code>
            </span>
            <button
              type="button"
              onClick={handleFillDemo}
              className="text-[11px] text-[var(--color-accent)] hover:underline font-medium cursor-pointer"
            >
              一键填入
            </button>
          </div>
        </div>

        {/* Footer info */}
        <p className="text-center text-[11px] text-[var(--color-neutral-5)] mt-6 font-mono">
          Email-Yalis RBAC · 企业内网封闭运行环境
        </p>
      </div>
    </div>
  );
}
