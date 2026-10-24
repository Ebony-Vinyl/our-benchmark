// 评分器：从模型输出中抽取答案并判分。支持 choice / numeric / math_boxed / code_py / instruction。
const { runPythonSandbox } = require('./sandbox');
const { checkInstruction } = require('./ifeval-checks');

const LETTERS = 'ABCDEFGHIJ';

// ---------------- 答案抽取 ----------------
function extractChoice(output, nChoices = 4) {
  if (!output) return null;
  const text = output.trim();
  const pool = LETTERS.slice(0, Math.max(2, nChoices));
  // 优先匹配明确表述
  const patterns = [
    /(?:答案|正确选项|选)(?:是|为|：|:)?\s*\**\s*([A-J])\b/i,
    /(?:answer|option|choice)\s*(?:is|:)?\s*\**\s*([A-J])\b/i,
    /\**([A-J])\**\s*(?:是正确|正确|is correct)/i,
    /^\s*\**([A-J])\**\s*[.。)]?\s*$/m,
    /(?<![A-Za-z0-9])([A-J])\s*[.。、)](?!\w)/,
    /(?<![A-Za-z0-9])([A-J])(?![A-Za-z0-9])/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && pool.includes(m[1].toUpperCase())) return m[1].toUpperCase();
  }
  return null;
}

function extractNumbers(text) {
  const out = [];
  const re = /-?\d+(?:,\d{3})*(?:\.\d+)?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(parseFloat(m[0].replace(/,/g, '')));
  }
  return out;
}

function extractNumeric(output, gold, toleranceRel = 0.02) {
  const nums = extractNumbers(output || '');
  if (!nums.length) return null;
  const target = parseFloat(gold);
  const last = nums[nums.length - 1];
  if (Math.abs(last - target) <= Math.max(Math.abs(target) * toleranceRel, 1e-9)) return true;
  // 宽松：任何出现的数字命中即算（模型常写 "答案是 312。因此选 312"）
  for (const n of nums) {
    if (Math.abs(n - target) <= Math.max(Math.abs(target) * toleranceRel, 1e-9)) return true;
  }
  return false;
}

function normalizeMath(s) {
  return String(s || '')
    .replace(/\r/g, '')
    .replace(/\\left|\\right/g, '')
    .replace(/\\dfrac|\\tfrac|\\frac/g, '\\frac')
    .replace(/\\text\{[^}]*\}/g, '')
    .replace(/\s+/g, '')
    .replace(/\{|\}/g, m => m)
    .replace(/^\$|\$$/g, '')
    .toLowerCase();
}

function extractBoxed(output) {
  const text = output || '';
  let m = text.match(/\\boxed\{([\s\S]*?)\}(?=\s|$|[.,;：:）)])/);
  if (!m) m = text.match(/\\boxed\{([\s\S]*)\}/); // 兜底贪心
  if (!m) return null;
  // 处理嵌套大括号
  let depth = 0, start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('\\boxed{', i)) { start = i + 7; depth = 1; i = start - 1; continue; }
    if (start >= 0) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(start, i); }
    }
  }
  return m ? m[1] : null;
}

function looksEqual(a, b) {
  const na = normalizeMath(a), nb = normalizeMath(b);
  if (na === nb) return true;
  const fa = parseFloat(String(a).replace(/[^\d.\-eE+]/g, ''));
  const fb = parseFloat(String(b).replace(/[^\d.\-eE+]/g, ''));
  if (!isNaN(fa) && !isNaN(fb)) return Math.abs(fa - fb) < 1e-6 * Math.max(1, Math.abs(fa));
  return false;
}

function stripCodeFences(output) {
  const m = String(output || '').match(/```(?:python|py|diff|patch)?\s*\n([\s\S]*?)```/);
  if (m) return m[1];
  const m2 = String(output || '').match(/```([\s\S]*?)```/);
  if (m2) return m2[1];
  return String(output || '');
}

// ---------------- exact（简答/知识型，HLE / SimpleQA / GDPval 文本任务） ----------------
function normExact(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\\boxed{|}/g, '')
    .replace(/^(answer|final answer|答案)\s*[:：]\s*/i, '')
    .replace(/^the answer is\s*/i, '')
    .replace(/^(a|an|the)\s+/i, '')
    .replace(/[."'"，。！!？?\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function gradeExact(output, gold) {
  const a = normExact(output), b = normExact(gold);
  if (!a) return false;
  if (a === b) return true;
  // 数字形式
  const fa = parseFloat(a.replace(/[^\d.\-eE+]/g, '')), fb = parseFloat(b.replace(/[^\d.\-eE+]/g, ''));
  if (!isNaN(fa) && !isNaN(fb) && Math.abs(fa - fb) < 1e-9 * Math.max(1, Math.abs(fb))) return true;
  // 短答案包含（gold 很短时，如 "paris" ⊂ "the city of paris"）
  if (b.length <= 30 && a.includes(b)) return true;
  return false;
}

// ---------------- patch（SWE-bench 系列：与金标补丁的近似对比评分） ----------------
function tokenizeCode(s) {
  const body = String(s || '')
    .replace(/```(?:diff|patch|python)?/g, '\n')
    .split('\n')
    .filter(line => !/^\s*(diff --git|--- |\+\+\+ |index |old mode|new mode|new file|deleted file|rename )/.test(line))
    .join('\n');
  return body.split(/[^A-Za-z0-9_]+/).filter(t => t.length > 1);
}
function patchSimilarity(modelOut, goldPatch) {
  const A = tokenizeCode(modelOut), B = tokenizeCode(goldPatch);
  if (!A.length || !B.length) return 0;
  const countB = new Map();
  for (const t of B) countB.set(t, (countB.get(t) || 0) + 1);
  let hit = 0;
  const used = new Map();
  for (const t of A) {
    const u = used.get(t) || 0;
    if (u < (countB.get(t) || 0)) { hit++; used.set(t, u + 1); }
  }
  const p = hit / A.length, r = hit / B.length;
  return (p + r) === 0 ? 0 : (2 * p * r) / (p + r); // token-F1
}
function gradePatch(output, goldPatch, threshold = 0.42) {
  const model = stripCodeFences(output);
  if (!model.trim()) return { correct: false, sim: 0 };
  const sim = patchSimilarity(model, goldPatch);
  return { correct: sim >= threshold, sim: +sim.toFixed(3) };
}

// ---------------- 单题判分 ----------------
/**
 * @returns {{correct: boolean|null, extracted: string|null, detail: string}}
 */
async function gradeQuestion(question, output, sandboxEnabled = true) {
  const res = { correct: null, extracted: null, detail: '' };
  if (output == null || output === '') {
    res.detail = 'empty output';
    return res;
  }
  switch (question.type) {
    case 'choice': {
      const n = question.choices && question.choices.length ? question.choices.length : 10;
      res.extracted = extractChoice(output, n);
      if (!res.extracted) { res.correct = false; res.detail = '未找到选项字母'; return res; }
      res.correct = res.extracted === question.answer;
      return res;
    }
    case 'numeric': {
      res.correct = extractNumeric(output, question.answer, question.tolerance ?? 0.02);
      res.extracted = (extractNumbers(output).pop() ?? '') + '';
      return res;
    }
    case 'math_boxed': {
      const boxed = extractBoxed(output);
      res.extracted = boxed;
      if (!boxed) { res.correct = false; res.detail = '未找到 \\boxed{}'; return res; }
      res.correct = looksEqual(boxed, question.answer);
      return res;
    }
    case 'code_py': {
      if (!sandboxEnabled) { res.correct = false; res.detail = '沙箱未启用'; return res; }
      const code = stripCodeFences(output);
      const r = await runPythonSandbox(question, code);
      res.correct = r.passed;
      res.extracted = code.slice(0, 60);
      res.detail = r.error || (r.passed ? '测试通过' : '测试未通过');
      return res;
    }
    case 'instruction': {
      const r = checkInstruction(question, output);
      res.correct = r.passed;
      res.extracted = (output || '').slice(0, 80);
      res.detail = r.reason;
      return res;
    }
    case 'exact': {
      res.correct = gradeExact(output, question.answer);
      res.extracted = normExact(output).slice(0, 80);
      res.detail = res.correct ? '答案匹配' : '答案不符';
      return res;
    }
    case 'patch': {
      const r = gradePatch(output, question.goldPatch || '', question.threshold ?? 0.42);
      res.correct = r.correct;
      res.extracted = `相似度 ${r.sim}`;
      res.detail = r.correct ? `补丁相似度 ${r.sim} ≥ 阈值` : `补丁相似度 ${r.sim} < 阈值（官方需容器执行测试，此处为近似判分）`;
      return res;
    }
    case 'keyset': {
      // 智能体任务：输出中命中必需关键值的比例（AutomationBench 等）
      const req = Array.isArray(question.required) ? question.required : [];
      if (!req.length) { res.correct = null; res.detail = '无关键值'; return res; }
      const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
      const hay = norm(output);
      let hit = 0;
      for (const v of req) if (hay.includes(norm(v))) hit++;
      const rate = hit / req.length;
      const th = question.threshold ?? 0.75;
      res.correct = rate >= th;
      res.extracted = `${hit}/${req.length} 关键值`;
      res.detail = `关键值命中 ${Math.round(rate * 100)}%（阈值 ${Math.round(th * 100)}%）`;
      return res;
    }
    default:
      res.correct = null;
      res.detail = '未知题型';
      return res;
  }
}

module.exports = { gradeQuestion, extractChoice, extractBoxed, extractNumbers, normalizeMath, looksEqual, stripCodeFences, gradeExact, patchSimilarity, gradePatch };
