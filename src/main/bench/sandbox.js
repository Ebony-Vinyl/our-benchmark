// Python 代码沙箱：HumanEval / MBPP 判分。
// 把「题面前缀 + 模型补全 + 测试代码」写进临时文件，用本地 Python 以受限环境执行，
// 超时即失败。无网络调用、无 API 消耗。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const PY_CANDIDATES = [process.env.OURBENCH_PYTHON, 'python', 'python3', 'py']
  .filter(Boolean);

function findPython() {
  return new Promise((resolve) => {
    const tryNext = (i) => {
      if (i >= PY_CANDIDATES.length) return resolve(null);
      const bin = PY_CANDIDATES[i];
      execFile(bin, ['-c', 'import sys; print(sys.version_info >= (3, 8))'], { timeout: 15000, windowsHide: true }, (err, stdout) => {
        if (!err && String(stdout).trim() === 'True') return resolve(bin);
        tryNext(i + 1);
      });
    };
    tryNext(0);
  });
}
let cachedPython = undefined;

async function runPythonSandbox(question, modelCode, timeoutMs = 15000) {
  if (cachedPython === undefined) cachedPython = await findPython();
  if (!cachedPython) return { passed: false, error: '本机未找到 Python >= 3.8，无法执行代码判分' };

  const importBlock = 'import math, re, string, collections, itertools, typing\nfrom typing import List, Dict, Tuple, Optional, Any, Union\nimport heapq, functools\nfrom functools import lru_cache\nimport numpy as np\n';
  const deps = question.dependencies ? String(question.dependencies) + '\n' : '';
  // 题面以注释形式保留（便于溯源），实际执行 = 依赖 + 模型代码 + 官方测试
  const commented = String(question.prompt || '').split('\n').map(l => '# ' + l).join('\n');
  const prog = [
    commented,
    '',
    importBlock,
    deps,
    modelCode || '',
    '',
  ].join('\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-sbx-'));
  const file = path.join(tmpDir, 'sol_test.py');
  fs.writeFileSync(file, prog + '\n' + (question.testCode || ''), 'utf-8');

  return new Promise((resolve) => {
    execFile(cachedPython, ['-X', 'utf8', file], {
      cwd: tmpDir, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' },
    }, (err, stdout, stderr) => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
      if (err) {
        if (err.killed || /TIMED OUT/i.test(String(err.message || ''))) {
          resolve({ passed: false, error: '超时 (TLE)' });
        } else {
          resolve({ passed: false, error: '运行失败: ' + String(stderr || err.message || '').split('\n').slice(-3).join(' ').slice(0, 200) });
        }
      } else {
        resolve({ passed: true, error: null });
      }
    });
  });
}

module.exports = { runPythonSandbox, findPython };
