// 主进程 HTTP 工具：node:http/https 直连，绕过 Chromium 网络栈与系统代理
// （Electron 主进程 global fetch 走 Chromium 栈，在 TUN/全局代理环境下连 localhost 都会失败）
const http = require('http');
const https = require('https');
const { URL } = require('url');

function requestRaw(url, { method = 'GET', headers = {}, body, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const data = body != null ? Buffer.from(JSON.stringify(body)) : null;
    const req = mod.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: {
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
        ...headers,
      },
      timeout: timeoutMs,
      agent: false,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }));
    });
    req.on('timeout', () => req.destroy(new Error(`请求超时 (${timeoutMs}ms): ${url}`)));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function requestJson(url, opts = {}) {
  const res = await requestRaw(url, opts);
  const text = res.body.toString('utf-8');
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
  return { status: res.status, data };
}

module.exports = { requestRaw, requestJson };
