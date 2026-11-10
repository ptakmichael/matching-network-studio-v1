import { schematicSVG } from './schematic.js';
import { openTolerance } from './ws_tol.js';
import { netlistText, ascText } from '../engine/netlist.js';
import { comps, eng } from '../engine/core.js';
import { download, safeName, kpi, pc, zfmt } from './common.js';

/** The circuit of the network a workflow has selected. */
export function circuitView(getNet) {
  let page, cur = null;
  return {
  mount(pg) {
    page = pg;
    pg.innerHTML = `<div class="grid">
      <div class="kpis" id="c_k"></div>
      <div class="card"><h3 id="c_title">Schematic</h3><div class="sch" id="c_sch"></div>
        <div class="btnrow" style="margin-top:10px">
          <button class="btn pri" data-x="cir">LTspice netlist (.cir)</button>
          <button class="btn" data-x="asc">LTspice schematic (.asc)</button>
          <button class="btn" data-x="svg">Schematic (.svg)</button>
          <button class="btn" data-x="png">Schematic (.png)</button>
          <button class="btn" data-x="csv">Bill of materials (.csv)</button>
          <button class="btn" id="c_tol" style="margin-left:auto">Analyse component tolerance</button>
        </div></div>
      <div class="grid g2">
        <div class="card"><h3>Elements</h3><div class="tw" id="c_tab"></div></div>
        <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="margin:0">Netlist</h3><button class="btn" id="c_copy">Copy</button></div><pre class="net-text" id="c_net"></pre></div>
      </div></div>`;
    pg.addEventListener('click', e => {
      const b = e.target.closest('[data-x]');
      if (b && cur) exportAs(cur, b.dataset.x);
    });
    pg.querySelector('#c_tol').addEventListener('click', () => { if (cur) openTolerance(cur.src); });
    pg.querySelector('#c_copy').addEventListener('click', e => {
      if (!cur) return;
      navigator.clipboard.writeText(cur.text.lines.join('\n')).then(() => { e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy'; }, 1200); });
    });
  },
  render() {
    const n = getNet();
    if (!n) { page.querySelector('#c_k').innerHTML = ''; return; }
    const p = { ...n.p, ZL: n.ZL };
    const net = n.comps ? n : { ...n, comps: comps(n.X, n.kind, n.Rser, p.f0) };
    const text = netlistText(n.X, n.kind, n.Rser, n.ZL, p.Zs, p.f0, n.name);
    cur = { n: net, src: n, p, text, svg: schematicSVG(net, p) };
    // enlarged to fill the panel when there is room; never reduced, a long ladder scrolls
    const box = page.querySelector('#c_sch'), natural = +cur.svg.match(/width="([\d.]+)"/)[1];
    const scale = Math.max(1, Math.min(1.35, (box.clientWidth - 2) / natural));
    page.querySelector('#c_title').textContent = `Schematic: ${n.name}`;
    page.querySelector('#c_k').innerHTML = kpi('Elements', n.X.length) + kpi('η<sub>tot</sub> (%)', pc(n.eta_tot)) + kpi('η<sub>loss</sub> (%)', pc(n.eta_loss)) + kpi('η<sub>match</sub> (%)', pc(n.eta_match)) + kpi('Z<sub>in</sub> (Ω)', zfmt(n.Zin), true);
    box.innerHTML = schematicSVG(net, p, { scale });
    page.querySelector('#c_net').textContent = text.lines.join('\n');
    const rows = net.comps.slice().reverse().map((c, i) => `<tr><td>${i + 1}</td><td class="l"><b>${c.ref}</b></td><td class="l">${c.place} ${c.type === 'L' ? 'inductor' : 'capacitor'}</td><td>${eng(c.value, c.unit)}</td><td>${c.X.toFixed(3)}</td><td>${c.Rser.toFixed(4)}</td><td>${c.Q.toPrecision(4)}</td></tr>`).join('');
    page.querySelector('#c_tab').innerHTML = `<table class="t"><thead><tr><th>Position</th><th class="l">Ref.</th><th class="l">Element</th><th>Value</th><th>X (Ω)</th><th>ESR (Ω)</th><th>Q</th></tr></thead><tbody>${rows}</tbody></table><p class="note">Position 1 is at the source port.</p>`;
  },
  };
}

function exportAs(cur, kind) {
  const { n, p, text, svg } = cur, stem = safeName(`mn_${n.name}`);
  if (kind === 'cir') download(`${stem}.cir`, text.lines.join('\n') + '\n');
  else if (kind === 'asc') download(`${stem}.asc`, ascText(n.X, n.kind, n.Rser, n.ZL, p.Zs, p.f0));
  else if (kind === 'svg') download(`${stem}.svg`, svg, 'image/svg+xml');
  else if (kind === 'csv') {
    const rows = ['Position,Reference,Placement,Type,Value,Unit,Reactance (ohm),ESR (ohm),Q'];
    n.comps.slice().reverse().forEach((c, i) => rows.push([i + 1, c.ref, c.place, c.type, c.value.toExponential(6), c.unit, c.X.toFixed(5), c.Rser.toFixed(6), c.Q.toFixed(2)].join(',')));
    download(`${stem}_bom.csv`, rows.join('\n') + '\n', 'text/csv');
  } else if (kind === 'png') {
    const img = new Image(), url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    img.onload = () => {
      const c = document.createElement('canvas'), k = 3;
      c.width = img.width * k; c.height = img.height * k;
      const g = c.getContext('2d');
      g.scale(k, k); g.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      c.toBlob(b => download(`${stem}.png`, b));
    };
    img.src = url;
  }
}
