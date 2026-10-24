// 首页 — 编辑级开场、仪器表盘、题库矩阵、榜单预览
Pages.home = function home(root) {
  const { esc, fmt, countUp } = App;
  let disposed = false;
  let stopFlow = null;

  root.innerHTML = `<div class="home">
    <section class="hero">
      <div class="hero-copy">
        <h1>
          <span class="line"><span>把模型的真实水平</span></span>
          <span class="line"><span>量出来。</span></span>
        </h1>
        <p class="hero-sub">自动识别本机 AI Agent，用 16 套公开题库跑分，生成可复现的智能指数，并把你送上全球榜单。</p>
        <div class="hero-actions">
          <button class="btn btn-primary btn-lg" id="heroRun">开始跑分 <span aria-hidden="true">→</span></button>
          <button class="btn btn-lg" id="heroLb">查看全球榜单</button>
        </div>
        <div class="hero-meta">
          <span><b id="metaSuites">—</b> 套公开题库</span>
          <span><b id="metaQs">—</b> 道题</span>
          <span><b id="metaAgents">—</b> 个 Agent 已识别</span>
        </div>
      </div>
      <div class="hero-stage">
        <canvas id="flow" aria-hidden="true"></canvas>
        <div class="hero-instrument">
          <div id="heroGauge"></div>
          <div class="gauge-caption"><span>0</span><span>50</span><span>100</span></div>
          <div class="hero-toplist" id="heroTop">
            <div class="hero-top"><span class="r">—</span><span class="m muted">正在读取全球榜单</span><span class="a"></span><span class="s"></span></div>
          </div>
        </div>
      </div>
    </section>

    <div class="ticker" aria-hidden="true"><div class="ticker-track" id="tickerTrack"><span><em>OUR BENCHMARK</em><i>16 SUITES</i></span><span><em>PUBLIC DATASETS</em><i>22,000+ 题</i></span><span><em>INTELLIGENCE INDEX</em><i>四维体系</i></span><span><em>OUR BENCHMARK</em><i>16 SUITES</i></span><span><em>PUBLIC DATASETS</em><i>22,000+ 题</i></span><span><em>INTELLIGENCE INDEX</em><i>四维体系</i></span></div></div>

    <div class="stat-strip">
      <div><div class="k">已识别 Agent</div><div class="v"><span id="stAgents">—</span><small>个</small></div></div>
      <div><div class="k">内置题库</div><div class="v"><span id="stSuites">—</span><small>套</small></div></div>
      <div><div class="k">题目总量</div><div class="v"><span id="stQs">—</span><small>题</small></div></div>
      <div><div class="k">上榜模型</div><div class="v"><span id="stModels">—</span><small>个</small></div></div>
    </div>

    <section class="home-section reveal">
      <div class="home-section-head">
        <div><h2>这台机器上，谁在待命？</h2><p>扫描配置目录、PATH 与运行进程，只在本机完成。</p></div>
        <button class="btn btn-sm" id="toDevice">设备详情</button>
      </div>
      <div class="home-two">
        <div id="homeAgents"><div class="empty"><span class="spinner"></span></div></div>
        <ol class="steps">
          <li><div><h3>识别本机 Agent</h3><p>Codex、Claude Code、zcode、Gemini CLI、Cursor、Windsurf、Qwen Code 等，读到配置即记录。</p></div></li>
          <li><div><h3>选择题库与规模</h3><p>16 套公开题库按类别加权；先用小样本快速摸底，再下载完整集跑全量。</p></div></li>
          <li><div><h3>出分并上榜</h3><p>生成安兔兔式总分与 AA 风格智能指数，登录后一键上传全球榜单。</p></div></li>
        </ol>
      </div>
    </section>

    <section class="home-section reveal">
      <div class="home-section-head">
        <div><h2>题库矩阵</h2><p>全部公开可查；下载完整集后可跑全量。未收录的 AA 私有评测不参与计算。</p></div>
        <button class="link" id="toRun">配置一次跑分 →</button>
      </div>
      <div class="suite-grid-head"><span>套件</span><span>类别</span><span style="text-align:right">题量</span><span style="text-align:right">状态</span></div>
      <div id="homeSuites"><div class="empty"><span class="spinner"></span></div></div>
    </section>

    <section class="home-section reveal">
      <div class="home-section-head">
        <div><h2>全球榜单</h2><p id="homeLbNote">按智能指数排序，同一模型取最高分。</p></div>
        <button class="link" id="toLb">查看完整榜单 →</button>
      </div>
      <div class="home-two">
        <div class="home-lb" id="homeLb"><div class="empty"><span class="spinner"></span></div></div>
        <div>
          <div class="home-lb" id="homeHist" style="margin-bottom:10px"></div>
          <div class="muted" style="font-size:11px" id="homeHistNote">分数分布</div>
        </div>
      </div>
    </section>

    <footer class="home-footer">
      <div class="footer-word">Our Benchmark</div>
      <div class="footer-meta">
        <span>本地优先 · 公开题库 · 可复现的智能指数</span>
        <span class="mono" id="footServer">144.126.133.165:8600</span>
      </div>
    </footer>
  </div>`;

  const $ = (s) => root.querySelector(s);
  const st = App.state.settings || {};
  const serverLabel = (st.useProductionServer ? st.productionServerUrl : st.serverUrl) || '';
  if (serverLabel) $('#footServer').textContent = serverLabel.replace(/^https?:\/\//, '');
  $('#heroRun').onclick = () => App.nav('run');
  $('#heroLb').onclick = () => App.nav('leaderboard');
  $('#toRun').onclick = () => App.nav('run');
  $('#toLb').onclick = () => App.nav('leaderboard');
  $('#toDevice').onclick = () => App.nav('device');
  FX.magnet($('#heroRun'), 0.14);

  // ---- 逐字标题：把每行文本拆成带 --d 序号的字符，交给 motion.css 压印入场
  {
    let d = 0;
    root.querySelectorAll('.hero h1 .line > span').forEach(span => {
      const chars = Array.from(span.textContent);
      span.innerHTML = chars.map(c => `<span class="ch" style="--d:${d++}">${App.esc(c)}</span>`).join('');
    });
    root.querySelector('.hero h1').style.setProperty('--ch-total', d);
  }

  stopFlow = FX.flow($('#flow'), { seed: 77 });
  renderGauge(0, '等待成绩', 'Intelligence Index');

  function renderGauge(value, label, sub) {
    // animateGauge 会在容器里首次渲染零位表盘，之后每次调用都原位重滚（平滑变针）
    Charts.animateGauge($('#heroGauge'), value, { label, sub });
  }

  // ---- local history: show the machine's best until global arrives
  (async () => {
    try {
      const hist = await window.ourbench.getHistory();
      const best = (hist || []).reduce((a, b) => (Number(b.intelligenceIndex) || 0) > (Number(a.intelligenceIndex) || 0) ? b : a, {});
      if (!disposed && best && best.intelligenceIndex) {
        renderGauge(best.intelligenceIndex, '本机最佳', best.model || '本地记录');
      }
    } catch { }
  })();

  // ---- agents
  (async () => {
    try {
      const agents = await window.ourbench.detectAgents();
      if (disposed) return;
      App.state.agents = agents;
      const found = agents.filter(a => a.detected && !a.builtin);
      $('#metaAgents').textContent = found.length;
      FX.odometer($('#stAgents'), found.length);
      const box = $('#homeAgents');
      if (!found.length) {
        box.innerHTML = `<div class="empty" style="text-align:left;padding:28px 0">
          <b>未检测到已安装的 Agent</b>
          仍可使用内置模拟 Agent 完整体验跑分流程，不消耗任何 API。
          <div><button class="btn btn-primary btn-sm" id="mockGo">用模拟 Agent 跑分</button></div>
        </div>`;
        const go = box.querySelector('#mockGo');
        if (go) go.onclick = () => App.nav('run');
        return;
      }
      box.innerHTML = `<div class="agent-list">${found.slice(0, 6).map(a => `
        <div class="agent-row">
          <div class="agent-monogram">${esc((a.vendor || a.name || '?').slice(0, 1).toUpperCase())}</div>
          <div style="min-width:0">
            <div class="nm">${esc(a.name)}</div>
            <div class="ev">${esc((a.evidence && a.evidence[0]) || '已检测')}${a.model ? ` · <span class="mono">${esc(a.model)}</span>` : ''}</div>
          </div>
          <div class="side"><span class="pill pill-positive">已检测</span></div>
        </div>`).join('')}</div>
        ${found.length > 6 ? `<div class="muted" style="font-size:11.5px;margin-top:10px">另有 ${found.length - 6} 个 Agent，见设备信息。</div>` : ''}`;
    } catch {
      if (!disposed) $('#homeAgents').innerHTML = '<div class="empty">检测失败</div>';
    }
  })();

  // ---- suites
  (async () => {
    try {
      const suites = await window.ourbench.listSuites();
      if (disposed) return;
      App.state.suites = suites;
      const totalQs = suites.reduce((s, x) => s + (x.questionCount || 0), 0);
      $('#metaSuites').textContent = suites.length;
      $('#metaQs').textContent = fmt(totalQs);
      FX.odometer($('#stSuites'), suites.length);
      FX.odometer($('#stQs'), totalQs, { duration: 1300, format: fmt });
      $('#homeSuites').innerHTML = suites.map(s => `
        <div class="suite-line">
          <div style="min-width:0"><div class="nm">${esc(s.name)}</div><div class="zh">${esc(s.nameZh || '')}</div></div>
          <div class="cat">${esc(Charts.catName(s.category))}</div>
          <div class="q">${fmt(s.questionCount)}</div>
          <div class="st">${s.isFull ? '<span class="pill pill-positive">完整集</span>' : '<span class="pill pill-neutral">内置子集</span>'}</div>
        </div>`).join('');
    } catch { }
  })();

  // ---- leaderboard + stats + ticker
  (async () => {
    try {
      const [lb5, stats, lb100] = await Promise.all([
        window.ourbench.serverLeaderboard('limit=5'),
        window.ourbench.serverStats(),
        window.ourbench.serverLeaderboard('limit=100'),
      ]);
      if (disposed) return;
      const rows = lb5.leaderboard || [];
      App.state.stats = stats;
      const models = stats.models || (lb100.leaderboard || []).length;
      FX.odometer($('#stModels'), models);

      if (rows.length) {
        const top = rows[0];
        renderGauge(Number(top.intelligenceIndex) || 0, '全球第一', top.model || '');
        $('#heroTop').innerHTML = rows.slice(0, 4).map((r, i) => `
          <div class="hero-top">
            <span class="r">${String(i + 1).padStart(2, '0')}</span>
            <span class="m">${esc(r.model)}</span>
            <span class="a">${esc((r.agents && r.agents[0]) || r.agent || '')}</span>
            <span class="s">${(Number(r.intelligenceIndex) || 0).toFixed(1)}</span>
          </div>`).join('');
      } else {
        $('#heroTop').innerHTML = '<div class="hero-top"><span class="r">—</span><span class="m muted">榜单还是空的，跑一次分做第一个上榜的人</span><span class="a"></span><span class="s"></span></div>';
      }

      // ticker：不足一屏宽会露白，重复到足够条数再对折拼接，保证 -50% 无缝
      const items = (lb100.leaderboard && lb100.leaderboard.length ? lb100.leaderboard : rows).slice(0, 12);
      const tickerItems = items.length
        ? items.map(r => `<span><em>${esc(r.model)}</em><i>${(Number(r.intelligenceIndex) || 0).toFixed(1)}</i></span>`).join('')
        : '<span><em>OUR BENCHMARK</em><i>等待第一个成绩</i></span><span><em>16 SUITES</em><i>公开题库</i></span>';
      setTicker(tickerItems);

      // home leaderboard list
      const box = $('#homeLb');
      if (rows.length) {
        box.innerHTML = rows.map((r, i) => `
          <div class="lb-line">
            <span class="r">${String(i + 1).padStart(2, '0')}</span>
            <span class="m">${esc(r.model)}<small>${esc((r.agents && r.agents.slice(0, 2).join(' · ')) || r.agent || '—')}</small></span>
            <span class="i">${(Number(r.intelligenceIndex) || 0).toFixed(1)}</span>
            <span class="t">${fmt(r.totalScore)}</span>
          </div>`).join('');
      } else {
        box.innerHTML = `<div class="empty" style="text-align:left;padding:26px 0"><b>暂无上榜成绩</b>跑一次分，成为第一个被测量的模型。</div>`;
      }

      const all = (lb100.leaderboard || []).map(r => Number(r.intelligenceIndex) || 0);
      const hist = $('#homeHist');
      if (hist && all.length) {
        hist.innerHTML = Charts.histogram(all, { w: 420, h: 150, bins: 18 });
        $('#homeHistNote').textContent = `智能指数分布 · ${all.length} 个模型 · 中位数 ${median(all).toFixed(1)}`;
      } else if (hist) {
        hist.innerHTML = '<div class="empty" style="padding:26px 0">有成绩后显示分布</div>';
      }
    } catch {
      if (disposed) return;
      $('#homeLb').innerHTML = `<div class="empty" style="text-align:left;padding:26px 0"><b>无法连接服务器</b>本地跑分与记录不受影响。
        <div><button class="btn btn-sm" id="lbRetry">重试</button></div></div>`;
      const retry = root.querySelector('#lbRetry');
      if (retry) retry.onclick = () => App.refresh();
      $('#homeHist').innerHTML = '';
      $('#homeHistNote').textContent = '服务器离线 · 暂无分数分布';
      $('#heroTop').innerHTML = '<div class="hero-top"><span class="r">—</span><span class="m muted">服务器离线 · 本地跑分可用</span><span class="a"></span><span class="s"></span></div>';
      $('#stModels').textContent = '—';
      setTicker('<span><em>服务器离线</em><i>本地功能可用</i></span><span><em>16 SUITES</em><i>公开题库</i></span><span><em>LOCAL FIRST</em><i>本机跑分</i></span>');
    }
  })();

  function setTicker(itemsHtml) {
    const track = $('#tickerTrack');
    if (!track) return;
    let one = itemsHtml;
    while ((one.match(/<span/g) || []).length < 14) one += itemsHtml;
    track.innerHTML = one + one;
  }

  function median(arr) {
    const a = [...arr].sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  return () => {
    disposed = true;
    if (stopFlow) stopFlow();
  };
};
