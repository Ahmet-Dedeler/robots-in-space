/**
 * Soil mechanics of each world's ground: how far a foot or wheel sinks and
 * whether the ground can carry it.
 *
 * Two classic models, the same ones used to design the Apollo Lunar Roving
 * Vehicle and the Mars rovers:
 * - Bekker pressure-sinkage: p = (kc / b + kphi) z^n, for a plate (foot,
 *   wheel contact patch) of width b pressed into the soil to depth z.
 *   (Bekker 1969; Wong, "Theory of Ground Vehicles", 2001.)
 * - Terzaghi bearing capacity of a strip footing on the surface (no
 *   embedment), with Vesic's factors:
 *   q_ult = c Nc + 0.5 gamma b Ngamma, gamma = rho g.
 *   The frictional term scales with gravity: sand bears less on the Moon
 *   because its grains weigh less. Cohesion does not.
 *
 * Every number has a source next to it. Bekker moduli for Mars are a
 * terrestrial dry-sand analogue (no in-situ bevameter has flown), and Venus
 * has penetrometer/landing-load strengths only, so those are labelled.
 */

import type { Fidelity } from "../vehicles/types";

export interface Soil {
  name: string;
  /** Bulk density of the top ~10 cm [kg/m^3]. */
  densityKgM3: number;
  /** Mohr-Coulomb cohesion [Pa]. */
  cohesionPa: number;
  /** Angle of internal friction [deg]. */
  frictionDeg: number;
  /**
   * Bekker pressure-sinkage parameters: exponent n, cohesive modulus kc
   * [N/m^(n+1)], frictional modulus kphi [N/m^(n+2)]. Absent where nobody
   * has measured them (Venus): the ground is then treated as stiff and only
   * its bearing strength is used.
   */
  bekker?: { n: number; kc: number; kphi: number };
  /** Measured bearing strength where only that exists [Pa] (Venus landers). */
  bearingPa?: [number, number];
  fidelity: Fidelity;
  source: string;
}

export const SOILS = {
  // Lunar Sourcebook Table 9.14 (Carrier et al. 1991), the LRV "Soil Type B" that matched Apollo 15
  // driving best: c = 0.017 N/cm^2, phi = 35 deg, n = 1, kc = 0.14 N/cm^2, kphi = 0.82 N/cm^3.
  // Bulk density 1.50 g/cm^3 for the top 15 cm (Lunar Sourcebook Table 9.6).
  lunarRegolith: {
    name: "Lunar regolith (Apollo average)",
    densityKgM3: 1500,
    cohesionPa: 170,
    frictionDeg: 35,
    bekker: { n: 1, kc: 1.4e3, kphi: 8.2e5 },
    fidelity: "validated",
    source: "Lunar Sourcebook Table 9.14 / Carrier 2006 (LRV soil type B, matched Apollo 15 driving)",
  },
  // Same regolith, looser: the top few cm at the poles and inside shadowed craters look highly porous
  // (LRO LAMP far-UV: porosity ~70%, Gladstone et al. 2012). Boeing's softest LRV design case
  // ("Soil Type A": c = 0, phi = 31 deg) bounds it; density from 70% porosity on 3.1 g/cm^3 grains.
  lunarFluffy: {
    name: "Loose, porous polar regolith",
    densityKgM3: 950,
    cohesionPa: 0,
    frictionDeg: 31,
    bekker: { n: 1, kc: 0, kphi: 8.2e5 },
    fidelity: "approximation",
    source: "LRV soil type A (Costes et al. 1972) for strength; porosity from LRO LAMP (Gladstone et al. 2012)",
  },
  // Viking "crusty to cloddy" material: phi ~35 deg, c 0.5-5.2 kPa (Moore et al. 1987, USGS PP 1389).
  // MER wheel trenches: phi 30-37 deg, c 0-2 kPa (Sullivan et al. 2011). Bekker moduli: Wong's dry sand
  // (n = 1.1, kc = 0.99 kN/m^2.1, kphi = 1528 kN/m^3.1), the usual Mars-rover analogue.
  marsSoil: {
    name: "Martian soil (crusty / cloddy)",
    densityKgM3: 1500,
    cohesionPa: 1000,
    frictionDeg: 33,
    bekker: { n: 1.1, kc: 990, kphi: 1.528e6 },
    fidelity: "approximation",
    source: "Moore et al. 1987 (Viking), Sullivan et al. 2011 (MER trenches); Bekker moduli from terrestrial dry sand (Wong 2001)",
  },
  // Viking "drift material": phi ~18 deg, c 0.7-3.0 kPa, 1200 kg/m^3 (Moore et al. 1987). Fine, fluffy,
  // weak in friction. Bekker moduli are a guess (soft end of dry sand), so the sinkage is indicative only.
  marsDrift: {
    name: "Martian drift dust",
    densityKgM3: 1200,
    cohesionPa: 1600,
    frictionDeg: 18,
    bekker: { n: 1.0, kc: 500, kphi: 4e5 },
    fidelity: "approximation",
    source: "Moore et al. 1987 (Viking 1 drift material); Bekker moduli guessed",
  },
  // Loose, cohesionless basaltic sand where Spirit got stuck (Troy, 2009) and Opportunity bogged down
  // (Purgatory ripple, 2005): c ~0, phi ~30 deg (Sullivan et al. 2011 lower bound), low kphi.
  marsLooseSand: {
    name: "Loose aeolian sand (Troy, Purgatory)",
    densityKgM3: 1300,
    cohesionPa: 0,
    frictionDeg: 30,
    bekker: { n: 1.0, kc: 0, kphi: 3e5 },
    fidelity: "approximation",
    source: "Sullivan et al. 2011 (MER, cohesionless end); kphi guessed. Static sinkage only: the slip-sinkage that buried Spirit's wheels isn't modelled",
  },
  // Venera 13: "strength like dense sand or weak rock" from the penetrometer and landing loads; ~50%
  // porosity, ~1.4-1.5 g/cm^3 (Surkov et al. 1984; via Carter et al. 2023). The Venera 14 penetrometer
  // landed on its own ejected lens cap, so V14 strength comes from landing loads only: like
  // sandstone (Vega 2 similar). Pressures are order-of-magnitude readings of those descriptions.
  veneraSediment: {
    name: "Venera 13 fines over plates",
    densityKgM3: 1450,
    cohesionPa: 2000,
    frictionDeg: 35,
    bearingPa: [3e5, 1e6],
    fidelity: "approximation",
    source: "Venera 13 penetrometer + landing loads (Surkov et al. 1984), 'dense sand to weak rock'",
  },
  veneraRock: {
    name: "Venus layered bedrock",
    densityKgM3: 1500,
    cohesionPa: 1e5,
    frictionDeg: 40,
    bearingPa: [3e6, 1e7],
    fidelity: "approximation",
    source: "Venera 14 / Vega 2 landing loads, 'like sandstone'; Venera 9/10: several hundred kg/cm^2",
  },
  // Mercury: no lander has touched it. Regolith is expected to be lunar-like (similar thermal inertia
  // from MESSENGER/ground radar), so we use the lunar values and say so.
  mercuryRegolith: {
    name: "Mercury regolith (lunar analogue)",
    densityKgM3: 1500,
    cohesionPa: 170,
    frictionDeg: 35,
    bekker: { n: 1, kc: 1.4e3, kphi: 8.2e5 },
    fidelity: "hypothetical",
    source: "No in-situ data; lunar values assumed (similar thermal inertia, Hayne/Vasavada)",
  },
  rigid: {
    name: "Rigid test pad",
    densityKgM3: 2500,
    cohesionPa: 1e7,
    frictionDeg: 45,
    fidelity: "hypothetical",
    source: "Idealised",
  },
} as const satisfies Record<string, Soil>;

export type SoilId = keyof typeof SOILS;

const rad = (d: number) => (d * Math.PI) / 180;

/** Vesic bearing-capacity factors for friction angle phi [deg]. */
export function bearingFactors(phiDeg: number): { Nc: number; Nq: number; Ngamma: number } {
  const t = Math.tan(rad(phiDeg));
  const Nq = Math.exp(Math.PI * t) * Math.tan(rad(45 + phiDeg / 2)) ** 2;
  const Nc = t > 1e-6 ? (Nq - 1) / t : 2 + Math.PI;
  const Ngamma = 2 * (Nq + 1) * t;
  return { Nc, Nq, Ngamma };
}

/**
 * Ultimate bearing pressure under a footing of width b [m] resting on the
 * surface, in gravity g [m/s^2] [Pa]. Uses the measured strength where
 * that's all we have (Venus).
 */
export function bearingCapacityPa(soil: Soil, widthM: number, gravity: number): number {
  if (soil.bearingPa) return soil.bearingPa[0];
  const { Nc, Ngamma } = bearingFactors(soil.frictionDeg);
  return soil.cohesionPa * Nc + 0.5 * soil.densityKgM3 * gravity * widthM * Ngamma;
}

/**
 * Static Bekker sinkage of a plate of width b [m] under pressure p [Pa] [m].
 * 0 for ground with no Bekker data (stiff rock / measured strength only).
 */
export function sinkageM(soil: Soil, pressurePa: number, widthM: number): number {
  const b = soil.bekker;
  if (!b || pressurePa <= 0) return 0;
  const k = b.kc / widthM + b.kphi;
  return (pressurePa / k) ** (1 / b.n);
}

export interface FootingLoad {
  /** Weight on the contact [N] (mass x local gravity, per foot/wheel). */
  forceN: number;
  /** Contact width [m] (foot width, tyre width). */
  widthM: number;
  /** Contact length [m] (foot length, tyre contact patch). */
  lengthM: number;
}

export interface FootingResult {
  pressurePa: number;
  sinkageM: number;
  bearingPa: number;
  /** pressure / bearing: > 1 the ground shears and the foot punches in. */
  utilisation: number;
  verdict: "firm" | "sinks" | "fails";
}

/** What the ground does under one foot or wheel. */
export function footing(soil: Soil, load: FootingLoad, gravity: number): FootingResult {
  const area = load.widthM * load.lengthM;
  const pressurePa = load.forceN / area;
  const bearingPa = bearingCapacityPa(soil, load.widthM, gravity);
  const utilisation = pressurePa / bearingPa;
  const z = sinkageM(soil, pressurePa, load.widthM);
  // Shear failure, or sinking deeper than a third of the contact width (a wheel that does that
  // bulldozes and stalls; Spirit at Troy sank to its hubs).
  const verdict = utilisation > 1 ? "fails" : z > load.widthM / 3 ? "sinks" : "firm";
  return { pressurePa, sinkageM: z, bearingPa, utilisation, verdict };
}
