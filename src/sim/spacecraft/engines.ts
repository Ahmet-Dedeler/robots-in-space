/**
 * Rocket engines and how their thrust depends on the air outside.
 *
 * Thrust of an ideal nozzle (Sutton & Biblarz, Rocket Propulsion Elements,
 * ch. 3):
 *   F = pc At CF,  CF = sqrt(2g^2/(g-1) (2/(g+1))^((g+1)/(g-1)) (1 - (pe/pc)^((g-1)/g))) + (pe - pa)/pc * eps
 * A sea-level engine run against thicker air than it was designed for is
 * over-expanded; once the wall pressure falls below ~0.4 pa the flow
 * separates from the wall (Summerfield criterion, Sutton §3.4) and the
 * nozzle effectively ends there. We model exactly that: the jet expands to
 * 0.4 pa, then the separated part of the bell sees ambient pressure and adds
 * nothing. When pa reaches the chamber pressure there is no thrust at all.
 *
 * Throttling lowers the chamber pressure at a fixed throat, so a deeply
 * throttled engine separates sooner. Propellant flow scales with throttle
 * and does not care about the air, so Isp drops as thrust does.
 *
 * Each engine is pinned to one published (thrust, Isp) point; vacuum or
 * other-pressure performance follows from the nozzle equations. Approximation:
 * separated-flow thrust is good to maybe ±20%, side loads and buzz are not
 * modelled.
 */
import { EARTH_GRAVITY } from "../constants";

export type EngineId = "raptor3" | "merlin1d" | "be4" | "lmde";

export interface Engine {
  id: EngineId;
  name: string;
  /** Chamber pressure at full throttle [Pa]. */
  pcPa: number;
  /** Nozzle exit/throat area ratio. */
  areaRatio: number;
  /** Exhaust ratio of specific heats (methalox ~1.2, kerolox ~1.22, hypergolics ~1.23). */
  gamma: number;
  /** Published performance point: thrust [N] and Isp [s] at ambient pressure `refPa`. */
  refThrustN: number;
  refIsp: number;
  refPa: number;
  /** Lowest stable throttle (fraction of full chamber pressure). */
  minThrottle: number;
  propellants: string;
  /** Pressure-fed engines push propellant with tank pressure alone (no turbopump). */
  cycle: string;
  massKg: number;
  /** Nozzle exit diameter [m] (3D model). */
  exitDiameterM: number;
  source: string;
}

const bar = 1e5;

export const ENGINES: Record<EngineId, Engine> = {
  raptor3: {
    id: "raptor3",
    name: "Raptor 3 (sea level)",
    pcPa: 350 * bar,
    // Raptor 2 sea-level bell: area ratio ~34, 1.3 m exit; Raptor 3 keeps the bell.
    areaRatio: 34,
    gamma: 1.2,
    refThrustN: 2.75e6,
    // SpaceX quotes 280 tf and "350 s"; we read 350 s as vacuum and pin sea level at 330 s, which the nozzle model then carries to ~350 s in vacuum. Calibrated.
    refIsp: 330,
    refPa: 101_325,
    // Not published; Raptor is reported to throttle to ~40%. Guess.
    minThrottle: 0.4,
    propellants: "LOX / methane",
    cycle: "full-flow staged combustion",
    massKg: 1525,
    exitDiameterM: 1.3,
    source: "SpaceX Raptor 3 figures (2024-25): 280 tf, 350 bar chamber, 1,525 kg.",
  },
  merlin1d: {
    id: "merlin1d",
    name: "Merlin 1D (sea level)",
    pcPa: 97 * bar,
    areaRatio: 16,
    gamma: 1.22,
    refThrustN: 845e3,
    refIsp: 282,
    refPa: 101_325,
    minThrottle: 0.4,
    propellants: "LOX / RP-1",
    cycle: "gas generator",
    massKg: 470,
    exitDiameterM: 0.92,
    source: "Merlin 1D (Full Thrust): 845 kN and 282 s at sea level, 9.7 MPa chamber, area ratio 16, throttles to 40%.",
  },
  be4: {
    id: "be4",
    name: "BE-4",
    pcPa: 134 * bar,
    // Not published. Guess for a sea-level booster engine at this chamber pressure.
    areaRatio: 20,
    gamma: 1.2,
    refThrustN: 2.45e6,
    // Not published; typical for oxygen-rich staged-combustion methalox at sea level. Guess.
    refIsp: 310,
    refPa: 101_325,
    // Guess (deep throttling is claimed but not quantified).
    minThrottle: 0.4,
    propellants: "LOX / methane",
    cycle: "oxygen-rich staged combustion",
    massKg: 2_100,
    exitDiameterM: 1.7,
    source: "Blue Origin BE-4: 2,450 kN (550,000 lbf) sea-level thrust, 13.4 MPa chamber. Area ratio and Isp guessed.",
  },
  lmde: {
    id: "lmde",
    name: "Apollo LM descent engine (LMDE)",
    // ~105 psia at full thrust.
    pcPa: 7.2 * bar,
    areaRatio: 47.5,
    gamma: 1.23,
    refThrustN: 45_040,
    refIsp: 311,
    refPa: 0,
    // Throttled 10% to 60% plus a fixed full-thrust point; we let it use anything from 10% to 100%.
    minThrottle: 0.1,
    propellants: "N2O4 / Aerozine 50",
    cycle: "pressure-fed",
    massKg: 179,
    exitDiameterM: 1.5,
    source: "TRW LMDE: 10,125 lbf (45.0 kN) vacuum, Isp ~311 s, ~105 psia chamber, area ratio 47.5, throttle 10-60% + full (Apollo Experience Report TN D-7143).",
  },
};

/** Throat pressure ratio (p at the throat over pc). */
const criticalRatio = (g: number) => Math.pow(2 / (g + 1), g / (g - 1));

/** Momentum part of the thrust coefficient after expanding to p/pc = pr. */
function cfMomentum(g: number, pr: number): number {
  const a = ((2 * g * g) / (g - 1)) * Math.pow(2 / (g + 1), (g + 1) / (g - 1));
  return Math.sqrt(a * Math.max(0, 1 - Math.pow(pr, (g - 1) / g)));
}

/** Area ratio at which the isentropic flow has expanded to p/pc = pr (supersonic branch). */
function areaRatioAt(g: number, pr: number): number {
  const num = Math.pow(2 / (g + 1), 1 / (g - 1)) * Math.pow(pr, -1 / g);
  const den = Math.sqrt(((g + 1) / (g - 1)) * (1 - Math.pow(pr, (g - 1) / g)));
  return num / den;
}

const exitCache = new Map<string, number>();

/** Exit pressure ratio pe/pc for an area ratio (bisection on the supersonic branch, memoised). */
function exitRatio(g: number, eps: number): number {
  const key = `${g}|${eps}`;
  const hit = exitCache.get(key);
  if (hit !== undefined) return hit;
  let lo = 1e-9;
  let hi = criticalRatio(g);
  for (let i = 0; i < 80; i++) {
    const mid = Math.sqrt(lo * hi);
    if (areaRatioAt(g, mid) > eps) lo = mid;
    else hi = mid;
  }
  const pr = Math.sqrt(lo * hi);
  exitCache.set(key, pr);
  return pr;
}

/** Summerfield: the flow leaves the wall once wall pressure drops below this share of ambient. */
export const SEPARATION_RATIO = 0.4;

/**
 * Thrust coefficient at chamber pressure pc and ambient pa, with flow
 * separation. Also says whether the flow separated.
 */
export function thrustCoefficient(e: Engine, pc: number, pa: number): { cf: number; separated: boolean } {
  if (pc <= pa) return { cf: 0, separated: true };
  const g = e.gamma;
  const prE = exitRatio(g, e.areaRatio);
  const prA = pa / pc;
  if (prE >= SEPARATION_RATIO * prA) return { cf: Math.max(0, cfMomentum(g, prE) + (prE - prA) * e.areaRatio), separated: false };
  // Separated: the jet only expands to 0.4 pa; the rest of the bell is at ambient.
  const prS = Math.min(criticalRatio(g), SEPARATION_RATIO * prA);
  const epsS = prS >= criticalRatio(g) ? 1 : areaRatioAt(g, prS);
  return { cf: Math.max(0, cfMomentum(g, prS) + (prS - prA) * epsS), separated: true };
}

export interface EngineModel {
  engine: Engine;
  throatM2: number;
  /** Propellant flow at full throttle [kg/s]. */
  mdotFull: number;
  /** Thrust of one engine at throttle k (0..1 of full chamber pressure) in air at pa [N]. */
  thrust(k: number, pa: number): number;
  /** Does the flow separate at this throttle and pressure? */
  separated(k: number, pa: number): boolean;
}

const cache = new Map<EngineId, EngineModel>();

/** Calibrate the throat area and flow to the published point, then predict everywhere else. */
export function engineModel(id: EngineId): EngineModel {
  const hit = cache.get(id);
  if (hit) return hit;
  const e = ENGINES[id];
  const throatM2 = e.refThrustN / (e.pcPa * thrustCoefficient(e, e.pcPa, e.refPa).cf);
  const mdotFull = e.refThrustN / (e.refIsp * EARTH_GRAVITY);
  const m: EngineModel = {
    engine: e,
    throatM2,
    mdotFull,
    thrust: (k, pa) => (k <= 0 ? 0 : k * e.pcPa * throatM2 * thrustCoefficient(e, k * e.pcPa, pa).cf),
    separated: (k, pa) => thrustCoefficient(e, k * e.pcPa, pa).separated,
  };
  cache.set(id, m);
  return m;
}

/** Specific impulse at throttle k and ambient pa [s]. */
export function ispAt(id: EngineId, k: number, pa: number): number {
  const m = engineModel(id);
  return k > 0 ? m.thrust(k, pa) / (k * m.mdotFull * EARTH_GRAVITY) : 0;
}
