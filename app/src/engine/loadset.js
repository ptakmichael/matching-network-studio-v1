// Load sets: file parsing, and one network for many loads.
// The designs port mn_robust and design_p5 (studies/loop_433MHz_N400_P5) to a
// finite list of equally weighted load states.
import { etaMany, gainq, esr, rng, describe, quantile, zinMany } from './core.js';
import { ladder, ladderSpace, pruneSet, lsection, lsig } from './ladder.js';
import { fminsearch } from './nm.js';
import { zopt } from './zopt.js';

// ------------------------------------------------------------------ parsing
const num = s => {
  const m = String(s).trim().replace(/^"|"$/g, '').match(/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
};
function splitCsv(line) {
  if (!/[,;\t]/.test(line)) return line.trim().split(/\s+/);
  const out = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if ((ch === ',' || ch === ';' || ch === '\t') && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function parseComplexCell(s) {
  const m = String(s).replace(/\s/g, '').replace(/^"|"$/g, '')
    .match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)([-+](?:\d+\.?\d*|\.\d+)?(?:[eE][-+]?\d+)?)[ij]$/);
  if (!m) return null;
  const im = m[2] === '+' ? 1 : m[2] === '-' ? -1 : parseFloat(m[2]);
  return [parseFloat(m[1]), im];
}

function parseTouchstone(text) {
  let unit = 1e9, fmt = 'MA', par = 'S', R0 = 50;
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('!')[0].trim();
    if (!line) continue;
    if (line[0] === '#') {
      const t = line.slice(1).trim().toUpperCase().split(/\s+/);
      for (let i = 0; i < t.length; i++) {
        const w = t[i];
        if (w === 'HZ') unit = 1; else if (w === 'KHZ') unit = 1e3; else if (w === 'MHZ') unit = 1e6; else if (w === 'GHZ') unit = 1e9;
        else if (['S', 'Z', 'Y'].includes(w)) par = w;
        else if (['RI', 'MA', 'DB'].includes(w)) fmt = w;
        else if (w === 'R') { R0 = +t[i + 1]; i++; }
      }
      continue;
    }
    const v = line.split(/\s+/).map(Number);
    if (v.length >= 3 && v.every(Number.isFinite)) rows.push(v);
  }
  if (!rows.length) throw new Error('No data rows found in the Touchstone file.');
  const R = [], X = [], f = [];
  for (const r of rows) {
    let a, b;
    if (fmt === 'RI') { a = r[1]; b = r[2]; }
    else {
      const mag = fmt === 'DB' ? Math.pow(10, r[1] / 20) : r[1], ph = r[2] * Math.PI / 180;
      a = mag * Math.cos(ph); b = mag * Math.sin(ph);
    }
    let zr, zi;
    if (par === 'S') {
      const dr = 1 - a, di = -b, d = dr * dr + di * di, nr = 1 + a, ni = b;
      zr = R0 * (nr * dr + ni * di) / d; zi = R0 * (ni * dr - nr * di) / d;
    } else if (par === 'Z') { zr = a * R0; zi = b * R0; }
    else { const d = a * a + b * b; zr = R0 * a / d; zi = -R0 * b / d; }
    R.push(zr); X.push(zi); f.push(r[0] * unit / 1e6);
  }
  return { R, X, params: { 'Frequency (MHz)': f }, format: 'Touchstone' };
}

/** Parse one file. HFSS report tables and plain two-column lists are recognised.
 *  Wide HFSS traces (Zre_*.csv, Zim_*.csv) come back with kind 'wide'. */
export function parseFile(text, name, f0MHz) {
  if (/\.s1p$/i.test(name) || /^\s*[!#]/.test(text)) return parseTouchstone(text);
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) throw new Error('The file is empty.');
  const head = splitCsv(lines[0]);
  const hasHeader = head.some(h => Number.isNaN(num(h)) && !parseComplexCell(h));
  const body = (hasHeader ? lines.slice(1) : lines).map(splitCsv);
  if (!body.length) throw new Error('The file has a header but no data rows.');
  const low = head.map(h => h.toLowerCase());

  // wide export: frequency in column 1, one trace per column, one quantity per file
  const nRe = low.filter(h => /^re\(z/.test(h)).length, nIm = low.filter(h => /^im\(z/.test(h)).length;
  if (hasHeader && ((nRe > 1 && nIm === 0) || (nIm > 1 && nRe === 0))) {
    const isRe = nRe > 1;
    const fcol = body.map(r => num(r[0]));
    let bi = 0;
    fcol.forEach((f, i) => { if (Math.abs(f - f0MHz) < Math.abs(fcol[bi] - f0MHz)) bi = i; });
    const labels = head.slice(1).map(h => h.replace(/^.*?\]\s*-\s*/, '').replace(/^.*?-\s*/, ''));
    return { kind: 'wide', isRe, labels, values: body[bi].slice(1).map(num), freq: fcol[bi] };
  }

  let cr = -1, ci = -1;
  if (hasHeader) {
    cr = low.findIndex(h => /re\s*\(\s*z/.test(h));
    ci = low.findIndex(h => /im\s*\(\s*z/.test(h));
    if (cr < 0) cr = low.findIndex(h => /^(r|rin|re|real|resistance|zre|z_re|re_z|real\(z\))\b/.test(h));
    if (ci < 0) ci = low.findIndex(h => /^(x|xin|im|imag|reactance|zim|z_im|im_z|imag\(z\))\b/.test(h));
  }
  if (cr < 0 || ci < 0) {
    // single complex column, or the first two numeric columns
    const cplx = body[0].findIndex(c => parseComplexCell(c));
    if (cplx >= 0) {
      const v = body.map(r => parseComplexCell(r[cplx])).filter(Boolean);
      return { R: v.map(a => a[0]), X: v.map(a => a[1]), params: {}, format: 'Complex column' };
    }
    const numeric = body[0].map((c, i) => (Number.isFinite(num(c)) ? i : -1)).filter(i => i >= 0);
    if (numeric.length < 2) throw new Error('Could not find resistance and reactance columns. Use columns named R and X.');
    [cr, ci] = numeric.slice(-2);
    if (numeric.length === 2) { cr = numeric[0]; ci = numeric[1]; }
    else throw new Error('Could not identify the resistance and reactance columns. Name them R and X, or use re(Z(1 1)) and im(Z(1 1)).');
  }
  const R = [], X = [], params = {};
  const pcols = hasHeader ? head.map((h, i) => ({ h, i }))
    .filter(c => c.i !== cr && c.i !== ci && !/variation|^\*$|^db\(|^index$|^id$/i.test(c.h)
      && Number.isFinite(num(body[0][c.i]))) : [];
  for (const c of pcols) params[c.h] = [];
  for (const row of body) {
    const r = num(row[cr]), x = num(row[ci]);
    if (!Number.isFinite(r) || !Number.isFinite(x)) continue;
    R.push(r); X.push(x);
    for (const c of pcols) params[c.h].push(num(row[c.i]));
  }
  if (!R.length) throw new Error('No numeric rows found.');
  return { R, X, params, format: /re\(z/i.test(head[cr] || '') ? 'HFSS table' : 'Two-column list' };
}

/** Merge parsed files into one load set. */
export function buildSet(parsed, names) {
  const wide = parsed.filter(p => p.kind === 'wide');
  const flat = parsed.filter(p => p.kind !== 'wide');
  const R = [], X = [], params = {};
  for (const p of flat) {
    const off = R.length;
    R.push(...p.R); X.push(...p.X);
    for (const k of Object.keys(p.params)) {
      params[k] = params[k] || new Array(off).fill(NaN);
      params[k].push(...p.params[k]);
    }
    for (const k of Object.keys(params)) while (params[k].length < R.length) params[k].push(NaN);
  }
  const res = wide.filter(p => p.isRe), ims = wide.filter(p => !p.isRe);
  if (res.length !== ims.length) throw new Error('Each Zre file needs a matching Zim file.');
  res.forEach((a, i) => {
    const b = ims[i];
    if (a.values.length !== b.values.length) throw new Error('Zre and Zim files have different trace counts.');
    a.values.forEach((v, j) => { R.push(v); X.push(b.values[j]); });
  });
  const keep = R.map((r, i) => r > 0 && Number.isFinite(r) && Number.isFinite(X[i]));
  const dropped = keep.filter(k => !k).length;
  const Rr = R.filter((_, i) => keep[i]), Xr = X.filter((_, i) => keep[i]);
  const P = {};
  for (const k of Object.keys(params)) {
    const v = params[k].filter((_, i) => keep[i]);
    if (v.length === Rr.length && v.some(Number.isFinite)) P[k] = v;
  }
  if (Rr.length < 2) throw new Error('A load set needs at least two states with positive resistance.');
  return makeSet(Rr, Xr, P, names.join(', '), dropped);
}

export function makeSet(R, X, params, source, dropped = 0) {
  return {
    R: Float64Array.from(R), X: Float64Array.from(X), params, source, dropped, n: R.length,
    nominal: [R[0], X[0]],
  };
}

/** A rectangular range of loads as a regular grid of states. */
export function rangeSet(Rmin, Rmax, Xmin, Xmax, nR, nX, nominal) {
  if (!(Rmin > 0)) throw new Error('Minimum resistance must be above 0 Ω.');
  if (Rmin > Rmax) throw new Error('Minimum resistance exceeds maximum resistance.');
  if (Xmin > Xmax) throw new Error('Minimum reactance exceeds maximum reactance.');
  const R = [], X = [];
  const a = Rmax > Rmin ? Math.max(2, nR) : 1, b = Xmax > Xmin ? Math.max(2, nX) : 1;
  for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) {
    R.push(a > 1 ? Rmin + (Rmax - Rmin) * i / (a - 1) : Rmin);
    X.push(b > 1 ? Xmin + (Xmax - Xmin) * j / (b - 1) : Xmin);
  }
  const s = makeSet(R, X, {}, `Range: R ${Rmin} to ${Rmax} Ω, X ${Xmin} to ${Xmax} Ω`);
  s.nominal = nominal || [0.5 * (Rmin + Rmax), 0.5 * (Xmin + Xmax)];
  return s;
}

// ------------------------------------------------------------------ scoring
export function scoreSet(X, kind, S, Zs, QL, QC, pct, target) {
  const eta = etaMany(X, kind, S.R, S.X, Zs, QL, QC);
  const v = Float64Array.from(eta).sort();
  const n = v.length, k = Math.floor(pct / 100 * n);
  let s = 0;
  for (const e of v) s += e;
  const o = { eta, min: v[0], pk: v[k], k: k + 1, mean: s / n, max: v[n - 1], median: quantile(v, 0.5) };
  if (target != null) { let c = 0; for (const e of v) if (e >= target) c++; o.yield = c / n; }
  return o;
}

function smoothmin(v, beta) {
  let m = Infinity;
  for (let i = 0; i < v.length; i++) if (v[i] < m) m = v[i];
  let s = 0;
  for (let i = 0; i < v.length; i++) s += Math.exp(-beta * (v[i] - m));
  return m - Math.log(s) / beta;
}

const METHOD_NAME = { nominal: 'Nominal', worst: 'Worst case', pct: 'Percentile', average: 'Average', yield: 'Yield' };

/** Design one network for a load set.
 *  method: nominal | worst | pct | average | yield. */
export function designSet(S, cfg, method, seeds, progress) {
  const { N, topo, Zs, QL, QC, ntry = 20, pct = 5, target = 0.2, seed = 12345 } = cfg;
  const rand = rng(seed + method.length * 7919);
  const nS = S.n, R = S.R, Xv = S.X, buf = new Float64Array(nS), srt = new Float64Array(nS);
  const k = Math.floor(pct / 100 * nS);
  const nomL = ladder(N, S.nominal, Zs, QL, QC, topo, { ntry, rand });
  if (method === 'nominal') return finish(nomL.X, nomL.kind, nomL.order, method, cfg, S);

  const SP = [1, 2].map(f => ladderSpace(N, topo, f, R, Xv, Zs));
  const netEta = (P, u, Xb) => { P.unpack(u, Xb); return etaMany(Xb, P.kind, R, Xv, Zs, QL, QC, buf); };
  const finiteX = Xb => Xb.every(Number.isFinite);

  // true score, higher is better, with the mean as tie-break
  const score = (P, u, Xb) => {
    P.unpack(u, Xb);
    if (!finiteX(Xb)) return [-Infinity, -Infinity];
    netEta(P, u, Xb);
    let s = 0;
    for (let i = 0; i < nS; i++) s += buf[i];
    const mean = s / nS;
    if (method === 'average') return [mean, mean];
    if (method === 'yield') {
      let c = 0;
      for (let i = 0; i < nS; i++) if (buf[i] >= target) c++;
      return [c / nS, mean];
    }
    srt.set(buf); srt.sort();
    return [method === 'worst' ? srt[0] : srt[k], mean];
  };

  // the stages of each method; the smooth forms only steer the search
  const stages = method === 'worst' ? [20, 100, 500] : method === 'yield' ? [0.03, 0.01, 0.003] : method === 'average' ? [1] : ['tail', 'q', 'q'];
  const objective = (P, st, Xb) => u => {
    P.unpack(u, Xb);
    if (!finiteX(Xb)) return 1e3;
    etaMany(Xb, P.kind, R, Xv, Zs, QL, QC, buf);
    if (method === 'worst') return -smoothmin(buf, st);
    if (method === 'average') { let s = 0; for (let i = 0; i < nS; i++) s += buf[i]; return -s / nS; }
    if (method === 'yield') {
      let s = 0;
      for (let i = 0; i < nS; i++) s += 1 / (1 + Math.exp(-(buf[i] - target) / st));
      return -s / nS;
    }
    srt.set(buf); srt.sort();
    if (st === 'q') return -srt[k];
    let s = 0;
    for (let i = 0; i <= k; i++) s += srt[i];
    return -s / (k + 1);
  };

  // starts: the nominal design, best networks at the extreme loads, seeds, random
  const iExt = extremes(S);
  const corner = iExt.map(i => ladder(N, [R[i], Xv[i]], Zs, QL, QC, topo, { ntry: Math.max(6, Math.round(ntry / 2)), rand }));
  const seedNets = [nomL, ...corner, ...(seeds || [])].filter(s => s && s.X && s.X.length);
  const nmo = { tolX: 1e-8, tolF: 1e-11, maxEval: 2500, maxIter: 2500 };
  const pool = [];
  let done = 0;
  const total = 2 * (seedNets.length + ntry);
  for (const P of SP) {
    const Xb = new Array(N), starts = [];
    for (const s of seedNets) { const u = P.pack(s.X, s.kind); if (u) starts.push(u); }
    for (let t = 0; t < ntry; t++) starts.push(P.random(rand));
    for (const u0 of starts) {
      let u = u0;
      const [s0, t0] = score(P, u0, Xb);
      for (const st of stages) u = fminsearch(objective(P, st, Xb), u, nmo).x;
      const [s1, t1] = score(P, u, Xb);
      if (s1 > s0 + 1e-12 || (Math.abs(s1 - s0) <= 1e-12 && t1 >= t0)) pool.push({ s: s1, t: t1, u, P });
      else pool.push({ s: s0, t: t0, u: u0, P });
      if (progress && (++done % 8 === 0)) progress(done / total);
    }
  }
  pool.sort((a, b) => (b.s - a.s) || (b.t - a.t));
  let best = pool[0];
  // Different networks can score identically at every load. Keep the lowest peak
  // reactance: the choice then does not depend on the seed, and the parts are larger.
  {
    const peak = c => Math.max(...c.P.unpack(c.u).map(Math.abs));
    let bx = peak(best);
    for (const c of pool) {
      if (Math.abs(c.s - pool[0].s) > 1e-9 || Math.abs(c.t - pool[0].t) > 1e-7) continue;
      const x = peak(c);
      if (x < bx) { bx = x; best = c; }
    }
  }

  // second step of design_p5: the highest mean within 0.1 points of the best score
  if (method === 'pct') {
    const thr = best.s - 0.001;
    let top = { t: -Infinity, xm: Infinity };
    // equal scores happen: the two element orders can be equivalent. The lower
    // peak reactance is kept so the result does not depend on the random seed.
    const consider = (s, t, u, P, Xb) => {
      if (s < thr) return;
      const xm = Math.max(...P.unpack(u, Xb).map(Math.abs));
      if (t > top.t + 1e-6 || (Math.abs(t - top.t) <= 1e-6 && xm < top.xm)) top = { s, t, u: u.slice(), P, xm };
    };
    for (const P of SP) {
      const Xb = new Array(N), c = pool.filter(p => p.P === P).slice(0, 5);
      const pen = u => {
        const [q, m] = score(P, u, Xb);
        return -(m - 10 * Math.max(0, thr - q));
      };
      for (const cand of c) {
        // restarted, since the penalty has a corner exactly at the threshold
        let u1 = cand.u;
        for (let r = 0; r < 4; r++) {
          u1 = fminsearch(pen, u1, { tolX: 1e-8, tolF: 1e-11, maxEval: 3000, maxIter: 3000 }).x;
          const [s, t] = score(P, u1, Xb);
          consider(s, t, u1, P, Xb);
        }
        const [s, t] = score(P, cand.u, Xb);
        consider(s, t, cand.u, P, Xb);
      }
    }
    if (top.u) best = top;
  }
  const Xf = best.P.unpack(best.u);
  const pr = pruneSet(Xf, best.P.kind, R, Xv, Zs, QL, QC);
  return finish(pr.X, pr.kind, best.P.first === 1 ? 'series-first' : 'shunt-first', method, cfg, S);
}

function extremes(S) {
  let a = 0, b = 0, c = 0, d = 0;
  for (let i = 1; i < S.n; i++) {
    if (S.R[i] < S.R[a]) a = i;
    if (S.R[i] > S.R[b]) b = i;
    if (S.X[i] < S.X[c]) c = i;
    if (S.X[i] > S.X[d]) d = i;
  }
  return [...new Set([a, b, c, d])];
}

function finish(X, kind, order, method, cfg, S) {
  const { Zs, QL, QC, pct = 5, target = 0.2 } = cfg;
  const m = scoreSet(X, kind, S, Zs, QL, QC, pct, target);
  const nom = gainq(X, kind, S.nominal, Zs, QL, QC);
  return {
    X, kind, Rser: esr(X, QL, QC), order, desc: describe(X, kind), method,
    method_name: method === 'pct' ? `${pct}th percentile` : METHOD_NAME[method],
    score: m, ...nom, ZL: S.nominal,
  };
}

/** Best efficiency at each state with a network tuned to that state: the
 *  closed-form limit of mn_robust_limits, on every state. */
export function setLimits(S, Zs, QL, QC, progress) {
  const v = new Float64Array(S.n);
  for (let i = 0; i < S.n; i++) {
    v[i] = zopt([S.R[i], S.X[i]], Zs, QL, QC).eta_tot;
    if (progress && i % 16 === 0) progress(i / S.n);
  }
  return v;
}

/** Two-element perfect match of each state to conj(Zs), for the required-value plot. */
export function requiredValues(S, Zs, QL, QC, f0, ref) {
  const w = 2 * Math.PI * f0, tgt = [Zs[0], -Zs[1]];
  // same structure as the nominal design when that is a two-element network
  const nom = (ref && lsection(S.nominal, tgt, QL, QC, lsig(ref))) || lsection(S.nominal, tgt, QL, QC);
  if (!nom) return null;
  const want = lsig(nom), a = [], b = [];
  let skipped = 0;
  for (let i = 0; i < S.n; i++) {
    const s = lsection([S.R[i], S.X[i]], tgt, QL, QC, want);
    if (!s) { skipped++; a.push(NaN); b.push(NaN); continue; }
    const val = x => (x > 0 ? x / w : 1 / (w * Math.abs(x)));
    a.push(val(s.X[0])); b.push(val(s.X[1]));
  }
  const nm = (k, x) => `${k === 1 ? 'Series' : 'Shunt'} ${x > 0 ? 'L' : 'C'}`;
  const val = x => (x > 0 ? x / w : 1 / (w * Math.abs(x)));
  return {
    a, b, nominal: [val(nom.X[0]), val(nom.X[1])],
    labels: [nm(nom.kind[0], nom.X[0]), nm(nom.kind[1], nom.X[1])],
    units: nom.X.map(x => (x > 0 ? 'H' : 'F')), skipped,
  };
}

export { zinMany };
