// 跑分引擎：并发调度、进度事件、计分汇总
const os = require('os');
const crypto = require('crypto');
const { gradeQuestion } = require('./scorer');
const { getSuiteQuestions, sampleQuestions, renderPrompt, CATEGORY_WEIGHTS } = require('./suites');
const { computeIndexes } = require('./indexes');

const activeRuns = new Map(); // runId -> {cancel}

/**
 * 运行一次跑分
 * @param {object} opts
 *  adapter        已构造的适配器（Mock / Cli / API）
 *  agentName      展示用 Agent 名
 *  modelName      模型名
 *  suiteIds       要跑的套件 id 列表
 *  sampleSize     每套题数（0 = 全部）
 *  concurrency    并发数
 *  emit(eventName, payload) 进度回调
 */
async function runBenchmark(opts) {
  const { adapter, agentName, modelName, suiteIds, sampleSize = 30, concurrency = 4, emit, sandboxEnabled = true } = opts;
  const runId = 'run_' + crypto.randomBytes(8).toString('hex');
  const run = { cancelled: false, startedAt: new Date().toISOString() };
  activeRuns.set(runId, run);

  const results = {};   // suiteId -> {total, correct, skipped, errors, perQuestion:[]}
  const suiteMetas = {};
  let done = 0, total = 0;

  // 1. 准备题目
  const jobs = [];
  for (const sid of suiteIds) {
    const qs = getSuiteQuestions(sid);
    if (!qs || !qs.length) continue;
    const picked = sampleSize > 0 ? sampleQuestions(qs, sampleSize) : qs;
    suiteMetas[sid] = { total: picked.length, correct: 0, skipped: 0, errors: 0, perQuestion: [] };
    for (const q of picked) {
      jobs.push({ suiteId: sid, q });
    }
  }
  total = jobs.length;
  emit('run:start', { runId, total, suites: Object.keys(suiteMetas) });

  // 2. 并发执行
  let cursor = 0;
  const worker = async () => {
    while (!run.cancelled) {
      const i = cursor++;
      if (i >= jobs.length) break;
      const { suiteId, q } = jobs[i];
      const prompt = renderPrompt(q, { id: suiteId });
      const t0 = Date.now();
      let resp, grade;
      try {
        resp = await adapter.runPrompt({ prompt, question: q, category: suiteCategory(suiteId) });
        if (run.cancelled) break;
        grade = await gradeQuestion(q, resp.output, sandboxEnabled);
      } catch (e) {
        grade = { correct: false, extracted: null, detail: '异常: ' + String(e.message || e).slice(0, 150) };
        resp = { output: '', error: grade.detail };
      }
      const s = suiteMetas[suiteId];
      if (grade.correct === null) { s.skipped++; }
      else if (grade.correct) { s.correct++; }
      else if (resp.error) { s.errors++; }
      s.perQuestion.push({
        id: q.id, type: q.type, correct: grade.correct, extracted: grade.extracted,
        gold: q.type === 'choice' ? q.answer : (q.type === 'numeric' || q.type === 'math_boxed' ? q.answer : null),
        detail: grade.detail, latencyMs: resp.latencyMs, error: resp.error || undefined,
        output: (resp.output || '').slice(0, 2000),
      });
      done++;
      emit('run:progress', {
        runId, done, total, suiteId, questionId: q.id, correct: grade.correct,
        latencyMs: resp.latencyMs, lastOutput: (resp.output || '').slice(0, 120),
        accuracySoFar: s.perQuestion.filter(x => x.correct).length / Math.max(1, s.perQuestion.length - s.perQuestion.filter(x => x.correct === null).length),
      });
    }
  };
  const nWorkers = Math.max(1, Math.min(concurrency, 16));
  await Promise.all(Array.from({ length: nWorkers }, worker));

  // 3. 汇总
  const suiteScores = {};
  for (const [sid, s] of Object.entries(suiteMetas)) {
    const graded = s.total - s.skipped;
    suiteScores[sid] = {
      name: sid, total: s.total, graded, correct: s.correct,
      accuracy: graded > 0 ? s.correct / graded : 0, skipped: s.skipped, errors: s.errors,
      perQuestion: s.perQuestion,
    };
  }
  const summary = computeSummary(suiteScores);
  const report = {
    runId,
    agentName, modelName,
    mock: adapter.kind === 'mock',
    startedAt: run.startedAt,
    finishedAt: new Date().toISOString(),
    suites: suiteScores,
    summary,
    host: { platform: os.platform(), release: os.release(), cpu: os.cpus()[0]?.model, cores: os.cpus().length, memGb: Math.round(os.totalmem() / 1073741824) },
  };
  activeRuns.delete(runId);
  emit('run:done', { runId, report, cancelled: run.cancelled });
  return report;
}

function suiteCategory(suiteId) {
  // 与 loadSuites 缓存一致：从文件读取 category
  const { loadSuites } = require('./suites');
  const s = loadSuites().find(x => x.id === suiteId);
  return s ? s.category : 'knowledge';
}

function computeSummary(suiteScores) {
  // 类别聚合
  const { loadSuites } = require('./suites');
  const metas = loadSuites();
  const catAgg = {};
  for (const [sid, s] of Object.entries(suiteScores)) {
    if (!s.graded) continue;
    const cat = (metas.find(m => m.id === sid)?.category) || 'knowledge';
    if (!catAgg[cat]) catAgg[cat] = { correct: 0, graded: 0 };
    catAgg[cat].correct += s.correct;
    catAgg[cat].graded += s.graded;
  }
  const categories = {};
  let intelligence = 0, weightSum = 0;
  for (const [cat, a] of Object.entries(catAgg)) {
    const acc = a.graded ? a.correct / a.graded : 0;
    categories[cat] = { accuracy: acc, correct: a.correct, graded: a.graded, weight: CATEGORY_WEIGHTS[cat] || 0 };
    const w = CATEGORY_WEIGHTS[cat] || 0;
    intelligence += acc * w;
    weightSum += w;
  }
  if (weightSum > 0) intelligence /= weightSum; // 0-1

  // 安兔兔式大总分：智能指数 × 满分刻度，加上每 1% 准确率奖励，制造大数字观感
  const totalScore = Math.round(intelligence * 2000000);
  return {
    intelligenceIndex: Math.round(intelligence * 1000) / 10, // 0-100, 一位小数（AA 风格）
    totalScore,                                            // 安兔兔风格大分
    categories,
    indexes: computeIndexes(suiteScores),                  // AA 指数体系（四维）
    accuracyOverall: (() => {
      let c = 0, g = 0;
      for (const a of Object.values(catAgg)) { c += a.correct; g += a.graded; }
      return g ? +(c / g).toFixed(4) : 0;
    })(),
  };
}

function cancelRun(runId) {
  const r = activeRuns.get(runId);
  if (r) { r.cancelled = true; return true; }
  return false;
}

module.exports = { runBenchmark, cancelRun, computeSummary };
