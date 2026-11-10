// Pieces shared by the pages.
import { trace } from '../engine/core.js';
import { z2gamma } from '../engine/field.js';
import { zfmt, TOPO_STYLE, METHOD_STYLE, COLOR, pc } from './plot.js';
import { eng } from '../engine/core.js';

export const styleOf = n => (n.group === 'set' ? METHOD_STYLE[n.method] : TOPO_STYLE[n.topo]) || TOPO_STYLE.free;

export const gam = (z, Z0) => z2gamma(z[0], z[1], Z0);

/** Elements from the port to the load, as written on the slides. */
export const elemStr = n => n.comps.slice().reverse().map(c => `${c.place} ${c.type} ${eng(c.value, c.unit, 3)}`).join(', ');

/** Traces and hover targets of one network path. */
export function pathTraces(net, Z0, { main = true, annotate = true } = {}) {
  const st = styleOf(net);
  const t = trace(net.X, net.kind, net.Rser, net.ZL);
  const gx = [], gy = [];
  for (let i = 0; i < t.re.length; i++) { const g = gam([t.re[i], t.im[i]], Z0); gx.push(g[0]); gy.push(g[1]); }
  const w = main ? 3.4 : 2;
  const traces = [
    { x: gx, y: gy, type: 'scatter', mode: 'lines', line: { color: '#fff', width: w + 3.4 }, hoverinfo: 'skip', showlegend: false, legendgroup: net.name },
    { x: gx, y: gy, type: 'scatter', mode: 'lines', name: net.name, line: { color: st.color, width: w, dash: main ? 'solid' : st.dash }, hoverinfo: 'skip', showlegend: true, legendgroup: net.name },
  ];
  const nx = t.nodes.map(i => gx[i]), ny = t.nodes.map(i => gy[i]);
  traces.push({ x: nx, y: ny, type: 'scatter', mode: 'markers', marker: { size: main ? 10 : 8, color: '#fff', line: { color: st.color, width: 2.4 }, symbol: st.symbol }, hoverinfo: 'skip', showlegend: false, legendgroup: net.name });
  const hover = [], ann = [];
  const order = net.comps;
  for (let k = 0; k < order.length; k++) {
    const c = order[k], a = t.nodes[k], b = t.nodes[k + 1];
    for (let i = a; i <= b; i += 3) {
      hover.push({ gx: gx[i], gy: gy[i], title: `${net.name}: ${c.ref}`, rows: [['Element', `${c.place} ${c.type} ${eng(c.value, c.unit, 4)}`]] });
    }
    if (main && annotate) {
      const m = Math.floor((a + b) / 2);
      ann.push({ x: gx[m], y: gy[m], text: c.ref, showarrow: false, font: { size: 14, color: '#14171c' }, bgcolor: '#fff', bordercolor: st.color, borderwidth: 1, borderpad: 2 });
    }
  }
  return { traces, hover, ann };
}

/** Labelled reference points on the chart. */
export function pointTrace(z, Z0, label, opt = {}) {
  const g = gam(z, Z0);
  const trace_ = { x: [g[0]], y: [g[1]], type: 'scatter', mode: 'markers', marker: { size: opt.size || 13, color: opt.color || COLOR.ink, symbol: opt.symbol || 'circle', line: { color: '#fff', width: 1.6 } }, hoverinfo: 'skip', showlegend: false };
  const ann = { x: g[0], y: g[1], text: `<b>${label}</b>`, showarrow: true, arrowhead: 0, arrowwidth: 1, arrowcolor: '#6b7380', ax: opt.ax ?? 26, ay: opt.ay ?? -24, font: { size: 15, color: '#14171c' }, bgcolor: 'rgba(255,255,255,.92)', borderpad: 2 };
  const hover = { gx: g[0], gy: g[1], title: opt.title || label, rows: opt.rows || [] };
  return { trace: trace_, ann, hover };
}

export function problemTitle(p) {
  return `Z<sub>0</sub> = ${+p.Z0.toPrecision(5)} Ω`;
}

export const kpi = (l, n, small) => `<div class="kpi"><div class="l">${l}</div><div class="n ${small ? 's' : ''}">${n}</div></div>`;

export function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(text instanceof Blob ? text : new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const safeName = s => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');

export { zfmt, pc };

/** Segmented control. */
export function seg(el, onChange) {
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    el.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    onChange(b.dataset.v);
  });
}
