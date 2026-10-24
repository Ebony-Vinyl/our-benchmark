// 设置 — 两栏式设置页，改动即保存
Pages.settings = function settings(root) {
  const { esc, toast } = App;
  let disposed = false;
  let s = {};

  root.innerHTML = `<div class="settings-page">
    <div class="page-head">
      <div>
        <h1 class="page-title">设置</h1>
        <p class="page-sub">所有配置只保存在本机。改动会立即保存。</p>
      </div>
      <div class="actions"><span class="save-stamp" id="saveStamp">已保存</span></div>
    </div>

    <section class="settings-section">
      <div class="settings-label"><h2>跑分</h2><p>控制跑分时的并发与判分方式。模拟模式不消耗 API。</p></div>
      <div class="settings-panel">
        <div class="switch-row">
          <div><div class="lb">默认并发数</div><div class="ds">真实模式建议 1–2；模拟模式可以拉满。</div></div>
          <select class="lb-select" id="setConc" style="height:30px">${[1, 2, 4, 8, 12].map(n => `<option value="${n}">${n}</option>`).join('')}</select>
        </div>
        <div class="switch-row">
          <div><div class="lb">代码沙箱执行</div><div class="ds">代码题需要本机 Python 3.8+ 执行官方测试用例。</div></div>
          <label class="switch"><input type="checkbox" id="setSandbox"><span class="sl"></span></label>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <div class="settings-label"><h2>服务器</h2><p>成绩上传、全球榜单与论坛都走这个地址。关闭“使用线上服务器”会连接本地开发服务器。</p><div class="settings-side-note" id="serverSummary"></div></div>
      <div class="settings-panel">
        <div class="switch-row">
          <div><div class="lb">使用线上服务器</div><div class="ds">关闭后连接本地开发服务器，适合调试。</div></div>
          <label class="switch"><input type="checkbox" id="setProd"><span class="sl"></span></label>
        </div>
        <div class="field"><label for="setProdUrl">线上服务器地址</label><input id="setProdUrl" placeholder="http://144.126.133.165:8600"></div>
        <div class="field"><label for="setLocalUrl">本地服务器地址</label><input id="setLocalUrl" placeholder="http://127.0.0.1:8600"></div>
        <div class="row-end" style="justify-content:flex-start">
          <button class="btn btn-sm" id="testServer">测试连接</button>
          <span class="muted" id="testServerOut" style="font-size:11.5px"></span>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <div class="settings-label"><h2>真实模式</h2><p>真实模式会把题目发送给 CLI Agent 或 OpenAI 兼容 API，<b>产生真实 token 消耗与费用</b>。默认锁死。</p></div>
      <div class="settings-panel">
        <div class="switch-row">
          <div><div class="lb">解锁真实模式</div><div class="ds" id="unlockState">当前：锁定</div></div>
          <label class="switch"><input type="checkbox" id="setUnlock"><span class="sl"></span></label>
        </div>
        <div class="field ${s.realModeUnlocked ? '' : 'hidden'}" id="ackField"><label for="setAck">确认串</label><input id="setAck" placeholder="I-UNDERSTAND-THE-COST"><div class="hint">输入 <span class="inline-code">I-UNDERSTAND-THE-COST</span> 才会真正解锁。</div></div>
        <div id="apiFields" class="${s.realModeUnlocked ? '' : 'hidden'}">
          <div class="field"><label for="setApiBase">Base URL</label><input id="setApiBase" placeholder="https://api.openai.com/v1"></div>
          <div class="field"><label for="setApiModel">模型名</label><input id="setApiModel" placeholder="gpt-5"></div>
          <div class="field"><label for="setApiKey">API Key</label><input id="setApiKey" type="password" placeholder="sk-..."><div class="hint" id="keyHint">留空保持不变。Key 只存本机。</div></div>
          <div class="field"><label for="setCliAgent">或使用 CLI Agent</label><select id="setCliAgent"><option value="">— 不使用 —</option></select></div>
        </div>
      </div>
    </section>

    <section class="settings-section danger-zone">
      <div class="settings-label"><h2>本地数据</h2><p>历史记录只保存在这台机器上。清空后无法恢复。</p></div>
      <div class="settings-panel">
        <div class="switch-row">
          <div><div class="lb">清空本地跑分历史</div><div class="ds">云端已上传的成绩不受影响。</div></div>
          <button class="btn btn-sm btn-danger" id="clearHist">清空</button>
        </div>
      </div>
    </section>
  </div>`;

  const $ = (s2) => root.querySelector(s2);
  let stampTimer = 0;
  function stamp() {
    const el = $('#saveStamp');
    if (!el) return;
    el.classList.add('show');
    clearTimeout(stampTimer);
    stampTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }
  async function save(patch) {
    try {
      await window.ourbench.setSettings(patch);
      Object.assign(s, patch);
      App.state.settings = { ...(App.state.settings || {}), ...patch };
      stamp();
    } catch (e) {
      toast('保存失败：' + e.message, 'err');
    }
  }

  (async () => {
    try {
      s = await window.ourbench.getSettings();
      if (disposed) return;
      App.state.settings = s;
      $('#setConc').value = String(s.concurrency || 4);
      $('#setSandbox').checked = !!s.sandboxEnabled;
      $('#setProd').checked = !!s.useProductionServer;
      $('#setProdUrl').value = s.productionServerUrl || '';
      $('#setLocalUrl').value = s.serverUrl || '';
      updateServerSummary();
      $('#setUnlock').checked = !!s.realModeUnlocked;
      $('#setAck').value = s.unlockAcknowledge || '';
      $('#setApiBase').value = s.apiBaseUrl || '';
      $('#setApiModel').value = s.apiModel || '';
      if (s.apiKeyMasked) $('#keyHint').textContent = `已保存 ${s.apiKeyMasked}；留空保持不变。`;
      updateUnlockUI(!!s.realModeUnlocked);

      let agents = App.state.agents;
      if (!agents || !agents.length) {
        try { agents = await window.ourbench.detectAgents(); App.state.agents = agents; } catch { agents = []; }
      }
      const cli = (agents || []).filter(a => a.kind === 'cli');
      $('#setCliAgent').innerHTML = '<option value="">— 不使用 —</option>' + cli.map(a => `<option value="${esc(a.id)}" ${s.cliAgentId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
    } catch (e) {
      toast('读取设置失败：' + e.message, 'err');
    }
  })();

  function updateUnlockUI(on) {
    $('#ackField').classList.toggle('hidden', !on);
    $('#apiFields').classList.toggle('hidden', !on);
    $('#unlockState').innerHTML = on
      ? '当前：<b style="color:var(--warning)">已解锁</b> · 请确认确认串正确'
      : '当前：锁定（推荐，零消耗）';
  }

  function updateServerSummary() {
    const el = $('#serverSummary');
    if (!el) return;
    const prod = $('#setProd').checked;
    const url = prod ? ($('#setProdUrl').value.trim() || '未填写') : ($('#setLocalUrl').value.trim() || '未填写');
    el.innerHTML = `当前连接：${prod ? '线上服务器' : '本地服务器'}<br><span class="mono">${esc(url)}</span>`;
  }

  $('#setConc').onchange = (e) => save({ concurrency: Number(e.target.value) });
  $('#setSandbox').onchange = (e) => save({ sandboxEnabled: e.target.checked });
  $('#setProd').onchange = (e) => { save({ useProductionServer: e.target.checked }); updateServerSummary(); };
  $('#setProdUrl').onchange = (e) => { save({ productionServerUrl: e.target.value.trim() }); updateServerSummary(); };
  $('#setLocalUrl').onchange = (e) => { save({ serverUrl: e.target.value.trim() }); updateServerSummary(); };
  $('#setUnlock').onchange = (e) => {
    const on = e.target.checked;
    updateUnlockUI(on);
    save({ realModeUnlocked: on });
    if (on) toast('已解锁开关；输入确认串后才会真正生效', 'info', 4200);
  };
  $('#setAck').onchange = (e) => save({ unlockAcknowledge: e.target.value.trim() });
  $('#setApiBase').onchange = (e) => save({ apiBaseUrl: e.target.value.trim() });
  $('#setApiModel').onchange = (e) => save({ apiModel: e.target.value.trim() });
  $('#setApiKey').onchange = (e) => {
    const v = e.target.value.trim();
    if (v) save({ apiKey: v });
    e.target.value = '';
  };
  $('#setCliAgent').onchange = (e) => save({ cliAgentId: e.target.value || null });
  $('#testServer').onclick = async () => {
    const out = $('#testServerOut');
    out.textContent = '测试中…';
    try {
      await window.ourbench.serverHealth();
      out.textContent = '连接正常';
      out.style.color = 'var(--positive)';
      App.refreshServer();
    } catch (e) {
      out.textContent = e.message;
      out.style.color = 'var(--negative)';
    }
  };
  $('#clearHist').onclick = async () => {
    const ok = await App.confirm({
      title: '清空本地跑分历史',
      body: '将删除这台机器上的全部跑分历史，无法恢复。云端成绩不受影响。',
      confirmLabel: '清空',
      danger: true,
    });
    if (!ok) return;
    await window.ourbench.clearHistory();
    toast('已清空本地历史', 'info');
  };

  return () => { disposed = true; clearTimeout(stampTimer); };
};
