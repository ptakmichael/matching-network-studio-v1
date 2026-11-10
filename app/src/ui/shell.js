// Application shell: workflows, the inputs they share, compute workers, navigation.
//
// The application is four independent workflows. Each owns its inputs (left panel),
// its results and its views; nothing computed in one appears in another unless the
// user sends it there (a network to Tolerance, a load to Single load).
import { hideTip } from './smith.js';

export const S = {
  single: { p: null, closed: null, nets: [], geo: null, geoLevels: [], active: null, key: '' },
  set: { data: null, cfg: null, nets: [], limits: null, req: null, active: null, key: '' },
  tol: { id: null },
};

// ------------------------------------------------------------------ workers
export class Runner {
  constructor() {
    this.url = URL.createObjectURL(new Blob([__WORKER_SRC__], { type: 'text/javascript' }));
    this.spawn();
  }
  spawn() {
    this.w = new Worker(this.url);
    this.cbs = new Map();
    this.w.onmessage = e => {
      const { id, type, data } = e.data, cb = this.cbs.get(id);
      if (!cb) return;
      if (type === 'end' || type === 'error') this.cbs.delete(id);
      cb(type, data);
    };
    this.next = 1;
  }
  run(cmd, arg, cb) {
    const id = this.next++;
    this.cbs.set(id, cb);
    this.w.postMessage({ id, cmd, arg });
    return id;
  }
  get busy() { return this.cbs.size > 0; }
  cancel() {
    this.w.terminate();
    for (const cb of this.cbs.values()) cb('cancelled', null);
    this.spawn();
  }
}

// ----------------------------------------------------------- shared inputs
// Source and components describe the same hardware in every workflow, so they are
// one set of values shown in each panel that needs them.
const ENV = { zsr: 50, zsx: 0, ql: 50, qc: 1000, f0: 433, z0: 50 };
const DEFAULTS = { ...ENV, zlr: 0.2404, zlx: 90.56, n: '2-4', topo: 'all', grid: 4 };
let saved = (() => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('mn_inputs') || '{}') }; } catch { return { ...DEFAULTS }; } })();
export const stored = k => saved[k];
export function store(k, v) {
  saved[k] = v;
  try { localStorage.setItem('mn_inputs', JSON.stringify(saved)); } catch { /* storage unavailable */ }
}

export const fld = (id, label, val, extra = '') => `<div class="fld"><label for="${id}">${label}</label><input id="${id}" type="text" inputmode="decimal" value="${val}" autocomplete="off" ${extra}></div>`;
const envFld = (ws, k, label) => fld(`${ws}-${k}`, label, saved[k], `class="env" data-k="${k}"`);

/** The source and component fields, for one workflow's panel. */
export function envFields(ws, { f0 = true } = {}) {
  return `<h2>Source impedance, Z<sub>s</sub></h2>
  <div class="row2">${envFld(ws, 'zsr', 'R (Ω)')}${envFld(ws, 'zsx', 'X (Ω)')}</div>
  <h2>Components</h2>
  <div class="row2">${envFld(ws, 'ql', 'Inductor Q<sub>L</sub>')}${envFld(ws, 'qc', 'Capacitor Q<sub>C</sub>')}</div>
  <div class="row2">${f0 ? envFld(ws, 'f0', 'Frequency (MHz)') : ''}${envFld(ws, 'z0', 'Chart Z<sub>0</sub> (Ω)')}</div>`;
}

const num = (k, what) => {
  const s = String(saved[k]).trim(), n = Number(s);
  if (s === '' || !Number.isFinite(n)) throw new Error(`Enter a number for ${what}.`);
  return n;
};
/** Source, components, frequency and chart reference, validated. */
export function readEnv() {
  const e = { Zs: [num('zsr', 'the source impedance'), num('zsx', 'the source impedance')], QL: num('ql', 'Q_L'), QC: num('qc', 'Q_C'), f0: num('f0', 'the frequency') * 1e6, Z0: num('z0', 'the chart Z0') };
  if (!(e.Z0 > 0)) throw new Error('Chart Z0 must be above 0 Ω.');
  if (!(e.Zs[0] > 0)) throw new Error('Source resistance must be above 0 Ω.');
  if (!(e.QL > 0) || !(e.QC > 0)) throw new Error('Component Q must be above 0.');
  if (!(e.f0 > 0)) throw new Error('Frequency must be above 0.');
  return e;
}
export const envKey = () => ['zsr', 'zsx', 'ql', 'qc', 'f0', 'z0'].map(k => String(saved[k]).trim()).join('|');

// ------------------------------------------------------------ chart grid
// One discretization for everything computed on a grid over the Smith chart: the
// Dijkstra solver and both efficiency maps. Closed forms and ladders use no grid,
// so they stay fixed while it changes, and show what is grid noise.
export const GRID_STOPS = [41, 61, 91, 121, 181, 241, 361];
const gridIdx = () => Math.min(GRID_STOPS.length - 1, Math.max(0, Math.round(Number(saved.grid)) || 0));
export const gridN = () => GRID_STOPS[gridIdx()];

// ---------------------------------------------------------------- navigation
let WS = [], VIEWS = [];
const cur = { ws: 'single', view: {} };
const dirty = new Set();
const pageKey = () => `${cur.ws}:${cur.view[cur.ws]}`;
export const currentWs = () => cur.ws;

/** Mark views as needing a redraw: 'single' marks every view of that workflow. */
export function invalidate(...names) {
  for (const n of names) for (const v of VIEWS) if (v.key === n || v.ws === n) dirty.add(v.key);
  flush();
}
function renderView(key) {
  if (!dirty.has(key)) return;
  dirty.delete(key);
  VIEWS.find(v => v.key === key).view.render();
}
function flush() {
  renderView(pageKey());
  // the other views render while the application is idle, so opening one costs nothing
  const idle = window.requestIdleCallback || (f => setTimeout(f, 60));
  clearTimeout(flush.t);
  flush.t = setTimeout(() => idle(() => {
    const k = [...dirty].find(d => d !== pageKey() && d.startsWith(`${cur.ws}:`)) || [...dirty].find(d => d !== pageKey());
    if (k) { renderView(k); flush(); }
  }), 120);
}
export const isCurrent = key => pageKey() === key;

export function showWs(id, view) {
  cur.ws = id;
  if (view) cur.view[id] = view;
  hideTip();
  document.querySelectorAll('.wtab').forEach(b => { const on = b.dataset.w === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  document.querySelectorAll('.wside').forEach(s => { const on = s.dataset.w === id; s.classList.toggle('on', on); s.inert = !on; });
  const w = WS.find(x => x.id === id), sub = document.getElementById('subnav');
  sub.innerHTML = w.views.length > 1 ? w.views.map(v => `<button class="stab ${v.id === cur.view[id] ? 'on' : ''}" role="tab" data-v="${v.id}">${v.label}</button>`).join('') : `<span class="stitle">${w.views[0].label}</span>`;
  showView(cur.view[id]);
  if (w.shown) w.shown();
  showStatus();
}
function showView(id) {
  cur.view[cur.ws] = id;
  hideTip();
  const key = pageKey();
  document.querySelectorAll('.stab').forEach(b => b.classList.toggle('on', b.dataset.v === id));
  document.querySelectorAll('.page').forEach(p => { const on = p.dataset.k === key; p.classList.toggle('on', on); p.inert = !on; });
  renderView(key);
  const v = VIEWS.find(x => x.key === key);
  if (v.view.shown) v.view.shown();
}

// ------------------------------------------------------------------- status
// Each workflow has its own status and its own Cancel; the header shows the
// status of the workflow on screen.
const STATUS = {};
let statusEl, barEl, cancelEl, barWrap;
export function status(ws, text, frac) { STATUS[ws] = { text, frac }; if (ws === cur.ws) showStatus(); }
function showStatus() {
  const s = STATUS[cur.ws] || { text: '' }, busy = s.frac != null;
  statusEl.textContent = s.text;
  barWrap.style.display = busy ? '' : 'none';
  cancelEl.style.display = busy ? '' : 'none';
  if (busy) barEl.style.width = `${Math.round(100 * s.frac)}%`;
}

// ---------------------------------------------------------------------- boot
export function boot(list) {
  WS = list;
  VIEWS = WS.flatMap(w => w.views.map(v => ({ ...v, ws: w.id, key: `${w.id}:${v.id}` })));
  for (const w of WS) cur.view[w.id] = w.views[0].id;
  for (const v of VIEWS) dirty.add(v.key);
  document.getElementById('app').innerHTML = `
  <div class="shell">
    <header class="top"><div class="brand">Matching Network Studio</div>
      <nav class="wtabs" role="tablist">${WS.map(w => `<button class="wtab" role="tab" data-w="${w.id}" title="${w.hint}">${w.label}</button>`).join('')}</nav>
      <div class="gridctl" title="Points per axis of every grid over the Smith chart: the Dijkstra solver, the efficiency maps and the Limits map. Closed-form results and ladders use no grid.">
        <label for="gridr">Smith chart grid</label>
        <input type="range" id="gridr" min="0" max="${GRID_STOPS.length - 1}" step="1" value="${gridIdx()}" list="gridticks">
        <datalist id="gridticks">${GRID_STOPS.map((_, i) => `<option value="${i}"></option>`).join('')}</datalist>
        <output id="gridv">${gridN()} × ${gridN()}</output></div>
      <div class="status"><span id="st"></span><div class="bar" id="barw" style="display:none"><i id="bar"></i></div><button id="cancel" style="display:none">Cancel</button></div>
    </header>
    <aside class="side">${WS.map(w => `<div class="wside" data-w="${w.id}">${w.side()}</div>`).join('')}</aside>
    <main class="main"><nav class="subnav" id="subnav" role="tablist"></nav>
      <div class="pages">${VIEWS.map(v => `<section class="page" data-k="${v.key}"></section>`).join('')}</div></main>
  </div>`;
  statusEl = document.getElementById('st'); barEl = document.getElementById('bar');
  barWrap = document.getElementById('barw'); cancelEl = document.getElementById('cancel');
  // shared fields: one value, shown in every panel
  document.querySelector('.side').addEventListener('input', e => {
    const t = e.target;
    if (t.classList.contains('env')) {
      store(t.dataset.k, t.value);
      document.querySelectorAll(`.env[data-k="${t.dataset.k}"]`).forEach(x => { if (x !== t) x.value = t.value; });
      for (const w of WS) if (w.envChanged) w.envChanged();
    }
  });
  for (const w of WS) w.mount(document.querySelector(`.wside[data-w="${w.id}"]`));
  for (const v of VIEWS) v.view.mount(document.querySelector(`.page[data-k="${v.key}"]`));
  document.querySelector('.wtabs').addEventListener('click', e => { const b = e.target.closest('.wtab'); if (b) showWs(b.dataset.w); });
  document.getElementById('subnav').addEventListener('click', e => { const b = e.target.closest('.stab'); if (b) showView(b.dataset.v); });
  const gr = document.getElementById('gridr'), gv = document.getElementById('gridv');
  gr.addEventListener('input', () => { const n = GRID_STOPS[+gr.value]; gv.textContent = `${n} × ${n}`; });
  // recompute when the slider is released, not at every step it passes
  gr.addEventListener('change', () => { store('grid', +gr.value); for (const w of WS) if (w.gridChanged) w.gridChanged(); });
  cancelEl.addEventListener('click', () => { const w = WS.find(x => x.id === cur.ws); if (w.cancel) w.cancel(); });
  showWs(WS[0].id);
  for (const w of WS) if (w.start) w.start();
}
