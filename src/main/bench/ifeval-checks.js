// IFEval 指令遵循校验器（移植自 Google IFEval 官方 instruction_following_eval 的常用校验函数）
// 数据集里的 func 名与官方一一对应；未实现的函数会导致该题在校验时标记为 skipped。

function normalizeNewlines(t) { return String(t || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'); }

function numWords(t) {
  const words = String(t || '').trim().split(/\s+/).filter(Boolean);
  return words.length;
}

function numSentences(t) {
  // 与官方一致：按 . ! ? 切句
  const s = normalizeNewlines(t);
  const abbreviations = ['Dr.', 'Mr.', 'Mrs.', 'Ms.', 'St.', 'etc.', 'e.g.', 'i.e.', 'vs.', 'No.', 'Inc.', 'Ltd.', 'Jr.', 'Sr.', 'Prof.', 'Approx.', 'Fig.'];
  let temp = s;
  for (const ab of abbreviations) temp = temp.split(ab).join(ab.replace(/\./g, ''));
  const parts = temp.split(/[.!?]+/).map(x => x.trim()).filter(Boolean);
  return parts.length;
}

function numParagraphs(t) {
  const paras = normalizeNewlines(t).split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
  return paras.length;
}

function countChar(t, ch) { return String(t || '').split(ch).length - 1; }

function firstWord(t) { return (String(t || '').trim().split(/\s+/)[0] || ''); }

function isLower(w) { return w === w.toLowerCase() && /[a-z]/.test(w); }
function isCapitalized(w) { return /^[A-Z][a-z'()-]*$/.test(w); }
function isUpper(w) { return w === w.toUpperCase() && /[A-Z]/.test(w); }

function sentencesList(t) {
  return normalizeNewlines(t).split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
}

function lettersOnly(s) { return String(s || '').replace(/[^a-zA-Z]/g, ''); }

// 中文常用字粗略判断
const CJK = /[\u4e00-\u9fff]/;
function langOf(t) {
  const s = String(t || '');
  if (!s.trim()) return null;
  const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  return cjk > latin ? 'zh' : (latin > 0 ? 'en' : null);
}

const CHECKERS = {
  'keywords:existence': (r, a) => {
    const words = Array.isArray(a.keywords) ? a.keywords : [a.keywords];
    for (const w of words) {
      const re = new RegExp(`(^|[^a-zA-Z0-9])${escapeRe(String(w))}([^a-zA-Z0-9]|$)`, 'i');
      if (!re.test(r)) return false;
    }
    return true;
  },
  'keywords:frequency': (r, a) => {
    const w = String(a.keywords || a.keyword || '');
    const rel = String(a.relation || '');
    let n = parseInt(a.num_keywords ?? a.frequency ?? '1', 10);
    const re = new RegExp(`(^|[^a-zA-Z0-9])${escapeRe(w)}([^a-zA-Z0-9]|$)`, 'gi');
    const actual = (r.match(re) || []).length;
    return compareNum(actual, n, rel);
  },
  'keywords:forbidden': (r, a) => {
    const words = Array.isArray(a.keywords) ? a.keywords : [a.keywords];
    for (const w of words) {
      const re = new RegExp(`(^|[^a-zA-Z0-9])${escapeRe(String(w))}([^a-zA-Z0-9]|$)`, 'i');
      if (re.test(r)) return false;
    }
    return true;
  },
  'keywords:letter_frequency': (r, a) => {
    const letter = String(a.letter || '');
    let n = parseInt(a.let_frequency ?? a.num_letters ?? '1', 10);
    const rel = String(a.let_relation || a.relation || '');
    const actual = countChar(r, letter);
    return compareNum(actual, n, rel);
  },
  'language:response_language': (r, a) => langOf(r) === String(a.language || 'en'),
  'length_constraints:number_sentences': (r, a) => {
    let n = parseInt(a.num_sentences ?? '1', 10);
    return compareNum(numSentences(r), n, String(a.relation || ''));
  },
  'length_constraints:number_paragraphs': (r, a) => {
    let n = parseInt(a.num_paragraphs ?? '1', 10);
    return compareNum(numParagraphs(r), n, String(a.relation || ''));
  },
  'length_constraints:number_words': (r, a) => {
    let n = parseInt(a.num_words ?? '1', 10);
    return compareNum(numWords(r), n, String(a.relation || ''));
  },
  'length_constraints:nth_word_first': (r, a) => {
    const n = parseInt(a.num_words ?? '1', 10);
    const forbidden = Array.isArray(a.forbidden_words) ? a.forbidden_words : [a.forbidden_words];
    const words = r.trim().split(/\s+/);
    const nth = words[n - 1];
    if (nth == null) return false;
    for (const f of forbidden) if (lettersOnly(nth).toLowerCase() === lettersOnly(String(f)).toLowerCase()) return false;
    return true;
  },
  'detectable_content:number_placeholders': (r, a) => {
    let n = parseInt(a.num_placeholders ?? '1', 10);
    const actual = (r.match(/\[[^\]]*\]|\([^)]*\)|<[^>]*>/g) || []).length;
    return compareNum(actual, n, String(a.relation || ''));
  },
  'detectable_content:postscript': (r, a) => {
    const c = String(a.postscript_marker || 'P.S.');
    return new RegExp(escapeRe(c), 'i').test(r);
  },
  'detectable_format:number_bullet_lists': (r, a) => {
    let n = parseInt(a.num_bullets ?? '1', 10);
    const actual = (r.match(/^\s*(?:\*|-|•|·)\s+/gm) || []).length;
    return compareNum(actual, n, String(a.relation || ''));
  },
  'detectable_format:constrained_response': (r, a) => /^(我的回答是肯定|我的回答是否定|我的回答是maybe|My answer is yes\.|My answer is no\.|My answer is maybe\.)/i.test(r.trim()),
  'detectable_format:number_highlighted_sections': (r, a) => {
    let n = parseInt(a.num_highlights ?? '1', 10);
    const actual = (r.match(/\*[^\n*]+\*|「[^」]+」|“[^”]+”/g) || []).length;
    return compareNum(actual, n, String(a.relation || ''));
  },
  'detectable_format:multiple_sections': (r, a) => {
    const sec = String(a.section_spliter || 'Section');
    const n = parseInt(a.num_sections ?? '2', 10);
    const actual = (r.match(new RegExp(`${escapeRe(sec)}\\s+\\d+`, 'gi')) || []).length;
    return actual >= n || countChar(r, sec) >= n;
  },
  'detectable_format:json_format': (r) => {
    const t = r.trim().replace(/^```(?:json)?|```$/g, '').trim();
    try { JSON.parse(t); return true; } catch { return false; }
  },
  'detectable_format:title': (r, a) => {
    const t = String(a.title ?? 'dummy').replace(/\*/g, '');
    return r.includes('<<' + t + '>>');
  },
  'combination:two_responses': (r, a) => {
    return /(?<!\*)\*\*\*(?!\*)/.test(normalizeNewlines(r)) || r.includes('******');
  },
  'combination:repeat_prompt': (r, a) => {
    const promptToRepeat = String(a.prompt_to_repeat || '');
    if (!promptToRepeat) return true;
    return normalizeNewlines(r).includes(normalizeNewlines(promptToRepeat));
  },
  'start:end_checker': (r, a) => {
    const end = String(a.end_phrase || '');
    return normalizeNewlines(r).trim().endsWith(end);
  },
  'start:quotation': (r) => {
    const t = normalizeNewlines(r).trim();
    return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith('“') && t.endsWith('”'));
  },
  'punctuation:no_comma': (r) => !r.includes(',') && !r.includes('，'),
  'first_word:case': (r, a) => {
    const w = firstWord(r);
    const c = String(a.first_word || '').trim();
    if (!c) return true;
    if (String(a.case || a.first_word_case) === 'capitalized') return isCapitalized(w);
    if (String(a.case || a.first_word_case) === 'lower') return isLower(w);
    if (String(a.case || a.first_word_case) === 'upper') return isUpper(w);
    return lettersOnly(w).toLowerCase() === lettersOnly(c).toLowerCase();
  },
  'first_word:frequency': (r, a) => {
    const w = String(a.first_word || '').trim();
    if (!w) return true;
    let n = parseInt(a.frequency ?? '1', 10);
    const words = r.trim().split(/\s+/).map(x => lettersOnly(x).toLowerCase());
    const actual = words.filter(x => x === lettersOnly(w).toLowerCase()).length;
    return compareNum(actual, n, String(a.frequency_relation || 'at least'));
  },
};

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function compareNum(actual, expected, relation) {
  switch (relation) {
    case 'at least': case 'more than': return actual >= expected; // 官方 less/more 阈值宽松处理
    case 'less than': return actual < expected;
    case 'at most': return actual <= expected;
    case 'exactly': default: return actual === expected;
  }
}

/**
 * @returns {{passed: boolean, reason: string, skipped: boolean}}
 */
function checkInstruction(question, response) {
  const checks = question.checks || [];
  if (!checks.length) return { passed: false, reason: '无校验器', skipped: true };
  const failures = [];
  for (const c of checks) {
    const fn = CHECKERS[c.func];
    if (!fn) {
      failures.push(`未实现校验器 ${c.func}`);
      continue;
    }
    try {
      if (!fn(response || '', c.args || {})) failures.push(c.func);
    } catch {
      failures.push(`${c.func}(异常)`);
    }
  }
  return { passed: failures.length === 0, reason: failures.length ? '未满足: ' + failures.join(', ') : '全部满足', skipped: false };
}

module.exports = { checkInstruction, CHECKERS };
