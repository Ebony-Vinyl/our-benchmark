// 视觉检查编排：起本地服务器并播种数据 → Electron( --remote-debugging-port ) → CDP 驱动
// 遍历 页面×宽度 截图，收集渲染进程控制台错误与横向溢出（错位检测）。零 API 消耗。
// 用法：node test/visual-check.js [--widths=1600,1280,1024,820] [--pages=home,run,...] [--result]
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 18699;
const B = `http://127.0.0.1:${PORT}`;
const CDP_PORT = 9333;
const OUT = path.join(__dirname, '..', 'shots', 'vcheck');

const arg = (name, dft) => {
  const a = process.argv.find(x => x.startsWith('--' + name + '='));
  return a ? a.split('=')[1] : dft;
};
const WIDTHS = arg('widths', '1600,1280,1024,820').split(',').map(Number);
const PAGES = arg('pages', 'home,run,leaderboard,forum,history,device,settings').split(',');
const WANT_RESULT = process.argv.includes('--result');

if (process.argv.includes('--fresh')) fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// ---------- 1) 种子 userData：指向本地服务器 + 本地历史（先备份，退出时恢复）
const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const storeDir = path.join(appData, 'Our Benchmark', 'store');
fs.mkdirSync(storeDir, { recursive: true });
const userBak = path.join(storeDir, '.vc-backup');
fs.mkdirSync(userBak, { recursive: true });
for (const f of ['settings.json', 'history.json']) {
  if (fs.existsSync(path.join(storeDir, f)) && !fs.existsSync(path.join(userBak, f))) {
    fs.copyFileSync(path.join(storeDir, f), path.join(userBak, f));
  }
}
function restoreUserStore() {
  try {
    for (const f of ['settings.json', 'history.json']) {
      const bak = path.join(userBak, f);
      if (fs.existsSync(bak)) fs.copyFileSync(bak, path.join(storeDir, f));
      else fs.rmSync(path.join(storeDir, f), { force: true });
    }
    fs.rmSync(userBak, { recursive: true, force: true });
  } catch { }
}
fs.writeFileSync(path.join(storeDir, 'settings.json'), JSON.stringify({
  useProductionServer: false,
  serverUrl: B,
  concurrency: 4,
  sampleSize: 5,
  realModeUnlocked: false,
}, null, 2));
const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();
const hist = [
  { time: iso(36e5), runId: 'vc-seed-a', model: 'GLM-5.3', agent: 'zcode', mock: true, intelligenceIndex: 84.2, totalScore: 1684200, accuracyOverall: 0.781, categories: { code: { accuracy: 0.81 }, science: { accuracy: 0.74 }, general: { accuracy: 0.79 } }, suites: { 'swe-bench-verified': { graded: 10, correct: 8, accuracy: 0.8 } } },
  { time: iso(864e5), runId: 'vc-seed-b', model: 'GPT-5.3', agent: 'Codex CLI', mock: true, intelligenceIndex: 91.7, totalScore: 1834000, accuracyOverall: 0.842, categories: { code: { accuracy: 0.88 }, science: { accuracy: 0.81 }, general: { accuracy: 0.84 } }, suites: { 'swe-bench-verified': { graded: 10, correct: 9, accuracy: 0.9 } } },
  { time: iso(1728e5), runId: 'vc-seed-c', model: 'Claude Opus 4.5', agent: 'Claude Code', mock: true, intelligenceIndex: 88.4, totalScore: 1768000, accuracyOverall: 0.806, categories: { code: { accuracy: 0.85 }, science: { accuracy: 0.77 }, general: { accuracy: 0.8 } }, suites: { 'swe-bench-verified': { graded: 10, correct: 8, accuracy: 0.8 } } },
];
fs.writeFileSync(path.join(storeDir, 'history.json'), JSON.stringify(hist, null, 2));

// ---------- 2) 服务器（测试数据目录，避免污染真实 server-data）
const serverData = path.join(__dirname, '..', 'server', 'server-data');
const bak = serverData + '.bak-vc';
// 上次异常退出遗留的备份：以备份为准恢复，再重新备份
if (fs.existsSync(bak) && fs.existsSync(serverData)) {
  fs.rmSync(serverData, { recursive: true, force: true });
}
let had = fs.existsSync(serverData);
if (had) fs.renameSync(serverData, bak);
const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
  env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.stdout.write('[srv!] ' + d));

let electron = null;
function cleanup(code, extra) {
  try { if (electron && electron.pid) spawnSync('taskkill', ['/pid', String(electron.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { }
  try { server.kill(); } catch { }
  restoreUserStore();
  // 兜底：CDP 端口若仍被残留实例占用，按 PID 结束
  try {
    spawnSync('powershell', ['-NoProfile', '-Command',
      `Get-NetTCPConnection -LocalPort ${CDP_PORT} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`], { timeout: 20000, stdio: 'ignore' });
  } catch { }
  try { fs.rmSync(serverData, { recursive: true, force: true }); if (had) fs.renameSync(bak, serverData); } catch { }
  if (extra) console.log(extra);
  process.exit(code);
}
process.on('exit', () => { try { server.kill(); } catch { } });

async function seedServer() {
  const models = [
    ['GPT-5.3', 'Codex CLI', 91.7, 1834, true],
    ['Claude Opus 4.5', 'Claude Code', 88.4, 1768, true],
    ['Gemini 3 Pro', 'Gemini CLI', 86.0, 1721, true],
    ['GLM-5.3', 'zcode', 84.2, 1684, true],
    ['DeepSeek V4', 'Aider', 82.6, 1652, true],
    ['Qwen3.5 Max', 'Qwen Code', 80.1, 1602, true],
    ['Grok 5', 'Cline', 78.9, 1578, false],
    ['Kimi K2.5', 'Claude Code', 77.4, 1548, true],
    ['Mistral Large 3', 'Copilot CLI', 74.8, 1496, false],
    ['Llama 4.1 405B', 'Ollama', 71.2, 1424, true],
    ['Seed-OSS 2.0', 'Trae', 68.5, 1370, true],
    ['MiniMax M2.2', 'Roo Code', 65.9, 1318, true],
  ];
  const tokens = [];
  for (let i = 0; i < 8; i++) {
    const r = await fetch(B + '/api/v1/auth/guest', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'VC-' + i }),
    }).then(r => r.json());
    tokens.push(r.token);
  }
  for (let i = 0; i < models.length; i++) {
    const [model, agent, idx, total, mock] = models[i];
    await fetch(B + '/api/v1/scores', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tokens[i % tokens.length] },
      body: JSON.stringify({
        model, agent, mock, totalScore: total * 1000, intelligenceIndex: idx,
        accuracyOverall: idx / 110,
        categories: { code: { accuracy: idx / 105 }, science: { accuracy: idx / 115 }, general: { accuracy: idx / 108 }, agent: { accuracy: idx / 112 } },
        suites: { 'swe-bench-verified': { graded: 10, correct: Math.round(idx / 12), accuracy: idx / 110 } },
        host: { platform: 'win32', cpu: 'Seed CPU', cores: 16 },
        finishedAt: iso(i * 36e5),
      }),
    });
  }
  // 论坛：两个帖子 + 回复 + 点赞
  const t1 = await fetch(B + '/api/v1/forum/threads', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tokens[0] },
    body: JSON.stringify({ title: 'Mock 模式的分数和真实跑分差多少？', body: '用内置模拟 Agent 跑了一轮 SWE-bench Verified 子集，84 分。想问问大家模拟画像和真实 CLI 跑分的差距一般在什么区间？', category: 'score' }),
  }).then(r => r.json());
  await fetch(B + `/api/v1/forum/threads/${t1.id}/posts`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tokens[1] },
    body: JSON.stringify({ body: '同一台机器上对比过，模拟分普遍高 3~6 分，因为沙箱和容器执行失败都按跳过算了。当排名参考没问题，别当绝对值看。' }),
  });
  const t2 = await fetch(B + '/api/v1/forum/threads', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tokens[2] },
    body: JSON.stringify({ title: '建议增加 Terminal-Bench 2.0 的全量下载提示', body: '66 题不多，全量跑完只要几分钟，建议默认勾选。', category: 'feature' }),
  }).then(r => r.json());
  await fetch(B + `/api/v1/forum/threads/${t2.id}/like`, { method: 'POST', headers: { authorization: 'Bearer ' + tokens[3] } });
}

// ---------- 3) CDP 小客户端（Node 22+ 原生 WebSocket）
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Set(); }
  static async connect(port) {
    let target = null;
    for (let i = 0; i < 60; i++) {
      try {
        const list = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
        target = list.find(t => t.type === 'page' && !/devtools/.test(t.url));
        if (target) break;
      } catch { }
      await new Promise(r => setTimeout(r, 500));
    }
    if (!target) throw new Error('CDP target not found');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
    const c = new CDP(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && c.pending.has(msg.id)) {
        const { res, rej } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method) {
        c.handlers.forEach(h => h(msg));
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('cdp timeout: ' + method)); }
      }, 12000);
    });
  }
  on(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval fail');
    return r.result && r.result.value;
  }
}

const errors = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (m) => { const s = `[vc ${new Date().toISOString().slice(11, 19)}] ` + m; console.log(s); try { fs.appendFileSync(path.join(OUT, 'progress.log'), s + '\n'); } catch { } };

(async () => {
  // 等服务器
  let up = false;
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(B + '/api/v1/health'); if ((await r.json()).ok) { up = true; break; } } catch { }
    await sleep(250);
  }
  if (!up) cleanup(1, '本地服务器未启动');
  await seedServer();
  log('服务器就绪 + 数据已播种 ' + B);

  // Electron（先确认 CDP 端口空闲，避免连到上一次的孤儿实例）
  const busy = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then(() => true).catch(() => false);
  if (busy) cleanup(1, `[vc] 端口 ${CDP_PORT} 已被占用：先结束残留的 electron 进程再跑`);
  electron = spawn('npx', ['electron', '.', '--remote-debugging-port=' + CDP_PORT], {
    cwd: path.join(__dirname, '..'), shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  electron.stderr.on('data', () => { });

  const cdp = await CDP.connect(CDP_PORT);
  log('CDP 已连接');
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  cdp.on((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      const text = (msg.params.args || []).map(a => a.value || a.description || '').join(' ');
      if (!/net::ERR|Failed to load resource|Autofill/.test(text)) errors.push('[console.' + msg.params.type + '] ' + text.slice(0, 300));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push('[exception] ' + ((d.exception && d.exception.description) || d.text || '').slice(0, 300));
    }
  });

  // 等 App 就绪
  for (let i = 0; i < 40; i++) {
    try { if (await cdp.eval('!!window.App && !!document.querySelector(".nav-link")')) break; } catch { }
    await sleep(500);
  }
  await sleep(1200);

  const overflow = [];
  for (const w of WIDTHS) {
    let metricsOk = true;
    try {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: 940, deviceScaleFactor: 1, mobile: false });
    } catch {
      metricsOk = false;
      errors.push(`[metrics ${w}] override 超时，改用 window.resizeTo`);
      try { await cdp.eval(`window.resizeTo(${w}, 940)`); } catch { }
    }
    await sleep(900);
    if (!metricsOk) await sleep(400);
    for (const p of PAGES) {
      try {
        await cdp.eval(`App.nav('${p}', { force: true, instant: true }).then(() => new Promise(r => setTimeout(r, 3400)))`);
        const geo = await cdp.eval(`(() => {
          const v = document.getElementById('view');
          const b = document.body;
          return JSON.stringify({ vsw: v.scrollWidth, vcw: v.clientWidth, bsw: b.scrollWidth, bcw: b.clientWidth });
        })()`);
        const g = JSON.parse(geo);
        if (g.vsw > g.vcw + 1 || g.bsw > g.bcw + 1) overflow.push(`${w}x${p}: view ${g.vsw}>${g.vcw} body ${g.bsw}>${g.bcw}`);
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(OUT, `${w}-${p}.png`), Buffer.from(shot.data, 'base64'));
        log('shot ' + w + ' ' + p);
      } catch (e) {
        errors.push(`[nav ${w}/${p}] ${e.message}`);
        log('FAIL ' + w + ' ' + p + ' :: ' + e.message);
      }
    }
  }

  // 结果页：跑一次 mock（小样本）后截图
  if (WANT_RESULT) {
    try {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 940, deviceScaleFactor: 1, mobile: false });
      await cdp.eval(`(async () => {
        await App.nav('run', { force: true, instant: true });
        await new Promise(r => setTimeout(r, 1500));
        document.getElementById('runGo').click();
      })()`);
      // 跑分进行中的暗舱截图（README 用）
      await sleep(8000);
      try {
        const chamber = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(OUT, '1600-chamber.png'), Buffer.from(chamber.data, 'base64'));
        log('shot chamber');
      } catch (e) { errors.push('[chamber] ' + e.message); }
      // 等结果页出现（mock 全量跑分约 20-40 秒），再等入场动画完成
      for (let i = 0; i < 40; i++) {
        if (await cdp.eval(`!!document.querySelector('.result-page')`)) break;
        await sleep(1000);
      }
      await sleep(3600);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, '1600-result.png'), Buffer.from(shot.data, 'base64'));
      log('shot result');
    } catch (e) { errors.push('[result] ' + e.message); }
  }

  log('==== 视觉检查汇总 ====');
  log('控制台错误/异常: ' + errors.length);
  errors.forEach(e => log('  ' + e));
  log('横向溢出(错位): ' + overflow.length);
  overflow.forEach(e => log('  ' + e));
  log('截图目录: ' + OUT);
  cleanup(errors.length || overflow.length ? 2 : 0);
})().catch(e => cleanup(1, '[vc] fatal: ' + e.message));
