// One matching problem: closed forms, ladders, and the geodesic.
import { gain, gainq, esr, metrics, comps, nrange, rng, describe } from './core.js';
import { exact, ceilingScan, bound } from './exact.js';
import { ladder } from './ladder.js';
import { geo, geoAt } from './geo.js';
import { zopt } from './zopt.js';

export const TOPO_SHORT = { lowpass: 'LP', highpass: 'HP', free: 'FR' };
export const TOPO_NAME = { lowpass: 'Low-pass', highpass: 'High-pass', free: 'Unconstrained' };

export function validateProblem(p) {
  if (!(p.ZL[0] > 0)) throw new Error('Load resistance must be above 0 Ω.');
  if (!(p.Zs[0] > 0)) throw new Error('Source resistance must be above 0 Ω.');
  if (!(p.QL > 0) || !(p.QC > 0)) throw new Error('Component Q must be above 0.');
  if (!(p.f0 > 0)) throw new Error('Frequency must be above 0.');
}

/** Closed-form results, which do not depend on N. */
export function closedForm(p) {
  const { ZL, Zs, QL, QC } = p;
  const m = metrics(QL, QC, ZL, Zs);
  const opt = zopt(ZL, Zs, QL, QC);
  const ceil = ceilingScan(ZL, Zs, QL, QC);
  const conj = exact(ZL[0], ZL[1], Zs[0], -Zs[1], QL, QC);
  const ar = ZL[0] + Zs[0], ai = ZL[1] + Zs[1];
  return { m, opt, ceil, conj, direct: 4 * ZL[0] * Zs[0] / (ar * ar + ai * ai) };
}

/** Every ladder for the requested element counts. */
export function designs(p, onOne) {
  const Ns = nrange(p.N);
  const tl = p.topo === 'all' ? ['lowpass', 'highpass', 'free'] : [p.topo];
  const out = [], rand = rng(p.seed ?? 12345);
  let done = 0;
  for (const N of Ns) for (const t of tl) {
    const s = ladder(N, p.ZL, p.Zs, p.QL, p.QC, t, { ntry: p.ntry ?? 30, rand });
    done++;
    if (s.X.length) {
      const d = describeNet(s, p, { N_req: N, topo: t, key: `N${N} ${TOPO_SHORT[t]}` });
      out.push(d);
      if (onOne) onOne(d, done / (Ns.length * tl.length));
    }
  }
  return out;
}

export function describeNet(s, p, extra) {
  const Rser = s.Rser || esr(s.X, p.QL, p.QC);
  const g = gain(s.X, s.kind, Rser, p.ZL, p.Zs);
  const cl = exact(p.ZL[0], p.ZL[1], g.Zin[0], g.Zin[1], p.QL, p.QC);
  const b = bound(p.QL, p.QC, p.ZL, Float64Array.of(g.Zin[0]), Float64Array.of(g.Zin[1]));
  return {
    X: s.X, kind: s.kind, Rser, order: s.order, desc: describe(s.X, s.kind),
    ...g, closed_loss: cl, bound_loss: b.eta_max[0], comps: comps(s.X, s.kind, Rser, p.f0),
    ZL: p.ZL, ...extra,
  };
}

/** The geodesic, and the comparison of its field with the closed form. */
export function geodesic(p) {
  const { ZL, Zs, QL, QC } = p;
  const g = geo(ZL, Zs, QL, QC, { nu: p.geo_n ?? 241, nt: p.geo_t ?? 201, ring: 2, nmag: p.nmag ?? 60 });
  // compare the field with mn_exact at every reached node; a regular subset is
  // kept for plotting
  const cf = [], nu = [], dz = [], zs = [];
  const su = Math.max(1, Math.floor(g.nu / 24)), st = Math.max(1, Math.floor(g.nt / 24));
  const all = [];
  let rms = 0, worst = 0, over = -Infinity;
  for (let b = 0; b < g.nt; b++) for (let a = 0; a < g.nu; a++) {
    const i = a + g.nu * b, el = g.eta_loss[i];
    if (!(el > 1e-6) || !Number.isFinite(el)) continue;
    const c = exact(ZL[0], ZL[1], g.Rn[i], g.Xn[i], QL, QC);
    if (!(c > 1e-6)) continue;
    const d = el - c;
    all.push(Math.abs(d));
    rms += d * d; worst = Math.max(worst, Math.abs(d)); over = Math.max(over, d);
    if (a % su === 0 && b % st === 0) { cf.push(c); nu.push(el); zs.push([g.Rn[i], g.Xn[i]]); dz.push(d); }
  }
  const nodesCompared = all.length;
  rms = Math.sqrt(rms / Math.max(nodesCompared, 1));
  all.sort((p, q) => p - q);
  const median = all[Math.floor(all.length / 2)] ?? NaN;
  // node positions for drawing the grid, at most about 20,000 of them
  const stride = Math.max(1, Math.ceil(Math.sqrt(g.nu * g.nt / 20000)));
  const gR = [], gX = [];
  for (let b = 0; b < g.nt; b += stride) for (let a = 0; a < g.nu; a += stride) { const i = a + g.nu * b; gR.push(g.Rn[i]); gX.push(g.Xn[i]); }
  return {
    gridR: Float32Array.from(gR), gridX: Float32Array.from(gX), stride, counts: g.X ? elementCounts(g.X, g.kind) : null,
    nodes: g.nodes, edges: g.edges,
    eta_tot_opt: g.eta_tot_opt, Zin_opt: g.Zin_opt, eta_loss_opt: g.eta_loss_opt,
    eta_exact: g.eta_exact, Zin_exact: g.Zin_exact, path: g.path, nparts: g.X ? g.X.length : 0,
    X: g.X, kind: g.kind, Rser: g.Rser,
    target_loss: g.eta_loss_target, target_node: g.Z_target_node,
    closed: cf, numeric: nu, Z: zs, rms, worst, over, median, samples: dz.length, nodesCompared, nu: g.nu, nt: g.nt,
  };
}

/** Lightweight grid-refinement point: the optimum, and the size of its realised chain. */
export function geoLevel(p, nu, nt) {
  const g = geo(p.ZL, p.Zs, p.QL, p.QC, { nu, nt, ring: 2, nmag: p.nmag ?? 60 });
  return { nu, nt, nodes: g.nodes, eta_tot_opt: g.eta_tot_opt, eta_exact: g.eta_exact, nparts: g.X ? g.X.length : 0, counts: g.X ? elementCounts(g.X, g.kind) : null };
}

/** Elements of a chain by type: series L, series C, shunt L, shunt C. */
export function elementCounts(X, kind) {
  const c = { sL: 0, sC: 0, pL: 0, pC: 0 };
  for (let k = 0; k < X.length; k++) c[(kind[k] === 1 ? 's' : 'p') + (X[k] > 0 ? 'L' : 'C')]++;
  return c;
}

/** Points per axis of the Dijkstra grid in ln R for a given chart grid; the angle axis has 83 % of it. */
export const geoGrid = n => [n, Math.max(11, Math.round(0.83 * n))];

export { gainq, geoAt };
