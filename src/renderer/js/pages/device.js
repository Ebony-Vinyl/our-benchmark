// 设备信息 — 本机档案与已识别 Agent
Pages.device = function device(root) {
  const { esc, toast } = App;
  let disposed = false;

  root.innerHTML = `<div class="device-page">
    <div class="page-head">
      <div>
        <h1 class="page-title">设备信息</h1>
        <p class="page-sub">检测与跑分全部在本机完成；机器指纹只用于区分设备，不会上传。</p>
      </div>
      <div class="actions"><button class="btn btn-sm" id="copyFp">复制指纹</button></div>
    </div>
    <div class="device-grid">
      <section class="panel">
        <div class="panel-head"><h2>系统</h2><span class="sub" id="devHost">—</span></div>
        <div class="panel-body" style="padding:4px 16px"><div id="sysTable"><div class="empty"><span class="spinner"></span></div></div></div>
      </section>
      <section class="panel device-agents-panel">
        <div class="panel-head"><h2>已识别 Agent</h2><span class="sub" id="devAgents">—</span></div>
        <div class="panel-body" style="padding:4px 16px;display:flex;flex-direction:column">
          <div id="devAgentList"><div class="empty"><span class="spinner"></span></div></div>
          <div class="device-scan-note">扫描范围：用户目录下的常见配置目录、PATH 中的可执行文件与运行进程。不读取 API Key，不发送设备信息。</div>
        </div>
      </section>
    </div>
    <div class="notice mt24" style="max-width:760px">
      <div><b>关于检测</b><br>扫描范围限于用户目录下的常见配置目录、PATH 中的可执行文件与运行进程；不读取任何 API Key，不发送任何设备信息。真实模式下的 API Key 只保存在本机设置中。</div>
    </div>
  </div>`;

  const $ = (s) => root.querySelector(s);
  let fingerprint = '';

  (async () => {
    try {
      const info = await window.ourbench.sysInfo();
      if (disposed) return;
      fingerprint = info.machineId || '';
      $('#devHost').textContent = info.hostname || '本机';
      $('#sysTable').innerHTML = `<table class="kv">
        <tr><th>主机名</th><td>${esc(info.hostname || '—')}</td></tr>
        <tr><th>系统</th><td>${esc(info.platform || '—')} (${esc(info.arch || '—')})</td></tr>
        <tr><th>CPU</th><td>${esc(info.cpu || '—')}</td></tr>
        <tr><th>核心数</th><td>${info.cores || '—'} 线程</td></tr>
        <tr><th>内存</th><td>${info.memGb || '—'} GB</td></tr>
        <tr><th>Electron / Node</th><td>${esc(info.electron || '—')} / ${esc(info.node || '—')}</td></tr>
      </table>
      <div style="padding:12px 0 16px"><div class="k muted" style="font-size:11px;margin-bottom:6px">机器指纹</div><div class="fingerprint">${esc(info.machineId || '—')}</div></div>`;
    } catch (e) {
      if (!disposed) $('#sysTable').innerHTML = `<div class="empty">读取失败：${esc(e.message)}</div>`;
    }
  })();

  (async () => {
    try {
      const agents = await window.ourbench.detectAgents();
      if (disposed) return;
      App.state.agents = agents;
      const found = agents.filter(a => a.detected && !a.builtin);
      $('#devAgents').textContent = `${found.length} 个已识别`;
      const box = $('#devAgentList');
      if (!found.length) {
        box.innerHTML = `<div class="empty" style="text-align:left;padding:28px 0"><b>未检测到任何 Agent</b>仍可使用内置模拟 Agent 跑分。</div>`;
        return;
      }
      box.innerHTML = found.map(a => `<div class="device-agent">
        <span class="agent-monogram">${esc((a.vendor || a.name || '?').slice(0, 1).toUpperCase())}</span>
        <div style="min-width:0">
          <div class="nm">${esc(a.name)} ${a.kind === 'cli' ? '<span class="pill pill-outline" style="height:16px;font-size:9px">CLI</span>' : ''}</div>
          <div class="ev">${esc((a.evidence || []).join(' · ') || '已检测')}</div>
        </div>
        <div style="text-align:right"><div class="mono" style="font-size:11px;color:var(--muted)">${esc(a.model || '默认模型')}</div><div class="muted" style="font-size:10px;margin-top:2px">${a.modelFromConfig ? '读自配置' : '默认值'}</div></div>
      </div>`).join('');
    } catch (e) {
      if (!disposed) $('#devAgentList').innerHTML = `<div class="empty">检测失败：${esc(e.message)}</div>`;
    }
  })();

  $('#copyFp').onclick = async () => {
    if (!fingerprint) return toast('指纹尚未就绪', 'info');
    try {
      await navigator.clipboard.writeText(fingerprint);
      toast('机器指纹已复制', 'ok');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = fingerprint;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('机器指纹已复制', 'ok'); } catch { toast('复制失败', 'err'); }
      ta.remove();
    }
  };

  return () => { disposed = true; };
};
