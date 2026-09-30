/**
 * Lumped-parameter thermal network solver.
 *
 * Each node is a lump with heat capacity C [J/K], optionally a phase-change
 * material (latent heat spread over a narrow melting band). Nodes exchange
 * heat through conductances G [W/K] and, if exposed, with the environment by
 * convection + radiation (optionally through a series resistance such as an
 * insulation jacket).
 *
 * Time integration: backward Euler on the linearized system (radiation
 * linearized about the current temperature), solved with dense Gaussian
 * elimination (networks are ~5-15 nodes). The state carried between steps
 * is each node's enthalpy, so phase changes that start or finish mid-step
 * are energy-conserving. Unconditionally stable, so the caller can take
 * large steps once things settle.
 */
import { SIGMA } from "../constants";

export interface Exposure {
  /** Wetted/radiating area [m^2]. */
  area: number;
  emissivity: number;
  /** Characteristic length for the convection correlation [m]. */
  lengthM: number;
  /** Multiplier on the convective coefficient (e.g. 0.35 for flow inside a cavity). */
  convFactor: number;
  /** Extra series resistance between node and its surface [K/W], e.g. insulation. */
  seriesR: number;
}

export interface ThermalNode {
  id: string;
  label: string;
  /** Sensible heat capacity [J/K]. */
  C: number;
  /** Phase change: latent heat [J] released/absorbed over [meltK - band/2, meltK + band/2]. */
  pcm?: { meltK: number; latentJ: number; bandK: number };
  exposure?: Exposure;
}

export interface ThermalLink {
  a: number;
  b: number;
  G: number;
}

export interface EnvironmentState {
  ambientK: number;
  radiantK: number;
  /** Convective coefficient per node for its exposure (computed by caller). */
  h: Float64Array;
}

/** Enthalpy (relative to 0 K sensible baseline) of a node at temperature T. */
export function enthalpyAt(node: ThermalNode, T: number): number {
  let H = node.C * T;
  if (node.pcm) {
    const lo = node.pcm.meltK - node.pcm.bandK / 2;
    const f = Math.min(1, Math.max(0, (T - lo) / node.pcm.bandK));
    H += node.pcm.latentJ * f;
  }
  return H;
}

/** Inverse of enthalpyAt. */
export function temperatureAt(node: ThermalNode, H: number): number {
  if (!node.pcm) return H / node.C;
  const { meltK, latentJ, bandK } = node.pcm;
  const lo = meltK - bandK / 2;
  const hi = meltK + bandK / 2;
  const hLo = node.C * lo;
  const hHi = node.C * hi + latentJ;
  if (H <= hLo) return H / node.C;
  if (H >= hHi) return (H - latentJ) / node.C;
  return lo + ((H - hLo) / (hHi - hLo)) * bandK;
}

/** Effective heat capacity dH/dT at T. */
function capacityAt(node: ThermalNode, T: number): number {
  if (!node.pcm) return node.C;
  const { meltK, latentJ, bandK } = node.pcm;
  const inBand = T >= meltK - bandK / 2 && T <= meltK + bandK / 2;
  return inBand ? node.C + latentJ / bandK : node.C;
}

/** Heat exchanged with the environment per kelvin of (T_env - T_node), linearized. */
export function exposureConductance(node: ThermalNode, T: number, env: EnvironmentState, h: number): number {
  const e = node.exposure;
  if (!e || e.area <= 0) return 0;
  const conv = h * e.convFactor * e.area;
  // Linearize eps*sigma*A*(Tr^4 - T^4) = hr*A*(Tr - T).
  const Tr = env.radiantK;
  const hr = e.emissivity * SIGMA * (T * T + Tr * Tr) * (T + Tr);
  // Radiation and convection both act on the outer surface, in parallel,
  // then in series with any jacket resistance.
  const surfaceG = conv + hr * e.area;
  if (surfaceG <= 0) return 0;
  return e.seriesR > 0 ? 1 / (1 / surfaceG + e.seriesR) : surfaceG;
}

export class ThermalNetwork {
  readonly nodes: ThermalNode[];
  readonly links: ThermalLink[];
  /** Enthalpy state [J]. */
  readonly H: Float64Array;
  /** Temperature state [K]. */
  readonly T: Float64Array;
  private readonly A: Float64Array;
  private readonly b: Float64Array;

  constructor(nodes: ThermalNode[], links: ThermalLink[], initialK: number[] | number) {
    this.nodes = nodes;
    this.links = links;
    const n = nodes.length;
    this.H = new Float64Array(n);
    this.T = new Float64Array(n);
    this.A = new Float64Array(n * n);
    this.b = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const T0 = typeof initialK === "number" ? initialK : initialK[i];
      this.T[i] = T0;
      this.H[i] = enthalpyAt(nodes[i], T0);
    }
  }

  index(id: string): number {
    const i = this.nodes.findIndex((n) => n.id === id);
    if (i < 0) throw new Error(`unknown thermal node ${id}`);
    return i;
  }

  /** Add energy directly (e.g. battery runaway) [J]. */
  inject(i: number, joules: number) {
    this.H[i] += joules;
    this.T[i] = temperatureAt(this.nodes[i], this.H[i]);
  }

  /**
   * Advance by dt seconds.
   * @param Q internal heat generation per node [W] (held constant over the step)
   */
  step(dt: number, env: EnvironmentState, Q: Float64Array) {
    const n = this.nodes.length;
    const { A, b, T } = this;
    A.fill(0);
    const Ceff = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      Ceff[i] = capacityAt(this.nodes[i], T[i]);
      const Ge = exposureConductance(this.nodes[i], T[i], env, env.h[i]);
      A[i * n + i] = Ceff[i] / dt + Ge;
      // Convection pulls toward ambient, radiation toward radiant temperature.
      // Split the linearized conductance by the share of each mechanism.
      b[i] = (Ceff[i] / dt) * T[i] + Q[i] + this.envDrive(i, T[i], env, Ge);
    }
    for (const { a, b: j, G } of this.links) {
      A[a * n + a] += G;
      A[j * n + j] += G;
      A[a * n + j] -= G;
      A[j * n + a] -= G;
    }
    const Tn = solveDense(A, b, n);
    for (let i = 0; i < n; i++) {
      this.H[i] += Ceff[i] * (Tn[i] - T[i]);
      T[i] = temperatureAt(this.nodes[i], this.H[i]);
    }
  }

  /** Ge * (effective environment temperature) for node i. */
  private envDrive(i: number, T: number, env: EnvironmentState, Ge: number): number {
    const e = this.nodes[i].exposure;
    if (!e || Ge === 0) return 0;
    const conv = env.h[i] * e.convFactor;
    const Tr = env.radiantK;
    const hr = e.emissivity * SIGMA * (T * T + Tr * Tr) * (T + Tr);
    const Tenv = (conv * env.ambientK + hr * env.radiantK) / (conv + hr || 1);
    return Ge * Tenv;
  }
}

/** Gaussian elimination with partial pivoting. A is destroyed. */
export function solveDense(A: Float64Array, b: Float64Array, n: number): Float64Array {
  const x = Float64Array.from(b);
  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = Math.abs(A[col * n + col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(A[r * n + col]);
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    if (piv !== col) {
      for (let k = 0; k < n; k++) {
        const t = A[col * n + k];
        A[col * n + k] = A[piv * n + k];
        A[piv * n + k] = t;
      }
      const t = x[col];
      x[col] = x[piv];
      x[piv] = t;
    }
    const d = A[col * n + col];
    for (let r = col + 1; r < n; r++) {
      const f = A[r * n + col] / d;
      if (f === 0) continue;
      for (let k = col; k < n; k++) A[r * n + k] -= f * A[col * n + k];
      x[r] -= f * x[col];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r];
    for (let k = r + 1; k < n; k++) s -= A[r * n + k] * x[k];
    x[r] = s / A[r * n + r];
  }
  return x;
}
