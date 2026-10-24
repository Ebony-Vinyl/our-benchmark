// Agent 检测：扫描配置目录 / PATH / 运行中进程，识别本机安装的 AI Agent
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const crypto = require('crypto');

const HOME = os.homedir();
const IS_WIN = process.platform === 'win32';

// 已知 Agent 注册表：检测信号 + 运行方式
const KNOWN_AGENTS = [
  {
    id: 'codex',
    name: 'OpenAI Codex CLI',
    vendor: 'OpenAI',
    kind: 'cli',
    configDirs: ['.codex'],
    binaries: ['codex', 'codex.exe', 'codex.cmd'],
    processes: ['codex.exe', 'codex-windows-sandbox-service.exe', 'codex-plus-plus.exe'],
    versionArgs: ['--version'],
    configModelFile: '.codex/config.toml',
    configModelPatterns: [/^model\s*=\s*"?([^"\n]+)"?/m],
    defaultModel: 'gpt-5.3-codex',
    execTemplate: 'codex exec --skip-git-repo-check -C "{workdir}" -m {model} "{prompt}"',
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    vendor: 'Anthropic',
    kind: 'cli',
    configDirs: ['.claude', '.claude.json'],
    binaries: ['claude', 'claude.exe', 'claude.cmd'],
    processes: ['claude.exe'],
    versionArgs: ['--version'],
    configModelFile: '.claude/settings.json',
    configModelPatterns: [/"model"\s*:\s*"([^"]+)"/],
    defaultModel: 'claude-opus-4-5',
    execTemplate: 'claude -p "{prompt}" --model {model} --output-format text',
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    vendor: 'Google',
    kind: 'cli',
    configDirs: ['.gemini'],
    binaries: ['gemini', 'gemini.exe', 'gemini.cmd'],
    processes: ['gemini.exe'],
    versionArgs: ['--version'],
    configModelFile: '.gemini/settings.json',
    configModelPatterns: [/"selectedModel"\s*:\s*"([^"]+)"/, /"model"\s*:\s*"([^"]+)"/],
    defaultModel: 'gemini-3-pro',
    execTemplate: 'gemini -m {model} -p "{prompt}"',
  },
  {
    id: 'zcode',
    name: 'ZCode',
    vendor: 'Zhipu',
    kind: 'cli',
    configDirs: ['.zcode'],
    binaries: ['zcode', 'zcode.exe', 'zcode.cmd'],
    processes: ['zcode.exe'],
    versionArgs: ['--version'],
    configModelFile: '.zcode/settings.json',
    configModelPatterns: [/"model"\s*:\s*"([^"]+)"/],
    defaultModel: 'glm-5.3',
    execTemplate: 'zcode -p "{prompt}" --model {model}',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    vendor: 'Anysphere',
    kind: 'ide',
    configDirs: ['.cursor'],
    binaries: ['cursor'],
    processes: ['cursor.exe', 'Cursor.exe'],
    defaultModel: 'composer-1',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    vendor: 'Codeium',
    kind: 'ide',
    configDirs: ['.windsurf'],
    binaries: ['windsurf'],
    processes: ['windsurf.exe', 'Windsurf.exe'],
    defaultModel: 'cascade-1',
  },
  {
    id: 'trae',
    name: 'Trae',
    vendor: 'ByteDance',
    kind: 'ide',
    configDirs: ['.trae'],
    binaries: ['trae'],
    processes: ['trae.exe', 'Trae.exe'],
    defaultModel: 'doubao-pro',
  },
  {
    id: 'qwen-code',
    name: 'Qwen Code',
    vendor: 'Alibaba',
    kind: 'cli',
    configDirs: ['.qwen'],
    binaries: ['qwen', 'qwen.exe', 'qwen.cmd'],
    processes: ['qwen.exe'],
    versionArgs: ['--version'],
    defaultModel: 'qwen3-coder-plus',
    execTemplate: 'qwen -p "{prompt}" --model {model}',
  },
  {
    id: 'copilot-cli',
    name: 'GitHub Copilot CLI',
    vendor: 'GitHub',
    kind: 'cli',
    configDirs: ['.config/github-copilot'],
    binaries: ['copilot'],
    processes: ['copilot.exe'],
    defaultModel: 'gpt-5',
  },
  {
    id: 'iflow-cli',
    name: 'iFlow CLI',
    vendor: 'iFlow',
    kind: 'cli',
    configDirs: ['.iflow'],
    binaries: ['iflow'],
    processes: ['iflow.exe'],
    defaultModel: 'iflow-valkyrie',
  },
  {
    id: 'aider',
    name: 'Aider',
    vendor: 'Aider AI',
    kind: 'cli',
    configDirs: ['.aider', '.aider.conf.yml', '.aider.model.settings.yml'],
    binaries: ['aider'],
    processes: ['aider.exe'],
    versionArgs: ['--version'],
    defaultModel: 'gpt-5',
    execTemplate: 'aider --model {model} --message "{prompt}" --no-git --yes-always',
  },
  {
    id: 'continue',
    name: 'Continue',
    vendor: 'Continue Dev',
    kind: 'ide',
    configDirs: ['.continue'],
    binaries: ['continue'],
    processes: ['continue.exe'],
    defaultModel: 'gpt-5',
  },
];

function existsAny(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function listRunningProcesses() {
  return new Promise((resolve) => {
    const cmd = IS_WIN ? 'tasklist' : 'ps -axo comm';
    execFile(cmd, IS_WIN ? ['/FO', 'CSV', 'NH'] : [], { timeout: 8000 }, (err, stdout) => {
      if (err) return resolve([]);
      resolve(String(stdout).toLowerCase());
    });
  });
}

// PATH 扫描比逐个 where 快一个数量级；Windows 上 where 每个进程约 100-300ms。
const PATH_DIRS = String(process.env.PATH || '')
  .split(path.delimiter)
  .map(d => d.trim().replace(/^"|"$/g, ''))
  .filter(Boolean);

function lookupBinary(bin) {
  const exts = IS_WIN ? ['', '.exe', '.cmd', '.bat', '.ps1'] : [''];
  for (const dir of PATH_DIRS) {
    for (const ext of exts) {
      const full = path.join(dir, bin + ext);
      try {
        const st = fs.statSync(full);
        if (!st.isFile()) continue;
        if (!IS_WIN) fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch { /* not here */ }
    }
  }
  return null;
}

function readConfigModel(relFile, patterns) {
  try {
    const full = path.join(HOME, relFile);
    if (!existsAny(full)) return null;
    const text = fs.readFileSync(full, 'utf-8');
    for (const re of patterns) {
      const m = text.match(re);
      if (m) return m[1].trim();
    }
  } catch { /* ignore */ }
  return null;
}

function stableHash(s) {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
}

/**
 * 扫描本机所有可识别的 Agent。
 * 返回: [{id, name, vendor, kind, detected:bool, evidence:[...], model, configDir, binaryPath, execTemplate, machineFingerprint}]
 * 结果缓存 60s：窗口切换页面时不再重复扫描进程与 PATH。
 */
let _detectCache = null;
let _detectAt = 0;
async function detectAgents(force = false) {
  if (!force && _detectCache && Date.now() - _detectAt < 60000) return _detectCache;
  const [procText, binaries] = await Promise.all([
    listRunningProcesses(),
    Promise.all(KNOWN_AGENTS.map(spec => findFirstBinary(spec.binaries || []))),
  ]);
  const agents = [];

  for (let si = 0; si < KNOWN_AGENTS.length; si++) {
    const spec = KNOWN_AGENTS[si];
    const evidence = [];
    let configDir = null;
    let model = null;

    for (const dir of spec.configDirs) {
      const full = path.join(HOME, dir);
      if (existsAny(full)) {
        evidence.push(`配置目录 ~/${dir}`);
        configDir = configDir || full;
      }
    }
    if (spec.configModelFile && spec.configModelPatterns) {
      model = readConfigModel(spec.configModelFile, spec.configModelPatterns);
    }
    for (const proc of spec.processes || []) {
      if (procText.includes(proc.toLowerCase())) evidence.push(`运行中进程 ${proc}`);
    }
    const binaryPath = binaries[si];
    if (binaryPath) evidence.push(`命令行 ${binaryPath.bin} (${binaryPath.path})`);

    agents.push({
      id: spec.id,
      name: spec.name,
      vendor: spec.vendor,
      kind: spec.kind,
      detected: evidence.length > 0,
      evidence,
      model: model || spec.defaultModel,
      modelFromConfig: !!model,
      configDir,
      binaryPath: binaryPath ? binaryPath.path : null,
      execTemplate: spec.execTemplate || null,
      versionArgs: spec.versionArgs || null,
      runnable: !!binaryPath || (configDir && spec.execTemplate),
    });
  }
  _detectCache = agents;
  _detectAt = Date.now();
  return agents;
}

async function findFirstBinary(bins) {
  for (const bin of bins) {
    const p = await lookupBinary(bin);
    if (p) return { bin, path: p };
  }
  return null;
}

module.exports = { detectAgents, KNOWN_AGENTS, stableHash };
