// Tolerance: Monte Carlo of component tolerance on one network, chosen from either
// design workflow.
import { S, Runner, status, isCurrent, showWs } from './shell.js';
import { draw, layout, COLOR, ecdf, pc, bins } from './plot.js';
import { Smith } from './smith.js';
import { kpi, pathTraces, pointTrace, download, safeName, zfmt } from './common.js';
import { z2gamma } from '../engine/field.js';

const W = 'tol', compute = new Runner();
let side, page, smith, res = null, stale = true, seenKey = '';

const allNets = () => [...S.single.nets, ...S.set.nets];
const getNet = () => allNets().find(n => n.id === S.tol.id) || null;

/** Open the Tolerance workflow on one network. */
export function openTolerance(net) {
  S.tol.id = net.id;
  showWs(W);
}

export const tolWs = {
  id: W, label: 'Tolerance', hint: 'Monte Carlo of component tolerance on a designed network',
  views: [{ id: 'mc', label: 'Monte Carlo', view: null }],
  side() {
    return `
    <h2>Network</h2>
    <div class="fld"><label for="c_net">Designed network</label><select id="c_net"></select></div>
    <div class="fld" style="margin-top:8px"><label for="c_scope">Loads</label><select id="c_scope"><option value="single">Its own load</option><option value="set">Every load state of the set</option></select></div>
    <div class="note" id="c_from"></div>
    <h2>Tolerance</h2>
    <div class="row2"><div class="fld"><label for="c_tol">Tolerance ± (%)</label><input id="c_tol" type="text" value="5"></div>
      <div class="fld"><label for="c_n">Draws</label><input id="c_n" type="text" value="5000"></div></div>
    <div class="row2"><div class="fld"><label for="c_dist">Distribution</label><select id="c_dist"><option value="uniform">Uniform</option><option value="normal">Normal, σ = tol/3</option></select></div>
      <div class="fld"><label for="c_model">ESR model</label><select id="c_model"><option value="Q">Constant Q</option><option value="esr">Constant ESR</option></select></div></div>
    <div class="row2"><div class="fld"><label for="c_tgt">Target η (%)</label><input id="c_tgt" type="text" value="50"></div>
      <div class="fld"><label for="c_seed">Seed</label><input id="c_seed" type="text" value="12345"></div></div>
    <button class="btn pri wide" id="c_run">Run</button>
    <div class="err" id="c_err"></div>
    <p class="note">One tolerance for every element, or one value per element from the load, such as 5, 2.</p>`;
  },
  mount(el) {
    side = el;
    el.querySelector('#c_run').addEventListener('click', run);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') run(); });
    el.querySelector('#c_net').addEventListener('change', e => { S.tol.id = e.target.value; picker(); stale = true; run(); });
    el.querySelector('#c_scope').addEventListener('change', () => { stale = true; run(); });
  },
  shown() { picker(); },
  cancel() { compute.cancel(); },
};

function picker() {
  const sel = side.querySelector('#c_net'), nets = allNets();
  if (!getNet() && nets.length) S.tol.id = (S.single.active || nets[0]).id;
  const opt = n => `<option value="${n.id}" ${n.id === S.tol.id ? 'selected' : ''}>${n.group === 'set' ? n.method_name : n.name}, ${n.desc}</option>`;
  sel.innerHTML = (S.single.nets.length ? `<optgroup label="Single load">${S.single.nets.map(opt).join('')}</optgroup>` : '')
    + (S.set.nets.length ? `<optgroup label="Load set">${S.set.nets.map(opt).join('')}</optgroup>` : '')
    || '<option value="">No designed networks</option>';
  sel.disabled = !nets.length;
  const n = getNet(), sc = side.querySelector('#c_scope'), setOk = !!(n && n.group === 'set' && S.set.data);
  sc.querySelector('[value=set]').disabled = !setOk;
  if (!setOk) sc.value = 'single';
  else if (sc.dataset.for !== n.id) { sc.value = 'set'; sc.dataset.for = n.id; }
  side.querySelector('#c_from').innerHTML = n ? (n.group === 'set' ? `From the load set, Z<sub>L</sub> = ${zfmt(n.ZL)} Ω nominal.` : `From single load, Z<sub>L</sub> = ${zfmt(n.ZL)} Ω.`) : 'Design a network in Single load or Load set first.';
  const key = n ? n.id + n.eta_tot : '';
  if (key !== seenKey) { seenKey = key; stale = true; }
  if (stale && n && isCurrent('tol:mc')) run();
}

const mcView = {
  mount(pg) {
    page = pg;
    pg.innerHTML = `<div id="c_none"><div class="card"><div class="empty">No network. Design one in Single load or Load set, then choose it in the panel on the left.</div></div></div>
    <div class="grid" id="c_body" hidden>
      <div class="kpis" id="c_kp"></div>
      <div class="grid g2">
        <div class="card"><div class="plot h400" id="c_h"></div></div>
        <div class="card"><div class="plot h400" id="c_c"></div></div>
        <div class="card"><div class="plot h400" id="c_t"></div></div>
        <div class="card"><div class="plot h400" id="c_s"></div></div>
      </div>
      <div class="card" id="c_zc"><div class="smith" id="c_sm" style="height:620px"></div></div>
      <div class="btnrow"><button class="btn" id="c_csv">Export samples (.csv)</button></div>
    </div>`;
    smith = new Smith(pg.querySelector('#c_sm'));
    pg.querySelector('#c_csv').addEventListener('click', exportCsv);
  },
  render() {},
  shown() { picker(); },
};
tolWs.views[0].view = mcView;

function run() {
  const n = getNet(), err = side.querySelector('#c_err');
  err.textContent = '';
  page.querySelector('#c_none').hidden = !!n;
  page.querySelector('#c_body').hidden = !n;
  if (!n) return;
  const q = id => side.querySelector(id).value.trim();
  const tolTxt = q('#c_tol'), parts = tolTxt.split(/[,\s]+/).filter(Boolean).map(Number);
  if (!parts.length || parts.some(v => !Number.isFinite(v) || v < 0)) { err.textContent = 'Enter a tolerance such as 5, or one value per element such as 5, 2.'; return; }
  if (parts.length > 1 && parts.length !== n.X.length) { err.textContent = `Enter one tolerance or ${n.X.length} values, in order from the load.`; return; }
  const scope = q('#c_scope');
  const target = Number(q('#c_tgt')) / 100;
  const o = {
    tol: parts.length === 1 ? parts[0] : parts, n: Number(q('#c_n')) || 5000, dist: q('#c_dist'), model: q('#c_model'),
    target: Number.isFinite(target) ? target : null, seed: Number(q('#c_seed')) || 12345, pct: S.set.cfg ? S.set.cfg.pct : 5,
    tmax: Math.max(15, 3 * (parts[0] || 5)),
  };
  const arg = { net: { X: n.X, kind: n.kind, Rser: n.Rser }, ZL: n.ZL, Zs: n.p.Zs, QL: n.p.QL, QC: n.p.QC, o };
  if (scope === 'set' && S.set.data) arg.S = { R: S.set.data.R, X: S.set.data.X };
  stale = false;
  status(W, `Monte Carlo of ${n.name}`, 0.3);
  const t0 = performance.now();
  compute.run('mc', arg, (type, d) => {
    if (type === 'mc') { res = { ...d, net: n, o }; plots(); }
    else if (type === 'end') status(W, `Monte Carlo finished in ${((performance.now() - t0) / 1000).toFixed(2)} s`);
    else if (type === 'error') { err.textContent = d; status(W, 'Stopped'); }
    else if (type === 'cancelled') { stale = true; status(W, 'Cancelled'); }
  });
}

function plots() {
  const { res: r, sw, scope, net, o } = res;
  const kp = page.querySelector('#c_kp');
  const lab = S.set.cfg ? `${S.set.cfg.pct}th percentile` : '5th percentile';
  const hb = scope === 'single' ? bins(Array.from(r.eta, v => 100 * v)) : bins(Array.from(r.mean, v => 100 * v), Array.from(r.pk, v => 100 * v));
  const hist = (arr, name, color) => ({ x: Array.from(arr, v => 100 * v), type: 'histogram', xbins: hb, autobinx: false, name, opacity: 0.72, marker: { color, line: { color: '#fff', width: 0.6 } }, hovertemplate: `${name}<br>Bin %{x} %<br>Draws: %{y}<extra></extra>` });
  const cdf = (arr, name, color, dash) => {
    const [x, y] = ecdf(arr);
    const st = Math.max(1, Math.floor(x.length / 1500));
    const fx = x.filter((_, i) => i % st === 0).map(v => 100 * v), fy = y.filter((_, i) => i % st === 0).map(v => 100 * v);
    return { x: fx, y: fy, type: 'scatter', mode: 'lines', line: { shape: 'hv', color, width: 2.2, dash }, name, hovertemplate: `${name}<br>η = %{x:.2f} %<br>Cumulative = %{y:.1f} %<extra></extra>` };
  };
  const yl = 'Cumulative probability (%)';
  if (scope === 'single') {
    const s = r.stats;
    kp.innerHTML = kpi('Nominal η<sub>tot</sub> (%)', pc(r.nominal.eta_tot)) + kpi('Mean (%)', pc(s.mean)) + kpi('Standard deviation (%)', pc(s.sd)) +
      kpi('5th percentile (%)', pc(s.p05)) + kpi('Minimum (%)', pc(s.min)) + (r.yield != null ? kpi(`Yield at η ≥ ${(100 * o.target).toFixed(0)} % (%)`, pc(r.yield)) : '');
    draw(page.querySelector('#c_h'), [hist(r.eta, 'η<sub>tot</sub>', COLOR.blue)],
      layout({ title: `Efficiency distribution, ${net.name}, ${r.N} draws`, x: 'η<sub>tot</sub> (%)', y: 'Draws', legend: false, bargap: 0.02 }));
    draw(page.querySelector('#c_c'), [cdf(r.eta, 'η<sub>tot</sub>', COLOR.blue)],
      layout({ title: 'Empirical cumulative distribution of efficiency', x: 'η<sub>tot</sub> (%)', y: yl, legend: false }));
  } else {
    const a = r.stats;
    kp.innerHTML = kpi('Mean over states, median build (%)', pc(a.mean.p50)) + kpi('Mean over states, 5th percentile build (%)', pc(a.mean.p05)) +
      kpi(`${lab} over states, median build (%)`, pc(a.pk.p50)) + kpi(`${lab} over states, 5th percentile build (%)`, pc(a.pk.p05));
    draw(page.querySelector('#c_h'), [hist(r.mean, 'Mean over states', COLOR.blue), hist(r.pk, `${lab} over states`, COLOR.orange)],
      layout({ title: `Distribution over builds, ${net.name}, ${r.N} draws`, x: 'Efficiency (%)', y: 'Builds', barmode: 'overlay', bargap: 0.02 }));
    draw(page.querySelector('#c_c'), [cdf(r.mean, 'Mean over states', COLOR.blue), cdf(r.pk, `${lab} over states`, COLOR.orange, 'dash')],
      layout({ title: 'Empirical cumulative distribution over builds', x: 'Efficiency (%)', y: yl }));
  }
  const T = Array.from(sw.tol);
  const lineT = (y, name, color, dash, sym, half) => [
    { x: T, y: Array.from(y, v => 100 * v), type: 'scatter', mode: 'lines', name, line: { color, width: 2.4, dash }, hovertemplate: `${name}<br>±%{x:.2f} %<br>η = %{y:.2f} %<extra></extra>` },
    ...(Number.isFinite(half) ? [{ x: [half], y: [50 * y[0]], type: 'scatter', mode: 'markers+text', text: [`±${half.toFixed(1)} %`], textposition: 'top right', textfont: { size: 14 }, marker: { size: 11, symbol: sym, color: '#fff', line: { color, width: 2.4 } }, showlegend: false, hovertemplate: `Efficiency halved at ±${half.toFixed(2)} %<extra></extra>` }] : []),
  ];
  const tt = scope === 'single'
    ? lineT(sw.mean, 'η<sub>tot</sub>, worst build', COLOR.blue, 'solid', 'circle', sw.half_mean)
    : [...lineT(sw.mean, 'Mean over states, worst build', COLOR.blue, 'solid', 'circle', sw.half_mean), ...lineT(sw.pk, `${lab} over states, worst build`, COLOR.orange, 'dash', 'square', sw.half_pk)];
  draw(page.querySelector('#c_t'), tt, layout({ title: `Efficiency versus component tolerance, ${sw.combos} build combinations`, x: 'Component tolerance ± (%)', y: 'Efficiency (%)' }));
  const sens = r.sens.slice().sort((a, b) => Math.abs(a.r) - Math.abs(b.r));
  draw(page.querySelector('#c_s'), [{ y: sens.map(s => s.name), x: sens.map(s => s.r), type: 'bar', orientation: 'h', marker: { color: COLOR.blue }, hovertemplate: '%{y}<br>Correlation = %{x:.3f}<extra></extra>' }],
    layout({ title: 'Correlation of efficiency with element value', x: 'Pearson correlation coefficient', y: 'Element', legend: false }));
  const zc = page.querySelector('#c_zc');
  zc.style.display = scope === 'single' ? '' : 'none';
  if (scope === 'single') cloud(r, net);
}

function cloud(r, net) {
  const Z0 = net.p.Z0, N = Math.min(r.N, 2500), st = Math.max(1, Math.floor(r.N / N));
  const X = [], Y = [], C = [], hover = [];
  for (let i = 0; i < r.N; i += st) {
    const g = z2gamma(r.zr[i], r.zi[i], Z0);
    X.push(g[0]); Y.push(g[1]); C.push(100 * r.eta[i]);
    hover.push({ gx: g[0], gy: g[1], title: `Draw ${i + 1}`, rows: [['η<sub>tot</sub> of draw', `${pc(r.eta[i])} %`]] });
  }
  const path = pathTraces(net, Z0, { annotate: false });
  const m1 = pointTrace([net.p.Zs[0], -net.p.Zs[1]], Z0, 'Z<sub>s</sub>*', { symbol: 'star', size: 17 });
  const traces = [...path.traces,
    { x: X, y: Y, type: 'scatter', mode: 'markers', marker: { size: 6, color: C, colorscale: 'Viridis', showscale: true, colorbar: { title: { text: 'η<sub>tot</sub> (%)', side: 'right' }, thickness: 16, len: 0.9, outlinewidth: 0 } }, hoverinfo: 'skip', showlegend: false },
    m1.trace];
  smith.set({ title: `Input impedance of each draw, ${net.name}`, Z0, traces, hover: [...hover, m1.hover], annotations: [m1.ann], problem: { ...net.p, ZL: net.ZL }, legendRows: 0 });
  const xs = X.slice().sort((a, b) => a - b), ys = Y.slice().sort((a, b) => a - b);
  const q = (a, f) => a[Math.floor(f * (a.length - 1))];
  const m = Math.max(q(xs, 0.995) - q(xs, 0.005), q(ys, 0.995) - q(ys, 0.005), 0.02) * 0.3;
  smith.zoomTo({ x0: q(xs, 0.005) - m, x1: q(xs, 0.995) + m, y0: q(ys, 0.005) - m, y1: q(ys, 0.995) + m });
  const lo = Math.min(...C), hi = Math.max(...C), st2 = Math.max((hi - lo) / 8, 1e-6), p10 = 10 ** Math.floor(Math.log10(st2));
  const tk = Math.ceil(st2 / p10) * p10, ticks = [];
  for (let t = Math.ceil(lo / tk) * tk; t <= hi; t += tk) ticks.push(t);
  smith.setLayers(null);
  smith.bar({ lo, hi, ticks, dec: Math.max(0, -Math.floor(Math.log10(tk))), steps: 0, title: 'η<sub>tot</sub> (%)' });
}

function exportCsv() {
  if (!res) return;
  const { res: r, scope, net } = res;
  const rows = [];
  if (scope === 'single') {
    rows.push('Draw,eta_tot (%),eta_loss (%),eta_match (%),Zin real (ohm),Zin imag (ohm)');
    for (let i = 0; i < r.N; i++) rows.push([i + 1, 100 * r.eta[i], 100 * r.eta_loss[i], 100 * r.eta_match[i], r.zr[i], r.zi[i]].map(v => +(+v).toPrecision(8)).join(','));
  } else {
    rows.push('Build,Mean over states (%),Percentile over states (%),Minimum over states (%)');
    for (let i = 0; i < r.N; i++) rows.push([i + 1, 100 * r.mean[i], 100 * r.pk[i], 100 * r.min[i]].map(v => +(+v).toPrecision(8)).join(','));
  }
  download(`${safeName(`mc_${net.name}`)}.csv`, rows.join('\n') + '\n', 'text/csv');
}
void zfmt;
