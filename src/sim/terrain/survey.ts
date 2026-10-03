/**
 * What a rover team would want to know about a patch of ground before
 * driving or walking on it: how many obstacles, how tall, how steep, and how
 * far a given foot or wheel sinks. Pure functions over the same terrain
 * function the physics and the renderer use.
 *
 * Hazard thresholds follow rover practice: MER/MSL autonomous navigation
 * treats rocks taller than ~1/2 wheel diameter and slopes above ~20-30° as
 * untraversable (Biesiadecki & Maimone 2006); a blind walking policy trained
 * on flat ground already catches its toes on a few centimetres.
 */
import type { Mechanics, VehicleBuild } from "../vehicles/types";
import { footing, sinkageM, type FootingResult, type Soil } from "./soil";
import type { Terrain } from "./terrain";

/** Obstacle height bands [m] used by the hazard map, the survey and the fall diagnosis. */
export const STEP_BANDS = [0.03, 0.1, 0.2] as const;
/** Slope bands [deg]. */
export const SLOPE_BANDS = [10, 20] as const;

export type HazardClass = 0 | 1 | 2 | 3;

/** 0 clear, 1 toe-catcher (3-10 cm / 10-20°), 2 obstacle (10-20 cm / >20°), 3 blocker (>20 cm). */
export function hazardClass(reliefM: number, slopeDeg: number): HazardClass {
  let c: HazardClass = 0;
  if (reliefM >= STEP_BANDS[2]) c = 3;
  else if (reliefM >= STEP_BANDS[1]) c = 2;
  else if (reliefM >= STEP_BANDS[0]) c = 1;
  if (slopeDeg >= SLOPE_BANDS[1]) c = Math.max(c, 2) as HazardClass;
  else if (slopeDeg >= SLOPE_BANDS[0]) c = Math.max(c, 1) as HazardClass;
  return c;
}

export interface Survey {
  /** Area surveyed [m^2]. */
  areaM2: number;
  /** Fraction of the area covered by obstacles taller than each STEP_BANDS entry. */
  coverAbove: [number, number, number];
  /** Separate obstacles taller than each band, per 100 m^2. */
  countPer100: [number, number, number];
  /** Tallest obstacle in the patch [m]. */
  tallestM: number;
  /** Soil-surface slope over 0.5 m baselines: mean and 95th percentile [deg]. */
  slopeMeanDeg: number;
  slopeP95Deg: number;
  /** Lowest to highest point of the soil surface in the patch [m]. */
  reliefRangeM: number;
}

/**
 * Survey a square patch centred on the origin. Obstacles are counted as
 * connected clusters of grid cells above each height band.
 */
export function survey(t: Terrain, half = 7, step = 0.05): Survey {
  const n = Math.round((2 * half) / step) + 1;
  const relief = new Float32Array(n * n);
  let tallest = 0;
  let gLo = Infinity;
  let gHi = -Infinity;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const s = t.sample(-half + c * step, -half + r * step);
      const v = Math.max(0, s.h - s.ground);
      relief[r * n + c] = v;
      if (v > tallest) tallest = v;
      if (s.ground < gLo) gLo = s.ground;
      if (s.ground > gHi) gHi = s.ground;
    }
  }
  const coverAbove = STEP_BANDS.map((b) => relief.reduce((a, v) => a + (v >= b ? 1 : 0), 0) / relief.length) as [number, number, number];
  const areaM2 = (2 * half) ** 2;
  const countPer100 = STEP_BANDS.map((b) => (clusters(relief, n, b) / areaM2) * 100) as [number, number, number];

  const slopes: number[] = [];
  for (let y = -half + 0.5; y <= half - 0.5; y += 0.5) for (let x = -half + 0.5; x <= half - 0.5; x += 0.5) slopes.push(t.slopeDeg(x, y, 0.25));
  slopes.sort((a, b) => a - b);
  return {
    areaM2,
    coverAbove,
    countPer100,
    tallestM: tallest,
    slopeMeanDeg: slopes.reduce((a, b) => a + b, 0) / slopes.length,
    slopeP95Deg: slopes[Math.floor(0.95 * (slopes.length - 1))],
    reliefRangeM: gHi - gLo,
  };
}

/** Number of 4-connected clusters of cells >= threshold. */
function clusters(grid: Float32Array, n: number, threshold: number): number {
  const seen = new Uint8Array(grid.length);
  const stack: number[] = [];
  let count = 0;
  for (let i = 0; i < grid.length; i++) {
    if (seen[i] || grid[i] < threshold) continue;
    count++;
    seen[i] = 1;
    stack.push(i);
    while (stack.length) {
      const k = stack.pop()!;
      const r = Math.floor(k / n);
      const c = k - r * n;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
        const j = rr * n + cc;
        if (!seen[j] && grid[j] >= threshold) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
  }
  return count;
}

// ---- Feet and wheels on the soil ------------------------------------------------------------

/** One contact (foot or wheel) of a vehicle. */
export interface Contact {
  label: string;
  /** Contacts sharing the weight at once (1 foot in single support, all wheels on a rover). */
  count: number;
  widthM: number;
  /** Foot length; for wheels this is computed from the sinkage. */
  lengthM?: number;
  /** Wheel diameter [m] (wheels only). */
  diameterM?: number;
  source: string;
}

/**
 * Contact geometry per vehicle. Feet from the MuJoCo foot collision points
 * (G1: 4 spheres spanning 17 x 6 cm), wheels from the real rovers.
 */
export function contactOf(mech: Mechanics): Contact | null {
  switch (mech.kind) {
    case "humanoid":
      return mech.robot === "g1"
        ? { label: "foot", count: 1, widthM: 0.07, lengthM: 0.18, source: "Unitree G1 MJCF foot contacts" }
        : { label: "foot", count: 1, widthM: 0.09, lengthM: 0.22, source: "Unitree H1 foot (approx. from mesh)" };
    case "wheeled":
      return { label: "tyre", count: 4, widthM: 0.3, diameterM: 0.83, source: "12x16.5 skid-steer tyres" };
    case "rover": {
      const w: Record<string, [number, number, number, string]> = {
        // [diameter, width, wheels, source]
        mer: [0.25, 0.16, 6, "MER: 25 cm wheels, 16 cm wide"],
        msl: [0.5, 0.4, 6, "Curiosity: 50 cm wheels, 40 cm wide"],
        yutu: [0.3, 0.15, 6, "Yutu-2: ~30 cm wheels (approx.)"],
        pragyan: [0.18, 0.08, 6, "Pragyan: ~18 cm wheels (approx.)"],
        lunokhod: [0.51, 0.2, 8, "Lunokhod: 51 cm wire-mesh wheels, 8 of them"],
        crawler: [0.6, 0.25, 6, "Hypothetical crawler"],
      };
      const [d, b, k, src] = w[mech.model] ?? [0.3, 0.15, 6, "generic"];
      return { label: "wheel", count: k, widthM: b, diameterM: d, source: src };
    }
    default:
      return null;
  }
}

/**
 * Bekker's rigid-wheel static sinkage (Bekker 1969; Wong 2001 eq. 2.47):
 * z = [3W / ((3 - n)(kc + b kphi) sqrt(D))]^(2 / (2n + 1)).
 */
export function wheelSinkageM(soil: Soil, loadN: number, widthM: number, diameterM: number): number {
  const b = soil.bekker;
  if (!b) return 0;
  return ((3 * loadN) / ((3 - b.n) * (b.kc + widthM * b.kphi) * Math.sqrt(diameterM))) ** (2 / (2 * b.n + 1));
}

export interface Trafficability extends FootingResult {
  contact: Contact;
  /** Load on one contact [N]. */
  loadN: number;
}

/** How the ground takes one foot/wheel of this vehicle under this gravity. */
export function trafficability(build: VehicleBuild, soil: Soil, gravity: number): Trafficability | null {
  const contact = contactOf(build.mechanics);
  if (!contact) return null;
  const loadN = (build.massKg * gravity) / contact.count;
  if (contact.diameterM) {
    const z = Math.max(wheelSinkageM(soil, loadN, contact.widthM, contact.diameterM), 1e-4);
    // Chord of a rigid wheel sunk to depth z: the contact patch length.
    const length = 2 * Math.sqrt(z * (contact.diameterM - Math.min(z, contact.diameterM / 2)));
    const f = footing(soil, { forceN: loadN, widthM: contact.widthM, lengthM: Math.max(length, 0.02) }, gravity);
    return { ...f, sinkageM: soil.bekker ? z : 0, contact, loadN, verdict: f.utilisation > 1 ? "fails" : z > contact.diameterM / 6 ? "sinks" : "firm" };
  }
  const f = footing(soil, { forceN: loadN, widthM: contact.widthM, lengthM: contact.lengthM! }, gravity);
  return { ...f, sinkageM: sinkageM(soil, f.pressurePa, contact.widthM), contact, loadN };
}
