// Agent 适配器：把"一道题的 prompt"发给某个 Agent 并取回答案。
// 真实适配器（CLI / API）默认锁死，只有用户在设置里显式解锁并配置后才可运行，
// 防止任何意外的 API 消耗。Mock 适配器零成本、确定性。
const os = require('os');
const crypto = require('crypto');

// --------------------------------------------------------------- 工具
function hash32(str) {
  // xmur3 风格：稳定 32 位种子
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^ (h >>> 16)) >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 每个模型的"能力画像"：由模型名确定性生成，同一模型分数稳定、不同模型分数有别
const CATEGORY_SKILL_BASE = {
  math: 0.55, reasoning: 0.5, knowledge: 0.6, code: 0.55,
  instruction: 0.6, common_sense: 0.65,
};
function modelProfile(modelName) {
  const seed = hash32('profile::' + modelName.toLowerCase());
  const rnd = mulberry32(seed);
  const tierBoost = /5\.3|4\.5|opus|max|ultra|o4|pro/i.test(modelName) ? 0.12 : 0;
  const profile = {};
  for (const [cat, base] of Object.entries(CATEGORY_SKILL_BASE)) {
    const v = base + (rnd() * 0.45 - 0.12) + tierBoost;
    profile[cat] = Math.min(0.985, Math.max(0.15, v));
  }
  return profile;
}

// --------------------------------------------------------------- Mock 适配器
class MockAdapter {
  constructor(agentKey, modelName) {
    this.agentKey = agentKey;
    this.modelName = modelName;
    this.profile = modelProfile(modelName);
    this.kind = 'mock';
  }
  // 确定性"回答"一道题：runner 把完整题目对象传入，仅 Mock 可见
  async runPrompt({ prompt, question, category }) {
    const t0 = Date.now();
    const skill = this.profile[category] ?? 0.5;
    const rnd = mulberry32(hash32(`${this.agentKey}::${this.modelName}::${question.id}`));
    await sleep(150 + rnd() * 900); // 模拟网络/思考延迟
    const correct = rnd() < skill;
    let output;
    switch (question.type) {
      case 'choice':
        output = this.mockChoice(question, correct, rnd);
        break;
      case 'numeric':
        output = this.mockNumeric(question, correct, rnd);
        break;
      case 'math_boxed':
        output = this.mockMath(question, correct, rnd);
        break;
      case 'code_py':
        output = this.mockCode(question, correct, rnd);
        break;
      case 'instruction':
        output = this.mockInstruction(question, correct, rnd);
        break;
      case 'exact':
        output = correct ? `The answer is ${question.answer}.` : '我无法确定这个问题的答案。';
        break;
      case 'patch':
        output = correct
          ? '```diff\n' + (question.goldPatch || '').slice(0, 1500) + '\n```'
          : '```diff\n# 修复思路不明确\nprint("placeholder")\n```';
        break;
      case 'keyset': {
        if (correct) {
          output = '操作计划：\n' + (question.required || []).map(v => `1. google_sheets_add_row(... ${v} ...)`).join('\n');
        } else {
          output = '我先看看邮件再说。';
        }
        break;
      }
      default:
        output = correct ? String(question.answer) : '???';
    }
    return { output, latencyMs: Date.now() - t0, tokens: Math.round(80 + rnd() * 900), mock: true };
  }
  mockChoice(q, correct, rnd) {
    const letters = 'ABCDEFGHIJ';
    const n = q.choices && q.choices.length ? q.choices.length : 10;
    const gold = q.answer;
    let pick = gold;
    if (!correct) {
      do { pick = letters[Math.floor(rnd() * Math.min(n, 10))]; } while (pick === gold && n > 1);
    }
    const styles = ['The answer is', '答案选', 'Answer:', '**答案**：'];
    const s = styles[Math.floor(rnd() * styles.length)];
    return `${s} ${pick}`;
  }
  mockNumeric(q, correct, rnd) {
    if (correct) {
      const steps = ['首先计算……', '接着……', '所以最终答案：'];
      return `${steps.join('\n')} $${q.answer}$`;
    }
    const val = parseFloat(q.answer);
    const factor = [0.5, 1.5, 2, 1.1, 0.9][Math.floor(rnd() * 5)];
    return `计算过程略\n最终答案：${(isNaN(val) ? 42 : val * factor).toFixed(2)}`;
  }
  mockMath(q, correct, rnd) {
    if (correct) return `解题过程……\n因此 \\boxed{${q.answer}}`;
    const wrong = ['1', '0', '\\frac{1}{2}', '2\\pi', '-1', '42'][Math.floor(rnd() * 6)];
    return `解题过程……\n因此 \\boxed{${wrong}}`;
  }
  mockCode(q, correct, rnd) {
    // 直接给标准答案；错误时轻微破坏（丢掉函数名或返回错值）
    let code = (q.canonical || 'def f():\n    return None').trim();
    if (!correct) {
      const mutations = [
        () => '    return ' + (Math.floor(rnd() * 7) - 2),
        () => code.replace(/return/g, 'return 1 #'),
        () => code.split('\n').slice(0, Math.max(1, code.split('\n').length - 1)).join('\n'),
      ];
      code = mutations[Math.floor(rnd() * mutations.length)]();
    }
    return '```python\n' + code + '\n```';
  }
  mockInstruction(q, correct, rnd) {
    if (!correct) return '这是一段没有遵循任何格式要求的普通回复，什么都不做。';
    // 生成一个尽量满足全部 checks 的回复
    let text = '好的。';
    for (const c of q.checks || []) {
      const a = c.args || {};
      if (c.func.startsWith('keywords:existence')) text += ` ${a.keywords || '苹果'} `;
      if (c.func.startsWith('keywords:frequency')) text += ` ${Array(a.num_keywords ? a.num_keywords : 1).fill(a.keywords || '苹果').join(' ')} `;
      if (c.func === 'language:response_language') text = a.language === 'zh' ? text : 'Sure, this is a reply. ';
      if (c.func.startsWith('combination:two_responses')) text += '\n******\n第二段回复。';
      if (c.func === 'combination:repeat_prompt') text = '好的。' + (q.prompt || '');
      if (c.func === 'punctuation:no_comma') text = text.replace(/[,，]/g, '');
    }
    return text;
  }
}

// --------------------------------------------------------------- CLI 适配器（真实，默认锁死）
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

class CliAdapter {
  constructor(spec, model, workdir) {
    this.spec = spec;
    this.model = model;
    this.workdir = workdir || fs.mkdtempSync(path.join(os.tmpdir(), 'ourbench-'));
    this.kind = 'cli';
  }
  async runPrompt({ prompt }) {
    // 通过 stdin 传题面，避免命令行长度/转义问题
    const bin = this.spec.binaryPath || this.spec.binaries[0];
    const cmdLine = (this.spec.execTemplate || '').replace('{prompt}', '-').replace('{model}', this.model).replace('{workdir}', this.workdir);
    const args = cmdLine.split(/\s+/).filter(Boolean);
    const t0 = Date.now();
    return new Promise((resolve) => {
      const child = execFile(bin, args, { cwd: this.workdir, timeout: 180000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        if (err && !stdout) {
          resolve({ output: '', error: `CLI 执行失败: ${String(err.message || err).slice(0, 300)}`, latencyMs: Date.now() - t0 });
        } else {
          resolve({ output: String(stdout).trim(), latencyMs: Date.now() - t0 });
        }
      });
      child.stdin && child.stdin.write(prompt);
      child.stdin && child.stdin.end();
    });
  }
}

// --------------------------------------------------------------- OpenAI 兼容 API 适配器（真实，默认锁死）
class OpenAICompatAdapter {
  constructor(baseUrl, apiKey, model) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.model = model;
    this.kind = 'api';
  }
  async runPrompt({ prompt }) {
    const t0 = Date.now();
    try {
      const { requestJson } = require('../net/httpx');
      const res = await requestJson(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: {
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          max_tokens: 2048,
        },
        timeoutMs: 180000,
      });
      if (res.status < 200 || res.status >= 300) {
        return { output: '', error: `HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`, latencyMs: Date.now() - t0 };
      }
      const data = res.data;
      return {
        output: (data.choices?.[0]?.message?.content || '').trim(),
        tokens: data.usage?.total_tokens || 0,
        latencyMs: Date.now() - t0,
      };
    } catch (e) {
      return { output: '', error: String(e.message || e).slice(0, 300), latencyMs: Date.now() - t0 };
    }
  }
}

module.exports = { MockAdapter, CliAdapter, OpenAICompatAdapter, modelProfile, hash32, mulberry32 };
