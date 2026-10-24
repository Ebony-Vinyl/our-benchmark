// 社区论坛 — 列表 / 详情 / 发帖 / 回复
Pages.forum = function forum(root) {
  const { esc, fmt, toast, state } = App;
  let disposed = false;
  let category = '';
  let threads = [];
  let loading = true;
  let error = '';

  const CATS = [['', '全部'], ['score', '晒分'], ['discussion', '模型讨论'], ['help', '求助'], ['benchmark', '题库/跑分'], ['offtopic', '灌水']];
  const CAT_LABEL = Object.fromEntries(CATS.filter(x => x[0]));

  root.innerHTML = `<div class="forum-page">
    <div class="page-head forum-head">
      <div>
        <h1 class="page-title">社区论坛</h1>
        <p class="page-sub">聊聊模型、晒晒跑分、找找攻略。发帖前需要登录。</p>
      </div>
      <div class="actions">
        <button class="btn btn-primary" id="newThread">发帖</button>
      </div>
    </div>
    <div class="forum-layout">
      <div class="forum-main">
        <div class="tabs" id="forumTabs" style="margin-bottom:12px"></div>
        <div class="forum-list" id="forumList"><div class="empty"><span class="spinner"></span></div></div>
      </div>
      <aside class="forum-rail" id="forumRail">
        <div class="rail-section"><h3>社区数据</h3><div class="rail-stat"><span>帖子</span><span class="v">—</span></div><div class="rail-stat"><span>回复</span><span class="v">—</span></div><div class="rail-stat"><span>用户</span><span class="v">—</span></div></div>
      </aside>
    </div>
  </div>`;

  const $ = (s) => root.querySelector(s);
  $('#newThread').onclick = () => openComposer();
  renderTabs();
  load();

  function renderTabs() {
    $('#forumTabs').innerHTML = CATS.map(([c, label]) =>
      `<button class="tab ${category === c ? 'on' : ''}" data-cat="${c}">${label}</button>`).join('');
    root.querySelectorAll('#forumTabs .tab').forEach(t => {
      t.onclick = () => { category = t.dataset.cat; renderTabs(); load(); };
    });
  }

  async function load() {
    loading = true;
    error = '';
    renderList();
    loadRail();
    try {
      const r = await window.ourbench.serverThreads(category ? 'category=' + category : '');
      if (disposed) return;
      threads = r.threads || [];
      loading = false;
      renderList();
    } catch (e) {
      if (disposed) return;
      loading = false;
      error = e.message || '未知错误';
      renderList();
    }
  }

  async function loadRail() {
    const rail = $('#forumRail');
    if (!rail) return;
    try {
      const [stats, all] = await Promise.all([
        window.ourbench.serverStats(),
        window.ourbench.serverThreads('limit=100'),
      ]);
      if (disposed) return;
      const counts = {};
      for (const t of (all.threads || [])) counts[t.category] = (counts[t.category] || 0) + 1;
      rail.innerHTML = `<div class="rail-section">
        <h3>社区数据</h3>
        <div class="rail-stat"><span>帖子</span><span class="v">${fmt(stats.threads)}</span></div>
        <div class="rail-stat"><span>回复</span><span class="v">${fmt(stats.posts)}</span></div>
        <div class="rail-stat"><span>用户</span><span class="v">${fmt(stats.users)}</span></div>
      </div>
      <div class="rail-section">
        <h3>板块</h3>
        ${CATS.filter(x => x[0]).map(([c, l]) => `<div class="rail-cat"><span>${l}</span><span class="c">${String(counts[c] || 0).padStart(2, '0')}</span></div>`).join('')}
      </div>
      <div class="rail-section" style="border-bottom:0">
        <h3>发帖提示</h3>
        <p class="rail-note">晒分请带上 <b>模型名、Agent、题库规模</b>；求助请先说明系统与报错。理性讨论，不攻击模型或用户。</p>
      </div>`;
    } catch {
      if (disposed) return;
      rail.innerHTML = `<div class="rail-section"><h3>社区数据</h3><p class="rail-note">服务器离线，暂时读不到社区统计。</p></div>`;
    }
  }

  function renderList() {
    const box = $('#forumList');
    if (!box) return;
    if (loading) { box.innerHTML = '<div class="empty"><span class="spinner"></span></div>'; return; }
    if (error) {
      box.innerHTML = `<div class="empty"><b>无法连接服务器</b>${esc(error)}<div><button class="btn btn-sm mt16" id="fRetry">重试</button></div></div>`;
      const b = box.querySelector('#fRetry');
      if (b) b.onclick = load;
      return;
    }
    if (!threads.length) {
      box.innerHTML = `<div class="empty"><b>还没有帖子</b>来发第一帖，晒出你的跑分或聊聊模型。<div><button class="btn btn-primary btn-sm mt16" id="fFirst">发帖</button></div></div>`;
      const b = box.querySelector('#fFirst');
      if (b) b.onclick = () => openComposer();
      return;
    }
    box.innerHTML = threads.map(t => `<div class="thread-row" data-id="${esc(t.id)}">
      <span class="avatar" style="width:30px;height:30px;border-radius:50%">${t.authorAvatar ? `<img src="${esc(t.authorAvatar)}" alt="">` : esc((t.authorName || '?').slice(0, 1))}</span>
      <div style="min-width:0">
        <div class="title">${t.pinned ? '<span class="pin">置顶</span>' : ''}${esc(t.title)}</div>
        <div class="meta"><span>${esc(t.authorName || '匿名')}${t.authorProvider === 'github' ? ' · GitHub' : ''}</span><span>${esc(CAT_LABEL[t.category] || t.category)}</span><span>${App.timeAgo(t.createdAt)}</span></div>
      </div>
      <div class="stat"><b>${t.replies || 0}</b><span>回复</span></div>
      <div class="stat"><b>${t.likes || 0}</b><span>赞</span></div>
    </div>`).join('');
    box.querySelectorAll('.thread-row').forEach(row => {
      row.onclick = () => openDetail(row.dataset.id);
    });
  }

  function openDetail(id) {
    App.transition(() => {
      root.innerHTML = '<div class="thread-detail"><div class="empty"><span class="spinner"></span></div></div>';
      renderDetail(root, id);
    });
  }

  async function renderDetail(host, id) {
    let t;
    try { t = await window.ourbench.serverThread(id); }
    catch (e) {
      host.innerHTML = `<div class="empty"><b>加载失败</b>${esc(e.message)}<div><button class="btn btn-sm mt16" id="dBack">返回列表</button></div></div>`;
      host.querySelector('#dBack').onclick = back;
      return;
    }
    if (disposed) return;
    host.innerHTML = `<div class="thread-detail">
      <button class="btn btn-sm thread-back" id="dBack">← 返回列表</button>
      <h1>${t.pinned ? '<span class="pin" style="font-size:12px;color:var(--accent)">置顶</span> ' : ''}${esc(t.title)}</h1>
      <div class="thread-byline">
        <span class="avatar" style="width:26px;height:26px;border-radius:50%">${t.authorAvatar ? `<img src="${esc(t.authorAvatar)}" alt="">` : esc((t.authorName || '?').slice(0, 1))}</span>
        <b style="color:var(--ink);font-weight:500">${esc(t.authorName || '匿名')}</b>
        ${t.authorProvider === 'github' ? '<span class="pill pill-neutral">GitHub</span>' : '<span class="pill pill-outline">访客</span>'}
        <span>${App.timeAgo(t.createdAt)}</span>
        <span>·</span>
        <span>${esc(CAT_LABEL[t.category] || t.category)}</span>
      </div>
      <div class="thread-body">${esc(t.body)}</div>
      <div class="thread-actions">
        <button class="btn btn-sm" id="likeBtn">赞 <span class="mono" id="likeCount">${t.likes || 0}</span></button>
        <button class="btn btn-sm" id="replyFocus">回复</button>
      </div>
      <div class="replies">
        <div class="result-section-head"><h2>回复 ${(t.posts || []).length}</h2><span class="note">按时间排序</span></div>
        ${(t.posts || []).map(p => `<div class="reply">
          <span class="avatar" style="width:28px;height:28px;border-radius:50%">${p.authorAvatar ? `<img src="${esc(p.authorAvatar)}" alt="">` : esc((p.authorName || '?').slice(0, 1))}</span>
          <div><div class="who">${esc(p.authorName || '匿名')}${p.authorProvider === 'github' ? ' <span class="pill pill-neutral" style="height:16px;font-size:9px">GitHub</span>' : ''}<span>${App.timeAgo(p.createdAt)}</span></div><div class="body">${esc(p.body)}</div></div>
        </div>`).join('') || '<div class="empty" style="padding:26px 0">暂无回复</div>'}
      </div>
      <div class="reply-composer">
        <div class="field"><label for="replyBody">你的回复</label><textarea id="replyBody" placeholder="友善发言，理性讨论"></textarea></div>
        <div class="row" style="justify-content:flex-end"><button class="btn btn-primary" id="replyGo">回复</button></div>
      </div>
    </div>`;
    const $d = (s) => host.querySelector(s);
    $d('#dBack').onclick = back;
    $d('#replyFocus').onclick = () => { $d('#replyBody').focus(); $d('#replyBody').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    $d('#likeBtn').onclick = async () => {
      if (!state.user) { toast('请先登录', 'info'); return App.openLogin(); }
      try {
        const r = await window.ourbench.likeThread(state.user.token, id);
        $d('#likeCount').textContent = r.likes ?? t.likes ?? 0;
        if (r.note) toast(r.note, 'info');
      } catch (e) { toast('点赞失败：' + e.message, 'err'); }
    };
    $d('#replyGo').onclick = async () => {
      if (!state.user) { toast('请先登录', 'info'); return App.openLogin(); }
      const body = $d('#replyBody').value.trim();
      if (!body) return toast('内容不能为空', 'err');
      const btn = $d('#replyGo');
      btn.disabled = true;
      try {
        await window.ourbench.postReply({ token: state.user.token, threadId: id, body });
        toast('回复成功', 'ok');
        renderDetail(host, id);
      } catch (e) {
        btn.disabled = false;
        toast('回复失败：' + e.message, 'err');
      }
    };
  }

  function back() {
    App.transition(() => {
      root.innerHTML = `<div class="forum-page">
        <div class="page-head forum-head">
          <div><h1 class="page-title">社区论坛</h1><p class="page-sub">聊聊模型、晒晒跑分、找找攻略。发帖前需要登录。</p></div>
          <div class="actions"><button class="btn btn-primary" id="newThread">发帖</button></div>
        </div>
        <div class="forum-layout">
          <div class="forum-main">
            <div class="tabs" id="forumTabs" style="margin-bottom:12px"></div>
            <div class="forum-list" id="forumList"><div class="empty"><span class="spinner"></span></div></div>
          </div>
          <aside class="forum-rail" id="forumRail"></aside>
        </div>
      </div>`;
      $('#newThread').onclick = () => openComposer();
      renderTabs();
      load();
    });
  }

  function openComposer() {
    if (!state.user) { toast('发帖前请先登录', 'info'); return App.openLogin(); }
    const body = App.el(`<div>
      <div class="field"><label for="ntCat">板块</label><select id="ntCat">${CATS.filter(x => x[0]).map(([c, l]) => `<option value="${c}">${l}</option>`).join('')}</select></div>
      <div class="field"><label for="ntTitle">标题</label><input id="ntTitle" maxlength="80" placeholder="一句话标题"></div>
      <div class="field"><label for="ntBody">内容</label><textarea id="ntBody" placeholder="正文，支持多行"></textarea></div>
    </div>`);
    App.modal({
      title: '发布新帖',
      sub: '发在合适的板块，更容易被看到。',
      body,
      actions: [
        { label: '取消', onClick: (close) => close() },
        { label: '发布', kind: 'btn-primary', onClick: async (close, box) => {
          const title = body.querySelector('#ntTitle').value.trim();
          const text = body.querySelector('#ntBody').value.trim();
          if (!title || !text) return toast('标题和内容都要填', 'err');
          try {
            await window.ourbench.postThread({ token: state.user.token, body: { title, body: text, category: body.querySelector('#ntCat').value } });
            toast('发布成功', 'ok');
            close();
            load();
          } catch (e) { toast('发布失败：' + e.message, 'err'); }
        } },
      ],
    });
  }

  return () => { disposed = true; };
};
