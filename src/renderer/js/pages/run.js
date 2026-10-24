// 跑分 — 选择、运行舱、结果
Pages.run = function run(root) {
  const { esc, fmt, toast, state } = App;
  let disposed = false;
  let stopScan = null;
  let offStart = null, offProg = null, offDone = null;
  let finished = false;
  let currentRunId = '';

  const settings = state.settings || {};
  const MOCK_AGENT = {
    id: 'mock', name: '内置模拟 Agent', vendor: 'Benchmark', kind: 'mock',
    detected: true, evidence: ['确定性仿真 · 零 API 消耗'], model: null,
  };
  const sel = {
    agentId: 'mock',
    model: 'gpt-5.3',
    suites: new Set(),
    mode: 'mock',
    sample: 10,
    concurrency: settings.concurrency || 4,
    filter: '',
  };

  root.innerHTML = `<div class="run-page">
    <div class="page-head run-head">
      <div>
        <h1 class="page-title">开始跑分</h1>
        <p class="page-sub">选择 Agent 与题库。默认模拟模式，零 API 消耗；真实模式需要先在设置里解锁。</p>
      </div>
      <div class="actions"><span class="pill pill-neutral" id="modePill">模拟模式</span></div>
    </div>
    <div class="run-grid">
      <section class="run-col panel">
        <div class="panel-head"><h2>Agent</h2><span class="sub" id="agentCount">—</span></div>
        <div class="opt-list" id="agentList">
          ${[1, 2, 3].map(() => `<div class="agent-opt" style="pointer-events:none">
            <span class="radio"></span>
            <span class="opt-monogram skeleton"></span>
            <span><span class="nm skeleton" style="display:block;width:118px;height:12px"></span><span class="ev skeleton" style="display:block;width:168px;height:10px;margin-top:6px"></span></span>
            <span></span>
          </div>`).join('')}
        </div>
        <div class="agent-config">
          <div class="field">
            <label>运行模式</label>
            <div class="seg" id="modeSeg">
              <button data-mode="mock" class="on">模拟</button>
              <button data-mode="real" ${settings.realModeUnlocked ? '' : 'class="locked" title="需在设置中解锁"'}>真实${settings.realModeUnlocked ? '' : ' <svg viewBox="0 0 20 20" width="11" height="11" aria-hidden="true"><rect x="5" y="9" width="10" height="7" rx="1.5"/><path d="M7.5 9V6.5a2.5 2.5 0 0 1 5 0V9"/></svg>'}</button>
            </div>
          </div>
          <div class="field" style="margin-bottom:0">
            <label for="runModel">模拟模型</label>
            <select id="runModel"></select>
          </div>
          <div class="hint" id="runNote">模拟模式不会调用任何外部 API；真实模式会消耗 token 与费用。</div>
        </div>
      </section>
      <section class="run-col panel">
        <div class="panel-head">
          <h2>题库</h2>
          <div class="row" style="gap:12px">
            <span class="sub" id="suiteCount">已选 0 套</span>
            <button class="text-action" id="suiteAll">全选</button>
            <button class="text-action" id="suiteNone">清空</button>
          </div>
        </div>
        <div class="suite-filter" id="suiteFilter"></div>
        <div class="suite-opt-list" id="suiteList"><div class="empty"><span class="spinner"></span></div></div>
      </section>
      <aside class="manifest">
        <h2>本次跑分</h2>
        <div class="manifest-sub">配置在右侧完成，结果自动保存到本地。</div>
        <div class="manifest-rows">
          <div class="manifest-row"><span class="k">Agent</span><span class="v" id="mAgent">内置模拟</span></div>
          <div class="manifest-row"><span class="k">模型</span><span class="v" id="mModel">gpt-5.3</span></div>
          <div class="manifest-row"><span class="k">模式</span><span class="v" id="mMode">模拟</span></div>
          <div class="manifest-row"><span class="k">题库</span><span class="v" id="mSuites">0 套</span></div>
          <div class="manifest-row"><span class="k">预计题量</span><span class="v" id="mEstimate">0</span></div>
        </div>
        <div class="field">
          <label for="runSample">每套题数</label>
          <select id="runSample">
            <option value="10" selected>快速 · 10 题 / 套</option>
            <option value="30">标准 · 30 题 / 套</option>
            <option value="80">深度 · 80 题 / 套</option>
            <option value="0">全量 · 全部题目</option>
          </select>
        </div>
        <div class="field">
          <label for="runConc">并发</label>
          <select id="runConc">${[1, 2, 4, 8, 12].map(n => `<option value="${n}" ${n === sel.concurrency ? 'selected' : ''}>${n}</option>`).join('')}</select>
        </div>
        <button class="btn btn-primary btn-block btn-lg" id="runGo">开始跑分</button>
        <div class="manifest-note">跑分完成后自动保存到本地历史；上传至全球榜单是可选的。</div>
      </aside>
    </div>
    <div class="proprietary" id="proprietary"></div>
  </div>`;

  const $ = (s) => root.querySelector(s);
  $('#runGo').onclick = () => startRun();
  $('#runSample').onchange = (e) => { sel.sample = Number(e.target.value); updateEstimate(); };
  $('#suiteAll').onclick = () => {
    suitesCache.forEach(s => sel.suites.add(s.id));
    renderSuites();
    updateEstimate();
  };
  $('#suiteNone').onclick = () => {
    sel.suites.clear();
    renderSuites();
    updateEstimate();
  };
  $('#runConc').onchange = (e) => { sel.concurrency = Number(e.target.value); };
  $('#runModel').onchange = (e) => { sel.model = e.target.value; updateEstimate(); };
  root.querySelectorAll('#modeSeg button').forEach(b => {
    b.onclick = () => {
      if (b.dataset.mode === 'real' && !settings.realModeUnlocked) return offerRealUnlock();
      setMode(b.dataset.mode);
    };
  });

  // 锁定态点击：说明三重闸门，引导去设置解锁（而不是无声无息）
  function offerRealUnlock() {
    App.modal({
      title: '真实模式未解锁',
      sub: '真实模式会把题目发送给已配置的 API 或 CLI Agent，产生真实 token 费用。',
      body: `<p style="font-size:12.5px;line-height:2;color:var(--ink-2)">这是刻意设计的三重闸门，避免误触产生费用：<br>
        1. 在「设置 → 解锁真实模式」打开开关；<br>
        2. 输入确认串 <span class="inline-code">I-UNDERSTAND-THE-COST</span>；<br>
        3. 配置 API 地址与 Key，或选择 CLI Agent。<br>
        三者齐备后，这里才能切到真实模式。</p>`,
      actions: [
        { label: '取消', onClick: (close) => close() },
        { label: '去设置解锁', kind: 'btn-primary', onClick: (close) => { close(); App.nav('settings'); } },
      ],
    });
  }

  function setMode(mode) {
    sel.mode = mode;
    root.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
    $('#modePill').textContent = mode === 'mock' ? '模拟模式' : '真实模式';
    $('#modePill').className = 'pill ' + (mode === 'mock' ? 'pill-neutral' : 'pill-warning');
    $('#mMode').textContent = mode === 'mock' ? '模拟' : '真实';
    $('#runNote').textContent = mode === 'mock'
      ? '模拟模式不会调用任何外部 API；结果由确定性画像生成，用于流程演示与对比。'
      : '真实模式会把题目发送给已配置的 API 或 CLI Agent，产生真实费用。';
    if (mode === 'real') {
      const firstReal = (App.state.agents || []).find(a => a.detected && a.kind === 'cli');
      if (firstReal) selectAgent(firstReal.id);
      else {
        toast('没有可用的真实 Agent，已保持模拟模式', 'info', 4200);
        sel.mode = 'mock';
        root.querySelectorAll('#modeSeg button').forEach(x => x.classList.toggle('on', x.dataset.mode === 'mock'));
        $('#modePill').textContent = '模拟模式';
        $('#modePill').className = 'pill pill-neutral';
        $('#mMode').textContent = '模拟';
        $('#runNote').textContent = '模拟模式不会调用任何外部 API；结果由确定性画像生成，用于流程演示与对比。';
      }
    }
    renderAgents();
    updateEstimate();
  }

  // ---------------- agents
  let agentsCache = null;
  function renderAgents() {
    const box = $('#agentList');
    if (!box) return;
    const detected = (agentsCache || []).filter(a => a.detected && a.id !== 'mock');
    const list = [MOCK_AGENT, ...detected];
    $('#agentCount').textContent = `${detected.length} 个已识别`;
    box.innerHTML = list.map(a => {
      const on = sel.agentId === a.id;
      const disabled = sel.mode === 'real' && a.kind === 'mock';
      return `<div class="agent-opt ${on ? 'on' : ''}" data-id="${esc(a.id)}" role="button" tabindex="0" aria-pressed="${on}" style="${disabled ? 'opacity:.4;pointer-events:none' : ''}">
        <span class="radio" aria-hidden="true"></span>
        <span class="opt-monogram">${esc((a.vendor || a.name || '?').slice(0, 1).toUpperCase())}</span>
        <span style="min-width:0">
          <span class="nm" style="display:block">${esc(a.name)}</span>
          <span class="ev" style="display:block">${esc((a.evidence && a.evidence[0]) || '已检测')}${a.model ? ` · ${esc(a.model)}` : ''}</span>
        </span>
        <span>${a.kind === 'mock' ? '<span class="pill pill-neutral">内置</span>' : '<span class="pill pill-outline">CLI</span>'}</span>
      </div>`;
    }).join('');
    box.querySelectorAll('.agent-opt').forEach(n => {
      n.onclick = () => selectAgent(n.dataset.id);
      n.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectAgent(n.dataset.id); } };
    });
  }
  function selectAgent(id) {
    sel.agentId = id;
    const a = [MOCK_AGENT, ...(agentsCache || [])].find(x => x.id === id);
    if (a) {
      $('#mAgent').textContent = a.name.replace('内置模拟 Agent', '模拟 Agent');
      if (sel.mode === 'real' && a.model) sel.model = a.model;
    }
    renderAgents();
    updateEstimate();
  }

  (async () => {
    try {
      const agents = await window.ourbench.detectAgents();
      if (disposed) return;
      agentsCache = agents;
      App.state.agents = agents;
      renderAgents();
      selectAgent('mock');
    } catch {
      agentsCache = [];
      renderAgents();
    }
  })();

  // ---------------- suites
  let suitesCache = [];
  async function loadSuites() {
    try {
      const suites = await window.ourbench.listSuites();
      if (disposed) return;
      suitesCache = suites;
      App.state.suites = suites;
      if (!sel.suites.size) suites.forEach(s => sel.suites.add(s.id));
      renderSuites();
      updateEstimate();
    } catch {
      if (!disposed) $('#suiteList').innerHTML = '<div class="empty">题库加载失败</div>';
    }
  }
  function renderSuites() {
    const box = $('#suiteList');
    if (!box) return;
    const cats = [['', '全部'], ...Charts.CATS.map(c => [c, Charts.catShort(c)])];
    $('#suiteFilter').innerHTML = cats.map(([c, label]) =>
      `<button class="chip ${sel.filter === c ? 'on' : ''}" data-cat="${c}">${label}</button>`).join('');
    $('#suiteFilter').querySelectorAll('.chip').forEach(b => {
      b.onclick = () => { sel.filter = b.dataset.cat; renderSuites(); };
    });
    const list = suitesCache.filter(s => !sel.filter || s.category === sel.filter);
    box.innerHTML = list.map(s => {
      const on = sel.suites.has(s.id);
      return `<div class="suite-opt" data-id="${esc(s.id)}">
        <span class="check ${on ? 'on' : ''}" aria-hidden="true"></span>
        <span style="min-width:0">
          <span class="nm" style="display:block">${esc(s.name)}</span>
          <span class="zh" style="display:block">${esc(s.nameZh || '')} · ${esc(Charts.catName(s.category))}</span>
        </span>
        <span class="meta">
          <span class="q">${fmt(s.questionCount)}</span>
          ${s.isFull
            ? '<span class="pill pill-positive">完整</span>'
            : `<button class="text-action dl" data-dl="${esc(s.id)}" title="下载完整题库">下载</button>`}
        </span>
      </div>`;
    }).join('') || '<div class="empty">该类别暂无题库</div>';
    box.querySelectorAll('.suite-opt').forEach(n => {
      n.onclick = (e) => {
        if (e.target.closest('[data-dl]')) return;
        const id = n.dataset.id;
        if (sel.suites.has(id)) sel.suites.delete(id); else sel.suites.add(id);
        n.querySelector('.check').classList.toggle('on', sel.suites.has(id));
        updateSuiteCount();
        updateEstimate();
      };
    });
    box.querySelectorAll('[data-dl]').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const id = btn.dataset.dl;
        btn.disabled = true;
        btn.textContent = '下载中…';
        try {
          const r = await window.ourbench.downloadSuite(id);
          toast(`已下载 ${id} 完整题库（${fmt(r.questions)} 题）`, 'ok');
          await loadSuites();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = '下载';
          toast('下载失败：' + err.message, 'err', 5000);
        }
      };
    });
    updateSuiteCount();
  }
  function updateSuiteCount() {
    const n = sel.suites.size;
    $('#suiteCount').textContent = `已选 ${n} 套`;
    $('#mSuites').textContent = `${n} 套`;
  }
  function updateEstimate() {
    const n = [...sel.suites].reduce((acc, id) => {
      const s = suitesCache.find(x => x.id === id);
      if (!s) return acc;
      return acc + (sel.sample === 0 ? s.questionCount : Math.min(sel.sample, s.questionCount));
    }, 0);
    $('#mEstimate').textContent = fmt(n);
    $('#mModel').textContent = sel.mode === 'mock' ? sel.model : (agentsCache?.find(a => a.id === sel.agentId)?.model || '默认');
  }

  loadSuites();
  (async () => {
    try {
      const models = await window.ourbench.mockModels();
      if (disposed) return;
      const selEl = $('#runModel');
      selEl.innerHTML = models.map(m => `<option value="${esc(m.id)}">${esc(m.label.replace('Mock · ', ''))}</option>`).join('');
      sel.model = models[0].id;
      updateEstimate();
    } catch { }
  })();
  (async () => {
    try {
      const idx = await window.ourbench.listIndexes();
      if (disposed) return;
      const names = (idx.PROPRIETARY_EVALS || []).map(e => e.name);
      if (names.length) $('#proprietary').textContent = '未收录（AA 私有，无公开题库，指数权重自动重分配）：' + names.join(' · ');
    } catch { }
  })();

  // ---------------- start
  function startRun() {
    if (!sel.agentId) return toast('请先选择 Agent', 'err');
    if (!sel.suites.size) return toast('请至少选择一套题库', 'err');
    const agent = [MOCK_AGENT, ...(agentsCache || [])].find(a => a.id === sel.agentId);
    const cfg = {
      mode: sel.mode,
      agentId: sel.agentId,
      agentName: agent ? agent.name : 'Agent',
      model: sel.mode === 'mock' ? sel.model : (agent?.model || settings.apiModel || 'default'),
      suiteIds: [...sel.suites],
      sampleSize: sel.sample,
      concurrency: sel.concurrency,
      sandboxEnabled: sel.mode === 'mock' ? false : !!settings.sandboxEnabled,
      realBackend: settings.cliAgentId ? 'cli' : 'api',
    };
    App.state.lastRunCfg = cfg;
    App.transition(() => {
      App.setChamber(true);
      renderChamber(cfg);
    }, 'chamber');
  }

  // ---------------- chamber
  function renderChamber(cfg) {
    const host = document.getElementById('view');
    const suiteTotals = {};
    for (const id of cfg.suiteIds) {
      const s = suitesCache.find(x => x.id === id);
      if (!s) continue;
      suiteTotals[id] = sel.sample === 0 ? s.questionCount : Math.min(sel.sample, s.questionCount);
    }
    host.innerHTML = `<div class="chamber-page">
      <div class="chamber-top">
        <div>
          <div class="k">RUNNING</div>
          <h1>${esc(cfg.agentName)} <span style="color:#6f6a5f">/</span> ${esc(cfg.model)}</h1>
          <div class="meta">${cfg.suiteIds.length} 套题库 · ${cfg.mode === 'mock' ? '模拟模式' : '真实模式'} · 并发 ${cfg.concurrency}</div>
        </div>
        <button class="btn btn-sm" id="abortBtn" style="background:transparent;border-color:#3a372f;color:#f2eee4">中止</button>
      </div>
      <div class="chamber-main">
        <div>
          <div class="chamber-num" id="chamberNum">
            <div class="pct"><span id="pctNum">0</span><small>%</small></div>
            <div class="right"><div class="ok" id="okNum">0</div><div class="l">通过</div></div>
          </div>
          <div class="chamber-track"><i id="progBar"></i></div>
          <div class="chamber-info"><span id="progInfo">正在准备题目…</span><span id="progCount">0 / 0</span></div>
          <div class="chamber-suites" id="chamberSuites"></div>
          <div class="console" id="console"></div>
        </div>
        <div class="scan-wrap">
          <h2>实时采样</h2>
          <div class="sub">每道题完成后写入一次观测</div>
          <canvas id="scan" aria-hidden="true"></canvas>
          <div class="scan-legend"><span>SUITE / QUESTION</span><span id="scanPct">0%</span></div>
        </div>
      </div>
    </div>`;

    const $c = (s) => host.querySelector(s);
    const suiteState = {};
    for (const id of cfg.suiteIds) suiteState[id] = { done: 0, total: suiteTotals[id] || 0, correct: 0 };
    $c('#chamberSuites').innerHTML = cfg.suiteIds.map(id => {
      const s = suitesCache.find(x => x.id === id);
      return `<div class="chamber-suite" data-suite="${esc(id)}">
        <span class="nm">${esc(s ? s.name : id)}</span>
        <span class="tr"><i style="width:0%"></i></span>
        <span class="v">0 / ${suiteTotals[id] || 0}</span>
      </div>`;
    }).join('');

    const consoleEl = $c('#console');
    let correct = 0, done = 0, total = 0;
    const started = Date.now();
    stopScan = FX.scan($c('#scan'));

    // ---- 进度滑翔：目标值突变时，显示值以非线性速率逼近，仪表感的关键
    let targetPct = 0, displayPct = 0, glideRaf = 0;
    const glide = () => {
      displayPct += (targetPct - displayPct) * 0.1;
      if (Math.abs(targetPct - displayPct) < 0.08) displayPct = targetPct;
      const shown = Math.round(displayPct);
      const numEl = $c('#pctNum'), barEl = $c('#progBar'), scanEl = $c('#scanPct');
      if (numEl) numEl.textContent = shown;
      if (barEl) barEl.style.width = displayPct.toFixed(2) + '%';
      if (scanEl) scanEl.textContent = shown + '%';
      glideRaf = requestAnimationFrame(glide);
    };
    if (!FX.reduced()) glideRaf = requestAnimationFrame(glide);
    const stopGlide = () => { if (glideRaf) cancelAnimationFrame(glideRaf); glideRaf = 0; };

    const append = (html) => {
      const line = App.el(`<div class="line">${html}</div>`);
      consoleEl.appendChild(line);
      while (consoleEl.children.length > 160) consoleEl.removeChild(consoleEl.firstChild);
      consoleEl.scrollTop = consoleEl.scrollHeight;
    };

    const finish = (report, cancelled) => {
      if (finished) return;
      finished = true;
      stopGlide();
      if (offStart) offStart();
      if (offProg) offProg();
      if (offDone) offDone();
      if (stopScan) { stopScan(); stopScan = null; }
      if (cancelled) {
        App.setChamber(false);
        App.nav('run', { force: true });
        return;
      }
      App.state.runReport = report;
      App.transition(() => {
        App.setChamber(false);
        const v = document.getElementById('view');
        v.scrollTop = 0;
        v.innerHTML = '';
        const page = document.createElement('div');
        page.className = 'page';
        v.appendChild(page);
        renderReport(page, report);
        FX.observe(page);
      }, 'chamber-out');
    };

    offStart = window.ourbench.onRunStart(p => {
      currentRunId = p.runId || '';
      total = p.total || 0;
      $c('#progCount').textContent = `0 / ${total}`;
      $c('#progInfo').textContent = `已装载 ${total} 道题 · ${p.suites ? p.suites.length : cfg.suiteIds.length} 套题库`;
      append(`<span class="dim">[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}]</span> run ${esc(currentRunId)} 已启动 · ${total} 道题`);
    });
    offProg = window.ourbench.onRunProgress(p => {
      try {
      done = p.done || done + 1;
      total = p.total || total;
      if (p.correct) correct++;
      targetPct = 100 * done / Math.max(1, total);
      $c('#okNum').textContent = correct;
      $c('#progCount').textContent = `${done} / ${total}`;
      $c('#progInfo').textContent = `${p.suiteId} · ${p.questionId} · ${p.latencyMs}ms`;
      const num = $c('#chamberNum');
      num.classList.remove('tick');
      void num.offsetWidth;
      num.classList.add('tick');
      if (suiteState[p.suiteId]) {
        suiteState[p.suiteId].done++;
        if (p.correct) suiteState[p.suiteId].correct++;
        const row = host.querySelector(`[data-suite="${CSS.escape(p.suiteId)}"]`);
        if (row) {
          const st = suiteState[p.suiteId];
          row.querySelector('.tr > i').style.width = (100 * st.done / Math.max(1, st.total)) + '%';
          row.querySelector('.v').textContent = `${st.done} / ${st.total}`;
          row.classList.toggle('done', st.done >= st.total);
        }
      }
      append(`<span class="dim">[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}]</span> ${esc(p.suiteId)}/${esc(p.questionId)} <span class="${p.correct ? 'ok' : 'fail'}">${p.correct ? '通过' : '未通过'}</span> <span class="dim">${esc(String(p.lastOutput || '').replace(/\n/g, ' ').slice(0, 64))}</span>`);
      } catch (err) { console.error('[run-progress]', err); }
    });
    offDone = window.ourbench.onRunDone(p => {
      if (p.report) finish(p.report, !!p.cancelled);
      else if (p.cancelled) finish(null, true);
    });

    window.ourbench.startRun(cfg).then(report => {
      if (report && !finished) finish(report, false);
    }).catch(e => {
      if (finished) return;
      finished = true;
      stopGlide();
      if (offStart) offStart();
      if (offProg) offProg();
      if (offDone) offDone();
      if (stopScan) { stopScan(); stopScan = null; }
      App.setChamber(false);
      toast('跑分失败：' + e.message, 'err', 6000);
      App.nav('run', { force: true });
    });

    $c('#abortBtn').onclick = async () => {
      if (!currentRunId) return toast('正在启动，稍后再试', 'info');
      try {
        await window.ourbench.cancelRun(currentRunId);
        toast('正在中止…', 'info');
      } catch (e) { toast(e.message, 'err'); }
    };
  }

  // ---------------- report
  function renderReport(page, report) {
    const { esc, fmt, toast, state } = App;
    const sum = report.summary || {};
    const model = report.modelName || report.model || '未知模型';
    const cats = sum.categories || {};
    const catKeys = Charts.CATS.filter(c => cats[c]);
    const totalScore = sum.totalScore || 0;
    const index = Number(sum.intelligenceIndex) || 0;
    const accuracy = Number(sum.accuracyOverall) || 0;
    const duration = report.startedAt && report.finishedAt
      ? Math.max(0, (new Date(report.finishedAt) - new Date(report.startedAt)) / 1000) : 0;

    page.innerHTML = `<div class="result-page">
      <section class="result-hero">
        <div class="result-hero-grid">
          <div>
            <div class="result-kicker">${esc(report.agentName || 'Agent')} · ${report.mock ? '模拟模式' : '真实模式'} · ${esc(model)}</div>
            <div class="result-total"><span id="totalNum">0</span><span class="unit">分</span></div>
            <div class="result-sub">
              <span>智能指数 <b>${index.toFixed(1)}</b> / 100</span>
              <span>总正确率 <b>${(100 * accuracy).toFixed(1)}%</b></span>
              <span>耗时 <b>${duration < 60 ? duration.toFixed(0) + 's' : (duration / 60).toFixed(1) + 'min'}</b></span>
            </div>
            <div class="result-actions">
              <button class="btn btn-primary" id="uploadBtn">上传至全球榜单</button>
              <button class="btn" id="againBtn">再跑一次</button>
              <button class="btn" id="detailBtn">逐题明细</button>
            </div>
          </div>
          <div class="result-gauge" id="resultGauge"></div>
        </div>
        <div class="stamp" id="resultStamp" aria-hidden="true">实测<br>完成</div>
      </section>
      <div class="result-body">
        <section class="result-section">
          <div class="result-section-head"><h2>能力维度</h2><span class="note">按类别加权 · 正确率</span></div>
          <div class="bar-list" id="catBars">
            ${catKeys.map(c => {
              const v = cats[c].accuracy || 0;
              return `<div class="bar-row"><div class="lb">${esc(Charts.catName(c))}</div><div class="tr"><i data-w="${(100 * v).toFixed(1)}"></i></div><div class="pc">${(100 * v).toFixed(1)}%</div></div>`;
            }).join('')}
          </div>
        </section>

        <section class="result-section result-two">
          <div class="panel radar-panel">
            <div class="panel-head"><h2>能力雷达</h2><span class="sub">覆盖 ${catKeys.length} / 6 维度</span></div>
            <div class="panel-body">${catKeys.length >= 3
              ? Charts.radar(Object.fromEntries(catKeys.map(c => [c, cats[c].accuracy || 0])), { size: 320 })
              : `<div class="empty" style="padding:30px 10px">本次只覆盖 ${catKeys.length} 个维度，雷达图需要至少 3 个维度。上方“能力维度”已列出全部结果。</div>`}</div>
          </div>
          <div class="index-grid" id="indexGrid">
            ${(sum.indexes || []).map(ix => `
              <div class="index-card">
                <div class="top"><h3>${esc(ix.nameZh || ix.name)}</h3><span class="val">${ix.value == null ? '—' : Number(ix.value).toFixed(1)}</span></div>
                <div class="desc">${esc(ix.description || '')} · 覆盖 ${ix.coverage}/${ix.totalSuites}</div>
                <div class="dims">${(ix.dimensions || []).map(d => `
                  <div class="index-dim"><span class="n">${esc(d.name)}</span><span class="t"><i style="width:${d.accuracy == null ? 0 : (100 * d.accuracy).toFixed(1)}%"></i></span><span class="v">${d.accuracy == null ? '—' : (100 * d.accuracy).toFixed(0)}</span></div>`).join('')}</div>
              </div>`).join('')}
          </div>
        </section>

        <section class="result-section">
          <div class="result-section-head"><h2>分套件成绩</h2><span class="note">${Object.keys(report.suites || {}).length} 套题库</span></div>
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th>套件</th><th>类别</th><th class="num">正确 / 判分</th><th class="num">正确率</th><th style="width:34%"></th></tr></thead>
              <tbody>${Object.entries(report.suites || {}).map(([sid, s]) => {
                const meta = (App.state.suites || []).find(x => x.id === sid);
                const v = (s.accuracy || 0) * 100;
                return `<tr><td><div class="ident-name">${esc(meta ? meta.name : sid)}</div><div class="ident-sub">${esc(meta ? meta.nameZh : '')}</div></td>
                  <td class="muted">${esc(meta ? Charts.catName(meta.category) : '—')}</td>
                  <td class="num">${s.correct} / ${s.graded}${s.skipped ? `<span class="muted"> (+${s.skipped} 跳过)</span>` : ''}</td>
                  <td class="num">${v.toFixed(1)}%</td>
                  <td><div class="mini" style="width:100%;height:6px"><i style="width:${v.toFixed(1)}%;background:var(--accent)"></i></div></td></tr>`;
              }).join('')}</tbody>
            </table>
          </div>
        </section>

        <section class="result-section">
          <div class="result-section-head"><h2>测试环境</h2><span class="note">RunID ${esc(report.runId || '—')}</span></div>
          <div class="panel"><div class="panel-body" style="padding:4px 16px">
            <table class="kv">
              <tr><th>系统</th><td>${esc(report.host?.platform || '—')} · ${esc(report.host?.release || '')}</td></tr>
              <tr><th>CPU</th><td>${esc(report.host?.cpu || '—')} × ${report.host?.cores || '—'} 核</td></tr>
              <tr><th>内存</th><td>${report.host?.memGb || '—'} GB</td></tr>
              <tr><th>完成时间</th><td>${report.finishedAt ? new Date(report.finishedAt).toLocaleString('zh-CN') : '—'}</td></tr>
            </table>
          </div></div>
        </section>
      </div>
    </div>`;

    Charts.animateGauge(page.querySelector('#resultGauge'), index, { label: '智能指数', sub: 'Intelligence Index', duration: 1600 });
    App.countUp(page.querySelector('#totalNum'), totalScore, { duration: 1400, format: fmt });
    Charts.animateBars(page.querySelector('#catBars'));
    const stamp = page.querySelector('#resultStamp');
    if (stamp) requestAnimationFrame(() => requestAnimationFrame(() => stamp.classList.add('in')));
    const radar = page.querySelector('.radar-shape');
    if (radar) {
      radar.style.animation = 'none';
      requestAnimationFrame(() => { radar.style.animation = 'radarIn .9s cubic-bezier(.16,1,.3,1) both'; });
    }

    page.querySelector('#againBtn').onclick = () => App.nav('run', { force: true });
    page.querySelector('#detailBtn').onclick = () => showDetails(report);
    page.querySelector('#uploadBtn').onclick = async (e) => {
      if (!App.state.user) {
        toast('请先登录再上传成绩', 'info', 3600);
        App.openLogin();
        return;
      }
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = '上传中…';
      try {
        const r = await window.ourbench.serverUpload(report);
        toast(`上传成功 · 当前排名 #${r.rank ?? '—'}`, 'ok', 5000);
        btn.textContent = `已上榜 · #${r.rank ?? '—'}`;
        btn.classList.remove('btn-primary');
        btn.classList.add('btn');
      } catch (err) {
        btn.disabled = false;
        btn.textContent = '上传至全球榜单';
        toast('上传失败：' + err.message, 'err', 5000);
      }
    };
  }

  function showDetails(report) {
    const rows = [];
    for (const [sid, s] of Object.entries(report.suites || {})) {
      for (const q of (s.perQuestion || [])) {
        rows.push({ sid, q });
      }
    }
    let filter = 'all';
    const body = App.el(`<div>
      <div class="detail-filters">
        <div class="seg" id="dSeg"><button data-f="all" class="on">全部 ${rows.length}</button><button data-f="pass">通过</button><button data-f="fail">未通过</button></div>
      </div>
      <div style="max-height:56vh;overflow:auto;border:1px solid var(--border);border-radius:6px">
        <table class="detail-table"><thead><tr><th>套件</th><th>题目</th><th>判定</th><th>模型答案</th><th>标准答案</th><th>备注</th></tr></thead><tbody id="dBody"></tbody></table>
      </div>
    </div>`);
    const m = App.modal({ title: `逐题明细 · ${rows.length} 题`, sub: '通过 / 未通过由评分器判定；数值题含容差，代码题走沙箱或相似度。', body, wide: true });
    const tbody = body.querySelector('#dBody');
    function render() {
      const list = rows.filter(r => filter === 'all' || (filter === 'pass' ? r.q.correct : r.q.correct === false));
      tbody.innerHTML = list.map(({ sid, q }) => `<tr>
        <td class="mono">${esc(sid)}</td>
        <td class="mono">${esc(q.id)}</td>
        <td class="${q.correct ? 'ok' : 'no'}">${q.correct ? '通过' : q.correct === null ? '跳过' : '未通过'}</td>
        <td class="mono clip" title="${esc(q.extracted ?? '')}">${esc(q.extracted ?? '—')}</td>
        <td class="mono clip" title="${esc(q.gold ?? '')}">${esc(q.gold ?? '—')}</td>
        <td class="clip" title="${esc(q.detail || '')}">${esc(q.detail || '')}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted" style="padding:20px">没有符合条件的题目</td></tr>';
    }
    render();
    body.querySelectorAll('#dSeg button').forEach(b => {
      b.onclick = () => {
        filter = b.dataset.f;
        body.querySelectorAll('#dSeg button').forEach(x => x.classList.toggle('on', x === b));
        render();
      };
    });
    return m;
  }

  return () => {
    disposed = true;
    if (stopScan) { stopScan(); stopScan = null; }
    if (offStart) offStart();
    if (offProg) offProg();
    if (offDone) offDone();
  };
};
