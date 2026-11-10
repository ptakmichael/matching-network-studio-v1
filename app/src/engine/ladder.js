// Finite ladders. Port of mn_ladder, mn_ladderspace and mn_lsection.
import { gainq, etaq, describe, esr, rng, etaMany } from './core.js';
import { fminsearch } from './nm.js';

const logOf = Math.log;
const asinh = Math.asinh, sinh = Math.sinh;

function kindOf(N, first) {
  const k = new Array(N);
  for (let i = 0; i < N; i++) k[i] = (i % 2 === 0) ? first : 3 - first;
  return k;
}
function signPattern(kind, lp) {
  const s = kind.map(k => (k === 1 ? 1 : -1));
  return lp ? s : s.map(v => -v);
}
const lpCode = topo => (topo === 'lowpass' ? 1 : topo === 'highpass' ? 0 : -1);

/** Best N-element ladder of a fixed topology (mn_ladder). */
export function ladder(N, ZL, Zs, QL, QC, topo, opt = {}) {
  const ntry = opt.ntry ?? 30, rand = opt.rand || rng(12345);
  const lp = lpCode(topo);
  const nmo = { tolX: 1e-10, tolF: 1e-13, maxEval: 6000, maxIter: 6000 };
  let s = { eta_tot: 0, X: [], kind: [], topo, order: '', desc: '', N };
  const absZ = [Math.abs(ZL[0]), Math.abs(Zs[0]), Math.abs(ZL[1]), Math.abs(Zs[1]), Math.sqrt(ZL[0] * Zs[0])];
  const scale = absZ.filter(v => v > 1e-9);
  const Xlo = Math.min(...scale) / 30, Xhi = Math.max(...scale) * 30;
  const Xc = Math.max(Math.abs(ZL[1]), Xlo), Xg = Math.max(Math.sqrt(ZL[0] * Zs[0]), Xlo);
  const lmin = logOf(Xlo), lrange = logOf(Xhi) - logOf(Xlo);
  const sr = Zs[0], si = Zs[1], zr = ZL[0], zi = ZL[1];

  // constrained answers seed the free search; computed once for both orders
  const seedsC = lp < 0
    ? ['lowpass', 'highpass'].map(tp => ladder(N, ZL, Zs, QL, QC, tp, { ntry: Math.max(4, Math.round(ntry / 6)), rand }))
    : [];

  for (const first of [1, 2]) {
    const kind = kindOf(N, first);
    const sgn = lp < 0 ? null : signPattern(kind, lp);
    const X = new Array(N);
    const unpack = lp < 0
      ? t => { for (let i = 0; i < N; i++) X[i] = Xlo * sinh(t[i]); return X; }
      : t => { for (let i = 0; i < N; i++) X[i] = sgn[i] * Math.exp(t[i]); return X; };
    const obj = t => {
      for (let i = 0; i < N; i++) if (!Number.isFinite(t[i])) return 0;
      unpack(t);
      for (let i = 0; i < N; i++) if (Math.abs(X[i]) < 1e-12) return 0;
      return -etaq(X, kind, zr, zi, sr, si, QL, QC);
    };
    const starts = [];
    if (lp < 0) {
      for (const b of [Xc, Xg, Math.sqrt(Xc * Xg)]) starts.push(new Array(N).fill(asinh(b / Xlo)));
      const a = Math.min(...scale), c = Math.max(...scale);
      starts.push(Array.from({ length: N }, (_, i) => asinh((N > 1 ? a + (c - a) * i / (N - 1) : c) / Xlo)));
      for (const sc of seedsC) {
        if (sc.X.length === N && sc.kind.every((v, i) => v === kind[i])) starts.push(sc.X.map(x => asinh(x / Xlo)));
      }
      for (let t = 0; t < ntry; t++) {
        starts.push(Array.from({ length: N }, () => {
          const m = lmin + lrange * rand();
          const g = rand() < 0.5 ? -1 : 1;
          return asinh(g * Math.exp(m) / Xlo);
        }));
      }
    } else {
      for (const b of [Xc, Xg, Math.sqrt(Xc * Xg)]) starts.push(new Array(N).fill(logOf(b)));
      const a = logOf(Math.max(Math.min(...scale), Xlo)), c = logOf(Math.max(...scale));
      starts.push(Array.from({ length: N }, (_, i) => (N > 1 ? a + (c - a) * i / (N - 1) : c)));
      for (let t = 0; t < ntry; t++) starts.push(Array.from({ length: N }, () => lmin + lrange * rand()));
    }
    for (const st of starts) {
      const r = fminsearch(obj, st, nmo);
      const Xr = unpack(r.x).slice();
      const e = etaq(Xr, kind, zr, zi, sr, si, QL, QC);
      if (Number.isFinite(e) && e > s.eta_tot) {
        s = { ...s, eta_tot: e, X: Xr, kind, order: first === 1 ? 'series-first' : 'shunt-first' };
      }
    }
  }
  if (s.eta_tot > 0) prune(s, ZL, Zs, QL, QC);
  return s;
}

/** Remove elements that do nothing, then merge neighbours of the same kind. */
function prune(s, ZL, Zs, QL, QC) {
  const tol = 1e-7;
  let changed = true;
  while (changed && s.X.length > 1) {
    changed = false;
    for (let k = 0; k < s.X.length; k++) {
      const Xk = s.X.filter((_, i) => i !== k), kk = s.kind.filter((_, i) => i !== k);
      if (Math.abs(gainq(Xk, kk, ZL, Zs, QL, QC).eta_tot - s.eta_tot) < tol) {
        s.X = Xk; s.kind = kk; changed = true; break;
      }
    }
  }
  mergeSame(s, QL, QC);
  const g = gainq(s.X, s.kind, ZL, Zs, QL, QC);
  Object.assign(s, g, { desc: describe(s.X, s.kind), Rser: esr(s.X, QL, QC) });
}

function mergeSame(s, QL, QC) {
  let k = 0;
  s.X = s.X.slice(); s.kind = s.kind.slice();
  while (k < s.X.length - 1) {
    if (s.kind[k] === s.kind[k + 1]) {
      const [a, b] = [s.X[k], s.X[k + 1]];
      const z1 = [Math.abs(a) / (a >= 0 ? QL : QC), a], z2 = [Math.abs(b) / (b >= 0 ? QL : QC), b];
      let xi;
      if (s.kind[k] === 1) xi = z1[1] + z2[1];
      else {
        const d1 = z1[0] ** 2 + z1[1] ** 2, d2 = z2[0] ** 2 + z2[1] ** 2;
        const yr = z1[0] / d1 + z2[0] / d2, yi = -z1[1] / d1 - z2[1] / d2;
        xi = -yi / (yr * yr + yi * yi);
      }
      s.X[k] = xi; s.X.splice(k + 1, 1); s.kind.splice(k + 1, 1);
    } else k++;
  }
}

/** mn_ladderspace: unconstrained search space of one ladder orientation. */
export function ladderSpace(N, topo, first, Zr, Zi, Zs) {
  const lp = lpCode(topo), kind = kindOf(N, first);
  const sc = [Math.abs(Zs[0]), Math.abs(Zs[1])];
  for (let i = 0; i < Zr.length; i++) sc.push(Math.abs(Zr[i]), Math.abs(Zi[i]), Math.sqrt(Zr[i] * Zs[0]));
  let lo = Infinity, hi = -Infinity;
  for (const v of sc) if (v > 1e-9) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const Xlo = lo / 30, Xhi = hi * 30, sgn = lp < 0 ? kind.map(() => 1) : signPattern(kind, lp);
  const unpack = (u, X = new Array(N)) => {
    if (lp < 0) for (let i = 0; i < N; i++) X[i] = Xlo * sinh(u[i]);
    else for (let i = 0; i < N; i++) X[i] = sgn[i] * Math.exp(u[i]);
    return X;
  };
  const pack = (X, kd) => {
    if (X.length > N || X.length !== kd.length) return null;
    const Xt = new Array(N);
    let j = 0;
    for (let i = 0; i < N; i++) {
      if (j < X.length && kd[j] === kind[i]) Xt[i] = X[j++];
      else if (kind[i] === 1) Xt[i] = Xlo * 1e-4;
      else Xt[i] = Xhi * 1e4;
    }
    if (j < X.length) return null;
    return lp < 0 ? Xt.map(x => asinh(x / Xlo)) : Xt.map(x => logOf(Math.max(Math.abs(x), 1e-12)));
  };
  const random = rand => Array.from({ length: N }, () => {
    const m = logOf(Xlo) + (logOf(Xhi) - logOf(Xlo)) * rand();
    if (lp < 0) return asinh((rand() < 0.5 ? -1 : 1) * Math.exp(m) / Xlo);
    return m;
  });
  return { N, first, kind, Xlo, Xhi, unpack, pack, random };
}

/** Prune for a set of loads: remove an element only if nothing changes at any load. */
export function pruneSet(Xin, kindIn, Zr, Zi, Zs, QL, QC) {
  const tol = 1e-7;
  let X = Xin.slice(), kind = kindIn.slice();
  const e0 = etaMany(X, kind, Zr, Zi, Zs, QL, QC).slice();
  const same = (A, B) => {
    const e = etaMany(A, B, Zr, Zi, Zs, QL, QC);
    for (let i = 0; i < e.length; i++) if (Math.abs(e[i] - e0[i]) >= tol) return false;
    return true;
  };
  let changed = true;
  while (changed && X.length > 1) {
    changed = false;
    for (let k = 0; k < X.length; k++) {
      const Xk = X.filter((_, i) => i !== k), kk = kind.filter((_, i) => i !== k);
      if (same(Xk, kk)) { X = Xk; kind = kk; changed = true; break; }
    }
  }
  const s = { X, kind };
  mergeSame(s, QL, QC);
  if (s.X.length !== X.length && same(s.X, s.kind)) return s;
  return { X, kind };
}

// -------------------------------------------------------------- mn_lsection
function ze(x, QL, QC) { return [Math.abs(x) / (x >= 0 ? QL : QC), x]; }
const cm = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cinv = a => { const d = a[0] * a[0] + a[1] * a[1]; return [a[0] / d, -a[1] / d]; };
const cconj = a => [a[0], -a[1]];
const cadd = (a, b) => [a[0] + b[0], a[1] + b[1]];
const csub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cabs2 = a => a[0] * a[0] + a[1] * a[1];

/** Exact two-element section from Z0 to Z2, in closed form. */
export const lsig = n => n.kind.join('') + n.X.map(x => (x > 0 ? 'L' : 'C')).join('');

export function lsection(Z0, Z2, QL, QC, want) {
  let best = -1, out = null;
  for (const sk of 'LC') {
    const Ay = sk === 'L' ? [1 / QL, -1] : [1 / QC, 1];
    for (const ek of 'LC') {
      const Dz = ek === 'L' ? [1 / QL, 1] : [1 / QC, -1];
      for (const order of [1, 2]) {
        const c = order === 1 ? cm(cinv(Z0), cconj(Ay))[1] : cm(cinv(Z2), cconj(Ay))[1];
        const dz2 = cabs2(Dz), AD = cm(Ay, Dz)[1];
        const co = order === 1
          ? [c * dz2, -(2 * c * cm(Z2, cconj(Dz))[0] + AD), c * cabs2(Z2) + cm(Ay, Z2)[1]]
          : [c * dz2, AD + 2 * c * cm(Z0, cconj(Dz))[0], cm(Ay, Z0)[1] + c * cabs2(Z0)];
        let rts = [];
        if (Math.abs(co[0]) > 1e-300) {
          const D = co[1] * co[1] - 4 * co[0] * co[2];
          if (D >= 0) {
            const q = -0.5 * (co[1] + (co[1] >= 0 ? 1 : -1) * Math.sqrt(D));
            rts = [q / co[0], co[2] / q];
          }
        } else if (Math.abs(co[1]) > 1e-300) rts = [-co[2] / co[1]];
        for (const u of rts) {
          if (!(u > 0)) continue;
          const uD = [u * Dz[0], u * Dz[1]];
          const Zm = order === 1 ? csub(Z2, uD) : cadd(Z0, uD);
          const num = order === 1 ? csub(cinv(Zm), cinv(Z0)) : csub(cinv(Z2), cinv(Zm));
          const t_ = cm(num, cinv(Ay));
          if (Math.abs(t_[1]) > 1e-7 * Math.max(1, Math.hypot(t_[0], t_[1])) || t_[0] <= 0) continue;
          const t = t_[0];
          const Xp = sk === 'L' ? 1 / (t * (1 + 1 / (QL * QL))) : -1 / (t * (1 + 1 / (QC * QC)));
          const Xs = ek === 'L' ? u : -u;
          const vv = order === 1 ? [Xp, Xs] : [Xs, Xp];
          const kk = order === 1 ? [2, 1] : [1, 2];
          let Zc = Z0;
          for (let n = 0; n < 2; n++) {
            const Ze = ze(vv[n], QL, QC);
            Zc = kk[n] === 1 ? cadd(Zc, Ze) : cinv(cadd(cinv(Zc), cinv(Ze)));
          }
          if (Math.hypot(Zc[0] - Z2[0], Zc[1] - Z2[1]) > 1e-9 * Math.hypot(Z2[0], Z2[1])) continue;
          const g = gainq(vv, kk, Z0, [Zc[0], -Zc[1]], QL, QC);
          const e = g.eta_loss;
          if (want && lsig({ X: vv, kind: kk }) !== want) continue;
          if (e > 0 && e <= 1 + 1e-12 && e > best) { best = e; out = { X: vv, kind: kk, eta_loss: e }; }
        }
      }
    }
  }
  return out;
}
