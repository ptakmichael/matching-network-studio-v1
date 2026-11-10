// Compute worker: everything slow runs here so the interface never blocks.
import { closedForm, designs, geodesic, geoLevel, geoGrid, validateProblem } from './engine/solve.js';
import { designSet, setLimits, requiredValues } from './engine/loadset.js';
import { mcSingle, mcSet, tolSweep } from './engine/mc.js';
import { fieldGrid } from './engine/field.js';
import { limitsRows } from './engine/limits.js';
import { zopt } from './engine/zopt.js';

const post = (id, type, data, tr) => self.postMessage({ id, type, data }, tr || []);

const handlers = {
  solve(id, p) {
    validateProblem(p);
    post(id, 'closed', closedForm(p));
    const nets = designs(p, (d, f) => post(id, 'net', { net: d, frac: f }));
    post(id, 'nets-done', { count: nets.length });
  },
  geo(id, p) {
    // the grid chosen in the header first: that is the solution shown; then the other
    // grids, coarse to fine, for the refinement table and the convergence plot
    const [nu, nt] = geoGrid(p.grid || 241);
    const g = geodesic({ ...p, geo_n: nu, geo_t: nt });
    post(id, 'geo', g);
    post(id, 'geo-level', { nu, nt, nodes: g.nodes, eta_tot_opt: g.eta_tot_opt, eta_exact: g.eta_exact, nparts: g.nparts, counts: g.counts });
    for (const m of [41, 61, 91, 121, 181, 241, 361]) {
      if (m === nu) continue;
      const [a, b] = geoGrid(m);
      post(id, 'geo-level', geoLevel(p, a, b));
    }
  },
  field(id, q) {
    const f = fieldGrid(q.p, q.x0, q.x1, q.y0, q.y1, q.n);
    post(id, 'field', { ...f, view: q }, [f.loss.buffer, f.match.buffer, f.tot.buffer]);
  },
  set(id, { S, cfg, methods }) {
    const out = [];
    methods.forEach((m, i) => {
      const seeds = out.slice();
      const d = designSet(S, cfg, m, seeds, f => post(id, 'progress', { frac: (i + f) / (methods.length + 1), text: `Designing network ${i + 1} of ${methods.length}` }));
      out.push(d);
      post(id, 'set-net', d);
    });
    post(id, 'progress', { frac: methods.length / (methods.length + 1), text: 'Closed-form limit at each state' });
    post(id, 'req', requiredValues(S, cfg.Zs, cfg.QL, cfg.QC, cfg.f0, out.find(d => d.X.length === 2)));
    const limits = setLimits(S, cfg.Zs, cfg.QL, cfg.QC, f => post(id, 'progress', { frac: (methods.length + f) / (methods.length + 1), text: 'Closed-form limit at each state' }));
    post(id, 'limits', limits);
  },
  limits(id, q) {
    const r = limitsRows(q.p, q.x0, q.x1, q.y0, q.y1, q.n, q.j0, q.j1);
    post(id, 'limits', { ...r, j0: q.j0, j1: q.j1 }, [r.tot.buffer, r.loss.buffer, r.match.buffer, r.kind.buffer, r.zr.buffer, r.zi.buffer]);
  },
  zopt(id, q) { post(id, 'zopt', zopt(q.ZL, q.Zs, q.QL, q.QC)); },
  mc(id, q) {
    const { net, ZL, Zs, QL, QC, o, S } = q;
    const res = S ? mcSet(net, S.R, S.X, Zs, QL, QC, o) : mcSingle(net, ZL, Zs, o);
    const Zr = S ? S.R : Float64Array.of(ZL[0]), Zi = S ? S.X : Float64Array.of(ZL[1]);
    const sw = tolSweep(net, Zr, Zi, Zs, QL, QC, { pct: o.pct ?? 5, tmax: o.tmax ?? 15, nt: 61 });
    post(id, 'mc', { res, sw, scope: S ? 'set' : 'single' });
  },
};

self.onmessage = e => {
  const { id, cmd, arg } = e.data;
  try {
    handlers[cmd](id, arg);
    post(id, 'end', null);
  } catch (err) {
    post(id, 'error', err.message || String(err));
  }
};
