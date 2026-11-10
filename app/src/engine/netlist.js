// LTspice writers and an independent nodal check.
// netlistText is a port of mn_netlist_text with three changes, each measured in
// LTspice 24.1.7:
//   - No 1e-12 ohm wire resistors (R_sw, R_Lw). A conductance of 1e12 degrades the
//     solved matrix: efficiency read 21.04 % where the exact value is 21.10 %.
//     A real source or load now connects directly.
//   - .options meascplxfmt=cartesian, since .meas otherwise prints in dB.
//   - Rser=0 on ideal source and load inductors, since the default is not zero.
import { gain, fmtE, fmtG, sgn, refdes } from './core.js';

const e9 = v => fmtE(v, 9);
const zfmt = (z, p) => `${fmtG(z[0], p)}${sgn(fmtG(z[1], p), z[1])}j`;

export function netlistText(X, kind, Rser, ZL, Zs, f0, note = '') {
  const w0 = 2 * Math.PI * f0, Rs = Zs[0], RL = ZL[0];
  const g = gain(X, kind, Rser, ZL, Zs), eta = g.eta_tot, Zin = g.Zin;
  const P = 1 / (8 * Rs), L = [], parts = [];
  const add = (line, p) => { L.push(line); if (p) parts.push({ ...p, line: L.length - 1 }); };
  L.push(`* Matching network, ${X.length} element(s)${note ? `  --  ${note}` : ''}`);
  L.push(`* Z_L = ${zfmt(ZL, 6)}   Z_s = ${zfmt(Zs, 6)}   f0 = ${fmtG(f0, 6)} Hz`);
  L.push(`* eta_tot = ${(eta * 100).toFixed(4)} %   Z_in = ${Zin[0].toFixed(4)}${sgn(Zin[1].toFixed(4), Zin[1])}j`);
  L.push('* Element ESR is written as Rser= on each part, matching the ABCD model.');
  L.push(`.param f0 = ${e9(f0)}`);
  L.push(`.param P_avail = ${e9(P)}`);
  L.push('');
  add('V1 V_src 0 AC 1', { name: 'V1', type: 'V', n1: 'V_src', n2: '0', role: 'source' });
  const Xs = Zs[1], srcX = Math.abs(Xs) > 1e-15, n1 = srcX ? 'N_src' : 'N_in';
  add(`R_s V_src ${n1} ${e9(Rs)}`, { name: 'R_s', type: 'R', n1: 'V_src', n2: n1, value: Rs, role: 'source' });
  if (Xs > 1e-15) add(`L_s N_src N_in ${e9(Xs / w0)} Rser=0`, { name: 'L_s', type: 'L', n1: 'N_src', n2: 'N_in', value: Xs / w0, role: 'source' });
  else if (Xs < -1e-15) add(`C_s N_src N_in ${e9(1 / (w0 * Math.abs(Xs)))}`, { name: 'C_s', type: 'C', n1: 'N_src', n2: 'N_in', value: 1 / (w0 * Math.abs(Xs)), role: 'source' });
  let node = 'N_in', nc = 0;
  const names = refdes(X, kind);
  for (let i = X.length - 1; i >= 0; i--) {
    const Xi = X[i], Ri = Rser[i], isL = Xi > 0, nm = names[i];
    const val = isL ? Xi / w0 : 1 / (w0 * Math.abs(Xi));
    if (kind[i] === 1) {
      const nxt = `N_${++nc}`;
      add(`${nm} ${node} ${nxt} ${e9(val)} Rser=${e9(Ri)}`, { name: nm, type: isL ? 'L' : 'C', n1: node, n2: nxt, value: val, Rser: Ri, role: 'network', place: 'series', idx: i });
      node = nxt;
    } else {
      add(`${nm} ${node} 0 ${e9(val)} Rser=${e9(Ri)}`, { name: nm, type: isL ? 'L' : 'C', n1: node, n2: '0', value: val, Rser: Ri, role: 'network', place: 'shunt', idx: i });
    }
  }
  const XL = ZL[1], ld = Math.abs(XL) > 1e-15 ? 'N_ld' : '0';
  add(`R_L ${node} ${ld} ${e9(RL)}`, { name: 'R_L', type: 'R', n1: node, n2: ld, value: RL, role: 'load' });
  if (XL > 1e-15) add(`L_L N_ld 0 ${e9(XL / w0)} Rser=0`, { name: 'L_L', type: 'L', n1: 'N_ld', n2: '0', value: XL / w0, role: 'load' });
  else if (XL < -1e-15) add(`C_L N_ld 0 ${e9(1 / (w0 * Math.abs(XL)))}`, { name: 'C_L', type: 'C', n1: 'N_ld', n2: '0', value: 1 / (w0 * Math.abs(XL)), role: 'load' });
  L.push('');
  L.push('* --- results print as (real,imaginary), in linear units ---');
  L.push('.options meascplxfmt=cartesian');
  L.push(`.meas AC I_re FIND re(I(R_L)) AT=${e9(f0)}`);
  L.push(`.meas AC I_im FIND im(I(R_L)) AT=${e9(f0)}`);
  L.push(`.meas AC P_load PARAM 0.5*(I_re*I_re+I_im*I_im)*${e9(RL)}`);
  L.push(`.meas AC P_avs  PARAM ${e9(P)}`);
  L.push(`.meas AC Eta      PARAM (0.5*(I_re*I_re+I_im*I_im)*${e9(RL)})/${e9(P)}`);
  L.push(`.meas AC Eta_pct  PARAM 100*(0.5*(I_re*I_re+I_im*I_im)*${e9(RL)})/${e9(P)}`);
  L.push(`* expected: Eta = ${eta.toFixed(6)}  (Eta_pct = ${(eta * 100).toFixed(4)})`);
  L.push(`.ac dec 401 ${e9(f0 / 10)} ${e9(f0 * 10)}`);
  L.push('.end');
  return { lines: L, parts, eta, Zin };
}

/** Independent check: parse the netlist text and solve it by nodal analysis at
 *  f0. Shares no code with the ABCD cascade. Returns the efficiency it finds. */
export function nodalCheck(lines, f0) {
  const w = 2 * Math.PI * f0, nodes = new Map([['0', -1]]), br = [];
  let vnode = null, Rl = null, Pav = null;
  const id = n => { if (!nodes.has(n)) nodes.set(n, nodes.size - 1); return nodes.get(n); };
  for (const raw of lines) {
    const l = raw.trim();
    if (!l || l[0] === '*') continue;
    if (l[0] === '.') {
      const m = l.match(/^\.param P_avail = (.*)$/);
      if (m) Pav = parseFloat(m[1]);
      continue;
    }
    const t = l.split(/\s+/);
    const [name, n1, n2, val] = t;
    if (name === 'V1') { vnode = id(n1); id(n2); continue; }
    const v = parseFloat(val), rs = t[4] ? parseFloat(t[4].split('=')[1]) : 0;
    let z;
    if (name[0] === 'R') z = [v, 0];
    else if (name[0] === 'L') z = [rs, w * v];
    else if (name[0] === 'C') z = [rs, -1 / (w * v)];
    else throw new Error(`Unknown element ${name}`);
    const d = z[0] * z[0] + z[1] * z[1];
    const b = { a: id(n1), b: id(n2), y: [z[0] / d, -z[1] / d], z };
    br.push(b);
    if (name === 'R_L') Rl = b;
  }
  // A 1e-12 ohm wire would swamp the matrix, so wires merge their two nodes.
  const parent = new Map();
  const find = i => { while (parent.has(i)) i = parent.get(i); return i; };
  for (const b of br) {
    if (b.z[0] ** 2 + b.z[1] ** 2 < 1e-18) {
      const [p, q] = [find(b.a), find(b.b)];
      if (p !== q) { if (p === -1 || p === vnode) parent.set(q, p); else parent.set(p, q); }
    }
  }
  const wires = br.filter(b => b.z[0] ** 2 + b.z[1] ** 2 < 1e-18);
  for (const w of wires) br.splice(br.indexOf(w), 1);
  for (const b of br) { b.a = find(b.a); b.b = find(b.b); }
  vnode = find(vnode);
  for (const [k, v] of nodes) nodes.set(k, find(v));
  // unknowns: every node except ground and the driven node
  const free = [...new Set(nodes.values())].filter(i => i >= 0 && i !== vnode);
  const pos = new Map(free.map((n, i) => [n, i]));
  const n = free.length;
  const A = Array.from({ length: n }, () => new Float64Array(2 * n + 2));
  const stamp = (r, c, y, s) => { A[r][2 * c] += s * y[0]; A[r][2 * c + 1] += s * y[1]; };
  for (const b of br) {
    const ia = pos.get(b.a), ib = pos.get(b.b);
    if (ia !== undefined) {
      stamp(ia, ia, b.y, 1);
      if (ib !== undefined) stamp(ia, ib, b.y, -1);
      else if (b.b === vnode) { A[ia][2 * n] += b.y[0]; A[ia][2 * n + 1] += b.y[1]; }
    }
    if (ib !== undefined) {
      stamp(ib, ib, b.y, 1);
      if (ia !== undefined) stamp(ib, ia, b.y, -1);
      else if (b.a === vnode) { A[ib][2 * n] += b.y[0]; A[ib][2 * n + 1] += b.y[1]; }
    }
  }
  // complex Gaussian elimination with partial pivoting
  for (let c = 0; c < n; c++) {
    let p = c, m = 0;
    for (let r = c; r < n; r++) { const v = Math.hypot(A[r][2 * c], A[r][2 * c + 1]); if (v > m) { m = v; p = r; } }
    [A[c], A[p]] = [A[p], A[c]];
    const pr = A[c][2 * c], pi = A[c][2 * c + 1], d = pr * pr + pi * pi;
    for (let r = c + 1; r < n; r++) {
      const ar = A[r][2 * c], ai = A[r][2 * c + 1];
      const fr = (ar * pr + ai * pi) / d, fi = (ai * pr - ar * pi) / d;
      for (let k = c; k <= n; k++) {
        const br_ = A[c][2 * k], bi_ = A[c][2 * k + 1];
        A[r][2 * k] -= fr * br_ - fi * bi_; A[r][2 * k + 1] -= fr * bi_ + fi * br_;
      }
    }
  }
  const V = new Float64Array(2 * n);
  for (let r = n - 1; r >= 0; r--) {
    let sr = A[r][2 * n], si = A[r][2 * n + 1];
    for (let k = r + 1; k < n; k++) {
      const a = A[r][2 * k], b = A[r][2 * k + 1], c = V[2 * k], e = V[2 * k + 1];
      sr -= a * c - b * e; si -= a * e + b * c;
    }
    const pr = A[r][2 * r], pi = A[r][2 * r + 1], d = pr * pr + pi * pi;
    V[2 * r] = (sr * pr + si * pi) / d; V[2 * r + 1] = (si * pr - sr * pi) / d;
  }
  const volt = i => (i === vnode ? [1, 0] : i === -1 ? [0, 0] : [V[2 * pos.get(i)], V[2 * pos.get(i) + 1]]);
  const va = volt(Rl.a), vb = volt(Rl.b);
  const ir = (va[0] - vb[0]) / Rl.z[0], ii = (va[1] - vb[1]) / Rl.z[0];
  return 0.5 * (ir * ir + ii * ii) * Rl.z[0] / Pav;
}

/** LTspice schematic (.asc). Pin offsets are those of the stock res, cap, ind
 *  and voltage symbols. Layout runs left to right from the source. */
export function ascText(X, kind, Rser, ZL, Zs, f0) {
  const w0 = 2 * Math.PI * f0, names = refdes(X, kind), g = 16;
  const W = [], S = [], F = [];
  const wire = (x1, y1, x2, y2) => { if (x1 !== x2 || y1 !== y2) W.push(`WIRE ${x1} ${y1} ${x2} ${y2}`); };
  const ground = (x, y) => F.push(`FLAG ${x} ${y} 0`);
  const label = (x, y, n) => F.push(`FLAG ${x} ${y} ${n}`);
  // a horizontal two-terminal part between (x, y) and (x + pitch, y)
  const hpart = (sym, name, value, x, y, extra) => {
    const pitch = 96;
    // R90 maps symbol pin (px, py) to (X - py, Y + px)
    const top = sym === 'cap' ? 0 : 16, bot = sym === 'cap' ? 64 : 96;
    const Xo = x + bot, Yo = y - 16;     // pin "bot" lands on x, pin "top" lands to the right
    S.push(`SYMBOL ${sym} ${Xo} ${Yo} R90`);
    S.push('WINDOW 0 0 56 VBottom 2');
    S.push('WINDOW 3 32 56 VTop 2');
    S.push(`SYMATTR InstName ${name}`);
    S.push(`SYMATTR Value ${value}`);
    if (extra) S.push(`SYMATTR SpiceLine ${extra}`);
    const span = bot - top;
    wire(x + span, y, x + pitch + 32, y);
    return x + pitch + 32;
  };
  // a vertical two-terminal part hanging from (x, y) to ground
  const vpart = (sym, name, value, x, y, extra) => {
    const top = sym === 'cap' ? 0 : 16, bot = sym === 'cap' ? 64 : 96;
    const Xo = x - 16, Yo = y + 32 - top;
    S.push(`SYMBOL ${sym} ${Xo} ${Yo} R0`);
    S.push(`SYMATTR InstName ${name}`);
    S.push(`SYMATTR Value ${value}`);
    if (extra) S.push(`SYMATTR SpiceLine ${extra}`);
    wire(x, y, x, y + 32);
    const yb = y + 32 + (bot - top);
    wire(x, yb, x, yb + 16);
    ground(x, yb + 16);
  };
  const y0 = 0;
  // source: voltage symbol pins at (0,16) and (0,96)
  let x = 0;
  S.push(`SYMBOL voltage ${x} ${y0 - 16} R0`);
  S.push('WINDOW 123 24 124 Left 2');
  S.push('WINDOW 39 0 0 Left 0');
  S.push('SYMATTR InstName V1');
  S.push('SYMATTR Value 0');
  S.push('SYMATTR Value2 AC 1');
  ground(x, y0 + 80 + 16); wire(x, y0 + 80, x, y0 + 96);
  x = hpart('res', 'Rs', fmtE(Zs[0], 9), x, y0);
  if (Zs[1] > 1e-15) x = hpart('ind', 'Ls', fmtE(Zs[1] / w0, 9), x, y0, 'Rser=0');
  else if (Zs[1] < -1e-15) x = hpart('cap', 'Cs', fmtE(1 / (w0 * Math.abs(Zs[1])), 9), x, y0);
  label(x, y0, 'N_in');
  for (let i = X.length - 1; i >= 0; i--) {
    const isL = X[i] > 0, sym = isL ? 'ind' : 'cap', val = isL ? X[i] / w0 : 1 / (w0 * Math.abs(X[i]));
    const extra = `Rser=${fmtE(Rser[i], 9)}`;
    if (kind[i] === 1) x = hpart(sym, names[i], fmtE(val, 9), x, y0, extra);
    else { vpart(sym, names[i], fmtE(val, 9), x, y0, extra); wire(x, y0, x + 64, y0); x += 64; }
  }
  x = hpart('res', 'R_L', fmtE(ZL[0], 9), x, y0);
  if (Math.abs(ZL[1]) > 1e-15) label(x, y0, 'N_ld');
  if (ZL[1] > 1e-15) vpart('ind', 'L_L', fmtE(ZL[1] / w0, 9), x, y0, 'Rser=0');
  else if (ZL[1] < -1e-15) vpart('cap', 'C_L', fmtE(1 / (w0 * Math.abs(ZL[1])), 9), x, y0);
  else { wire(x, y0, x, y0 + 48); ground(x, y0 + 48); }
  const RLs = fmtE(ZL[0], 9), Pav = fmtE(1 / (8 * Zs[0]), 9), fs = fmtE(f0, 9);
  const dir = [
    '.options meascplxfmt=cartesian',
    `.ac dec 401 ${fmtE(f0 / 10, 9)} ${fmtE(f0 * 10, 9)}`,
    `.meas AC I_re FIND re(I(R_L)) AT=${fs}`,
    `.meas AC I_im FIND im(I(R_L)) AT=${fs}`,
    `.meas AC Eta_pct PARAM 100*(0.5*(I_re*I_re+I_im*I_im)*${RLs})/${Pav}`,
  ].map((d, i) => `TEXT 0 ${y0 + 176 + 32 * i} Left 2 !${d}`);
  return ['Version 4', `SHEET 1 ${Math.max(880, x + 200)} 480`, ...W, ...F, ...S, ...dir].join('\n') + '\n';
}
