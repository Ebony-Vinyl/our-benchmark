// IPC 路由：渲染进程 <-> 主进程
const { ipcMain, BrowserWindow, shell } = require('electron');
const os = require('os');
const crypto = require('crypto');
const { detectAgents } = require('./detection/agent-detector');
const { MockAdapter, CliAdapter, OpenAICompatAdapter } = require('./adapters/adapters');
const { loadSuites } = require('./bench/suites');
const { runBenchmark, cancelRun } = require('./bench/runner');
const store = require('./store');
const { client } = require('./net/client');
const { KNOWN_AGENTS } = require('./detection/agent-detector');

function broadcast(event, payload) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(event, payload);
}

function registerIpc() {
  // ---------------- Agent 检测 ----------------
  ipcMain.handle('agents:detect', async () => {
    const agents = await detectAgents();
    // 附加内置 Mock Agent（永远可用，零成本）
    const mocks = [
      { id: 'mock', name: '内置模拟 Agent（不消耗 API）', vendor: 'Our Benchmark', kind: 'mock', detected: true, runnable: true, evidence: ['内置 Mock 引擎，确定性模拟'], builtin: true },
    ];
    return [...agents, ...mocks];
  });

  ipcMain.handle('agents:mockModels', () => ([
    { id: 'gpt-5.3', label: 'Mock · GPT-5.3 (旗舰档)' },
    { id: 'claude-opus-4.5', label: 'Mock · Claude Opus 4.5 (旗舰档)' },
    { id: 'glm-5.3', label: 'Mock · GLM-5.3 (旗舰档)' },
    { id: 'gemini-3-pro', label: 'Mock · Gemini 3 Pro (高端档)' },
    { id: 'deepseek-v4', label: 'Mock · DeepSeek V4 (高端档)' },
    { id: 'qwen3.5-max', label: 'Mock · Qwen3.5 Max (高端档)' },
    { id: 'llama-4-70b', label: 'Mock · Llama 4 70B (中端档)' },
    { id: 'mistral-large-3', label: 'Mock · Mistral Large 3 (中端档)' },
    { id: 'glm-4-flash', label: 'Mock · GLM-4-Flash (入门档)' },
    { id: 'random-rookie', label: 'Mock · Rookie-7B (入门档)' },
  ]));

  // ---------------- 题库 ----------------
  ipcMain.handle('suites:list', () => loadSuites());
  ipcMain.handle('indexes:list', () => {
    const { INDEXES, PROPRIETARY_EVALS } = require('./bench/indexes');
    return { INDEXES, PROPRIETARY_EVALS };
  });
  ipcMain.handle('suites:download', async (_e, suiteId) => {
    const { downloadFullSuite } = require('./bench/suites');
    const { baseUrl } = require('./net/client');
    const url = baseUrl(store.getSettings()) + '/api/v1/datasets/' + encodeURIComponent(suiteId);
    return downloadFullSuite(suiteId, url);
  });
  ipcMain.handle('suites:deleteFull', (_e, suiteId) => {
    const { deleteLocalFull } = require('./bench/suites');
    return deleteLocalFull(suiteId);
  });

  // ---------------- 跑分 ----------------
  ipcMain.handle('run:start', async (_e, cfg) => {
    const settings = store.getSettings();
    let adapter, agentName = cfg.agentName || 'Mock Agent', modelName = cfg.model || 'mock-model';

    if (cfg.mode === 'real') {
      // 真实模式：多重闸门，防误触花钱
      if (!settings.realModeUnlocked || settings.unlockAcknowledge !== 'I-UNDERSTAND-THE-COST') {
        throw new Error('真实模式未解锁：请在设置页解锁并确认费用自负');
      }
      if (cfg.realBackend === 'cli') {
        const spec = KNOWN_AGENTS.find(a => a.id === settings.cliAgentId);
        if (!spec) throw new Error('未选择 CLI Agent');
        const { detectAgents: det } = require('./detection/agent-detector');
        const found = (await det()).find(a => a.id === spec.id);
        adapter = new CliAdapter({ ...spec, binaryPath: found?.binaryPath }, cfg.model || spec.defaultModel);
      } else {
        if (!settings.apiBaseUrl || !settings.apiKey || !settings.apiModel) throw new Error('API 配置不完整');
        adapter = new OpenAICompatAdapter(settings.apiBaseUrl, settings.apiKey, settings.apiModel);
      }
    } else {
      // Mock 模式：确定性模拟
      adapter = new MockAdapter(cfg.agentId || 'mock', modelName);
    }

    const report = await runBenchmark({
      adapter, agentName, modelName,
      suiteIds: cfg.suiteIds,
      sampleSize: cfg.sampleSize ?? settings.sampleSize,
      concurrency: cfg.concurrency ?? settings.concurrency,
      sandboxEnabled: cfg.sandboxEnabled ?? settings.sandboxEnabled,
      emit: broadcast,
    });
    store.addHistory(report);
    return report;
  });

  ipcMain.handle('run:cancel', (_e, runId) => cancelRun(runId));

  // ---------------- 设置 / 历史 ----------------
  ipcMain.handle('settings:get', () => {
    const s = store.getSettings();
    if (s.apiKey) s.apiKeyMasked = s.apiKey.slice(0, 6) + '***' + s.apiKey.slice(-4), delete s.apiKey;
    return s;
  });
  ipcMain.handle('settings:set', (_e, patch) => {
    if (patch.apiKeyMasked) delete patch.apiKeyMasked; // 屏蔽值不回写
    return store.setSettings(patch);
  });
  ipcMain.handle('history:get', () => store.getHistory());
  ipcMain.handle('history:clear', () => store.clearHistory());

  // ---------------- 服务器 API ----------------
  const api = client(() => store.getSettings());
  ipcMain.handle('server:health', () => api.health());
  ipcMain.handle('server:leaderboard', (_e, q) => api.getLeaderboard(q || ''));
  ipcMain.handle('server:upload', (_e, report) => api.uploadScore({
    agent: report.agentName,
    model: report.modelName,
    mock: report.mock,
    totalScore: report.summary.totalScore,
    intelligenceIndex: report.summary.intelligenceIndex,
    accuracyOverall: report.summary.accuracyOverall,
    categories: report.summary.categories,
    suites: Object.fromEntries(Object.entries(report.suites).map(([k, v]) => [k, { accuracy: v.accuracy, graded: v.graded, correct: v.correct }])),
    host: report.host,
    runId: report.runId,
    finishedAt: report.finishedAt,
  }));
  ipcMain.handle('server:stats', () => api.getStats());
  ipcMain.handle('server:threads', (_e, q) => api.listThreads(q || ''));
  ipcMain.handle('server:thread', (_e, id) => api.getThread(id));
  ipcMain.handle('server:token', (_e, { key, val }) => {
    // token 存设置里（会话级）
    const s = store.getSettings();
    if (key === 'clear') { delete s._token; } else { s._token = val; }
    store.setSettings(s);
    return true;
  });
  ipcMain.handle('server:postThread', async (_e, { token, body }) => {
    const s = { ...store.getSettings(), _token: token };
    return require('./net/client').client(() => s).createThread(token, body);
  });
  ipcMain.handle('server:postReply', async (_e, { token, threadId, body }) => {
    const s = { ...store.getSettings(), _token: token };
    return require('./net/client').client(() => s).createPost(token, threadId, body);
  });
  ipcMain.handle('server:like', async (_e, { token, id }) => {
    const s = { ...store.getSettings(), _token: token };
    return require('./net/client').client(() => s).likeThread(id === undefined ? token : id, id);
  });
  ipcMain.handle('server:likeThread', async (_e, { token, id }) => {
    const s = { ...store.getSettings(), _token: token };
    return require('./net/client').client(() => s).likeThread(token, id);
  });
  ipcMain.handle('auth:guest', (_e, nickname) => api.guestLogin(nickname));
  ipcMain.handle('auth:githubUrl', () => api.getGithubLoginUrl());
  ipcMain.handle('auth:githubCallback', (_e, code) => api.exchangeGithubCode(code));
  ipcMain.handle('auth:me', (_e, token) => api.getMe(token));
  ipcMain.handle('auth:myScores', (_e, token) => api.getMyScores(token));

  // ---------------- 系统信息（安兔兔风格设备页）----------------
  ipcMain.handle('util:openExternal', (_e, url) => {
    if (/^https?:\/\//.test(String(url))) shell.openExternal(String(url));
    return true;
  });
  ipcMain.handle('sys:info', () => ({
    platform: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    cpu: os.cpus()[0]?.model || 'Unknown CPU',
    cores: os.cpus().length,
    memGb: Math.round(os.totalmem() / 1073741824),
    hostname: os.hostname(),
    node: process.versions.node,
    electron: process.versions.electron,
    machineId: crypto.createHash('sha256').update(os.hostname() + os.cpus()[0]?.model + os.totalmem()).digest('hex').slice(0, 16),
  }));
}

module.exports = { registerIpc };
