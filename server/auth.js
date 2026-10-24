// 认证：GitHub OAuth（需 env 配置）+ 访客模式（零配置可用）
const express = require('express');
const crypto = require('crypto');

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 天

function authRouter({ sign, verify, publicUser, PUBLIC_URL, tables }) {
  const router = express.Router();

  // ---- 中间件：可选认证 ----
  function authMiddleware(req, res, next) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : (req.query.token || '');
    const payload = token ? verify(token) : null;
    if (!payload) return res.status(401).json({ error: '未登录或凭证已过期', code: 'auth' });
    const user = tables.users.get(payload.uid);
    if (!user) return res.status(401).json({ error: '用户不存在', code: 'auth' });
    req.user = { id: user.id, name: user.name, avatar: user.avatar, provider: user.provider };
    req.userRaw = user;
    next();
  }

  // ---- 访客登录 ----
  router.post('/guest', (req, res) => {
    const name = String(req.body?.nickname || '').trim().slice(0, 24) || ('游客' + crypto.randomInt(1000, 9999));
    const user = tables.users.insert({
      name, provider: 'guest', avatar: null,
      secret: crypto.randomBytes(16).toString('hex'),
    });
    const token = sign({ uid: user.id, exp: Date.now() + TOKEN_TTL_MS });
    res.json({ ok: true, token, user: publicUser(user) });
  });

  // ---- GitHub OAuth ----
  const ghConfigured = () => !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
  router.get('/github/url', (_req, res) => {
    if (!ghConfigured()) {
      return res.json({
        configured: false,
        reason: '服务器未配置 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET（设置环境变量后即启用 GitHub 登录）。可先用访客登录。',
      });
    }
    const redirect = `${PUBLIC_URL}/api/v1/auth/github/callback`;
    const url = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(process.env.GITHUB_CLIENT_ID)}&redirect_uri=${encodeURIComponent(redirect)}&scope=read:user user:email`;
    res.json({ configured: true, url });
  });

  router.get('/github/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send('缺少 code');
    if (!ghConfigured()) return res.status(500).send('未配置 GitHub OAuth');
    try {
      // 换 access token
      const tr = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code: String(code),
        }),
      });
      const td = await tr.json();
      if (td.error || !td.access_token) throw new Error(td.error_description || '换 token 失败');
      // 取用户信息
      const ur = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${td.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'our-benchmark' },
      });
      const gh = await ur.json();
      // 查找或创建本地用户
      let user = tables.users.all().find(u => u.provider === 'github' && u.githubId === gh.id);
      if (!user) {
        user = tables.users.insert({
          name: gh.login || ('gh-' + gh.id), provider: 'github',
          avatar: gh.avatar_url || null, githubId: gh.id, secret: crypto.randomBytes(16).toString('hex'),
        });
      } else if (user.avatar !== gh.avatar_url || user.name !== gh.login) {
        tables.users.update(user.id, { avatar: gh.avatar_url, name: gh.login });
      }
      const token = sign({ uid: user.id, exp: Date.now() + TOKEN_TTL_MS });
      // 浏览器场景：展示令牌供桌面端粘贴；也支持 json=1
      if (req.query.json === '1') return res.json({ ok: true, token, user: publicUser(user) });
      res.type('html').send(`<html><head><meta charset="utf-8"><title>登录成功</title>
<style>body{font-family:system-ui;background:#0a0f1e;color:#e8ecf8;display:grid;place-items:center;height:100vh;margin:0}
.box{max-width:560px;padding:36px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:18px;backdrop-filter:blur(20px)}
h2{margin:0 0 8px}code{word-break:break-all;display:block;background:rgba(0,0,0,.4);padding:12px;border-radius:10px;margin:12px 0;font-size:13px;color:#7dd3fc}p{color:#a7b1cc;font-size:14px;line-height:1.7}</style></head>
<body><div class="box"><h2>✅ GitHub 登录成功</h2>
<p>欢迎 <b>@${gh.login}</b>！把下面的令牌复制到 Our Benchmark 桌面端完成登录（登录弹窗 → GitHub 登录 → 粘贴授权码处粘贴此令牌，或直接关闭此页回到应用）：</p>
<code id="tk">${token}</code>
<p><button onclick="navigator.clipboard.writeText(document.getElementById('tk').textContent).then(()=>this.textContent='已复制 ✓')" style="padding:8px 18px;border-radius:10px;border:0;background:linear-gradient(135deg,#7c6cff,#22d3ee);color:#fff;font-weight:700;cursor:pointer">复制令牌</button></p></div></body></html>`);
    } catch (e) {
      res.status(500).send('GitHub 登录失败: ' + e.message);
    }
  });

  // 令牌直接交换（桌面端把浏览器回调页里复制的 token 发来验证）
  router.post('/exchange', (req, res) => {
    const token = String(req.body?.token || '');
    const payload = verify(token);
    if (!payload) return res.status(401).json({ error: '无效令牌' });
    const user = tables.users.get(payload.uid);
    if (!user) return res.status(401).json({ error: '用户不存在' });
    res.json({ ok: true, token, user: publicUser(user) });
  });

  return { router, authMiddleware };
}

module.exports = { authRouter };
