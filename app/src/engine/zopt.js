// Closed-form optimal termination Z_opt for any lossy L/C ladder.
//
// eta_tot(Z) = exp(-C(Z_L -> Z)) * eta_match(Z), C from mn_exact. With Gamma' = (Z - Zs)/(Z + Zs):
//   d/d(ln R): Re Gamma' = -lambda            (lambda = dC/d ln R: 0, +-kappa_min, or 1/rho(M))
//   d/dt     : Im Gamma' = (1 - lambda) t + (1 + t^2) dC/dt
// so on every smooth piece of C the optimum is Z = Zs (1 + Gamma')/(1 - Gamma') with t a root of an
// explicit rational equation, or, on a band edge, a linear formula. Every candidate is scored with the
// exact eta_loss, and the best is returned.
import { exact, pieces, up_max, up_min, dn_max, dn_min, pair_gain } from './exact.js';

const GR = 0.6180339887498949;

export function zopt(ZL, Zs, QL, QC, opt = {}) {
  const a = QL, c = QC, P = pieces(a, c), k = P.kmin;
  const RL = ZL[0], XL = ZL[1], t0 = XL / RL, Rs = Zs[0], Xs = Zs[1];
  const tu = P.tu, td = P.td, qm = Math.min(P.qm, P.qp), qp = Math.max(P.qm, P.qp);
  const dth = opt.dth || 0.06, NM = opt.nm || 5, NG = opt.ng || 32;
  // Candidates within TIE of the best are equal for every purpose; among them the
  // simplest structure is reported, so the network type does not flicker between
  // structures that differ only by rounding.
  const TIE = opt.tie ?? 1e-10;
  const rank = (cs, R, x) => (Math.abs(R - RL) <= 1e-12 * RL && Math.abs(x - XL) <= 1e-12 * (RL + Math.abs(XL)) ? 0 : cs === 'single type' ? 1 : cs === 'pairs' || /ride/.test(cs) ? 2 : 3);
  let best = { eta_tot: -1, rank: 9 };
  const consider = (R, t, fam) => {
    if (!(R > 0) || !Number.isFinite(R) || !Number.isFinite(t)) return;
    const x = R * t, info = {}, el = exact(RL, XL, R, x, a, c, info);
    if (!(el > 0)) return;
    const ar = R + Rs, ai = x + Xs, em = 4 * R * Rs / (ar * ar + ai * ai), e = el * em, rk = rank(info.case, R, x);
    if (e > best.eta_tot + TIE || (e > best.eta_tot - TIE && rk < best.rank) || (Math.abs(e - best.eta_tot) <= TIE && rk === best.rank && e > best.eta_tot)) {
      best = { eta_tot: e, Zin: [R, x], eta_loss: el, eta_match: em, case: info.case, family: fam, rank: rk };
    }
  };
  const match = (R, t) => { const ar = R + Rs, ai = R * t + Xs; return 4 * R * Rs / (ar * ar + ai * ai); };

  // densities (derivatives of the mn_exact building blocks)
  const su = t => 1 / (a - t), hu = t => -1 / (a - t) - 2 * t / (1 + t * t);
  const sd = t => 1 / (c + t), hd = t => -1 / (c + t) + 2 * t / (1 + t * t);
  const muP = t => t >= tu ? su(t) : hu(t), muM = t => t >= tu ? hu(t) : su(t);
  const mdP = t => t <= td ? sd(t) : hd(t), mdM = t => t <= td ? hd(t) : sd(t);
  const ell = t => 1 / (a - t) + 1 / (c + t), gd = t => muP(t) + mdP(t);
  const F0d = t => t >= t0 ? 1 / (a - t) : -1 / (c + t);
  const Ued = (t, sg) => t >= t0 ? (sg > 0 ? up_max(P, t0, t) : up_min(P, t0, t)) : (sg > 0 ? dn_max(P, t, t0) : dn_min(P, t, t0));
  const dUed = (t, sg) => t >= t0 ? (sg > 0 ? muP(t) : muM(t)) : (sg > 0 ? -mdP(t) : -mdM(t));

  // ---- free ln R: roots of h(t) = Im Z - t Re Z for Gamma' = -lam + j y(t)
  const freeU = (lam, dC, A, B, fam) => {
    const x = -lam;
    const y = t => (1 - lam) * t + (1 + t * t) * dC(t);
    const h = t => { const yy = y(t), r = 1 - x * x - yy * yy; return (Xs * r + 2 * yy * Rs - t * (Rs * r - 2 * yy * Xs)) * (a - t) * (c + t); };
    const emit = t => {
      const yy = y(t), den = (1 - x) * (1 - x) + yy * yy, gr = (1 - x * x - yy * yy) / den, gi = 2 * yy / den;
      consider(Rs * gr - Xs * gi, t, fam);
    };
    const q0 = Math.atan(A), q1 = Math.atan(B), n = Math.max(2, Math.ceil((q1 - q0) / dth));
    const at = i => i === 0 ? A + 1e-13 * (B - A) * (1 + Math.abs(A)) : i === n ? B - 1e-13 * (B - A) * (1 + Math.abs(B)) : Math.tan(q0 + (q1 - q0) * i / n);
    let tp = at(0), hp = h(tp);
    for (let i = 1; i <= n; i++) {
      const tn = at(i), hn = h(tn);
      if (hp === 0) emit(tp);
      else if (hp * hn < 0) {                      // Illinois
        let x0 = tp, x1 = tn, f0 = hp, f1 = hn, side = 0;
        for (let it = 0; it < 60; it++) {
          const xm = (x0 * f1 - x1 * f0) / (f1 - f0), fm = h(xm);
          if (fm * f1 < 0) { x0 = x1; f0 = f1; if (side === -1) f0 *= 0.5; side = -1; }
          else { if (side === 1) f0 *= 0.5; side = 1; }
          x1 = xm; f1 = fm;
          if (fm === 0 || Math.abs(x1 - x0) < 1e-14 * (1 + Math.abs(x1))) break;
        }
        emit(x1);
      }
      tp = tn; hp = hn;
    }
  };

  // ---- maximum of eta = L(t)^2 / D(t) along R = K/L (series) or K L/(1+t^2) (shunt)
  const curve = (series, K, al, be, A, B) => {
    let p0, p1, q0, q1;
    if (series) { p0 = K + Rs * al; p1 = Rs * be; q0 = Xs * al; q1 = K + Xs * be; }
    else { p0 = K * al + Rs; p1 = K * be + Xs; q0 = Xs; q1 = -Rs; }
    const d2 = p1 * p1 + q1 * q1, d1 = 2 * (p0 * p1 + q0 * q1), d0 = p0 * p0 + q0 * q0;
    const den = be * d1 - 2 * al * d2;
    const t = den !== 0 ? (al * d1 - 2 * be * d0) / den : NaN;
    return t > A && t < B ? t : NaN;
  };
  const Rof = (series, K, al, be, t) => series ? K / (al + be * t) : K * (al + be * t) / (1 + t * t);
  // form of R(t) on a piece, from d ln R/dt: series gives -be/L
  const isSeries = (dU, al, be, t) => Math.abs(dU + be / (al + be * t)) < Math.abs(dU - be / (al + be * t) + 2 * t / (1 + t * t));

  consider(RL, t0, 'no network');
  const brk = [t0, tu, td, qm, qp].filter(v => v > -c && v < a);
  const nodes = [...new Set([-c, ...brk, a])].sort((x, y) => x - y);
  const ivs = [];
  for (let i = 0; i + 1 < nodes.length; i++) ivs.push([nodes[i], nodes[i + 1], true]);
  if (t0 >= a) ivs.push([a, t0, false]);
  if (t0 <= -c) ivs.push([t0, -c, false]);

  for (const [A, B, ins] of ivs) {
    const tm = 0.5 * (A + B), up = tm >= t0, al = up ? a : c, be = up ? -1 : 1;
    freeU(0, F0d, A, B, 'single type');
    for (const sg of [1, -1]) {
      // band edge, single type
      const dU = dUed(tm, sg), ser = isSeries(dU, al, be, tm), Rm = RL * Math.exp(Ued(tm, sg));
      const K = ser ? Rm * (al + be * tm) : Rm * (1 + tm * tm) / (al + be * tm);
      const ts = curve(ser, K, al, be, A, B);
      if (ts === ts) consider(Rof(ser, K, al, be, ts), ts, 'band edge');
      if (!ins) continue;
      // ride at kappa_min: pairs at a peak inside [lo, hi], or an extension to a peak
      const lam = sg * k, lo = Math.min(t0, tm), hi = Math.max(t0, tm);
      const base = t => F0d(t) - lam * dUed(t, sg);
      if ((qm >= lo && qm <= hi) || (qp >= lo && qp <= hi)) freeU(lam, base, A, B, 'pairs');
      if (qp > hi) freeU(lam, up ? (t => base(t) - ell(t) + k * gd(t)) : base, A, B, 'extend up and ride');
      if (qm < lo) freeU(lam, !up ? (t => base(t) + ell(t) - k * gd(t)) : base, A, B, 'extend down and ride');
    }
  }
  // fixed angle at each breakpoint: best R for lambda in {0, +-kappa}, and the band edges
  for (const t of brk) {
    for (const lam of [0, k, -k]) {
      const A2 = (1 + lam) * (1 + t * t), B2 = 2 * lam * (Rs + t * Xs), C2 = -(1 - lam) * (Rs * Rs + Xs * Xs);
      consider((-B2 + Math.sqrt(Math.max(B2 * B2 - 4 * A2 * C2, 0))) / (2 * A2), t, 'breakpoint');
    }
    for (const sg of [1, -1]) consider(RL * Math.exp(Ued(t, sg)), t, 'breakpoint edge');
  }

  // ---- extend without ride: t0 -> M -> t, on the band edge of the two legs. R = Rbase(t) E(M).
  for (const up of [true, false]) {
    const tc = Math.min(Math.max(t0, -c + 1e-9 * (1 + c)), a - 1e-9 * (1 + a));   // reference angle inside (-c, a)
    const Mlo = up ? tc : Math.max(qm, -c), Mhi = up ? Math.min(qp, a) : tc;
    if (!(Mhi > Mlo)) continue;
    const al = up ? c : a, be = up ? 1 : -1;               // final leg: L(t) = al + be t
    for (const sg of [1, -1]) {
      // pieces of t over the whole range, with Rbase in closed form on each
      const cuts = [...new Set([-c, ...[t0, tu, td].filter(v => v > -c && v < a), a])].sort((x, y) => x - y);
      const pcs = [];
      for (let i = 0; i + 1 < cuts.length; i++) {
        const A = cuts[i], B = cuts[i + 1], tm = 0.5 * (A + B);
        const corr = up ? (tm > t0 ? -sg * pair_gain(P, tc, tm) : 0) : (tm < t0 ? -sg * pair_gain(P, tm, tc) : 0);
        const dcorr = up ? (tm > t0 ? -sg * gd(tm) : 0) : (tm < t0 ? sg * gd(tm) : 0);
        const dU = dUed(tm, sg) + dcorr, ser = isSeries(dU, al, be, tm);
        const Rm = RL * Math.exp(Ued(tm, sg) + corr);
        pcs.push({ A, B, ser, K: ser ? Rm * (al + be * tm) : Rm * (1 + tm * tm) / (al + be * tm) });
      }
      const evalM = (M, out) => {
        const E = Math.exp(sg * (up ? pair_gain(P, tc, M) : pair_gain(P, M, tc)));
        const Lf = up ? (a - M) / ((a - t0) * (c + M)) : (c + M) / ((c + t0) * (a - M));
        // valid t: up: t <= M and max(t0, t) >= largest peak below M; down: mirror
        let A = up ? -c : M, B = up ? M : a;
        if (up) { const pb = qp < M ? qp : (qm < M ? qm : -Infinity); if (t0 < pb) A = Math.max(A, pb); }
        else { const pa = qm > M ? qm : (qp > M ? qp : Infinity); if (t0 > pa) B = Math.min(B, pa); }
        let bv = -1;
        for (const pc of pcs) {
          const A2 = Math.max(A, pc.A), B2 = Math.min(B, pc.B);
          if (!(B2 > A2)) continue;
          const K = pc.K * E, e = 1e-12 * (B2 - A2);
          for (const t of [curve(pc.ser, K, al, be, A2, B2), A2 + e, B2 - e]) {
            if (t !== t) continue;
            const R = Rof(pc.ser, K, al, be, t), v = Lf * (al + be * t) * match(R, t);
            if (v > bv) { bv = v; if (out) { out[0] = R; out[1] = t; } }
          }
        }
        return bv;
      };
      const mb = [...new Set([Mlo, ...[t0, tu, td, qm, qp].filter(v => v > Mlo && v < Mhi), Mhi])].sort((x, y) => x - y);
      const Ms = [], vs = [];
      for (let j = 0; j + 1 < mb.length; j++) {
        const q0 = Math.atan(mb[j]), q1 = Math.atan(mb[j + 1]);
        for (let i = j ? 0 : 1; i < NM; i++) { const M = Math.tan(q0 + (q1 - q0) * i / NM); Ms.push(M); vs.push(evalM(M)); }
      }
      for (let i = 0; i < Ms.length; i++) {
        const l = i ? vs[i - 1] : -1, r = i + 1 < vs.length ? vs[i + 1] : -1;
        if (!(vs[i] > 0 && vs[i] >= l && vs[i] >= r)) continue;
        let x0 = i ? Ms[i - 1] : Mlo, x3 = i + 1 < Ms.length ? Ms[i + 1] : Mhi;
        let x1 = x3 - GR * (x3 - x0), x2 = x0 + GR * (x3 - x0), f1 = evalM(x1), f2 = evalM(x2);
        for (let it = 0; it < NG; it++) {
          if (f1 > f2) { x3 = x2; x2 = x1; f2 = f1; x1 = x3 - GR * (x3 - x0); f1 = evalM(x1); }
          else { x0 = x1; x1 = x2; f1 = f2; x2 = x0 + GR * (x3 - x0); f2 = evalM(x2); }
        }
        const out = [NaN, NaN]; evalM(0.5 * (x0 + x3), out);
        consider(out[0], out[1], up ? 'extend up' : 'extend down');
      }
    }
  }
  return best;
}
