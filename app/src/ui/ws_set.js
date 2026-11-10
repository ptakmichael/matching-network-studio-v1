// Load set: one network for many load states. Inputs in the panel; states, designs,
// Smith chart and circuit as views of this workflow's own results.
import { S, Runner, status, invalidate, envFields, readEnv, envKey, isCurrent } from './shell.js';
import { draw, layout, COLOR, METHOD_STYLE, ecdf, pc, VIRIDIS, SIZE } from './plot.js';
import { Smith } from './smith.js';
import { kpi, pathTraces, pointTrace, seg, download, safeName, elemStr, zfmt } from './common.js';
import { parseFile, buildSet, rangeSet } from '../engine/loadset.js';
import { comps, etaMany } from '../engine/core.js';
import { z2gamma } from '../engine/field.js';
import { circuitView } from './tab_circuit.js';

const W = 'set', compute = new Runner();
const METHODS = [['nominal', 'Nominal', true], ['pct', 'Percentile', true], ['worst', 'Worst case', true], ['average', 'Average', true], ['yield', 'Yield', false]];
const PARAM_NONE = '__none';
let side, mode = 'file';
const st = () => S.set;
const empty = (msg) => `<div class="card"><div class="empty">${msg}</div></div>`;
const NO_STATES = 'No load states. Drop impedance files in the panel on the left, or define a range.';
const NO_DESIGN = 'No designs. Choose the methods in the panel on the left and press Design networks.';

// ------------------------------------------------------------------- panel
export const setWs = {
  id: W, label: 'Load set', hint: 'Design one network for many load states',
  views: [
    { id: 'states', label: 'Load states', view: statesView() },
    { id: 'designs', label: 'Designs', view: designsView() },
    { id: 'smith', label: 'Smith chart', view: smithView() },
    { id: 'circuit', label: 'Circuit', view: circuitView(() => st().active) },
  ],
  side() {
    return `
    <h2>Load states</h2>
    <div class="seg" id="s_mode" style="margin-bottom:8px"><button data-v="file" class="on">From files</button><button data-v="range">R-X range</button></div>
    <div id="s_file"><div class="drop" id="s_drop">Drop impedance files, or click to select.<br><span class="lab">HFSS tables, Zre and Zim traces, R and X columns, Touchstone .s1p</span></div>
      <input type="file" id="s_in" multiple accept=".csv,.txt,.s1p,.tsv" style="display:none"></div>
    <div id="s_range" hidden>
      <div class="row2"><div class="fld"><label for="r0">R min (Ω)</label><input id="r0" type="text" value="0.17"></div><div class="fld"><label for="r1">R max (Ω)</label><input id="r1" type="text" value="0.29"></div></div>
      <div class="row2"><div class="fld"><label for="x0">X min (Ω)</label><input id="x0" type="text" value="82"></div><div class="fld"><label for="x1">X max (Ω)</label><input id="x1" type="text" value="96"></div></div>
      <div class="row2"><div class="fld"><label for="rn">Points per axis</label><input id="rn" type="text" value="15"></div><div class="fld"><label>&nbsp;</label><button class="btn" id="s_mk">Create states</button></div></div>
    </div>
    <div class="note" id="s_src"></div>
    ${envFields(W)}
    <h2>Design</h2>
    <div class="row2"><div class="fld"><label for="s_n">Order N</label><input id="s_n" type="text" value="2"></div>
      <div class="fld"><label for="s_t">Topology</label><select id="s_t"><option value="free">Unconstrained</option><option value="lowpass">Low-pass</option><option value="highpass">High-pass</option></select></div></div>
    <div class="row2"><div class="fld"><label for="s_p">Percentile (%)</label><input id="s_p" type="text" value="5"></div>
      <div class="fld"><label for="s_y">Yield target (%)</label><input id="s_y" type="text" value="20"></div></div>
    <div class="row2"><div class="fld"><label for="s_nr">Nominal R (Ω)</label><input id="s_nr" type="text"></div>
      <div class="fld"><label for="s_nx">Nominal X (Ω)</label><input id="s_nx" type="text"></div></div>
    <div class="lab" style="margin:4px 0 2px">Methods</div>
    <div class="chks">${METHODS.map(m => `<label class="chk"><input type="checkbox" data-m="${m[0]}" ${m[2] ? 'checked' : ''}> ${m[1]}</label>`).join('')}</div>
    <button class="btn pri wide" id="s_go" disabled>Design networks</button>
    <div class="stale" id="s_stale" hidden>Inputs changed since this design. Design again to update.</div>
    <div class="err" id="s_err"></div>
    <h2>Networks</h2>
    <div class="nets" id="s_nets"></div>`;
  },
  mount(el) {
    side = el;
    seg(el.querySelector('#s_mode'), v => {
      mode = v;
      el.querySelector('#s_file').hidden = v !== 'file';
      el.querySelector('#s_range').hidden = v !== 'range';
    });
    const inp = el.querySelector('#s_in'), drop = el.querySelector('#s_drop');
    drop.addEventListener('click', () => inp.click());
    inp.addEventListener('change', () => { readFiles([...inp.files]); inp.value = ''; });
    for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); });
    for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); });
    drop.addEventListener('drop', e => readFiles([...e.dataTransfer.files]));
    el.querySelector('#s_mk').addEventListener('click', makeRange);
    el.querySelector('#s_go').addEventListener('click', design);
    el.addEventListener('input', e => { if (!e.target.classList.contains('env')) staleNote(); });
    el.addEventListener('change', staleNote);
    el.querySelector('#s_nets').addEventListener('click', e => {
      const b = e.target.closest('.net');
      if (b) activate(st().nets.find(n => n.id === b.dataset.id));
    });
    renderNets();
  },
  envChanged() { staleNote(); },
  cancel() { compute.cancel(); },
};

const designKey = () => [envKey(), st().data ? st().data.source + st().data.n : '', ...['#s_n', '#s_t', '#s_p', '#s_y', '#s_nr', '#s_nx'].map(q => side.querySelector(q).value.trim()),
  ...[...side.querySelectorAll('[data-m]')].map(c => c.checked)].join('|');
function staleNote() { side.querySelector('#s_stale').hidden = !st().cfg || st().key === designKey(); }

async function readFiles(files) {
  const err = side.querySelector('#s_err');
  err.textContent = '';
  if (!files.length) return;
  try {
    const f0 = readEnv().f0 / 1e6;
    const texts = await Promise.all(files.map(f => f.text()));
    const parsed = texts.map((t, i) => parseFile(t, files[i].name, f0));
    setStates(buildSet(parsed, files.map(f => f.name)));
  } catch (e) { err.textContent = e.message; }
}
function makeRange() {
  const err = side.querySelector('#s_err');
  err.textContent = '';
  try {
    const q = id => { const v = Number(side.querySelector(id).value); if (!Number.isFinite(v)) throw new Error('Enter a number in every range field.'); return v; };
    const n = Math.round(q('#rn'));
    setStates(rangeSet(q('#r0'), q('#r1'), q('#x0'), q('#x1'), n, n));
  } catch (e) { err.textContent = e.message; }
}
function setStates(set) {
  Object.assign(S.set, { data: set, nets: [], limits: null, req: null, cfg: null, active: null, key: '' });
  side.querySelector('#s_nr').value = +set.nominal[0].toPrecision(7);
  side.querySelector('#s_nx').value = +set.nominal[1].toPrecision(7);
  side.querySelector('#s_go').disabled = false;
  side.querySelector('#s_src').textContent = `${set.n} states. ${set.source}${set.dropped ? `. Removed ${set.dropped} ${set.dropped === 1 ? 'row' : 'rows'} without positive resistance.` : ''}`;
  statesView.colorOptions();
  renderNets(); staleNote();
  invalidate(W);
}

function design() {
  const err = side.querySelector('#s_err'), s = st();
  err.textContent = '';
  let cfg;
  try {
    const p = readEnv();
    const N = Number(side.querySelector('#s_n').value);
    if (!Number.isInteger(N) || N < 1 || N > 8) throw new Error('Order N for a load set must be a whole number from 1 to 8.');
    const pct = Number(side.querySelector('#s_p').value);
    if (!(pct > 0 && pct < 50)) throw new Error('Percentile must be between 0 and 50.');
    const target = Number(side.querySelector('#s_y').value) / 100;
    if (!(target > 0 && target < 1)) throw new Error('Yield target must be between 0 and 100 %.');
    const nr = Number(side.querySelector('#s_nr').value), nx = Number(side.querySelector('#s_nx').value);
    if (!(nr > 0) || !Number.isFinite(nx)) throw new Error('Enter a nominal impedance with positive resistance.');
    s.data.nominal = [nr, nx];
    cfg = { N, topo: side.querySelector('#s_t').value, Zs: p.Zs, QL: p.QL, QC: p.QC, f0: p.f0, ntry: 20, pct, target, Z0: p.Z0 };
  } catch (e) { err.textContent = e.message; return; }
  const methods = [...side.querySelectorAll('[data-m]')].filter(c => c.checked).map(c => c.dataset.m);
  if (!methods.length) { err.textContent = 'Select at least one design method.'; return; }
  compute.cancel();
  Object.assign(s, { cfg, nets: [], limits: null, req: null, active: null, key: designKey() });
  staleNote();
  status(W, 'Designing networks', 0);
  invalidate(W);
  renderNets();
  const t0 = performance.now();
  const p = { Zs: cfg.Zs, QL: cfg.QL, QC: cfg.QC, f0: cfg.f0, Z0: cfg.Z0 };
  compute.run('set', { S: { R: s.data.R, X: s.data.X, n: s.data.n, nominal: s.data.nominal }, cfg, methods }, (type, d) => {
    if (type === 'progress') status(W, d.text, d.frac);
    else if (type === 'set-net') {
      const n = { ...d, p: { ...p }, group: 'set', id: `m${d.method}`, name: `${d.method_name}, N = ${cfg.N}`, comps: comps(d.X, d.kind, d.Rser, cfg.f0) };
      s.nets.push(n);
      if (!s.active) s.active = n;
      renderNets();
      invalidate(W);
    } else if (type === 'req') { s.req = d; invalidate('set:states'); }
    else if (type === 'limits') { s.limits = d; invalidate('set:designs'); }
    else if (type === 'end') status(W, `Load set designed in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    else if (type === 'error') { err.textContent = d; status(W, 'Stopped'); }
    else if (type === 'cancelled') status(W, 'Cancelled');
  });
}

function activate(n) {
  if (!n) return;
  st().active = n;
  renderNets();
  invalidate(W);
}
function renderNets() {
  const s = st(), box = side.querySelector('#s_nets');
  box.innerHTML = s.nets.map(n => `<button class="net ${s.active && s.active.id === n.id ? 'on' : ''}" data-id="${n.id}"><b>${n.method_name}</b><span class="v">${pc(n.score.mean)} %</span><span class="d">${n.desc}, mean over ${s.data.n} states</span></button>`).join('')
    || `<div class="lab">${s.data ? 'No designs.' : 'No load states.'}</div>`;
}

const pctName = () => (st().cfg ? `${st().cfg.pct}th percentile` : '5th percentile');
const env = () => { try { return st().cfg || readEnv(); } catch { return null; } };

// ------------------------------------------------------------- load states
function statesView() {
  let page;
  const v = {
    mount(pg) {
      page = pg;
      pg.innerHTML = `<div id="ss_none">${empty(NO_STATES)}</div><div class="grid" id="ss_body" hidden>
        <div class="kpis" id="ss_k"></div>
        <div class="grid g2">
          <div class="card"><div class="toolbar" style="margin-bottom:4px"><div class="fld"><label for="ss_col">Marker color</label><select id="ss_col"></select></div></div><div class="plot h460" id="ss_rx"></div></div>
          <div class="card" id="ss_reqc"><div class="plot h460" id="ss_req" style="margin-top:62px"></div></div>
        </div></div>`;
      pg.querySelector('#ss_col').addEventListener('change', drawRX);
    },
    render() {
      const s = st();
      page.querySelector('#ss_none').hidden = !!s.data;
      page.querySelector('#ss_body').hidden = !s.data;
      if (!s.data) return;
      const d = s.data;
      let r0 = Infinity, r1 = -Infinity, x0 = Infinity, x1 = -Infinity;
      for (let i = 0; i < d.n; i++) { r0 = Math.min(r0, d.R[i]); r1 = Math.max(r1, d.R[i]); x0 = Math.min(x0, d.X[i]); x1 = Math.max(x1, d.X[i]); }
      page.querySelector('#ss_k').innerHTML = kpi('States', d.n) + kpi('R range (Ω)', `${+r0.toPrecision(4)} to ${+r1.toPrecision(4)}`, true) + kpi('X range (Ω)', `${+x0.toPrecision(4)} to ${+x1.toPrecision(4)}`, true) + kpi('Nominal Z<sub>L</sub> (Ω)', zfmt(d.nominal), true);
      drawRX(); drawRequired();
    },
  };
  statesView.colorOptions = () => {
    const sel = page.querySelector('#ss_col'), keys = Object.keys(st().data.params);
    sel.innerHTML = `<option value="${PARAM_NONE}">None</option><option value="__eta">η, selected network</option>` + keys.map(k => `<option>${k}</option>`).join('');
  };
  function drawRX() {
    const d = st().data; if (!d) return;
    const key = page.querySelector('#ss_col').value, n = st().active;
    const marker = { size: 8, color: COLOR.blue, opacity: 0.8, line: { color: '#fff', width: 0.6 } };
    let extra = '', cdata = null, ctitle = '';
    if (key === '__eta' && n) { cdata = Array.from(n.score.eta, v => 100 * v); ctitle = 'η (%)'; }
    else if (key && key !== PARAM_NONE && d.params[key]) { cdata = d.params[key]; ctitle = key; }
    if (cdata) {
      Object.assign(marker, { color: cdata, colorscale: VIRIDIS, showscale: true, colorbar: { title: { text: ctitle, side: 'right', font: { size: SIZE.axis } }, thickness: 16, outlinewidth: 0, len: 0.9 } });
      extra = `<br>${ctitle} = %{marker.color:.3f}`;
    }
    draw(page.querySelector('#ss_rx'), [
      { x: Array.from(d.R), y: Array.from(d.X), type: 'scatter', mode: 'markers', name: 'States', marker, customdata: Array.from(d.R, (_, i) => i + 1), hovertemplate: `State %{customdata}<br>R = %{x:.4f} Ω<br>X = %{y:.3f} Ω${extra}<extra></extra>` },
      { x: [d.nominal[0]], y: [d.nominal[1]], type: 'scatter', mode: 'markers', name: 'Nominal', marker: { symbol: 'star', size: 18, color: COLOR.ink, line: { color: '#fff', width: 1 } }, hovertemplate: 'Nominal<br>R = %{x:.4f} Ω<br>X = %{y:.3f} Ω<extra></extra>' },
    ], layout({ title: `Load states in the R-X plane, ${d.n} states`, x: 'Resistance, R (Ω)', y: 'Reactance, X (Ω)' }));
  }
  function drawRequired() {
    const r = st().req, el = page.querySelector('#ss_req'), card = page.querySelector('#ss_reqc');
    card.hidden = !r;
    if (!r) return;
    const u = r.units, sc = q => (q === 'F' ? 1e12 : 1e9), un = q => (q === 'F' ? 'pF' : 'nH');
    draw(el, [
      { x: r.a.map(v => v * sc(u[0])), y: r.b.map(v => v * sc(u[1])), type: 'scatter', mode: 'markers', name: 'States', marker: { size: 8, color: COLOR.blue, opacity: 0.8, line: { color: '#fff', width: 0.6 } }, hovertemplate: `${r.labels[0]} = %{x:.3f} ${un(u[0])}<br>${r.labels[1]} = %{y:.2f} ${un(u[1])}<extra></extra>` },
      { x: [r.nominal[0] * sc(u[0])], y: [r.nominal[1] * sc(u[1])], type: 'scatter', mode: 'markers', name: 'Nominal', marker: { symbol: 'star', size: 18, color: COLOR.ink, line: { color: '#fff', width: 1 } }, hovertemplate: `Nominal<br>%{x:.3f} ${un(u[0])}, %{y:.2f} ${un(u[1])}<extra></extra>` },
    ], layout({ title: 'Two-element values for exact match at each state', x: `${r.labels[0]}, next to load (${un(u[0])})`, y: `${r.labels[1]}, at port (${un(u[1])})` }));
  }
  return v;
}

// ---------------------------------------------------------------- designs
function designsView() {
  let page;
  return {
    mount(pg) {
      page = pg;
      pg.innerHTML = `<div id="sd_none"></div><div class="grid" id="sd_body" hidden>
        <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="margin:0">Networks</h3><button class="btn" id="sd_csv">Export state results (.csv)</button></div><div class="tw" id="sd_tab"></div></div>
        <div class="grid g2">
          <div class="card"><div class="plot h400" id="sd_bar"></div></div>
          <div class="card"><div class="plot h400" id="sd_cdf"></div></div>
          <div class="card"><div class="plot h400" id="sd_hist"></div></div>
          <div class="card"><div class="plot h400" id="sd_map"></div></div>
        </div></div>`;
      pg.querySelector('#sd_csv').addEventListener('click', exportCsv);
      pg.querySelector('#sd_tab').addEventListener('click', e => {
        const r = e.target.closest('tr[data-id]');
        if (r) activate(st().nets.find(n => n.id === r.dataset.id));
      });
    },
    render() {
      const s = st(), has = s.nets.length > 0;
      page.querySelector('#sd_none').innerHTML = has ? '' : empty(s.data ? NO_DESIGN : NO_STATES);
      page.querySelector('#sd_body').hidden = !has;
      if (!has) return;
      table(); dist(); map();
    },
  };
  function table() {
    const s = st();
    const rows = s.nets.map(n => {
      const c = n.score;
      return `<tr class="click ${s.active && s.active.id === n.id ? 'on' : ''}" data-id="${n.id}"><td>${n.method_name}</td><td class="l">${elemStr(n)}</td><td>${pc(c.min)}</td><td>${pc(c.pk)}</td><td>${pc(c.mean)}</td><td>${pc(c.yield)}</td><td>${pc(n.eta_tot)}</td><td>${zfmt(n.Zin)}</td></tr>`;
    }).join('');
    let foot = '';
    if (s.limits) {
      const v = Float64Array.from(s.limits).sort(), k = Math.floor(s.cfg.pct / 100 * v.length);
      let m = 0; for (const e of v) m += e;
      foot = `<tfoot><tr><td>Efficiency limit</td><td class="l">Any LC ladder, tuned to each state</td><td>${pc(v[0])}</td><td>${pc(v[k])}</td><td>${pc(m / v.length)}</td><td></td><td></td><td></td></tr></tfoot>`;
    }
    page.querySelector('#sd_tab').innerHTML = `<table class="t"><thead><tr><th>Design</th><th class="l">Elements, port to load</th><th>Minimum (%)</th><th>${pctName()} (%)</th><th>Mean (%)</th><th>Yield, η ≥ ${(100 * s.cfg.target).toFixed(0)} % (%)</th><th>η<sub>tot</sub> at nominal (%)</th><th>Z<sub>in</sub> at nominal (Ω)</th></tr></thead><tbody>${rows}</tbody>${foot}</table>`;
  }
  function dist() {
    const s = st(), nets = s.nets, names = nets.map(n => n.method_name);
    const bar = (name, f, color) => ({ x: names, y: nets.map(n => 100 * f(n.score)), name, type: 'bar', marker: { color }, text: nets.map(n => (100 * f(n.score)).toFixed(1)), textposition: 'outside', textfont: { size: 14 }, cliponaxis: false, customdata: nets.map(elemStr), hovertemplate: `${name}: %{y:.2f} %<br>%{customdata}<extra>%{x}</extra>` });
    draw(page.querySelector('#sd_bar'), [bar('Minimum', c => c.min, COLOR.orange), bar(pctName(), c => c.pk, COLOR.aqua), bar('Mean', c => c.mean, COLOR.blue)],
      layout({ title: `Efficiency over ${s.data.n} load states`, x: 'Design', y: 'Efficiency (%)', barmode: 'group', bargap: 0.28, bargroupgap: 0.08 }));
    const cd = [], hs = [];
    for (const n of nets) {
      const sty = METHOD_STYLE[n.method], [x, y] = ecdf(n.score.eta);
      cd.push({ x: x.map(v => 100 * v), y: y.map(v => 100 * v), type: 'scatter', mode: 'lines', name: n.method_name, line: { color: sty.color, width: 2.4, dash: sty.dash, shape: 'hv' }, hovertemplate: `${n.method_name}<br>η = %{x:.2f} %<br>Cumulative = %{y:.1f} %<extra></extra>` });
      hs.push({ x: Array.from(n.score.eta, v => 100 * v), type: 'histogram', name: n.method_name, opacity: 0.6, xbins: { start: 0, end: 100, size: 2 }, autobinx: false, marker: { color: sty.color, line: { color: '#fff', width: 0.6 } }, hovertemplate: `${n.method_name}<br>Bin %{x} %<br>States: %{y}<extra></extra>` });
    }
    if (s.limits) {
      const [x, y] = ecdf(s.limits);
      cd.push({ x: x.map(v => 100 * v), y: y.map(v => 100 * v), type: 'scatter', mode: 'lines', name: 'Efficiency limit, any LC ladder', line: { color: '#8d95a1', width: 2, dash: 'longdash', shape: 'hv' }, hovertemplate: 'Efficiency limit<br>η = %{x:.2f} %<br>Cumulative = %{y:.1f} %<extra></extra>' });
    }
    draw(page.querySelector('#sd_cdf'), cd, layout({ title: 'Empirical cumulative distribution of efficiency over states', x: 'η<sub>tot</sub> (%)', y: 'Cumulative share of states (%)' }));
    draw(page.querySelector('#sd_hist'), hs, layout({ title: 'Efficiency distribution over states, 2 % bins', x: 'η<sub>tot</sub> (%)', y: 'States', barmode: 'overlay', bargap: 0.02 }));
  }
  function map() {
    const s = st(), d = s.data, n = s.active, el = page.querySelector('#sd_map');
    if (!n) return;
    const G = 91;
    let r0 = Infinity, r1 = -Infinity, x0 = Infinity, x1 = -Infinity;
    for (let i = 0; i < d.n; i++) { r0 = Math.min(r0, d.R[i]); r1 = Math.max(r1, d.R[i]); x0 = Math.min(x0, d.X[i]); x1 = Math.max(x1, d.X[i]); }
    const dr = 0.06 * (r1 - r0 || r0 * 0.1), dx = 0.06 * (x1 - x0 || 1);
    const R = Array.from({ length: G }, (_, i) => Math.max(1e-6, r0 - dr + (r1 - r0 + 2 * dr) * i / (G - 1)));
    const X = Array.from({ length: G }, (_, i) => x0 - dx + (x1 - x0 + 2 * dx) * i / (G - 1));
    const zR = new Float64Array(G * G), zX = new Float64Array(G * G);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { zR[i + G * j] = R[i]; zX[i + G * j] = X[j]; }
    const e = etaMany(n.X, n.kind, zR, zX, n.p.Zs, n.p.QL, n.p.QC);
    const Z = Array.from({ length: G }, (_, j) => Array.from(e.subarray(G * j, G * (j + 1)), v => 100 * v));
    draw(el, [
      { type: 'contour', x: R, y: X, z: Z, colorscale: VIRIDIS, contours: { coloring: 'heatmap', showlabels: true, labelfont: { size: 13, color: '#fff' } }, line: { color: 'rgba(15,20,30,.5)', width: 0.8 }, colorbar: { title: { text: 'η<sub>tot</sub> (%)', side: 'right', font: { size: SIZE.axis } }, thickness: 16, outlinewidth: 0, len: 0.9 }, hovertemplate: 'R = %{x:.4f} Ω<br>X = %{y:.2f} Ω<br>η<sub>tot</sub> = %{z:.2f} %<extra></extra>' },
      { x: Array.from(d.R), y: Array.from(d.X), type: 'scatter', mode: 'markers', marker: { size: 5, color: '#fff', line: { color: '#14171c', width: 0.8 } }, customdata: Array.from(n.score.eta, v => 100 * v), hovertemplate: 'R = %{x:.4f} Ω<br>X = %{y:.3f} Ω<br>η<sub>tot</sub> = %{customdata:.2f} %<extra></extra>', showlegend: false },
    ], layout({ title: `Efficiency over the load plane: ${n.name}`, x: 'Resistance, R (Ω)', y: 'Reactance, X (Ω)', legend: false }));
  }
  function exportCsv() {
    const s = st(), d = s.data, nets = s.nets, pk = Object.keys(d.params);
    const head = ['State', 'R (ohm)', 'X (ohm)', ...pk, ...nets.map(n => `eta ${n.method_name} (%)`), ...(s.limits ? ['Efficiency limit (%)'] : [])];
    const rows = [head.map(h => `"${h}"`).join(',')];
    for (let i = 0; i < d.n; i++) {
      rows.push([i + 1, d.R[i], d.X[i], ...pk.map(k => d.params[k][i]), ...nets.map(n => (100 * n.score.eta[i]).toFixed(4)), ...(s.limits ? [(100 * s.limits[i]).toFixed(4)] : [])].join(','));
    }
    download(`${safeName('load_set_results')}.csv`, rows.join('\n') + '\n', 'text/csv');
  }
}

// ------------------------------------------------------------ Smith chart
function smithView() {
  let page, smith, gx = [], gy = [];
  return {
    mount(pg) {
      page = pg;
      pg.innerHTML = `<div id="sm_none">${empty(NO_STATES)}</div><div class="card full" id="sm_body" hidden><div class="toolbar" style="margin-bottom:6px"><button class="btn" id="sm_zs">Zoom to states</button><button class="btn" id="sm_full">Full chart</button></div><div class="smith" id="sm_chart"></div></div>`;
      smith = new Smith(pg.querySelector('#sm_chart'));
      pg.querySelector('#sm_zs').addEventListener('click', zoomStates);
      pg.querySelector('#sm_full').addEventListener('click', () => smith.reset());
    },
    render() {
      const s = st(), p = env();
      page.querySelector('#sm_none').hidden = !!s.data;
      page.querySelector('#sm_body').hidden = !s.data;
      if (!s.data || !p) return;
      const Z0 = p.Z0, traces = [], ann = [], hover = [];
      gx = []; gy = [];
      for (let i = 0; i < s.data.n; i++) {
        const g = z2gamma(s.data.R[i], s.data.X[i], Z0);
        gx.push(g[0]); gy.push(g[1]);
        hover.push({ gx: g[0], gy: g[1], title: `State ${i + 1}`, rows: s.active ? [[`η, ${s.active.method_name}`, `${pc(s.active.score.eta[i])} %`]] : [] });
      }
      for (const n of s.nets) {
        const a = pathTraces(n, Z0, { main: s.active && n.id === s.active.id, annotate: false });
        traces.push(...a.traces); hover.push(...a.hover);
      }
      traces.push({ x: gx, y: gy, type: 'scatter', mode: 'markers', name: 'Load states', marker: { size: 6, color: COLOR.pink, line: { color: '#14171c', width: 0.5 } }, hoverinfo: 'skip' });
      const m = pointTrace([p.Zs[0], -p.Zs[1]], Z0, 'Z<sub>s</sub>*', { symbol: 'star', size: 17, ax: 30, ay: 28 });
      traces.push(m.trace); ann.push(m.ann); hover.push(m.hover);
      const prob = s.active ? { ZL: s.active.ZL, Zs: p.Zs, QL: p.QL, QC: p.QC, Z0 } : null;
      smith.set({ title: `Load states and network paths, Z<sub>0</sub> = ${Z0} Ω`, Z0, traces, annotations: ann, hover, problem: prob, legendRows: 2 });
    },
  };
  function zoomStates() {
    if (!gx.length) return;
    const m = Math.max(Math.max(...gx) - Math.min(...gx), Math.max(...gy) - Math.min(...gy), 1e-3) * 0.25;
    smith.zoomTo({ x0: Math.min(...gx) - m, x1: Math.max(...gx) + m, y0: Math.min(...gy) - m, y1: Math.max(...gy) + m });
  }
}
void isCurrent;
