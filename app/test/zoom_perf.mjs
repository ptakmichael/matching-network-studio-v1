// Continuous-scroll test of the Efficiency Maps chart. Records the visible span and
// the frame interval on every animation frame while wheel events stream in.
//   reversals: frames where the view moved back against the scroll direction
import { chromium } from 'playwright-core';
import path from 'node:path';
const exe = path.join(process.env.HOME, '.cache/ms-playwright/chromium-1134/chrome-linux/chrome');
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const b = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const pg = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto('file://' + path.join(ROOT, 'app/dist/MN_Studio.html'));
await pg.waitForFunction(() => /Solved in/.test(document.getElementById('st').textContent), null, { timeout: 60000 });
await pg.waitForTimeout(5000);
await pg.click('.tab[data-t="maps"]'); await pg.waitForTimeout(800);
const box = await pg.locator('#m_smith').boundingBox();
const px = box.x + box.width * 0.5, py = box.y + box.height * 0.28;
const start = () => pg.evaluate(() => {
  const el = document.querySelector('#m_smith');
  const span = () => {
    if (el.__smith) return el.__smith.view.x1 - el.__smith.view.x0;
    const r = el._fullLayout.xaxis.range; return r[1] - r[0];
  };
  const L = window.__L = { t: [], s: [], on: true };
  const f = () => { L.t.push(performance.now()); L.s.push(span()); if (L.on) requestAnimationFrame(f); };
  requestAnimationFrame(f);
});
const stop = () => pg.evaluate(() => {
  const L = window.__L; L.on = false;
  const d = L.t.slice(1).map((v, i) => v - L.t[i]).sort((a, c) => a - c);
  let rev = 0, back = 0;
  for (let i = 1; i < L.s.length; i++) {
    const r = L.s[i] / L.s[i - 1];
    if (window.__dir * (r - 1) > 0.002) { rev++; back = Math.max(back, Math.abs(r - 1)); }
  }
  return { frames: L.t.length, medianFrame: +d[d.length >> 1].toFixed(1), worstFrame: +d[d.length - 1].toFixed(0), over50ms: d.filter(v => v > 50).length, reversals: rev, biggestJumpBack: +(100 * back).toFixed(1) + ' %', spanEnd: +L.s[L.s.length - 1].toFixed(4) };
});
for (const mode of (process.env.MODES || 'both,fill,grad').split(',')) {
  await pg.click(`#m_d button[data-v=${mode}]`); await pg.waitForTimeout(400);
  await pg.click('#m_rs'); await pg.waitForTimeout(1200);
  await pg.mouse.move(px, py, { steps: 3 });
  for (const [name, dy, dir] of [['in', -120, 1], ['out', 120, -1]]) {
    await pg.evaluate(v => { window.__dir = v; }, dir);
    await start();
    for (let i = 0; i < (+process.env.STEPS || 30); i++) { await pg.mouse.wheel(0, dy); await pg.waitForTimeout(25); }
    await pg.waitForTimeout(1500);
    console.log(mode.padEnd(5), name.padEnd(4), JSON.stringify(await stop()));
  }
}
console.log('errors', errs.length, errs.slice(0, 3));
await b.close();
