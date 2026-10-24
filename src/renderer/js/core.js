// 应用外壳：路由 / 状态 / 通用组件 / 动效编排
const App = (() => {
  const PAGE_META = {
    home: { group: '工作台', title: '首页' },
    run: { group: '工作台', title: '开始跑分' },
    leaderboard: { group: '工作台', title: '全球榜单' },
    forum: { group: '社区', title: '社区论坛' },
    history: { group: '社区', title: '我的记录' },
    device: { group: '系统', title: '设备信息' },
    settings: { group: '系统', title: '设置' },
  };

  const state = {
    page: '',
    settings: null,
    user: null,
    agents: [],
    suites: [],
    runReport: null,
    lastRunCfg: null,
    stats: null,
  };

  let cleanup = null;
  const view = () => document.getElementById('view');
  const sheet = () => document.getElementById('sheet');
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------- utilities
  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = String(html).trim();
    return t.content.firstChild;
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('zh-CN');
  const pct = (x, d = 1) => (100 * (Number(x) || 0)).toFixed(d) + '%';
  const fixed = (x, d = 1) => (x == null || Number.isNaN(Number(x)) ? '—' : Number(x).toFixed(d));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function timeAgo(iso) {
    if (!iso) return '—';
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return '刚刚';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    if (s < 86400 * 30) return Math.floor(s / 86400) + ' 天前';
    return new Date(iso).toLocaleDateString('zh-CN');
  }
  function shortDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function avatarFor(name) {
    const label = String(name || 'U').trim().slice(0, 1).toUpperCase();
    let h = 0;
    for (const ch of String(name || 'U')) h = (h * 31 + ch.charCodeAt(0)) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="hsl(${h},28%,90%)"/><text x="32" y="42" text-anchor="middle" font-size="27" font-family="sans-serif" font-weight="600" fill="hsl(${h},30%,32%)">${esc(label)}</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  // ---------------------------------------------------------- toast
  function toast(msg, type = 'info', ms = 3200) {
    const host = document.getElementById('toasts');
    if (!host) return;
    const node = el(`<div class="toast ${type}" role="status">${esc(msg)}</div>`);
    host.appendChild(node);
    setTimeout(() => {
      node.classList.add('out');
      setTimeout(() => node.remove(), 260);
    }, ms);
  }

  // ---------------------------------------------------------- modal
  function modal({ title, sub = '', body = '', actions = [], wide = false, onMount, onClose } = {}) {
    const root = document.getElementById('overlay-root');
    const overlay = el(`<div class="overlay" role="dialog" aria-modal="true"></div>`);
    const box = el(`<div class="modal${wide ? ' wide' : ''}">
      <div class="modal-head">
        <div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
        <button class="modal-close" aria-label="关闭">&times;</button>
      </div>
      <div class="modal-body"></div>
      ${actions.length ? '<div class="modal-foot"></div>' : ''}
    </div>`);
    const bodyEl = box.querySelector('.modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else if (body) bodyEl.appendChild(body);

    const foot = box.querySelector('.modal-foot');
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      overlay.style.animation = 'fadeIn .18s ease reverse both';
      box.style.animation = 'modalIn .2s ease reverse both';
      setTimeout(() => overlay.remove(), 180);
      if (onClose) onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    box.querySelector('.modal-close').onclick = close;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    actions.forEach(a => {
      const b = el(`<button class="btn ${a.kind || ''}">${esc(a.label)}</button>`);
      b.onclick = () => a.onClick ? a.onClick(close, box) : close();
      foot.appendChild(b);
    });

    overlay.appendChild(box);
    root.appendChild(overlay);
    setTimeout(() => {
      const first = box.querySelector('input, textarea, select') || box.querySelector('.btn-primary');
      if (first) first.focus();
    }, 40);
    if (onMount) onMount(box, close);
    return { close, box };
  }

  function confirm({ title, body, confirmLabel = '确认', danger = false }) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
      modal({
        title,
        body: `<p style="font-size:13px;line-height:1.8;color:var(--ink-2)">${body}</p>`,
        actions: [
          { label: '取消', onClick: (close) => { finish(false); close(); } },
          { label: confirmLabel, kind: danger ? 'btn-danger' : 'btn-primary', onClick: (close) => { finish(true); close(); } },
        ],
        onClose: () => finish(false),
      });
    });
  }

  // ---------------------------------------------------------- transitions
  // 侧栏顺序决定转场方向：往下切页新页自下滑入，往上则自上滑入
  const PAGE_ORDER = Object.fromEntries(Object.keys(PAGE_META).map((k, i) => [k, i]));
  let sweepTimer = 0;
  function beginSweep(dir, kind) {
    const html = document.documentElement;
    html.dataset.navDir = dir;
    html.classList.add('vt-running');
    if (kind) html.classList.add('vt-' + kind);
    clearTimeout(sweepTimer);
    sweepTimer = setTimeout(() => {
      html.classList.remove('vt-running');
      if (kind) html.classList.remove('vt-' + kind);
    }, 780);
  }
  function endSweep(kind) {
    const html = document.documentElement;
    clearTimeout(sweepTimer);
    sweepTimer = setTimeout(() => {
      html.classList.remove('vt-running');
      if (kind) html.classList.remove('vt-' + kind);
    }, 60);
  }

  function transition(fn, kind = '') {
    const html = document.documentElement;
    beginSweep('fwd', kind);
    let ran = false;
    const done = () => endSweep(kind);
    const run = () => {
      if (ran) return;
      ran = true;
      try { fn(); } catch (e) { console.error('[transition]', e); }
    };
    if (document.startViewTransition && !reduced() && document.visibilityState === 'visible') {
      try {
        const t = document.startViewTransition(run);
        t.finished.then(done, done);
      } catch {
        run(); done();
      }
      // 隐藏窗口或浏览器跳过转场时，保证 DOM 仍然更新
      setTimeout(() => { if (!ran) { run(); done(); } }, 420);
    } else {
      run(); done();
    }
  }

  // ---------------------------------------------------------- router
  let navInd = null;
  function moveNavInd(page) {
    const nav = document.querySelector('.nav');
    if (!nav) return;
    if (!navInd) {
      navInd = el('<span class="nav-ind" aria-hidden="true"></span>');
      nav.appendChild(navInd);
      document.documentElement.classList.add('nav-ind-ready');
    }
    const link = nav.querySelector(`.nav-link[data-page="${page}"]`);
    if (!link) return;
    navInd.style.transform = `translateY(${link.offsetTop}px)`;
    navInd.style.height = link.offsetHeight + 'px';
  }

  function updateChrome(page) {
    const meta = PAGE_META[page] || PAGE_META.home;
    const group = document.getElementById('crumbGroup');
    const title = document.getElementById('crumbPage');
    if (group) group.textContent = meta.group;
    if (title) title.textContent = meta.title;
    document.querySelectorAll('.nav-link').forEach(b => {
      const on = b.dataset.page === page;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    moveNavInd(page);
    document.title = `${meta.title} — Our Benchmark`;
  }

  // 页签下划线：一根指示线在 .tabs 内滑动（榜单 / 记录页共用）
  function initTabIndicators(scope) {
    scope.querySelectorAll('.tabs').forEach(tabs => {
      if (tabs.dataset.ind) return;
      tabs.dataset.ind = '1';
      const ind = el('<span class="tabs-ind" aria-hidden="true"></span>');
      tabs.appendChild(ind);
      const move = () => {
        const on = tabs.querySelector('.tab.on');
        if (on) {
          ind.style.left = on.offsetLeft + 'px';
          ind.style.width = on.offsetWidth + 'px';
        }
      };
      tabs.__moveInd = move;
      requestAnimationFrame(move);
      tabs.addEventListener('click', (e) => {
        if (e.target.closest('.tab')) setTimeout(move, 0);
      });
    });
  }

  function renderPage(page) {
    if (typeof cleanup === 'function') { try { cleanup(); } catch { } }
    cleanup = null;
    state.page = page;
    updateChrome(page);
    if (page !== 'run') state._chamber = false;
    const host = view();
    host.scrollTop = 0;
    host.innerHTML = '';
    host.classList.toggle('chamber', page === 'run' && state._chamber === true);
    sheet().classList.toggle('chamber', page === 'run' && state._chamber === true);
    const root = document.createElement('div');
    root.className = 'page';
    host.appendChild(root);
    const fn = (window.Pages && Pages[page]) || (window.Pages && Pages.home);
    try {
      const out = fn ? fn(root) : null;
      if (typeof out === 'function') cleanup = out;
    } catch (e) {
      console.error('[page]', page, e);
      root.innerHTML = `<div class="empty"><b>页面加载失败</b>${esc(e.message)}</div>`;
    }
    initTabIndicators(root);
    if (window.FX) FX.observe(root);
  }

  function nav(page, opts = {}) {
    if (!PAGE_META[page]) page = 'home';
    if (page === state.page && !opts.force) {
      view().scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
      return Promise.resolve();
    }
    const dir = PAGE_ORDER[page] >= PAGE_ORDER[state.page] ? 'fwd' : 'back';
    return new Promise((resolve) => {
      let ran = false;
      const run = () => {
        if (ran) return;
        ran = true;
        renderPage(page);
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      };
      if (opts.instant || opts.force) { run(); return; }
      beginSweep(dir);
      if (document.startViewTransition && !reduced() && document.visibilityState === 'visible') {
        try {
          const t = document.startViewTransition(run);
          t.finished.then(() => { endSweep(); resolve(); }, () => { endSweep(); resolve(); });
        } catch { run(); }
        setTimeout(() => { if (!ran) run(); }, 420);
      } else {
        run();
      }
    });
  }

  function setChamber(on) {
    state._chamber = !!on;
    sheet().classList.toggle('chamber', !!on);
    view().classList.toggle('chamber', !!on);
  }

  function refresh() {
    if (state._chamber) {
      toast('跑分进行中，完成后再刷新', 'info');
      return Promise.resolve();
    }
    const page = state.page;
    return new Promise((resolve) => {
      let ran = false;
      const run = () => {
        if (ran) return;
        ran = true;
        renderPage(page);
        resolve();
      };
      if (document.startViewTransition && !reduced() && document.visibilityState === 'visible') {
        try {
          const t = document.startViewTransition(run);
          t.finished.then(resolve, resolve);
        } catch { run(); }
        setTimeout(() => { if (!ran) run(); }, 420);
      } else run();
    });
  }

  // ---------------------------------------------------------- count up
  function countUp(node, target, { decimals = 0, duration = 900, suffix = '', format, ease } = {}) {
    if (!node) return;
    const end = Number(target) || 0;
    const render = (v) => (format ? format(v) : v.toFixed(decimals) + suffix);
    if (reduced() || !window.FX) { node.textContent = render(end); node._cuShown = end; return; }
    // 从「当前显示值」续滚，而不是上次的目标值，重入时不跳变
    const from = node._cuShown != null ? node._cuShown : (Number(node.dataset.cu) || 0);
    node._cuShown = end;
    if (node._cu) node._cu.stop();
    node._cu = FX.tween({
      duration: from === end ? 1 : duration,
      ease: ease || FX.ease.outExpo,
      step(e) {
        const v = from + (end - from) * e;
        node._cuShown = v;
        node.textContent = render(v);
      },
    });
  }

  // ---------------------------------------------------------- server status
  async function refreshServer() {
    const dot = document.querySelector('#serverDot .dot');
    const text = document.getElementById('serverDotText');
    const top = document.getElementById('topbarStatus');
    const pulse = document.querySelector('.topbar-mid .pulse');
    try {
      await window.ourbench.serverHealth();
      if (dot) dot.className = 'dot ok';
      if (text) text.textContent = '服务器在线';
      if (top) top.textContent = '全球榜单已连接 · 模拟模式就绪';
      if (pulse) pulse.classList.remove('bad');
      state.serverOnline = true;
    } catch {
      if (dot) dot.className = 'dot bad';
      if (text) text.textContent = '服务器离线';
      if (top) top.textContent = '服务器离线 · 本地功能可用';
      if (pulse) pulse.classList.add('bad');
      state.serverOnline = false;
    }
  }

  // ---------------------------------------------------------- account
  function renderAccount() {
    const login = document.getElementById('loginBtn');
    const chip = document.getElementById('userChip');
    const accName = document.getElementById('accountName');
    const accSub = document.getElementById('accountSub');
    const accAvatar = document.getElementById('accountAvatar');
    if (state.user) {
      login.classList.add('hidden');
      chip.classList.remove('hidden');
      const name = state.user.user.name;
      document.getElementById('userName').textContent = name;
      const av = state.user.user.avatar || avatarFor(name);
      document.getElementById('userAvatar').src = av;
      if (accName) accName.textContent = name;
      if (accSub) accSub.textContent = state.user.user.provider === 'github' ? 'GitHub 已认证' : '访客身份';
      if (accAvatar) accAvatar.innerHTML = `<img src="${esc(av)}" alt="">`;
    } else {
      login.classList.remove('hidden');
      chip.classList.add('hidden');
      if (accName) accName.textContent = '访客';
      if (accSub) accSub.textContent = '未登录';
      if (accAvatar) accAvatar.textContent = '访';
    }
  }

  function openLogin() {
    const body = el(`<div>
      <div class="field">
        <label for="guestName">访客昵称</label>
        <input id="guestName" maxlength="20" placeholder="给自己起个名字，直接开始">
        <div class="hint">访客即可上传成绩、发帖。GitHub 登录会获得认证标记。</div>
      </div>
      <div class="divider" style="margin:18px 0"></div>
      <button class="btn btn-block" id="ghBtn">使用 GitHub 登录</button>
    </div>`);
    const m = modal({
      title: '登录 Our Benchmark',
      sub: '登录后把成绩送上全球榜单，并加入社区讨论。',
      body,
      actions: [
        { label: '取消', onClick: (close) => close() },
        { label: '访客登录', kind: 'btn-primary', onClick: async (close) => {
          const input = body.querySelector('#guestName');
          const name = input.value.trim() || ('访客' + Math.floor(Math.random() * 9000 + 1000));
          try {
            const r = await window.ourbench.guestLogin(name);
            state.user = r;
            localStorage.setItem('ob_user', JSON.stringify(r));
            try { await window.ourbench.setSettings({ _token: r.token }); } catch { }
            renderAccount();
            toast('欢迎，' + r.user.name, 'ok');
            close();
            if (window.Pages && Pages[state.page] && state.page === 'history') refresh();
          } catch (e) { toast('登录失败：' + e.message, 'err'); }
        } },
      ],
    });
    body.querySelector('#ghBtn').onclick = async () => {
      try {
        const r = await window.ourbench.githubLoginUrl();
        if (!r.configured) return toast(r.reason || '服务器未配置 GitHub OAuth，可先用访客登录', 'info', 5000);
        window.ourbench.openExternal(r.url);
        const codeBody = el(`<div>
          <p style="font-size:12.5px;line-height:1.8;color:var(--muted)">已在浏览器打开 GitHub 授权页。授权完成后，把跳转地址中的 <b>code=</b> 参数粘贴到下面。</p>
          <div class="field mt16"><label for="ghCode">授权码</label><input id="ghCode" placeholder="例如 a1b2c3d4e5f6..."></div>
        </div>`);
        modal({
          title: '完成 GitHub 授权',
          body: codeBody,
          actions: [
            { label: '取消', onClick: (close) => close() },
            { label: '提交', kind: 'btn-primary', onClick: async (close) => {
              const code = codeBody.querySelector('#ghCode').value.trim();
              if (!code) return toast('请粘贴授权码', 'err');
              try {
                const r2 = await window.ourbench.githubCallback(code);
                state.user = r2;
                localStorage.setItem('ob_user', JSON.stringify(r2));
                try { await window.ourbench.setSettings({ _token: r2.token }); } catch { }
                renderAccount();
                toast('GitHub 登录成功，' + r2.user.name, 'ok');
                close(); m.close();
              } catch (e) { toast('失败：' + e.message, 'err'); }
            } },
          ],
        });
      } catch (e) { toast('获取授权地址失败：' + e.message, 'err'); }
    };
  }

  function openAccount() {
    if (!state.user) return openLogin();
    const u = state.user.user;
    const body = el(`<div>
      <div class="user-menu-head">
        <div class="avatar"><img src="${esc(u.avatar || avatarFor(u.name))}" alt=""></div>
        <div><div class="nm">${esc(u.name)}</div><div class="sub">${u.provider === 'github' ? 'GitHub 认证用户' : '访客用户'} · #${esc(u.id)}</div></div>
      </div>
      <div class="user-menu-actions">
        <button id="goMy"><span>我的成绩</span><span class="mono faint">→</span></button>
        <button id="goLb"><span>全球榜单</span><span class="mono faint">→</span></button>
        <button id="logout" class="danger"><span>退出登录</span><span class="mono faint">×</span></button>
      </div>
    </div>`);
    const m = modal({ title: '账户', body });
    body.querySelector('#goMy').onclick = () => { m.close(); nav('history'); };
    body.querySelector('#goLb').onclick = () => { m.close(); nav('leaderboard'); };
    body.querySelector('#logout').onclick = () => {
      state.user = null;
      localStorage.removeItem('ob_user');
      try { window.ourbench.setSettings({ _token: null }); } catch { }
      renderAccount();
      m.close();
      toast('已退出登录', 'info');
      if (state.page === 'history') refresh();
    };
  }

  // ---------------------------------------------------------- init
  async function init() {
    try { state.settings = await window.ourbench.getSettings(); } catch { state.settings = {}; }
    try {
      const saved = localStorage.getItem('ob_user');
      if (saved) {
        const { token } = JSON.parse(saved);
        const r = await window.ourbench.getMe(token);
        state.user = { token, user: r.user };
      }
    } catch { localStorage.removeItem('ob_user'); }
    renderAccount();

    document.querySelectorAll('.nav-link').forEach(b => b.addEventListener('click', () => nav(b.dataset.page)));
    const brand = document.getElementById('brand');
    brand.addEventListener('click', () => nav('home'));
    brand.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nav('home'); } });
    document.getElementById('loginBtn').addEventListener('click', openLogin);
    document.getElementById('userChip').addEventListener('click', openAccount);
    document.getElementById('accountBtn').addEventListener('click', openAccount);
    document.getElementById('refreshBtn').addEventListener('click', () => refresh());

    document.getElementById('wcMin').addEventListener('click', () => window.ourbench.winControl('minimize'));
    document.getElementById('wcMax').addEventListener('click', () => window.ourbench.winControl('maximize'));
    document.getElementById('wcClose').addEventListener('click', () => window.ourbench.winControl('close'));
    const maxBtn = document.getElementById('wcMax');
    window.ourbench.onMaximizedChange((v) => {
      document.body.classList.toggle('maximized', v);
      maxBtn.innerHTML = v ? '&#10064;' : '&#9633;';
      maxBtn.title = v ? '还原' : '最大化';
      maxBtn.setAttribute('aria-label', v ? '还原' : '最大化');
    });

    refreshServer();
    setInterval(refreshServer, 60000);

    // 侧栏折叠/窗口缩放时，指示器要贴住当前项
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && 'ResizeObserver' in window) {
      new ResizeObserver(() => moveNavInd(state.page || 'home')).observe(sidebar);
    }
    window.addEventListener('resize', () => {
      document.querySelectorAll('.tabs').forEach(t => { if (t.__moveInd) t.__moveInd(); });
    });

    await nav('home', { instant: true });

    const ready = () => document.body.classList.add('ready');
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(ready);
      setTimeout(ready, 900);
    } else setTimeout(ready, 100);
  }

  return {
    state, nav, refresh, transition, setChamber, init,
    toast, modal, confirm, el, esc, fmt, pct, fixed, clamp,
    timeAgo, shortDate, avatarFor, countUp, openLogin, openAccount,
    refreshServer, renderAccount,
  };
})();
window.App = App;
window.Pages = window.Pages || {};
