// 评分器单元测试
const assert = require('assert');
const { gradeQuestion, extractChoice, extractBoxed, gradeExact, patchSimilarity, gradePatch } = require('../src/main/bench/scorer');

let passed = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.log('  ✗', name, '\n    ', e.message); throw e; }
}

(async () => {
  t('choice: 各种表述抽取', () => {
    assert.strictEqual(extractChoice('答案是 B', 4), 'B');
    assert.strictEqual(extractChoice('The answer is C.', 4), 'C');
    assert.strictEqual(extractChoice('**A** 是正确的', 4), 'A');
    assert.strictEqual(extractChoice('我认为选 D。\n理由略', 4), 'D');
    assert.strictEqual(extractChoice('Answer: J', 10), 'J');
    assert.strictEqual(extractChoice('我不确定', 4), null);
  });

  t('choice: 10 选项不越界', () => {
    assert.strictEqual(extractChoice('答案是 K', 10), null); // 越界字母无效
  });

  t('numeric: 最后数值与宽松命中', async () => {
    const r = await gradeQuestion({ type: 'numeric', answer: '312', tolerance: 0.02 }, '所以…\n最终答案：312');
    assert.strictEqual(r.correct, true);
    const r2 = await gradeQuestion({ type: 'numeric', answer: '2249.73', tolerance: 0.001 }, '答案：2249.728');
    assert.strictEqual(r2.correct, true); // 容差内
    const r3 = await gradeQuestion({ type: 'numeric', answer: '42' }, '答案是 100');
    assert.strictEqual(r3.correct, false);
  });

  t('math_boxed: 抽取与等价', async () => {
    assert.strictEqual(extractBoxed('所以 \\boxed{\\frac{1}{2}} 即为所求'), '\\frac{1}{2}');
    const r = await gradeQuestion({ type: 'math_boxed', answer: '\\frac{1}{2}' }, '故 \\boxed{\\dfrac{1}{2}}');
    assert.strictEqual(r.correct, true);
    const r2 = await gradeQuestion({ type: 'math_boxed', answer: '204' }, '解题…… \\boxed{204}');
    assert.strictEqual(r2.correct, true);
    const r3 = await gradeQuestion({ type: 'math_boxed', answer: '204' }, '没有盒子');
    assert.strictEqual(r3.correct, false);
  });

  t('exact: 归一化匹配', () => {
    assert.ok(gradeExact('The answer is: Paris.', 'paris'));
    assert.ok(gradeExact('答案：12,345', '12345'));
    assert.ok(gradeExact('The city of Paris', 'Paris'));
    assert.ok(!gradeExact('London', 'Paris'));
    assert.ok(gradeExact('42', '42.0'));
  });

  t('patch: 相似度与阈值判分', () => {
    const gold = `diff --git a/f.py b/f.py
+def solve(x):
+    return x * 2`;
    const simGood = patchSimilarity('```diff\n+def solve(x):\n+    return x * 2\n```', gold);
    const simBad = patchSimilarity('```diff\n+print("hello world")\n```', gold);
    assert.ok(simGood > 0.85, 'simGood=' + simGood);
    assert.ok(simBad < 0.2, 'simBad=' + simBad);
    assert.strictEqual(gradePatch('```diff\n+def solve(x):\n+    return x * 2\n```', gold).correct, true);
    assert.strictEqual(gradePatch('无关内容', gold).correct, false);
  });

  t('空输出判 fail', async () => {
    const r = await gradeQuestion({ type: 'choice', answer: 'A', choices: ['a', 'b'] }, '');
    assert.strictEqual(r.correct, false);
  });

  console.log(`\nscorer: ${passed}/${total} 通过`);
  process.exit(0);
})().catch(() => process.exit(1));
