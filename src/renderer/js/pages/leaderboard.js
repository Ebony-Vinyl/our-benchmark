// 全球榜单 — AA 式数据表：粘性表头、排序、搜索、展开分析
Pages.leaderboard = function leaderboard(root) {
  const { esc, fmt, toast } = App;
  let disposed = false;
  const st = {
    mode: '',
    sort: 'intelligenceIndex',
    q: '',
    rows: [],
    expanded: null,
    showCats: false,
    loading: true,
    error: '',
    updatedAt: null,
  };

  root.innerHTML = `<div class="lb-page">
    <div class="page-head">
      <div>
        <h1 class="page-title">全球榜单</h1>
        <p class="page-sub">由社区桌面端上传的真实跑分与模拟成绩。同一模型取最高分，按智能指数排序。</p>
      </div>
      <div class="actions">
        <span class="lb-count" id="lbUpdated"></span>
        <button class="btn btn-sm" id="lbRefresh">刷新</button>
      </div>
    </div>

    <section class="lb-hero" id="lbHero">
      <div><div class="empty" style="text-align:left;padding:18px 0"><span class="spinner"></span></div></div>
      <div></div>
    </section>

    <div class="lb-toolbar">
      <div class="left">
        <div class="tabs" id="lbTabs">
          <button class="tab on" data-mode="">全部</button>
          <button class="tab" data-mode="real">真实跑分</button>
          <button class="tab" data-mode="mock">模拟跑分</button>
        </div>
      </div>
      <div class="right">
        <select class="lb-select" id="lbSort" aria-label="排序字段">
          <option value="intelligenceIndex">按智能指数</option>
          <option value="totalScore">按总分</option>
          <option value="accuracyOverall">按正确率</option>
        </select>
        <input class="lb-search" id="lbSearch" placeholder="搜索模型或 Agent" aria-label="搜索模型或 Agent">
        <button class="btn btn-sm" id="lbCols">展开列</button>
      </div>
    </div>

    <div class="lb-table-wrap" id="lbWrap">
      <table class="data" id="lbTable">
        <thead id="lbHead"></thead>
        <tbody id="lbBody"><tr><td colspan="8"><div class="empty"><span class="spinner"></span></div></td></tr></tbody>
      </table>
    </div>
  </div>`;

  const $ = (s) => root.querySelector(s);
  $('#lbRefresh').onclick = () => load();
  $('#lbSearch').oninput = (e) => { st.q = e.target.value.trim().toLowerCase(); renderRows(); };
  $('#lbSort').onchange = (e) => { st.sort = e.target.value; load(); };
  $('#lbCols').onclick = () => {
    st.showCats = !st.showCats;
    $('#lbCols').classList.toggle('btn-primary', st.showCats);
    $('#lbCols').textContent = st.showCats ? '收起列' : '展开列';
    renderHead();
    renderRows();
  };
  root.querySelectorAll('#lbTabs .tab').forEach(t => {
    t.onclick = () => {
      st.mode = t.dataset.mode;
      root.querySelectorAll('#lbTabs .tab').forEach(x => x.classList.toggle('on', x === t));
      load();
    };
  });

  function renderHead() {
    const sortable = (key, label, cls = '') => {
      const on = st.sort === key;
      return `<th class="sortable ${on ? 'sorted' : ''} ${cls}" data-sort="${key}">${label}<span class="sort">${on ? '▼' : '↕'}</span></th>`;
    };
    const catHeads = st.showCats ? Charts.CATS.map(c => `<th class="num" style="width:62px">${esc(Charts.catShort(c))}</th>`).join('') : '';
    $('#lbHead').innerHTML = `<tr>
      <th style="width:46px">#</th>
      <th style="min-width:240px">模型</th>
      <th style="width:150px">Agent</th>
      ${sortable('intelligenceIndex', '智能指数', 'num')}
      ${sortable('totalScore', '总分', 'num')}
      ${sortable('accuracyOverall', '正确率', 'num')}
      ${catHeads}
      <th class="num" style="width:96px">提交</th>
      <th style="width:26px"></th>
    </tr>`;
    root.querySelectorAll('#lbHead th[data-sort]').forEach(th => {
      th.onclick = () => {
        st.sort = th.dataset.sort;
        $('#lbSort').value = st.sort;
        load();
      };
    });
  }

  function filtered() {
    let rows = st.rows.slice();
    if (st.q) {
      rows = rows.filter(r =>
        String(r.model || '').toLowerCase().includes(st.q) ||
        String(r.agent || '').toLowerCase().includes(st.q) ||
        (r.agents || []).some(a => String(a).toLowerCase().includes(st.q))
      );
    }
    if (!['intelligenceIndex', 'totalScore', 'accuracyOverall'].includes(st.sort)) {
      rows.sort((a, b) => {
        const av = a.categories?.[st.sort]?.accuracy ?? -1;
        const bv = b.categories?.[st.sort]?.accuracy ?? -1;
        return bv - av;
      });
    }
    return rows;
  }

  function renderRows() {
    const body = $('#lbBody');
    if (!body) return;
    if (st.loading) {
      body.innerHTML = `<tr><td colspan="${st.showCats ? 14 : 8}"><div class="empty"><span class="spinner"></span></div></td></tr>`;
      return;
    }
    if (st.error) {
      body.innerHTML = `<tr><td colspan="${st.showCats ? 14 : 8}"><div class="table-empty"><b>无法连接服务器</b>${esc(st.error)}<div><button class="btn btn-sm mt16" id="lbRetry">重试</button></div></div></td></tr>`;
      const retry = root.querySelector('#lbRetry');
      if (retry) retry.onclick = () => load();
      return;
    }
    const rows = filtered();
    $('#lbUpdated').textContent = st.updatedAt ? `更新于 ${new Date(st.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : '';
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${st.showCats ? 14 : 8}"><div class="table-empty"><b>${st.q ? '没有匹配的模型' : '榜单还是空的'}</b>${st.q ? '换一个关键词试试。' : '跑一次分，成为第一个上榜的人。'}<div><button class="btn btn-sm mt16" id="lbGoRun">去跑分</button></div></div></td></tr>`;
      const go = root.querySelector('#lbGoRun');
      if (go) go.onclick = () => App.nav('run');
      return;
    }
    const cols = st.showCats ? 14 : 8;
    body.innerHTML = rows.map((r, i) => {
      const open = st.expanded === r.scoreId;
      const cats = st.showCats ? Charts.CATS.map(c => {
        const v = r.categories?.[c]?.accuracy;
        return `<td class="catcell"><div class="cv">${v == null ? '—' : (100 * v).toFixed(0)}</div><div class="mini"><i style="width:${v == null ? 0 : (100 * v).toFixed(0)}%"></i></div></td>`;
      }).join('') : '';
      return `<tr class="clickable ${open ? 'expanded' : ''}" data-id="${esc(r.scoreId)}" style="--i:${Math.min(i, 18)}">
        <td><span class="rank ${i < 3 ? 'top' : ''}">${String(i + 1).padStart(2, '0')}</span></td>
        <td>
          <div class="ident">
            <span class="avatar" style="width:26px;height:26px;border-radius:5px;font-size:10px">${esc(Charts.monogram(r.model))}</span>
            <div class="ident-text">
              <div class="ident-name">${esc(r.model)}</div>
              <div class="ident-sub">${r.mock ? '模拟成绩' : '真实跑分'} · ${esc((r.agents && r.agents[0]) || r.agent || '—')}</div>
            </div>
          </div>
        </td>
        <td class="muted" style="font-size:11.5px">${esc((r.agents && r.agents.slice(0, 2).join(', ')) || r.agent || '—')}</td>
        <td class="num"><span class="fig-lg" style="color:var(--accent)">${(Number(r.intelligenceIndex) || 0).toFixed(1)}</span></td>
        <td class="num">${fmt(r.totalScore)}</td>
        <td class="num">${(100 * (r.accuracyOverall || 0)).toFixed(1)}%</td>
        ${cats}
        <td class="num" style="font-size:11px;color:var(--muted)">${App.shortDate(r.lastSubmission)}</td>
        <td><span class="lb-row-arrow">›</span></td>
      </tr>
      ${open ? `<tr class="expand-row"><td colspan="${cols}">${expandHTML(r)}</td></tr>` : ''}`;
    }).join('');
    body.classList.add('anim-rows');
    body.querySelectorAll('tr.clickable').forEach(tr => {
      tr.onclick = () => {
        const id = tr.dataset.id;
        st.expanded = st.expanded === id ? null : id;
        renderRows();
      };
    });
    Charts.animateBars(body);
  }

  function expandHTML(r) {
    const cats = r.categories || {};
    const rows = Charts.CATS.map(c => {
      const v = cats[c]?.accuracy;
      return `<div class="expand-cat"><span class="n">${esc(Charts.catName(c))}</span><span class="t"><i style="width:${v == null ? 0 : (100 * v).toFixed(1)}%"></i></span><span class="v">${v == null ? '—' : (100 * v).toFixed(1)}</span></div>`;
    }).join('');
    return `<div class="expand-panel">
      <div class="expand-grid">
        <div>
          <h4>能力维度</h4>
          <div class="expand-cats">${rows}</div>
        </div>
        <div>
          <h4>六维雷达</h4>
          ${Charts.radar(Object.fromEntries(Charts.CATS.map(c => [c, cats[c]?.accuracy || 0])), { size: 260 })}
        </div>
        <div>
          <h4>成绩信息</h4>
          <div class="expand-meta">
            模型 <b>${esc(r.model)}</b><br>
            智能指数 <b>${(Number(r.intelligenceIndex) || 0).toFixed(1)}</b> / 100<br>
            总分 <b>${fmt(r.totalScore)}</b><br>
            总正确率 <b>${(100 * (r.accuracyOverall || 0)).toFixed(1)}%</b><br>
            Agent <b>${esc((r.agents || []).join(', ') || r.agent || '—')}</b><br>
            提交 <b>${esc(new Date(r.lastSubmission).toLocaleString('zh-CN'))}</b><br>
            <span class="mono">score ${esc(r.scoreId || '—')}</span>
          </div>
        </div>
      </div>
    </div>`;
  }

  function renderHero() {
    const hero = $('#lbHero');
    if (!hero) return;
    if (st.loading) return;
    if (st.error || !st.rows.length) {
      hero.innerHTML = `<div>
        <div class="tag">${st.error ? '服务器离线' : '等待第一个成绩'}</div>
        <h2>${st.error ? '榜单暂时不可达' : '还没有人上榜'}</h2>
        <p class="muted" style="font-size:12.5px;line-height:1.8;margin-top:10px;max-width:420px">${st.error ? '本地跑分与历史记录不受影响，恢复网络后刷新即可。' : '在桌面端完成一次跑分并上传，这里就会出现你的模型。'}</p>
      </div><div></div>`;
      return;
    }
    const top = filtered()[0] || st.rows[0];
    const second = st.rows[1];
    const gap = second ? (Number(top.intelligenceIndex) || 0) - (Number(second.intelligenceIndex) || 0) : 0;
    hero.innerHTML = `<div class="lb-leader">
      <div class="tag">当前第一 · ${top.mock ? '模拟成绩' : '真实跑分'}</div>
      <h2>${esc(top.model)}</h2>
      <div class="agent">${esc((top.agents || []).join(' · ') || top.agent || '—')}</div>
      <div class="score-line">
        <div class="score num" id="lbTopScore">0.0<small>智能指数</small></div>
        <div class="gap">${second ? `领先第二名 <b>${gap.toFixed(1)}</b> 分` : '目前唯一的上榜模型'}</div>
      </div>
    </div>
    <div>
      <div class="lb-toplist">${Charts.topBars(st.rows.slice(0, 5), { max: 100 })}</div>
    </div>`;
    App.countUp($('#lbTopScore'), Number(top.intelligenceIndex) || 0, { decimals: 1, duration: 1300 });
    Charts.animateBars(hero);
  }

  async function load() {
    st.loading = true;
    st.error = '';
    renderRows();
    renderHead();
    try {
      const q = `mode=${st.mode}&sort=${['intelligenceIndex', 'totalScore', 'accuracyOverall'].includes(st.sort) ? st.sort : 'intelligenceIndex'}&limit=200`;
      const r = await window.ourbench.serverLeaderboard(q);
      if (disposed) return;
      st.rows = r.leaderboard || [];
      st.loading = false;
      st.updatedAt = Date.now();
      if (st.expanded && !st.rows.some(x => x.scoreId === st.expanded)) st.expanded = null;
      renderHero();
      renderRows();
    } catch (e) {
      if (disposed) return;
      st.loading = false;
      st.error = e.message || '未知错误';
      renderHero();
      renderRows();
    }
  }

  renderHead();
  load();
  return () => { disposed = true; };
};
