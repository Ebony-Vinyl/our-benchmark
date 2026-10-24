// FX — 画布与滚动动效 + 非线性运动工具
// Flow-field particle canvas adapted from ThreeUI Community (MIT)
// https://github.com/MengTo/threeui — shaders/neuform-isolated/sources/flow-field.html
const FX = (() => {
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------- easing family
  // 全部为手工曲线：expo 出场（表针滑行）、back 出场（过冲回摆）、quint 幕间
  const ease = {
    linear: (t) => t,
    outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    outQuint: (t) => 1 - Math.pow(1 - t, 5),
    outBack: (t, s = 1.2) => { const c = s + 1; return 1 + c * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2); },
    outSoft: (t) => 1 - Math.pow(1 - t, 3),
  };

  // 通用补间：唯一 rAF，回调 (easedT, rawT)；返回 { stop }
  function tween({ duration = 800, ease: fn = ease.outExpo, delay = 0, step, done } = {}) {
    if (reduced()) {
      if (step) step(1, 1);
      if (done) done();
      return { stop() {} };
    }
    let raf = 0, stopped = false, start = 0;
    const t0 = performance.now() + delay;
    function frame(now) {
      if (stopped) return;
      if (now < t0) { raf = requestAnimationFrame(frame); return; }
      if (!start) start = now;
      const t = Math.min(1, (now - start) / duration);
      step && step(fn(t), t);
      if (t < 1) raf = requestAnimationFrame(frame);
      else done && done();
    }
    raf = requestAnimationFrame(frame);
    return { stop() { stopped = true; cancelAnimationFrame(raf); } };
  }

  // ---------------------------------------------------------- odometer 数字滚轮
  // 每一位数字是一条 0-9 竖排胶片，滚到目标位；非数字字符（, .）固定。
  // 仅用于等宽数字字体，避免宽度跳动。
  function odometer(el, value, { duration = 1100, decimals = 0, stagger = 55, format } = {}) {
    if (!el) return;
    const target = Number(value) || 0;
    const txt = format ? String(format(target)) : target.toFixed(decimals);
    if (reduced()) { el.textContent = txt; return; }
    const prev = el.dataset.od;
    el.dataset.od = txt;
    if (prev === txt) return;
    // 结构不同（位数变化）→ 重建；位数一致 → 原地滚
    const digits = Array.from(txt);
    const needRebuild = !el.firstChild || prev == null || prev.length !== txt.length
      || el.childElementCount !== digits.length;
    let cols;
    if (needRebuild || prev == null) {
      el.innerHTML = digits.map((ch) => {
        if (!/\d/.test(ch)) return `<span class="od-fix">${ch}</span>`;
        return `<span class="od-col"><span class="od-strip">${Array.from({ length: 10 }, (_, i) => `<b>${i}</b>`).join('')}</span></span>`;
      }).join('');
      cols = [...el.querySelectorAll('.od-strip')];
      cols.forEach((s) => { s.style.transition = 'none'; s.style.transform = 'translateY(0)'; });
      void el.offsetWidth;
    } else {
      cols = [...el.querySelectorAll('.od-strip')];
    }
    let di = 0;
    digits.forEach((ch, i) => {
      if (!/\d/.test(ch)) return;
      const strip = cols[di++];
      if (!strip) return;
      const d = Number(ch);
      strip.style.transition = `transform ${duration}ms cubic-bezier(0.16, 1, 0.3, 1) ${Math.min(i * stagger, 420)}ms`;
      strip.style.transform = `translateY(${-d}em)`;
    });
  }

  // ---------------------------------------------------------- simplex noise
  const Simplex = (() => {
    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;
    const F3 = 1 / 3;
    const G3 = 1 / 6;
    const grad3 = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
    function Noise(seed) {
      this.perm = new Uint8Array(512);
      this.permMod12 = new Uint8Array(512);
      const p = new Uint8Array(256);
      seed = seed || 1337;
      for (let i = 0; i < 256; i++) p[i] = i;
      for (let i = 255; i > 0; i--) {
        seed = (seed * 16807) % 2147483647;
        const j = seed % (i + 1);
        const t = p[i]; p[i] = p[j]; p[j] = t;
      }
      for (let i = 0; i < 512; i++) { this.perm[i] = p[i & 255]; this.permMod12[i] = this.perm[i] % 12; }
    }
    Noise.prototype.n3 = function (xin, yin, zin) {
      const perm = this.perm, pm = this.permMod12;
      const s = (xin + yin + zin) * F3;
      const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
      const t = (i + j + k) * G3;
      const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
      let i1, j1, k1, i2, j2, k2;
      if (x0 >= y0) {
        if (y0 >= z0) { i1=1;j1=0;k1=0;i2=1;j2=1;k2=0; }
        else if (x0 >= z0) { i1=1;j1=0;k1=0;i2=1;j2=0;k2=1; }
        else { i1=0;j1=0;k1=1;i2=1;j2=0;k2=1; }
      } else {
        if (y0 < z0) { i1=0;j1=0;k1=1;i2=0;j2=1;k2=1; }
        else if (x0 < z0) { i1=0;j1=1;k1=0;i2=0;j2=1;k2=1; }
        else { i1=0;j1=1;k1=0;i2=1;j2=1;k2=0; }
      }
      const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
      const x2 = x0 - i2 + 2*G3, y2 = y0 - j2 + 2*G3, z2 = z0 - k2 + 2*G3;
      const x3 = x0 - 1 + 3*G3, y3 = y0 - 1 + 3*G3, z3 = z0 - 1 + 3*G3;
      const ii = i & 255, jj = j & 255, kk = k & 255;
      let n0, n1, n2, n3;
      let t0 = 0.6 - x0*x0 - y0*y0 - z0*z0;
      if (t0 < 0) n0 = 0; else { t0 *= t0; const g = pm[ii + perm[jj + perm[kk]]]; n0 = t0*t0*(grad3[g][0]*x0 + grad3[g][1]*y0 + grad3[g][2]*z0); }
      let t1 = 0.6 - x1*x1 - y1*y1 - z1*z1;
      if (t1 < 0) n1 = 0; else { t1 *= t1; const g = pm[ii + i1 + perm[jj + j1 + perm[kk + k1]]]; n1 = t1*t1*(grad3[g][0]*x1 + grad3[g][1]*y1 + grad3[g][2]*z1); }
      let t2 = 0.6 - x2*x2 - y2*y2 - z2*z2;
      if (t2 < 0) n2 = 0; else { t2 *= t2; const g = pm[ii + i2 + perm[jj + j2 + perm[kk + k2]]]; n2 = t2*t2*(grad3[g][0]*x2 + grad3[g][1]*y2 + grad3[g][2]*z2); }
      let t3 = 0.6 - x3*x3 - y3*y3 - z3*z3;
      if (t3 < 0) n3 = 0; else { t3 *= t3; const g = pm[ii + 1 + perm[jj + 1 + perm[kk + 1]]]; n3 = t3*t3*(grad3[g][0]*x3 + grad3[g][1]*y3 + grad3[g][2]*z3); }
      return 32 * (n0 + n1 + n2 + n3);
    };
    return Noise;
  })();

  // ---------------------------------------------------------- flow field
  function flow(canvas, opts = {}) {
    if (!canvas) return () => {};
    const ctx = canvas.getContext('2d');
    if (!ctx) return () => {};
    const noise = new Simplex(opts.seed || 42);
    const ink = opts.ink || [20, 19, 15];
    const accent = opts.accent || [191, 58, 26];
    const scale = opts.scale || 0.0028;
    const speed = opts.speed || 0.42;
    const count = opts.count || 0;
    const mouse = { x: -9999, y: -9999, active: false };
    let W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    let particles = [];
    let raf = 0, running = false, visible = true, t = 0;
    let last = performance.now();

    function resize() {
      const rect = canvas.getBoundingClientRect();
      W = Math.max(1, rect.width);
      H = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const n = count || Math.round(Math.min(1500, Math.max(500, (W * H) / 280)));
      particles = Array.from({ length: n }, () => spawn());
    }
    function spawn() {
      return {
        x: Math.random() * W,
        y: Math.random() * H,
        v: 0.3 + Math.random() * 0.8,
        a: 0.025 + Math.random() * 0.1,
        w: 0.4 + Math.random() * 0.8,
        accent: Math.random() < 0.1,
      };
    }
    function frame(now) {
      if (!running) return;
      const dt = Math.min(48, now - last) / 16.67;
      last = now;
      t += 0.00075 * dt;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.045)';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const angle = noise.n3(p.x * scale, p.y * scale, t) * Math.PI * 2.2;
        let vx = Math.cos(angle) * p.v * speed * dt;
        let vy = Math.sin(angle) * p.v * speed * dt;
        if (mouse.active) {
          const dx = p.x - mouse.x, dy = p.y - mouse.y;
          const d = Math.hypot(dx, dy);
          if (d < 130 && d > 0.5) {
            const f = (1 - d / 130) * 1.7;
            vx += (dx / d) * f * dt;
            vy += (dy / d) * f * dt;
          }
        }
        const px = p.x, py = p.y;
        p.x += vx; p.y += vy;
        if (p.x < -24 || p.x > W + 24 || p.y < -24 || p.y > H + 24) {
          Object.assign(p, spawn());
          p.x = Math.random() * W;
          p.y = Math.random() * H;
          continue;
        }
        const c = p.accent ? accent : ink;
        ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${p.a})`;
        ctx.lineWidth = p.w;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      raf = requestAnimationFrame(frame);
    }
    function start() {
      if (running || reduced()) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
    function stop() {
      running = false;
      cancelAnimationFrame(raf);
    }
    function staticDraw() {
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < 260; i++) {
        const x = Math.random() * W, y = Math.random() * H;
        const angle = noise.n3(x * scale, y * scale, 1.7) * Math.PI * 2.2;
        const len = 6 + Math.random() * 16;
        const c = Math.random() < 0.1 ? accent : ink;
        ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.03 + Math.random() * 0.08})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
        ctx.stroke();
      }
    }

    const ro = new ResizeObserver(() => {
      resize();
      if (reduced()) staticDraw();
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !document.hidden) start(); else stop();
    }, { threshold: 0 });
    io.observe(canvas);
    const onMove = (e) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
      mouse.active = true;
    };
    const onLeave = () => { mouse.active = false; };
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mouseleave', onLeave);
    const onVis = () => { if (document.hidden) stop(); else if (visible) start(); };
    document.addEventListener('visibilitychange', onVis);

    resize();
    if (reduced()) staticDraw(); else start();

    return () => {
      stop(); ro.disconnect(); io.disconnect();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseleave', onLeave);
      document.removeEventListener('visibilitychange', onVis);
    };
  }

  // ---------------------------------------------------------- scan dial (run chamber)
  function scan(canvas) {
    if (!canvas) return () => {};
    const ctx = canvas.getContext('2d');
    if (!ctx) return () => {};
    let raf = 0, running = true, t = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    function size() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function frame(now) {
      if (!running) return;
      const r = canvas.getBoundingClientRect();
      const w = r.width, h = r.height;
      const cx = w / 2, cy = h / 2;
      const R = Math.min(w, h) / 2 - 12;
      t = now * 0.001;
      ctx.clearRect(0, 0, w, h);
      // rings
      for (let i = 1; i <= 4; i++) {
        ctx.beginPath();
        ctx.arc(cx, cy, (R * i) / 4, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(242,238,228,${i === 4 ? 0.18 : 0.08})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // cross
      ctx.strokeStyle = 'rgba(242,238,228,0.06)';
      ctx.beginPath();
      ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
      ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
      ctx.stroke();
      // ticks
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        const r1 = R * (i % 4 === 0 ? 0.9 : 0.94);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        ctx.strokeStyle = `rgba(242,238,228,${i % 4 === 0 ? 0.24 : 0.1})`;
        ctx.stroke();
      }
      // sweep
      const a0 = t * 1.1;
      for (let i = 0; i < 36; i++) {
        const a = a0 - i * 0.028;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        ctx.strokeStyle = `rgba(191,58,26,${0.5 * (1 - i / 36)})`;
        ctx.lineWidth = i === 0 ? 1.6 : 0.8;
        ctx.stroke();
      }
      // blips
      for (let i = 0; i < 7; i++) {
        const a = (i * 2.399 + t * 0.12) % (Math.PI * 2);
        const rr = R * (0.24 + ((i * 0.37) % 0.66));
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        const blink = 0.35 + 0.65 * Math.abs(Math.sin(t * 0.9 + i));
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(191,58,26,${0.55 * blink})`;
        ctx.fill();
      }
      // center
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(242,238,228,0.85)';
      ctx.fill();
      raf = requestAnimationFrame(frame);
    }
    const ro = new ResizeObserver(size);
    ro.observe(canvas);
    size();
    if (!reduced()) raf = requestAnimationFrame(frame);
    return () => { running = false; cancelAnimationFrame(raf); ro.disconnect(); };
  }

  // ---------------------------------------------------------- magnetic hover
  // 主按钮在指针附近轻微吸附，离开时弹回；键盘/触摸不受影响
  function magnet(el, pull = 0.18) {
    if (!el || reduced()) return () => {};
    let raf = 0, tx = 0, ty = 0, cx = 0, cy = 0;
    const loop = () => {
      cx += (tx - cx) * 0.16; cy += (ty - cy) * 0.16;
      el.style.transform = `translate(${cx.toFixed(2)}px, ${cy.toFixed(2)}px)`;
      if (Math.abs(tx - cx) > 0.05 || Math.abs(ty - cy) > 0.05) raf = requestAnimationFrame(loop);
      else { el.style.transform = ''; raf = 0; }
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      tx = dx * pull; ty = dy * pull * 0.7;
      kick();
    };
    const onLeave = () => { tx = 0; ty = 0; kick(); };
    el.addEventListener('mousemove', onMove, { passive: true });
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
      el.style.transform = '';
    };
  }

  // ---------------------------------------------------------- scroll reveal
  let io = null;
  function observe(root) {
    if (io) io.disconnect();
    const host = document.getElementById('view');
    const els = root ? root.querySelectorAll('.reveal') : [];
    if (!els.length) return;
    if (!('IntersectionObserver' in window) || reduced()) {
      els.forEach(e => e.classList.add('in'));
      return;
    }
    io = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target);
        }
      });
    }, { root: host, threshold: 0.08, rootMargin: '0px 0px -6% 0px' });
    els.forEach(e => io.observe(e));
  }

  return { flow, scan, observe, ease, tween, odometer, magnet, reduced };
})();
window.FX = FX;
