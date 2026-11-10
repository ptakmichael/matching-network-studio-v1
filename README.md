# Matching Network Studio, web edition

Single-file application. Open `app/dist/MN_Studio.html` in Chrome, Edge or Firefox.
No installation, MATLAB licence, server or network connection is required.

## Workflows

The application is four independent workflows, chosen in the top bar. Each has its
own inputs (left panel), its own results and its own views (second bar). Source
impedance, component Q, frequency and chart Z0 describe the same hardware, so they
are shared: a change in one panel appears in all of them, and results computed
with the old values say so.

| Workflow | Inputs | Views |
|---|---|---|
| Single load | Z_L, order N, topology | Networks, Efficiency maps, Circuit |
| Load set | Load states (files or an R-X range), design methods | Load states, Designs, Smith chart, Circuit |
| Tolerance | A designed network from either workflow, tolerance settings | Monte Carlo |
| Limits | Source and components | Best achievable efficiency, for every load on the Smith chart |

Hand-offs between workflows are explicit: **Analyse component tolerance** on a
Circuit view opens Tolerance on that network, and **Design networks for this load**
in Limits opens Single load on the selected load.

Order N accepts `4`, `2-6`, `2,4,6` and `3-9:2`.

### Limits

Each point of the chart is a load Z_L, coloured by the best transducer efficiency
any ladder can reach for it, by η_loss or η_match at its optimal termination, or by
the structure of the optimal network. Hovering a load draws the arrow to its
optimal termination Z_opt; clicking pins it. The map is the closed-form Z_opt
(`app/src/engine/zopt.js`, see `app/ZOPT_CLOSED_FORM.md`) at every pixel, computed by a
pool of workers and recomputed for the view after each zoom.

## Chart controls

| Action | Control |
|---|---|
| Read values | Move the pointer over the chart |
| Zoom a Smith chart | Scroll wheel, or the + and − buttons |
| Zoom any other chart | Drag a box, or Ctrl + scroll wheel |
| Pan | Drag (Smith chart), or the pan tool in the chart toolbar |
| Reset | Double-click |
| Hide a series | Click its legend entry |
| Save an image | PNG button (Smith chart), or camera icon in the chart toolbar |

## Load set file formats

- HFSS report table with `re(Z(1 1))` and `im(Z(1 1))` columns, in either order
- HFSS `Zre_*.csv` and `Zim_*.csv` trace pairs (select both; row nearest f_0 is used)
- Columns named `R` and `X`, or two unnamed numeric columns
- One column of complex values such as `1+2j`
- Touchstone `.s1p`

Further numeric columns, such as pitch, roll and gap, are available as marker color.

## Structure

```
app/src/engine/         Numerical engine, ported from the mn_*.m files. No interface code.
app/src/ui/             Interface. plot.js fixes every text size. Smith charts are drawn on
                        canvas by smith.js, which alone owns the view; other charts use Plotly.
app/src/worker.js       Computation runs in Web Workers, so the interface does not block.
app/test/               Engine checks against MATLAB outputs, and browser checks.
app/dist/               The deliverable.
app/ZOPT_CLOSED_FORM.md Derivation of the closed-form Z_opt.
```

| MATLAB | Web engine |
|---|---|
| `mn_gain`, `mn_gainq`, `mn_gainv`, `mn_trace`, `mn_metrics`, `mn_nrange` | `core.js` |
| `mn_exact`, `mn_exact_opt`, `mn_bound` | `exact.js` |
| closed-form Z_opt (no MATLAB equivalent yet) | `zopt.js`, `limits.js` |
| `fminsearch` | `nm.js` |
| `mn_ladder`, `mn_ladderspace`, `mn_lsection` | `ladder.js` |
| `mn_geo` | `geo.js` |
| `mn_mc`, `studies/.../mc_tolerance` | `mc.js` |
| `mn_robust`, `studies/.../design_p5` | `loadset.js` |
| `mn_netlist_text` | `netlist.js` |
| `mn_effmap` | `field.js` |

## Build and test

Run these commands from the `app` folder.

```
npm install
npm run build             # writes dist/MN_Studio.html
npm test                  # engine checks, including test/golden.json from MATLAB
node test/ui.mjs          # every workflow and hand-off; needs Playwright Chromium
node test/interact.mjs    # interface details: hover, zoom, exports, uploads, input errors
node test/zoom_perf.mjs   # continuous scroll: frame times and backward view jumps
node test/ltspice.mjs     # .cir and .asc through LTspice; Windows LTspice from WSL
node test/browsers.mjs    # Edge, Chrome and Firefox on Windows, from WSL
```

`app/test/golden.json` holds reference values written by the MATLAB toolbox, which is
not part of this repository.

## Differences from mn_netlist_text

Each was measured in LTspice 24.1.7.

| Change | Reason |
|---|---|
| No `R_sw` or `R_Lw` 1e-12 Ω resistors; a real source or load connects directly | A conductance of 1e12 degrades the solution. Efficiency read 21.04 % where the exact value is 21.10 %. |
| `.options meascplxfmt=cartesian` | `.meas` otherwise prints in dB |
| `Rser=0` on ideal source and load inductors | The LTspice default is not zero |
