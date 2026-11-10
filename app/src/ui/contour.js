// Isolines by marching squares, on a regular grid. Output is a flat array of
// segments x0 y0 x1 y1, in the grid's own coordinates.
export function isolines(z, xs, ys, levels) {
  const n = xs.length, out = [];
  for (const L of levels) {
    const seg = [];
    for (let j = 0; j < n - 1; j++) {
      const y0 = ys[j], y1 = ys[j + 1];
      for (let i = 0; i < n - 1; i++) {
        const a = z[i + n * j], b = z[i + 1 + n * j], c = z[i + 1 + n * (j + 1)], d = z[i + n * (j + 1)];
        if (a !== a || b !== b || c !== c || d !== d) continue;
        const code = (a > L ? 1 : 0) | (b > L ? 2 : 0) | (c > L ? 4 : 0) | (d > L ? 8 : 0);
        if (code === 0 || code === 15) continue;
        const x0 = xs[i], x1 = xs[i + 1];
        const bot = () => [x0 + (L - a) / (b - a) * (x1 - x0), y0];
        const rgt = () => [x1, y0 + (L - b) / (c - b) * (y1 - y0)];
        const top = () => [x0 + (L - d) / (c - d) * (x1 - x0), y1];
        const lft = () => [x0, y0 + (L - a) / (d - a) * (y1 - y0)];
        const put = (p, q) => seg.push(p[0], p[1], q[0], q[1]);
        switch (code) {
          case 1: case 14: put(bot(), lft()); break;
          case 2: case 13: put(bot(), rgt()); break;
          case 3: case 12: put(lft(), rgt()); break;
          case 4: case 11: put(rgt(), top()); break;
          case 6: case 9: put(bot(), top()); break;
          case 7: case 8: put(lft(), top()); break;
          case 5: case 10: {
            const m = (a + b + c + d) / 4 > L;
            if ((code === 5) === m) { put(bot(), rgt()); put(lft(), top()); } else { put(bot(), lft()); put(rgt(), top()); }
            break;
          }
          default:
        }
      }
    }
    out.push({ level: L, seg: Float32Array.from(seg) });
  }
  return out;
}

/** Label positions. Every level gets one label first, placed along a fixed bearing
 *  from the middle of the view; remaining space is then filled. */
export function labelSpots(lines, minDist, inside, cx = 0, cy = 0) {
  const spots = [], far = (x, y, d) => !spots.some(s => Math.hypot(s.x - x, s.y - y) < d);
  const add = (seg, q, level) => {
    const x = 0.5 * (seg[q] + seg[q + 2]), y = 0.5 * (seg[q + 1] + seg[q + 3]);
    let a = Math.atan2(seg[q + 3] - seg[q + 1], seg[q + 2] - seg[q]);
    if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI;
    spots.push({ x, y, a, level });
  };
  const bearings = [-0.6, 2.3];
  lines.forEach(({ level, seg }, i) => {
    const b = bearings[i % 2];
    let best = -1, bd = Infinity;
    for (let q = 0; q < seg.length; q += 4) {
      const x = 0.5 * (seg[q] + seg[q + 2]), y = 0.5 * (seg[q + 1] + seg[q + 3]);
      if (!inside(x, y)) continue;
      const d = Math.abs(Math.atan2(Math.sin(Math.atan2(y - cy, x - cx) - b), Math.cos(Math.atan2(y - cy, x - cx) - b)));
      if (d < bd && far(x, y, minDist * 0.3)) { bd = d; best = q; }
    }
    if (best >= 0) add(seg, best, level);
  });
  for (const { level, seg } of lines) {
    const nseg = seg.length / 4;
    let n = 0;
    for (let k = Math.floor(nseg * 0.13); k < nseg && n < 2; k += 7) {
      const q = 4 * k, x = 0.5 * (seg[q] + seg[q + 2]), y = 0.5 * (seg[q + 1] + seg[q + 3]);
      if (!inside(x, y) || !far(x, y, minDist)) continue;
      add(seg, q, level); n++;
      if (spots.length > 50) return spots;
    }
  }
  return spots;
}
