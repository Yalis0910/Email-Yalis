import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { 
  Users, 
  Shield, 
  Plus, 
  KeyRound, 
  Edit, 
  Trash2, 
  Check, 
  X, 
  Mail, 
  AlertCircle, 
  Search, 
  Lock, 
  Layers, 
  CheckCircle2,
  UserCheck,
  UserX,
  ShieldAlert,
  HelpCircle
} from 'lucide-react';

export default function RBACManagement() {
  const { user: currentUser, isSuperadmin, hasActionPermission } = useAuth();
  const [activeTab, setActiveTab] = useState('users'); // 'users' or 'groups'

  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [permissionsMeta, setPermissionsMeta] = useState({
    page_permissions: [],
    action_permissions: []
  });

  const [isLoading, setIsLoading] = useState(true);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [toastMessage, setToastMessage] = useState(null);

  // Modals state
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [userModalMode, setUserModalMode] = useState('create'); // 'create' or 'edit'
  const [editingUserId, setEditingUserId] = useState(null);
  const [userForm, setUserForm] = useState({
    username: '',
    password: '',
    display_name: '',
    group_id: '',
    account_ids: []
  });

  const [isResetPwdModalOpen, setIsResetPwdModalOpen] = useState(false);
  const [resetPwdUserId, setResetPwdUserId] = useState(null);
  const [resetPwdUsername, setResetPwdUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [groupModalMode, setGroupModalMode] = useState('create'); // 'create' or 'edit'
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [groupForm, setGroupForm] = useState({
    name: '',
    description: '',
    page_permissions: [],
    action_permissions: [],
    account_ids: []
  });

  const showToast = (msg, isError = false) => {
    setToastMessage({ text: msg, isError });
    setTimeout(() => setToastMessage(null), 4000);
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [usersData, groupsData, accountsData, metaData] = await Promise.all([
        api.listUsers(),
        api.listGroups(),
        api.getAccounts(),
        api.getPermissionsMeta()
      ]);
      setUsers(usersData || []);
      setGroups(groupsData || []);
      setAccounts(accountsData || []);
      setPermissionsMeta(metaData || { page_permissions: [], action_permissions: [] });
    } catch (err) {
      showToast(err.message || '加载组织权限数据失败', true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // ================= User Handlers =================
  const handleOpenCreateUser = () => {
    setUserModalMode('create');
    setEditingUserId(null);
    setUserForm({
      username: '',
      password: '',
      display_name: '',
      group_id: groups[0]?.id || '',
      account_ids: []
    });
    setIsUserModalOpen(true);
  };

  const handleOpenEditUser = (u) => {
    setUserModalMode('edit');
    setEditingUserId(u.id);
    setUserForm({
      username: u.username,
      password: '',
      display_name: u.display_name || '',
      group_id: u.group_id || '',
      account_ids: u.extra_account_ids || []
    });
    setIsUserModalOpen(true);
  };

  const handleSaveUser = async (e) => {
    e.preventDefault();
    try {
      if (userModalMode === 'create') {
        if (!userForm.username.trim() || !userForm.password) {
          showToast('请填写完整的用户名和初始密码', true);
          return;
        }
        await api.createUser({
          username: userForm.username.trim(),
          password: userForm.password,
          display_name: userForm.display_name.trim(),
          group_id: userForm.group_id || null,
          account_ids: userForm.account_ids
        });
        showToast(`新用户 [${userForm.username}] 创建成功`);
      } else {
        await api.updateUser(editingUserId, {
          display_name: userForm.display_name.trim(),
          group_id: userForm.group_id || null,
          account_ids: userForm.account_ids
        });
        showToast('用户信息已成功更新');
      }
      setIsUserModalOpen(false);
      await loadData();
    } catch (err) {
      showToast(err.message || '保存用户失败', true);
    }
  };

  const handleToggleUserStatus = async (u) => {
    if (u.is_superadmin) {
      showToast('超级管理员账号不可停用', true);
      return;
    }
    try {
      await api.updateUser(u.id, {
        display_name: u.display_name,
        group_id: u.group_id,
        is_active: !u.is_active,
        account_ids: u.extra_account_ids
      });
      showToast(`用户 [${u.username}] 状态已切换为 ${!u.is_active ? '启用' : '停用'}`);
      await loadData();
    } catch (err) {
      showToast(err.message || '更新状态失败', true);
    }
  };

  const handleDeleteUser = async (u) => {
    if (u.is_superadmin) {
      showToast('超级管理员账号受保护，不可删除', true);
      return;
    }
    if (u.id === currentUser?.id) {
      showToast('不可删除当前正在登录的账号', true);
      return;
    }
    if (!window.confirm(`确定要永久删除用户 [${u.username}] 吗？此操作无法撤销。`)) {
      return;
    }
    try {
      await api.deleteUser(u.id);
      showToast(`用户 [${u.username}] 已成功删除`);
      await loadData();
    } catch (err) {
      showToast(err.message || '删除用户失败', true);
    }
  };

  const handleOpenResetPassword = (u) => {
    setResetPwdUserId(u.id);
    setResetPwdUsername(u.username);
    setNewPassword('');
    setIsResetPwdModalOpen(true);
  };

  const handleSaveResetPassword = async (e) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 4) {
      showToast('新密码长度不能少于 4 位字符', true);
      return;
    }
    try {
      await api.resetUserPassword(resetPwdUserId, newPassword);
      showToast(`用户 [${resetPwdUsername}] 的密码已重置`);
      setIsResetPwdModalOpen(false);
    } catch (err) {
      showToast(err.message || '重置密码失败', true);
    }
  };

  // ================= Group Handlers =================
  const handleOpenCreateGroup = () => {
    setGroupModalMode('create');
    setEditingGroupId(null);
    setGroupForm({
      name: '',
      description: '',
      page_permissions: ['page:dashboard', 'page:emails'],
      action_permissions: ['action:sync_trigger'],
      account_ids: []
    });
    setIsGroupModalOpen(true);
  };

  const handleOpenEditGroup = (g) => {
    setGroupModalMode('edit');
    setEditingGroupId(g.id);
    setGroupForm({
      name: g.name,
      description: g.description || '',
      page_permissions: g.page_permissions || [],
      action_permissions: g.action_permissions || [],
      account_ids: g.account_ids || []
    });
    setIsGroupModalOpen(true);
  };

  const handleSaveGroup = async (e) => {
    e.preventDefault();
    if (!groupForm.name.trim()) {
      showToast('请填写管理组名称', true);
      return;
    }
    try {
      if (groupModalMode === 'create') {
        await api.createGroup({
          name: groupForm.name.trim(),
          description: groupForm.description.trim(),
          page_permissions: groupForm.page_permissions,
          action_permissions: groupForm.action_permissions,
          account_ids: groupForm.account_ids
        });
        showToast(`管理组 [${groupForm.name}] 创建成功`);
      } else {
        await api.updateGroup(editingGroupId, {
          name: groupForm.name.trim(),
          description: groupForm.description.trim(),
          page_permissions: groupForm.page_permissions,
          action_permissions: groupForm.action_permissions,
          account_ids: groupForm.account_ids
        });
        showToast('管理组配置已成功保存');
      }
      setIsGroupModalOpen(false);
      await loadData();
    } catch (err) {
      showToast(err.message || '保存管理组失败', true);
    }
  };

  const handleDeleteGroup = async (g) => {
    if (g.id === 'group_superadmin') {
      showToast('系统超级管理组不可删除', true);
      return;
    }
    if (!window.confirm(`确定要删除管理组 [${g.name}] 吗？组内成员将变更为未分配组状态。`)) {
      return;
    }
    try {
      await api.deleteGroup(g.id);
      showToast(`管理组 [${g.name}] 已删除`);
      await loadData();
    } catch (err) {
      showToast(err.message || '删除管理组失败', true);
    }
  };

  const togglePagePermission = (key) => {
    setGroupForm(prev => {
      const exists = prev.page_permissions.includes(key);
      return {
        ...prev,
        page_permissions: exists
          ? prev.page_permissions.filter(k => k !== key)
          : [...prev.page_permissions, key]
      };
    });
  };

  const toggleActionPermission = (key) => {
    setGroupForm(prev => {
      const exists = prev.action_permissions.includes(key);
      return {
        ...prev,
        action_permissions: exists
          ? prev.action_permissions.filter(k => k !== key)
          : [...prev.action_permissions, key]
      };
    });
  };

  const toggleGroupAccount = (accId) => {
    setGroupForm(prev => {
      const exists = prev.account_ids.includes(accId);
      return {
        ...prev,
        account_ids: exists
          ? prev.account_ids.filter(id => id !== accId)
          : [...prev.account_ids, accId]
      };
    });
  };

  const toggleUserAccount = (accId) => {
    setUserForm(prev => {
      const exists = prev.account_ids.includes(accId);
      return {
        ...prev,
        account_ids: exists
          ? prev.account_ids.filter(id => id !== accId)
          : [...prev.account_ids, accId]
      };
    });
  };

  const filteredUsers = users.filter(u => {
    if (!searchKeyword.trim()) return true;
    const q = searchKeyword.toLowerCase();
    return (
      u.username.toLowerCase().includes(q) ||
      (u.display_name && u.display_name.toLowerCase().includes(q)) ||
      (u.group_name && u.group_name.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--color-border)] pb-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-serif font-semibold text-[var(--color-neutral-10)]">
                组织与权限控制
              </h1>
              <p className="text-xs text-[var(--color-neutral-6)] mt-0.5">
                管理系统账号密码、划分角色管理组、设置细粒度操作权限及分配邮箱数据资产
              </p>
            </div>
          </div>
        </div>

        {/* Tab switcher buttons */}
        <div className="flex items-center p-1 rounded-xl bg-[var(--color-surface-subtle)] border border-[var(--color-border)]">
          <button
            onClick={() => setActiveTab('users')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'users'
                ? 'bg-[var(--color-surface)] text-[var(--color-neutral-10)] shadow-xs font-semibold'
                : 'text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)]'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>用户成员 ({users.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('groups')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'groups'
                ? 'bg-[var(--color-surface)] text-[var(--color-neutral-10)] shadow-xs font-semibold'
                : 'text-[var(--color-neutral-6)] hover:text-[var(--color-neutral-9)]'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>管理组配置 ({groups.length})</span>
          </button>
        </div>
      </div>

      {/* Toast message alert */}
      {toastMessage && (
        <div className={`p-3 rounded-lg text-xs flex items-center gap-2.5 animate-in fade-in slide-in-from-top-2 duration-200 border ${
          toastMessage.isError
            ? 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400'
            : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
        }`}>
          {toastMessage.isError ? <AlertCircle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* ==================== TAB 1: USERS LIST ==================== */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          {/* Action Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-[var(--color-neutral-5)]" />
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="搜索账号名、姓名或所属组..."
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] text-[var(--color-neutral-10)] placeholder-[var(--color-neutral-5)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30"
              />
            </div>

            <button
              onClick={handleOpenCreateUser}
              className="yohaku-btn-primary flex items-center justify-center space-x-1.5 text-xs px-3.5 py-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>添加用户成员</span>
            </button>
          </div>

          {/* Users Table */}
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[var(--color-surface-subtle)]/70 border-b border-[var(--color-border)] text-[var(--color-neutral-6)] font-mono text-[11px] uppercase tracking-wider">
                    <th className="px-4 py-3">账号标识</th>
                    <th className="px-4 py-3">姓名/备注</th>
                    <th className="px-4 py-3">所属管理组</th>
                    <th className="px-4 py-3">特批私有邮箱</th>
                    <th className="px-4 py-3">状态</th>
                    <th className="px-4 py-3">创建时间</th>
                    <th className="px-4 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {isLoading ? (
                    <tr>
                      <td colSpan="7" className="px-4 py-12 text-center text-[var(--color-neutral-5)]">
                        <div className="flex items-center justify-center space-x-2">
                          <div className="w-4 h-4 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
                          <span>加载用户列表中...</span>
                        </div>
                      </td>
                    </tr>
                  ) : filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="px-4 py-12 text-center text-[var(--color-neutral-5)]">
                        未匹配到任何用户成员
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((u) => {
                      const isSelf = u.id === currentUser?.id;
                      return (
                        <tr key={u.id} className="hover:bg-[var(--color-surface-subtle)]/50 transition-colors">
                          <td className="px-4 py-3 font-mono font-medium text-[var(--color-neutral-9)]">
                            <div className="flex items-center space-x-2">
                              <span>{u.username}</span>
                              {u.is_superadmin ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-sans font-semibold bg-amber-500/10 text-amber-600 border border-amber-500/20">
                                  超管
                                </span>
                              ) : null}
                              {isSelf && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-sans bg-indigo-500/10 text-indigo-600 border border-indigo-500/20">
                                  当前登录
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="px-4 py-3 text-[var(--color-neutral-8)]">
                            {u.display_name || '—'}
                          </td>

                          <td className="px-4 py-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[var(--color-neutral-8)]">
                              {u.group_name || '未分配'}
                            </span>
                          </td>

                          <td className="px-4 py-3 text-[var(--color-neutral-6)]">
                            {u.is_superadmin ? (
                              <span className="text-[11px] text-amber-600 font-mono">全量邮箱访问</span>
                            ) : u.extra_account_ids && u.extra_account_ids.length > 0 ? (
                              <span className="inline-flex items-center space-x-1 font-mono text-[11px] text-[var(--color-accent)]">
                                <Mail className="w-3 h-3" />
                                <span>特批 {u.extra_account_ids.length} 个邮箱</span>
                              </span>
                            ) : (
                              <span className="text-[11px] text-[var(--color-neutral-4)]">仅继承组邮箱</span>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            {u.is_active ? (
                              <span className="inline-flex items-center space-x-1 text-emerald-600 text-[11px]">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                <span>正常</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center space-x-1 text-rose-500 text-[11px]">
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                                <span>已停用</span>
                              </span>
                            )}
                          </td>

                          <td className="px-4 py-3 font-mono text-[11px] text-[var(--color-neutral-5)]">
                            {(u.created_at || '').substring(0, 10)}
                          </td>

                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end space-x-1.5">
                              {/* Reset Password */}
                              <button
                                onClick={() => handleOpenResetPassword(u)}
                                className="p-1 rounded text-[var(--color-neutral-6)] hover:text-amber-600 hover:bg-amber-500/10 transition-colors"
                                title="重置登录密码"
                              >
                                <KeyRound className="w-3.5 h-3.5" />
                              </button>

                              {/* Edit */}
                              <button
                                onClick={() => handleOpenEditUser(u)}
                                className="p-1 rounded text-[var(--color-neutral-6)] hover:text-[var(--color-accent)] hover:bg-[var(--color-surface-subtle)] transition-colors"
                                title="编辑成员信息与特批邮箱"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </button>

                              {/* Toggle active / disabled */}
                              {!u.is_superadmin && (
                                <button
                                  onClick={() => handleToggleUserStatus(u)}
                                  className={`p-1 rounded transition-colors ${
                                    u.is_active 
                                      ? 'text-[var(--color-neutral-6)] hover:text-rose-500 hover:bg-rose-500/10' 
                                      : 'text-[var(--color-neutral-6)] hover:text-emerald-500 hover:bg-emerald-500/10'
                                  }`}
                                  title={u.is_active ? '停用此用户' : '启用此用户'}
                                >
                                  {u.is_active ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                                </button>
                              )}

                              {/* Delete */}
                              {!u.is_superadmin && !isSelf && (
                                <button
                                  onClick={() => handleDeleteUser(u)}
                                  className="p-1 rounded text-[var(--color-neutral-6)] hover:text-rose-600 hover:bg-rose-500/10 transition-colors"
                                  title="删除用户"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB 2: GROUPS & PERMISSIONS ==================== */}
      {activeTab === 'groups' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--color-neutral-6)]">
              创建管理组后，可统一为组内成员分配页面可见范围、敏感操作权限以及可访问的邮箱列表。
            </p>
            <button
              onClick={handleOpenCreateGroup}
              className="yohaku-btn-primary flex items-center space-x-1.5 text-xs px-3.5 py-1.5 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>新建管理组</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {groups.map((g) => {
              const isSuper = g.id === 'group_superadmin';
              const isDefaultGroup = ['group_superadmin', 'group_normal_admin', 'group_business_admin'].includes(g.id);
              return (
                <div
                  key={g.id}
                  className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 shadow-xs flex flex-col justify-between hover:border-[var(--color-accent)]/50 transition-all"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center space-x-2">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${
                          isSuper 
                            ? 'bg-amber-500' 
                            : g.id === 'group_normal_admin'
                              ? 'bg-blue-500'
                              : g.id === 'group_business_admin'
                                ? 'bg-emerald-500'
                                : 'bg-[var(--color-accent)]'
                        }`} />
                        <h3 className="text-sm font-semibold text-[var(--color-neutral-9)]">
                          {g.name}
                        </h3>
                        {isDefaultGroup && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 shrink-0">
                            系统内置
                          </span>
                        )}
                      </div>
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-[var(--color-surface-subtle)] text-[var(--color-neutral-6)] shrink-0">
                        {g.member_count} 位成员
                      </span>
                    </div>

                    <p className="text-xs text-[var(--color-neutral-6)] mb-4 line-clamp-2 min-h-[32px]">
                      {g.description || '暂无说明描述'}
                    </p>

                    {/* Permissions tags summary */}
                    <div className="space-y-2 pt-3 border-t border-[var(--color-border)]/60 text-xs">
                      <div>
                        <span className="text-[11px] text-[var(--color-neutral-5)] font-mono">开放页面：</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(g.page_permissions || []).slice(0, 5).map(pk => {
                            const found = permissionsMeta.page_permissions.find(p => p.key === pk);
                            return (
                              <span key={pk} className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--color-surface-subtle)] text-[var(--color-neutral-7)] border border-[var(--color-border)]">
                                {found ? found.label : pk.replace('page:', '')}
                              </span>
                            );
                          })}
                          {(g.page_permissions || []).length > 5 && (
                            <span className="text-[10px] text-[var(--color-neutral-5)]">
                              +{(g.page_permissions || []).length - 5}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="pt-1">
                        <span className="text-[11px] text-[var(--color-neutral-5)] font-mono">授权邮箱：</span>
                        <div className="mt-1">
                          {isSuper ? (
                            <span className="text-[11px] text-amber-600 font-mono">全量邮箱免配访问</span>
                          ) : (g.account_ids || []).length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {(g.account_ids || []).map(accId => {
                                const acc = accounts.find(a => a.id === accId);
                                return (
                                  <span key={accId} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-500/10 text-indigo-600 border border-indigo-500/20">
                                    {acc ? acc.email : accId}
                                  </span>
                                );
                              })}
                            </div>
                          ) : (
                            <span className="text-[11px] text-[var(--color-neutral-4)]">暂未分配任何邮箱</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-5 pt-3 border-t border-[var(--color-border)] flex items-center justify-end space-x-2">
                    <button
                      onClick={() => handleOpenEditGroup(g)}
                      className="px-2.5 py-1 text-xs rounded border border-[var(--color-border)] text-[var(--color-neutral-7)] hover:text-[var(--color-accent)] hover:bg-[var(--color-surface-subtle)] transition-colors"
                    >
                      配置权限与邮箱
                    </button>
                    {!isDefaultGroup && (
                      <button
                        onClick={() => handleDeleteGroup(g)}
                        className="p-1 rounded text-[var(--color-neutral-5)] hover:text-rose-600 hover:bg-rose-500/10 transition-colors"
                        title="删除管理组"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ==================== MODAL: ADD / EDIT USER ==================== */}
      {isUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Users className="w-4 h-4 text-[var(--color-accent)]" />
                <h2 className="text-sm font-semibold text-[var(--color-neutral-9)]">
                  {userModalMode === 'create' ? '添加新用户成员' : `编辑成员 [${userForm.username}]`}
                </h2>
              </div>
              <button
                onClick={() => setIsUserModalOpen(false)}
                className="p-1 rounded-md text-[var(--color-neutral-5)] hover:text-[var(--color-neutral-9)] hover:bg-[var(--color-surface-subtle)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="p-6 overflow-y-auto space-y-4 flex-1">
              {userModalMode === 'create' && (
                <div>
                  <label className="block text-xs font-medium text-[var(--color-neutral-7)] mb-1">
                    登录账号 (用户名) *
                  </label>
                  <input
                    type="text"
                    required
                    value={userForm.username}
                    onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
                    placeholder="例如: zhangsan, ops_user"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] text-[var(--color-neutral-9)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30 font-mono"
                  />
                </div>
              )}

              {userModalMode === 'create' && (
                <div>
                  <label className="block text-xs font-medium text-[var(--color-neutral-7)] mb-1">
                    初始密码 *
                  </label>
                  <input
                    type="password"
                    required
                    value={userForm.password}
                    onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                    placeholder="不少于 4 位字符"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] text-[var(--color-neutral-9)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30 font-mono"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-[var(--color-neutral-7)] mb-1">
                  姓名 / 显示备注
                </label>
                <input
                  type="text"
                  value={userForm.display_name}
                  onChange={(e) => setUserForm({ ...userForm, display_name: e.target.value })}
                  placeholder="例如: 张三 (运营部)"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] text-[var(--color-neutral-9)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--color-neutral-7)] mb-1">
                  所属管理组
                </label>
                <select
                  value={userForm.group_id}
                  onChange={(e) => setUserForm({ ...userForm, group_id: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] text-[var(--color-neutral-9)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30"
                >
                  <option value="">（未分配管理组）</option>
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                <p className="text-[11px] text-[var(--color-neutral-5)] mt-1">
                  用户将自动继承所选管理组的页面访问权限、操作权限以及组授权的邮箱列表。
                </p>
              </div>

              {/* Individual Extra Mailboxes Authorization */}
              <div className="pt-2 border-t border-[var(--color-border)]">
                <label className="block text-xs font-medium text-[var(--color-neutral-7)] mb-1">
                  个人额外特批邮箱 (选填)
                </label>
                <p className="text-[11px] text-[var(--color-neutral-5)] mb-2">
                  除了管理组拥有的邮箱外，您还可以勾选向此用户单独特批授权的专属邮箱：
                </p>

                {accounts.length === 0 ? (
                  <div className="p-3 text-center text-xs text-[var(--color-neutral-4)] bg-[var(--color-surface-subtle)] rounded-lg">
                    系统暂无已绑定的邮箱账号
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-36 overflow-y-auto p-2 rounded-lg bg-[var(--color-surface-subtle)] border border-[var(--color-border)]">
                    {accounts.map(acc => {
                      const isChecked = userForm.account_ids.includes(acc.id);
                      return (
                        <label
                          key={acc.id}
                          className="flex items-center space-x-2.5 p-1.5 rounded hover:bg-[var(--color-surface)] cursor-pointer text-xs transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleUserAccount(acc.id)}
                            className="rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]/30"
                          />
                          <span className="font-mono text-[var(--color-neutral-8)]">{acc.email}</span>
                          <span className="text-[10px] text-[var(--color-neutral-5)]">({acc.provider})</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-[var(--color-border)] flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsUserModalOpen(false)}
                  className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-[var(--color-border)] text-[var(--color-neutral-7)] hover:bg-[var(--color-surface-subtle)]"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="yohaku-btn-primary px-4 py-1.5 text-xs font-medium"
                >
                  {userModalMode === 'create' ? '创建用户' : '保存修改'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL: RESET PASSWORD ==================== */}
      {isResetPwdModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <KeyRound className="w-4 h-4 text-amber-500" />
                <h2 className="text-sm font-semibold text-[var(--color-neutral-9)]">
                  重置用户密码
                </h2>
              </div>
              <button
                onClick={() => setIsResetPwdModalOpen(false)}
                className="p-1 rounded-md text-[var(--color-neutral-5)] hover:text-[var(--color-neutral-9)] hover:bg-[var(--color-surface-subtle)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveResetPassword} className="p-6 space-y-4">
              <p className="text-xs text-[var(--color-neutral-6)]">
                正在为用户 <strong className="font-mono text-[var(--color-neutral-9)]">{resetPwdUsername}</strong> 设定新登录密码：
              </p>

              <div>
                <label className="block text-xs font-medium text-[var(--color-neutral-7)] mb-1">
                  新密码
                </label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="不少于 4 位字符"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] text-[var(--color-neutral-9)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30 font-mono"
                  autoFocus
                />
              </div>

              <div className="pt-3 border-t border-[var(--color-border)] flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsResetPwdModalOpen(false)}
                  className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-[var(--color-border)] text-[var(--color-neutral-7)] hover:bg-[var(--color-surface-subtle)]"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-medium rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition-colors"
                >
                  确认重置密码
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL: ADD / EDIT GROUP ==================== */}
      {isGroupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 max-h-[92vh] flex flex-col">
            <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Shield className="w-4 h-4 text-[var(--color-accent)]" />
                <h2 className="text-sm font-semibold text-[var(--color-neutral-9)]">
                  {groupModalMode === 'create' ? '新建权限管理组' : `配置管理组 [${groupForm.name}]`}
                </h2>
              </div>
              <button
                onClick={() => setIsGroupModalOpen(false)}
                className="p-1 rounded-md text-[var(--color-neutral-5)] hover:text-[var(--color-neutral-9)] hover:bg-[var(--color-surface-subtle)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveGroup} className="p-6 overflow-y-auto space-y-5 flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--color-neutral-7)] mb-1">
                    管理组名称 *
                  </label>
                  <input
                    type="text"
                    required
                    value={groupForm.name}
                    onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                    placeholder="例如: 业务运营组, 财务审计组"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] text-[var(--color-neutral-9)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--color-neutral-7)] mb-1">
                    职责描述
                  </label>
                  <input
                    type="text"
                    value={groupForm.description}
                    onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })}
                    placeholder="例如: 负责邮件检索与日常 AI 辅助分析"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] text-[var(--color-neutral-9)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30"
                  />
                </div>
              </div>

              {/* 1. Page permissions */}
              <div>
                <label className="block text-xs font-medium text-[var(--color-neutral-9)] mb-2 flex items-center justify-between">
                  <span>1. 页面访问权限 (导航菜单开放)</span>
                  <span className="text-[11px] text-[var(--color-neutral-5)] font-normal">勾选允许查看的功能页面</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {permissionsMeta.page_permissions.map(p => {
                    const isChecked = groupForm.page_permissions.includes(p.key);
                    return (
                      <div
                        key={p.key}
                        onClick={() => togglePagePermission(p.key)}
                        className={`p-2.5 rounded-lg border text-xs cursor-pointer select-none transition-all ${
                          isChecked
                            ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-medium shadow-2xs'
                            : 'border-[var(--color-border)] bg-[var(--color-paper)] text-[var(--color-neutral-7)] hover:border-[var(--color-neutral-4)]'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold">{p.label}</span>
                          <div className={`w-3.5 h-3.5 rounded flex items-center justify-center text-[10px] ${
                            isChecked ? 'bg-[var(--color-accent)] text-white' : 'border border-[var(--color-border)]'
                          }`}>
                            {isChecked && <Check className="w-2.5 h-2.5" />}
                          </div>
                        </div>
                        <p className="text-[10px] text-[var(--color-neutral-5)] line-clamp-2 leading-tight">
                          {p.desc}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 2. Action permissions */}
              <div>
                <label className="block text-xs font-medium text-[var(--color-neutral-9)] mb-2 flex items-center justify-between">
                  <span>2. 敏感操作权限 (动作开关控制)</span>
                  <span className="text-[11px] text-[var(--color-neutral-5)] font-normal">控制高风险或核心配置行为</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {permissionsMeta.action_permissions.map(a => {
                    const isChecked = groupForm.action_permissions.includes(a.key);
                    return (
                      <div
                        key={a.key}
                        onClick={() => toggleActionPermission(a.key)}
                        className={`p-2.5 rounded-lg border text-xs cursor-pointer select-none transition-all ${
                          isChecked
                            ? 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 font-medium shadow-2xs'
                            : 'border-[var(--color-border)] bg-[var(--color-paper)] text-[var(--color-neutral-7)] hover:border-[var(--color-neutral-4)]'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold">{a.label}</span>
                          <div className={`w-3.5 h-3.5 rounded flex items-center justify-center text-[10px] ${
                            isChecked ? 'bg-indigo-600 text-white' : 'border border-[var(--color-border)]'
                          }`}>
                            {isChecked && <Check className="w-2.5 h-2.5" />}
                          </div>
                        </div>
                        <p className="text-[10px] text-[var(--color-neutral-5)] leading-tight">
                          {a.desc}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 3. Group Mailbox Allocation */}
              <div>
                <label className="block text-xs font-medium text-[var(--color-neutral-9)] mb-2 flex items-center justify-between">
                  <span>3. 邮箱数据源授权 (数据隔离边界)</span>
                  <span className="text-[11px] text-[var(--color-neutral-5)] font-normal">组内成员可自动继承访问这些邮箱的数据</span>
                </label>
                
                {accounts.length === 0 ? (
                  <div className="p-3 text-center text-xs text-[var(--color-neutral-4)] bg-[var(--color-surface-subtle)] rounded-lg">
                    系统暂未连接任何邮箱账号
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto p-2 rounded-lg bg-[var(--color-surface-subtle)] border border-[var(--color-border)]">
                    {accounts.map(acc => {
                      const isChecked = groupForm.account_ids.includes(acc.id);
                      return (
                        <div
                          key={acc.id}
                          onClick={() => toggleGroupAccount(acc.id)}
                          className={`flex items-center space-x-2.5 p-2 rounded-lg border text-xs cursor-pointer transition-all ${
                            isChecked
                              ? 'border-emerald-500 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 font-medium'
                              : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-neutral-7)] hover:border-[var(--color-neutral-4)]'
                          }`}
                        >
                          <div className={`w-3.5 h-3.5 rounded flex items-center justify-center text-[10px] ${
                            isChecked ? 'bg-emerald-600 text-white' : 'border border-[var(--color-border)]'
                          }`}>
                            {isChecked && <Check className="w-2.5 h-2.5" />}
                          </div>
                          <div className="truncate flex-1">
                            <div className="font-mono truncate">{acc.email}</div>
                            <div className="text-[10px] text-[var(--color-neutral-5)] uppercase">{acc.provider}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-[var(--color-border)] flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsGroupModalOpen(false)}
                  className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-[var(--color-border)] text-[var(--color-neutral-7)] hover:bg-[var(--color-surface-subtle)]"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="yohaku-btn-primary px-4 py-1.5 text-xs font-medium"
                >
                  {groupModalMode === 'create' ? '立即创建管理组' : '保存管理组配置'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
