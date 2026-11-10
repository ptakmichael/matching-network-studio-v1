import { S, Runner, isCurrent, gridN } from './shell.js';

const fieldRunner = new Runner();
import { Smith, LUT } from './smith.js';
import { isolines, labelSpots } from './contour.js';
import { pathTraces, pointTrace, seg, zfmt, pc, styleOf } from './common.js';
import { COLOR } from './plot.js';
import { z2gamma } from '../engine/field.js';

let smith, page, raw = null, base = null, pend = null, busy = false, lastKey = '', wantBase = false;
const o = { q: 'tot', disp: 'both', scale: 'fit', step: 'auto', path: true };
const NAMES = { tot: 'η<sub>tot</sub>', loss: 'η<sub>loss</sub>', match: 'η<sub>match</sub>' };
const LONG = { tot: 'Transducer efficiency', loss: 'Network efficiency', match: 'Match efficiency' };
// both grids follow the Smith chart grid in the top bar
const GRID_N = () => gridN(), BASE_N = () => gridN();

function nice(v) {
  const p = 10 ** Math.floor(Math.log10(v)), m = v / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}

export const mapsTab = {
  mount(pg) {
    page = pg;
    pg.innerHTML = `<div class="card" style="margin-bottom:12px"><div class="toolbar">
      <div class="fld" style="width:auto"><span class="lab">Quantity</span><div class="seg" id="m_q">
        <button data-v="tot" class="on">η<sub>tot</sub></button><button data-v="loss">η<sub>loss</sub></button><button data-v="match">η<sub>match</sub></button></div></div>
      <div class="fld" style="width:auto"><span class="lab">Display</span><div class="seg" id="m_d">
        <button data-v="fill">Contours</button><button data-v="grad">Gradient</button><button data-v="both" class="on">Gradient and contours</button></div></div>
      <div class="fld" style="width:auto"><span class="lab">Scale</span><div class="seg" id="m_s">
        <button data-v="full">0 to 100 %</button><button data-v="fit" class="on">Fit to view</button></div></div>
      <div class="fld sm"><label for="m_step">Interval (%)</label><select id="m_step"><option value="auto">Auto</option><option>20</option><option>10</option><option>5</option><option>2</option><option>1</option><option>0.5</option><option>0.2</option><option>0.1</option><option>0.05</option><option>0.01</option></select></div>
      <label class="chk"><input type="checkbox" id="m_p" checked> Network path</label>
      <button class="btn" id="m_zp" style="margin-left:auto">Zoom to path</button>
      <button class="btn" id="m_rs">Full chart</button>
    </div></div>
    <div class="maps"><div class="card" style="display:flex;min-height:0"><div class="smith" id="m_smith"></div></div>
      <div class="card" style="overflow-y:auto"><h3>Points</h3><div class="tw" id="m_pts"></div>
      <p class="note">Field recomputed after each zoom, on the Smith chart grid set in the top bar. Grey: Z<sub>in</sub> not reachable. Scroll to zoom, drag to pan, double-click for the full chart. Fit to view spans the central 96 % of visible values.</p>
      <div id="m_info" class="note"></div></div></div>`;
    smith = new Smith(pg.querySelector('#m_smith'), { onView: () => { if (raw || base) requestField(); } });
    seg(pg.querySelector('#m_q'), v => { o.q = v; drawField(); });
    seg(pg.querySelector('#m_d'), v => { o.disp = v; drawField(); });
    seg(pg.querySelector('#m_s'), v => { o.scale = v; drawField(); });
    pg.querySelector('#m_step').addEventListener('change', e => { o.step = e.target.value; drawField(); });
    pg.querySelector('#m_p').addEventListener('change', e => { o.path = e.target.checked; overlays(); });
    pg.querySelector('#m_rs').addEventListener('click', () => smith.reset());
    pg.querySelector('#m_zp').addEventListener('click', () => {
      const n = S.single.active; if (!n) return;
      const pts = [n.ZL, n.Zin].map(z => z2gamma(z[0], z[1], n.p.Z0));
      const xs = pts.map(a => a[0]), ys = pts.map(a => a[1]);
      const m = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 0.02) * 0.2;
      smith.zoomTo({ x0: Math.min(...xs) - m, x1: Math.max(...xs) + m, y0: Math.min(...ys) - m, y1: Math.max(...ys) + m });
    });
  },
  render() {
    overlays();
    const p = prob();
    if (!p) return;
    const key = JSON.stringify([p.ZL, p.Zs, p.QL, p.QC, p.Z0, gridN()]);
    if (key !== lastKey) { lastKey = key; base = null; raw = null; wantBase = true; requestField(); }
  },
};

const prob = () => {
  const n = S.single.active;
  if (n) return { ZL: n.ZL, Zs: n.p.Zs, QL: n.p.QL, QC: n.p.QC, Z0: n.p.Z0 };
  return S.single.p;
};

function fieldQuery(v, n) {
  const p = prob();
  return { p: { ZL: p.ZL, Zs: p.Zs, QL: p.QL, QC: p.QC, Z0: p.Z0 }, x0: v.x0, x1: v.x1, y0: v.y0, y1: v.y1, n };
}

function requestField() {
  if (!prob() || !smith.w) return;
  const v = smith.view, m = 0.06 * (v.x1 - v.x0), c = 1.03;
  // a small margin, and nothing beyond the unit circle
  const w = { x0: Math.max(v.x0 - m, -c), x1: Math.min(v.x1 + m, c), y0: Math.max(v.y0 - m, -c), y1: Math.min(v.y1 + m, c) };
  pend = fieldQuery(w, GRID_N());
  pump();
}
function pump() {
  if (busy) return;
  // the full chart is computed once per problem; it stays under every detail layer
  let q = null, isBase = false;
  if (wantBase) { q = fieldQuery({ x0: -1.03, x1: 1.03, y0: -1.03, y1: 1.03 }, BASE_N()); isBase = true; wantBase = false; }
  else if (pend) { q = pend; pend = null; }
  if (!q) return;
  busy = true;
  const t0 = performance.now(), stamp = smith.stamp;
  fieldRunner.run('field', q, (type, d) => {
    if (type === 'field') {
      d.ms = performance.now() - t0;
      // A result for a view already left is dropped, so processing it cannot delay
      // the next scroll step. A newer request follows when the pointer stops.
      if (isBase) base = d;
      else if (stamp === smith.stamp) raw = d;
      else return;
      const c0 = performance.now();
      drawField();
      window.__fieldMs = performance.now() - c0;
    } else if (type === 'end' || type === 'error' || type === 'cancelled') { busy = false; pump(); }
  });
}

function nice2(v) { return nice(v); }

/** Color a field into a bitmap. Row 0 of the bitmap is the top of the window. */
function paint(f, lo, hi, levels) {
  const n = f.n, src = f[o.q], cv = document.createElement('canvas');
  cv.width = n; cv.height = n;
  const g = cv.getContext('2d'), img = g.createImageData(n, n), px = img.data, k = 1 / (hi - lo);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = 100 * src[i + n * j], q = 4 * (i + n * (n - 1 - j));
      if (v !== v) { px[q + 3] = 0; continue; }
      let t = (v - lo) * k;
      if (levels) t = (Math.floor(t * levels) + 0.5) / levels;
      const c = 3 * Math.max(0, Math.min(255, Math.round(255 * t)));
      px[q] = LUT[c]; px[q + 1] = LUT[c + 1]; px[q + 2] = LUT[c + 2]; px[q + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return { canvas: cv, x0: f.xs[0], x1: f.xs[n - 1], y0: f.ys[0], y1: f.ys[n - 1] };
}

function drawField() {
  const f = raw || base;
  if (!f) return;
  const n = f.n, src = f[o.q], vis = [], v = smith.view;
  // the scale comes from what is on screen, not from the margin around it
  for (let j = 0; j < n; j += 2) {
    const y = f.ys[j];
    if (y < v.y0 || y > v.y1) continue;
    for (let i = 0; i < n; i += 2) {
      const x = f.xs[i], q = src[i + n * j];
      if (x >= v.x0 && x <= v.x1 && q === q && x * x + y * y < 1) vis.push(100 * q);
    }
  }
  let lo = 0, hi = 100;
  if (o.scale === 'fit' && vis.length) {
    vis.sort((a, b) => a - b);
    // central 96 % of the visible values, so a small extreme region near the rim
    // does not compress the rest of the field into one color
    lo = vis[Math.floor(0.02 * (vis.length - 1))]; hi = vis[Math.floor(0.98 * (vis.length - 1))];
    if (hi - lo < 1e-3) { lo = vis[0]; hi = vis[vis.length - 1]; }
    if (hi - lo < 1e-6) hi = lo + 1e-3;
  }
  const step = o.step === 'auto' ? (o.scale === 'full' ? 10 : nice2((hi - lo) / 12)) : +o.step;
  const start = Math.floor(lo / step) * step, end = Math.ceil(hi / step) * step;
  const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const zmin = o.scale === 'full' ? 0 : start, zmax = o.scale === 'full' ? 100 : end;
  const bands = o.disp === 'fill' ? Math.round((zmax - zmin) / step) : 0;
  const lv = [];
  for (let q = start; q <= end + 1e-9; q += step) lv.push(+q.toFixed(8));
  let lines = null, labels = null;
  const detail = raw && raw !== base ? paint(raw, zmin, zmax, bands) : null;
  if (o.disp !== 'grad' && lv.length <= 120) {
    const z = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) z[i] = 100 * src[i];
    lines = isolines(z, f.xs, f.ys, lv);
    const gap = 0.16 * (v.y1 - v.y0);
    labels = labelSpots(lines, gap, (x, y) => x > v.x0 && x < v.x1 && y > v.y0 && y < v.y1 && x * x + y * y < 0.9999, (v.x0 + v.x1) / 2, (v.y0 + v.y1) / 2)
      .map(s => ({ ...s, text: s.level.toFixed(dec) }));
  }
  const ticks = [];
  const tstep = nice2((zmax - zmin) / 9);
  for (let t = Math.ceil(zmin / tstep) * tstep; t <= zmax + 1e-9; t += tstep) ticks.push(t);
  const tdec = Math.max(0, -Math.floor(Math.log10(tstep) + 1e-9));
  smith.setLayers({
    base: base ? paint(base, zmin, zmax, bands) : null, detail, lines, labels,
    bar: { lo: zmin, hi: zmax, ticks, dec: tdec, steps: bands, title: `${NAMES[o.q]} (%)` },
  });
  page.querySelector('#m_info').textContent = `Range ${lo.toFixed(dec + 1)} to ${hi.toFixed(dec + 1)} %, interval ${step} %, ${f.n} × ${f.n} points, computed in ${f.ms.toFixed(0)} ms.`;
}

function overlays() {
  const n = S.single.active, p = prob();
  if (!p) return;
  const Z0 = p.Z0, traces = [], ann = [], hover = [];
  if (n && o.path) {
    const a = pathTraces(n, Z0);
    traces.push(...a.traces); ann.push(...a.ann); hover.push(...a.hover);
  }
  const marks = [
    pointTrace(p.ZL, Z0, 'Z<sub>L</sub>', { color: '#000', ax: 28, ay: -26, title: 'Load impedance' }),
    pointTrace([p.Zs[0], -p.Zs[1]], Z0, 'Z<sub>s</sub>*', { color: '#000', symbol: 'star', size: 18, ax: 30, ay: 26, title: 'Conjugate of the source impedance' }),
  ];
  if (n) marks.push(pointTrace(n.Zin, Z0, 'Z<sub>in</sub>', { color: styleOf(n).color, ax: -32, ay: 28, title: 'Input impedance' }));
  if (S.single.closed) {
    marks.push(pointTrace(S.single.closed.opt.Zin, Z0, 'Z<sub>opt</sub>', { color: COLOR.orange, symbol: 'diamond', ax: -30, ay: -28, title: 'Closed-form optimum', rows: [['η<sub>tot</sub>', `${pc(S.single.closed.opt.eta_tot)} %`]] }));
  }
  for (const m of marks) { traces.push(m.trace); ann.push(m.ann); hover.push(m.hover); }
  const title = `${LONG[o.q]} ${NAMES[o.q]} versus input impedance, Z<sub>L</sub> = ${zfmt(p.ZL)} Ω, Q<sub>L</sub> = ${p.QL}, Q<sub>C</sub> = ${p.QC}, Z<sub>0</sub> = ${p.Z0} Ω`;
  smith.set({ title, Z0, traces, annotations: ann, hover, problem: p, legendRows: 0 });
  const rows = [['Z<sub>L</sub>', p.ZL], ['Z<sub>s</sub>*', [p.Zs[0], -p.Zs[1]]]];
  if (n) rows.push(['Z<sub>in</sub>', n.Zin, n.eta_tot]);
  if (S.single.closed) rows.push(['Z<sub>opt</sub>', S.single.closed.opt.Zin, S.single.closed.opt.eta_tot]);
  page.querySelector('#m_pts').innerHTML = `<table class="t"><thead><tr><th>Point</th><th>Z (Ω)</th><th>η<sub>tot</sub> (%)</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r[0]}</td><td>${zfmt(r[1])}</td><td>${r[2] != null ? pc(r[2]) : '–'}</td></tr>`).join('')}</tbody></table>`;
}
void isCurrent;
