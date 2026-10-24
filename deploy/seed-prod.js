// 生产数据种子（在服务器本地跑：node seed-prod.js）
const B = 'http://127.0.0.1:8600';
const scores = [
  ['Mock-GPT-5.3', 'Codex CLI', 1834210, 91.7, { code: .92, science: .88, general: .93, agent: .9, long_context: .85, cyber: .8 }],
  ['Mock-Claude-Opus-4.5', 'Claude Code', 1768420, 88.4, { code: .9, science: .86, general: .91, agent: .87, long_context: .82, cyber: .78 }],
  ['Mock-GLM-5.3', 'zcode', 1721050, 86.0, { code: .88, science: .84, general: .89, agent: .85, long_context: .84, cyber: .74 }],
  ['Mock-Gemini-3-Pro', 'Gemini CLI', 1652000, 82.6, { code: .84, science: .82, general: .87, agent: .8, long_context: .86, cyber: .72 }],
  ['Mock-DeepSeek-V4', 'Aider', 1580400, 79.0, { code: .83, science: .78, general: .82, agent: .76, long_context: .75, cyber: .7 }],
  ['Mock-Qwen3.5-Max', 'Qwen Code', 1498700, 74.9, { code: .8, science: .74, general: .79, agent: .73, long_context: .72, cyber: .66 }],
  ['Mock-Llama-4-70B', 'Continue', 987600, 49.4, { code: .52, science: .48, general: .55, agent: .42, long_context: .45, cyber: .4 }],
  ['Mock-GLM-4-Flash', 'zcode', 720300, 36.0, { code: .38, science: .34, general: .4, agent: .3, long_context: .33, cyber: .28 }],
];

async function jf(path, opts = {}) {
  const res = await fetch(B + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}: ${await res.text()}`);
  return res.json();
}

(async () => {
  let g = await jf('/api/v1/auth/guest', { method: 'POST', body: JSON.stringify({ nickname: '跑分君' }) });
  const auth = { Authorization: 'Bearer ' + g.token };
  for (const [model, agent, total, iq, cats] of scores) {
    await jf('/api/v1/scores', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        agent, model, mock: true, totalScore: total, intelligenceIndex: iq, accuracyOverall: iq / 100,
        categories: Object.fromEntries(Object.entries(cats).map(([c, v]) => [c, { accuracy: v, correct: Math.round(v * 50), graded: 50 }])),
        suites: {}, host: { platform: 'win32', cpu: 'Demo', cores: 16 },
        runId: 'seed_' + model, finishedAt: new Date().toISOString(),
      }),
    });
  }
  await jf('/api/v1/forum/threads', { method: 'POST', headers: auth, body: JSON.stringify({ title: '🏆 Our Benchmark 全球榜单正式开放！', body: '欢迎晒分！跑完分点「上传至全球榜单」，然后来这个帖子里报个到～', category: 'score' }) });
  g = await jf('/api/v1/auth/guest', { method: 'POST', body: JSON.stringify({ nickname: '调试猫' }) });
  await jf('/api/v1/forum/threads', { method: 'POST', headers: { Authorization: 'Bearer ' + g.token }, body: JSON.stringify({ title: 'SWE-bench 的补丁相似度判分是什么原理？', body: '桌面版对 SWE 类任务采用与金标补丁的 token-F1 相似度近似判分，官方容器执行判分在路线图里。详见 README。', category: 'benchmark' }) });
  const lb = await jf('/api/v1/leaderboard?sort=intelligenceIndex');
  console.log('榜单:', lb.leaderboard.map(r => r.rank + '.' + r.model).join(' '));
  const stats = await jf('/api/v1/stats');
  console.log('stats:', JSON.stringify(stats));
  console.log('SEED-OK');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
