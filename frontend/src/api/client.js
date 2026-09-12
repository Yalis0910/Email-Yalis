/**
 * 动态获取后端 API 基础地址：
 * 1. 优先使用环境变量 VITE_API_BASE_URL（如果配置了自定义网关）
 * 2. 浏览器环境动态计算：
 *    - 如果页面本身就在 8008 端口打开（如后端一体化托管或网关反代），使用相对路径 ''
 *    - 其它端口（如 Vite 开发端口 5173、构建预览等），自动采用当前浏览器访问的主机名（局域网 IP / 域名 / localhost）和协议，并拼接后端端口 8008
 * 3. 兜底回退至相对路径 ''
 */
export function getBaseUrl() {
  if (import.meta.env.VITE_API_BASE_URL !== undefined && import.meta.env.VITE_API_BASE_URL !== '') {
    return import.meta.env.VITE_API_BASE_URL;
  }
  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location;
    if (port === '8008') {
      return '';
    }
    return `${protocol}//${hostname}:8008`;
  }
  return 'http://127.0.0.1:8008';
}

export const BASE_URL = getBaseUrl();

export async function request(endpoint, options = {}) {
  const url = `${getBaseUrl()}${endpoint}`;
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('email_yalis_token') : null;
  const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {};

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...options.headers,
    },
  });

  if (response.status === 401) {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('email_yalis_token');
      localStorage.removeItem('email_yalis_user');
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    }
    let errorMsg = '登录已过期或未授权，请重新登录';
    try {
      const err = await response.json();
      errorMsg = err.detail || errorMsg;
    } catch (_) {}
    throw new Error(errorMsg);
  }

  if (!response.ok) {
    let errorMsg = '网络请求错误';
    try {
      const err = await response.json();
      errorMsg = err.detail || err.message || errorMsg;
    } catch (_) {}
    throw new Error(errorMsg);
  }

  return response.json();
}

export const api = {
  // ================= User Auth & RBAC =================
  login: (username, password) => request('/api/users/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  }),
  getMe: () => request('/api/users/me'),
  changePassword: (old_password, new_password) => request('/api/users/change-password', {
    method: 'POST',
    body: JSON.stringify({ old_password, new_password })
  }),
  getPermissionsMeta: () => request('/api/users/rbac/permissions-meta'),
  listUsers: () => request('/api/users/list'),
  createUser: (data) => request('/api/users', {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  updateUser: (userId, data) => request(`/api/users/${userId}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  }),
  resetUserPassword: (userId, new_password) => request(`/api/users/${userId}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ new_password })
  }),
  deleteUser: (userId) => request(`/api/users/${userId}`, {
    method: 'DELETE'
  }),
  listGroups: () => request('/api/users/groups/list'),
  createGroup: (data) => request('/api/users/groups', {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  updateGroup: (groupId, data) => request(`/api/users/groups/${groupId}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  }),
  deleteGroup: (groupId) => request(`/api/users/groups/${groupId}`, {
    method: 'DELETE'
  }),

  // ================= Accounts & IMAP =================
  getAccounts: () => request('/api/auth/accounts'),
  deleteAccount: (id) => request(`/api/auth/accounts/${id}`, { method: 'DELETE' }),
  connectImap: (emailOrData, appPassword) => {
    let payload = {};
    if (typeof emailOrData === 'object') {
      payload = emailOrData;
    } else {
      payload = { email: emailOrData, app_password: appPassword };
    }
    return request('/api/auth/connect_imap', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  seedDemoData: () => request('/api/auth/seed_demo', { method: 'POST' }),

  // ================= Sync API =================
  triggerSync: (accountId, fullSync = false, maxResults = null, force = false) => request('/api/sync/trigger', {
    method: 'POST',
    body: JSON.stringify({ account_id: accountId, full_sync: fullSync, max_results: maxResults, force: force })
  }),
  triggerSyncAll: (force = false) => request(`/api/sync/trigger-all${force ? '?force=true' : ''}`, {
    method: 'POST'
  }),
  stopSync: (accountId) => request(`/api/sync/stop/${accountId}`, { method: 'POST' }),
  stopSyncAll: () => request('/api/sync/stop-all', { method: 'POST' }),
  getSyncStatus: (accountId) => request(`/api/sync/status/${accountId}`),
  getSyncStreamUrl: (accountId) => {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('email_yalis_token') : null;
    const param = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${getBaseUrl()}/api/sync/stream/${accountId}${param}`;
  },

  // ================= Auto-Sync API =================
  getAutoSyncSettings: () => request('/api/sync/auto-settings'),
  updateAutoSyncSettings: (enabled, intervalMinutes) => request('/api/sync/auto-settings', {
    method: 'POST',
    body: JSON.stringify({ auto_sync_enabled: enabled, auto_sync_interval_minutes: intervalMinutes })
  }),
  triggerAutoSyncNow: () => request('/api/sync/auto-trigger', { method: 'POST' }),

  // ================= Dashboard Overview =================
  getOverview: (accountId) => request(`/api/dashboard/overview${accountId ? `?account_id=${accountId}` : ''}`),

  // ================= Assets =================
  getDigitalAssets: (params = {}) => {
    return request(`/api/assets/digital${buildQuery(params)}`);
  },
  getDigitalAssetCategories: (accountId) => request(`/api/assets/categories${accountId ? `?account_id=${accountId}` : ''}`),
  getSubscriptions: (params = {}) => {
    return request(`/api/assets/subscriptions${buildQuery(params)}`);
  },
  getExportAssetsUrl: (accountId) => {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('email_yalis_token') : null;
    const q = new URLSearchParams();
    if (accountId) q.append('account_id', accountId);
    if (token) q.append('token', token);
    const qs = q.toString();
    return `${getBaseUrl()}/api/assets/export${qs ? `?${qs}` : ''}`;
  },

  // ================= Attachments =================
  getAttachments: (params = {}) => {
    return request(`/api/attachments${buildQuery(params)}`);
  },
  getAttachmentCategories: (accountId) => request(`/api/attachments/categories${accountId ? `?account_id=${accountId}` : ''}`),
  getAttachmentDetail: (id) => request(`/api/attachments/${id}`),
  getAttachmentPreviewUrl: (id) => {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('email_yalis_token') : null;
    return `${getBaseUrl()}/api/attachments/${id}/preview${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  },
  getAttachmentDownloadUrl: (id) => {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('email_yalis_token') : null;
    return `${getBaseUrl()}/api/attachments/${id}/download${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  },
  getAttachmentContent: (id) => request(`/api/attachments/${id}/content`),

  // ================= Contacts =================
  getContacts: (params = {}) => {
    return request(`/api/contacts${buildQuery(params)}`);
  },
  getContactsGraph: (accountId, limit = 35) => {
    return request(`/api/contacts/graph${buildQuery({ account_id: accountId, limit })}`);
  },
  getContactTimeline: (contactId, order = 'desc') => {
    return request(`/api/contacts/${contactId}/timeline?order=${order}`);
  },
  getSummarizedContacts: (accountId, sortBy = 'weight') => {
    return request(`/api/contacts/ai-reports/list${buildQuery({ account_id: accountId, sort_by: sortBy })}`);
  },
  getContactAIReport: (contactId) => {
    return request(`/api/contacts/${contactId}/ai-report`);
  },
  deleteContactAIReport: (contactId) => {
    return request(`/api/contacts/${contactId}/ai-report`, { method: 'DELETE' });
  },

  // ================= Emails & Search =================
  getEmails: (params = {}) => {
    return request(`/api/emails${buildQuery(params)}`);
  },
  getEmailDetail: (id) => request(`/api/emails/${id}`),

  // ================= AI API =================
  getAISettings: () => request('/api/ai/settings'),
  saveAISettings: (settings) => request('/api/ai/settings', {
    method: 'POST',
    body: JSON.stringify(settings)
  }),
  getAIPlatforms: () => request('/api/ai/platforms'),
  saveAIPlatforms: (data) => request('/api/ai/platforms', {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  fetchPlatformModels: (data) => request('/api/ai/platforms/fetch-models', {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  getEnabledAIModels: () => request('/api/ai/models/enabled'),
  testAIConnection: (data) => request('/api/ai/test', {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  getEmailAIInsights: (emailId) => request(`/api/ai/emails/${emailId}/insights`),
  scanAssetsWithAI: (accountId) => request('/api/ai/assets/scan', {
    method: 'POST',
    body: JSON.stringify({ account_id: accountId })
  }),
  getAIConversations: () => request('/api/ai/conversations'),
  createAIConversation: (dataOrTitle, contactId = null) => {
    const payload = typeof dataOrTitle === 'object' && dataOrTitle !== null
      ? dataOrTitle
      : { title: dataOrTitle, contact_id: contactId };
    return request('/api/ai/conversations', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  getAIConversation: (id) => request(`/api/ai/conversations/${id}`),
  updateAIConversation: (id, title) => request(`/api/ai/conversations/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ title })
  }),
  deleteAIConversation: (id) => request(`/api/ai/conversations/${id}`, {
    method: 'DELETE'
  }),
  compressAIConversation: (id) => request(`/api/ai/conversations/${id}/compress`, {
    method: 'POST'
  }),
  getAIConversationContextStats: (id, model = null) => request(
    `/api/ai/conversations/${id}/context-stats${model ? `?model=${encodeURIComponent(model)}` : ''}`
  )
};

export async function streamSSE(endpoint, body, { onChunk, onThinking, onReferences, onCached, onConversation, onToolStart, onToolResult, onCompressing, onCompressed, onContextStats, onError, onDone, signal } = {}) {
  try {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('email_yalis_token') : null;
    const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {};

    const response = await fetch(`${getBaseUrl()}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders
      },
      body: JSON.stringify(body || {}),
      signal
    });

    if (response.status === 401) {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('email_yalis_token');
        localStorage.removeItem('email_yalis_user');
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('auth:unauthorized'));
      }
      throw new Error('未授权或登录已失效，请重新登录');
    }

    if (!response.ok) {
      let errText = `HTTP 错误 ${response.status}`;
      try {
        const errJson = await response.json();
        errText = errJson.detail || errJson.message || errText;
      } catch (_) {}
      throw new Error(errText);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';

      for (const block of blocks) {
        for (const line of block.split('\n')) {
          const trimmed = line.trim();
          if (trimmed === 'data: [DONE]') {
            if (onDone) onDone();
            return;
          }
          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.substring(6));
              if (data.type === 'error' && onError) {
                onError(data.error);
              } else if (data.type === 'thinking' && onThinking) {
                onThinking(data.delta);
              } else if (data.type === 'chunk' && onChunk) {
                onChunk(data.delta);
              } else if (data.type === 'tool_start' && onToolStart) {
                onToolStart(data);
              } else if (data.type === 'tool_result' && onToolResult) {
                onToolResult(data);
              } else if (data.type === 'cached' && onCached) {
                onCached(data);
              } else if (data.type === 'references' && onReferences) {
                onReferences(data.references);
              } else if (data.type === 'conversation' && onConversation) {
                onConversation(data.conversation_id);
              } else if (data.type === 'compressing' && onCompressing) {
                onCompressing(data.message);
              } else if (data.type === 'compressed' && onCompressed) {
                onCompressed(data);
              } else if (data.type === 'context_stats' && onContextStats) {
                onContextStats(data.stats);
              }
            } catch (e) {
              console.error('SSE parse error:', e);
            }
          }
        }
      }
    }
    if (onDone) onDone();
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (onError) onError(err.message || '网络连接中断');
    if (onDone) onDone();
  }
}

function buildQuery(params = {}) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.append(key, value);
    }
  }
  const str = searchParams.toString();
  return str ? `?${str}` : '';
}
