// 本地设置与历史记录（JSON 文件存储于 Electron userData）
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function storeDir() {
  const dir = path.join(app.getPath('userData'), 'store');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(storeDir(), file), 'utf-8')); }
  catch { return fallback; }
}
function writeJson(file, data) {
  fs.writeFileSync(path.join(storeDir(), file), JSON.stringify(data, null, 2), 'utf-8');
}

const DEFAULT_SETTINGS = {
  serverUrl: 'http://127.0.0.1:8600',
  productionServerUrl: 'http://144.126.133.165:8600',
  useProductionServer: true,
  concurrency: 4,
  sampleSize: 10,           // 每套默认题数（快速模式）
  timeoutSec: 180,
  // ---- 真实模式（默认全部锁死，不花一分钱）----
  realModeUnlocked: false,   // 必须手动解锁
  unlockAcknowledge: '',     // 解锁时输入的确认串 I-UNDERSTAND-THE-COST
  cliAgentId: null,
  apiBaseUrl: '',
  apiKey: '',                // 仅存本地
  apiModel: '',
  sandboxEnabled: true,
  theme: 'light',
};

function getSettings() {
  return { ...DEFAULT_SETTINGS, ...readJson('settings.json', {}) };
}
function setSettings(patch) {
  const next = { ...getSettings(), ...patch };
  writeJson('settings.json', next);
  return next;
}

function getHistory() {
  return readJson('history.json', []);
}
function addHistory(report) {
  const h = getHistory();
  h.unshift({
    runId: report.runId, time: report.finishedAt, agent: report.agentName, model: report.modelName,
    mock: report.mock, totalScore: report.summary.totalScore,
    intelligenceIndex: report.summary.intelligenceIndex,
    accuracyOverall: report.summary.accuracyOverall,
    categories: report.summary.categories,
    suites: Object.fromEntries(Object.entries(report.suites).map(([k, v]) => [k, { accuracy: v.accuracy, graded: v.graded }])),
  });
  writeJson('history.json', h.slice(0, 200));
  return h.slice(0, 100);
}
function clearHistory() { writeJson('history.json', []); return []; }

module.exports = { getSettings, setSettings, getHistory, addHistory, clearHistory };
