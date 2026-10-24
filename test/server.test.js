// 服务器 API 端到端测试（本地随机端口，不碰线上）
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 独立数据目录，避免污染
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-server-'));
process.env.DATASETS_DIR = path.join(__dirname, '..', 'data', 'benchmarks-full');

// db.js 用固定路径 —— 用环境变量不行，这里直接改 require 解析前的模块缓存策略：
// 便捷法：把 server-data 目录重定向（db.js 的 DATA_DIR 在 __dirname/../server-data）
const SERVER_DATA = path.join(__dirname, '..', 'server', 'server-data');
const backupDir = SERVER_DATA + '.bak-' + Date.now();
let hadExisting = fs.existsSync(SERVER_DATA);
if (hadExisting) fs.renameSync(SERVER_DATA, backupDir);

const PORT = 18600 + Math.floor(Math.random() * 400);
process.env.PORT = String(PORT);
process.env.PUBLIC_URL = `http://127.0.0.1:${PORT}`;

let passed = 0, total = 0;
function t(name, fn) { total++; return Promise.resolve().then(fn).then(() => { passed++; console.log('  ✓', name); }).catch((e) => { console.log('  ✗', name, '\n    ', e.message); throw e; }); }

const B = `http://127.0.0.1:${PORT}`;
const j = async (path2, opts) => {
  const res = await fetch(B + path2, opts);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
  return { status: res.status, data, headers: res.headers };
};

(async () => {
  // 启动服务器
  const child = require('child_process').spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => { });
  let out = '';
  child.stdout.on('data', (d) => out += d);
  child.stderr.on('data', (d) => out += d);

  // 等就绪
  let up = false;
  for (let i = 0; i < 40; i++) {
    try { const r = await j('/api/v1/health'); if (r.data.ok) { up = true; break; } } catch { }
    await new Promise(r => setTimeout(r, 250));
  }
  if (!up) { console.error('服务器未启动:\n' + out); process.exit(1); }

  await t('health', async () => {
    const r = await j('/api/v1/health');
    assert.strictEqual(r.status, 200);
    assert.ok(r.data.ok);
  });

  let guestToken, ghGuestToken;
  await t('访客登录', async () => {
    const r = await j('/api/v1/auth/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: '测试侠' }) });
    assert.strictEqual(r.status, 200);
    assert.ok(r.data.token);
    assert.strictEqual(r.data.user.provider, 'guest');
    guestToken = r.data.token;
  });

  await t('GitHub OAuth 未配置时的友好提示', async () => {
    const r = await j('/api/v1/auth/github/url');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.configured, false);
    assert.ok(r.data.reason);
  });

  await t('未登录上传被拒（401）', async () => {
    const r = await j('/api/v1/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'x', totalScore: 1, intelligenceIndex: 1 }) });
    assert.strictEqual(r.status, 401);
  });

  await t('上传成绩 + 排名返回', async () => {
    const r = await j('/api/v1/scores', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + guestToken },
      body: JSON.stringify({
        agent: 'Codex CLI', model: 'Mock-GPT-5.3', mock: true,
        totalScore: 1834210, intelligenceIndex: 91.7, accuracyOverall: 0.83,
        categories: { code: { accuracy: 0.9, correct: 9, graded: 10 }, science: { accuracy: 0.8, correct: 8, graded: 10 } },
        suites: { 'swe-verified': { accuracy: 0.9, graded: 10, correct: 9 } },
        host: { platform: 'win32', cpu: 'TestCPU', cores: 8 },
        runId: 'run_test01', finishedAt: new Date().toISOString(),
      }),
    });
    assert.strictEqual(r.status, 200);
    assert.ok(r.data.id);
    assert.ok(r.data.rank >= 1);
  });

  await t('第二用户上传 + 榜单排序', async () => {
    const g = await j('/api/v1/auth/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: '路人甲' }) });
    ghGuestToken = g.data.token;
    await j('/api/v1/scores', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ghGuestToken },
      body: JSON.stringify({ agent: 'zcode', model: 'Mock-GLM-5.3', mock: true, totalScore: 1721000, intelligenceIndex: 86.0, accuracyOverall: 0.78, categories: {}, suites: {} }),
    });
    const r = await j('/api/v1/leaderboard?sort=intelligenceIndex');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.leaderboard.length, 2);
    assert.strictEqual(r.data.leaderboard[0].model, 'Mock-GPT-5.3'); // 91.7 > 86.0
    assert.strictEqual(r.data.leaderboard[0].rank, 1);
  });

  await t('榜单 mode 过滤', async () => {
    const r = await j('/api/v1/leaderboard?mode=real');
    assert.strictEqual(r.data.leaderboard.length, 0); // 只有 mock 成绩
  });

  await t('论坛：发帖/回复/点赞', async () => {
    const post = await j('/api/v1/forum/threads', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + guestToken },
      body: JSON.stringify({ title: '晒分：Mock-GPT-5.3 破 180 万', body: '如题，跑了 SWE-bench Verified + GPQA。', category: 'score' }),
    });
    assert.strictEqual(post.status, 200);
    const tid = post.data.id;
    const reply = await j(`/api/v1/forum/threads/${tid}/posts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ghGuestToken },
      body: JSON.stringify({ body: '牛的，我 GLM 只有 86 分' }),
    });
    assert.strictEqual(reply.status, 200);
    const like = await j(`/api/v1/forum/threads/${tid}/like`, { method: 'POST', headers: { Authorization: 'Bearer ' + ghGuestToken } });
    assert.ok(like.data.ok && like.data.likes === 1);
    const detail = await j(`/api/v1/forum/threads/${tid}`);
    assert.strictEqual(detail.data.posts.length, 1);
    assert.strictEqual(detail.data.replies, 1);
    const list = await j('/api/v1/forum/threads?category=score');
    assert.strictEqual(list.data.threads.length, 1);
  });

  await t('me / me/scores', async () => {
    const me = await j('/api/v1/me', { headers: { Authorization: 'Bearer ' + guestToken } });
    assert.strictEqual(me.data.user.name, '测试侠');
    const scores = await j('/api/v1/me/scores', { headers: { Authorization: 'Bearer ' + guestToken } });
    assert.strictEqual(scores.data.scores.length, 1);
    assert.strictEqual(scores.data.scores[0].model, 'Mock-GPT-5.3');
  });

  await t('坏 token 被拒', async () => {
    const r = await j('/api/v1/me', { headers: { Authorization: 'Bearer fake.token.here' } });
    assert.strictEqual(r.status, 401);
  });

  await t('题库分发接口', async () => {
    const r = await j('/api/v1/datasets');
    assert.strictEqual(r.status, 200);
    console.log(`    服务器题库: ${(r.data.datasets || []).length} 套`);
    if ((r.data.datasets || []).length) {
      const first = r.data.datasets[0];
      const dl = await j('/api/v1/datasets/' + first.id);
      assert.strictEqual(dl.status, 200);
      assert.ok(dl.data.questions && dl.data.questions.length === first.questions);
    }
  });

  await t('公开榜单网页可访问', async () => {
    const res = await fetch(B + '/');
    const html = await res.text();
    assert.ok(html.includes('Our Benchmark'));
    const css = await fetch(B + '/style.css');
    assert.strictEqual(css.status, 200);
  });

  await t('统计接口', async () => {
    const r = await j('/api/v1/stats');
    assert.ok(r.data.totalScores >= 2 && r.data.users >= 2 && r.data.threads >= 1);
  });

  child.kill();
  // 恢复数据目录
  setTimeout(() => {
    try { fs.rmSync(SERVER_DATA, { recursive: true, force: true }); } catch { }
    if (hadExisting) fs.renameSync(backupDir, SERVER_DATA);
    console.log(`\nserver: ${passed}/${total} 通过`);
    process.exit(passed === total ? 0 : 1);
  }, 300);
})().catch((e) => {
  console.error(e);
  try { if (hadExisting) fs.renameSync(backupDir, SERVER_DATA); } catch { }
  process.exit(1);
});
