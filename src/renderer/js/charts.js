// 图表：全部为手绘 SVG / HTML，无第三方依赖
const Charts = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CATS = ['code', 'science', 'general', 'agent', 'long_context', 'cyber'];
  const CAT_NAMES = {
    code: '代码', science: '科学推理', general: '通用能力',
    agent: '智能体', long_context: '长上下文', cyber: '网络安全',
  };
  const CAT_SHORT = {
    code: '代码', science: '科学', general: '通用',
    agent: '智能体', long_context: '长文', cyber: '安全',
  };
  const CAT_COLORS = {
    code: '#bf3a1a', science: '#1f4e79', general: '#7a6a1f',
    agent: '#4f4c44', long_context: '#8a857a', cyber: '#8e2a12',
  };

  function catName(c) { return CAT_NAMES[c] || c; }
  function catShort(c) { return CAT_SHORT[c] || c; }
  function catColor(c) { return CAT_COLORS[c] || '#bf3a1a'; }
  function modelHue(str) { let h = 0; for (const ch of String(str || '?')) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; }
  function monogram(name) {
    const s = String(name || '?').trim();
    const token = s.split(/[\s\-_/·]+/).filter(Boolean)[0] || s;
    const chars = Array.from(token.replace(/[^A-Za-z0-9\u4e00-\u9fa5]/g, ''));
    return (chars.slice(0, 2).join('') || s.slice(0, 2)).toUpperCase();
  }

  // ---------------------------------------------------------- gauge
  // 渲染零位表盘骨架；数值由 animateGauge 用缓动驱动（弧线、端点、读数同步），
  // 修复了端点在弧线绘制完成前就停在终点的浮空问题。
  function gauge(value, { size = 360, label = '智能指数', sub = 'Intelligence Index', max = 100 } = {}) {
    const cx = 180, cy = 180, r = 148;
    const start = 135 * Math.PI / 180;
    const total = 270 * Math.PI / 180;
    const ticks = [];
    for (let i = 0; i <= 60; i++) {
      const a = start + (i / 60) * total;
      const major = i % 5 === 0;
      const r1 = r + 10;
      const r2 = r + (major ? 20 : 15);
      const x1 = cx + Math.cos(a) * r1, y1 = cy + Math.sin(a) * r1;
      const x2 = cx + Math.cos(a) * r2, y2 = cy + Math.sin(a) * r2;
      ticks.push(`<line class="tick" style="--i:${i}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${major ? '#b9b4a8' : '#d8d4c9'}" stroke-width="1"/>`);
    }
    const sx = cx + Math.cos(start) * r, sy = cy + Math.sin(start) * r;
    const ex = cx + Math.cos(start + total) * r, ey = cy + Math.sin(start + total) * r;
    const path = `M ${sx.toFixed(1)} ${sy.toFixed(1)} A ${r} ${r} 0 1 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`;
    const v = Math.max(0, Math.min(max, Number(value) || 0));
    const labelHtml = esc(label);
    const subHtml = esc(sub);
    const html = `<div class="gauge" data-gv="0" data-max="${max}">
      <svg viewBox="0 0 360 360" role="img" aria-label="${esc(label)} ${v.toFixed(1)}">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#efede7" stroke-width="1"/>
        <path d="${path}" fill="none" stroke="#e9e5db" stroke-width="2"/>
        ${ticks.join('')}
        <path class="arc-fill" d="${path}" pathLength="100" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" style="--dash:100;--offset:100"/>
        <circle class="g-dot" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="3" fill="var(--accent)" opacity="0"/>
      </svg>
      <div class="gauge-center">
        <div class="v num">0.0</div>
        <div class="l">${labelHtml}</div>
        <div class="s">${subHtml}</div>
      </div>
    </div>`;
    return { html, mount(box) { box.innerHTML = html; animateGauge(box, v, { label: labelHtml, sub: subHtml, max }); } };
  }

  // 把表盘驱动到目标值；容器内已有表盘时原位重滚（平滑变针），否则先渲染骨架
  function animateGauge(box, value, { label, sub, max = 100, duration = 1500 } = {}) {
    if (!box) return;
    let g = box.querySelector('.gauge');
    if (!g || g.dataset.max !== String(max)) {
      box.innerHTML = gauge(0, { max }).html;
      g = box.querySelector('.gauge');
    }
    const fill = g.querySelector('.arc-fill');
    const dot = g.querySelector('.g-dot');
    const num = g.querySelector('.gauge-center .v');
    const lEl = g.querySelector('.gauge-center .l');
    const sEl = g.querySelector('.gauge-center .s');
    if (label != null && lEl) lEl.textContent = label;
    if (sub != null && sEl) sEl.textContent = sub;
    const from = Math.max(0, Math.min(max, Number(g._shown != null ? g._shown : g.dataset.gv) || 0));
    const to = Math.max(0, Math.min(max, Number(value) || 0));
    g.dataset.gv = String(to);
    const svg = g.querySelector('svg');
    if (svg) svg.setAttribute('aria-label', `${lEl ? lEl.textContent : ''} ${to.toFixed(1)}`);
    const cx = 180, cy = 180, r = 148;
    const a0 = 135 * Math.PI / 180, total = 270 * Math.PI / 180;
    if (fill) fill.style.animation = 'none';
    if (FX.reduced()) {
      const p = to / max;
      g._shown = to;
      if (fill) fill.style.strokeDashoffset = String(100 - p * 100);
      if (num) num.textContent = to.toFixed(1);
      if (dot) {
        const a = a0 + total * p;
        dot.setAttribute('cx', (cx + Math.cos(a) * r).toFixed(1));
        dot.setAttribute('cy', (cy + Math.sin(a) * r).toFixed(1));
        dot.setAttribute('opacity', p > 0 ? '1' : '0');
      }
      return;
    }
    if (g._tw) g._tw.stop();
    g._tw = FX.tween({
      duration: from === to ? 1 : duration,
      ease: (t) => FX.ease.outBack(t, 0.55),
      step(e) {
        const cur = from + (to - from) * e;
        g._shown = cur;
        const p = Math.max(0, Math.min(max, cur)) / max;
        if (fill) fill.style.strokeDashoffset = String(100 - p * 100);
        if (num) num.textContent = cur.toFixed(1);
        if (dot) {
          const a = a0 + total * p;
          dot.setAttribute('cx', (cx + Math.cos(a) * r).toFixed(1));
          dot.setAttribute('cy', (cy + Math.sin(a) * r).toFixed(1));
          dot.setAttribute('opacity', p > 0.002 ? '1' : '0');
        }
      },
    });
  }

  // ---------------------------------------------------------- radar
  function radar(data, { size = 320 } = {}) {
    const cx = 160, cy = 160, R = 118;
    const vals = CATS.map(c => Math.max(0, Math.min(1, Number(data && data[c]) || 0)));
    const angle = (i) => -Math.PI / 2 + i * (2 * Math.PI / CATS.length);
    const rings = [0.25, 0.5, 0.75, 1];
    const ringPaths = rings.map(f => {
      const pts = CATS.map((_, i) => {
        const a = angle(i);
        return `${(cx + Math.cos(a) * R * f).toFixed(1)},${(cy + Math.sin(a) * R * f).toFixed(1)}`;
      }).join(' ');
      return `<polygon points="${pts}" fill="none" stroke="${f === 1 ? '#d8d4c9' : '#efede7'}" stroke-width="1"/>`;
    }).join('');
    const axes = CATS.map((_, i) => {
      const a = angle(i);
      return `<line x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(a) * R).toFixed(1)}" y2="${(cy + Math.sin(a) * R).toFixed(1)}" stroke="#efede7" stroke-width="1"/>`;
    }).join('');
    const labels = CATS.map((c, i) => {
      const a = angle(i);
      const x = cx + Math.cos(a) * (R + 25);
      const y = cy + Math.sin(a) * (R + 25);
      const anchor = Math.abs(Math.cos(a)) < 0.2 ? 'middle' : (Math.cos(a) > 0 ? 'start' : 'end');
      return `<text x="${x.toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="${anchor}" font-size="10.5" fill="#6b675e">${esc(catName(c))}</text>`;
    }).join('');
    const pts = vals.map((v, i) => {
      const a = angle(i);
      return `${(cx + Math.cos(a) * R * v).toFixed(1)},${(cy + Math.sin(a) * R * v).toFixed(1)}`;
    }).join(' ');
    const dots = vals.map((v, i) => {
      const a = angle(i);
      const x = cx + Math.cos(a) * R * v;
      const y = cy + Math.sin(a) * R * v;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="var(--accent)" stroke="#fff" stroke-width="1"/>`;
    }).join('');
    return `<svg viewBox="0 0 320 320" role="img" aria-label="能力雷达图">
      ${ringPaths}${axes}
      <g class="radar-shape" style="transform-origin:160px 160px">
        <polygon points="${pts}" fill="rgba(191,58,26,0.10)" stroke="var(--accent)" stroke-width="1.6" stroke-linejoin="round"/>
        ${dots}
      </g>
      ${labels}
    </svg>`;
  }

  // ---------------------------------------------------------- sparkline
  function sparkline(values, { w = 110, h = 28, color = 'var(--accent)' } = {}) {
    if (!values || values.length < 2) return `<svg width="${w}" height="${h}" aria-hidden="true"></svg>`;
    const max = Math.max(...values), min = Math.min(...values);
    const span = max - min || 1;
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * (w - 4) + 2;
      const y = h - 3 - ((v - min) / span) * (h - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<svg width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  // ---------------------------------------------------------- top bar list
  function topBars(rows, { max } = {}) {
    const top = Math.max(1, max || Math.max(...rows.map(r => Number(r.intelligenceIndex) || 0)));
    return rows.map((r, i) => {
      const v = Number(r.intelligenceIndex) || 0;
      return `<div class="lb-toprow">
        <span class="r">${String(i + 1).padStart(2, '0')}</span>
        <span class="m">${esc(r.model)}</span>
        <span class="bar"><i data-w="${(100 * v / top).toFixed(1)}"></i></span>
        <span class="v">${v.toFixed(1)}</span>
      </div>`;
    }).join('');
  }

  // ---------------------------------------------------------- histogram
  function histogram(values, { w = 320, h = 120, bins = 16 } = {}) {
    const padL = 22, padB = 18, padT = 6, padR = 4;
    const iw = w - padL - padR, ih = h - padT - padB;
    const counts = new Array(bins).fill(0);
    for (const v of values) {
      const b = Math.max(0, Math.min(bins - 1, Math.floor((Number(v) || 0) / (100 / bins))));
      counts[b]++;
    }
    const max = Math.max(1, ...counts);
    const bw = iw / bins;
    const bars = counts.map((c, i) => {
      const bh = (c / max) * ih;
      return `<rect x="${(padL + i * bw + 1).toFixed(1)}" y="${(padT + ih - bh).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${bh.toFixed(1)}" fill="${c ? 'var(--accent)' : '#efede7'}" opacity="${c ? 0.85 : 1}"/>`;
    }).join('');
    const ticks = [0, 50, 100].map(t => {
      const x = padL + (t / 100) * iw;
      return `<text x="${x.toFixed(1)}" y="${h - 4}" text-anchor="middle" font-size="9" fill="#8a857a">${t}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="分数分布"><line x1="${padL}" y1="${padT + ih}" x2="${w - padR}" y2="${padT + ih}" stroke="#d8d4c9" stroke-width="1"/>${bars}${ticks}</svg>`;
  }

  // ---------------------------------------------------------- animate bars
  // rAF 驱动的非线性生长：指数缓出 + 逐条错峰，比 CSS transition 更有节奏
  function animateBars(root) {
    if (!root) return;
    root.querySelectorAll('[data-w]').forEach((el, i) => {
      const target = Math.max(0, Math.min(100, Number(el.dataset.w) || 0));
      if (FX.reduced()) { el.style.width = target + '%'; return; }
      el.style.width = '0%';
      FX.tween({
        duration: 900,
        delay: 120 + Math.min(i, 8) * 70,
        ease: FX.ease.outExpo,
        step(e) { el.style.width = (target * e).toFixed(2) + '%'; },
      });
    });
  }

  return {
    CATS, CAT_NAMES, CAT_SHORT, CAT_COLORS,
    catName, catShort, catColor, modelHue, monogram,
    gauge, animateGauge, radar, sparkline, topBars, histogram, animateBars,
  };
})();
window.Charts = Charts;
