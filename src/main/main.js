// Our Benchmark — Electron 主进程入口
const { app, BrowserWindow, shell, nativeTheme } = require('electron');
const path = require('path');
const { registerIpc } = require('./ipc');

const SMOKE = process.argv.includes('--smoke');
const E2E = process.argv.includes('--e2e');
const SHOT = process.argv.includes('--screenshot');
const SHOT_PAGE = (process.argv.find(a => a.startsWith('--page=')) || '--page=home').split('=')[1];
let mainWindow = null;
let smokeErrors = 0;

process.on('uncaughtException', (e) => {
  console.error('[main] uncaught:', e.message);
  smokeErrors++;
  if (SMOKE) { console.log('SMOKE_RESULT=ERROR'); app.exit(1); }
});
process.on('unhandledRejection', (e) => {
  console.error('[main] rejection:', String(e));
  smokeErrors++;
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    frame: false,            // 无边框窗口：标题栏由渲染层自绘
    backgroundColor: '#f1efe9',
    autoHideMenuBar: true,
    title: 'Our Benchmark',
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  // 窗口控制（无边框自绘标题栏用）
  const { ipcMain } = require('electron');
  ipcMain.removeAllListeners('win:control');
  ipcMain.on('win:control', (_e, cmd) => {
    if (!mainWindow) return;
    if (cmd === 'minimize') mainWindow.minimize();
    else if (cmd === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    else if (cmd === 'close') mainWindow.close();
  });
  const sendMax = () => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('win:maximized', mainWindow?.isMaximized() ?? false);
  };
  mainWindow.on('maximize', sendMax);
  mainWindow.on('unmaximize', sendMax);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (SHOT) {
      const fs = require('fs');
      const outDir = process.env.OB_SHOT_DIR || path.join(process.cwd(), 'shots');
      fs.mkdirSync(outDir, { recursive: true });
      const pages = SHOT_PAGE === 'all' ? ['home', 'run', 'leaderboard', 'forum', 'history', 'device', 'settings'] : SHOT_PAGE.split(',');
      (async () => {
        for (const p of pages) {
          await mainWindow.webContents.executeJavaScript(`(App.nav('${p}', {force:true, instant:true}), new Promise(r=>setTimeout(r,3800)))`);
          const img = await mainWindow.webContents.capturePage();
          fs.writeFileSync(path.join(outDir, `page-${p}.png`), img.toPNG());
          console.log('[shot]', p);
        }
        console.log('SHOT_DONE');
        app.exit(0);
      })().catch((e) => { console.error('[shot fail]', e.message); app.exit(1); });
    }
    if (E2E) {
      // 端到端：真实 App 内 跑分→登录→上传→榜单→历史→论坛 全链路（Mock 模式，零 API 消耗）
      const suites = (() => {
        try {
          const { loadSuites } = require('./bench/suites');
          return loadSuites().slice(0, 4).map(s => s.id);
        } catch { return []; }
      })();
      mainWindow.webContents.on('console-message', (_e, level, message) => {
        if (message.includes('E2E_')) console.log('[e2e]', message);
        else if (level >= 2 && !/net::ERR|Failed to load resource/.test(message)) { console.error('[renderer]', message); smokeErrors++; }
      });
      const script = `
        (async () => {
          const log = (m) => console.log('E2E_' + m);
          const S = ${JSON.stringify(suites)};
          if (!S.length) throw new Error('无可用题库');
          const h = await window.ourbench.serverHealth(); if (!h.ok) throw new Error('health'); log('health-ok');
          const g = await window.ourbench.guestLogin('E2E侠'); log('login-ok');
          await window.ourbench.setSettings({ _token: g.token });
          const report = await window.ourbench.startRun({ mode: 'mock', agentId: 'mock', agentName: '内置模拟 Agent', model: 'E2E-Model-Test', suiteIds: S, sampleSize: 5, concurrency: 4 });
          log('run-ok score=' + report.summary.totalScore + ' idx=' + report.summary.intelligenceIndex + ' suites=' + Object.keys(report.suites).length);
          const up = await window.ourbench.serverUpload(report);
          log('upload-ok rank=' + up.rank);
          const lb = await window.ourbench.serverLeaderboard('sort=intelligenceIndex');
          if (!(lb.leaderboard || []).some(r => r.model === 'E2E-Model-Test')) throw new Error('leaderboard missing');
          log('leaderboard-ok count=' + lb.leaderboard.length);
          const hist = await window.ourbench.getHistory();
          if (!hist.length || hist[0].model !== 'E2E-Model-Test') throw new Error('history missing');
          log('history-ok');
          await window.ourbench.postThread({ token: g.token, body: { title: 'E2E 测试帖', body: '跑了 ' + report.summary.totalScore + ' 分', category: 'score' } });
          log('forum-ok');
          log('ALL-PASS');
          return 'done';
        })()`;
      mainWindow.webContents.executeJavaScript(script)
        .then(() => { console.log('E2E_RESULT=' + (smokeErrors ? 'ERROR' : 'OK')); app.exit(smokeErrors ? 1 : 0); })
        .catch((e) => { console.error('[e2e fail]', e.message); console.log('E2E_RESULT=ERROR'); app.exit(1); });
    }
    if (SMOKE) {
      // 冒烟模式：渲染 4 秒后自动退出；渲染进程报错会被计数
      mainWindow.webContents.on('console-message', (_e, level, message) => {
        if (level >= 2 && !/net::ERR|Failed to load resource/.test(message)) {
          console.error('[renderer]', message);
          smokeErrors++;
        }
      });
      mainWindow.webContents.on('render-process-gone', (_e, details) => {
        console.error('[renderer gone]', details.reason);
        console.log('SMOKE_RESULT=ERROR');
        app.exit(1);
      });
      mainWindow.webContents.executeJavaScript('new Promise(r=>setTimeout(()=>r(document.querySelectorAll(".nav-link").length+":"+document.body.innerText.length),3500))')
        .then((info) => {
          console.log('[smoke] nav links & text length:', info);
          if (smokeErrors > 0) { console.log('SMOKE_RESULT=ERROR'); app.exit(1); }
          else { console.log('SMOKE_RESULT=OK'); app.exit(0); }
        })
        .catch((e) => { console.error('[smoke] js fail:', e.message); console.log('SMOKE_RESULT=ERROR'); app.exit(1); });
    }
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // 外部链接走系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
