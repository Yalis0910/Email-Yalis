import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => {
    return localStorage.getItem('email_yalis_token') || null;
  });

  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('email_yalis_user');
      return saved ? JSON.parse(saved) : null;
    } catch (_) {
      return null;
    }
  });

  const [isLoading, setIsLoading] = useState(true);

  const logout = useCallback(() => {
    localStorage.removeItem('email_yalis_token');
    localStorage.removeItem('email_yalis_user');
    setToken(null);
    setUser(null);
  }, []);

  const refreshUserProfile = useCallback(async () => {
    try {
      const me = await api.getMe();
      setUser(me);
      localStorage.setItem('email_yalis_user', JSON.stringify(me));
      return me;
    } catch (err) {
      console.warn('Failed to refresh user profile:', err);
      // If 401, token is invalid
      if (err.message && err.message.includes('401')) {
        logout();
      }
      return null;
    }
  }, [logout]);

  useEffect(() => {
    const initAuth = async () => {
      const savedToken = localStorage.getItem('email_yalis_token');
      if (savedToken) {
        setToken(savedToken);
        await refreshUserProfile();
      }
      setIsLoading(false);
    };

    initAuth();

    // Listen for unauthorized 401 events dispatched from client.js
    const handleUnauthorized = () => {
      logout();
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, [logout, refreshUserProfile]);

  const login = async (username, password) => {
    const res = await api.login(username, password);
    if (res.token && res.user) {
      localStorage.setItem('email_yalis_token', res.token);
      localStorage.setItem('email_yalis_user', JSON.stringify(res.user));
      setToken(res.token);
      setUser(res.user);
      return res.user;
    }
    throw new Error('登录响应数据不完整');
  };

  const changePassword = async (oldPassword, newPassword) => {
    const res = await api.changePassword(oldPassword, newPassword);
    return res;
  };

  const isSuperadmin = Boolean(user && user.is_superadmin);

  const hasPagePermission = useCallback((pageKey) => {
    if (!user) return false;
    if (user.is_superadmin) return true;
    const keyWithPrefix = pageKey.startsWith('page:') ? pageKey : `page:${pageKey}`;
    return (user.page_permissions || []).includes(keyWithPrefix);
  }, [user]);

  const hasActionPermission = useCallback((actionKey) => {
    if (!user) return false;
    if (user.is_superadmin) return true;
    const keyWithPrefix = actionKey.startsWith('action:') ? actionKey : `action:${actionKey}`;
    return (user.action_permissions || []).includes(keyWithPrefix);
  }, [user]);

  const value = {
    token,
    user,
    isAuthenticated: Boolean(token && user),
    isLoading,
    isSuperadmin,
    authorizedAccounts: user?.authorized_accounts,
    login,
    logout,
    refreshUserProfile,
    changePassword,
    hasPagePermission,
    hasActionPermission
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
