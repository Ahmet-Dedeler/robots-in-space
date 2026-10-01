/**
 * Entry heating and the thermal protection that has to survive it.
 *
 * Heating: Sutton & Graves (1971, NASA TR R-376) convective stagnation-point
 * heat flux, q = k sqrt(rho / Rn) V^3, with k for CO2 atmospheres (Mars,
 * Venus). A stage isn't a sphere, so:
 * - windward line of the body at angle of attack a: a cylinder of the body's
 *   radius (stagnation-line flux 1/sqrt(2) of a sphere's) swept by 90 - a,
 *   so x sin(a)^1.5 (swept-leading-edge scaling, Tauber 1989);
 * - an engines-first base: a blunt flat face, effective nose radius about
 *   the base diameter;
 * - the shadowed side (Starship's bare leeward steel, a booster's flanks
 *   while it falls tail-first): a small share of the stagnation flux.
 * Radiative (shock-layer) heating is ignored: it is small below ~6 km/s in
 * CO2 (Tauber & Sutton 1991). A Venus entry from orbit (~7 km/s) would add a
 * lot of it; the descent warns when that applies.
 *
 * Protection: each heated surface is a 1-D wall, outside in: optional tiles
 * (or a ceramic blanket), then the structural skin. The outer face takes
 * the heat flux and re-radiates (eps sigma T^4); heat conducts through the
 * tile (explicit finite differences, temperature-dependent k and cp) into
 * the skin, whose inner face is adiabatic (conservative: no credit for
 * propellant behind the wall). A tile past its limit fails and exposes the
 * skin. A skin that reaches its structural limit loses its strength: the
 * pressurised tanks behind it rupture (burn-through).
 *
 * Fidelity: approximation. Peak fluxes are good to maybe ±30%; tile
 * properties are LI-900 handbook data, since SpaceX's tile composition is
 * not published.
 */
import { SIGMA } from "../constants";
import { MATERIALS, type MaterialId } from "../materials/materials";

/** Sutton-Graves constant for CO2-dominated air [kg^0.5 / m] (Sutton & Graves 1971; Earth air is 1.7415e-4). */
export const K_SG_CO2 = 1.9027e-4;

/** Sphere stagnation-point convective heat flux [W/m^2]. */
export function stagnationFlux(rho: number, speed: number, noseRadiusM: number): number {
  if (rho <= 0 || speed <= 0) return 0;
  return K_SG_CO2 * Math.sqrt(rho / noseRadiusM) * speed * speed * speed;
}

export type TileId = "li900" | "ceramicBlanket";

interface TileMaterial {
  name: string;
  density: number;
  /** [K, W/m/K] */
  k: ReadonlyArray<readonly [number, number]>;
  /** [K, J/kg/K] */
  cp: ReadonlyArray<readonly [number, number]>;
  emissivity: number;
  /** Reuse limit (surface) [K]. */
  reuseK: number;
  /** Single-use limit: past this it shrinks, cracks, the coating fails [K]. */
  limitK: number;
  source: string;
}

export const TILES: Record<TileId, TileMaterial> = {
  li900: {
    name: "Silica tiles (LI-900 class, black coating)",
    density: 144,
    // LI-900 in air at ~1 atm, rising with temperature (radiation through the fibres). Approximate reading.
    k: [
      [300, 0.048],
      [600, 0.068],
      [900, 0.092],
      [1200, 0.122],
      [1500, 0.16],
    ],
    // Fused silica.
    cp: [
      [300, 630],
      [600, 1000],
      [900, 1130],
      [1200, 1210],
      [1600, 1260],
    ],
    emissivity: 0.85,
    reuseK: 1533,
    limitK: 1755,
    source:
      "Shuttle LI-900: 144 kg/m³, reaction-cured-glass coating ε ≈ 0.85, reusable to 1260 °C, single-mission limit ~1480 °C (Cleland & Iannetti 1989, NASA CR-4227; Williams & Curry 1992, NASA TM-104747). Starship's hexagonal tiles are silica-based too; their exact composition and thickness are not published.",
  },
  ceramicBlanket: {
    name: "Ceramic-fibre blanket (base heat shield)",
    density: 100,
    k: [
      [300, 0.04],
      [800, 0.08],
      [1200, 0.14],
      [1500, 0.2],
    ],
    cp: [
      [300, 800],
      [900, 1050],
      [1500, 1150],
    ],
    emissivity: 0.8,
    reuseK: 1300,
    limitK: 1480,
    source:
      "Alumina-silica fibre blanket (Nextel/AFRSI-class, AFRSI rated to ~650 °C reuse, alumina fibre to ~1200 °C). What covers a booster's engine base isn't published: a guess.",
  },
};

/** Skin temperature where a metal pressure-vessel wall has lost ~80% of its strength [K]. Approximation. */
export const STRUCTURE_LIMIT_K: Partial<Record<MaterialId, number>> = {
  // 2219-T87: yield 393 MPa at 24 °C, 76 MPa at 316 °C (MMPDS, ½ h exposure).
  al2219: 589,
  // 300-series stainless: ~20% of room-temperature yield near 900 °C (ASM Handbook vol. 1, elevated-temperature data). SpaceX's 30X isn't published.
  ss316: 1170,
};

export interface WallSpec {
  /** Tiles or blanket on the outside (absent: bare skin). */
  tile?: { id: TileId; thicknessMm: number };
  skin: { material: MaterialId; thicknessMm: number };
}

/** A heated wall: tile nodes (outer first) over a lumped skin node. */
export class Wall {
  readonly spec: WallSpec;
  private readonly t: Float64Array;
  private readonly dx: number;
  private readonly tile: TileMaterial | null;
  private readonly skinC: number;
  private readonly skinEps: number;
  tileFailed = false;
  peakSurfaceK: number;
  peakSkinK: number;

  constructor(spec: WallSpec, initialK: number) {
    this.spec = spec;
    this.tile = spec.tile ? TILES[spec.tile.id] : null;
    const n = this.tile ? 12 : 0;
    this.t = new Float64Array(n + 1).fill(initialK);
    // Half a cell at each face, so n - 0.5 full cells span the tile.
    this.dx = this.tile ? spec.tile!.thicknessMm / 1000 / (n - 0.5) : 0;
    const m = MATERIALS[spec.skin.material];
    this.skinC = m.density * m.cp * (spec.skin.thicknessMm / 1000);
    this.skinEps = m.emissivity;
    this.peakSurfaceK = initialK;
    this.peakSkinK = initialK;
  }

  get surfaceK(): number {
    return this.t[0];
  }
  get skinK(): number {
    return this.t[this.t.length - 1];
  }
  /** Is the outer layer tile (not failed)? */
  get tiled(): boolean {
    return !!this.tile && !this.tileFailed;
  }

  /** Advance by dt with incident heat flux q [W/m^2] and surroundings at envK (radiation sink). */
  step(q: number, envK: number, dt: number): void {
    const T = this.t;
    const env4 = envK ** 4;
    if (!this.tiled) {
      // Bare skin (or skin exposed after the tiles failed): one lumped node.
      const i = T.length - 1;
      const sub = Math.max(1, Math.ceil(dt / 0.5));
      const h = dt / sub;
      for (let k = 0; k < sub; k++) T[i] += (h * (q - this.skinEps * SIGMA * (T[i] ** 4 - env4))) / this.skinC;
      for (let j = 0; j < i; j++) T[j] = T[i];
    } else {
      const m = this.tile!;
      const n = T.length - 1;
      const dx = this.dx;
      // Explicit FD: half-cell at the outer face, tile cells, the skin node at the back.
      const kMax = table(m.k, 1700);
      const cMin = m.density * table(m.cp, 300);
      const stable = (0.2 * cMin * dx * dx) / kMax;
      const sub = Math.max(1, Math.ceil(dt / stable));
      const h = dt / sub;
      const flux = new Float64Array(n);
      for (let k = 0; k < sub; k++) {
        for (let j = 0; j < n; j++) {
          const kk = table(m.k, 0.5 * (T[j] + T[j + 1]));
          // The last link (tile back face to skin) is half a cell.
          flux[j] = (kk * (T[j] - T[j + 1])) / (j === n - 1 ? dx / 2 : dx);
        }
        const c0 = m.density * table(m.cp, T[0]) * (dx / 2);
        T[0] += (h * (q - m.emissivity * SIGMA * (T[0] ** 4 - env4) - flux[0])) / c0;
        for (let j = 1; j < n; j++) T[j] += (h * (flux[j - 1] - flux[j])) / (m.density * table(m.cp, T[j]) * dx);
        T[n] += (h * flux[n - 1]) / this.skinC;
      }
      if (T[0] > m.limitK) this.tileFailed = true;
    }
    this.peakSurfaceK = Math.max(this.peakSurfaceK, T[0]);
    this.peakSkinK = Math.max(this.peakSkinK, this.skinK);
  }
}

function table(t: ReadonlyArray<readonly [number, number]>, x: number): number {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (x <= t[i][0]) {
      const [x0, y0] = t[i - 1];
      const [x1, y1] = t[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return t[t.length - 1][1];
}

/** Radiative-equilibrium temperature of a surface under flux q (the hottest a re-radiating wall gets) [K]. */
export const radiativeEquilibriumK = (q: number, emissivity: number, envK = 0) => Math.pow(q / (emissivity * SIGMA) + envK ** 4, 0.25);
