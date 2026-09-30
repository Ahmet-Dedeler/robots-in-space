/**
 * 1-D heat conduction in the top metre of regolith, solved to its periodic
 * day/night cycle. This is what sets the ground temperature a lander or
 * robot sits on (and radiates to) on an airless body or on Mars.
 *
 * Physics follows Hayne et al. 2017 (the Diviner lunar model, "heat1d"):
 * - density rho(z) = rhoD - (rhoD - rhoS) exp(-z/H), contact conductivity
 *   kc(z) with the same profile, plus radiation between grains:
 *   k(T, z) = kc(z) (1 + chi (T/350 K)^3)
 * - lunar heat capacity polynomial c(T) (Hemingway 1981, Ledlow 1992)
 * - surface balance: (1 - A(i)) S cos(i) + eps * IR_down = eps sigma T^4 - k dT/dz
 *   with the incidence-dependent albedo A(i) = A0 + a (i/45°)^3 + b (i/90°)^8
 * - geothermal heat flow at the bottom.
 *
 * Numerics: nodes on a grid that starts at ~1/10 of the surface skin depth
 * and grows geometrically to ~12 diurnal skin depths; backward Euler with
 * lagged k and c, and Newton iterations on the T^4 surface term. Runs
 * repeated cycles until the solution repeats itself (spin-up), so the
 * result is the periodic steady state. Deterministic; results are cached.
 */
import { SIGMA } from "../constants";
import type { RegolithParams } from "./bodies";

/** Lunar regolith heat capacity [J/kg/K] (Hayne 2017 eq. A6, from Hemingway 1981 / Ledlow 1992). */
export function lunarCp(T: number): number {
  const c = -3.6125 + T * (2.7431 + T * (2.3616e-3 + T * (-1.234e-5 + T * 8.9093e-9)));
  return Math.max(c, 5);
}

export function albedoAt(p: RegolithParams, incidenceRad: number): number {
  const i = (incidenceRad * 180) / Math.PI;
  return p.albedo + p.albedoA * (i / 45) ** 3 + p.albedoB * (i / 90) ** 8;
}

/** Forcing at clock time tau: absorbed shortwave and downwelling IR [W/m^2]. */
export type Forcing = (tau: number) => { absorbedWm2: number; irDownWm2: number };

export interface PeriodicSolution {
  /** Surface temperature at tau = i * period / steps. */
  surfaceK: Float64Array;
  /** Temperature at ~1 skin depth (what a buried foot or wheel sees), same sampling. */
  shallowK: Float64Array;
  periodS: number;
  meanSurfaceK: number;
  cycles: number;
}

const cache = new Map<string, PeriodicSolution>();

export function periodicSurface(p: RegolithParams, forcing: Forcing, periodS: number, key: string, steps = 1440): PeriodicSolution {
  const k = `${key}|${periodS}|${steps}|${JSON.stringify(p)}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const sol = solve(p, forcing, periodS, steps);
  cache.set(k, sol);
  return sol;
}

function solve(p: RegolithParams, forcing: Forcing, periodS: number, steps: number): PeriodicSolution {
  const cpOf = (T: number) => (p.cp === "lunar" ? lunarCp(T) : p.cp);
  const kcAt = (z: number) => p.kD - (p.kD - p.kS) * Math.exp(-z / p.hM);
  const rhoAt = (z: number) => p.rhoD - (p.rhoD - p.rhoS) * Math.exp(-z / p.hM);

  // ---- Grid ----------------------------------------------------------------
  const skin = (kc: number, rho: number) => Math.sqrt((kc / (rho * cpOf(250))) * (periodS / Math.PI));
  const skinTop = skin(p.kS * (1 + p.chi * 0.36), p.rhoS);
  const skinDeep = skin(p.kD, p.rhoD);
  const z: number[] = [0];
  let dz = skinTop / 10;
  while (z[z.length - 1] < 12 * skinDeep) {
    z.push(z[z.length - 1] + dz);
    dz *= 1.18;
  }
  const n = z.length;
  const rho = z.map(rhoAt);
  const kc = z.map(kcAt);
  // Control-volume thickness of each node.
  const vol = z.map((_, i) => (i === 0 ? (z[1] - z[0]) / 2 : i === n - 1 ? (z[i] - z[i - 1]) / 2 : (z[i + 1] - z[i - 1]) / 2));

  // ---- Initial state: radiative equilibrium with the mean forcing ------------
  let meanF = 0;
  for (let i = 0; i < steps; i++) {
    const f = forcing((periodS * i) / steps);
    meanF += f.absorbedWm2 + p.emissivity * f.irDownWm2;
  }
  meanF /= steps;
  // For airless bodies the mean of T^4 overestimates the mean T (nights are
  // near zero flux); 0.85 is a good start and the spin-up removes the rest.
  const T0 = Math.max(40, 0.85 * Math.pow(meanF / (p.emissivity * SIGMA), 0.25));
  const T = new Float64Array(n).fill(T0);

  const dt = periodS / steps;
  const a = new Float64Array(n);
  const b = new Float64Array(n);
  const c = new Float64Array(n);
  const d = new Float64Array(n);
  const G = new Float64Array(n - 1); // interface conductance k/dz
  const C = new Float64Array(n); // heat capacity per area [J/m^2/K]
  const surface = new Float64Array(steps);
  const shallow = new Float64Array(steps);
  const iShallow = Math.max(1, z.findIndex((x) => x >= skinTop));
  const prevSurface = new Float64Array(steps);

  let cycles = 0;
  const maxCycles = 400;
  for (; cycles < maxCycles; cycles++) {
    for (let s = 0; s < steps; s++) {
      const f = forcing(dt * (s + 1));
      for (let i = 0; i < n; i++) C[i] = rho[i] * cpOf(T[i]) * vol[i];
      for (let i = 0; i < n - 1; i++) {
        const kl = kc[i] * (1 + p.chi * (T[i] / 350) ** 3);
        const kr = kc[i + 1] * (1 + p.chi * (T[i + 1] / 350) ** 3);
        G[i] = (0.5 * (kl + kr)) / (z[i + 1] - z[i]);
      }
      // Newton on the surface emission: eps sigma T^4 ~ e0 + e1 (T - Tg).
      let Tg = T[0];
      const Told0 = T[0];
      for (let it = 0; it < 4; it++) {
        const e1 = 4 * p.emissivity * SIGMA * Tg ** 3;
        const e0 = p.emissivity * SIGMA * Tg ** 4;
        for (let i = 0; i < n; i++) {
          const gl = i > 0 ? G[i - 1] : 0;
          const gr = i < n - 1 ? G[i] : 0;
          a[i] = -gl;
          c[i] = -gr;
          b[i] = C[i] / dt + gl + gr;
          d[i] = (C[i] / dt) * T[i];
        }
        d[0] = (C[0] / dt) * Told0 + f.absorbedWm2 + p.emissivity * f.irDownWm2 - e0 + e1 * Tg;
        b[0] += e1;
        d[n - 1] += p.geothermalWm2;
        const x = thomas(a, b, c, d);
        const conv = Math.abs(x[0] - Tg);
        Tg = x[0];
        if (it === 3 || conv < 1e-3) {
          for (let i = 0; i < n; i++) T[i] = x[i];
          break;
        }
      }
      surface[s] = T[0];
      shallow[s] = T[iShallow];
    }
    // Converged when a whole cycle repeats to 0.05 K.
    let diff = 0;
    for (let s = 0; s < steps; s++) diff = Math.max(diff, Math.abs(surface[s] - prevSurface[s]));
    prevSurface.set(surface);
    if (cycles > 1 && diff < 0.05) break;
  }

  // The last cycle ended at tau = period; shift so index 0 is tau = 0.
  const out = new Float64Array(steps);
  const outShallow = new Float64Array(steps);
  for (let s = 0; s < steps; s++) {
    out[(s + 1) % steps] = surface[s];
    outShallow[(s + 1) % steps] = shallow[s];
  }
  let mean = 0;
  for (let s = 0; s < steps; s++) mean += out[s] / steps;
  return { surfaceK: out, shallowK: outShallow, periodS, meanSurfaceK: mean, cycles };
}

/** Tridiagonal solve (a: sub, b: diag, c: super). */
function thomas(a: Float64Array, b: Float64Array, c: Float64Array, d: Float64Array): Float64Array {
  const n = b.length;
  const cp = new Float64Array(n);
  const dp = new Float64Array(n);
  cp[0] = c[0] / b[0];
  dp[0] = d[0] / b[0];
  for (let i = 1; i < n; i++) {
    const m = b[i] - a[i] * cp[i - 1];
    cp[i] = c[i] / m;
    dp[i] = (d[i] - a[i] * dp[i - 1]) / m;
  }
  const x = new Float64Array(n);
  x[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i--) x[i] = dp[i] - cp[i] * x[i + 1];
  return x;
}

/** Periodic linear interpolation into a solution. */
export function sampleSolution(arr: Float64Array, periodS: number, tau: number): number {
  const n = arr.length;
  const x = ((((tau / periodS) % 1) + 1) % 1) * n;
  const i = Math.floor(x);
  const f = x - i;
  return arr[i % n] * (1 - f) + arr[(i + 1) % n] * f;
}
