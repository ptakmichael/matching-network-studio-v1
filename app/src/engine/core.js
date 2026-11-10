// Core network arithmetic. Port of mn_gain, mn_gainq, mn_gainv, mn_trace,
// mn_metrics, mn_refdes, mn_eng and mn_nrange.
// Conventions follow the MATLAB toolbox: elements are ordered from the load,
// kind 1 = series, kind 2 = shunt, X > 0 inductor, X < 0 capacitor.

export const SERIES = 1, SHUNT = 2;

export const cdiv = (ar, ai, br, bi) => {
  const d = br * br + bi * bi;
  return [(ar * br + ai * bi) / d, (ai * br - ar * bi) / d];
};

/** ESR of each element from the nominal model Rser = |X|/Q. */
export function esr(X, QL, QC) {
  return X.map(x => Math.abs(x) / (x >= 0 ? QL : QC));
}

/** ABCD matrix of the ladder as eight reals [Ar,Ai,Br,Bi,Cr,Ci,Dr,Di]. */
export function abcd(X, kind, Rser) {
  let Ar = 1, Ai = 0, Br = 0, Bi = 0, Cr = 0, Ci = 0, Dr = 1, Di = 0;
  for (let k = 0; k < X.length; k++) {
    const zr = Rser[k], zi = X[k];
    if (kind[k] === 1) {
      Ar += zr * Cr - zi * Ci; Ai += zr * Ci + zi * Cr;
      Br += zr * Dr - zi * Di; Bi += zr * Di + zi * Dr;
    } else {
      const d = zr * zr + zi * zi, yr = zr / d, yi = -zi / d;
      Cr += yr * Ar - yi * Ai; Ci += yr * Ai + yi * Ar;
      Dr += yr * Br - yi * Bi; Di += yr * Bi + yi * Br;
    }
  }
  return [Ar, Ai, Br, Bi, Cr, Ci, Dr, Di];
}

/** mn_gain: exact lossy transducer gain between ZL and Zs. */
export function gain(X, kind, Rser, ZL, Zs) {
  const [Ar, Ai, Br, Bi, Cr, Ci, Dr, Di] = abcd(X, kind, Rser);
  const zr = ZL[0], zi = ZL[1], sr = Zs[0], si = Zs[1];
  const nr = Ar * zr - Ai * zi + Br, ni = Ar * zi + Ai * zr + Bi;    // A ZL + B
  const dr = Cr * zr - Ci * zi + Dr, di = Cr * zi + Ci * zr + Di;    // C ZL + D
  const [Zr, Zi] = cdiv(nr, ni, dr, di);
  const tr = nr + sr * dr - si * di, ti = ni + sr * di + si * dr;    // A ZL + B + Zs (C ZL + D)
  let eta = 4 * sr * zr / (tr * tr + ti * ti);
  const ar = Zr + sr, ai = Zi + si;
  const em = 4 * Zr * sr / (ar * ar + ai * ai);
  const el = em > 0 ? eta / em : NaN;
  if (!Number.isFinite(eta) || eta < 0) eta = 0;
  return { eta_tot: eta, eta_loss: el, eta_match: em, Zin: [Zr, Zi] };
}

/** mn_gainq: mn_gain with the nominal ESR model. */
export const gainq = (X, kind, ZL, Zs, QL, QC) => gain(X, kind, esr(X, QL, QC), ZL, Zs);

/** Efficiency only, nominal ESR model. Inner loop of the optimisers. */
export function etaq(X, kind, zr, zi, sr, si, QL, QC) {
  let Ar = 1, Ai = 0, Br = 0, Bi = 0, Cr = 0, Ci = 0, Dr = 1, Di = 0;
  for (let k = 0; k < X.length; k++) {
    const x = X[k], r = (x >= 0 ? x / QL : -x / QC);
    if (kind[k] === 1) {
      Ar += r * Cr - x * Ci; Ai += r * Ci + x * Cr;
      Br += r * Dr - x * Di; Bi += r * Di + x * Dr;
    } else {
      const d = r * r + x * x, yr = r / d, yi = -x / d;
      Cr += yr * Ar - yi * Ai; Ci += yr * Ai + yi * Ar;
      Dr += yr * Br - yi * Bi; Di += yr * Bi + yi * Br;
    }
  }
  const nr = Ar * zr - Ai * zi + Br, ni = Ar * zi + Ai * zr + Bi;
  const dr = Cr * zr - Ci * zi + Dr, di = Cr * zi + Ci * zr + Di;
  const tr = nr + sr * dr - si * di, ti = ni + sr * di + si * dr;
  const e = 4 * sr * zr / (tr * tr + ti * ti);
  return (e >= 0 && e < Infinity) ? e : 0;
}

/** mn_gainv: one network, many loads. Writes into out (Float64Array). */
export function etaMany(X, kind, Zr, Zi, Zs, QL, QC, out) {
  const R = esr(X, QL, QC);
  const [Ar, Ai, Br, Bi, Cr, Ci, Dr, Di] = abcd(X, kind, R);
  const sr = Zs[0], si = Zs[1], n = Zr.length;
  const o = out || new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const zr = Zr[i], zi = Zi[i];
    const nr = Ar * zr - Ai * zi + Br, ni = Ar * zi + Ai * zr + Bi;
    const dr = Cr * zr - Ci * zi + Dr, di = Cr * zi + Ci * zr + Di;
    const tr = nr + sr * dr - si * di, ti = ni + sr * di + si * dr;
    const e = 4 * sr * zr / (tr * tr + ti * ti);
    o[i] = (e >= 0 && e < Infinity) ? e : 0;
  }
  return o;
}

/** Input impedance for many loads. */
export function zinMany(X, kind, Zr, Zi, QL, QC) {
  const [Ar, Ai, Br, Bi, Cr, Ci, Dr, Di] = abcd(X, kind, esr(X, QL, QC));
  const n = Zr.length, re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const zr = Zr[i], zi = Zi[i];
    const nr = Ar * zr - Ai * zi + Br, ni = Ar * zi + Ai * zr + Bi;
    const dr = Cr * zr - Ci * zi + Dr, di = Cr * zi + Ci * zr + Di;
    const [a, b] = cdiv(nr, ni, dr, di);
    re[i] = a; im[i] = b;
  }
  return [re, im];
}

/** mn_trace: impedance locus from the load to the input, one segment per element.
 *  Returns { re, im, nodes } where nodes[k] is the index that ends element k. */
export function trace(X, kind, Rser, ZL, npts = 48) {
  const re = [ZL[0]], im = [ZL[1]], nodes = [0];
  let zr = ZL[0], zi = ZL[1];
  for (let k = 0; k < X.length; k++) {
    const er = Rser[k], ei = X[k];
    let lastr = zr, lasti = zi;
    for (let i = 1; i < npts; i++) {
      const t = i / (npts - 1);
      if (kind[k] === 1) {
        lastr = zr + er * t; lasti = zi + ei * t;
      } else {
        const [yr, yi] = cdiv(1, 0, zr, zi);
        const [wr, wi] = cdiv(t, 0, er, ei);
        [lastr, lasti] = cdiv(1, 0, yr + wr, yi + wi);
      }
      re.push(lastr); im.push(lasti);
    }
    zr = lastr; zi = lasti;
    nodes.push(re.length - 1);
  }
  return { re, im, nodes };
}

/** mn_metrics: closed-form quantities. */
export function metrics(QL, QC, ZL, Zs) {
  const rad = Math.sqrt((QC * QC + 1) * (QL * QL + 1));
  const o = { QL, QC };
  o.q_plus = (QL - QC + rad) / (QC * QL + 1);
  o.q_minus = (QL - QC - rad) / (QC * QL + 1);
  o.kappa_min = (QC + QL) / rad;
  o.delta = (QL - QC) / (QL * QC + 1);
  o.loss_per_decade = 1 - Math.pow(10, -o.kappa_min);
  const RL = ZL[0], Rs = Zs[0], Xs = Zs[1], k = o.kappa_min;
  o.Rin_star = RL > Rs ? Rs * (1 + k) / (1 - k) : Rs * (1 - k) / (1 + k);
  o.Zin_star = [o.Rin_star, -Xs];
  o.eta_match_star = 1 - k * k;
  o.r_star = Math.max(RL / o.Rin_star, o.Rin_star / RL);
  o.eta_loss_ceiling = Math.pow(o.r_star, -k);
  o.eta_tot_star = o.eta_match_star * o.eta_loss_ceiling;
  return o;
}

export function refdes(X, kind) {
  return X.map((x, k) => (x > 0 ? 'L' : 'C') + (kind[k] === 1 ? '' : 'p') + (k + 1));
}

export function describe(X, kind) {
  return X.map((x, k) => (x > 0 ? 'L' : 'C') + (kind[k] === 1 ? 's' : 'p')).join(' ');
}

/** Component values at f0. Same convention as mn_comps. */
export function comps(X, kind, Rser, f0) {
  const w = 2 * Math.PI * f0, names = refdes(X, kind);
  return X.map((x, k) => {
    const isL = x > 0;
    return {
      ref: names[k], type: isL ? 'L' : 'C', place: kind[k] === 1 ? 'Series' : 'Shunt',
      value: isL ? x / w : 1 / (w * Math.abs(x)), unit: isL ? 'H' : 'F',
      X: x, Rser: Rser[k], Q: Math.abs(x) / Math.max(Rser[k], 1e-300),
    };
  });
}

/** mn_eng: engineering notation. */
export function eng(v, unit = '', sig = 4) {
  if (!Number.isFinite(v)) return `${v} ${unit}`.trim();
  if (v === 0) return `0 ${unit}`.trim();
  const pre = ['a', 'f', 'p', 'n', 'µ', 'm', '', 'k', 'M', 'G', 'T'];
  let e3 = Math.floor(Math.log10(Math.abs(v)) / 3);
  if (unit === 'Ω') e3 = Math.max(e3, 0);
  if (e3 < -6 || e3 > 4) return `${v.toExponential(Math.max(sig - 1, 1))} ${unit}`.trim();
  const m = v / Math.pow(10, 3 * e3);
  return `${+m.toPrecision(sig)} ${pre[e3 + 6]}${unit}`.trim();
}

/** mn_nrange: '6', '2-8', '2,4,6', '3-9:2', '2-4, 8'. */
export function nrange(spec, nmax = 12, kmax = 8) {
  const s = String(spec).replace(/\s/g, '').replace(/;/g, ',');
  if (!s) throw new Error('Enter an element count, for example 4, 2-6 or 2,4,6.');
  const N = new Set();
  for (const tok of s.split(',')) {
    if (!tok) continue;
    const m = tok.match(/^(\d+)(?:-(\d+))?(?::(\d+))?$/);
    if (!m) throw new Error(`"${tok}" is not a valid element count.`);
    let a = +m[1], b = m[2] === undefined ? a : +m[2];
    const st = m[3] === undefined ? 1 : +m[3];
    if (st < 1) throw new Error(`Step in "${tok}" must be at least 1.`);
    if (b < a) [a, b] = [b, a];
    for (let v = a; v <= b; v += st) N.add(v);
  }
  const out = [...N].sort((p, q) => p - q);
  if (!out.length) throw new Error('No element counts found.');
  if (out[0] < 1) throw new Error('Element count must be at least 1.');
  if (out[out.length - 1] > nmax) throw new Error(`Element count must be ${nmax} or less.`);
  if (out.length > kmax) throw new Error(`At most ${kmax} element counts per run.`);
  return out;
}

/** Deterministic generator (mulberry32) so every run is reproducible. */
export function rng(seed) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  u.normal = () => {
    const r = Math.sqrt(-2 * Math.log(1 - u())), th = 2 * Math.PI * u();
    return r * Math.cos(th);
  };
  return u;
}

/** Nearest-rank quantile of a sorted array, as pct_of in mn_mc. */
export function quantile(sorted, q) {
  const n = sorted.length;
  if (!n) return NaN;
  return sorted[Math.max(0, Math.min(n - 1, Math.ceil(q * n) - 1))];
}

/** C-style number formatting, used so netlists match MN_NETLIST_TEXT. */
export function fmtE(v, p) {
  const s = v.toExponential(p);
  return s.replace(/e([+-])(\d)$/, 'e$10$2');
}
export function fmtG(v, p = 6) {
  if (v === 0) return '0';
  if (!Number.isFinite(v)) return String(v);
  const e = +v.toExponential(p - 1).split('e')[1];
  if (e < -4 || e >= p) {
    const [m, x] = v.toExponential(p - 1).split('e');
    const mm = m.includes('.') ? m.replace(/\.?0+$/, '') : m;
    return mm + 'e' + x[0] + x.slice(1).padStart(2, '0');
  }
  const s = v.toFixed(p - 1 - e);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}
export const sgn = (s, v) => (v >= 0 ? '+' : '') + s;
