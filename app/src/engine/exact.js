// Closed forms. Port of mn_exact, mn_exact_opt and mn_bound.
import { fminsearch } from './nm.js';

const pieces = (a, c) => {
  const d = (a - c) / (a * c + 1), s = Math.sqrt(1 + d * d);
  return {
    a, c, tu: -1 / a, td: 1 / c, qp: d + s, qm: d - s,
    kmin: (a + c) / Math.sqrt((a * a + 1) * (c * c + 1)),
  };
};
const Wu = (P, t) => -Math.log(P.a - t);
const Wd = (P, t) => Math.log(P.c + t);
const Ph = t => Math.log(1 + t * t);

function up_max(P, x, y) {
  const cut = P.tu > x && P.tu < y;
  const seg = (p, q) => {
    const lw = Wu(P, q) - Wu(P, p);
    return 0.5 * (p + q) >= P.tu ? lw : -lw - (Ph(q) - Ph(p));
  };
  return cut ? seg(x, P.tu) + seg(P.tu, y) : seg(x, y);
}
function up_min(P, x, y) {
  const cut = P.tu > x && P.tu < y;
  const seg = (p, q) => {
    const lw = Wu(P, q) - Wu(P, p);
    return 0.5 * (p + q) >= P.tu ? -lw - (Ph(q) - Ph(p)) : lw;
  };
  return cut ? seg(x, P.tu) + seg(P.tu, y) : seg(x, y);
}
function dn_max(P, x, y) {
  const cut = P.td > x && P.td < y;
  const seg = (p, q) => {
    const lw = Wd(P, q) - Wd(P, p);
    return 0.5 * (p + q) <= P.td ? lw : -lw + (Ph(q) - Ph(p));
  };
  return cut ? seg(x, P.td) + seg(P.td, y) : seg(x, y);
}
function dn_min(P, x, y) {
  const cut = P.td > x && P.td < y;
  const seg = (p, q) => {
    const lw = Wd(P, q) - Wd(P, p);
    return 0.5 * (p + q) <= P.td ? -lw + (Ph(q) - Ph(p)) : lw;
  };
  return cut ? seg(x, P.td) + seg(P.td, y) : seg(x, y);
}
const pair_loss = (P, x, y) => (Wu(P, y) - Wu(P, x)) + (Wd(P, y) - Wd(P, x));
const pair_gain = (P, x, y) => up_max(P, x, y) + dn_max(P, x, y);

function rho(P, t) {
  const wu = 1 / (P.a - t), wd = 1 / (P.c + t), ph = 2 * t / (1 + t * t);
  const mu = t >= P.tu ? wu : -wu - ph;
  const md = t <= P.td ? wd : -wd + ph;
  return (mu + md) / (wu + wd);
}
function anti(P, k, t) {
  const A = -Math.log(P.a - t), B = Math.log(P.c + t), F = Math.log(1 + t * t);
  if (k === 0) return -A - F + B;
  if (k === 1) return A + B;
  return A - B + F;
}
function solve_closed(P, x, g, up) {
  const a = P.a, c = P.c, edges = [-c, P.tu, P.td, a];
  let cur = x, acc = 0;
  let k = up ? (x >= P.tu) + (x >= P.td) : (x > P.tu) + (x > P.td);
  for (;;) {
    const e = up ? edges[k + 1] : edges[k];
    const seg = up ? pair_gain(P, cur, e) : pair_gain(P, e, cur);
    if (!Number.isFinite(seg) || acc + seg >= g) {
      const need = g - acc;
      const K = up ? anti(P, k, cur) + need : anti(P, k, cur) - need;
      const eK = Math.exp(K);
      if (k === 1) return (a * eK - c) / (1 + eK);
      let A2, B2, C2;
      if (k === 2) { A2 = 1 + eK; B2 = -eK * (a - c); C2 = 1 - eK * a * c; }
      else { A2 = 1 + eK; B2 = -(a - c); C2 = eK - a * c; }
      const dsc = Math.sqrt(Math.max(B2 * B2 - 4 * A2 * C2, 0));
      const rts = [(-B2 + dsc) / (2 * A2), (-B2 - dsc) / (2 * A2)];
      const lo_ = Math.min(cur, e), hi_ = Math.max(cur, e);
      let okr = rts.filter(r => r >= lo_ - 1e-9 && r <= hi_ + 1e-9);
      if (!okr.length) okr = rts;
      let M = okr[0];
      for (const r of okr) if (Math.abs(r - cur) < Math.abs(M - cur)) M = r;
      return M;
    }
    acc += seg; cur = e;
    k += up ? 1 : -1;
  }
}

/** mn_exact for one termination. Returns the supremum of eta_loss, and the
 *  name of the structure of the optimum when info is requested. */
export function exact(zlr, zli, zr, zi, QL, QC, info) {
  const P = pieces(QL, QC), a = QL, c = QC;
  const t0 = zli / zlr, t1 = zi / zr;
  if (info) { info.case = 'unreachable'; }
  const inside = (-c < t1) && (t1 < a);
  const between = (t0 >= a && a <= t1 && t1 < t0) || (t0 <= -c && t0 < t1 && t1 <= -c);
  if (!(inside || between) || zr <= 0) return 0;
  const U = Math.log(zr / zlr);
  const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
  let F0, Umax, Umin;
  if (t1 >= t0) {
    F0 = Math.log((a - t0) / (a - t1)); Umax = up_max(P, t0, t1); Umin = up_min(P, t0, t1);
  } else {
    F0 = Math.log((c + t0) / (c + t1)); Umax = dn_max(P, t1, t0); Umin = dn_min(P, t1, t0);
  }
  if (U >= Umin - 1e-15 && U <= Umax + 1e-15) {
    if (info) info.case = 'single type';
    return Math.exp(-F0);
  }
  if (between) return 0;
  const delta = U > Umax ? U - Umax : Umin - U;
  let best = Infinity, name = '';
  const take = (v, nm) => { if (v < best) { best = v; name = nm; } };
  // (i) pairs at the best level inside [lo, hi]
  const c1 = Math.min(Math.max(P.qp, lo), hi), c2 = Math.min(Math.max(P.qm, lo), hi);
  const r1 = rho(P, c1), r2 = rho(P, c2);
  const rb = Number.isNaN(r2) || r1 >= r2 ? r1 : r2;
  take(delta / rb, 'pairs');
  // (ii) extend upward to the first peak above hi
  if (hi < a) {
    const pk = [P.qm, P.qp].sort((p, q) => p - q).filter(v => v > hi);
    if (pk.length) {
      const T = pk[0], Gq = pair_gain(P, hi, T);
      if (Gq >= delta) {
        const M = solve_closed(P, hi, delta, true);
        take(pair_loss(P, hi, M), 'extend up');
      } else take(pair_loss(P, hi, T) + (delta - Gq) * P.kmin, 'extend up and ride');
    }
  }
  // (iii) extend downward to the first peak below lo
  if (lo > -c) {
    const pk = [P.qm, P.qp].sort((p, q) => q - p).filter(v => v < lo);
    if (pk.length) {
      const T = pk[0], Gq = pair_gain(P, T, lo);
      if (Gq >= delta) {
        const m = solve_closed(P, lo, delta, false);
        take(pair_loss(P, m, lo), 'extend down');
      } else take(pair_loss(P, T, lo) + (delta - Gq) * P.kmin, 'extend down and ride');
    }
  }
  if (info) info.case = name;
  return Math.exp(-(F0 + best));
}

const totAt = (ZL, Zs, QL, QC, r, x) => {
  const ar = r + Zs[0], ai = x + Zs[1];
  return exact(ZL[0], ZL[1], r, x, QL, QC) * 4 * r * Zs[0] / (ar * ar + ai * ai);
};

/** mn_exact_opt: best termination and best eta_tot for any ladder. */
export function exactOpt(ZL, Zs, QL, QC) {
  const f = p => { const r = Math.exp(p[0]); return -totAt(ZL, Zs, QL, QC, r, r * Math.tan(p[1])); };
  const l0 = -Math.atan(QC) * 0.999, l1 = Math.atan(QL) * 0.999;
  let best = -Infinity, p0 = null;
  for (let i = 0; i < 41; i++) {
    const u = Math.log(Zs[0]) - 2.5 + 5 * i / 40;
    for (let j = 0; j < 41; j++) {
      const th = l0 + (l1 - l0) * j / 40;
      const v = -f([u, th]);
      if (v > best) { best = v; p0 = [u, th]; }
    }
  }
  const starts = [p0, [Math.log(ZL[0]), Math.atan(ZL[1] / ZL[0])], [Math.log(Zs[0]), Math.atan(-Zs[1] / Zs[0])]];
  let Zopt = ZL.slice(), eta_tot = totAt(ZL, Zs, QL, QC, ZL[0], ZL[1]);
  const o = { tolX: 1e-9, tolF: 1e-12, maxEval: 4000, maxIter: 4000 };
  for (const s of starts) {
    const r = fminsearch(f, s, o);
    if (-r.f > eta_tot) {
      eta_tot = -r.f;
      const R = Math.exp(r.x[0]);
      Zopt = [R, R * Math.tan(r.x[1])];
    }
  }
  const info = {};
  const eta_loss = exact(ZL[0], ZL[1], Zopt[0], Zopt[1], QL, QC, info);
  const ar = Zopt[0] + Zs[0], ai = Zopt[1] + Zs[1];
  return { eta_tot, Zin: Zopt, eta_loss, eta_match: 4 * Zopt[0] * Zs[0] / (ar * ar + ai * ai), case: info.case };
}

// ------------------------------------------------------------------ mn_bound
function cumtables(tt, QL, QC, a) {
  const n = tt.length, H = new Float64Array(n), L = new Float64Array(n);
  const Hb = new Float64Array(n), Lb = new Float64Array(n);
  const hi = new Float64Array(n), lo = new Float64Array(n), hb = new Float64Array(n), lb = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const q = Math.tan(tt[i]);
    // Z = 1 + jq, Z^2 = (1 - q^2) + j 2q
    const z2r = 1 - q * q, z2i = 2 * q;
    const m = [
      [1 / QL, 1, 1 / QL],
      [1 / QC, -1, 1 / QC],
      [-(z2r / QC - z2i), -(z2r + z2i / QC), (1 + q * q) / QC],
      [-(z2r / QL + z2i), -(z2i / QL - z2r), (1 + q * q) / QL],
    ];
    let h = Infinity, l = -Infinity;
    for (const [er, ei, K] of m) {
      const VU = er / K;
      // imag(E / Z) / K with Z = 1 + jq
      const d = 1 + q * q, VT = ((ei - er * q) / d) / K;
      const r = (1 - a * VU) / VT;
      if (VT > 1e-14) h = Math.min(h, r);
      else if (VT < -1e-14) l = Math.max(l, r);
    }
    hb[i] = Number.isFinite(h) ? 0 : 1;
    lb[i] = Number.isFinite(l) ? 0 : 1;
    hi[i] = hb[i] ? 0 : h;
    lo[i] = lb[i] ? 0 : l;
  }
  for (let i = 1; i < n; i++) {
    const dt = 0.5 * (tt[i] - tt[i - 1]);
    H[i] = H[i - 1] + dt * (hi[i] + hi[i - 1]);
    L[i] = L[i - 1] + dt * (lo[i] + lo[i - 1]);
    Hb[i] = Hb[i - 1] + dt * (hb[i] + hb[i - 1]);
    Lb[i] = Lb[i - 1] + dt * (lb[i] + lb[i - 1]);
  }
  return { H, L, Hb, Lb };
}

function interp(tt, T, x) {
  const n = tt.length, t0 = tt[0], dt = (tt[n - 1] - t0) / (n - 1);
  const s = (x - t0) / dt;
  if (s < -1e-9 || s > n - 1 + 1e-9) return NaN;
  const i = Math.max(0, Math.min(n - 2, Math.floor(s))), f = s - i;
  return T[i] + f * (T[i + 1] - T[i]);
}

/** mn_bound for arrays of terminations. Returns eta_max and flag. */
export function bound(QL, QC, ZL, Zr, Zi, npts = 4001) {
  const n = Zr.length;
  const km = (QC + QL) / Math.sqrt((QC * QC + 1) * (QL * QL + 1));
  const t0 = Math.atan(ZL[1] / ZL[0]), u0 = Math.log(ZL[0]);
  let m = Math.abs(t0);
  const t1 = new Float64Array(n);
  for (let i = 0; i < n; i++) { t1[i] = Math.atan(Zi[i] / Zr[i]); m = Math.max(m, Math.abs(t1[i])); }
  // the table must reach the load angle: a load with X/R beyond about 1,300 sits past 1.5705 rad
  const tmax = m > 1.5705 ? Math.min(Math.PI / 2 - 1e-12, m + 1e-9) : Math.min(1.5705, m + 0.02);
  const tt = new Float64Array(npts);
  for (let i = 0; i < npts; i++) tt[i] = -tmax + 2 * tmax * i / (npts - 1);
  const P = cumtables(tt, QL, QC, +km), M = cumtables(tt, QL, QC, -km);
  const eta = new Float64Array(n), flag = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    const up = Zr[i] >= ZL[0], T = up ? P : M, a = up ? km : -km;
    const rise = t1[i] >= t0;
    const Tv = rise ? T.H : T.L, Tb = rise ? T.Hb : T.Lb;
    const ends = interp(tt, Tv, t1[i]) - interp(tt, Tv, t0);
    const bad = interp(tt, Tb, t1[i]) - interp(tt, Tb, t0);
    let f = 0;
    if (bad > 1e-12) f = rise ? 1 : -1;
    flag[i] = f;
    const cost = a * (Math.log(Zr[i]) - u0) + ends;
    eta[i] = f > 0 ? 0 : f < 0 ? 1 : Math.min(1, Math.exp(-cost));
  }
  // Checked against simulated ladders: the bound holds while the load's X/R is below the Q
  // of the elements that cancel its reactance (Q_C for an inductive load, Q_L for a
  // capacitive one) and fails beyond it. It is not reported there.
  const tq = ZL[1] / ZL[0], valid = tq >= 0 ? tq < QC : -tq < QL;
  if (!valid) eta.fill(NaN);
  return { eta_max: eta, flag, kappa_min: km, valid };
}

/** The exact-ceiling scan of mn_solve: best bound * match over the termination. */
export function ceilingScan(ZL, Zs, QL, QC) {
  const Rlo = Math.min(ZL[0], Zs[0]) / 40, Rhi = Math.max(ZL[0], Zs[0]) * 40;
  const lin = (a, b, k) => Array.from({ length: k }, (_, i) => a + (b - a) * i / (k - 1));
  let u = lin(Math.log(Rlo), Math.log(Rhi), 61), th = lin(-1.5, 1.5, 61);
  let bestV = -Infinity, Zc = null, el = 0, du = 0, dt = 0;
  const tq = ZL[1] / ZL[0];
  if (!(tq >= 0 ? tq < QC : -tq < QL)) return { eta_tot: NaN, Zin: [NaN, NaN], eta_loss: NaN, valid: false };
  for (let pass = 1; pass <= 5; pass++) {
    const Zr = new Float64Array(u.length * th.length), Zi = new Float64Array(Zr.length);
    let q = 0;
    for (const a of u) for (const b of th) { const R = Math.exp(a); Zr[q] = R; Zi[q] = R * Math.tan(b); q++; }
    const b = bound(QL, QC, ZL, Zr, Zi);
    for (let i = 0; i < q; i++) {
      const ar = Zr[i] + Zs[0], ai = Zi[i] + Zs[1];
      const v = b.eta_max[i] * 4 * Zr[i] * Zs[0] / (ar * ar + ai * ai);
      if (v > bestV) { bestV = v; Zc = [Zr[i], Zi[i]]; el = b.eta_max[i]; }
    }
    if (pass === 1) { du = (u[u.length - 1] - u[0]) / 12; dt = (th[th.length - 1] - th[0]) / 12; }
    else { du /= 5; dt /= 5; }
    const uc = Math.log(Zc[0]), tc = Math.atan(Zc[1] / Zc[0]);
    u = lin(uc - du, uc + du, 21);
    th = lin(tc - dt, tc + dt, 21).map(v => Math.max(-1.5, Math.min(1.5, v)));
  }
  return { eta_tot: bestV, Zin: Zc, eta_loss: el, valid: true };
}

// building blocks, for the closed-form optimum in zopt.js
export { pieces, up_max, up_min, dn_max, dn_min, pair_gain };
