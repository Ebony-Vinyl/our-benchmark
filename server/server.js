// Our Benchmark Server — 排名 / 论坛 / OAuth / 题库分发 / 公开榜单网站
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { tables, serverSecret, DATA_DIR } = require('./db');
const { authRouter } = require('./auth');

const PORT = process.env.PORT || 8600;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const DATASETS_DIR = process.env.DATASETS_DIR || path.join(__dirname, '..', 'data', 'benchmarks-full');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.disable('x-powered-by');

// ---------------- 工具 ----------------
const b64u = (s) => Buffer.from(String(s)).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url').toString('utf8');
function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', serverSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', serverSecret()).update(body).digest('base64url');
  if (sig !== expect) return null;
  try {
    const p = JSON.parse(unb64u(body));
    if (p.exp && Date.now() > p.exp) return null;
    return p;
  } catch { return null; }
}
function publicUser(u) {
  return { id: u.id, name: u.name, avatar: u.avatar, provider: u.provider, createdAt: u.createdAt };
}
function fail(res, code, msg, status = 400) { res.status(status).json({ error: msg, code }); }

// ---------------- 认证（GitHub OAuth / 访客）——先于使用 authMiddleware 的路由 ----------------
const auth = authRouter({ sign, verify, publicUser, PUBLIC_URL, tables });
app.use('/api/v1/auth', auth.router);
const authMiddleware = auth.authMiddleware;

// ---------------- 健康与统计 ----------------
app.get('/api/v1/health', (_req, res) => res.json({ ok: true, name: 'Our Benchmark Server', version: '1.0.0', time: new Date().toISOString() }));
app.get('/api/v1/stats', (_req, res) => {
  const scores = tables.scores.all();
  const models = new Set(scores.map(s => s.model + '|' + (s.mock ? 1 : 0)));
  const users = tables.users.all().length;
  const threads = tables.threads.all().length;
  const posts = tables.posts.all().length;
  res.json({ ok: true, totalScores: scores.length, models: models.size, users, threads, posts, datasets: listDatasets().length });
});

// ---------------- 分数与榜单 ----------------
const CATS = ['code', 'science', 'general', 'agent', 'long_context', 'cyber'];

app.post('/api/v1/scores', authMiddleware, (req, res) => {
  const u = req.user;
  const b = req.body || {};
  if (!b.model || typeof b.model !== 'string') return fail(res, 'bad', '缺少 model 字段');
  if (b.totalScore == null || b.intelligenceIndex == null) return fail(res, 'bad', '缺少分数字段');
  const score = tables.scores.insert({
    userId: u.id, userName: u.name, userAvatar: u.avatar,
    agent: String(b.agent || 'unknown').slice(0, 120),
    model: String(b.model).slice(0, 160),
    mock: !!b.mock,
    totalScore: Math.max(0, Math.round(+b.totalScore) || 0),
    intelligenceIndex: +b.intelligenceIndex || 0,
    accuracyOverall: +b.accuracyOverall || 0,
    categories: b.categories || {},
    suites: b.suites || {},
    host: { platform: b.host?.platform || '', cpu: b.host?.cpu || '', cores: +b.host?.cores || 0 },
    runId: String(b.runId || '').slice(0, 64),
    finishedAt: b.finishedAt || new Date().toISOString(),
  });
  res.json({ ok: true, id: score.id, rank: rankOf(score) });
});

function leaderboardRows({ sort = 'intelligenceIndex', mode = '', limit = 100 } = {}) {
  // 同一 (model, mock) 取最高分
  const best = new Map();
  for (const s of tables.scores.all()) {
    if (mode === 'mock' && !s.mock) continue;
    if (mode === 'real' && s.mock) continue;
    const key = s.model + '|' + (s.mock ? 1 : 0);
    const cur = best.get(key);
    if (!cur || (s[sort] ?? 0) > (cur[sort] ?? 0)) best.set(key, s);
  }
  let rows = [...best.values()];
  rows.sort((a, b2) => (b2[sort] ?? 0) - (a[sort] ?? 0));
  rows = rows.slice(0, Math.max(1, Math.min(+limit || 100, 500)));
  const agentsByModel = new Map();
  for (const s of tables.scores.all()) {
    if (!agentsByModel.has(s.model)) agentsByModel.set(s.model, new Set());
    agentsByModel.get(s.model).add(s.agent);
  }
  return rows.map((s, i) => ({
    rank: i + 1, model: s.model, mock: s.mock, agent: s.agent,
    agents: [...(agentsByModel.get(s.model) || [])].slice(0, 5),
    totalScore: s.totalScore, intelligenceIndex: s.intelligenceIndex, accuracyOverall: s.accuracyOverall,
    categories: s.categories, lastSubmission: s.createdAt, scoreId: s.id,
  }));
}
function rankOf(score) {
  const rows = leaderboardRows({ sort: 'intelligenceIndex', mode: score.mock ? 'mock' : 'real', limit: 500 });
  return rows.findIndex(r => r.scoreId === score.id) + 1 || null;
}

app.get('/api/v1/leaderboard', (req, res) => {
  const { sort, mode } = req.query;
  if (sort && !['intelligenceIndex', 'totalScore', 'accuracyOverall'].includes(sort)) return fail(res, 'bad', '非法排序字段');
  res.json({ ok: true, leaderboard: leaderboardRows({ sort: sort || 'intelligenceIndex', mode: mode || '', limit: req.query.limit }) });
});
app.get('/api/v1/scores/:id', (req, res) => {
  const s = tables.scores.get(req.params.id);
  if (!s) return fail(res, 'nf', '成绩不存在', 404);
  res.json({ ok: true, score: s });
});

// ---------------- 我的 ----------------
app.get('/api/v1/me', authMiddleware, (req, res) => res.json({ ok: true, user: publicUser(req.userRaw) }));
app.get('/api/v1/me/scores', authMiddleware, (req, res) => {
  const mine = tables.scores.all().filter(s => s.userId === req.user.id)
    .sort((a, b2) => new Date(b2.createdAt) - new Date(a.createdAt)).slice(0, 50)
    .map(s => ({ ...s, rank: rankOf(s) }));
  res.json({ ok: true, scores: mine });
});

// ---------------- 论坛 ----------------
const CATS_FORUM = ['score', 'discussion', 'help', 'benchmark', 'offtopic'];
app.get('/api/v1/forum/threads', (req, res) => {
  let ts = tables.threads.all();
  if (req.query.category) ts = ts.filter(t => t.category === req.query.category);
  ts.sort((a, b2) => (b2.pinned - a.pinned) || (new Date(b2.createdAt) - new Date(a.createdAt)));
  ts = ts.slice(0, Math.min(+req.query.limit || 50, 100));
  res.json({ ok: true, threads: ts });
});
app.get('/api/v1/forum/threads/:id', (req, res) => {
  const t = tables.threads.get(req.params.id);
  if (!t) return fail(res, 'nf', '帖子不存在', 404);
  const posts = tables.posts.all().filter(p => p.threadId === t.id)
    .sort((a, b2) => new Date(a.createdAt) - new Date(b2.createdAt));
  res.json({ ok: true, ...t, posts });
});
app.post('/api/v1/forum/threads', authMiddleware, (req, res) => {
  const { title, body, category } = req.body || {};
  if (!title || !body) return fail(res, 'bad', '标题和内容必填');
  const t = tables.threads.insert({
    title: String(title).slice(0, 120), body: String(body).slice(0, 8000),
    category: CATS_FORUM.includes(category) ? category : 'discussion',
    authorId: req.user.id, authorName: req.user.name, authorAvatar: req.user.avatar,
    authorProvider: req.user.provider, replies: 0, likes: 0, likedBy: [], pinned: false,
  });
  res.json({ ok: true, id: t.id });
});
app.post('/api/v1/forum/threads/:id/posts', authMiddleware, (req, res) => {
  const t = tables.threads.get(req.params.id);
  if (!t) return fail(res, 'nf', '帖子不存在', 404);
  const { body } = req.body || {};
  if (!body) return fail(res, 'bad', '内容必填');
  const p = tables.posts.insert({
    threadId: t.id, body: String(body).slice(0, 8000),
    authorId: req.user.id, authorName: req.user.name, authorAvatar: req.user.avatar,
    authorProvider: req.user.provider,
  });
  tables.threads.update(t.id, { replies: (t.replies || 0) + 1 });
  res.json({ ok: true, id: p.id });
});
app.post('/api/v1/forum/threads/:id/like', authMiddleware, (req, res) => {
  const t = tables.threads.get(req.params.id);
  if (!t) return fail(res, 'nf', '帖子不存在', 404);
  const liked = t.likedBy || [];
  if (liked.includes(req.user.id)) return res.json({ ok: true, likes: t.likes, note: '已赞过' });
  liked.push(req.user.id);
  const newLikes = (t.likes || 0) + 1;
  tables.threads.update(t.id, { likes: newLikes, likedBy: liked });
  res.json({ ok: true, likes: newLikes });
});

// ---------------- 题库分发 ----------------
function listDatasets() {
  const out = [];
  try {
    for (const f of fs.readdirSync(DATASETS_DIR).filter(f => f.endsWith('.json'))) {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(DATASETS_DIR, f), 'utf-8'));
        out.push({
          id: s.id, name: s.name, nameZh: s.nameZh, category: s.category,
          description: s.description, source: s.source, license: s.license,
          questions: s.questions.length, bytes: fs.statSync(path.join(DATASETS_DIR, f)).size,
        });
      } catch { }
    }
  } catch { }
  return out;
}
app.get('/api/v1/datasets', (_req, res) => res.json({ ok: true, datasets: listDatasets() }));
app.get('/api/v1/datasets/:id', (req, res) => {
  const f = path.join(DATASETS_DIR, path.basename(req.params.id) + '.json');
  if (!fs.existsSync(f)) return fail(res, 'nf', '题库不存在', 404);
  res.sendFile(f);
});

// ---------------- 静态资源（必须最后挂载） ----------------
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------------- 启动 ----------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[Our Benchmark Server] listening on :${PORT}`);
    console.log(`  datasets dir: ${DATASETS_DIR} (${listDatasets().length} suites)`);
    console.log(`  public url:   ${PUBLIC_URL}`);
  });
}
module.exports = { app };
