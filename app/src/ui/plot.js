// One plot system. Every chart in the application is built through here so
// title, axis, tick, legend and hover text are the same size everywhere.
export const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';
export const SIZE = { title: 16, axis: 15, tick: 14, legend: 14, hover: 14 };
export const INK = '#14171c', INK2 = '#434a55', GRID = '#e3e6eb', AXIS = '#8d95a1';

// Blue, orange and aqua validate as a set; ink is the neutral baseline.
export const COLOR = { blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', pink: '#e87ba4', ink: '#2c3138' };
export const TOPO_STYLE = {
  lowpass: { color: COLOR.blue, dash: 'solid', symbol: 'circle' },
  highpass: { color: COLOR.orange, dash: 'dash', symbol: 'square' },
  free: { color: COLOR.aqua, dash: 'solid', symbol: 'diamond' },
};
export const METHOD_STYLE = {
  nominal: { color: COLOR.ink, dash: 'solid', symbol: 'circle' },
  worst: { color: COLOR.orange, dash: 'dash', symbol: 'square' },
  pct: { color: COLOR.blue, dash: 'solid', symbol: 'diamond' },
  average: { color: COLOR.aqua, dash: 'dot', symbol: 'triangle-up' },
  yield: { color: COLOR.pink, dash: 'dashdot', symbol: 'x' },
};

export const VIRIDIS = [[0, '#440154'], [0.1, '#482475'], [0.2, '#414487'], [0.3, '#355f8d'], [0.4, '#2a788e'],
  [0.5, '#21918c'], [0.6, '#22a884'], [0.7, '#44bf70'], [0.8, '#7ad151'], [0.9, '#bddf26'], [1, '#fde725']];

export const CONFIG = {
  displaylogo: false, responsive: true, scrollZoom: true, doubleClick: 'reset', displayModeBar: 'hover',
  modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d', 'toggleSpikelines', 'hoverClosestCartesian', 'hoverCompareCartesian'],
  toImageButtonOptions: { format: 'png', scale: 3 },
};

const axis = (t) => ({
  title: { text: t, font: { size: SIZE.axis, color: INK }, standoff: 10 },
  tickfont: { size: SIZE.tick, color: INK2 }, gridcolor: GRID, zerolinecolor: AXIS, linecolor: AXIS,
  zeroline: false, showline: true, mirror: false, automargin: true, ticks: 'outside', ticklen: 4, tickcolor: AXIS,
});

export function layout({ title, x, y, legend = true, ...rest }) {
  return {
    title: { text: title, font: { size: SIZE.title, color: INK, family: FONT }, x: 0, xref: 'paper', xanchor: 'left', y: 0.985, yanchor: 'top', pad: { b: 8 } },
    font: { family: FONT, size: SIZE.tick, color: INK },
    paper_bgcolor: '#fff', plot_bgcolor: '#fff',
    margin: { l: 64, r: 18, t: 38, b: 54 },
    xaxis: axis(x), yaxis: axis(y),
    showlegend: legend,
    legend: { orientation: 'h', x: 0, xanchor: 'left', y: -0.2, yanchor: 'top', font: { size: SIZE.legend }, itemclick: 'toggle', itemdoubleclick: 'toggleothers' },
    hoverlabel: { font: { family: FONT, size: SIZE.hover, color: INK }, bgcolor: '#fff', bordercolor: '#9aa3b0', align: 'left' },
    hovermode: 'closest', dragmode: 'zoom', barcornerradius: 3,
    ...rest,
  };
}

/** Plain wheel scrolls the page; Ctrl + wheel zooms the chart. Without this a
 *  long page cannot be scrolled while the pointer is over a chart. */
export function draw(el, traces, lay) {
  if (!el.dataset.wheel) {
    el.dataset.wheel = '1';
    el.addEventListener('wheel', e => { if (!e.ctrlKey) e.stopPropagation(); }, true);
  }
  return window.Plotly.react(el, traces, lay, CONFIG);
}

/** Empirical CDF as step points. */
export function ecdf(values) {
  const v = Float64Array.from(values).sort();
  const n = v.length, x = new Array(n), y = new Array(n);
  for (let i = 0; i < n; i++) { x[i] = v[i]; y[i] = (i + 1) / n; }
  return [x, y];
}

/** Common bins for overlaid histograms. */
export function bins(...arrays) {
  let lo = Infinity, hi = -Infinity;
  for (const a of arrays) for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const size = (hi - lo) / 48 || 1;
  return { start: lo, end: hi + size, size };
}

export const pc = v => (Number.isFinite(v) ? (100 * v).toFixed(2) : '–');
export const pc1 = v => (Number.isFinite(v) ? (100 * v).toFixed(1) : '–');
export function zfmt(z, d = 3) {
  const sig = v => {
    const a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 1000) return a.toFixed(0);
    return a.toPrecision(Math.max(d + 1, 3)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  };
  return `${z[0] < 0 ? '−' : ''}${sig(z[0])} ${z[1] < 0 ? '−' : '+'} j${sig(z[1])}`;
}
