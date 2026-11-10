// Global optimum by Dijkstra on the exact loss metric. Port of mn_geo.
// The MATLAB code builds the full edge list; here each node's edges are
// generated when the node is settled, which gives the same graph with a
// fraction of the memory.
import { gain } from './core.js';

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

function localCost(zr, zi, ar, bi, QL, QC) {
  // Four-move linear program at Z for the step dZ = a + jb.
  const R = zr, d = zr * zr + zi * zi, G = zr / d;
  const pp = zr * zr - zi * zi, qq = 2 * zr * zi;
  let c = Infinity;
  for (let s1 = 0; s1 < 2; s1++) {
    const su = s1 ? -1 : 1, Qx = su > 0 ? QL : QC;
    for (let s2 = 0; s2 < 2; s2++) {
      const sw = s2 ? -1 : 1, Qb = sw > 0 ? QC : QL;
      const al = su / Qx, be = qq - pp * (sw / Qb), de = -(pp + qq * (sw / Qb));
      const dtm = al * de - be;
      if (dtm === 0) continue;
      const uu = (ar * de - bi * be) / dtm, ww = (al * bi - ar) / dtm;
      const cc = (su * uu) / (Qx * R) + (sw * ww) / (Qb * G);
      if (su * uu >= -1e-15 && sw * ww >= -1e-15 && Number.isFinite(cc) && cc >= 0 && cc < c) c = cc;
    }
  }
  return c;
}

class Heap {
  constructor(cap) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  push(key, val) {
    if (this.n === this.k.length) {
      const k2 = new Float64Array(this.n * 2), v2 = new Int32Array(this.n * 2);
      k2.set(this.k); v2.set(this.v); this.k = k2; this.v = v2;
    }
    let i = this.n++;
    const K = this.k, V = this.v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= key) break;
      K[i] = K[p]; V[i] = V[p]; i = p;
    }
    K[i] = key; V[i] = val;
  }
  pop() {
    const K = this.k, V = this.v, top = V[0], key = K[0];
    const n = --this.n, lk = K[n], lv = V[n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && K[c + 1] < K[c]) c++;
      if (K[c] >= lk) break;
      K[i] = K[c]; V[i] = V[c]; i = c;
    }
    K[i] = lk; V[i] = lv;
    this.topKey = key;
    return top;
  }
}

export function geo(ZL, Zs, QL, QC, opt = {}) {
  const nu = opt.nu ?? 241, nt = opt.nt ?? 201, ring = opt.ring ?? 2, nmag = opt.nmag ?? 60, pad = opt.pad ?? 1.5;
  const target = opt.target ?? [Zs[0], -Zs[1]];
  const tl = Math.abs(Math.atan(ZL[1] / ZL[0])), tg = Math.abs(Math.atan(target[1] / target[0]));
  const tmax = Math.min(1.5620, Math.max(1.5, tl, tg) + 0.02);
  const uL = Math.log(ZL[0]), tL = Math.atan(ZL[1] / ZL[0]);
  const uT = Math.log(target[0]), uS = Math.log(Zs[0]);
  const ulo = Math.min(uL, uT, uS) - pad, uhi = Math.max(uL, uT, uS) + pad;
  const du = (uhi - ulo) / (nu - 1), dt = 2 * tmax / (nt - 1);
  const u = new Float64Array(nu), th = new Float64Array(nt);
  for (let i = 0; i < nu; i++) u[i] = ulo + du * i;
  for (let i = 0; i < nt; i++) th[i] = -tmax + dt * i;
  // shift both grids so the load lands on a node
  const iu = Math.min(Math.max(Math.round((uL - u[0]) / du), 0), nu - 1);
  const it = Math.min(Math.max(Math.round((tL - th[0]) / dt), 0), nt - 1);
  const su = uL - u[iu], st = tL - th[it];
  for (let i = 0; i < nu; i++) u[i] += su;
  for (let i = 0; i < nt; i++) th[i] += st;

  const nn = nu * nt;                         // node = a + nu*b, a over u, b over theta
  const Rn = new Float64Array(nn), Xn = new Float64Array(nn), Gn = new Float64Array(nn), Bn = new Float64Array(nn);
  for (let b = 0; b < nt; b++) {
    const tq = Math.tan(th[b]);
    for (let a = 0; a < nu; a++) {
      const i = a + nu * b, R = Math.exp(u[a]), X = R * tq, d = R * R + X * X;
      Rn[i] = R; Xn[i] = X; Gn[i] = R / d; Bn[i] = -X / d;
    }
  }
  const sten = [];
  for (let da = -ring; da <= ring; da++) for (let db = -ring; db <= ring; db++) {
    if ((da || db) && gcd(Math.abs(da), Math.abs(db)) === 1) sten.push([da, db]);
  }
  const Rscale = Math.exp(0.5 * (ulo + uhi));
  const fam = [[1, QL, 1], [1, QC, -1], [2, QC, 1], [2, QL, -1]];
  const mags = [];
  for (const [ser, Qf, sg] of fam) {
    for (let m = 0; m < nmag; m++) {
      const lg = Math.pow(10, -2 + 4 * m / (nmag - 1));
      mags.push([ser === 1, ser === 1 ? Rscale * lg : lg / Rscale, Qf, sg]);
    }
  }

  const dist = new Float64Array(nn).fill(Infinity), prev = new Int32Array(nn).fill(-1);
  const done = new Uint8Array(nn);
  const iL = iu + nu * it;
  dist[iL] = 0;
  const heap = new Heap(1 << 18);
  heap.push(0, iL);
  const relax = (i, j, c, di) => {
    const v = di + c;
    if (v < dist[j]) { dist[j] = v; prev[j] = i; heap.push(v, j); }
  };
  let edges = 0;
  while (heap.n) {
    const i = heap.pop();
    if (done[i]) continue;
    done[i] = 1;
    const di = dist[i], a = i % nu, b = (i / nu) | 0;
    const zr = Rn[i], zi = Xn[i], yr = Gn[i], yi = Bn[i];
    for (const [da, db] of sten) {
      const a2 = a + da, b2 = b + db;
      if (a2 < 0 || a2 >= nu || b2 < 0 || b2 >= nt) continue;
      const j = a2 + nu * b2;
      if (done[j]) continue;
      const dr = Rn[j] - zr, dx = Xn[j] - zi;
      const c = 0.5 * (localCost(zr, zi, dr, dx, QL, QC) + localCost(Rn[j], Xn[j], dr, dx, QL, QC));
      if (Number.isFinite(c) && c >= 0) { edges++; relax(i, j, c, di); }
    }
    for (const [ser, m, Qf, sg] of mags) {
      let tr, ti;
      if (ser) { tr = zr + m / Qf; ti = zi + sg * m; }
      else {
        const gr = yr + m / Qf, gi = yi + sg * m, d = gr * gr + gi * gi;
        tr = gr / d; ti = -gi / d;
      }
      if (!(tr > 0)) continue;
      const ja = Math.round((Math.log(tr) - u[0]) / du);
      const jb = Math.round((Math.atan(ti / tr) - th[0]) / dt);
      if (ja < 0 || ja >= nu || jb < 0 || jb >= nt) continue;
      const j = ja + nu * jb;
      if (j === i || done[j]) continue;
      const dR = Rn[j] - zr, dX = Xn[j] - zi;
      const Qs = dX > 0 ? QL : QC;
      let c = Infinity;
      if (dR > 0 && Math.abs(dX) > 0 && Math.abs(dX) <= Qs * dR) c = Math.log(Rn[j] / zr);
      const dG = Gn[j] - yr, dB = Bn[j] - yi;
      const Qp = dB > 0 ? QC : QL;
      if (dG > 0 && Math.abs(dB) > 0 && Math.abs(dB) <= Qp * dG) c = Math.min(c, Math.log(Gn[j] / yr));
      if (Number.isFinite(c) && c > 0) { edges++; relax(i, j, c, di); }
    }
  }

  const eta_loss = new Float64Array(nn), eta_tot = new Float64Array(nn);
  let ibest = iL, tbest = -1;
  for (let i = 0; i < nn; i++) {
    const el = Math.exp(-dist[i]), ar = Rn[i] + Zs[0], ai = Xn[i] + Zs[1];
    const em = 4 * Rn[i] * Zs[0] / (ar * ar + ai * ai);
    eta_loss[i] = el; eta_tot[i] = Number.isFinite(el * em) ? el * em : 0;
    if (eta_tot[i] > tbest) { tbest = eta_tot[i]; ibest = i; }
  }
  const g = { nu, nt, u, th, Rn, Xn, eta_loss, edges, nodes: nn, eta_tot_opt: tbest, Zin_opt: [Rn[ibest], Xn[ibest]], eta_loss_opt: eta_loss[ibest] };
  const rebuild = (end) => {
    const pth = [end];
    let guard = 0;
    while (pth[0] !== iL) {
      if (prev[pth[0]] < 0 || guard++ > 5e5) return null;
      pth.unshift(prev[pth[0]]);
    }
    const dd = pth.slice(1).map((v, k) => dist[v] - dist[pth[k]]);
    return { Zp: pth.map(v => [Rn[v], Xn[v]]), cost: dd };
  };
  const pth = rebuild(ibest);
  if (pth) {
    const net = pathToChain(pth.Zp, pth.cost, QL, QC);
    Object.assign(g, net, { path: pth.Zp });
    if (net.X.length) {
      const r = gain(net.X, net.kind, net.Rser, ZL, Zs);
      g.eta_exact = r.eta_tot; g.Zin_exact = r.Zin;
    }
  }
  let itg = 0, dbest = Infinity;
  for (let i = 0; i < nn; i++) {
    const d = (Rn[i] - target[0]) ** 2 + (Xn[i] - target[1]) ** 2;
    if (d < dbest) { dbest = d; itg = i; }
  }
  g.eta_loss_target = eta_loss[itg]; g.Z_target_node = [Rn[itg], Xn[itg]];
  return g;
}

/** Read each segment of the path as the element or elements that perform it. */
function pathToChain(Zp, used, QL, QC) {
  const X = [], kind = [], Rser = [];
  for (let i = 0; i < Zp.length - 1; i++) {
    const [ar, ai] = Zp[i], [br, bi] = Zp[i + 1];
    const a = br - ar, b = bi - ai, mr = 0.5 * (ar + br), mi = 0.5 * (ai + bi);
    const R = mr, dm = mr * mr + mi * mi, G = mr / dm;
    const pp = mr * mr - mi * mi, qq = 2 * mr * mi;
    const opts = [];
    const dR = br - ar, dX = bi - ai;
    const da = ar * ar + ai * ai, db = br * br + bi * bi;
    const Yar = ar / da, Yai = -ai / da, Ybr = br / db, Ybi = -bi / db;
    const dG = Ybr - Yar, dB = Ybi - Yai;
    const Qs = dX > 0 ? QL : QC, Qp = dB > 0 ? QC : QL;
    if (dR > 0 && Math.abs(dX) > 0 && Math.abs(dX) <= Qs * dR * (1 + 1e-9)) opts.push({ c: Math.log(br / ar), t: 1, v: [dR, dX] });
    if (dG > 0 && Math.abs(dB) > 0 && Math.abs(dB) <= Qp * dG * (1 + 1e-9)) opts.push({ c: Math.log(Ybr / Yar), t: 2, v: [dG, dB] });
    let bc = Infinity, bv = null;
    for (const su of [1, -1]) {
      const Qx = su > 0 ? QL : QC;
      for (const sw of [1, -1]) {
        const Qb = sw > 0 ? QC : QL;
        const al = su / Qx, be = qq - pp * (sw / Qb), de = -(pp + qq * (sw / Qb));
        const dtm = al * de - be;
        if (dtm === 0) continue;
        const uu = (a * de - b * be) / dtm, ww = (al * b - a) / dtm;
        if (su * uu < -1e-15 || sw * ww < -1e-15) continue;
        const cv = (su * uu) / (Qx * R) + (sw * ww) / (Qb * G);
        if (cv >= 0 && cv < bc) { bc = cv; bv = [uu, ww, Qx, Qb]; }
      }
    }
    if (Number.isFinite(bc)) opts.push({ c: bc, t: 3, v: bv });
    if (!opts.length) continue;
    let p = opts[0];
    for (const o of opts) if (Math.abs(o.c - used[i]) < Math.abs(p.c - used[i])) p = o;
    if (p.t === 1) { X.push(p.v[1]); kind.push(1); Rser.push(p.v[0]); }
    else if (p.t === 2) {
      const d = p.v[0] ** 2 + p.v[1] ** 2;
      X.push(-p.v[1] / d); kind.push(2); Rser.push(p.v[0] / d);
    } else {
      const [uu, ww, Qx, Qb] = p.v;
      if (Math.abs(uu) > 0) { X.push(uu); kind.push(1); Rser.push(Math.abs(uu) / Qx); }
      if (Math.abs(ww) > 0) {
        const gr = Math.abs(ww) / Qb, d = gr * gr + ww * ww;
        X.push(-ww / d); kind.push(2); Rser.push(gr / d);
      }
    }
  }
  return mergeChain(X, kind, Rser);
}

function mergeChain(X, kind, Rser) {
  const oX = [], ok = [], oR = [];
  if (!X.length) return { X: oX, kind: ok, Rser: oR };
  const inv = (r, i) => { const d = r * r + i * i; return [r / d, -i / d]; };
  let ck = kind[0], acc = ck === 1 ? [Rser[0], X[0]] : inv(Rser[0], X[0]);
  const emit = () => {
    const Ze = ck === 1 ? acc : inv(acc[0], acc[1]);
    oX.push(Ze[1]); ok.push(ck); oR.push(Ze[0]);
  };
  for (let k = 1; k < X.length; k++) {
    const e = kind[k] === 1 ? [Rser[k], X[k]] : inv(Rser[k], X[k]);
    if (kind[k] === ck) { acc = [acc[0] + e[0], acc[1] + e[1]]; }
    else { emit(); ck = kind[k]; acc = e; }
  }
  emit();
  return { X: oX, kind: ok, Rser: oR };
}

/** Bilinear read of the geodesic eta_loss field at a termination. */
export function geoAt(g, zr, zi) {
  const uq = Math.log(zr), tq = Math.atan(zi / zr);
  const du = g.u[1] - g.u[0], dt = g.th[1] - g.th[0];
  const s = (uq - g.u[0]) / du, t = (tq - g.th[0]) / dt;
  if (s < 0 || s > g.nu - 1 || t < 0 || t > g.nt - 1) return NaN;
  const a = Math.min(g.nu - 2, Math.floor(s)), b = Math.min(g.nt - 2, Math.floor(t));
  const fa = s - a, fb = t - b, F = g.eta_loss, i = a + g.nu * b;
  return (1 - fb) * ((1 - fa) * F[i] + fa * F[i + 1]) + fb * ((1 - fa) * F[i + g.nu] + fa * F[i + g.nu + 1]);
}
