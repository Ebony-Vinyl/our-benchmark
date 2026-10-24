// 启动
document.addEventListener('DOMContentLoaded', () => {
  App.init().catch((e) => {
    console.error('[boot]', e);
    const view = document.getElementById('view');
    if (view) view.innerHTML = `<div class="page"><div class="empty"><b>应用启动失败</b>${String(e && e.message || e)}</div></div>`;
  });
});
