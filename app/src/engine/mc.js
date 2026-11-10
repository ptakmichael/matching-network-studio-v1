// Component tolerance analysis. Port of mn_mc and of the sweep in mc_tolerance.
import { etaMany, gain, rng, quantile, refdes, abcd, cdiv } from './core.js';

function stats(arr) {
  const v = Float64Array.from(arr).sort();
  let s = 0, s2 = 0;
  for (const x of v) s += x;
  const n = v.length, mean = s / n;
  for (const x of v) s2 += (x - mean) ** 2;
  return {
    n, mean, sd: Math.sqrt(s2 / Math.max(n - 1, 1)), min: v[0], max: v[n - 1],
    p01: quantile(v, 0.01), p05: quantile(v, 0.05), p50: quantile(v, 0.5), p95: quantile(v, 0.95),
  };
}

/** Deviates in [-1, 1], one row per element. */
function draw(rand, n, dist) {
  const u = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    u[k] = dist === 'normal' ? Math.max(-1, Math.min(1, rand.normal() / 3)) : 2 * rand() - 1;
  }
  return u;
}

/** Perturbed X and Rser for multipliers m on the component value. */
function perturb(X, Rser, m, model, Xo, Ro) {
  for (let k = 0; k < X.length; k++) {
    const xm = X[k] > 0 ? X[k] * m[k] : X[k] / m[k];
    Xo[k] = xm;
    Ro[k] = model === 'esr' ? Rser[k] : Rser[k] * Math.abs(xm) / Math.abs(X[k]);
  }
}

/** Monte Carlo at one load (mn_mc). tol is percent, scalar or per element. */
export function mcSingle(net, ZL, Zs, o) {
  const n = net.X.length, N = Math.max(20, Math.min(200000, Math.round(o.n ?? 4000)));
  const tol = tolVec(o.tol, n), rand = rng(o.seed ?? 12345);
  const eta = new Float64Array(N), zr = new Float64Array(N), zi = new Float64Array(N);
  const el = new Float64Array(N), em = new Float64Array(N);
  const Xo = new Array(n), Ro = new Array(n), m = new Array(n);
  const mult = Array.from({ length: n }, () => new Float32Array(N));
  for (let d = 0; d < N; d++) {
    const u = draw(rand, n, o.dist);
    for (let k = 0; k < n; k++) { m[k] = Math.max(1 + tol[k] / 100 * u[k], 1e-9); mult[k][d] = m[k]; }
    perturb(net.X, net.Rser, m, o.model, Xo, Ro);
    const g = gain(Xo, net.kind, Ro, ZL, Zs);
    eta[d] = g.eta_tot; zr[d] = g.Zin[0]; zi[d] = g.Zin[1]; el[d] = g.eta_loss; em[d] = g.eta_match;
  }
  const s = stats(eta);
  const nom = gain(net.X, net.kind, net.Rser, ZL, Zs);
  const res = { eta, zr, zi, eta_loss: el, eta_match: em, stats: s, nominal: nom, tol, N, sens: sensitivity(net, mult, eta) };
  if (o.target != null) { let c = 0; for (const e of eta) if (e >= o.target) c++; res.yield = c / N; }
  return res;
}

/** Monte Carlo over builds for a set of loads: every build is scored on all loads. */
export function mcSet(net, Zr, Zi, Zs, QL, QC, o) {
  const n = net.X.length, N = Math.max(20, Math.min(20000, Math.round(o.n ?? 2000)));
  const tol = tolVec(o.tol, n), rand = rng(o.seed ?? 12345);
  const pct = (o.pct ?? 5) / 100, ns = Zr.length, k = Math.floor(pct * ns);
  const mean = new Float64Array(N), pk = new Float64Array(N), mn = new Float64Array(N);
  const buf = new Float64Array(ns), Xo = new Array(n), m = new Array(n);
  const mult = Array.from({ length: n }, () => new Float32Array(N));
  for (let d = 0; d < N; d++) {
    const u = draw(rand, n, o.dist);
    for (let j = 0; j < n; j++) { m[j] = Math.max(1 + tol[j] / 100 * u[j], 1e-9); mult[j][d] = m[j]; }
    for (let j = 0; j < n; j++) Xo[j] = net.X[j] > 0 ? net.X[j] * m[j] : net.X[j] / m[j];
    etaMany(Xo, net.kind, Zr, Zi, Zs, QL, QC, buf);
    let s = 0;
    for (let i = 0; i < ns; i++) s += buf[i];
    mean[d] = s / ns;
    buf.sort();
    pk[d] = buf[k]; mn[d] = buf[0];
  }
  return { mean, pk, min: mn, stats: { mean: stats(mean), pk: stats(pk), min: stats(mn) }, tol, N, sens: sensitivity(net, mult, mean) };
}

function tolVec(t, n) {
  const a = Array.isArray(t) ? t.slice() : new Array(n).fill(t);
  if (a.length !== n) throw new Error(`Tolerance list needs ${n} entries.`);
  return a.map(v => Math.min(Math.max(v, 0), 99.9));
}

/** Correlation of each element's value with the efficiency, and its share. */
function sensitivity(net, mult, y) {
  const names = refdes(net.X, net.kind), N = y.length;
  let my = 0;
  for (const v of y) my += v;
  my /= N;
  let sy = 0;
  for (const v of y) sy += (v - my) ** 2;
  return names.map((name, k) => {
    const m = mult[k];
    let mx = 0;
    for (const v of m) mx += v;
    mx /= N;
    let sx = 0, sxy = 0;
    for (let d = 0; d < N; d++) { const a = m[d] - mx; sx += a * a; sxy += a * (y[d] - my); }
    return { name, r: sx > 0 && sy > 0 ? sxy / Math.sqrt(sx * sy) : 0 };
  });
}

/** Build-error combinations on a grid over +-1. 5 points per axis up to two
 *  elements as in mc_tolerance, then 3, then the corners. */
function comboGrid(n) {
  const pts = n <= 2 ? [-1, -0.5, 0, 0.5, 1] : n <= 5 ? [-1, 0, 1] : [-1, 1];
  let c = [[]];
  for (let k = 0; k < n; k++) {
    const nx = [];
    for (const r of c) for (const p of pts) nx.push(r.concat(p));
    c = nx;
    if (c.length > 4096) break;
  }
  return c;
}

/** Efficiency against tolerance: the worst build at each tolerance, as in
 *  mc_tolerance, with the half-efficiency tolerance by linear interpolation. */
export function tolSweep(net, Zr, Zi, Zs, QL, QC, o = {}) {
  const pct = (o.pct ?? 5) / 100, tmax = o.tmax ?? 15, nt = o.nt ?? 61;
  const n = net.X.length, ns = Zr.length, k = Math.floor(pct * ns);
  const combos = comboGrid(n).filter(c => c.length === n);
  const tol = new Float64Array(nt), mean = new Float64Array(nt), pk = new Float64Array(nt);
  const buf = new Float64Array(ns), X = new Array(n);
  for (let i = 0; i < nt; i++) {
    const t = tmax * i / (nt - 1) / 100;
    let wm = Infinity, wp = Infinity;
    for (const c of combos) {
      for (let j = 0; j < n; j++) {
        const f = 1 + t * c[j];
        X[j] = net.X[j] > 0 ? net.X[j] * f : net.X[j] / f;
      }
      etaMany(X, net.kind, Zr, Zi, Zs, QL, QC, buf);
      let s = 0;
      for (let q = 0; q < ns; q++) s += buf[q];
      if (s / ns < wm) wm = s / ns;
      buf.sort();
      if (buf[k] < wp) wp = buf[k];
    }
    tol[i] = 100 * t; mean[i] = wm; pk[i] = wp;
  }
  const half = y => {
    const h = 0.5 * y[0];
    for (let i = 1; i < y.length; i++) {
      if (y[i] <= h) return tol[i - 1] + (h - y[i - 1]) * (tol[i] - tol[i - 1]) / (y[i] - y[i - 1]);
    }
    return NaN;
  };
  return { tol, mean, pk, half_mean: half(mean), half_pk: half(pk), combos: combos.length };
}

export { cdiv, abcd };
