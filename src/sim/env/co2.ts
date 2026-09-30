/**
 * Real-gas CO2 properties from a baked CoolProp table (see tools/bake_co2.py).
 *
 * Bilinear interpolation in (T, log10 P). Out-of-range inputs are clamped to
 * the table edges, which cover 150-1100 K and 1 Pa - 12 MPa.
 */
import table from "../data/co2-props.json";

export interface GasProps {
  /** density [kg/m^3] */
  rho: number;
  /** isobaric specific heat [J/kg/K] */
  cp: number;
  /** thermal conductivity [W/m/K] */
  k: number;
  /** dynamic viscosity [Pa s] */
  mu: number;
}

const { tMin, tMax, nT, logPMin, logPMax, nP } = table;
const dT = (tMax - tMin) / (nT - 1);
const dLogP = (logPMax - logPMin) / (nP - 1);
const RHO = Float64Array.from(table.rho);
const CP = Float64Array.from(table.cp);
const K = Float64Array.from(table.k);
const MU = Float64Array.from(table.mu);

function lerp2(a: Float64Array, i: number, j: number, fx: number, fy: number) {
  const i0 = i * nP + j;
  const i1 = (i + 1) * nP + j;
  const top = a[i0] + (a[i0 + 1] - a[i0]) * fy;
  const bottom = a[i1] + (a[i1 + 1] - a[i1]) * fy;
  return top + (bottom - top) * fx;
}

export function co2Props(temperatureK: number, pressurePa: number): GasProps {
  const x = Math.min(Math.max((temperatureK - tMin) / dT, 0), nT - 1 - 1e-9);
  const lp = Math.log10(Math.max(pressurePa, 1));
  const y = Math.min(Math.max((lp - logPMin) / dLogP, 0), nP - 1 - 1e-9);
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  // Density scales ~linearly with P, so interpolate it in log space for accuracy.
  const logRho = (arr: Float64Array) => {
    const i0 = i * nP + j;
    const i1 = (i + 1) * nP + j;
    const l = (v: number) => Math.log(v);
    const top = l(arr[i0]) + (l(arr[i0 + 1]) - l(arr[i0])) * fy;
    const bottom = l(arr[i1]) + (l(arr[i1 + 1]) - l(arr[i1])) * fy;
    return Math.exp(top + (bottom - top) * fx);
  };
  return {
    rho: logRho(RHO),
    cp: lerp2(CP, i, j, fx, fy),
    k: lerp2(K, i, j, fx, fy),
    mu: lerp2(MU, i, j, fx, fy),
  };
}
