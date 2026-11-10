// Builds one self-contained file: dist/MN_Studio.html.
import { build } from 'esbuild';
import fs from 'node:fs';

const worker = await build({ entryPoints: ['src/worker.js'], bundle: true, format: 'iife', minify: true, write: false, target: 'es2020' });
const app = await build({
  entryPoints: ['src/ui/main.js'], bundle: true, format: 'iife', minify: true, write: false, target: 'es2020',
  define: { __WORKER_SRC__: JSON.stringify(worker.outputFiles[0].text) },
});
const esc = s => s.replace(/<\/script/gi, '<\\/script');
const plotly = fs.readFileSync('node_modules/plotly.js-cartesian-dist-min/plotly-cartesian.min.js', 'utf8');
const css = fs.readFileSync('src/ui/styles.css', 'utf8');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Matching Network Studio</title>
<style>${css}</style></head>
<body><div id="app"></div>
<script>${esc(plotly)}</script>
<script>${esc(app.outputFiles[0].text)}</script>
</body></html>
`;
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/MN_Studio.html', html);
console.log(`dist/MN_Studio.html  ${(html.length / 1e6).toFixed(2)} MB`);
