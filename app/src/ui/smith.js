// Interactive Smith chart, drawn on canvas in the reflection plane.
//
// This class alone owns the view. Each wheel or drag event updates it and the next
// animation frame draws from it, so nothing else can move the chart. The efficiency
// field is a bitmap placed by its own window in the reflection plane: during a zoom
// the existing bitmap is rescaled, and a sharper one replaces it after the pointer
// stops. A late bitmap therefore cannot shift the view; it only adds detail.
//
// The grid is regenerated for the visible window, so constant-r and constant-x lines
// stay present at any depth. Hover is computed at the pointer position, so values
// are exact at every zoom level.
import { FONT, SIZE, INK, INK2, VIRIDIS, zfmt } from './plot.js';
import { fieldAt, gamma2z } from '../engine/field.js';

const LINE = '#c9ced6', LINE2 = '#8f97a3', FONTS = `${FONT}`;

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}
function ticks(a, b, target) {
  if (!(b > a)) return [];
  if (a > 0 && b / a > 6) {
    const out = [];
    for (let e = Math.floor(Math.log10(a)); e <= Math.ceil(Math.log10(b)); e++) {
      for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (v >= a && v <= b) out.push(v); }
    }
    return out;
  }
  const s = niceStep((b - a) / target), out = [];
  for (let v = Math.ceil(a / s) * s; v <= b + 1e-12 * Math.abs(b); v += s) out.push(+v.toPrecision(10));
  return out;
}
function xTicks(a, b, target) {
  if (a >= 0) return ticks(Math.max(a, 1e-9), b, target);
  if (b <= 0) return ticks(Math.max(-b, 1e-9), -a, target).map(v => -v);
  const m = Math.max(-a, b);
  const pos = ticks(m / 500, m, target).filter(v => v <= b), neg = ticks(m / 500, m, target).filter(v => -v >= a).map(v => -v);
  return [...neg.reverse(), 0, ...pos];
}

/** Arcs of the circle (cx, cy, r) inside the window and inside the unit disc. */
function clipCircle(cx, cy, r, v) {
  const cuts = [0, 2 * Math.PI];
  const line = (isX, c) => {
    const d = isX ? c - cx : c - cy;
    if (Math.abs(d) > r) return;
    const b = Math.acos(d / r);
    for (const a of isX ? [b, -b] : [Math.PI / 2 - b, Math.PI / 2 + b]) cuts.push((a + 4 * Math.PI) % (2 * Math.PI));
  };
  line(true, v.x0); line(true, v.x1); line(false, v.y0); line(false, v.y1);
  const dc = Math.hypot(cx, cy);
  if (dc > 1e-12 && dc < 1 + r && dc > Math.abs(1 - r)) {
    const a0 = Math.atan2(-cy, -cx), q = (r * r + dc * dc - 1) / (2 * r * dc);
    if (Math.abs(q) <= 1) { const b = Math.acos(q); for (const a of [a0 + b, a0 - b]) cuts.push((a + 4 * Math.PI) % (2 * Math.PI)); }
  }
  cuts.sort((p, q) => p - q);
  const arcs = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], b = cuts[i + 1];
    if (b - a < 1e-9) continue;
    const m = 0.5 * (a + b), mx = cx + r * Math.cos(m), my = cy + r * Math.sin(m);
    if (mx >= v.x0 && mx <= v.x1 && my >= v.y0 && my <= v.y1 && Math.hypot(mx, my) <= 1 + 1e-9) arcs.push([a, b]);
  }
  return arcs;
}

function gridLines(v) {
  const span = Math.max(v.x1 - v.x0, v.y1 - v.y0);
  let rs, xs;
  if (span > 1.4) {
    rs = [0.2, 0.5, 1, 2, 5];
    xs = [-5, -2, -1, -0.5, -0.2, 0, 0.2, 0.5, 1, 2, 5];
  } else {
    let r0 = Infinity, r1 = 0, x0 = Infinity, x1 = -Infinity;
    for (let i = 0; i <= 16; i++) for (let j = 0; j <= 16; j++) {
      const gx = v.x0 + (v.x1 - v.x0) * i / 16, gy = v.y0 + (v.y1 - v.y0) * j / 16;
      if (Math.hypot(gx, gy) >= 0.999999) continue;
      const z = gamma2z(gx, gy, 1);
      r0 = Math.min(r0, z[0]); r1 = Math.max(r1, z[0]); x0 = Math.min(x0, z[1]); x1 = Math.max(x1, z[1]);
    }
    rs = Number.isFinite(r0) ? ticks(Math.max(r0, 1e-6), r1, 6) : [];
    xs = Number.isFinite(x0) ? xTicks(x0, x1, 6) : [];
  }
  const X = [], Y = [], lab = [];
  const fmt = q => (+q.toPrecision(3)).toString();
  const addArc = (cx, cy, r, a, b) => {
    const n = 56;
    for (let i = 0; i <= n; i++) {
      const t = a + (b - a) * i / n;
      X.push(cx + r * Math.cos(t)); Y.push(cy + r * Math.sin(t));
    }
    X.push(null); Y.push(null);
  };
  for (const r of rs) {
    const cx = r / (1 + r), rad = 1 / (1 + r), arcs = clipCircle(cx, 0, rad, v);
    for (const [a, b] of arcs) addArc(cx, 0, rad, a, b);
    const gx = (r - 1) / (r + 1);
    if (gx >= v.x0 && gx <= v.x1 && v.y0 <= 0 && v.y1 >= 0) lab.push({ x: gx, y: 0, text: fmt(r) });
    else if (arcs.length) {
      const [a, b] = arcs[0], t = 0.5 * (a + b);
      lab.push({ x: cx + rad * Math.cos(t), y: rad * Math.sin(t), text: `r ${fmt(r)}` });
    }
  }
  for (const x of xs) {
    if (x === 0) {
      if (v.y0 <= 0 && v.y1 >= 0) { X.push(Math.max(v.x0, -1), Math.min(v.x1, 1), null); Y.push(0, 0, null); }
      continue;
    }
    const cy = 1 / x, rad = Math.abs(1 / x), arcs = clipCircle(1, cy, rad, v);
    for (const [a, b] of arcs) addArc(1, cy, rad, a, b);
    const rx = (x * x - 1) / (x * x + 1), ry = 2 * x / (x * x + 1);
    if (span > 1.4) lab.push({ x: rx * 1.055, y: ry * 1.055, text: `${x > 0 ? '+' : '−'}j${fmt(Math.abs(x))}` });
    else if (arcs.length) {
      const [a, b] = arcs[0], t = 0.5 * (a + b);
      lab.push({ x: 1 + rad * Math.cos(t), y: cy + rad * Math.sin(t), text: `${x > 0 ? '+' : '−'}j${fmt(Math.abs(x))}` });
    }
  }
  // drop labels that would touch one already placed
  const keep = [], sx = 0.075 * (v.x1 - v.x0), sy = 0.04 * (v.y1 - v.y0);
  for (const a of lab) {
    if (!keep.some(b => Math.abs(a.x - b.x) < sx && Math.abs(a.y - b.y) < sy)) keep.push(a);
  }
  return { X, Y, lab: keep };
}

export const FULL = { x0: -1.14, x1: 1.14, y0: -1.14, y1: 1.14 };
const MIN_SPAN = 2e-5, MAX_SPAN = 3.2, SETTLE_MS = 130;

/** Text with <b> and <sub>, drawn on canvas. Returns the width. */
function rich(ctx, text, x, y, o = {}) {
  const size = o.size || 14, runs = [];
  let bold = !!o.bold, sub = false;
  for (const p of String(text).split(/(<\/?(?:b|sub)>)/)) {
    if (p === '<b>') bold = true; else if (p === '</b>') bold = !!o.bold;
    else if (p === '<sub>') sub = true; else if (p === '</sub>') sub = false;
    else if (p) runs.push({ p, bold, sub });
  }
  const fontOf = r => `${r.bold ? 600 : 400} ${r.sub ? Math.round(size * 0.74) : size}px ${FONTS}`;
  let w = 0;
  for (const r of runs) { ctx.font = fontOf(r); r.w = ctx.measureText(r.p).width; w += r.w; }
  if (o.measure) return w;
  let cx = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
  ctx.fillStyle = o.color || INK;
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  for (const r of runs) {
    ctx.font = fontOf(r);
    ctx.fillText(r.p, cx, y + (r.sub ? size * 0.24 : 0));
    cx += r.w;
  }
  return w;
}

function hexRgb(c) {
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  const v = parseInt(m[1], 16);
  return [v >> 16, (v >> 8) & 255, v & 255];
}
/** 256-entry color table from the shared colorscale. */
export const LUT = (() => {
  const t = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const f = i / 255;
    let k = 0;
    while (k < VIRIDIS.length - 2 && f > VIRIDIS[k + 1][0]) k++;
    const [p, a] = VIRIDIS[k], [q, b] = VIRIDIS[k + 1], u = (f - p) / (q - p);
    const A = hexRgb(a), B = hexRgb(b);
    for (let c = 0; c < 3; c++) t[3 * i + c] = A[c] + (B[c] - A[c]) * u;
  }
  return t;
})();
const lutColor = f => {
  const i = 3 * Math.max(0, Math.min(255, Math.round(255 * f)));
  return `rgb(${LUT[i]},${LUT[i + 1]},${LUT[i + 2]})`;
};

const DASH = { solid: [], dash: [9, 6], dot: [2, 5], dashdot: [9, 5, 2, 5], longdash: [14, 6] };

function marker(ctx, x, y, size, sym) {
  const r = size / 2;
  ctx.beginPath();
  if (sym === 'square') ctx.rect(x - r * 0.9, y - r * 0.9, 1.8 * r, 1.8 * r);
  else if (sym === 'diamond') { ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r * 1.2, y); ctx.lineTo(x, y + r * 1.2); ctx.lineTo(x - r * 1.2, y); ctx.closePath(); }
  else if (sym === 'triangle-up') { ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r * 1.1, y + r * 0.85); ctx.lineTo(x - r * 1.1, y + r * 0.85); ctx.closePath(); }
  else if (sym === 'star') {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r * 0.45 : r * 1.1;
      ctx[i ? 'lineTo' : 'moveTo'](x + q * Math.cos(a), y + q * Math.sin(a));
    }
    ctx.closePath();
  } else if (sym === 'x') { ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); } else ctx.arc(x, y, r, 0, 2 * Math.PI);
}

/** Legend swatch: the line, the marker symbol, or both, as drawn on the chart. */
function swatch(t) {
  const lineOnly = t.line && !(t.mode || '').includes('markers');
  if (lineOnly || (t.line && t.legendSymbol === 'line')) {
    const dash = (DASH[t.line.dash || 'solid'] || []).join(' ');
    return `<svg width="30" height="14"><line x1="1" y1="7" x2="29" y2="7" stroke="${t.line.color}" stroke-width="${Math.min(3, t.line.width || 2)}" stroke-dasharray="${dash}"/></svg>`;
  }
  const m = t.marker, sym = t.legendSymbol || m.symbol || 'circle', c = Array.isArray(m.color) ? '#888' : m.color;
  const stroke = m.line ? `stroke="${m.line.color === '#fff' ? '#14171c' : m.line.color}" stroke-width="1"` : '';
  const shape = sym === 'square' ? `<rect x="2" y="2" width="12" height="12" rx="2" fill="${c}" ${stroke}/>`
    : sym === 'diamond' ? `<path d="M8 1 L15 8 L8 15 L1 8 Z" fill="${c}" ${stroke}/>`
    : sym === 'star' ? `<path d="${Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? 3 : 7.5; return `${i ? 'L' : 'M'}${(8 + q * Math.cos(a)).toFixed(2)} ${(8 + q * Math.sin(a)).toFixed(2)}`; }).join(' ')} Z" fill="${c}" ${stroke}/>`
    : `<circle cx="8" cy="8" r="${Math.min(6, Math.max(3, (m.size || 8) / 2))}" fill="${c}" ${stroke}/>`;
  return `<svg width="16" height="16">${shape}</svg>`;
}

export class Smith {
  constructor(el, { onView, onPick } = {}) {
    this.el = el; this.onView = onView; this.onPick = onPick;
    el.__smith = this;
    el.classList.add('sc');
    el.innerHTML = `<div class="sc-title"></div>
      <div class="sc-body"><div class="sc-plot"><canvas></canvas>
        <div class="sc-btns"><button data-z="in" aria-label="Zoom in">+</button><button data-z="out" aria-label="Zoom out">−</button><button data-z="png">PNG</button></div></div>
        <canvas class="sc-bar" width="0" height="0"></canvas></div>
      <div class="sc-leg"></div>`;
    this.titleEl = el.querySelector('.sc-title');
    this.plot = el.querySelector('.sc-plot');
    this.cv = el.querySelector('.sc-plot canvas');
    this.ctx = this.cv.getContext('2d');
    this.barEl = el.querySelector('.sc-bar');
    this.legEl = el.querySelector('.sc-leg');
    this.view = { ...FULL };
    this.data = { traces: [], hover: [], annotations: [], title: '' };
    this.layers = null;          // { base, detail, lines, labels, bar }
    this.stamp = 0;              // advances with every view change
    this.hidden = new Set();
    this.w = 0; this.h = 0;
    new ResizeObserver(() => this.resize()).observe(this.plot);
    this.resize();
    this.bind();
  }

  resize() {
    const r = this.plot.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (r.width < 2 || r.height < 2) return;
    this.w = r.width; this.h = r.height; this.dpr = dpr;
    this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr);
    this.drawBar();
    this.render();
  }

  /** Expand a window to the aspect ratio of the canvas. */
  fit(v) {
    if (!this.w) return v;
    const dx = v.x1 - v.x0, dy = v.y1 - v.y0, want = this.w / this.h;
    if (dx / dy < want) { const e = (dy * want - dx) / 2; return { ...v, x0: v.x0 - e, x1: v.x1 + e }; }
    const e = (dx / want - dy) / 2;
    return { ...v, y0: v.y0 - e, y1: v.y1 + e };
  }
  isFull() { return this.view.y1 - this.view.y0 > 2.2 && this.view.x1 - this.view.x0 > 2.2; }

  set(d) {
    Object.assign(this.data, d);
    this.titleEl.innerHTML = this.data.title || '';
    this.drawLegend();
    this.render();
  }
  setLayers(l) { this.layers = l; this.drawBar(); this.render(); }

  zoomTo(v) { this.view = this.fit(v); this.stamp++; this.render(); this.settleNow(); }
  reset() { this.zoomTo({ ...FULL }); }
  settleNow() { clearTimeout(this.t); if (this.onView) this.onView(this.view); }
  settle() { clearTimeout(this.t); this.t = setTimeout(() => { if (this.onView) this.onView(this.view); }, SETTLE_MS); }

  render() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  zoomAt(gx, gy, k) {
    const v = this.view, span = (v.x1 - v.x0) * k;
    if (span < MIN_SPAN * (this.w / this.h) && k < 1) return;
    if (v.y1 - v.y0 >= MAX_SPAN && v.x1 - v.x0 >= MAX_SPAN && k > 1) return;
    this.view = { x0: gx + (v.x0 - gx) * k, x1: gx + (v.x1 - gx) * k, y0: gy + (v.y0 - gy) * k, y1: gy + (v.y1 - gy) * k };
    this.stamp++;
    this.clamp();
    this.render();
    this.settle();
  }
  clamp() {
    const v = this.view, sx = v.x1 - v.x0, sy = v.y1 - v.y0;
    const dx = Math.max(0, v.x0 + sx / 2 - 1.25) + Math.min(0, v.x0 + sx / 2 + 1.25);
    const dy = Math.max(0, v.y0 + sy / 2 - 1.25) + Math.min(0, v.y0 + sy / 2 + 1.25);
    if (dx || dy) this.view = { x0: v.x0 - dx, x1: v.x1 - dx, y0: v.y0 - dy, y1: v.y1 - dy };
  }
  toG(px, py) { const v = this.view; return [v.x0 + (v.x1 - v.x0) * px / this.w, v.y1 - (v.y1 - v.y0) * py / this.h]; }

  draw(ctx = this.ctx, W = this.w, H = this.h, dpr = this.dpr) {
    if (!W) return;
    const v = this.view = this.fit(this.view), d = this.data, L = this.layers, hid = this.hidden;
    const sx = W / (v.x1 - v.x0), sy = H / (v.y1 - v.y0);
    const X = x => (x - v.x0) * sx, Y = y => (v.y1 - y) * sy;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    const cx = X(0), cy = Y(0), R = sx;

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.clip();
    if (L) {
      ctx.fillStyle = '#dfe2e7'; ctx.fillRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      for (const b of [L.base, L.detail]) {
        if (!b) continue;
        ctx.imageSmoothingEnabled = !b.sharp;
        ctx.drawImage(b.canvas, X(b.x0), Y(b.y1), (b.x1 - b.x0) * sx, (b.y1 - b.y0) * sy);
      }
      if (L.lines) {
        ctx.strokeStyle = 'rgba(15,20,30,.55)'; ctx.lineWidth = 0.9;
        ctx.beginPath();
        for (const { seg } of L.lines) {
          for (let q = 0; q < seg.length; q += 4) {
            const a = seg[q], b = seg[q + 1], c = seg[q + 2], e = seg[q + 3];
            if ((a < v.x0 && c < v.x0) || (a > v.x1 && c > v.x1) || (b < v.y0 && e < v.y0) || (b > v.y1 && e > v.y1)) continue;
            ctx.moveTo(X(a), Y(b)); ctx.lineTo(X(c), Y(e));
          }
        }
        ctx.stroke();
      }
    }
    const g = gridLines(v);
    ctx.strokeStyle = L ? 'rgba(255,255,255,.42)' : LINE; ctx.lineWidth = 1;
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < g.X.length; i++) {
      if (g.X[i] === null) { pen = false; continue; }
      ctx[pen ? 'lineTo' : 'moveTo'](X(g.X[i]), Y(g.Y[i])); pen = true;
    }
    ctx.stroke();
    if (L && L.labels) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `400 13px ${FONTS}`;
      ctx.lineJoin = 'round';
      for (const s of L.labels) {
        const px = X(s.x), py = Y(s.y);
        if (px < 0 || py < 0 || px > W || py > H) continue;
        ctx.save(); ctx.translate(px, py); ctx.rotate(-s.a);
        ctx.strokeStyle = 'rgba(15,20,30,.75)'; ctx.lineWidth = 3; ctx.strokeText(s.text, 0, 0);
        ctx.fillStyle = '#fff'; ctx.fillText(s.text, 0, 0);
        ctx.restore();
      }
    }
    ctx.restore();
    ctx.strokeStyle = LINE2; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.stroke();

    for (const a of g.lab) this.tag(ctx, X(a.x), Y(a.y), a.text, L, W, H);
    for (const t of d.traces) this.drawTrace(ctx, t, X, Y, hid);
    for (const a of d.annotations || []) this.drawNote(ctx, a, X, Y);
  }

  tag(ctx, px, py, text, onField, W, H) {
    if (px < -30 || py < -12 || px > W + 30 || py > H + 12) return;
    ctx.font = `400 13px ${FONTS}`;
    const w = ctx.measureText(text).width + 6;
    ctx.fillStyle = onField ? 'rgba(20,30,50,.5)' : 'rgba(255,255,255,.85)';
    ctx.fillRect(px - w / 2, py - 9, w, 18);
    ctx.fillStyle = onField ? '#fff' : INK2;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, px, py);
  }

  drawTrace(ctx, t, X, Y, hid) {
    if (t.legendgroup && hid.has(t.legendgroup)) return;
    if (t.name && !t.legendgroup && hid.has(t.name)) return;
    const n = t.x.length;
    if ((t.mode || '').includes('lines')) {
      ctx.save();
      ctx.strokeStyle = t.line.color; ctx.lineWidth = t.line.width || 2;
      ctx.setLineDash(DASH[t.line.dash || 'solid'] || []); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < n; i++) ctx[i ? 'lineTo' : 'moveTo'](X(t.x[i]), Y(t.y[i]));
      ctx.stroke();
      ctx.restore();
    }
    if ((t.mode || '').includes('markers')) {
      const m = t.marker, arr = Array.isArray(m.color);
      let lo = 0, hi = 1;
      if (arr) { lo = Infinity; hi = -Infinity; for (const c of m.color) { if (c < lo) lo = c; if (c > hi) hi = c; } }
      for (let i = 0; i < n; i++) {
        const px = X(t.x[i]), py = Y(t.y[i]);
        if (px < -20 || py < -20 || px > this.w + 20 || py > this.h + 20) continue;
        marker(ctx, px, py, m.size, m.symbol);
        const c = arr ? lutColor((m.color[i] - lo) / ((hi - lo) || 1)) : m.color;
        if (m.symbol === 'x') { ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.stroke(); continue; }
        ctx.fillStyle = c; ctx.fill();
        if (m.line) { ctx.strokeStyle = m.line.color; ctx.lineWidth = m.line.width; ctx.stroke(); }
      }
    }
  }

  drawNote(ctx, a, X, Y) {
    const px = X(a.x), py = Y(a.y), tx = px + (a.showarrow ? a.ax : 0), ty = py + (a.showarrow ? a.ay : 0);
    const size = (a.font && a.font.size) || 14;
    if (tx < -40 || ty < -20 || tx > this.w + 40 || ty > this.h + 20) return;
    if (a.showarrow) {
      ctx.strokeStyle = a.arrowcolor || '#6b7380'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tx, ty); ctx.stroke();
    }
    const w = rich(ctx, a.text, 0, 0, { size, measure: true }) + 8, h = size + 8;
    ctx.fillStyle = a.bgcolor || 'rgba(255,255,255,.92)';
    ctx.fillRect(tx - w / 2, ty - h / 2, w, h);
    if (a.bordercolor) { ctx.strokeStyle = a.bordercolor; ctx.lineWidth = 1; ctx.strokeRect(tx - w / 2, ty - h / 2, w, h); }
    rich(ctx, a.text, tx, ty + size * 0.36, { size, align: 'center' });
  }

  /** A color bar without a field, for colored markers. */
  bar(b) { this.barOnly = b; this.drawBar(); }
  drawBar() {
    const b = (this.layers && this.layers.bar) || this.barOnly, el = this.barEl;
    if (!b || !this.h) { el.style.display = 'none'; return; }
    el.style.display = '';
    const dpr = this.dpr || 1, W = 92, H = this.h;
    el.width = W * dpr; el.height = H * dpr; el.style.width = `${W}px`; el.style.height = `${H}px`;
    this.paintBar(el.getContext('2d'), W, H, dpr, b);
  }
  paintBar(c, W, H, dpr, b, ox = 0, oy = 0) {
    c.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr);
    if (!ox) { c.fillStyle = '#fff'; c.fillRect(0, 0, W, H); }
    const y0 = 14, y1 = H - 14, x = 6, w = 16;
    for (let y = y0; y < y1; y++) {
      const f = 1 - (y - y0) / (y1 - y0);
      c.fillStyle = lutColor(b.steps ? (Math.floor(f * b.steps) + 0.5) / b.steps : f);
      c.fillRect(x, y, w, 1.5);
    }
    c.textAlign = 'left'; c.textBaseline = 'middle'; c.font = `400 ${SIZE.tick}px ${FONTS}`; c.fillStyle = INK2;
    for (const t of b.ticks) {
      const y = y1 - (t - b.lo) / (b.hi - b.lo) * (y1 - y0);
      if (y < y0 - 1 || y > y1 + 1) continue;
      c.strokeStyle = '#8d95a1'; c.lineWidth = 1; c.beginPath(); c.moveTo(x + w, y); c.lineTo(x + w + 4, y); c.stroke();
      c.fillStyle = INK2; c.fillText(t.toFixed(b.dec), x + w + 7, y);
    }
    c.save(); c.translate(W - 8, H / 2); c.rotate(Math.PI / 2);
    rich(c, b.title, 0, 0, { size: SIZE.axis, align: 'center' });
    c.restore();
  }

  drawLegend() {
    const d = this.data, el = this.legEl;
    if (!d.legendRows) { el.style.display = 'none'; return; }
    el.style.display = '';
    const seen = new Set(), items = [];
    for (const t of d.traces) {
      if (!t.name || t.showlegend === false || seen.has(t.name)) continue;
      seen.add(t.name); items.push(t);
    }
    el.innerHTML = items.map(t => {
      const k = t.legendgroup || t.name;
      const sw = swatch(t);
      // a key entry (a color or a line style of the field) explains, it does not toggle
      return t.legendOnly ? `<span class="key">${sw}<span>${t.name}</span></span>` : `<button data-k="${k}" class="${this.hidden.has(k) ? 'off' : ''}">${sw}<span>${t.name}</span></button>`;
    }).join('');
  }

  png() {
    const k = 2, W = this.w, H = this.h, bd = (this.layers && this.layers.bar) || this.barOnly, bar = bd ? 92 : 0, top = 34;
    const c = document.createElement('canvas');
    c.width = (W + bar) * k; c.height = (H + top) * k;
    const g = c.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0); g.fillStyle = '#fff'; g.fillRect(0, 0, W + bar, H + top);
    rich(g, (this.data.title || '').replace(/&amp;/g, '&'), 10, 22, { size: SIZE.title });
    const m = document.createElement('canvas');
    m.width = W * k; m.height = H * k;
    this.draw(m.getContext('2d'), W, H, k);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(m, 0, top * k);
    if (bar) this.paintBar(g, bar, H, k, bd, W, top);
    c.toBlob(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = 'smith_chart.png'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  }

  bind() {
    const cv = this.cv;
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      hideTip();
      const r = cv.getBoundingClientRect();
      const [gx, gy] = this.toG(e.clientX - r.left, e.clientY - r.top);
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 200 : e.deltaY;
      this.zoomAt(gx, gy, Math.exp(Math.max(-300, Math.min(300, dy)) * 0.0016));
    }, { passive: false });
    let drag = null;
    cv.addEventListener('pointerdown', e => {
      if (e.button) return;
      cv.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, v: { ...this.view } };
      cv.classList.add('grab');
      hideTip();
    });
    cv.addEventListener('pointermove', e => {
      if (drag) {
        const v = drag.v, kx = (v.x1 - v.x0) / this.w, ky = (v.y1 - v.y0) / this.h;
        const dx = -(e.clientX - drag.x) * kx, dy = (e.clientY - drag.y) * ky;
        this.view = { x0: v.x0 + dx, x1: v.x1 + dx, y0: v.y0 + dy, y1: v.y1 + dy };
        this.stamp++;
        this.clamp();
        this.render();
        this.settle();
        return;
      }
      this.pending = e;
      if (!this.hoverRaf) this.hoverRaf = requestAnimationFrame(() => { this.hoverRaf = 0; this.hover(this.pending); });
    });
    const end = () => { drag = null; cv.classList.remove('grab'); };
    cv.addEventListener('pointerup', e => {
      // a click without movement picks a point
      if (drag && this.onPick && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) {
        const r = cv.getBoundingClientRect(), [gx, gy] = this.toG(e.clientX - r.left, e.clientY - r.top);
        if (Math.hypot(gx, gy) < 1) this.onPick(gx, gy);
      }
      end();
    });
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', hideTip);
    cv.addEventListener('dblclick', () => this.reset());
    this.el.querySelector('.sc-btns').addEventListener('click', e => {
      const z = e.target.dataset.z;
      if (z === 'png') { this.png(); return; }
      if (!z) return;
      const v = this.view;
      this.zoomAt((v.x0 + v.x1) / 2, (v.y0 + v.y1) / 2, z === 'in' ? 1 / 1.6 : 1.6);
    });
    this.legEl.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const k = b.dataset.k;
      if (this.hidden.has(k)) this.hidden.delete(k); else this.hidden.add(k);
      this.drawLegend(); this.render();
    });
  }

  hover(e) {
    const r = this.cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    if (px < 0 || py < 0 || px > this.w || py > this.h) { hideTip(); return; }
    const [gx, gy] = this.toG(px, py), d = this.data, v = this.view;
    const sx = this.w / (v.x1 - v.x0);
    let near = null, bd = 12;
    for (const h of d.hover) {
      const q = Math.hypot((h.gx - gx) * sx, (h.gy - gy) * sx);
      if (q < bd) { bd = q; near = h; }
    }
    const inside = Math.hypot(gx, gy) < 1;
    if (!inside && !near) { hideTip(); return; }
    showTip(e.clientX, e.clientY, tipHtml(near, inside ? gx : near.gx, inside ? gy : near.gy, d.problem, d.Z0, d.tip));
  }
}

function tipHtml(near, gx, gy, p, Z0, tip) {
  const rows = [];
  let title = '';
  if (near) {
    title = near.title;
    for (const [a, b] of near.rows || []) rows.push([a, b]);
    if (near.rows && near.rows.length) rows.push(null);
  }
  const z = gamma2z(gx, gy, Z0), m = Math.hypot(gx, gy);
  rows.push(['Z', `${zfmt(z)} Ω`]);
  rows.push(['Γ', `${m.toFixed(4)} ∠ ${(Math.atan2(gy, gx) * 180 / Math.PI).toFixed(1)}°`]);
  rows.push(['VSWR', m < 1 ? ((1 + m) / (1 - m)).toFixed(m > 0.9 ? 1 : 2) : '–']);
  if (tip) rows.push(...tip(gx, gy));
  else if (p) {
    const f = fieldAt(p, gx, gy);
    if (f) {
      const v = q => (Number.isFinite(q) ? `${(100 * q).toFixed(2)} %` : 'not reachable');
      rows.push(['η<sub>tot</sub>', v(f.eta_tot)], ['η<sub>loss</sub>', v(f.eta_loss)], ['η<sub>match</sub>', v(f.eta_match)]);
    }
  }
  return (title ? `<div class="t1">${title}</div>` : '') + '<table>' +
    rows.map(r => (r ? `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>` : '<tr><td colspan=2 style="height:5px"></td></tr>')).join('') + '</table>';
}

let tip = null;
export function showTip(x, y, html) {
  if (!tip) { tip = document.createElement('div'); tip.id = 'tip'; document.body.appendChild(tip); }
  tip.innerHTML = html;
  tip.style.display = 'block';
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = `${x + 16 + w > innerWidth ? x - w - 14 : x + 16}px`;
  tip.style.top = `${y + 14 + h > innerHeight ? y - h - 10 : y + 14}px`;
}
export function hideTip() { if (tip) tip.style.display = 'none'; }

export { VIRIDIS };
