// E2E 编排：起本地服务器 → 注入应用设置指向本地 → 启动 Electron --e2e → 检查结果
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 18699;
const B = `http://127.0.0.1:${PORT}`;

// 1) 种子设置：userData（Electron 用 package.json 的 productName → %APPDATA%/Our Benchmark）
const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const storeDir = path.join(appData, 'Our Benchmark', 'store');
fs.mkdirSync(storeDir, { recursive: true });
fs.writeFileSync(path.join(storeDir, 'settings.json'), JSON.stringify({
  useProductionServer: false,
  serverUrl: B,
  concurrency: 4,
  sampleSize: 5,
  realModeUnlocked: false,
}, null, 2));

// 2) 备份并清空历史，保证断言干净
fs.writeFileSync(path.join(storeDir, 'history.json'), '[]');

// 3) 起服务器（测试数据目录，避免污染）
const serverData = path.join(__dirname, '..', 'server', 'server-data');
const bak = serverData + '.bak-e2e';
let had = fs.existsSync(serverData);
if (had) fs.renameSync(serverData, bak);

const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
  env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => process.stdout.write('[srv] ' + d));
server.stderr.on('data', (d) => process.stdout.write('[srv!] ' + d));

function cleanup(code) {
  try { server.kill(); } catch { }
  try { fs.rmSync(serverData, { recursive: true, force: true }); if (had) fs.renameSync(bak, serverData); } catch { }
  process.exit(code);
}

(async () => {
  // 等服务器就绪
  let up = false;
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(B + '/api/v1/health'); if ((await r.json()).ok) { up = true; break; } } catch { }
    await new Promise(r => setTimeout(r, 250));
  }
  if (!up) { console.error('本地服务器未启动'); cleanup(1); }
  console.log('[e2e] 服务器就绪', B);

  // 4) 启动 Electron E2E
  const el = spawn('npx', ['electron', '.', '--e2e'], {
    cwd: path.join(__dirname, '..'), shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  el.stdout.on('data', (d) => { const s = d.toString(); out += s; process.stdout.write('[app] ' + s); });
  el.stderr.on('data', (d) => { const s = d.toString(); out += s; process.stdout.write('[app!] ' + s); });

  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => { try { el.kill(); } catch { } resolve(124); }, 240000);
    el.on('exit', (c) => { clearTimeout(timer); resolve(c ?? 1); });
  });

  const ok = code === 0 && out.includes('E2E_RESULT=OK') && out.includes('ALL-PASS');
  console.log(ok ? '\nE2E 全链路通过 ✓（跑分→登录→上传→榜单→历史→论坛）' : `\nE2E 失败 ✗ (exit=${code})`);
  cleanup(ok ? 0 : 1);
})();
