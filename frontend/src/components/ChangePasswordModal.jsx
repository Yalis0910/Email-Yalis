import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { X, Lock, CheckCircle2, AlertCircle } from 'lucide-react';

export default function ChangePasswordModal({ isOpen, onClose }) {
  const { changePassword } = useAuth();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!oldPassword) {
      setError('请输入当前密码');
      return;
    }
    if (newPassword.length < 4) {
      setError('新密码长度不能少于 4 位字符');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }

    try {
      setIsSubmitting(true);
      await changePassword(oldPassword, newPassword);
      setSuccess('密码修改成功，后续请使用新密码登录！');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        onClose();
        setSuccess('');
      }, 1500);
    } catch (err) {
      setError(err.message || '密码修改失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-[var(--color-surface-subtle)] text-[var(--color-accent)]">
              <Lock className="w-4 h-4" />
            </div>
            <h2 className="text-sm font-semibold text-[var(--color-neutral-9)]">
              修改个人登录密码
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[var(--color-neutral-5)] hover:text-[var(--color-neutral-9)] hover:bg-[var(--color-surface-subtle)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{success}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[var(--color-neutral-7)] mb-1">
              原登录密码
            </label>
            <input
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] text-[var(--color-neutral-9)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30 font-mono"
              placeholder="请输入当前密码"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--color-neutral-7)] mb-1">
              新登录密码
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] text-[var(--color-neutral-9)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30 font-mono"
              placeholder="不少于 4 位字符"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--color-neutral-7)] mb-1">
              确认新密码
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] text-[var(--color-neutral-9)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30 font-mono"
              placeholder="再次输入新密码"
            />
          </div>

          <div className="pt-3 border-t border-[var(--color-border)] flex items-center justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-[var(--color-border)] text-[var(--color-neutral-7)] hover:bg-[var(--color-surface-subtle)] transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent)]/90 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? '正在修改...' : '确认更新密码'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
