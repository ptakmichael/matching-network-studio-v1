// Single load: one Z_L, every ladder order and topology, and the views of the chosen network.
import { S, Runner, status, invalidate, envFields, fld, stored, store, readEnv, envKey, showWs, gridN } from './shell.js';
import { nrange } from '../engine/core.js';
import { TOPO_NAME } from '../engine/solve.js';
import { pc } from './plot.js';
import { designTab } from './tab_design.js';
import { mapsTab } from './tab_maps.js';
import { circuitView } from './tab_circuit.js';

const compute = new Runner(), geoRunner = new Runner();
const W = 'single';
let side;

const inputKey = () => [envKey(), ...['zlr', 'zlx', 'n', 'topo'].map(k => String(stored(k)).trim())].join('|');

export const singleWs = {
  id: W, label: 'Single load', hint: 'Design networks for one load impedance',
  views: [
    { id: 'design', label: 'Networks', view: designTab },
    { id: 'maps', label: 'Efficiency maps', view: mapsTab },
    { id: 'circuit', label: 'Circuit', view: circuitView(() => S.single.active, W) },
  ],
  side() {
    return `
    <h2>Load impedance, Z<sub>L</sub></h2>
    <div class="row2">${fld('zlr', 'R (Ω)', stored('zlr'), 'data-s="zlr"')}${fld('zlx', 'X (Ω)', stored('zlx'), 'data-s="zlx"')}</div>
    ${envFields(W)}
    <h2>Network</h2>
    <div class="row2 wide2">${fld('nspec', 'Order N', stored('n'), 'data-s="n"')}
      <div class="fld"><label for="topo">Topology</label><select id="topo" data-s="topo">
        <option value="all">All</option><option value="lowpass">Low-pass</option><option value="highpass">High-pass</option><option value="free">Unconstrained</option>
      </select></div></div>
    <button class="btn pri wide" id="solve">Solve</button>
    <div class="stale" id="s1_stale" hidden>Inputs changed since this solve. Solve again to update.</div>
    <div class="err" id="serr"></div>
    <h2>Networks</h2>
    <div class="nets" id="nets"></div>`;
  },
  mount(el) {
    side = el;
    el.querySelector('#topo').value = stored('topo');
    el.addEventListener('input', e => { const k = e.target.dataset.s; if (k) { store(k, e.target.value); staleNote(); } });
    el.addEventListener('change', e => { const k = e.target.dataset.s; if (k) { store(k, e.target.value); staleNote(); } });
    el.querySelector('#solve').addEventListener('click', solve);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') solve(); });
    el.querySelector('#nets').addEventListener('click', e => {
      const b = e.target.closest('.net');
      if (b) activate(S.single.nets.find(n => n.id === b.dataset.id));
    });
    renderNets();
  },
  envChanged() { staleNote(); },
  gridChanged() { runGeo(); invalidate('single:maps'); },
  cancel() { compute.cancel(); geoRunner.cancel(); },
  start() { solve(); },
};

function staleNote() {
  const s = S.single;
  side.querySelector('#s1_stale').hidden = !s.p || s.key === inputKey();
}

/** Solve for a given load, from another workflow. */
export function solveFor(ZL) {
  store('zlr', +ZL[0].toPrecision(7)); store('zlx', +ZL[1].toPrecision(7));
  side.querySelector('#zlr').value = stored('zlr'); side.querySelector('#zlx').value = stored('zlx');
  showWs(W, 'design');
  solve();
}

function solve() {
  const err = side.querySelector('#serr');
  err.textContent = '';
  let p;
  try {
    const zl = [Number(stored('zlr')), Number(stored('zlx'))];
    if (!zl.every(Number.isFinite)) throw new Error('Enter a number for the load impedance.');
    if (!(zl[0] > 0)) throw new Error('Load resistance must be above 0 Ω.');
    p = { ...readEnv(), ZL: zl, N: String(stored('n')), topo: stored('topo') };
    nrange(p.N);
  } catch (e) { err.textContent = e.message; return; }
  compute.cancel();
  geoRunner.cancel();
  const s = S.single;
  Object.assign(s, { p, closed: null, nets: [], geo: null, geoLevels: [], active: null, key: inputKey() });
  staleNote();
  status(W, 'Solving', 0);
  invalidate(W);
  renderNets();
  const t0 = performance.now();
  runGeo();
  compute.run('solve', p, (type, d) => {
    if (type === 'closed') { s.closed = d; invalidate('single:design', 'single:maps'); }
    else if (type === 'net') {
      const n = decorate(d.net, p);
      s.nets.push(n);
      // a higher order must beat the incumbent by a real margin to be preferred
      if (!s.active || n.eta_tot > s.active.eta_tot + 1e-5) s.active = n;
      status(W, `Solving networks, ${Math.round(100 * d.frac)} %`, d.frac * 0.8);
      renderNets();
      invalidate('single:design');
    } else if (type === 'nets-done') {
      activate(s.active);
    } else if (type === 'end') {
      status(W, `Solved in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    } else if (type === 'error') {
      err.textContent = d; status(W, 'Stopped');
    } else if (type === 'cancelled') status(W, 'Cancelled');
  });
}

/** The Dijkstra solution on the chosen grid, then the other grids for comparison. */
function runGeo() {
  const s = S.single;
  if (!s.p) return;
  geoRunner.cancel();
  s.geo = null; s.geoLevels = [];
  const p = { ...s.p, grid: gridN() };
  invalidate('single:design');
  geoRunner.run('geo', p, (type, d) => {
    if (type === 'geo-level') { s.geoLevels.push(d); invalidate('single:design'); }
    else if (type === 'geo') { s.geo = d; invalidate('single:design'); }
  });
}

function decorate(net, p) {
  return {
    ...net, p, group: 'single',
    id: `s${net.N_req}${net.topo}`,
    name: `N = ${net.N_req}, ${TOPO_NAME[net.topo]}`,
    style: net.topo,
  };
}

export function activate(net) {
  if (!net) return;
  S.single.active = net;
  renderNets();
  invalidate(W);
}

function renderNets() {
  const box = side.querySelector('#nets'), s = S.single;
  box.innerHTML = s.nets.map(n => `<button class="net ${s.active && s.active.id === n.id ? 'on' : ''}" data-id="${n.id}"><b>${n.name}</b><span class="v">${pc(n.eta_tot)} %</span><span class="d">${n.desc}</span></button>`).join('') || '<div class="lab">No results.</div>';
}

