// Our Benchmark — public leaderboard site
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n || 0).toLocaleString('zh-CN');
const CATS = ['code', 'science', 'general', 'agent', 'long_context', 'cyber'];
const CAT_NAMES = { code: '代码', science: '科学推理', general: '通用能力', agent: '智能体', long_context: '长上下文', cyber: '网络安全' };
const CAT_SHORT = { code: '代码', science: '科学', general: '通用', agent: '智能体', long_context: '长文', cyber: '安全' };
const state = { mode: '', sort: 'intelligenceIndex', q: '', rows: [], expanded: null, showCats: false, loading: true, error: '' };

function monogram(name) {
  const s = String(name || '?').trim();
  const token = s.split(/[\s\-_/·]+/).filter(Boolean)[0] || s;
  const chars = Array.from(token.replace(/[^A-Za-z0-9\u4e00-\u9fa5]/g, ''));
  return (chars.slice(0, 2).join('') || s.slice(0, 2)).toUpperCase();
}
function shortDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function countUp(el, target, { duration = 900 } = {}) {
  if (!el) return;
  const end = Number(target) || 0;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = fmt(end); return; }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const e = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(Math.round(end * e));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------- radar
function radar(data) {
  const cx = 160, cy = 160, R = 116;
  const vals = CATS.map(c => Math.max(0, Math.min(1, Number(data[c]) || 0)));
  const angle = (i) => -Math.PI / 2 + i * (2 * Math.PI / CATS.length);
  const rings = [0.25, 0.5, 0.75, 1].map(f => `<polygon points="${CATS.map((_, i) => {
    const a = angle(i); return `${(cx + Math.cos(a) * R * f).toFixed(1)},${(cy + Math.sin(a) * R * f).toFixed(1)}`;
  }).join(' ')}" fill="none" stroke="${f === 1 ? '#d8d4c9' : '#efede7'}" stroke-width="1"/>`).join('');
  const axes = CATS.map((_, i) => {
    const a = angle(i);
    return `<line x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(a) * R).toFixed(1)}" y2="${(cy + Math.sin(a) * R).toFixed(1)}" stroke="#efede7" stroke-width="1"/>`;
  }).join('');
  const labels = CATS.map((c, i) => {
    const a = angle(i);
    const x = cx + Math.cos(a) * (R + 25), y = cy + Math.sin(a) * (R + 25);
    const anchor = Math.abs(Math.cos(a)) < 0.2 ? 'middle' : (Math.cos(a) > 0 ? 'start' : 'end');
    return `<text x="${x.toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="${anchor}" font-size="10.5" fill="#6b675e">${esc(CAT_NAMES[c])}</text>`;
  }).join('');
  const pts = vals.map((v, i) => {
    const a = angle(i); return `${(cx + Math.cos(a) * R * v).toFixed(1)},${(cy + Math.sin(a) * R * v).toFixed(1)}`;
  }).join(' ');
  const dots = vals.map((v, i) => {
    const a = angle(i);
    return `<circle cx="${(cx + Math.cos(a) * R * v).toFixed(1)}" cy="${(cy + Math.sin(a) * R * v).toFixed(1)}" r="2.6" fill="var(--accent)" stroke="#fff" stroke-width="1"/>`;
  }).join('');
  return `<svg viewBox="0 0 320 320" role="img" aria-label="能力雷达图">${rings}${axes}<g>${`<polygon points="${pts}" fill="rgba(191,58,26,0.10)" stroke="var(--accent)" stroke-width="1.6" stroke-linejoin="round"/>`}${dots}</g>${labels}</svg>`;
}

// ---------------------------------------------------------------- init
async function init() {
  $('#footTime').textContent = new Date().toLocaleString('zh-CN');
  bind();
  observeReveal();
  loadHealth();
  loadStats();
  loadSuites();
  loadLb();
}

function bind() {
  document.querySelectorAll('#modeTabs .tab').forEach(t => {
    t.onclick = () => {
      state.mode = t.dataset.mode;
      document.querySelectorAll('#modeTabs .tab').forEach(x => x.classList.toggle('on', x === t));
      loadLb();
    };
  });
  $('#sortBy').onchange = (e) => { state.sort = e.target.value; loadLb(); };
  $('#search').oninput = (e) => { state.q = e.target.value.trim().toLowerCase(); renderRows(); };
  $('#colsBtn').onclick = () => {
    state.showCats = !state.showCats;
    $('#colsBtn').classList.toggle('btn-primary', state.showCats);
    $('#colsBtn').textContent = state.showCats ? '收起列' : '展开列';
    renderHead();
    renderRows();
  };
  document.querySelectorAll('.site-nav a').forEach(a => {
    a.onclick = () => {
      document.querySelectorAll('.site-nav a').forEach(x => x.classList.toggle('on', x === a));
    };
  });
}

async function loadHealth() {
  const el = $('#status');
  try {
    const h = await (await fetch('/api/v1/health')).json();
    if (h.ok) { el.className = 'status ok'; el.querySelector('span').textContent = '服务器在线'; }
    else throw new Error('bad');
  } catch {
    el.className = 'status bad';
    el.querySelector('span').textContent = '服务器离线';
  }
}

async function loadStats() {
  try {
    const s = await (await fetch('/api/v1/stats')).json();
    countUp($('#stModels'), s.models);
    countUp($('#stScores'), s.totalScores);
    countUp($('#stUsers'), s.users);
    countUp($('#stSuites'), s.datasets);
    $('#heroUpdated').textContent = new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { }
}

// ---------------------------------------------------------------- leaderboard
function renderHead() {
  const sortable = (key, label, cls = '') => {
    const on = state.sort === key;
    return `<th class="sortable ${on ? 'sorted' : ''} ${cls}" data-sort="${key}">${label}<span class="sort">${on ? '▼' : '↕'}</span></th>`;
  };
  const cats = state.showCats ? CATS.map(c => `<th class="num" style="width:62px">${CAT_SHORT[c]}</th>`).join('') : '';
  $('#lbHead').innerHTML = `<tr>
    <th style="width:46px">#</th>
    <th style="min-width:240px">模型</th>
    <th style="width:150px">Agent</th>
    ${sortable('intelligenceIndex', '智能指数', 'num')}
    ${sortable('totalScore', '总分', 'num')}
    ${sortable('accuracyOverall', '正确率', 'num')}
    ${cats}
    <th class="num" style="width:96px">提交</th>
    <th style="width:26px"></th>
  </tr>`;
  document.querySelectorAll('#lbHead th[data-sort]').forEach(th => {
    th.onclick = () => { state.sort = th.dataset.sort; $('#sortBy').value = state.sort; loadLb(); };
  });
}

async function loadLb() {
  state.loading = true;
  state.error = '';
  renderRows();
  try {
    const sort = ['intelligenceIndex', 'totalScore', 'accuracyOverall'].includes(state.sort) ? state.sort : 'intelligenceIndex';
    const r = await (await fetch(`/api/v1/leaderboard?mode=${state.mode}&sort=${sort}&limit=200`)).json();
    state.rows = r.leaderboard || [];
    state.loading = false;
    renderSpotlight();
    renderTicker();
    renderRows();
    $('#updated').textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
  } catch (e) {
    state.loading = false;
    state.error = e.message || '未知错误';
    renderSpotlight();
    renderRows();
  }
}

function filtered() {
  let rows = state.rows.slice();
  if (state.q) rows = rows.filter(r => String(r.model).toLowerCase().includes(state.q) || String(r.agent || '').toLowerCase().includes(state.q) || (r.agents || []).some(a => String(a).toLowerCase().includes(state.q)));
  if (!['intelligenceIndex', 'totalScore', 'accuracyOverall'].includes(state.sort)) {
    rows.sort((a, b) => (b.categories?.[state.sort]?.accuracy ?? -1) - (a.categories?.[state.sort]?.accuracy ?? -1));
  }
  return rows;
}

function renderSpotlight() {
  const box = $('#spotlight');
  if (!state.rows.length) {
    box.innerHTML = `<div class="spotlight-lead"><span class="tag">${state.error ? '服务器离线' : '等待第一个成绩'}</span><h3>${state.error ? '榜单暂时不可达' : '还没有人上榜'}</h3><p>${state.error ? '恢复网络后刷新页面。' : '在桌面端完成跑分并上传，这里就会出现你的模型。'}</p></div><div class="spotlight-bars"></div>`;
    return;
  }
  const top = state.rows[0], second = state.rows[1];
  const gap = second ? (Number(top.intelligenceIndex) || 0) - (Number(second.intelligenceIndex) || 0) : 0;
  const max = Math.max(...state.rows.map(r => Number(r.intelligenceIndex) || 0), 1);
  box.innerHTML = `<div class="spotlight-lead">
    <span class="tag">当前第一 · ${top.mock ? '模拟成绩' : '真实跑分'}</span>
    <h3>${esc(top.model)}</h3>
    <p>${esc((top.agents || []).join(' · ') || top.agent || '—')}</p>
    <div class="spotlight-score"><b>${(Number(top.intelligenceIndex) || 0).toFixed(1)}</b><span>智能指数 · ${second ? `领先第二名 <em>${gap.toFixed(1)}</em> 分` : '目前唯一上榜模型'}</span></div>
  </div>
  <div class="spotlight-bars">${state.rows.slice(0, 5).map((r, i) => `
    <div class="spot-row"><span class="r">${String(i + 1).padStart(2, '0')}</span><span class="m">${esc(r.model)}</span><span class="bar"><i data-w="${(100 * (Number(r.intelligenceIndex) || 0) / max).toFixed(1)}"></i></span><span class="v">${(Number(r.intelligenceIndex) || 0).toFixed(1)}</span></div>`).join('')}</div>`;
  setTimeout(() => box.querySelectorAll('[data-w]').forEach((el, i) => setTimeout(() => { el.style.width = el.dataset.w + '%'; }, 60 + i * 50)), 30);
}

function renderTicker() {
  const items = state.rows.slice(0, 12).map(r => `<span><em>${esc(r.model)}</em><i>${(Number(r.intelligenceIndex) || 0).toFixed(1)}</i></span>`).join('') || '<span><em>OUR BENCHMARK</em><i>公开题库</i></span>';
  let one = items;
  while ((one.match(/<span/g) || []).length < 12) one += items;
  $('#tickerTrack').innerHTML = one + one;
}

function renderRows() {
  const body = $('#lbBody');
  if (state.loading) { body.innerHTML = `<tr><td colspan="${state.showCats ? 14 : 8}"><div class="loading"><span class="spinner"></span>加载中</div></td></tr>`; return; }
  if (state.error) { body.innerHTML = `<tr><td colspan="${state.showCats ? 14 : 8}"><div class="empty"><b>无法连接服务器</b>${esc(state.error)}</div></td></tr>`; return; }
  const rows = filtered();
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="${state.showCats ? 14 : 8}"><div class="empty"><b>${state.q ? '没有匹配的模型' : '榜单还是空的'}</b>${state.q ? '换一个关键词试试。' : '在桌面端跑一次分并上传。'}</div></td></tr>`;
    return;
  }
  const cols = state.showCats ? 14 : 8;
  body.innerHTML = rows.map((r, i) => {
    const open = state.expanded === r.scoreId;
    const cats = state.showCats ? CATS.map(c => {
      const v = r.categories?.[c]?.accuracy;
      return `<td class="catcell"><div class="cv">${v == null ? '—' : (100 * v).toFixed(0)}</div><div class="mini"><i style="width:${v == null ? 0 : (100 * v).toFixed(0)}%"></i></div></td>`;
    }).join('') : '';
    return `<tr class="clickable ${open ? 'expanded' : ''}" data-id="${esc(r.scoreId)}">
      <td><span class="rank ${i < 3 ? 'top' : ''}">${String(i + 1).padStart(2, '0')}</span></td>
      <td><div class="ident"><span class="mono-avatar">${esc(monogram(r.model))}</span><div style="min-width:0"><div class="ident-name">${esc(r.model)}</div><div class="ident-sub">${r.mock ? '模拟成绩' : '真实跑分'} · ${esc((r.agents && r.agents[0]) || r.agent || '—')}</div></div></div></td>
      <td style="font-size:11.5px;color:var(--muted)">${esc((r.agents && r.agents.slice(0, 2).join(', ')) || r.agent || '—')}</td>
      <td class="num"><span class="fig-lg" style="color:var(--accent)">${(Number(r.intelligenceIndex) || 0).toFixed(1)}</span></td>
      <td class="num">${fmt(r.totalScore)}</td>
      <td class="num">${(100 * (r.accuracyOverall || 0)).toFixed(1)}%</td>
      ${cats}
      <td class="num" style="font-size:11px;color:var(--muted)">${shortDate(r.lastSubmission)}</td>
      <td><span class="arrow">›</span></td>
    </tr>
    ${open ? `<tr class="expand-row"><td colspan="${cols}">${expandHTML(r)}</td></tr>` : ''}`;
  }).join('');
  body.querySelectorAll('tr.clickable').forEach(tr => {
    tr.onclick = () => { const id = tr.dataset.id; state.expanded = state.expanded === id ? null : id; renderRows(); };
  });
}

function expandHTML(r) {
  const cats = r.categories || {};
  return `<div class="expand-panel"><div class="expand-grid">
    <div><h4>能力维度</h4><div class="expand-cats">${CATS.map(c => {
      const v = cats[c]?.accuracy;
      return `<div class="expand-cat"><span class="n">${CAT_NAMES[c]}</span><span class="t"><i style="width:${v == null ? 0 : (100 * v).toFixed(1)}%"></i></span><span class="v">${v == null ? '—' : (100 * v).toFixed(1)}</span></div>`;
    }).join('')}</div></div>
    <div><h4>六维雷达</h4><div class="radar-wrap">${radar(Object.fromEntries(CATS.map(c => [c, cats[c]?.accuracy || 0])))}</div></div>
    <div><h4>成绩信息</h4><div class="expand-meta">
      模型 <b>${esc(r.model)}</b><br>
      智能指数 <b>${(Number(r.intelligenceIndex) || 0).toFixed(1)}</b> / 100<br>
      总分 <b>${fmt(r.totalScore)}</b><br>
      总正确率 <b>${(100 * (r.accuracyOverall || 0)).toFixed(1)}%</b><br>
      Agent <b>${esc((r.agents || []).join(', ') || r.agent || '—')}</b><br>
      提交 <b>${esc(new Date(r.lastSubmission).toLocaleString('zh-CN'))}</b><br>
      <span class="mono">score ${esc(r.scoreId || '—')}</span>
    </div></div>
  </div></div>`;
}

// ---------------------------------------------------------------- suites
async function loadSuites() {
  try {
    const r = await (await fetch('/api/v1/datasets')).json();
    const list = r.datasets || [];
    $('#suiteCount').textContent = `${list.length} 套 · 全部开源`;
    $('#suiteBody').innerHTML = list.map(d => `<tr>
      <td><div class="ident-name">${esc(d.name)}</div><div class="ident-sub">${esc(d.nameZh || '')}</div></td>
      <td class="cat">${esc(CAT_NAMES[d.category] || d.category || '—')}</td>
      <td class="num">${fmt(d.questions)}</td>
      <td class="num" style="color:var(--muted);font-size:11px">${d.bytes > 1048576 ? (d.bytes / 1048576).toFixed(1) + ' MB' : Math.round(d.bytes / 1024) + ' KB'}</td>
      <td class="src">${esc(d.source || '—')}</td>
    </tr>`).join('') || '<tr><td colspan="5"><div class="empty">服务器题库尚未同步</div></td></tr>';
  } catch {
    $('#suiteBody').innerHTML = '<tr><td colspan="5"><div class="empty"><b>题库加载失败</b>服务器暂时不可达。</div></td></tr>';
  }
}

// ---------------------------------------------------------------- reveal
function observeReveal() {
  const els = document.querySelectorAll('.section, .spotlight, .method-grid');
  els.forEach(e => e.classList.add('reveal'));
  if (!('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
  }, { threshold: 0.08 });
  els.forEach(e => io.observe(e));
}

renderHead();
init();
