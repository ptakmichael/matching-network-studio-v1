// Drives the built file in Chromium from file://, as an engineer would open it:
// every workflow, every view, and the hand-offs between them.
import { chromium } from 'playwright-core';
import path from 'node:path';
const exe = path.join(process.env.HOME, '.cache/ms-playwright/chromium-1134/chrome-linux/chrome');
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const OUT = path.join(import.meta.dirname, 'out');
const CSV = path.join(ROOT, 'Borchardt Loop Orientation Testing HFSS/mn_n400/10212026_MC_N400/MC_N400_Result_433MHz.csv');
const b = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const W = +(process.env.W || 1920), H = +(process.env.H || 1080);
const pg = await b.newPage({ viewport: { width: W, height: H } });
const errs = [];
pg.on('pageerror', e => errs.push('pageerror: ' + e.message));
pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
const t0 = Date.now();
await pg.goto('file://' + path.join(ROOT, 'app/dist/MN_Studio.html'));
await pg.waitForSelector('.net', { timeout: 20000 });
console.log('first result after', Date.now() - t0, 'ms');
const statusIs = (re, timeout = 90000) => pg.waitForFunction(r => new RegExp(r).test(document.getElementById('st').textContent), re.source, { timeout });
await statusIs(/Solved in/);
console.log('single:', await pg.textContent('#st'));
const ws = async w => { await pg.click(`.wtab[data-w="${w}"]`); await pg.waitForTimeout(500); };
const view = async v => { await pg.click(`.stab[data-v="${v}"]`); await pg.waitForTimeout(700); };
const shot = n => pg.screenshot({ path: path.join(OUT, n + '.png') });
await pg.waitForTimeout(800);
await shot('w1_single_networks');
await view('maps'); await pg.waitForTimeout(900); await shot('w2_single_maps');
await view('circuit'); await shot('w4_single_circuit');
// hand-off: this network to Tolerance
await pg.click('.page.on #c_tol');
await statusIs(/Monte Carlo finished/, 30000); await pg.waitForTimeout(600);
console.log('tolerance on:', await pg.$eval('#c_net', s => s.options[s.selectedIndex].text));
await shot('w5_tol_single');
// load set
await ws('set'); await shot('w6_set_empty');
await pg.setInputFiles('#s_in', CSV);
await pg.waitForFunction(() => !document.getElementById('s_go').disabled);
await pg.click('#s_go');
await statusIs(/Load set designed/);
console.log('set:', await pg.textContent('#st'));
await pg.waitForTimeout(900); await shot('w7_set_states');
await view('designs'); await pg.waitForTimeout(900); await shot('w8_set_designs');
await view('smith'); await pg.waitForTimeout(600); await shot('w9_set_smith');
await view('circuit'); await shot('w10_set_circuit');
// the single-load workflow is untouched by the load set
await ws('single');
console.log('single networks after set design:', await pg.$$eval('.wside.on .net', a => a.length), 'set networks listed there:', await pg.$$eval('.wside.on .net', a => a.filter(x => /percentile|Worst|Average|Nominal/.test(x.textContent)).length));
// tolerance on a set network, over every state
await ws('tol');
await pg.selectOption('#c_net', 'mpct');
await statusIs(/Monte Carlo finished/, 60000); await pg.waitForTimeout(600);
console.log('scope:', await pg.$eval('#c_scope', s => s.value));
await shot('w11_tol_set');
// limits
await ws('limits');
await statusIs(/32,761 loads in/, 120000);
console.log('limits:', await pg.textContent('#st'));
await pg.waitForTimeout(600); await shot('w12_limits');
const box = await pg.$eval('.page.on .sc-plot canvas', c => { const r = c.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
const cx = box[0] + box[2] / 2, cy = box[1] + box[3] / 2, R = Math.min(box[2], box[3]) / 2 / 1.14;
await pg.mouse.click(cx - 0.55 * R, cy - 0.35 * R); await pg.waitForTimeout(400);
await pg.mouse.move(cx + 0.3 * R, cy + 0.45 * R); await pg.waitForTimeout(500);
await shot('w13_limits_pick');
console.log('picked:', (await pg.textContent('#l_pick')).replace(/\s+/g, ' ').slice(0, 160));
await pg.click('#l_q button[data-v="kind"]'); await pg.waitForTimeout(500); await shot('w14_limits_kind');
await pg.mouse.move(cx, cy);
for (let i = 0; i < 6; i++) { await pg.mouse.wheel(0, -300); await pg.waitForTimeout(60); }
await statusIs(/loads in/, 60000); await pg.waitForTimeout(1500); await shot('w15_limits_zoom');
// hand-off: design for the picked load
await pg.click('#l_go');
await statusIs(/Solved in/);
console.log('single after hand-off:', await pg.inputValue('#zlr'), await pg.inputValue('#zlx'), await pg.textContent('#st'));
await shot('w16_handoff');
// the Smith chart grid: one slider for every grid
const setGrid = async i => { await pg.evaluate(v => { const r = document.getElementById('gridr'); r.value = v; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); }, i); };
await ws('limits'); await pg.click('#l_q button[data-v="tot"]');
await pg.mouse.dblclick(cx, cy); await pg.waitForTimeout(300);
await setGrid(2);
await statusIs(/8,281 loads in/, 60000); await pg.waitForTimeout(800);
console.log('limits at grid 91:', await pg.textContent('#st'), '| legend:', await pg.$$eval('.page.on .sc-leg > *', a => a.map(x => x.textContent).join(' / ')));
await pg.mouse.click(cx - 0.4 * R, cy + 0.2 * R); await pg.waitForTimeout(400);
await shot('w17_limits_legend');
await pg.click('#l_q button[data-v="kind"]'); await pg.waitForTimeout(500);
console.log('kind legend:', await pg.$$eval('.page.on .sc-leg > *', a => a.map(x => x.textContent).join(' / ')));
await shot('w18_limits_kind_legend');
await ws('single'); await view('design');
await pg.waitForFunction(() => /91 × 76 ◂/.test(document.querySelector('#d_grid').textContent), null, { timeout: 60000 });
await pg.waitForFunction(() => document.querySelectorAll('#d_grid tbody tr').length >= 4, null, { timeout: 90000 });
await pg.click('#d_nodes'); await pg.click('#d_geo'); await pg.waitForTimeout(600);
console.log('grid table:', (await pg.$$eval('#d_grid tbody tr', a => a.map(r => [...r.cells].map(c => c.textContent).join(' ')))).join(' | '));
await shot('w19_single_grid');
await view('maps'); await pg.waitForTimeout(1200);
console.log('maps info:', await pg.textContent('#m_info'));
await setGrid(4);
console.log('errors:', errs.length); for (const e of errs.slice(0, 12)) console.log(' ', e);
await b.close();
