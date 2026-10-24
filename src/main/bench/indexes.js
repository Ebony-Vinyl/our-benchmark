// 指数体系：仿 Artificial Analysis Intelligence Index v4.3.2 的四维结构 + 复合指数
// 私有/未公开的评测以 unavailable 标注，UI 标灰展示，计算时权重自动重分配。

const INDEXES = [
  {
    id: 'intelligence',
    name: 'Intelligence Index v4.3.2',
    nameZh: '综合智能指数',
    description: '四大维度各占 25%：智能体、代码、通用能力、科学推理（AA 风格旗舰指数）',
    dimensions: [
      { id: 'agent', name: '智能体', suites: ['gdpval', 'automationbench'] },
      { id: 'code', name: '代码', suites: ['terminal-bench', 'scicode'] },
      { id: 'general', name: '通用能力', suites: ['hle', 'simpleqa'] },
      { id: 'science', name: '科学推理', suites: ['gpqa', 'critpt'] },
    ],
  },
  {
    id: 'coding-agent',
    name: 'Coding Agent Index v1.5',
    nameZh: '代码智能体指数',
    description: '软件工程实操能力：DeepSWE、Terminal-Bench、SWE-bench 系列、SciCode',
    dimensions: [
      { id: 'agentic-swe', name: '智能体级 SWE', suites: ['deepswe', 'swe-pro'] },
      { id: 'terminal', name: '终端实操', suites: ['terminal-bench'] },
      { id: 'verified-swe', name: '已验证 SWE', suites: ['swe-verified'] },
      { id: 'sci-code', name: '科学代码', suites: ['scicode'] },
    ],
  },
  {
    id: 'cyber',
    name: 'Cyber Index v1',
    nameZh: '网络安全指数',
    description: '攻防与运维安全：CyberGym E2E、ITBench 根因分析',
    dimensions: [
      { id: 'offense', name: '漏洞利用', suites: ['cybergym'] },
      { id: 'ops', name: '运维根因', suites: ['itbench'] },
    ],
  },
  {
    id: 'decision',
    name: 'Decision Index v1.0',
    nameZh: '决策指数',
    description: '真实业务决策与长信息检索：GDPval、AutomationBench、MRCR、ITBench',
    dimensions: [
      { id: 'business', name: '业务流程', suites: ['gdpval', 'automationbench'] },
      { id: 'retrieval', name: '信息检索', suites: ['mrcr'] },
      { id: 'rootcause', name: '根因定位', suites: ['itbench'] },
    ],
  },
];

// AA 生态里的私有评测（无公开数据，仅 UI 展示，不参与计算）
const PROPRIETARY_EVALS = [
  { name: 'AA-Briefcase v1.1', dimension: '智能体', note: 'AA 私有，未公开题库' },
  { name: 'GDP.pdf', dimension: '通用能力', note: 'AA 私有，未公开题库（长文档阅读）' },
  { name: 'AA-AnalystAgent', dimension: '智能体', note: 'AA 私有（表格量化分析）' },
  { name: 'EnterpriseOps-Gym-AA', dimension: '智能体', note: 'AA 私有（企业运营）' },
  { name: 'Harvey LAB-AA v1.1', dimension: '智能体', note: 'Harvey 私有（法律）' },
  { name: 'MLCR-AA', dimension: '通用能力', note: 'AA 私有（医疗长文档）' },
  { name: 'SWE-Atlas-QnA', dimension: '代码', note: 'AA 私有' },
  { name: 'CWE-Bench-AA', dimension: '网络安全', note: 'AA 私有' },
  { name: 'DeepsecBench-AA', dimension: '网络安全', note: 'AA 私有' },
  { name: 'Terminal-Bench 4.0', dimension: '代码', note: 'Harbor 私有新版，用开源 terminal-bench 替代' },
];

/**
 * 计算各指数。suiteScores: {suiteId: {graded, correct}}
 * 每个维度 = 其套件正确率平均（跳过未跑/未下载的套件并重分配）
 */
function computeIndexes(suiteScores) {
  const out = [];
  for (const idx of INDEXES) {
    const dims = [];
    let valid = 0, weighted = 0;
    for (const d of idx.dimensions) {
      const parts = d.suites
        .map(sid => suiteScores[sid])
        .filter(s => s && s.graded > 0);
      const acc = parts.length ? parts.reduce((a, s) => a + (s.correct / s.graded), 0) / parts.length : null;
      dims.push({ ...d, accuracy: acc, covered: parts.length > 0, ranSuites: parts.length, totalSuites: d.suites.length });
      if (acc != null) { weighted += acc; valid++; }
    }
    out.push({
      ...idx,
      dimensions: dims,
      value: valid ? +((weighted / valid) * 100).toFixed(1) : null, // 0-100
      coverage: idx.dimensions.reduce((a, d) => a + d.suites.filter(sid => suiteScores[sid]?.graded > 0).length, 0),
      totalSuites: idx.dimensions.reduce((a, d) => a + d.suites.length, 0),
    });
  }
  return out;
}

module.exports = { INDEXES, PROPRIETARY_EVALS, computeIndexes };
