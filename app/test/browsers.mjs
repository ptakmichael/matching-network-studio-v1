// Opens the built file in the Windows browsers, from WSL, with temporary profiles.
// A copy of the page reports back to a local server. Holding an image request open
// delays the load event, so each browser finishes the run and exits by itself.
//   node test/browsers.mjs
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';

const USER = process.env.WIN_USER || 'mtpta', PORT = 8765;
const DIR = `/mnt/c/Users/${USER}/AppData/Local/Temp/mn_check2`, WIN = `C:\\Users\\${USER}\\AppData\\Local\\Temp\\mn_check2`;
const probe = `<img src="http://localhost:${PORT}/hold" style="display:none"><script>setTimeout(()=>window.close(),70000);(async()=>{
const R={ua:navigator.userAgent,errors:[]};addEventListener('error',e=>R.errors.push(e.message));
const wait=(f,ms=50000)=>new Promise((res,rej)=>{const t=Date.now(),i=setInterval(()=>{if(f()){clearInterval(i);res()}else if(Date.now()-t>ms){clearInterval(i);rej(Error('timeout'))}},60)});
const q=s=>document.querySelector(s),frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
try{await wait(()=>/Solved in/.test(q('#st').textContent));R.status=q('#st').textContent;R.networks=document.querySelectorAll('.net').length;
const tabs=[...document.querySelectorAll('.tab')];await new Promise(r=>setTimeout(r,500));
q('.tab[data-t=maps]').click();await wait(()=>q('#m_info').textContent.length>0);R.field=q('#m_info').textContent;
await new Promise(r=>setTimeout(r,500));const b=q('#m_smith').getBoundingClientRect();const e=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);R.hit=e&&e.closest('.page')?e.closest('.page').dataset.t:'none';
e.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:b.left+b.width/2,clientY:b.top+b.height/2}));await frame();await frame();const t=q('#tip');R.tip=t?t.textContent.slice(0,24):'none';
const lat=[];for(let r=0;r<3;r++)for(const x of tabs){const t0=performance.now();x.click();await frame();lat.push(performance.now()-t0)}lat.sort((a,c)=>a-c);R.tab_median_ms=+lat[lat.length>>1].toFixed(1);
q('.tab[data-t=maps]').click();await new Promise(r=>setTimeout(r,800));
{const m=q('#m_smith').__smith,cv=m.cv,r=cv.getBoundingClientRect(),S=[],T=[];let on=true;const f=()=>{T.push(performance.now());S.push(m.view.x1-m.view.x0);if(on)requestAnimationFrame(f)};requestAnimationFrame(f);
for(let i=0;i<70;i++){cv.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height*.28,deltaY:-120}));await new Promise(k=>setTimeout(k,25))}
await new Promise(k=>setTimeout(k,900));on=false;const d=T.slice(1).map((v,i)=>v-T[i]).sort((a,c)=>a-c);let rev=0;for(let i=1;i<S.length;i++)if(S[i]/S[i-1]>1.002)rev++;
R.zoom={frames:T.length,median_ms:+d[d.length>>1].toFixed(1),worst_ms:+d[d.length-1].toFixed(0),over50ms:d.filter(v=>v>50).length,jumps_back:rev,span_start:+S[0].toFixed(3),span_end:+S[S.length-1].toFixed(6),field_process_ms:+(window.__fieldMs||0).toFixed(0)}}
q('.tab[data-t=valid]').click();await wait(()=>/Dijkstra grid/.test(q('#v_tab').textContent),40000);R.pass=document.querySelectorAll('#v_tab .pass').length;R.fail=document.querySelectorAll('#v_tab .fail').length;
}catch(err){R.failed=err.message}
await fetch('http://localhost:${PORT}/r?d='+encodeURIComponent(JSON.stringify(R)),{mode:'no-cors'});window.close();})()</script>`;
fs.mkdirSync(DIR, { recursive: true });
const html = fs.readFileSync(path.resolve(import.meta.dirname, '../dist/MN_Studio.html'), 'utf8').replace('</body>', () => probe + '</body>');
fs.writeFileSync(`${DIR}/probe.html`, html);
const url = `file:///C:/Users/${USER}/AppData/Local/Temp/mn_check2/probe.html`;

let release = null, report = null;
const server = http.createServer((q, s) => {
  if (q.url.startsWith('/r?')) {
    report = JSON.parse(decodeURIComponent(q.url.slice(5)));
    s.end('ok');
    if (release) release();
  } else if (q.url.startsWith('/hold')) {
    const done = () => { if (s.headersSent) return; s.writeHead(200, { 'content-type': 'image/gif' }); s.end(Buffer.from('R0lGODlhAQABAAAAACw=', 'base64')); };
    release = done;
    setTimeout(done, 80000);
  } else s.end();
}).listen(PORT, '0.0.0.0');

const P = '/mnt/c/Program Files', X = '/mnt/c/Program Files (x86)';
const chromium = (n) => ['--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1920,1080', `--user-data-dir=${WIN}\\p_${n}`, `--screenshot=${WIN}\\${n}.png`, url];
const list = [
  ['edge', `${X}/Microsoft/Edge/Application/msedge.exe`, chromium('edge')],
  ['chrome', `${P}/Google/Chrome/Application/chrome.exe`, chromium('chrome')],
  ['firefox', `${P}/Mozilla Firefox/firefox.exe`, ['-headless', '-no-remote', '-profile', `${WIN}\\p_firefox`, '-width', '1920', '-height', '1080', url]],
];
fs.mkdirSync(`${DIR}/p_firefox`, { recursive: true });
// lets the test page close its own window, in this temporary profile only
fs.writeFileSync(`${DIR}/p_firefox/user.js`, 'user_pref("dom.allow_scripts_to_close_windows", true);\nuser_pref("browser.shell.checkDefaultBrowser", false);\n');
for (const [name, exe, args] of list.filter(b => !process.env.ONLY || b[0] === process.env.ONLY)) {
  report = null; release = null;
  await new Promise(res => execFile(exe, args, { timeout: 110000, cwd: DIR }, () => res()));
  console.log(name, report ? JSON.stringify(report) : 'NO REPORT');
}
server.close();
process.exit(0);
