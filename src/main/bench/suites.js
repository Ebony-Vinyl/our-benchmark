// 题库加载：benchmarks/ 目录（打包子集）+ data/benchmarks-full/（开发用完整库）
// + userData/benchmarks-full/（用户从服务器下载的完整题库，优先级最高）
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const BUNDLED_DIR = path.join(__dirname, '..', '..', '..', 'benchmarks');
const FULL_DIR = path.join(__dirname, '..', '..', '..', 'data', 'benchmarks-full');
function userFullDir() {
  try { return path.join(app.getPath('userData'), 'benchmarks-full'); }
  catch { return null; } // 测试环境（非 Electron）下无 userData
}
function suiteDirs() {
  return [userFullDir(), FULL_DIR, BUNDLED_DIR].filter(Boolean);
}

// 综合跑分的类别权重（安兔兔式加权）；AA 智能指数用 INDEXES 的四维体系
const CATEGORY_WEIGHTS = {
  code: 0.28,          // 代码：SWE-bench V/P、Terminal-Bench、SciCode、DeepSWE、FrontierCode
  science: 0.20,       // 科学推理：GPQA、CritPt、AIME、HMMT
  general: 0.20,       // 通用能力：HLE、SimpleQA、MMLU-Pro、MMMU-Pro
  agent: 0.16,         // 智能体：GDPval、AutomationBench
  long_context: 0.08,  // 长上下文：MRCR
  cyber: 0.08,         // 网络安全：CyberGym、ITBench
};

function loadSuites() {
  const suites = [];
  for (const dir of suiteDirs()) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
        if (!s.id || !Array.isArray(s.questions)) continue;
        const existing = suites.find(x => x.id === s.id);
        // 题多的优先（用户下载的完整库 > 开发全量 > 打包子集）
        if (!existing || existing.questions.length < s.questions.length) {
          const idx = existing ? suites.indexOf(existing) : suites.length;
          suites[idx] = {
            id: s.id, name: s.name, nameZh: s.nameZh, category: s.category,
            description: s.description, source: s.source, license: s.license,
            fullSize: s.fullSize || s.questions.length,
            sampled: !!s.sampled,
            questionCount: s.questions.length,
            isFull: (s.fullSize || s.questions.length) === s.questions.length && !s.sampled,
            localFile: path.join(dir, f),
            types: [...new Set(s.questions.map(q => q.type))],
          };
        }
      } catch { /* skip bad json */ }
    }
  }
  suites.sort((a, b) => (CATEGORY_WEIGHTS[b.category] || 0) - (CATEGORY_WEIGHTS[a.category] || 0) || a.id.localeCompare(b.id));
  return suites;
}

const _suiteCache = new Map();
function getSuiteQuestions(suiteId) {
  if (_suiteCache.has(suiteId)) return _suiteCache.get(suiteId);
  let best = null;
  for (const dir of suiteDirs()) {
    const f = path.join(dir, suiteId + '.json');
    if (!fs.existsSync(f)) continue;
    const s = JSON.parse(fs.readFileSync(f, 'utf-8'));
    if (!best || best.questions.length < s.questions.length) best = s;
  }
  if (!best) return null;
  const qs = best.questions;
  _suiteCache.set(suiteId, qs);
  return qs;
}

// 从服务器下载完整题库到 userData（用户跑完整测试集的入口）
async function downloadFullSuite(suiteId, fetchUrl) {
  const { requestJson } = require('../net/httpx');
  const res = await requestJson(fetchUrl, { timeoutMs: 300000 });
  if (res.status !== 200) throw new Error(`下载失败 HTTP ${res.status}`);
  const data = res.data;
  if (!data.id || !Array.isArray(data.questions) || !data.questions.length) throw new Error('题库格式无效');
  const dir = userFullDir();
  if (!dir) throw new Error('无用户数据目录');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, suiteId + '.json'), JSON.stringify(data));
  _suiteCache.delete(suiteId); // 让加载器重新读
  return { questions: data.questions.length };
}

function deleteLocalFull(suiteId) {
  const dir = userFullDir();
  if (!dir) return false;
  const f = path.join(dir, suiteId + '.json');
  try { fs.rmSync(f); _suiteCache.delete(suiteId); return true; } catch { return false; }
}

// 确定性采样（同一种子同一份题，保证同条件可比）
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function sampleQuestions(questions, n, seed = 42) {
  if (n >= questions.length) return questions.slice();
  const rnd = mulberry32(seed + questions.length);
  const pool = questions.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

// 根据题型渲染发给模型的题面
function renderPrompt(q, suite) {
  switch (q.type) {
    case 'choice': {
      let p = q.prompt + '\n';
      if (q.choices && q.choices.length) {
        p += '\n' + q.choices.map((c, i) => `${'ABCDEFGHIJ'[i]}. ${c}`).join('\n');
      }
      p += '\n\n请只输出正确选项的字母（如 A）。';
      return p;
    }
    case 'numeric':
      return q.prompt + '\n\n请一步步推理，并在最后一行以“答案：<数字>”的形式给出最终数值答案。';
    case 'math_boxed':
      return q.prompt + '\n\n请给出严谨解答，并把最终答案放进 \\boxed{} 中。';
    case 'exact':
      return q.prompt + '\n\n请直接给出简洁准确的最终答案，不要解释。';
    case 'patch':
      return q.prompt + '\n\n请给出修复该问题的最小代码补丁（ unified diff 或直接给出修改后的代码），不要解释。';
    case 'code_py':
      return '请完成下面的 Python 函数/程序，只输出代码（可以包含必要的 import），不要解释：\n\n' + q.prompt;
    default:
      return q.prompt;
  }
}

module.exports = { loadSuites, getSuiteQuestions, sampleQuestions, renderPrompt, CATEGORY_WEIGHTS, BUNDLED_DIR, FULL_DIR };
