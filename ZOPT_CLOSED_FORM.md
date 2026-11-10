# Closed-form optimal termination Z_opt

`mn_exact_opt` finds the termination Z_in that maximises

    eta_tot(Z_in) = eta_loss(Z_L -> Z_in) * eta_match(Z_in),    eta_match = 4 R_in R_s / |Z_in + Z_s|^2

with a 41 x 41 grid and Nelder-Mead. `eta_loss` is already closed form (`mn_exact`).
This note derives the maximiser itself, for any lossy L/C ladder of any length, and
replaces the search. Implementation: `app/src/engine/zopt.js`.

## Notation

t = X/R, u = ln R, a = Q_L, c = Q_C, t_0 = X_L/R_L, Z_s = R_s + jX_s, ψ = arg Z_s,
κ = κ_min = (a + c)/sqrt((a²+1)(c²+1)), q± the optimal arcs, t_u = -1/a, t_d = 1/c.

From `mn_exact`, the loss C = -ln eta_loss depends on the path of t only. An
inductor raises t and dissipates ln((a - t_a)/(a - t_b)); a capacitor lowers t and
dissipates ln((c + t_a)/(c + t_b)). C(u, t) is smooth on a finite set of pieces:
single type inside the band [U_min, U_max], pairs at a peak q±, extension to a peak
and ride, extension without ride.

## The stationarity conditions

Let Γ' = (Z - Z_s)/(Z + Z_s). For eta_match at fixed t and fixed u:

    ∂ ln eta_match / ∂u = -Re Γ'
    ∂ ln eta_match / ∂t = (Im Γ' - t (1 + Re Γ')) / (1 + t²)

With λ = ∂C/∂u, the marginal loss per neper of resistance, the optimum satisfies

    Re Γ' = -λ
    Im Γ' = (1 - λ) t + (1 + t²) ∂C/∂t                                   (1)

so Z_opt = Z_s (1 + Γ')/(1 - Γ'). The remaining condition is that this Z has angle
t:

    h(t) = X_s (1 - |Γ'|²) + 2 y R_s - t [R_s (1 - |Γ'|²) - 2 y X_s] = 0,   y = Im Γ'

On every piece ∂C/∂t is rational in t with denominators (a - t), (c + t), (1 + t²),
so h(t) (a - t)² (c + t)² is a polynomial of degree at most 7.

## The cases

**1. Single type, inside the band (λ = 0).** For inductors ∂C/∂t = 1/(a - t), so
y = (1 + a t)/(a - t) = tan(arg Z + atan(1/a)). Γ' is imaginary, so |Z_opt| = |Z_s|,
and

    arg Z_opt = -ψ - 2 atan(1/Q_L)             (inductors only)
    arg Z_opt = -ψ + 2 atan(1/Q_C)             (capacitors only)
    eta_max  = (1 + Q_L²) / ((Q_L - t_0)(Q_L - t_s))     resp. (1 + Q_C²) / ((Q_C + t_0)(Q_C + t_s))

with t_s = X_s/R_s. For a real load and Z_s = R_s(1 - jQ_s) this is exactly Chappidi
and Sengupta 2018, eq. 12-13. The load-angle factor is new: their eq. 13 holds only
for a real load.

**2. Single type, on the band edge.** u = U_edge(t), so R(t) = K/L(t) (series end) or
K L(t)/(1 + t²) (shunt end), with L = a - t (inductors) or c + t (capacitors). In both
forms eta_tot ∝ L(t)²/D(t) with D quadratic, d0 + d1 t + d2 t², and with L = α + β t:

    t_opt = (α d1 - 2 β d0) / (β d1 - 2 α d2)

**3. Ride (λ = ±κ).** Pairs at a peak inside [t_0, t], or an extension to the nearest
peak followed by a ride. Then C = σκ (u - U_edge) + W(t), with

    ∂C/∂t = F0'(t) - λ U_edge'(t) [+ ε (ℓ(t) - κ g(t)) when the extension starts at t]

t_opt is a real root of the degree-7 polynomial above. R_opt follows from (1).

**4. Extension without ride.** The path t_0 -> M -> t on the band edge of both legs.
R(t; M) = R_base(t) exp(σ gain(t_0, M)), so for fixed M the band-edge formula of
case 2 gives t. M solves the single scalar equation -Re Γ' = σ/ρ(M), from (1) with
λ = σ/ρ(M). This is the only step that is not explicit; it is solved by bracketing.

**Corners.** No network (Z_opt = Z_L), and fixed t at each breakpoint t_0, t_u, t_d,
q±, where R follows from (1): (1 + λ)(1 + t²) R² + 2λ(R_s + t X_s) R - (1 - λ)|Z_s|² = 0.

Every candidate (typically 20 to 60) is scored with the exact `mn_exact`, and the
best is returned. Candidates within 1e-10 of the best are treated as equal, and the
simplest structure is reported.

## Verification

| Check | Cases | Result |
|---|---|---|
| Against `mn_exact_opt` search (JS port), Q_L 2-200, Q_C 2-400, loads including beyond Q | 7,500 | never lower by more than 1e-13; higher in 1 case |
| Against an independent dense grid, 5 zoom levels | 150 | never lower; higher in 6 cases |
| Chappidi eq. 12-13 (Z_s = 10 - j20, Z_L = 30, Q = 5) | 1 | exact to 1e-12 |
| Network type map, Z_s = 50, Q_L = 50, Q_C = 1000 | 900 | no isolated flips |

Time per load in JavaScript: 0.2 ms, against 4 ms for the search. The MATLAB search
takes 0.3 to 3 s.

## Limits of the result

- Cases 1 and 2 are explicit formulas.
- Case 3 is the root of an explicit polynomial. The roots are bracketed on a 0.06 rad
  grid in arg Z, so two roots closer than that could in principle be missed; no case
  has shown it.
- Case 4 needs one scalar root, which has no explicit formula.
- No MATLAB port yet. `mn_exact_opt` remains the MATLAB path; the web engine test
  `app/test/engine.test.mjs` checks the closed form against the search.
