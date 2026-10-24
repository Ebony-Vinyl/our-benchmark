// 服务器 API 客户端：榜单 / 上传 / 论坛 / 账号
// 用 node:http 直连（绕过 Chromium fetch 的系统代理劫持）
const { requestJson } = require('./httpx');

function baseUrl(settings) {
  return (settings.useProductionServer ? settings.productionServerUrl : settings.serverUrl).replace(/\/+$/, '');
}

async function api(settings, path, opts = {}) {
  const url = baseUrl(settings) + path;
  const headers = { 'Content-Type': 'application/json' };
  if (settings._token) headers.Authorization = 'Bearer ' + settings._token;
  const doReq = () => requestJson(url, {
    method: opts.method || 'GET',
    headers: { ...headers, ...(opts.headers || {}) },
    body: opts.body != null ? opts.body : undefined,
    timeoutMs: opts.timeoutMs || 20000,
  });
  let res;
  try {
    res = await doReq();
  } catch (e) {
    // 跨境网络抖动：GET 幂等请求自动重试一次
    if ((opts.method || 'GET') === 'GET' && opts.body == null) {
      res = await doReq();
    } else throw e;
  }
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(res.data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.data;
}

function client(getSettings) {
  return {
    health: () => api(getSettings(), '/api/v1/health'),
    getLeaderboard: (query = '') => api(getSettings(), '/api/v1/leaderboard' + (query ? '?' + query : '')),
    getSuites: () => api(getSettings(), '/api/v1/datasets'),
    uploadScore: (payload) => api(getSettings(), '/api/v1/scores', { method: 'POST', body: payload, timeoutMs: 30000 }),
    getScore: (id) => api(getSettings(), '/api/v1/scores/' + id),
    getMyScores: (token) => api({ ...getSettings(), _token: token }, '/api/v1/me/scores'),
    // 论坛
    listThreads: (q = '') => api(getSettings(), '/api/v1/forum/threads' + (q ? '?' + q : '')),
    getThread: (id) => api(getSettings(), '/api/v1/forum/threads/' + id),
    createThread: (token, body) => api({ ...getSettings(), _token: token }, '/api/v1/forum/threads', { method: 'POST', body }),
    createPost: (token, threadId, body) => api({ ...getSettings(), _token: token }, '/api/v1/forum/threads/' + threadId + '/posts', { method: 'POST', body }),
    likeThread: (token, id) => api({ ...getSettings(), _token: token }, '/api/v1/forum/threads/' + id + '/like', { method: 'POST' }),
    // 账号（GitHub OAuth / 访客）
    guestLogin: (nickname) => api(getSettings(), '/api/v1/auth/guest', { method: 'POST', body: { nickname } }),
    getGithubLoginUrl: () => api(getSettings(), '/api/v1/auth/github/url'),
    exchangeGithubCode: (code) => api(getSettings(), '/api/v1/auth/github/callback?code=' + encodeURIComponent(code)),
    getMe: (token) => api({ ...getSettings(), _token: token }, '/api/v1/me'),
    // 统计
    getStats: () => api(getSettings(), '/api/v1/stats'),
  };
}

module.exports = { client, baseUrl };
