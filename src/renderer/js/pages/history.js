// 我的记录 — 本地历史 + 云端成绩
Pages.history = function history(root) {
  const { esc, fmt, toast, state } = App;
  let disposed = false;
  let tab = 'local';
  let local = [];
  let cloud = null;
  let cloudError = '';

  root.innerHTML = `<div class="history-page">
    <div class="page-head">
      <div>
        <h1 class="page-title">我的记录</h1>
        <p class="page-sub">本地历史保存在这台机器上；云端成绩来自你上传到全球榜单的跑分。</p>
      </div>
      <div class="actions" id="histActions"></div>
    </div>
    <div class="tabs" id="histTabs" style="margin-bottom:14px">
      <button class="tab on" data-tab="local">本地记录</button>
      <button class="tab" data-tab="cloud">云端成绩</button>
    </div>
    <div id="histBody"><div class="empty"><span class="spinner"></span></div></div>
  </div>`;

  const $ = (s) => root.querySelector(s);
  root.querySelectorAll('#histTabs .tab').forEach(t => {
    t.onclick = () => {
      tab = t.dataset.tab;
      root.querySelectorAll('#histTabs .tab').forEach(x => x.classList.toggle('on', x === t));
      render();
    };
  });
  load();

  async function load() {
    try {
      local = await window.ourbench.getHistory();
      if (disposed) return;
    } catch { local = []; }
    if (state.user) {
      try {
        const r = await window.ourbench.getMyScores(state.user.token);
        cloud = r.scores || [];
      } catch (e) { cloudError = e.message; cloud = []; }
    } else {
      cloud = null;
    }
    render();
  }

  function render() {
    const body = $('#histBody');
    const actions = $('#histActions');
    if (!body) return;
    actions.innerHTML = '';
    if (tab === 'local') {
      if (local.length) {
        const b = App.el('<button class="btn btn-sm btn-danger">清空本地记录</button>');
        b.onclick = async () => {
          const ok = await App.confirm({
            title: '清空本地记录',
            body: '将删除这台机器上的全部跑分历史，无法恢复。云端成绩不受影响。',
            confirmLabel: '清空',
            danger: true,
          });
          if (!ok) return;
          await window.ourbench.clearHistory();
          local = [];
          render();
          toast('已清空本地记录', 'info');
        };
        actions.appendChild(b);
      }
      if (!local.length) {
        body.innerHTML = `<div class="empty" style="padding:64px 0"><b>还没有本地记录</b>跑一次分，结果会自动保存在这里。<div><button class="btn btn-primary btn-sm mt16" id="hGo">开始跑分</button></div></div>`;
        const g = body.querySelector('#hGo');
        if (g) g.onclick = () => App.nav('run');
        return;
      }
      const best = local.reduce((m, h) => Math.max(m, Number(h.intelligenceIndex) || 0), 0);
      const avg = local.reduce((s2, h) => s2 + (Number(h.intelligenceIndex) || 0), 0) / local.length;
      body.innerHTML = `<div class="hist-summary">
        <div><div class="k">本地记录</div><div class="v">${local.length}</div></div>
        <div><div class="k">最佳智能指数</div><div class="v">${best.toFixed(1)}</div></div>
        <div><div class="k">平均智能指数</div><div class="v">${avg.toFixed(1)}</div></div>
        <div><div class="k">最近一次</div><div class="v" style="font-size:13px;font-family:var(--font-sans)">${esc(App.timeAgo(local[0].time))}</div></div>
      </div>
      <div class="hist-table-wrap">
        <div class="hist-row head"><span>#</span><span>模型</span><span>Agent</span><span style="text-align:right">智能指数</span><span style="text-align:right">总分</span><span style="text-align:right">正确率</span><span style="text-align:right">时间</span></div>
        ${local.map((h, i) => `<div class="hist-row" data-i="${i}" title="查看详情">
          <span class="r">${String(i + 1).padStart(2, '0')}</span>
          <span class="m">${esc(h.model)}<small>${h.mock ? '模拟' : '真实'} · ${esc(h.runId || '')}</small></span>
          <span class="muted">${esc(h.agent || '—')}</span>
          <span class="n" style="color:var(--accent)">${Number(h.intelligenceIndex || 0).toFixed(1)}</span>
          <span class="n">${fmt(h.totalScore)}</span>
          <span class="n">${(100 * (h.accuracyOverall || 0)).toFixed(1)}%</span>
          <span class="d">${esc(App.timeAgo(h.time))} <span class="faint">›</span></span>
        </div>`).join('')}
      </div>`;
      body.querySelectorAll('.hist-row[data-i]').forEach(row => {
        row.onclick = () => showLocal(local[Number(row.dataset.i)]);
      });
    } else {
      if (!state.user) {
        body.innerHTML = `<div class="empty" style="padding:64px 0"><b>登录后查看云端成绩</b>上传过的成绩会显示在这里，并附带当前排名。<div><button class="btn btn-primary btn-sm mt16" id="hLogin">登录</button></div></div>`;
        const b = body.querySelector('#hLogin');
        if (b) b.onclick = () => App.openLogin();
        return;
      }
      if (cloudError) {
        body.innerHTML = `<div class="empty"><b>加载失败</b>${esc(cloudError)}</div>`;
        return;
      }
      if (!cloud || !cloud.length) {
        body.innerHTML = `<div class="empty" style="padding:64px 0"><b>云端暂无成绩</b>跑一次分，在结果页点“上传至全球榜单”。<div><button class="btn btn-primary btn-sm mt16" id="hGo2">开始跑分</button></div></div>`;
        const g = body.querySelector('#hGo2');
        if (g) g.onclick = () => App.nav('run');
        return;
      }
      body.innerHTML = `<div class="hist-table-wrap">
        <div class="hist-row head"><span>#</span><span>模型</span><span>Agent</span><span style="text-align:right">智能指数</span><span style="text-align:right">总分</span><span style="text-align:right">排名</span><span style="text-align:right">时间</span></div>
        ${cloud.map((s, i) => `<div class="hist-row">
          <span class="r">${String(i + 1).padStart(2, '0')}</span>
          <span class="m">${esc(s.model)}<small>${s.mock ? '模拟' : '真实'} · score ${esc(String(s.id).slice(0, 8))}</small></span>
          <span class="muted">${esc(s.agent || '—')}</span>
          <span class="n" style="color:var(--accent)">${Number(s.intelligenceIndex || 0).toFixed(1)}</span>
          <span class="n">${fmt(s.totalScore)}</span>
          <span class="n">${s.rank ? '#' + s.rank : '—'}</span>
          <span class="d">${esc(App.shortDate(s.createdAt))}</span>
        </div>`).join('')}
      </div>`;
    }
  }

  function showLocal(h) {
    const cats = h.categories || {};
    const suites = h.suites || {};
    const body = App.el(`<div>
      <div class="result-sub" style="color:var(--ink-2);margin-top:0">
        <span>智能指数 <b style="color:var(--ink)">${Number(h.intelligenceIndex || 0).toFixed(1)}</b></span>
        <span>总分 <b style="color:var(--ink)">${fmt(h.totalScore)}</b></span>
        <span>正确率 <b style="color:var(--ink)">${(100 * (h.accuracyOverall || 0)).toFixed(1)}%</b></span>
      </div>
      <div class="bar-list mt16">
        ${Object.entries(cats).map(([c, v]) => `<div class="bar-row"><div class="lb">${esc(Charts.catName(c))}</div><div class="tr"><i style="width:${(100 * (v.accuracy || 0)).toFixed(1)}%"></i></div><div class="pc">${(100 * (v.accuracy || 0)).toFixed(1)}%</div></div>`).join('')}
      </div>
      <div class="mt24">
        <h3 style="font-size:13px;font-weight:600;margin-bottom:8px">分套件正确率</h3>
        <div class="table-wrap"><table class="data"><thead><tr><th>套件</th><th class="num">判分</th><th class="num">正确率</th></tr></thead><tbody>
          ${Object.entries(suites).map(([sid, s]) => `<tr><td>${esc(sid)}</td><td class="num">${s.graded}</td><td class="num">${(100 * (s.accuracy || 0)).toFixed(1)}%</td></tr>`).join('')}
        </tbody></table></div>
      </div>
    </div>`);
    App.modal({ title: esc(h.model), sub: `${esc(h.agent || '')} · ${new Date(h.time).toLocaleString('zh-CN')}`, body, wide: true });
  }

  return () => { disposed = true; };
};
