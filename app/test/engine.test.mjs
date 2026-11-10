// Engine checks against numbers produced by the MATLAB toolbox.
// Sources: studies/*/results (.cir, .csv), DOCUMENTATION.md, mn_verify.m.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gain, gainq, etaMany, esr, fmtE, fmtG, nrange, trace, metrics, describe } from '../src/engine/core.js';
import { exact, exactOpt, bound, ceilingScan } from '../src/engine/exact.js';
import { ladder, lsection } from '../src/engine/ladder.js';
import { fminsearch } from '../src/engine/nm.js';
import { netlistText, nodalCheck, ascText } from '../src/engine/netlist.js';
import { parseFile, buildSet, scoreSet, designSet, rangeSet } from '../src/engine/loadset.js';
import { geodesic, closedForm } from '../src/engine/solve.js';
import { geo } from '../src/engine/geo.js';
import { isolines } from '../src/ui/contour.js';
import { mcSingle, tolSweep } from '../src/engine/mc.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const N400 = path.join(ROOT, 'Borchardt Loop Orientation Testing HFSS/mn_n400/10212026_MC_N400/MC_N400_Result_433MHz.csv');
const N200 = path.join(ROOT, 'Borchardt Loop Orientation Testing HFSS/09212026_Summer26Work_FULL/Week06_N200_MonteCarlo/data/MC_DOE_N200_seed20260802_Result.csv');
const CIRS = path.join(ROOT, 'studies/loop_433MHz_N400_P5/results');
const ZS = [50, 0], QL = 50, QC = 1000, F0 = 433e6;

/** Read a network back from a .cir written by MATLAB. */
function readCir(file) {
  const L = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const w = 2 * Math.PI * F0, parts = [];
  for (const l of L) {
    const m = l.match(/^(Cp?|Lp?)(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+Rser=(\S+)/);
    if (m) {
      const isL = m[1][0] === 'L', v = parseFloat(m[5]);
      parts.push({ i: +m[2], X: isL ? w * v : -1 / (w * v), kind: m[1].length === 2 ? 2 : 1, R: parseFloat(m[6]) });
    }
  }
  parts.sort((a, b) => a.i - b.i);
  const expected = parseFloat(L.find(l => l.startsWith('* expected')).match(/Eta = (\S+)/)[1]);
  return { X: parts.map(p => p.X), kind: parts.map(p => p.kind), Rser: parts.map(p => p.R), expected, lines: L };
}
const loadSet = f => buildSet([parseFile(fs.readFileSync(f, 'utf8'), f, 433)], [f]);

test('MATLAB .cir networks reproduce their recorded efficiency at Z_L', () => {
  const ZL = [0.24044067, 90.559741];
  for (const n of ['mc_p5', 'mc_nominal', 'mc_average']) {
    const c = readCir(path.join(CIRS, `${n}.cir`));
    const g = gain(c.X, c.kind, c.Rser, ZL, ZS);
    assert.ok(Math.abs(g.eta_tot - c.expected) < 2e-6, `${n}: ${g.eta_tot} vs ${c.expected}`);
  }
});

test('N = 400 set statistics match p5_summary.csv to the printed digits', () => {
  const S = loadSet(N400);
  assert.equal(S.n, 398);
  const want = { mc_p5: [3.548, 14.478, 23.823], mc_average: [0.914, 5.315, 35.230], mc_nominal: [0.419, 0.996, 5.111] };
  for (const [n, [mn, p5, mean]] of Object.entries(want)) {
    const c = readCir(path.join(CIRS, `${n}.cir`));
    const s = scoreSet(c.X, c.kind, S, ZS, QL, QC, 5, 0.2);
    assert.equal(s.k, 20);
    assert.ok(Math.abs(100 * s.min - mn) < 0.0011, `${n} min ${100 * s.min}`);
    assert.ok(Math.abs(100 * s.pk - p5) < 0.0011, `${n} p5 ${100 * s.pk}`);
    assert.ok(Math.abs(100 * s.mean - mean) < 0.0011, `${n} mean ${100 * s.mean}`);
  }
});

test('HFSS column order is read by name (N = 200 has im before re)', () => {
  const S = loadSet(N200);
  assert.equal(S.n, 200);
  assert.ok(Math.abs(S.R[0] - 0.24044067) < 1e-9 && Math.abs(S.X[0] - 90.559741) < 1e-6);
});

test('Published reference: best 5-element low-pass, documentation section 2.4', () => {
  const s = ladder(5, [0.5, 3], ZS, 30, 120, 'lowpass', { ntry: 30 });
  console.log('   N5 LP', (100 * s.eta_tot).toFixed(3), s.Zin.map(v => v.toFixed(3)).join(' '), s.desc);
  assert.ok(Math.abs(100 * s.eta_tot - 91.32) < 0.01, `${100 * s.eta_tot}`);
  assert.ok(Math.abs(s.Zin[0] - 45.89) < 0.02 && Math.abs(s.Zin[1] - 0.733) < 0.02);
});

test('mn_bound: Chappidi Fig. 10 ceiling 44.31 %', () => {
  const b = bound(10, 10, [100, 0], Float64Array.of(1.2), Float64Array.of(1.3));
  assert.ok(Math.abs(100 * b.eta_max[0] - 44.31) < 0.01, `${100 * b.eta_max[0]}`);
});

test('mn_bound reduces to r^-kappa for resistive terminations', () => {
  const k = metrics(30, 120, [1, 0], [50, 0]).kappa_min;
  for (const r of [2, 10, 100]) {
    const b = bound(30, 120, [1, 0], Float64Array.of(r), Float64Array.of(0));
    assert.ok(Math.abs(b.eta_max[0] - r ** -k) < 1e-6);
  }
});

test('Closed form is never beaten by a built ladder, and the bound is above both', () => {
  const cases = [[[0.5, 3], [50, 0], 30, 120], [[100, 0], [4, -16], 20, 60], [[0.24, 90.56], [50, 0], 50, 1000], [[5, -40], [50, 10], 40, 40]];
  for (const [ZL, Zs, a, c] of cases) {
    for (const t of ['lowpass', 'highpass', 'free']) {
      for (const N of [2, 3, 4]) {
        const s = ladder(N, ZL, Zs, a, c, t, { ntry: 8 });
        if (!s.X.length || s.eta_loss == null) continue;
        const e = exact(ZL[0], ZL[1], s.Zin[0], s.Zin[1], a, c);
        const b = bound(a, c, ZL, Float64Array.of(s.Zin[0]), Float64Array.of(s.Zin[1])).eta_max[0];
        assert.ok(s.eta_loss <= e + 1e-6, `ladder ${s.eta_loss} > exact ${e} (${t} N${N} ${ZL})`);
        assert.ok(e <= b + 2e-6, `exact ${e} > bound ${b}`);
      }
    }
  }
});

test('Global optimum: closed form bounds the ladders, and a long ladder approaches it', () => {
  const ZL = [0.5, 3], o = exactOpt(ZL, ZS, 30, 120);
  const s = ladder(8, ZL, ZS, 30, 120, 'free', { ntry: 20 });
  console.log('   closed form', (100 * o.eta_tot).toFixed(3), ' best N8', (100 * s.eta_tot).toFixed(3), o.case);
  assert.ok(s.eta_tot <= o.eta_tot + 1e-6);
  assert.ok(o.eta_tot - s.eta_tot < 0.03);
});

test('Geodesic field agrees with the closed form', () => {
  const t0 = Date.now();
  const g = geodesic({ ZL: [0.5, 3], Zs: ZS, QL: 30, QC: 120 });
  const o = exactOpt([0.5, 3], ZS, 30, 120);
  console.log(`   geodesic ${Date.now() - t0} ms, nodes ${g.nodes}, edges ${g.edges}, samples ${g.samples}, rms ${g.rms.toExponential(2)}, worst ${g.worst.toFixed(4)}, opt ${(100 * g.eta_tot_opt).toFixed(3)} vs ${(100 * o.eta_tot).toFixed(3)}, chain ${g.nparts} parts ${(100 * g.eta_exact).toFixed(3)}`);
  assert.ok(g.over <= 1e-4, `Dijkstra above closed form by ${g.over}`);
  assert.ok(g.median < 0.01, `median ${g.median}`);
  assert.ok(Math.abs(g.eta_tot_opt - o.eta_tot) < 0.01);
});

test('Netlist: format matches the MATLAB file, and nodal solve matches ABCD', () => {
  const c = readCir(path.join(CIRS, 'mc_p5.cir'));
  const ZL = [0.24044067, 90.559741];
  const t = netlistText(c.X, c.kind, c.Rser, ZL, ZS, F0, '5th percentile network, N = 400 Monte Carlo study');
  // MATLAB's file with the documented changes applied: no R_sw, node renamed
  const want = c.lines.filter(l => !l.startsWith('R_sw')).map(l => l.replace(/^(R_s V_src) N_src/, '$1 N_in'));
  const mine = t.lines.filter(l => !l.startsWith('.options'));
  const skip = /^\* (Z_L|eta_tot|expected|---)|^R_L|^L_L|^\.meas AC (P_load|Eta)/;
  let same = 0;
  mine.forEach((l, i) => {
    if (skip.test(l)) return;
    assert.equal(l.slice(0, 18), want[i].slice(0, 18), `line ${i}`);
    same++;
  });
  assert.ok(same > 12);
  assert.ok(Math.abs(nodalCheck(t.lines, F0) - t.eta) < 1e-7, `nodal ${nodalCheck(t.lines, F0)} vs ${t.eta}`);
  assert.ok(/SYMBOL cap/.test(ascText(c.X, c.kind, c.Rser, ZL, ZS, F0)));
});

test('Nodal check matches ABCD on mixed ladders', () => {
  const X = [12, -30, 44, -8, 5], kind = [1, 2, 1, 2, 1], R = esr(X, 40, 150);
  for (const [ZL, Zs] of [[[3, 7], [50, 0]], [[20, -15], [75, 12]], [[50, 0], [50, -3]]]) {
    const t = netlistText(X, kind, R, ZL, Zs, 1e8);
    assert.ok(Math.abs(nodalCheck(t.lines, 1e8) - t.eta) < 1e-7);
  }
});

/** Rebuild a circuit from .asc geometry alone: symbol pins, wires, flags. */
function ascToNetlist(asc, f0, Zs) {
  const pinsOf = { res: [[16, 16], [16, 96]], ind: [[16, 16], [16, 96]], cap: [[16, 0], [16, 64]], voltage: [[0, 16], [0, 96]] };
  const rot = (p, r) => (r === 'R90' ? [-p[1], p[0]] : p);
  const parent = new Map(), key = (x, y) => `${x},${y}`;
  const find = a => { if (!parent.has(a)) parent.set(a, a); while (parent.get(a) !== a) a = parent.get(a); return a; };
  const join = (a, b) => parent.set(find(a), find(b));
  const parts = [], grounds = [];
  let cur = null;
  for (const l of asc.split('\n')) {
    const t = l.split(' ');
    if (t[0] === 'WIRE') join(key(t[1], t[2]), key(t[3], t[4]));
    else if (t[0] === 'FLAG' && t[3] === '0') grounds.push(key(t[1], t[2]));
    else if (t[0] === 'SYMBOL') { cur = { sym: t[1], x: +t[2], y: +t[3], r: t[4], extra: '' }; parts.push(cur); }
    else if (t[0] === 'SYMATTR' && t[1] === 'InstName') cur.name = t[2];
    else if (t[0] === 'SYMATTR' && t[1] === 'Value') cur.value = t[2];
    else if (t[0] === 'SYMATTR' && t[1] === 'SpiceLine') cur.extra = t[2];
  }
  const nets = parts.map(p => pinsOf[p.sym].map(q => { const [a, b] = rot(q, p.r); return key(p.x + a, p.y + b); }));
  for (const g of grounds) join(g, 'GND');
  const ids = new Map([[find('GND'), '0']]);
  const net = k => { const r = find(k); if (!ids.has(r)) ids.set(r, `n${ids.size}`); return ids.get(r); };
  const lines = [`.param P_avail = ${1 / (8 * Zs[0])}`];
  parts.forEach((p, i) => {
    const [a, b] = nets[i].map(net);
    if (p.sym === 'voltage') lines.unshift(`V1 ${a} ${b} AC 1`);
    else {
      const name = p.name === 'R_L' ? 'R_L' : `${p.sym === 'res' ? 'R' : p.sym === 'cap' ? 'C' : 'L'}${i}`;
      lines.push(`${name} ${a} ${b} ${p.value} ${p.extra}`.trim());
    }
  });
  return nodalCheck(lines, f0);
}

test('.asc: pin geometry alone rebuilds a circuit with the same efficiency', () => {
  const cases = [
    [[-70, -8, -84], [1, 2, 1], [0.2404, 90.56], [50, 0]],
    [[-9, 22, -30, 14], [2, 1, 2, 1], [3, -12], [50, 10]],
    [[12, -30, 44], [1, 2, 1], [20, 0], [75, -6]],
  ];
  for (const [X, kind, ZL, Zs] of cases) {
    const R = esr(X, 50, 1000), f0 = 433e6;
    const g = gain(X, kind, R, ZL, Zs);
    const e = ascToNetlist(ascText(X, kind, R, ZL, Zs, f0), f0, Zs);
    assert.ok(Math.abs(e - g.eta_tot) < 1e-7, `asc ${e} vs ${g.eta_tot}`);
  }
});

test('Isolines: a radial field gives circles at the right radius', () => {
  const n = 121, xs = Float64Array.from({ length: n }, (_, i) => -2 + 4 * i / (n - 1)), z = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) z[i + n * j] = Math.hypot(xs[i], xs[j]);
  const [l] = isolines(z, xs, xs, [1.5]);
  assert.ok(l.seg.length > 400);
  for (let q = 0; q < l.seg.length; q += 2) assert.ok(Math.abs(Math.hypot(l.seg[q], l.seg[q + 1]) - 1.5) < 0.01);
  z[60 + n * 90] = NaN;
  assert.ok(isolines(z, xs, xs, [1.5])[0].seg.every(Number.isFinite));
});

test('C-format printers', () => {
  assert.equal(fmtE(433e6, 9), '4.330000000e+08');
  assert.equal(fmtE(1.07e-2, 9), '1.070000000e-02');
  assert.equal(fmtG(4.33e8), '4.33e+08');
  assert.equal(fmtG(0.240441), '0.240441');
  assert.equal(fmtG(90.559741), '90.5597');
  assert.equal(fmtG(50), '50');
  assert.deepEqual(nrange('2-4, 8'), [2, 3, 4, 8]);
  assert.deepEqual(nrange('3-9:2'), [3, 5, 7, 9]);
});

test('Monte Carlo: nominal recovered at zero tolerance, spread at nonzero', () => {
  const c = readCir(path.join(CIRS, 'mc_p5.cir'));
  const ZL = [0.24044067, 90.559741];
  const z = mcSingle(c, ZL, ZS, { tol: 0, n: 100 });
  assert.ok(Math.abs(z.stats.mean - c.expected) < 2e-6 && z.stats.sd < 1e-12);
  const m = mcSingle(c, ZL, ZS, { tol: 5, n: 4000 });
  assert.ok(m.stats.sd > 0 && m.stats.max > m.stats.min);
});

test('Tolerance sweep reproduces the slide: 5th-percentile network halves at +-2.5 / +-3.3 %', () => {
  const c = readCir(path.join(CIRS, 'mc_p5.cir'));
  const S = loadSet(N400);
  const r = tolSweep(c, S.R.slice(1), S.X.slice(1), ZS, QL, QC, { pct: 5, tmax: 15, nt: 601 });
  console.log('   half tolerance pct', r.half_pk.toFixed(2), 'mean', r.half_mean.toFixed(2));
  assert.ok(Math.abs(r.half_pk - 2.5) < 0.15, `${r.half_pk}`);
  assert.ok(Math.abs(r.half_mean - 3.3) < 0.15, `${r.half_mean}`);
});

test('Set design reproduces the study: 5th percentile, average, worst case', () => {
  const S = loadSet(N400);
  const cfg = { N: 2, topo: 'free', Zs: ZS, QL, QC, ntry: 20, pct: 5, target: 0.2, f0: F0 };
  const t0 = Date.now();
  const p = designSet(S, cfg, 'pct');
  const a = designSet(S, cfg, 'average', [p]);
  // the study's Average network and this one are different parts with the same efficiency
  const w0 = 2 * Math.PI * F0, cap = c => -1 / (w0 * c);
  const studyAvg = readCir(path.join(CIRS, 'mc_average.cir'));
  const e1 = scoreSet(studyAvg.X, studyAvg.kind, S, ZS, QL, QC, 5, 0.2).eta, e2 = a.score.eta;
  let dmax = 0;
  for (let i = 0; i < e1.length; i++) dmax = Math.max(dmax, Math.abs(e1[i] - e2[i]));
  console.log('   average networks:', studyAvg.X.map(x => (-1e12 / (w0 * x)).toFixed(3)), a.X.map(x => (-1e12 / (w0 * x)).toFixed(3)), 'max state difference', (100 * dmax).toFixed(5), 'points');
  void cap;
  const w = designSet(S, cfg, 'worst', [p, a]);
  console.log(`   ${Date.now() - t0} ms`);
  const show = (n, d) => console.log(`   ${n}: ${d.desc}  min ${(100 * d.score.min).toFixed(3)}  p5 ${(100 * d.score.pk).toFixed(3)}  mean ${(100 * d.score.mean).toFixed(3)}`);
  show('p5', p); show('avg', a); show('worst', w);
  const pf = p.X.map(x => 1e12 / (2 * Math.PI * F0 * Math.abs(x)));
  assert.equal(p.desc, 'Cs Cp');
  assert.ok(Math.abs(pf[0] - 4.75) < 0.01 && Math.abs(pf[1] - 34.3) < 0.1, `values ${pf}`);
  assert.ok(Math.abs(100 * p.score.pk - 14.478) < 0.002 && Math.abs(100 * p.score.mean - 23.823) < 0.002);
  assert.ok(a.score.mean >= 0.35230 - 2e-3, 'mean objective reached');
  assert.ok(w.score.min >= 0.07236 - 2e-3, 'worst-case objective reached');
});

test('Range set and L-section', () => {
  const S = rangeSet(1, 3, -5, 5, 5, 5);
  assert.equal(S.n, 25);
  const s = lsection([0.24044067, 90.559741], [50, 0], 50, 1000);
  assert.ok(s && s.eta_loss > 0.5);
  const g = gainq(s.X, s.kind, [0.24044067, 90.559741], ZS, 50, 1000);
  console.log('   L-section', describe(s.X, s.kind), (100 * g.eta_tot).toFixed(2), g.Zin);
  assert.ok(Math.abs(g.Zin[0] - 50) < 1e-6 && Math.abs(g.Zin[1]) < 1e-6);
});

// Written by test/matlab_crosscheck.m. Skipped until that script has been run.
const GOLD = path.join(import.meta.dirname, 'golden.json');
const gold = fs.existsSync(GOLD) ? JSON.parse(fs.readFileSync(GOLD, 'utf8')) : null;
const skip = !gold;

test('MATLAB cross-check: gain, closed form, bound, optimum', { skip }, () => {
  let dg = 0, dl = 0, dz = 0, dx = 0, db = 0, dopt = 0, worst = null;
  for (const c of gold.cases) {
    const kind = [].concat(c.kind), X = [].concat(c.X);
    const g = gainq(X, kind, c.ZL, c.Zs, c.QL, c.QC);
    dg = Math.max(dg, Math.abs(g.eta_tot - c.eta_tot));
    if (c.eta_loss != null) dl = Math.max(dl, Math.abs(g.eta_loss - c.eta_loss));
    dz = Math.max(dz, Math.hypot(g.Zin[0] - c.Zin[0], g.Zin[1] - c.Zin[1]) / Math.hypot(c.Zin[0], c.Zin[1]));
    const e = Math.abs(exact(c.ZL[0], c.ZL[1], c.Zt[0], c.Zt[1], c.QL, c.QC) - c.exact);
    if (e > dx) { dx = e; worst = c; }
    // the bound is not reported when the load's X/R is above the Q of the cancelling elements
    const b = bound(c.QL, c.QC, c.ZL, Float64Array.of(c.Zt[0]), Float64Array.of(c.Zt[1]));
    if (b.valid) db = Math.max(db, Math.abs(b.eta_max[0] - c.bound));
    dopt = Math.max(dopt, Math.abs(exactOpt(c.ZL, c.Zs, c.QL, c.QC).eta_tot - c.opt_eta));
  }
  console.log(`   MATLAB ${gold.version}, ${gold.cases.length} cases: gain ${dg.toExponential(1)}, eta_loss ${dl.toExponential(1)}, Zin rel ${dz.toExponential(1)}, exact ${dx.toExponential(1)}, bound ${db.toExponential(1)}, optimum ${dopt.toExponential(1)}`);
  assert.ok(dg < 1e-10 && dl < 1e-9 && dz < 1e-10, 'gain');
  assert.ok(dx < 1e-10, `exact ${dx} at ${JSON.stringify(worst && worst.Zt)}`);
  assert.ok(db < 1e-6, 'bound');
  assert.ok(dopt < 1e-5, 'optimum');
});

test('MATLAB cross-check: Dijkstra field, node by node', { skip }, () => {
  for (const g of gold.geo) {
    const c = gold.cases[g.i];
    const r = geo(c.ZL, c.Zs, c.QL, c.QC, { nu: g.nu, nt: g.nt, ring: 2, nmag: g.nmag });
    let d = 0, nb = 0, bad = 0;
    g.eta_loss.forEach((v, i) => {
      const w = Number.isFinite(r.eta_loss[i]) ? r.eta_loss[i] : -1, u = v === null ? -1 : v;
      const e = Math.abs(w - u);
      if (e > d) d = e;
      if (e > 1e-9) bad++;
      nb++;
    });
    console.log(`   case ${g.i}: ${nb} nodes, largest difference ${d.toExponential(2)}, nodes above 1e-9: ${bad}, optimum ${g.opt.toFixed(6)} / ${r.eta_tot_opt.toFixed(6)}`);
    assert.ok(d < 1e-9, `field difference ${d}`);
  }
});

test('MATLAB cross-check: netlist text, line by line', { skip }, () => {
  let lines = 0;
  for (const l of gold.net) {
    const c = gold.cases[l.i];
    const t = netlistText([].concat(c.X), [].concat(c.kind), [].concat(l.Rser), c.ZL, c.Zs, 1e8, 'cross-check');
    // the documented changes, applied to the MATLAB text
    const norm = x => x.filter(q => !/^(\.options|\* ---|R_sw|R_Lw)/.test(q ?? ''))
      .map(q => (q ?? '').replace(/^(L_[sL] .*) Rser=0$/, '$1').replace(/^(R_s V_src) N_src/, c.Zs[1] === 0 ? '$1 N_in' : '$1 N_src'));
    const A = norm(t.lines), B = norm(l.lines);
    assert.equal(A.length, B.length);
    A.forEach((a2, i) => { assert.equal(a2, B[i], `case ${l.i} line ${i}`); lines++; });
  }
  console.log(`   ${gold.net.length} netlists, ${lines} lines identical`);
});

test('MATLAB cross-check: ladder optimiser reaches the same efficiency', { skip }, () => {
  let lost = 0, gained = 0;
  for (const l of gold.lad) {
    const c = gold.cases[l.i];
    const s = ladder(l.N, c.ZL, c.Zs, c.QL, c.QC, l.topo, { ntry: 30 });
    const d = s.eta_tot - l.eta;
    lost = Math.max(lost, -d); gained = Math.max(gained, d);
  }
  console.log(`   ${gold.lad.length} ladders: largest shortfall ${(100 * lost).toFixed(4)} points, largest excess ${(100 * gained).toFixed(4)} points`);
  assert.ok(lost < 1e-3, `web ladder below MATLAB by ${lost}`);
});

// ------------------------------------------------------------ closed-form Z_opt
import { zopt } from '../src/engine/zopt.js';

test('Closed-form Z_opt reproduces Chappidi eq. 12-13 (inductor-only optimum)', () => {
  // Zs = 10 - j20, Z_L = 30, Q_ind = 5: Zin,opt = Rs (2 Q Qs + Q^2 - 1, Q^2 Qs - Qs - 2 Q)/(1 + Q^2)
  const Q = 5, Qs = 2, Rs = 10, o = zopt([30, 0], [10, -20], Q, 1e9);
  assert.ok(Math.abs(o.Zin[0] - Rs * (2 * Q * Qs + Q * Q - 1) / (1 + Q * Q)) < 1e-9);
  assert.ok(Math.abs(o.Zin[1] - Rs * (Q * Q * Qs - Qs - 2 * Q) / (1 + Q * Q)) < 1e-9);
  assert.ok(Math.abs(o.eta_tot - (1 + Q * Q) / (Q * (Q + Qs))) < 1e-12);
});

test('Closed-form Z_opt is never below the numerical search, over random problems', () => {
  let seed = 20261109;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const lr = (a, b) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * rnd());
  let worst = 0;
  for (let k = 0; k < 300; k++) {
    const QL = lr(2, 200), QC = lr(2, 400), RL = lr(0.05, 500);
    const tL = rnd() < 0.25 ? 0 : (rnd() < 0.15 ? -lr(QC * 1.01, QC * 50) : Math.tan((rnd() - 0.5) * Math.PI * 0.98));
    const Rs = lr(1, 100), ts = rnd() < 0.3 ? 0 : Math.tan((rnd() - 0.5) * Math.PI * 0.9);
    const a = zopt([RL, RL * tL], [Rs, Rs * ts], QL, QC), b = exactOpt([RL, RL * tL], [Rs, Rs * ts], QL, QC);
    // the returned point is real: its efficiency is the exact closed form at that Z_in
    const ar = a.Zin[0] + Rs, ai = a.Zin[1] + Rs * ts;
    const chk = exact(RL, RL * tL, a.Zin[0], a.Zin[1], QL, QC) * 4 * a.Zin[0] * Rs / (ar * ar + ai * ai);
    assert.ok(Math.abs(chk - a.eta_tot) < 1e-12);
    worst = Math.max(worst, b.eta_tot - a.eta_tot);
  }
  assert.ok(worst < 1e-9, `closed form below search by ${worst}`);
});
