// Limits: the best efficiency any ladder can reach, at every load on the Smith chart.
// Each pixel is a load Z_L; its value comes from the closed-form optimal termination
// Z_opt(Z_L), so the map is exact and recomputed live as the view changes.
import { S, Runner, status, envFields, readEnv, stored, gridN } from './shell.js';
import { Smith, LUT, hideTip } from './smith.js';
import { isolines, labelSpots } from './contour.js';
import { pointTrace, seg, zfmt, pc } from './common.js';
import { COLOR } from './plot.js';
import { z2gamma, gamma2z } from '../engine/field.js';
import { zopt } from '../engine/zopt.js';
import { exact } from '../engine/exact.js';
import { KINDS, kindOf } from '../engine/limits.js';
import { solveFor } from './ws_single.js';

const W = 'limits';
const POOL = Array.from({ length: Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1)) }, () => new Runner());
const KIND_COLOR = ['#9aa3b0', COLOR.blue, COLOR.orange, COLOR.aqua, COLOR.pink];
const KIND_HINT = [
  'Connecting the load directly is best.',
  'Only inductors: the optimum is reached by raising X/R alone.',
  'Only capacitors: the optimum is reached by lowering X/R alone.',
  'A long ladder at a fixed angle: the resistance must change a lot.',
  'An excursion past the load angle, then back.',
];
const Q = {
  tot: ['Best η<sub>tot</sub>', 'Best transducer efficiency, any ladder'],
  loss: ['η<sub>loss</sub> at Z<sub>opt</sub>', 'Network efficiency at the optimum'],
  match: ['η<sub>match</sub> at Z<sub>opt</sub>', 'Match efficiency at the optimum: 100 % means Z<sub>opt</sub> = Z<sub>s</sub>*'],
  kind: ['Network type', 'Structure of the optimal network'],
};
// both follow the Smith chart grid in the top bar
const BASE_N = () => gridN(), DETAIL_N = () => gridN();
const o = { q: 'tot', scale: 'fit', single: false, set: false };
let side, page, smith, base = null, detail = null, gen = 0, envSig = '', pick = null, hoverZ = null, key = { step: null, kinds: [] };

export const limitsWs = {
  id: W, label: 'Limits', hint: 'Best efficiency any network can reach, for every load',
  views: [{ id: 'map', label: 'Best achievable efficiency over the load plane', view: null }],
  side() {
    return `
    ${envFields(W, { f0: false })}
    <h2>Show</h2>
    <div class="seg vseg" id="l_q">${Object.entries(Q).map(([k, v]) => `<button data-v="${k}" class="${k === o.q ? 'on' : ''}">${v[0]}</button>`).join('')}</div>
    <div class="note" id="l_qn"></div>
    <div class="fld" id="l_sc" style="margin-top:8px"><span class="lab">Color scale</span><div class="seg" id="l_s"><button data-v="full">0 to 100 %</button><button data-v="fit" class="on">Fit to view</button></div></div>
    <h2>Overlay</h2>
    <label class="chk line"><input type="checkbox" id="l_ss"><span>Z<sub>L</sub> of Single load</span></label>
    <label class="chk line"><input type="checkbox" id="l_st"><span>States of Load set</span></label>
    <h2>Selected load</h2>
    <div id="l_pick" class="note">Click a load on the chart. Hovering shows where its optimum Z<sub>opt</sub> lies.</div>`;
  },
  mount(el) {
    side = el;
    seg(el.querySelector('#l_q'), v => { o.q = v; legend(); paint(); });
    seg(el.querySelector('#l_s'), v => { o.scale = v; paint(); });
    el.querySelector('#l_ss').addEventListener('change', e => { o.single = e.target.checked; overlays(); });
    el.querySelector('#l_st').addEventListener('change', e => { o.set = e.target.checked; overlays(); });
    el.addEventListener('click', e => { if (e.target.id === 'l_go' && pick) solveFor(pick.ZL); });
    legend();
  },
  envChanged() { if (page && page.closest('.page.on')) refresh(); },
  gridChanged() { if (page && page.closest('.page.on')) refresh(); },
  shown() { const sst = side.querySelector('#l_st'); sst.disabled = !S.set.data; refresh(); },
  cancel() { gen++; POOL.forEach(r => r.cancel()); status(W, 'Cancelled'); },
};

const mapView = {
  mount(pg) {
    page = pg;
    pg.innerHTML = `<div class="card full"><div class="smith" id="l_smith"></div></div>`;
    smith = new Smith(pg.querySelector('#l_smith'), { onView: () => requestDetail(), onPick: (gx, gy) => select(gx, gy) });
  },
  render() {},
  shown() { refresh(); },
};
limitsWs.views[0].view = mapView;

function legend() {
  side.querySelector('#l_qn').innerHTML = o.q === 'kind'
    ? KINDS.map((k, i) => `<div class="kind"><i style="background:${KIND_COLOR[i]}"></i><span><b>${k}</b><br>${KIND_HINT[i]}</span></div>`).join('')
    : Q[o.q][1] + '.';
  side.querySelector('#l_sc').hidden = o.q === 'kind';
}

function env() { try { return readEnv(); } catch { return null; } }

/** New source or components: the whole map is recomputed. */
function refresh() {
  const p = env();
  if (!p || !smith) return;
  const sig = JSON.stringify([p.Zs, p.QL, p.QC, p.Z0, gridN()]);
  overlays();
  if (sig === envSig && base) return;
  envSig = sig; base = null; detail = null; pick = null;
  side.querySelector('#l_pick').innerHTML = 'Click a load on the chart. Hovering shows where its optimum Z<sub>opt</sub> lies.';
  smith.setLayers(null);
  // coarse first, so the chart fills at once; then the full grid; then the view
  const full = { x0: -1.03, x1: 1.03, y0: -1.03, y1: 1.03 }, n = BASE_N();
  if (n <= 61) grid(full, n, d => { base = d; paint(); }, requestDetail);
  else grid(full, 41, d => { if (!base) { base = d; paint(); } }, () => grid(full, n, d => { base = d; paint(); }, requestDetail));
}

function requestDetail() {
  if (!base || base.n < BASE_N()) return;
  const v = smith.view;
  if (v.x1 - v.x0 > 1.7 && v.y1 - v.y0 > 1.7) { detail = null; paint(); return; }
  const m = 0.06 * (v.x1 - v.x0), c = 1.03;
  grid({ x0: Math.max(v.x0 - m, -c), x1: Math.min(v.x1 + m, c), y0: Math.max(v.y0 - m, -c), y1: Math.min(v.y1 + m, c) }, DETAIL_N(), d => { detail = d; paint(); });
}

/** One n x n grid over a window, split by rows across the worker pool. */
function grid(w, n, done, after) {
  const p = env();
  if (!p) return;
  const my = ++gen, k = POOL.length, t0 = performance.now();
  const out = { n, ...w, xs: new Float64Array(n), ys: new Float64Array(n), tot: new Float32Array(n * n), loss: new Float32Array(n * n), match: new Float32Array(n * n), kind: new Uint8Array(n * n) };
  for (let i = 0; i < n; i++) { out.xs[i] = w.x0 + (w.x1 - w.x0) * i / (n - 1); out.ys[i] = w.y0 + (w.y1 - w.y0) * i / (n - 1); }
  let left = k, rows = 0;
  for (const r of POOL) if (r.busy) r.cancel();
  status(W, `Computing ${n} × ${n} loads`, 0);
  POOL.forEach((r, i) => {
    const j0 = Math.floor(n * i / k), j1 = Math.floor(n * (i + 1) / k);
    r.run('limits', { p: { Zs: p.Zs, QL: p.QL, QC: p.QC, Z0: p.Z0 }, ...w, n, j0, j1 }, (type, d) => {
      if (my !== gen) return;
      if (type === 'limits') {
        for (const f of ['tot', 'loss', 'match', 'kind']) out[f].set(d[f], j0 * n);
        rows += j1 - j0;
        status(W, `Computing ${n} × ${n} loads`, rows / n);
      } else if (type === 'end' && --left === 0) {
        out.ms = performance.now() - t0;
        status(W, `${(n * n).toLocaleString('en-US')} loads in ${(out.ms / 1000).toFixed(1)} s`);
        done(out);
        if (after) after();
      }
    });
  });
}

function nice(v) {
  const q = 10 ** Math.floor(Math.log10(v)), m = v / q;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * q;
}

function bitmap(f, lo, hi) {
  const n = f.n, cv = document.createElement('canvas');
  cv.width = n; cv.height = n;
  const g = cv.getContext('2d'), img = g.createImageData(n, n), px = img.data, k = 1 / (hi - lo);
  const rgb = KIND_COLOR.map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const q = 4 * (i + n * (n - 1 - j)), s = i + n * j;
    if (o.q === 'kind') { const c = rgb[f.kind[s]]; px[q] = c[0]; px[q + 1] = c[1]; px[q + 2] = c[2]; }
    else {
      const c = 3 * Math.max(0, Math.min(255, Math.round(255 * (100 * f[o.q][s] - lo) * k)));
      px[q] = LUT[c]; px[q + 1] = LUT[c + 1]; px[q + 2] = LUT[c + 2];
    }
    px[q + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // a categorical map is drawn without smoothing, so boundaries stay sharp
  return { canvas: cv, x0: f.xs[0], x1: f.xs[n - 1], y0: f.ys[0], y1: f.ys[n - 1], sharp: o.q === 'kind' };
}

function paint() {
  const f = detail || base;
  if (!f) return;
  const v = smith.view, n = f.n;
  if (o.q === 'kind') {
    const seen = new Set();
    for (const g of [base, detail]) if (g) for (let i = 0; i < g.kind.length; i++) seen.add(g.kind[i]);
    key = { step: null, kinds: [...seen].sort() };
    smith.setLayers({ base: bitmap(base, 0, 1), detail: detail ? bitmap(detail, 0, 1) : null, lines: null, labels: null, bar: null });
    draw();
    return;
  }
  const src = f[o.q], vis = [];
  for (let j = 0; j < n; j++) {
    const y = f.ys[j];
    if (y < v.y0 || y > v.y1) continue;
    for (let i = 0; i < n; i++) { const x = f.xs[i]; if (x >= v.x0 && x <= v.x1 && x * x + y * y < 1) vis.push(100 * src[i + n * j]); }
  }
  let lo = 0, hi = 100;
  if (o.scale === 'fit' && vis.length) {
    vis.sort((a, b) => a - b);
    lo = vis[Math.floor(0.02 * (vis.length - 1))]; hi = vis[Math.floor(0.98 * (vis.length - 1))];
    if (hi - lo < 1e-3) { lo = vis[0]; hi = vis[vis.length - 1]; }
    if (hi - lo < 1e-6) hi = lo + 1e-3;
  }
  const step = o.scale === 'full' ? 10 : nice((hi - lo) / 10);
  const zmin = o.scale === 'full' ? 0 : Math.floor(lo / step) * step, zmax = o.scale === 'full' ? 100 : Math.ceil(hi / step) * step;
  const lv = [];
  for (let q = zmin; q <= zmax + 1e-9; q += step) lv.push(+q.toFixed(8));
  const z = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) z[i] = 100 * src[i];
  const lines = isolines(z, f.xs, f.ys, lv), dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const labels = labelSpots(lines, 0.16 * (v.y1 - v.y0), (x, y) => x > v.x0 && x < v.x1 && y > v.y0 && y < v.y1 && x * x + y * y < 0.9999, (v.x0 + v.x1) / 2, (v.y0 + v.y1) / 2)
    .map(s => ({ ...s, text: s.level.toFixed(dec) }));
  const ticks = [], ts = nice((zmax - zmin) / 9);
  for (let t = Math.ceil(zmin / ts) * ts; t <= zmax + 1e-9; t += ts) ticks.push(t);
  smith.setLayers({
    base: bitmap(base, zmin, zmax), detail: detail ? bitmap(detail, zmin, zmax) : null, lines, labels,
    bar: { lo: zmin, hi: zmax, ticks, dec: Math.max(0, -Math.floor(Math.log10(ts) + 1e-9)), steps: 0, title: `${Q[o.q][0]} (%)` },
  });
  key = { step: +step.toPrecision(6), kinds: [] };
  draw();
}

// --------------------------------------------------------------- overlays
let marks = { traces: [], ann: [], hover: [] };
function overlays() {
  const p = env();
  if (!p || !smith) return;
  const Z0 = p.Z0, traces = [], ann = [], hover = [];
  const zs = pointTrace([p.Zs[0], -p.Zs[1]], Z0, 'Z<sub>s</sub>*', { color: '#000', symbol: 'star', size: 18, ax: 30, ay: 26, title: 'Conjugate of the source impedance' });
  Object.assign(zs.trace, { name: 'Z<sub>s</sub>*, conjugate of the source', showlegend: true });
  traces.push(zs.trace); ann.push(zs.ann); hover.push(zs.hover);
  if (o.single) {
    const zl = [Number(stored('zlr')), Number(stored('zlx'))];
    if (zl[0] > 0) { const m = pointTrace(zl, Z0, 'Z<sub>L</sub>', { color: '#fff', ax: 28, ay: -26, title: 'Single-load Z<sub>L</sub>' }); Object.assign(m.trace, { name: 'Z<sub>L</sub> of Single load', showlegend: true, marker: { ...m.trace.marker, line: { color: '#14171c', width: 1.6 } } }); traces.push(m.trace); ann.push(m.ann); hover.push(m.hover); }
  }
  if (o.set && S.set.data) {
    const d = S.set.data, gx = [], gy = [];
    for (let i = 0; i < d.n; i++) { const g = z2gamma(d.R[i], d.X[i], Z0); gx.push(g[0]); gy.push(g[1]); }
    traces.push({ x: gx, y: gy, type: 'scatter', mode: 'markers', name: 'States of Load set', marker: { size: 6, color: '#fff', line: { color: '#14171c', width: 0.8 } }, hoverinfo: 'skip' });
  }
  marks = { traces, ann, hover };
  draw();
}

/** Arrow from a load to its optimal termination. */
function arrow(ZL, r, Z0, color, label, name) {
  const a = z2gamma(ZL[0], ZL[1], Z0), b = z2gamma(r.Zin[0], r.Zin[1], Z0), grp = name || 'hover';
  const m = pointTrace(r.Zin, Z0, label, { color, symbol: 'diamond', size: 14, ax: -26, ay: -24, title: 'Optimal termination Z<sub>opt</sub>' });
  Object.assign(m.trace, { legendgroup: grp });
  return {
    traces: [
      { x: [a[0], b[0]], y: [a[1], b[1]], type: 'scatter', mode: 'lines', line: { color: '#fff', width: 5 }, hoverinfo: 'skip', legendgroup: grp, showlegend: false },
      { x: [a[0], b[0]], y: [a[1], b[1]], type: 'scatter', mode: 'lines', name, line: { color: '#14171c', width: 2, dash: 'dash' }, hoverinfo: 'skip', legendgroup: grp, showlegend: !!name },
      { x: [a[0]], y: [a[1]], type: 'scatter', mode: 'markers', marker: { size: 11, color: '#14171c', line: { color: '#fff', width: 1.6 } }, hoverinfo: 'skip', legendgroup: grp, showlegend: false },
      m.trace],
    ann: [m.ann],
  };
}

function draw() {
  const p = env();
  if (!p) return;
  const traces = [...marks.traces], ann = [...marks.ann];
  const shown = [pick && [pick.ZL, pick.r, COLOR.orange, 'Z<sub>opt</sub>', 'Selected load, dashed to its Z<sub>opt</sub> (orange)'], hoverZ && [hoverZ.ZL, hoverZ.r, '#fff', '', '']].filter(Boolean);
  for (const [z, r, c, l, nm] of shown) {
    const a = arrow(z, r, p.Z0, c, l, nm);
    traces.push(...a.traces);
    if (l) ann.push(...a.ann);
  }
  // key to the field: the contour spacing, or the network types present
  if (key.step) traces.push({ x: [], y: [], type: 'scatter', mode: 'lines', name: `Contour every ${key.step} %`, line: { color: 'rgba(15,20,30,.7)', width: 1.2 }, legendOnly: true });
  for (const i of key.kinds) traces.push({ x: [], y: [], type: 'scatter', mode: 'markers', name: KINDS[i], marker: { symbol: 'square', color: KIND_COLOR[i] }, legendOnly: true });
  smith.set({
    title: `${Q[o.q][1]}, for a load Z<sub>L</sub> at each point. Z<sub>s</sub> = ${zfmt(p.Zs)} Ω, Q<sub>L</sub> = ${p.QL}, Q<sub>C</sub> = ${p.QC}, Z<sub>0</sub> = ${p.Z0} Ω`,
    Z0: p.Z0, traces, annotations: ann, hover: marks.hover, problem: null, legendRows: 1, tip,
  });
}

function evalLoad(ZL, p) {
  const r = zopt(ZL, p.Zs, p.QL, p.QC);
  return { ZL, r, kind: kindOf(r, ZL) };
}

/** Hover readout: the load under the pointer, and its optimum. */
function tip(gx, gy) {
  const p = env();
  if (!p || Math.hypot(gx, gy) >= 1) return [];
  const ZL = gamma2z(gx, gy, p.Z0), h = evalLoad(ZL, p);
  hoverZ = h;
  clearTimeout(tip.t);
  tip.t = setTimeout(draw, 0);
  return [
    null,
    ['Best η<sub>tot</sub>', `${pc(h.r.eta_tot)} %`],
    ['Z<sub>opt</sub>', `${zfmt(h.r.Zin)} Ω`],
    ['η<sub>loss</sub>, η<sub>match</sub>', `${pc(h.r.eta_loss)} %, ${pc(h.r.eta_match)} %`],
    ['Optimal network', KINDS[h.kind]],
  ];
}

function select(gx, gy) {
  const p = env();
  if (!p) return;
  const ZL = gamma2z(gx, gy, p.Z0), s = evalLoad(ZL, p);
  pick = s;
  const ar = ZL[0] + p.Zs[0], ai = ZL[1] + p.Zs[1], direct = 4 * ZL[0] * p.Zs[0] / (ar * ar + ai * ai);
  const conj = exact(ZL[0], ZL[1], p.Zs[0], -p.Zs[1], p.QL, p.QC);
  side.querySelector('#l_pick').innerHTML = `<table class="t"><tbody>
    <tr><td>Z<sub>L</sub></td><td>${zfmt(ZL)} Ω</td></tr>
    <tr><td>Z<sub>opt</sub></td><td>${zfmt(s.r.Zin)} Ω</td></tr>
    <tr><td>Best η<sub>tot</sub></td><td><b>${pc(s.r.eta_tot)} %</b></td></tr>
    <tr><td>η<sub>loss</sub> at Z<sub>opt</sub></td><td>${pc(s.r.eta_loss)} %</td></tr>
    <tr><td>η<sub>match</sub> at Z<sub>opt</sub></td><td>${pc(s.r.eta_match)} %</td></tr>
    <tr><td>Conjugate match</td><td>${pc(conj)} %</td></tr>
    <tr><td>No network</td><td>${pc(direct)} %</td></tr>
    <tr><td>Optimal network</td><td>${KINDS[s.kind]}</td></tr></tbody></table>
    <button class="btn pri wide" id="l_go" style="margin-top:10px">Design networks for this load</button>`;
  draw();
}

// the hover arrow goes when the pointer leaves the chart
document.addEventListener('pointermove', e => {
  if (hoverZ && smith && !smith.cv.contains(e.target)) { hoverZ = null; hideTip(); draw(); }
});
