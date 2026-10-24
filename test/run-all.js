// Our Benchmark 测试入口：node test/run-all.js
// 全部使用 Mock 模式，零 API 消耗。
process.env.NODE_ENV = 'test';

const { spawnSync } = require('child_process');
const path = require('path');

const tests = ['scorer.test.js', 'suites.test.js', 'server.test.js'];
let failed = 0;
for (const t of tests) {
  console.log(`\n===== ${t} =====`);
  const r = spawnSync(process.execPath, [path.join(__dirname, t)], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  if (r.status !== 0) { failed++; console.log(`✗ ${t} FAILED`); }
  else console.log(`✓ ${t} passed`);
}
console.log(failed === 0 ? '\n全部测试通过 ✓' : `\n${failed} 个测试失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
