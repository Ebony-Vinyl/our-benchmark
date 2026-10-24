// preload：向渲染进程暴露安全 API
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ourbench', {
  // 窗口控制（无边框标题栏）
  winControl: (cmd) => ipcRenderer.send('win:control', cmd),
  onMaximizedChange: (cb) => {
    const h = (_e, v) => cb(v);
    ipcRenderer.on('win:maximized', h);
    return () => ipcRenderer.removeListener('win:maximized', h);
  },
  isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
  // Agent
  detectAgents: () => ipcRenderer.invoke('agents:detect'),
  mockModels: () => ipcRenderer.invoke('agents:mockModels'),
  // 题库
  listSuites: () => ipcRenderer.invoke('suites:list'),
  listIndexes: () => ipcRenderer.invoke('indexes:list'),
  downloadSuite: (id) => ipcRenderer.invoke('suites:download', id),
  deleteSuiteFull: (id) => ipcRenderer.invoke('suites:deleteFull', id),
  // 跑分
  startRun: (cfg) => ipcRenderer.invoke('run:start', cfg),
  cancelRun: (runId) => ipcRenderer.invoke('run:cancel', runId),
  onRunProgress: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on('run:progress', h);
    return () => ipcRenderer.removeListener('run:progress', h);
  },
  onRunStart: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on('run:start', h);
    return () => ipcRenderer.removeListener('run:start', h);
  },
  onRunDone: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on('run:done', h);
    return () => ipcRenderer.removeListener('run:done', h);
  },
  // 设置 / 历史
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  getHistory: () => ipcRenderer.invoke('history:get'),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  // 服务器
  serverHealth: () => ipcRenderer.invoke('server:health'),
  serverLeaderboard: (q) => ipcRenderer.invoke('server:leaderboard', q),
  serverUpload: (report) => ipcRenderer.invoke('server:upload', report),
  serverStats: () => ipcRenderer.invoke('server:stats'),
  serverThreads: (q) => ipcRenderer.invoke('server:threads', q),
  serverThread: (id) => ipcRenderer.invoke('server:thread', id),
  postThread: (p) => ipcRenderer.invoke('server:postThread', p),
  postReply: (p) => ipcRenderer.invoke('server:postReply', p),
  likeThread: (token, id) => ipcRenderer.invoke('server:likeThread', { token, id }),
  // 账号
  guestLogin: (nickname) => ipcRenderer.invoke('auth:guest', nickname),
  githubLoginUrl: () => ipcRenderer.invoke('auth:githubUrl'),
  githubCallback: (code) => ipcRenderer.invoke('auth:githubCallback', code),
  getMe: (token) => ipcRenderer.invoke('auth:me', token),
  getMyScores: (token) => ipcRenderer.invoke('auth:myScores', token),
  // 系统
  sysInfo: () => ipcRenderer.invoke('sys:info'),
  // 打开外部链接
  openExternal: (url) => ipcRenderer.invoke('util:openExternal', url),
});
