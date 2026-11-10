import { S, isCurrent, gridN } from './shell.js';
import { activate } from './ws_single.js';
import { Smith } from './smith.js';
import { pathTraces, pointTrace, problemTitle, kpi, zfmt, pc, styleOf } from './common.js';
import { COLOR, draw, layout } from './plot.js';
import { z2gamma } from '../engine/field.js';

let smith, el, opts = { all: false, geo: false, nodes: false };

export const designTab = {
  mount(page) {
    page.innerHTML = `<div class="design">
      <div class="card left">
        <div class="toolbar" style="margin-bottom:6px">
          <label class="chk"><input type="checkbox" id="d_all"> All networks</label>
          <label class="chk"><input type="checkbox" id="d_geo"> Dijkstra path</label>
          <label class="chk"><input type="checkbox" id="d_nodes"> Grid nodes</label>
          <button class="btn" id="d_zoom" style="margin-left:auto">Zoom to path</button>
          <button class="btn" id="d_reset">Full chart</button>
        </div>
        <div class="smith" id="d_smith"></div>
      </div>
      <div class="right">
        <div class="kpis" id="d_kpis"></div>
        <div class="card"><h3>Networks</h3><div class="tw" id="d_table"></div></div>
        <div class="card"><h3>Any LC ladder, closed form</h3><div class="tw" id="d_ref"></div></div>
        <div class="card"><h3>Dijkstra network at each grid</h3><div class="tw" id="d_grid"></div><div class="plot" id="d_gplot" style="height:340px;min-height:0"></div></div>
      </div></div>`;
    el = page;
    smith = new Smith(page.querySelector('#d_smith'));
    page.querySelector('#d_all').addEventListener('change', e => { opts.all = e.target.checked; drawSmith(); });
    page.querySelector('#d_geo').addEventListener('change', e => { opts.geo = e.target.checked; drawSmith(); });
    page.querySelector('#d_nodes').addEventListener('change', e => { opts.nodes = e.target.checked; drawSmith(); });
    page.querySelector('#d_reset').addEventListener('click', () => smith.reset());
    page.querySelector('#d_zoom').addEventListener('click', () => {
      const n = S.single.active; if (!n) return;
      const pts = [n.ZL, n.Zin, [n.p.Zs[0], -n.p.Zs[1]]].map(z => z2gamma(z[0], z[1], n.p.Z0));
      const xs = pts.map(a => a[0]), ys = pts.map(a => a[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const m = Math.max(x1 - x0, y1 - y0, 0.02) * 0.14;
      smith.zoomTo({ x0: x0 - m, x1: x1 + m, y0: y0 - m, y1: y1 + m });
    });
    page.querySelector('#d_table').addEventListener('click', e => {
      const r = e.target.closest('tr[data-id]');
      if (r) activate(S.single.nets.find(n => n.id === r.dataset.id));
    });
  },
  render() { drawKpis(); drawTable(); drawGrid(); drawSmith(); },
};

function drawSmith() {
  const n = S.single.active, p = n ? n.p : S.single.p;
  if (!p) return;
  const Z0 = p.Z0, traces = [], hover = [], ann = [];
  if (opts.all) {
    for (const m of S.single.nets) {
      if (n && m.id === n.id) continue;
      const a = pathTraces(m, Z0, { main: false });
      traces.push(...a.traces); hover.push(...a.hover);
    }
  }
  if (opts.nodes && S.single.geo && S.single.geo.gridR) {
    const g = S.single.geo, gx = [], gy = [];
    for (let i = 0; i < g.gridR.length; i++) { const q = z2gamma(g.gridR[i], g.gridX[i], Z0); gx.push(q[0]); gy.push(q[1]); }
    traces.push({ x: gx, y: gy, type: 'scatter', mode: 'markers', name: `Grid nodes, ${g.nu} × ${g.nt}${g.stride > 1 ? `, 1 in ${g.stride * g.stride} shown` : ''}`, marker: { size: 2.6, color: 'rgba(40,50,65,.5)' }, hoverinfo: 'skip' });
  }
  if (opts.geo && S.single.geo && S.single.geo.path) {
    const g = S.single.geo.path.map(z => z2gamma(z[0], z[1], Z0));
    traces.push({ x: g.map(a => a[0]), y: g.map(a => a[1]), type: 'scatter', mode: 'lines', name: 'Dijkstra path', line: { color: COLOR.ink, width: 2, dash: 'dot' }, hoverinfo: 'skip' });
    g.forEach((a, i) => { if (i % 2 === 0) hover.push({ gx: a[0], gy: a[1], title: 'Dijkstra path', rows: [] }); });
  }
  if (n) {
    const a = pathTraces(n, Z0);
    traces.push(...a.traces); hover.push(...a.hover); ann.push(...a.ann);
  }
  const zl = n ? n.ZL : p.ZL;
  const marks = [
    pointTrace(zl, Z0, 'Z<sub>L</sub>', { color: COLOR.ink, ax: 30, ay: -26, title: 'Load impedance' }),
    pointTrace([p.Zs[0], -p.Zs[1]], Z0, 'Z<sub>s</sub>*', { color: COLOR.ink, symbol: 'star', size: 17, ax: 30, ay: 28, title: 'Conjugate of the source impedance' }),
  ];
  if (n) {
    const st = styleOf(n);
    marks.push(pointTrace(n.Zin, Z0, 'Z<sub>in</sub>', { color: st.color, symbol: 'circle', ax: -34, ay: 28, title: 'Input impedance', rows: [['η<sub>tot</sub>', `${pc(n.eta_tot)} %`]] }));
  }
  for (const m of marks) { traces.push(m.trace); ann.push(m.ann); hover.push(m.hover); }
  smith.set({
    title: `Impedance trajectory${n ? `: ${n.name}` : ''}, ${problemTitle(p)}`, Z0, traces, hover, annotations: ann, problem: p,
    legendRows: opts.all || opts.geo || opts.nodes ? 2 : 0,
  });
}

function drawKpis() {
  const n = S.single.active, box = el.querySelector('#d_kpis');
  if (!n) { box.innerHTML = ''; return; }
  box.innerHTML = kpi('η<sub>tot</sub> (%)', pc(n.eta_tot)) + kpi('η<sub>loss</sub> (%)', pc(n.eta_loss)) +
    kpi('η<sub>match</sub> (%)', pc(n.eta_match)) + kpi('Z<sub>in</sub> (Ω)', zfmt(n.Zin), true);
}

function drawTable() {
  const box = el.querySelector('#d_table'), ref = el.querySelector('#d_ref');
  const rows = S.single.nets.map(n => `<tr class="click ${S.single.active && S.single.active.id === n.id ? 'on' : ''}" data-id="${n.id}">
    <td>${n.name}</td><td class="l">${n.desc}</td><td>${pc(n.eta_tot)}</td><td>${pc(n.eta_loss)}</td><td>${pc(n.eta_match)}</td><td>${zfmt(n.Zin)}</td></tr>`).join('');
  box.innerHTML = `<table class="t"><thead><tr><th>Network</th><th class="l">Elements, from load</th><th>η<sub>tot</sub> (%)</th><th>η<sub>loss</sub> (%)</th><th>η<sub>match</sub> (%)</th><th>Z<sub>in</sub> (Ω)</th></tr></thead><tbody>${rows}</tbody></table>`;
  const c = S.single.closed;
  ref.innerHTML = c ? `<table class="t"><thead><tr><th>Quantity</th><th>η<sub>tot</sub> (%)</th><th>Z<sub>in</sub> (Ω)</th></tr></thead><tbody>
    <tr><td>No network</td><td>${pc(c.direct)}</td><td>${zfmt(S.single.p.ZL)}</td></tr>
    <tr><td>Conjugate match</td><td>${pc(c.conj)}</td><td>${zfmt([S.single.p.Zs[0], -S.single.p.Zs[1]])}</td></tr>
    <tr><td>Efficiency limit (any LC ladder)</td><td>${pc(c.opt.eta_tot)}</td><td>${zfmt(c.opt.Zin)}</td></tr>
    <tr><td>Upper bound (mn_bound)</td>${c.ceil.valid ? `<td>${pc(c.ceil.eta_tot)}</td><td>${zfmt(c.ceil.Zin)}</td>` : `<td colspan="2">Not valid: load X/R is above ${S.single.p.ZL[1] >= 0 ? 'Q<sub>C</sub>' : 'Q<sub>L</sub>'}</td>`}</tr></tbody></table>` : '';
}
function drawGrid() {
  const box = el.querySelector('#d_grid'), s = S.single, n = gridN();
  const lv = s.geoLevels.slice().sort((a, b) => a.nu - b.nu);
  const plotEl = el.querySelector('#d_gplot');
  plotEl.hidden = lv.length < 2;
  if (!lv.length) { box.innerHTML = `<p class="note">Computing on the ${n}-point grid.</p>`; return; }
  if (lv.length >= 2) convergence(plotEl, lv, n);
  const cnt = c => c ? [c.sL, c.sC, c.pL, c.pC].map(v => `<td>${v}</td>`).join('') : '<td></td><td></td><td></td><td></td>';
  const rows = lv.map(l => `<tr class="${l.nu === n ? 'on' : ''}"><td>${l.nu} × ${l.nt}${l.nu === n ? ' ◂' : ''}</td><td>${l.nparts}</td>${cnt(l.counts)}<td>${pc(l.eta_exact)}</td></tr>`).join('');
  const best = s.nets.reduce((m, x) => (!m || x.eta_tot > m.eta_tot + 1e-9 || (Math.abs(x.eta_tot - m.eta_tot) <= 1e-9 && x.X.length < m.X.length) ? x : m), null);
  let foot = '';
  if (best) foot += `<tr><td>Best network found</td><td>${best.X.length}</td><td colspan="4" class="l">${best.desc}</td><td>${pc(best.eta_tot)}</td></tr>`;
  if (s.closed) foot += `<tr><td>Efficiency limit</td><td></td><td colspan="4"></td><td>${pc(s.closed.opt.eta_tot)}</td></tr>`;
  box.innerHTML = `<table class="t"><thead><tr><th>Grid</th><th>Elements</th><th>Ls</th><th>Cs</th><th>Lp</th><th>Cp</th><th>η<sub>tot</sub> (%)</th></tr></thead><tbody>${rows}</tbody><tfoot>${foot}</tfoot></table>`;
}
/** η_tot of the grid solution against grid size, with the closed-form limit it converges to. */
function convergence(plotEl, lv, n) {
  const s = S.single, xs = lv.map(l => l.nu), x0 = 35, x1 = 420;
  const tr = [{
    x: xs, y: lv.map(l => 100 * l.eta_exact), customdata: lv.map(l => [`${l.nu} × ${l.nt}`, l.nparts]),
    type: 'scatter', mode: 'lines+markers', name: 'Dijkstra network',
    line: { color: COLOR.blue, width: 2.4 }, marker: { size: lv.map(l => (l.nu === n ? 13 : 9)), color: lv.map(l => (l.nu === n ? COLOR.orange : COLOR.blue)), line: { color: '#fff', width: 1 } },
    hovertemplate: 'Grid %{customdata[0]}<br>%{customdata[1]} elements<br>η<sub>tot</sub> = %{y:.3f} %<extra></extra>',
  }];
  if (s.closed) tr.push({ x: [x0, x1], y: [100 * s.closed.opt.eta_tot, 100 * s.closed.opt.eta_tot], type: 'scatter', mode: 'lines', name: 'Efficiency limit', line: { color: COLOR.ink, width: 2, dash: 'dash' }, hovertemplate: 'Efficiency limit, closed form<br>%{y:.3f} %<extra></extra>' });
  const L = layout({ title: 'Dijkstra network η<sub>tot</sub> versus grid size', x: 'Grid points along ln R (log scale)', y: 'η<sub>tot</sub> (%)' });
  L.xaxis.type = 'log'; L.xaxis.range = [Math.log10(x0), Math.log10(x1)];
  L.xaxis.tickvals = xs; L.xaxis.ticktext = xs.map(String);
  L.legend.y = -0.26; L.margin.b = 80;
  draw(plotEl, tr, L);
}
void isCurrent;
