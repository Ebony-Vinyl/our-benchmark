// 题库/引擎集成测试（需要至少部分题库 JSON 已生成；没有则跳过）
const assert = require('assert');
const Module = require('module');

// ---- electron 桩（app.getPath 用临时目录）----
const os = require('os');
const path = require('path');
const fs = require('fs');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-suites-'));
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return { app: { getPath: (k) => path.join(tmpRoot, k) } };
  }
  return origLoad.apply(this, arguments);
};

const { loadSuites, getSuiteQuestions, sampleQuestions, renderPrompt } = require('../src/main/bench/suites');

let passed = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.log('  ✗', name, '\n    ', e.message); throw e; }
}

(async () => {
  const suites = loadSuites();
  console.log(`  发现 ${suites.length} 套题库: ${suites.map(s => s.id).join(', ') || '(无)'}`);

  t('题库文件结构合法', () => {
    for (const s of suites) {
      assert.ok(s.id && s.name && s.category, `套件 ${s.id} 缺字段`);
      const qs = getSuiteQuestions(s.id);
      assert.ok(Array.isArray(qs) && qs.length > 0, `${s.id} 无题目`);
      for (const q of qs.slice(0, 50)) {
        assert.ok(q.id && q.type && q.prompt != null, `${s.id} 题目缺字段: ${JSON.stringify(q).slice(0, 80)}`);
        if (q.type === 'choice') {
          const hasExplicit = Array.isArray(q.choices) && q.choices.length >= 2 && /^[A-J]$/.test(q.answer);
          const hasInline = Array.isArray(q.choices) && q.choices.length === 0 && /^[A-J]$/.test(q.answer) && /A[\.\、\)]/.test(q.prompt || '');
          assert.ok(hasExplicit || hasInline, `${s.id}/${q.id} choice 结构错`);
        }
        if (q.type === 'numeric') assert.ok(q.answer != null && !isNaN(parseFloat(q.answer)), `${s.id}/${q.id} numeric 答案错`);
        if (q.type === 'patch') assert.ok(q.goldPatch, `${s.id}/${q.id} patch 缺金标`);
      }
    }
  });

  t('采样确定性（同种子同结果）', () => {
    const qs = getSuiteQuestions(suites[0]?.id) || [];
    if (qs.length > 5) {
      const a = sampleQuestions(qs, 5, 42);
      const b = sampleQuestions(qs, 5, 42);
      assert.deepStrictEqual(a.map(x => x.id), b.map(x => x.id));
      assert.strictEqual(a.length, 5);
    }
  });

  t('renderPrompt 覆盖全部题型', () => {
    const types = new Set();
    for (const s of suites) getSuiteQuestions(s.id).slice(0, 20).forEach(q => types.add(q.type));
    for (const ty of types) {
      const p = renderPrompt({ type: ty, prompt: 'X', choices: ['a', 'b'], answer: 'A' }, { id: 'x' });
      assert.ok(typeof p === 'string' && p.includes('X'), ty + ' 渲染失败');
    }
    console.log(`    题型覆盖: ${[...types].join(', ')}`);
  });

  // ---- Mock 全流程跑分 ----
  const { MockAdapter } = require('../src/main/adapters/adapters');
  const { runBenchmark } = require('../src/main/bench/runner');
  const events = [];
  const emit = (n, p) => events.push(n);

  const benchSuites = suites.slice(0, Math.min(3, suites.length));
  if (benchSuites.length) {
    const report = await runBenchmark({
      adapter: new MockAdapter('test-agent', 'test-model-7b'),
      agentName: 'TestAgent', modelName: 'test-model-7b',
      suiteIds: benchSuites.map(s => s.id),
      sampleSize: 4, concurrency: 2, emit,
    });
    t('Mock 跑分产出合法报告', () => {
      assert.ok(report.summary.totalScore >= 0 && report.summary.totalScore <= 2000000);
      assert.ok(report.summary.intelligenceIndex >= 0 && report.summary.intelligenceIndex <= 100);
      for (const sid of benchSuites.map(s => s.id)) {
        const s = report.suites[sid];
        assert.ok(s && s.total === 4 && s.correct <= 4, sid + ' 结果异常');
      }
      assert.ok(report.summary.indexes && report.summary.indexes.length >= 3, '缺指数');
    });
    t('进度事件已发出', () => {
      assert.ok(events.includes('run:start') && events.includes('run:done'));
      assert.ok(events.filter(e => e === 'run:progress').length >= benchSuites.length * 4 - 2);
    });
    t('同模型分数可复现（确定性）', async () => {
      const r2 = await runBenchmark({
        adapter: new MockAdapter('test-agent', 'test-model-7b'),
        agentName: 'TestAgent', modelName: 'test-model-7b',
        suiteIds: benchSuites.map(s => s.id), sampleSize: 4, concurrency: 2, emit: () => { },
      });
      assert.strictEqual(r2.summary.totalScore, report.summary.totalScore);
    });
    t('不同模型分数不同（画像区分）', async () => {
      const r3 = await runBenchmark({
        adapter: new MockAdapter('test-agent', 'another-model-72b'),
        agentName: 'TestAgent', modelName: 'another-model-72b',
        suiteIds: benchSuites.map(s => s.id), sampleSize: 4, concurrency: 4, emit: () => { },
      });
      assert.notStrictEqual(r3.summary.totalScore, report.summary.totalScore);
    });
    console.log(`    Mock 报告样例: 总分=${report.summary.totalScore} 指数=${report.summary.intelligenceIndex} 指数体系=${report.summary.indexes.map(i => i.id + ':' + (i.value ?? '—')).join(' ')}`);
  } else {
    console.log('  (跳过引擎测试：本地无题库 JSON)');
  }

  console.log(`\nsuites+engine: ${passed}/${total} 通过`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
