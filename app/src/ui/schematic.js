// Schematic drawn from the netlist parts, so drawing and export cannot differ.
// Text is laid out at fixed size: a long ladder scrolls, it never shrinks.
import { eng } from '../engine/core.js';

const COL = 176, TOP = 128, BOT = 296, INK = '#14171c', INK2 = '#434a55';
const T1 = 17, T2 = 16;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const wire = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
const dot = (x, y) => `<circle cx="${x}" cy="${y}" r="3.6" fill="${INK}" stroke="none"/>`;
const txt = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size || T2}" font-weight="${o.w || 400}" fill="${o.fill || INK}" text-anchor="${o.a || 'middle'}" stroke="none">${esc(s)}</text>`;

function symbol(type, x, y, vertical, ref) {
  // symbol centred at (x, y); leads run 32 px each way along the axis
  const r = vertical ? `rotate(90 ${x} ${y})` : '';
  let body = '';
  if (type === 'L') {
    let d = `M ${x - 32} ${y}`;
    for (let i = 0; i < 4; i++) d += ` a 8 8 0 0 1 16 0`;
    body = `<path d="${d}" fill="none"/>`;
  } else if (type === 'C') {
    body = wire(x - 32, y, x - 6, y) + wire(x + 6, y, x + 32, y) +
      `<line x1="${x - 6}" y1="${y - 15}" x2="${x - 6}" y2="${y + 15}" stroke-width="2.6"/>` +
      `<line x1="${x + 6}" y1="${y - 15}" x2="${x + 6}" y2="${y + 15}" stroke-width="2.6"/>`;
  } else if (type === 'R') {
    const pts = [[-32, 0], [-24, 0], [-20, -9], [-12, 9], [-4, -9], [4, 9], [12, -9], [20, 9], [24, 0], [32, 0]];
    body = `<polyline points="${pts.map(p => `${x + p[0]},${y + p[1]}`).join(' ')}" fill="none"/>`;
  }
  return `<g transform="${r}" data-ref="${ref || ''}">${body}</g>`;
}
function ground(x, y) {
  return wire(x, y, x, y + 12) + wire(x - 14, y + 12, x + 14, y + 12) + wire(x - 9, y + 18, x + 9, y + 18) + wire(x - 4, y + 24, x + 4, y + 24);
}

/** net: X, kind, Rser, comps; p: { ZL, Zs, f0 } */
export function schematicSVG(net, p, opts = {}) {
  const w0 = 2 * Math.PI * p.f0, cs = net.comps, n = cs.length;
  const order = cs.slice().reverse();     // source side first
  const srcX = 76;
  let x = 170;
  const parts = [], lab = [];
  // source series parts
  const srcParts = [{ t: 'R', ref: 'R_s', v: eng(p.Zs[0], 'Ω') }];
  if (Math.abs(p.Zs[1]) > 1e-15) {
    const isL = p.Zs[1] > 0;
    srcParts.push({ t: isL ? 'L' : 'C', ref: isL ? 'L_s' : 'C_s', v: isL ? eng(p.Zs[1] / w0, 'H') : eng(1 / (w0 * Math.abs(p.Zs[1])), 'F') });
  }
  parts.push(wire(srcX, TOP, x - 32, TOP));
  for (const s of srcParts) {
    parts.push(symbol(s.t, x, TOP, false));
    lab.push(txt(x, TOP - 40, s.ref, { size: T1, w: 600 }), txt(x, TOP - 19, s.v));
    x += COL - 40;
    parts.push(wire(x - COL + 40 + 32, TOP, x - 32, TOP));
  }
  const netStart = x - 44;
  let lastX = x - 32;
  x += 34;
  const nodes = [];
  for (const c of order) {
    const cx = x;
    if (c.place === 'Series') {
      parts.push(wire(lastX, TOP, cx - 32, TOP), symbol(c.type, cx, TOP, false, c.ref));
      lab.push(txt(cx, TOP - 58, c.ref, { size: T1, w: 600 }), txt(cx, TOP - 38, eng(c.value, c.unit)), txt(cx, TOP - 19, `ESR ${eng(c.Rser, 'Ω', 3)}`, { fill: INK2 }));
      lastX = cx + 32;
    } else {
      const my = (TOP + BOT) / 2;
      parts.push(wire(lastX, TOP, cx, TOP), dot(cx, TOP), dot(cx, BOT), wire(cx, TOP, cx, my - 32), symbol(c.type, cx, my, true, c.ref), wire(cx, my + 32, cx, BOT));
      lab.push(txt(cx + 26, my - 22, c.ref, { size: T1, w: 600, a: 'start' }), txt(cx + 26, my - 1, eng(c.value, c.unit), { a: 'start' }), txt(cx + 26, my + 20, `ESR ${eng(c.Rser, 'Ω', 3)}`, { a: 'start', fill: INK2 }));
      lastX = cx;
    }
    x += COL;
    nodes.push(cx);
  }
  const netEnd = x - 58;
  // load: series R then reactance, drawn vertically at the right
  const lx = x + 8;
  parts.push(wire(lastX, TOP, lx, TOP));
  const hasX = Math.abs(p.ZL[1]) > 1e-15;
  const isLL = p.ZL[1] > 0;
  const ry = hasX ? TOP + 46 : (TOP + BOT) / 2, xy = TOP + 118;
  parts.push(wire(lx, TOP, lx, ry - 32), symbol('R', lx, ry, true));
  lab.push(txt(lx + 26, ry - 4, 'R_L', { size: T1, w: 600, a: 'start' }), txt(lx + 26, ry + 15, eng(p.ZL[0], 'Ω'), { a: 'start' }));
  if (hasX) {
    parts.push(wire(lx, ry + 32, lx, xy - 32), symbol(isLL ? 'L' : 'C', lx, xy, true), wire(lx, xy + 32, lx, BOT));
    lab.push(txt(lx + 26, xy - 4, isLL ? 'L_L' : 'C_L', { size: T1, w: 600, a: 'start' }),
      txt(lx + 26, xy + 15, isLL ? eng(p.ZL[1] / w0, 'H') : eng(1 / (w0 * Math.abs(p.ZL[1])), 'F'), { a: 'start' }));
  } else parts.push(wire(lx, ry + 32, lx, BOT));
  // source and return rail
  const SY = (TOP + BOT) / 2;
  parts.push(wire(srcX, TOP, srcX, SY - 21), `<circle cx="${srcX}" cy="${SY}" r="21" fill="#fff"/>`,
    `<path d="M ${srcX - 11} ${SY} q 5.5 -13 11 0 t 11 0" fill="none"/>`, wire(srcX, SY + 21, srcX, BOT), wire(srcX, BOT, lx, BOT), ground((srcX + lx) / 2, BOT));
  lab.push(txt(srcX - 28, SY - 4, 'V1', { size: T1, w: 600, a: 'end' }), txt(srcX - 28, SY + 16, '1 V', { a: 'end' }));
  const W = lx + 126, H = BOT + 40;
  const bands = [
    [14, netStart - 14, '#f2f4f7', 'Source'],
    [netStart, netEnd - netStart, '#e6eefa', `Matching network, ${n} element${n === 1 ? '' : 's'}`],
    [netEnd, W - netEnd - 8, '#f2f4f7', 'Load'],
  ].map(([bx, bw, f, t]) => `<rect x="${bx}" y="6" width="${bw}" height="${H - 12}" fill="${f}" stroke="none"/>${txt(bx + 8, 26, t, { a: 'start', w: 600, size: T2, fill: INK2 })}`);
  const planes = [netStart, netEnd].map(px => `<line x1="${px}" y1="6" x2="${px}" y2="${H - 6}" stroke="#8d95a1" stroke-dasharray="5 4" stroke-width="1"/>`);
  const scale = opts.scale || 1;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * scale}" height="${H * scale}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Arial, sans-serif" role="img" aria-label="Schematic of the matching network">
<rect width="${W}" height="${H}" fill="#fff"/>${bands.join('')}${planes.join('')}
<g stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round">${parts.join('')}</g>${lab.join('')}</svg>`;
}
