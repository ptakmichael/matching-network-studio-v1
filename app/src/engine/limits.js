// Best achievable efficiency over the load plane: the closed-form Z_opt at every load.
import { zopt } from './zopt.js';
import { gamma2z, G_MAX } from './field.js';

// structure of the optimal network, as drawn on the map
export const KINDS = ['No network', 'Inductors only', 'Capacitors only', 'Constant-angle ride', 'Extension'];
export function kindOf(o, ZL) {
  const t0 = ZL[1] / ZL[0], t1 = o.Zin[1] / o.Zin[0];
  if (Math.abs(o.Zin[0] - ZL[0]) <= 1e-9 * ZL[0] && Math.abs(t1 - t0) <= 1e-9 * (1 + Math.abs(t0))) return 0;
  if (o.case === 'single type') return t1 > t0 ? 1 : 2;
  if (o.case === 'pairs' || /ride/.test(o.case)) return 3;
  return 4;
}

/** Rows j0..j1-1 of an n x n grid over [x0, x1] x [y0, y1] in the load reflection plane. */
export function limitsRows(p, x0, x1, y0, y1, n, j0, j1) {
  const m = (j1 - j0) * n;
  const tot = new Float32Array(m), loss = new Float32Array(m), match = new Float32Array(m), kind = new Uint8Array(m);
  const zr = new Float32Array(m), zi = new Float32Array(m);
  for (let j = j0; j < j1; j++) {
    const gy0 = y0 + (y1 - y0) * j / (n - 1);
    for (let i = 0; i < n; i++) {
      let gx = x0 + (x1 - x0) * i / (n - 1), gy = gy0;
      const r = Math.hypot(gx, gy);
      if (r > G_MAX) { gx *= G_MAX / r; gy *= G_MAX / r; }
      const ZL = gamma2z(gx, gy, p.Z0), o = zopt(ZL, p.Zs, p.QL, p.QC), q = i + n * (j - j0);
      tot[q] = o.eta_tot; loss[q] = o.eta_loss; match[q] = o.eta_match; kind[q] = kindOf(o, ZL);
      zr[q] = o.Zin[0]; zi[q] = o.Zin[1];
    }
  }
  return { tot, loss, match, kind, zr, zi };
}
