// Efficiency fields over the reflection plane. Port of the 'exact' source of
// mn_effmap. A cell beyond the unit circle takes the value at the rim, so the
// filled field reaches the chart edge; the chart masks everything outside it.
import { exact } from './exact.js';

export const G_MAX = 0.99995;

/** Point values at one reflection coefficient. Null outside the chart. */
export function fieldAt(p, gx, gy) {
  const m = Math.hypot(gx, gy);
  if (m >= 1) return null;
  const z = gamma2z(gx, gy, p.Z0);
  const ar = z[0] + p.Zs[0], ai = z[1] + p.Zs[1];
  const em = 4 * z[0] * p.Zs[0] / (ar * ar + ai * ai);
  let el = exact(p.ZL[0], p.ZL[1], z[0], z[1], p.QL, p.QC);
  if (el <= 1e-9) el = NaN;
  if (el > 1) el = 1;
  return { z, eta_loss: el, eta_match: em, eta_tot: el * em };
}

export function gamma2z(gx, gy, Z0) {
  const dr = 1 - gx, di = -gy, d = dr * dr + di * di, nr = 1 + gx, ni = gy;
  return [Z0 * (nr * dr + ni * di) / d, Z0 * (ni * dr - nr * di) / d];
}

export function z2gamma(zr, zi, Z0) {
  const nr = zr - Z0, ni = zi, dr = zr + Z0, di = zi, d = dr * dr + di * di;
  return [(nr * dr + ni * di) / d, (ni * dr - nr * di) / d];
}

/** Fields on an n x n grid over the window [x0, x1] x [y0, y1]. */
export function fieldGrid(p, x0, x1, y0, y1, n) {
  const loss = new Float32Array(n * n), match = new Float32Array(n * n), tot = new Float32Array(n * n);
  const xs = new Float64Array(n), ys = new Float64Array(n);
  for (let i = 0; i < n; i++) { xs[i] = x0 + (x1 - x0) * i / (n - 1); ys[i] = y0 + (y1 - y0) * i / (n - 1); }
  const { ZL, Zs, QL, QC, Z0 } = p;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let gx = xs[i], gy = ys[j];
      const m = Math.hypot(gx, gy);
      if (m > G_MAX) { gx *= G_MAX / m; gy *= G_MAX / m; }
      const z = gamma2z(gx, gy, Z0);
      const ar = z[0] + Zs[0], ai = z[1] + Zs[1];
      const em = 4 * z[0] * Zs[0] / (ar * ar + ai * ai);
      let el = exact(ZL[0], ZL[1], z[0], z[1], QL, QC);
      if (!(el > 1e-9)) el = NaN; else if (el > 1) el = 1;
      const q = i + n * j;
      loss[q] = el; match[q] = em; tot[q] = el * em;
    }
  }
  // The unreachable sliver at the rim is far narrower than one cell at full view,
  // where sampling turns it into a sawtooth. Two passes extend the field across it
  // for drawing only; hover values come from fieldAt and stay exact.
  for (let pass = 0; pass < 2; pass++) {
    const src = loss.slice(), srt = tot.slice();
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const q = i + n * j;
      if (!Number.isNaN(src[q])) continue;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = i + a, y = j + b;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const r = x + n * y;
        if (!Number.isNaN(src[r])) { loss[q] = src[r]; tot[q] = srt[r]; break; }
      }
    }
  }
  return { xs, ys, loss, match, tot, n };
}
