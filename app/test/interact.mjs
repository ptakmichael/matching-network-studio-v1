// Interaction checks in Chromium: latency, zoom, hover, uploads, bad input, exports.
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
const exe = path.join(process.env.HOME, '.cache/ms-playwright/chromium-1134/chrome-linux/chrome');
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const OUT = path.join(import.meta.dirname, 'out');
const HF = path.join(ROOT, 'Borchardt Loop Orientation Testing HFSS');
const CSV = path.join(HF, 'mn_n400/10212026_MC_N400/MC_N400_Result_433MHz.csv');
const b = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true });
const pg = await ctx.newPage();
const errs = [];
pg.on('pageerror', e => errs.push('pageerror: ' + e.message));
pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await pg.goto('file://' + path.join(ROOT, 'app/dist/MN_Studio.html'));
await pg.waitForFunction(() => /Solved in/.test(document.getElementById('st').textContent), null, { timeout: 60000 });
await pg.waitForTimeout(6000);   // Dijkstra levels finish, idle pre-render finishes

// ---- tab-switch latency, click to next painted frame
const lat = await pg.evaluate(async () => {
  const tabs = [...document.querySelectorAll('.tab')], out = {};
  for (let r = 0; r < 5; r++) for (const t of tabs) {
    const t0 = performance.now();
    t.click();
    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    (out[t.textContent] = out[t.textContent] || []).push(performance.now() - t0);
  }
  return out;
});
for (const [k, v] of Object.entries(lat)) console.log(`tab ${k.padEnd(16)} median ${v.sort((a, c) => a - c)[2].toFixed(1)} ms  max ${v[4].toFixed(1)} ms`);

// ---- maps: hover
await pg.click('.stab[data-v="maps"]'); await pg.waitForTimeout(500);
const box = await pg.locator('#m_smith').boundingBox();
const cx = box.x + box.width * 0.42, cy = box.y + box.height * 0.45;
await pg.mouse.move(cx, cy, { steps: 5 }); await pg.waitForTimeout(150);
console.log('tooltip:', (await pg.textContent('#tip')).replace(/\s+/g, ' '));
await pg.screenshot({ path: path.join(OUT, 'i1_hover.png') });

// ---- zoom with the wheel towards Z_L, field must recompute
const rangeBefore = await pg.evaluate(() => document.querySelector('#m_info').textContent);
await pg.click('#m_zp'); await pg.waitForTimeout(900);
const zlPt = await pg.evaluate(() => {
  const el = document.querySelector('#m_smith'), m = el.__smith, r = m.cv.getBoundingClientRect(), v = m.view;
  return [r.left + (0.41 - v.x0) / (v.x1 - v.x0) * m.w, r.top + (v.y1 - 0.905) / (v.y1 - v.y0) * m.h];
});
await pg.mouse.move(zlPt[0], zlPt[1]);
for (let i = 0; i < 10; i++) { await pg.mouse.wheel(0, -240); await pg.waitForTimeout(60); }
await pg.waitForTimeout(1100);
const view = () => pg.evaluate(() => ({ ...document.querySelector('#m_smith').__smith.view }));
const v = await view();
console.log('view after wheel:', [v.x0, v.x1, v.y0, v.y1].map(x => x.toFixed(4)).join(' '));
console.log('field before:', rangeBefore); console.log('field after: ', await pg.textContent('#m_info'));
await pg.mouse.move(zlPt[0] + 40, zlPt[1] + 60, { steps: 5 }); await pg.waitForTimeout(150);
console.log('tooltip zoomed:', (await pg.textContent('#tip')).replace(/\s+/g, ' '));
await pg.screenshot({ path: path.join(OUT, 'i2_zoom.png') });
// drag pans by the same amount in the reflection plane; double-click restores the chart
const dv0 = await view();
await pg.mouse.move(zlPt[0] - 300, zlPt[1] + 200); await pg.mouse.down(); await pg.mouse.move(zlPt[0] - 200, zlPt[1] + 260, { steps: 6 }); await pg.mouse.up(); await pg.waitForTimeout(250);
const dv1 = await view();
console.log('drag pan: dx', (dv1.x0 - dv0.x0).toFixed(5), 'dy', (dv1.y0 - dv0.y0).toFixed(5), 'span kept', Math.abs((dv1.x1 - dv1.x0) / (dv0.x1 - dv0.x0) - 1) < 1e-9);
await pg.mouse.dblclick(zlPt[0] - 200, zlPt[1] + 260); await pg.waitForTimeout(500);
const dv2 = await view();
console.log('double-click: full chart', dv2.y1 - dv2.y0 > 2.2);
for (const m of ['fill', 'grad', 'both']) { await pg.click(`#m_d button[data-v=${m}]`); await pg.waitForTimeout(500); await pg.screenshot({ path: path.join(OUT, `i2_${m}.png`) }); }
await pg.click('#m_zp'); await pg.waitForTimeout(900);
{ const [d] = await Promise.all([pg.waitForEvent('download'), pg.click('#m_smith .sc-btns [data-z=png]')]); const f = path.join(OUT, 'chart.png'); await d.saveAs(f); console.log('chart PNG', fs.statSync(f).size, 'bytes'); }
await pg.click('#m_rs'); await pg.waitForTimeout(500);
await pg.click('#m_q button[data-v=loss]'); await pg.waitForTimeout(500);
await pg.click('#m_rs'); await pg.waitForTimeout(900);
await pg.screenshot({ path: path.join(OUT, 'i3_loss_full.png') });
await pg.click('#m_d button[data-v=fill]'); await pg.waitForTimeout(400);
await pg.click('#m_q button[data-v=tot]'); await pg.waitForTimeout(400);

// ---- validation page
await pg.click('.stab[data-v="design"]'); await pg.waitForTimeout(400);
await pg.click('#d_all'); await pg.click('#d_geo'); await pg.waitForTimeout(500);
const pathPt = await pg.evaluate(() => { const m = document.querySelector('#d_smith').__smith, h = m.data.hover.find(q => q.title.includes(': C')), r = m.cv.getBoundingClientRect(), v = m.view; return [r.left + (h.gx - v.x0) / (v.x1 - v.x0) * m.w, r.top + (v.y1 - h.gy) / (v.y1 - v.y0) * m.h]; });
await pg.mouse.move(pathPt[0], pathPt[1], { steps: 3 }); await pg.waitForTimeout(150);
console.log('path hover:', (await pg.textContent('#tip')).replace(/\s+/g, ' ').slice(0, 70));
await pg.screenshot({ path: path.join(OUT, 'i1_design_all.png') });
const legN = await pg.locator('#d_smith .sc-leg button').count();
await pg.locator('#d_smith .sc-leg button').first().click(); await pg.waitForTimeout(200);
console.log('legend entries', legN, 'hidden after click', await pg.locator('#d_smith .sc-leg button.off').count());
await pg.locator('#d_smith .sc-leg button').first().click();
await pg.click('#d_all'); await pg.click('#d_geo');

// ---- circuit page and exports
await pg.click('.stab[data-v="circuit"]'); await pg.waitForTimeout(500);
await pg.screenshot({ path: path.join(OUT, 'i5_circuit.png') });
for (const k of ['cir', 'asc', 'svg', 'png', 'csv']) {
  const [d] = await Promise.all([pg.waitForEvent('download'), pg.click(`.page.on [data-x=${k}]`)]);
  const f = path.join(OUT, d.suggestedFilename()); await d.saveAs(f);
  console.log('download', d.suggestedFilename(), fs.statSync(f).size, 'bytes');
}

// ---- long ladder stays readable
await pg.fill('#nspec', '8'); await pg.selectOption('#topo', 'free'); await pg.click('#solve');
await pg.waitForFunction(() => /Solved in/.test(document.getElementById('st').textContent), null, { timeout: 60000 });
await pg.waitForTimeout(500);
await pg.screenshot({ path: path.join(OUT, 'i6_n8.png') });

// ---- bad input
await pg.fill('#zlr', '-1'); await pg.click('#solve'); await pg.waitForTimeout(150);
console.log('bad R:', await pg.textContent('#serr'));
await pg.fill('#zlr', 'abc'); await pg.click('#solve'); await pg.waitForTimeout(150);
console.log('bad text:', await pg.textContent('#serr'));
await pg.fill('#zlr', '0.2404'); await pg.fill('#nspec', '40'); await pg.click('#solve'); await pg.waitForTimeout(150);
console.log('bad N:', await pg.textContent('#serr'));
await pg.fill('#nspec', '2-4'); await pg.selectOption('#topo', 'all'); await pg.click('#solve');
await pg.waitForFunction(() => /Solved in/.test(document.getElementById('st').textContent), null, { timeout: 60000 });

// ---- other upload forms
await pg.click('.wtab[data-w="set"]'); await pg.waitForTimeout(300);
const tmp = path.join(OUT, 'tmp'); fs.mkdirSync(tmp, { recursive: true });
const up = async (files, label) => {
  await pg.setInputFiles('#s_in', files); await pg.waitForTimeout(400);
  console.log(label, '| states:', await pg.locator('#ss_k .kpi .n').first().textContent().catch(() => '-'), '| err:', await pg.textContent('#s_err'), '| src:', await pg.textContent('#s_src'));
};
fs.writeFileSync(path.join(tmp, 'rx.csv'), 'R,X\n1,2\n3,-4\n5,6\n');
fs.writeFileSync(path.join(tmp, 'plain.txt'), '1 2\n3 -4\n');
fs.writeFileSync(path.join(tmp, 'cplx.csv'), 'Z\n1+2j\n3-4j\n');
fs.writeFileSync(path.join(tmp, 'bad.csv'), 'hello,world\nfoo,bar\n');
fs.writeFileSync(path.join(tmp, 'neg.csv'), 'R,X\n-1,2\n3,-4\n5,6\n');
fs.writeFileSync(path.join(tmp, 'ant.s1p'), '# MHz S RI R 50\n430 0.5 0.1\n433 0.4 0.2\n436 0.3 0.3\n');
await up(path.join(tmp, 'rx.csv'), 'R,X csv');
await up(path.join(tmp, 'plain.txt'), 'space separated');
await up(path.join(tmp, 'cplx.csv'), 'complex column');
await up(path.join(tmp, 'bad.csv'), 'bad file');
await up(path.join(tmp, 'neg.csv'), 'negative R row');
await up(path.join(tmp, 'ant.s1p'), 'touchstone');
const zre = path.join(HF, '09212026_Summer26Work_FULL/Shared_Data/HFSS_reference/Zre_tol_free_fine_gapsweep.csv');
await up([zre, zre.replace('Zre_', 'Zim_')], 'HFSS Zre+Zim traces');
await pg.click('#s_mode button[data-v=range]'); await pg.click('#s_mk'); await pg.waitForTimeout(300);
console.log('range: states', await pg.locator('#ss_k .kpi .n').first().textContent());
await pg.click('#s_go');
await pg.waitForFunction(() => /Load set designed/.test(document.getElementById('st').textContent), null, { timeout: 120000 });
console.log('range design:', await pg.textContent('#st'));
await pg.click('#s_mode button[data-v=file]');
await pg.setInputFiles('#s_in', CSV); await pg.waitForTimeout(300);
await pg.click('#s_go');
await pg.waitForFunction(() => /Load set designed/.test(document.getElementById('st').textContent) && !document.getElementById('cancel').offsetParent, null, { timeout: 120000 });
await pg.waitForTimeout(700);
// set plots: built-in hover
await pg.click('.stab[data-v="designs"]'); await pg.waitForTimeout(700);
await pg.evaluate(() => { document.querySelector('.page.on').scrollTop = 1320; }); await pg.waitForTimeout(400);
await pg.screenshot({ path: path.join(OUT, 'i7_set_low.png') });
await pg.evaluate(() => { document.querySelector('.page.on').scrollTop = 2400; }); await pg.waitForTimeout(400);
await pg.screenshot({ path: path.join(OUT, 'i8_set_full.png') });
await pg.click('.stab[data-v="smith"]'); await pg.waitForTimeout(500);
await pg.click('#sm_zs'); await pg.waitForTimeout(800);
await pg.screenshot({ path: path.join(OUT, 'i8_set_smith.png') });
// MC on the load set
await pg.click('.wside.on [data-id=mpct]'); await pg.waitForTimeout(300);
await pg.click('.stab[data-v="circuit"]'); await pg.waitForTimeout(300);
await pg.click('.page.on #c_tol');
await pg.waitForFunction(() => /Monte Carlo finished/.test(document.getElementById('st').textContent), null, { timeout: 60000 }); await pg.waitForTimeout(500);
await pg.screenshot({ path: path.join(OUT, 'i9_mc_set.png') });
await pg.selectOption('#c_net', 's2free'); await pg.waitForTimeout(1500); await pg.selectOption('#c_scope', 'single'); await pg.click('#c_run'); await pg.waitForTimeout(1500);
await pg.evaluate(() => { document.querySelector('.page.on').scrollTop = 900; }); await pg.waitForTimeout(400);
await pg.screenshot({ path: path.join(OUT, 'i10_mc_cloud.png') });
console.log('mc scope:', await pg.inputValue('#c_scope'), '| half markers:', await pg.evaluate(() => document.querySelector('#c_t').data.filter(t => t.mode === 'markers+text').map(t => t.text[0])));
console.log('errors:', errs.length); for (const e of errs.slice(0, 12)) console.log(' ', e);
await b.close();
