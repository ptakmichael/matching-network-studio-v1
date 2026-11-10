// Nelder-Mead, following MATLAB fminsearch step for step: the same initial
// simplex (5 % per coordinate, 0.00025 for a zero entry), the same coefficients
// and the same stopping test. Returns { x, f, evals }.

const EPS = 2.220446049250313e-16;
const epsOf = v => {
  const a = Math.abs(v);
  return a === 0 ? 5e-324 : Math.pow(2, Math.floor(Math.log2(a))) * EPS;
};

export function fminsearch(fun, x0, opt = {}) {
  const n = x0.length;
  const tolX = opt.tolX ?? 1e-4, tolF = opt.tolF ?? 1e-4;
  const maxEval = opt.maxEval ?? 200 * n, maxIter = opt.maxIter ?? 200 * n;
  const rho = 1, chi = 2, psi = 0.5, sigma = 0.5;
  const v = [], fv = new Float64Array(n + 1);
  v.push(Float64Array.from(x0));
  fv[0] = fun(v[0]);
  for (let j = 0; j < n; j++) {
    const y = Float64Array.from(x0);
    y[j] = y[j] !== 0 ? 1.05 * y[j] : 0.00025;
    v.push(y);
    fv[j + 1] = fun(y);
  }
  let evals = n + 1, iter = 1;
  const order = () => {
    const idx = Array.from({ length: n + 1 }, (_, i) => i);
    idx.sort((a, b) => (fv[a] - fv[b]) || (a - b));
    const nv = idx.map(i => v[i]), nf = idx.map(i => fv[i]);
    for (let i = 0; i <= n; i++) { v[i] = nv[i]; fv[i] = nf[i]; }
  };
  order();
  const xbar = new Float64Array(n), xr = new Float64Array(n);
  const xe = new Float64Array(n), xc = new Float64Array(n);
  while (evals < maxEval && iter < maxIter) {
    let df = 0, dx = 0, vmax = -Infinity;
    for (let j = 1; j <= n; j++) {
      df = Math.max(df, Math.abs(fv[0] - fv[j]));
      for (let i = 0; i < n; i++) dx = Math.max(dx, Math.abs(v[j][i] - v[0][i]));
    }
    for (let i = 0; i < n; i++) vmax = Math.max(vmax, v[0][i]);
    if (df <= Math.max(tolF, 10 * epsOf(fv[0])) && dx <= Math.max(tolX, 10 * epsOf(vmax))) break;
    xbar.fill(0);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) xbar[i] += v[j][i] / n;
    const w = v[n];
    for (let i = 0; i < n; i++) xr[i] = (1 + rho) * xbar[i] - rho * w[i];
    const fxr = fun(xr); evals++;
    let shrink = false;
    if (fxr < fv[0]) {
      for (let i = 0; i < n; i++) xe[i] = (1 + rho * chi) * xbar[i] - rho * chi * w[i];
      const fxe = fun(xe); evals++;
      if (fxe < fxr) { v[n] = Float64Array.from(xe); fv[n] = fxe; }
      else { v[n] = Float64Array.from(xr); fv[n] = fxr; }
    } else if (fxr < fv[n - 1]) {
      v[n] = Float64Array.from(xr); fv[n] = fxr;
    } else if (fxr < fv[n]) {
      for (let i = 0; i < n; i++) xc[i] = (1 + psi * rho) * xbar[i] - psi * rho * w[i];
      const fxc = fun(xc); evals++;
      if (fxc <= fxr) { v[n] = Float64Array.from(xc); fv[n] = fxc; } else shrink = true;
    } else {
      for (let i = 0; i < n; i++) xc[i] = (1 - psi) * xbar[i] + psi * w[i];
      const fxc = fun(xc); evals++;
      if (fxc < fv[n]) { v[n] = Float64Array.from(xc); fv[n] = fxc; } else shrink = true;
    }
    if (shrink) {
      for (let j = 1; j <= n; j++) {
        const nv = new Float64Array(n);
        for (let i = 0; i < n; i++) nv[i] = v[0][i] + sigma * (v[j][i] - v[0][i]);
        v[j] = nv; fv[j] = fun(nv);
      }
      evals += n;
    }
    order();
    iter++;
  }
  return { x: Array.from(v[0]), f: fv[0], evals };
}
