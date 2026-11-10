// Runs exported .cir and .asc files through LTspice and compares the efficiency
// it reports with the application's. Windows LTspice, from WSL.
//   node test/ltspice.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { netlistText, ascText } from '../src/engine/netlist.js';
import { esr } from '../src/engine/core.js';

const USER = process.env.WIN_USER || 'mtpta';
const LT = `/mnt/c/Users/${USER}/AppData/Local/Programs/ADI/LTspice/LTspice.exe`;
const DIR = `/mnt/c/Users/${USER}/AppData/Local/Temp/mn_check2`;
const WIN = `C:\\Users\\${USER}\\AppData\\Local\\Temp\\mn_check2`;
const f0 = 433e6;
fs.mkdirSync(DIR, { recursive: true });
const run = (flag, f) => execFileSync(LT, [flag, `${WIN}\\${f}`], { timeout: 45000, cwd: DIR, stdio: 'ignore' });
const read = f => {
  const t = fs.readFileSync(path.join(DIR, f)).toString('latin1').replace(/\0/g, '');
  const m = t.match(/^eta_pct:.*=\(([-\d.e+]+),/m);
  if (!m) throw new Error(`no result in ${f}: ${t.slice(0, 400)}`);
  return parseFloat(m[1]);
};
const cases = {
  real_source_inductive_load: { X: [-84.9, -7.56], kind: [1, 2], ZL: [0.2404, 90.56], Zs: [50, 0], QL: 50, QC: 1000 },
  three_elements: { X: [-70, -8, -84], kind: [1, 2, 1], ZL: [0.2404, 90.56], Zs: [50, 0], QL: 50, QC: 1000 },
  inductive_source_capacitive_load: { X: [-9, 22, -30, 14], kind: [2, 1, 2, 1], ZL: [3, -12], Zs: [50, 10], QL: 40, QC: 200 },
  capacitive_source_real_load: { X: [12, -30, 44], kind: [1, 2, 1], ZL: [20, 0], Zs: [75, -6], QL: 30, QC: 120 },
  real_source_real_load: { X: [12, -30, 44], kind: [1, 2, 1], ZL: [20, 0], Zs: [50, 0], QL: 30, QC: 120 },
  six_elements: { X: [6, -11, 9, -20, 15, -35], kind: [1, 2, 1, 2, 1, 2], ZL: [8, 5], Zs: [50, 0], QL: 60, QC: 300 },
};
let worst = 0;
for (const [k, c] of Object.entries(cases)) {
  const R = esr(c.X, c.QL, c.QC), t = netlistText(c.X, c.kind, R, c.ZL, c.Zs, f0, k);
  fs.writeFileSync(path.join(DIR, `${k}.cir`), t.lines.join('\r\n') + '\r\n');
  fs.writeFileSync(path.join(DIR, `${k}_s.asc`), ascText(c.X, c.kind, R, c.ZL, c.Zs, f0));
  run('-b', `${k}.cir`);
  run('-netlist', `${k}_s.asc`);
  run('-b', `${k}_s.net`);
  const a = read(`${k}.log`), b = read(`${k}_s.log`), e = 100 * t.eta;
  worst = Math.max(worst, Math.abs(a / e - 1), Math.abs(b / e - 1));
  console.log(`${k.padEnd(34)} app ${e.toFixed(6)} %   .cir ${a.toFixed(6)} %   .asc ${b.toFixed(6)} %`);
}
console.log(`largest relative difference ${worst.toExponential(2)}`);
if (worst > 1e-6) process.exit(1);
