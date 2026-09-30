/**
 * Engineering materials database.
 *
 * Values are room-temperature handbook numbers (ASM Handbook, MMPDS, vendor
 * datasheets) unless a curve is given. Strength curves are yield strength at
 * temperature after prolonged exposure (the relevant case for a Venus surface
 * soak), in MPa vs degrees C. Points past the highest published temperature
 * are extrapolated and flagged in `notes`.
 *
 * Fidelity: good to ~10-20% for metals, rougher for polymers/insulation.
 */

export type MaterialKind = "metal" | "polymer" | "composite" | "insulation" | "pcm" | "rock";

export interface Material {
  id: string;
  name: string;
  kind: MaterialKind;
  density: number; // kg/m^3
  cp: number; // J/kg/K
  k: number; // W/m/K
  emissivity: number;
  /** Temperature where it melts or decomposes [K]. */
  meltK?: number;
  /** Above this it softens / loses service properties [K]. */
  maxServiceK?: number;
  /** Polymers: thermal decomposition onset in an inert gas (Venus CO2 has no free O2, so it chars, not burns) [K]. */
  decomposeK?: number;
  /** Yield strength curve [degC, MPa]. */
  yieldCurve?: ReadonlyArray<readonly [number, number]>;
  /** Young's modulus curve [degC, GPa]. */
  modulusCurve?: ReadonlyArray<readonly [number, number]>;
  /** Phase change (only for kind === "pcm"). */
  pcm?: { meltK: number; latentJkg: number };
  notes?: string;
}

const MATERIAL_TABLE = {
  al6061: {
    id: "al6061",
    name: "Aluminum 6061-T6",
    kind: "metal",
    density: 2700,
    cp: 896,
    k: 167,
    emissivity: 0.2,
    meltK: 855,
    maxServiceK: 423,
    yieldCurve: [
      [24, 276],
      [100, 262],
      [149, 214],
      [204, 103],
      [260, 34],
      [316, 19],
      [371, 12],
      [427, 8],
      [482, 5],
    ],
    modulusCurve: [
      [24, 69],
      [200, 63],
      [300, 55],
      [400, 45],
      [500, 35],
    ],
    notes: "ASM data to 371 °C (after 10,000 h exposure); 427-482 °C extrapolated.",
  },
  al7075: {
    id: "al7075",
    name: "Aluminum 7075-T6",
    kind: "metal",
    density: 2810,
    cp: 960,
    k: 130,
    emissivity: 0.2,
    meltK: 750,
    maxServiceK: 393,
    yieldCurve: [
      [24, 503],
      [100, 448],
      [149, 214],
      [204, 110],
      [260, 76],
      [316, 55],
      [371, 41],
      [427, 25],
      [477, 0],
    ],
    modulusCurve: [
      [24, 72],
      [200, 65],
      [300, 57],
      [400, 47],
    ],
    notes: "Solidus ~477 °C, so at Venus surface temperature it is right at the edge of melting.",
  },
  ti64: {
    id: "ti64",
    name: "Titanium Ti-6Al-4V",
    kind: "metal",
    density: 4430,
    cp: 526,
    k: 6.7,
    emissivity: 0.35,
    meltK: 1878,
    maxServiceK: 673,
    yieldCurve: [
      [20, 880],
      [100, 800],
      [200, 700],
      [300, 630],
      [400, 580],
      [500, 530],
      [600, 450],
    ],
    modulusCurve: [
      [20, 114],
      [300, 100],
      [500, 90],
    ],
  },
  ss316: {
    id: "ss316",
    name: "Stainless steel 316",
    kind: "metal",
    density: 8000,
    cp: 500,
    k: 16.3,
    emissivity: 0.4,
    meltK: 1648,
    maxServiceK: 1073,
    yieldCurve: [
      [20, 290],
      [100, 250],
      [200, 210],
      [300, 190],
      [400, 175],
      [500, 165],
      [600, 150],
    ],
    modulusCurve: [
      [20, 193],
      [500, 160],
    ],
  },
  inconel718: {
    id: "inconel718",
    name: "Inconel 718",
    kind: "metal",
    density: 8190,
    cp: 435,
    k: 11.4,
    emissivity: 0.4,
    meltK: 1533,
    maxServiceK: 973,
    yieldCurve: [
      [20, 1030],
      [200, 980],
      [400, 950],
      [500, 940],
      [650, 900],
    ],
    modulusCurve: [
      [20, 200],
      [500, 175],
    ],
  },
  cfrp: {
    id: "cfrp",
    name: "Carbon fiber / epoxy",
    kind: "composite",
    density: 1550,
    cp: 1000,
    k: 5,
    emissivity: 0.85,
    meltK: 600,
    maxServiceK: 423,
    decomposeK: 620,
    yieldCurve: [
      [20, 600],
      [120, 540],
      [150, 300],
      [180, 60],
      [250, 10],
      [300, 0],
    ],
    modulusCurve: [
      [20, 70],
      [150, 50],
      [200, 8],
    ],
    notes: "Epoxy glass transition ~150-180 °C; matrix decomposes above ~300 °C.",
  },
  peek: {
    id: "peek",
    name: "PEEK",
    kind: "polymer",
    density: 1300,
    cp: 1340,
    k: 0.25,
    emissivity: 0.9,
    meltK: 616,
    maxServiceK: 523,
    decomposeK: 850,
    notes: "Melts at 343 °C but only decomposes above ~575 °C: on Venus it slumps and drips but does not char.",
  },
  pcabs: {
    id: "pcabs",
    name: "PC/ABS plastic covers",
    kind: "polymer",
    density: 1150,
    cp: 1300,
    k: 0.2,
    emissivity: 0.9,
    meltK: 500,
    maxServiceK: 383,
    decomposeK: 620,
    notes: "Typical humanoid shell plastic. Softens ~110-140 °C, flows ~230 °C, decomposes (chars) from ~350 °C.",
  },
  microporous: {
    id: "microporous",
    name: "Microporous silica insulation",
    kind: "insulation",
    density: 250,
    cp: 1000,
    k: 0.06,
    emissivity: 0.8,
    maxServiceK: 1273,
    notes:
      "Rated ~0.03 W/m/K at 1 bar. At 92 bar the CO2 mean free path (~1 nm) is far smaller than the pores, so gas conduction comes back; ~0.06 assumed.",
  },
  aerogel: {
    id: "aerogel",
    name: "Silica aerogel blanket",
    kind: "insulation",
    density: 150,
    cp: 1000,
    k: 0.05,
    emissivity: 0.8,
    maxServiceK: 923,
    notes: "0.015-0.02 W/m/K on Earth; pressurized CO2 in the pores roughly doubles to triples it.",
  },
  vacuumMli: {
    id: "vacuumMli",
    name: "Evacuated multilayer (vacuum jacket)",
    kind: "insulation",
    density: 100,
    cp: 800,
    k: 0.004,
    emissivity: 0.05,
    maxServiceK: 1073,
    notes: "Only works inside a sealed vacuum jacket. Assumes the jacket holds; high-T radiation limits it to ~0.004.",
  },
  veneraFoam: {
    id: "veneraFoam",
    name: "Venera-era porous insulation",
    kind: "insulation",
    density: 300,
    cp: 1000,
    k: 0.1,
    emissivity: 0.8,
    maxServiceK: 1073,
    notes: "Stand-in for the Venera lander's external insulation. Thickness/conductivity calibrated, not measured.",
  },
  lnt: {
    id: "lnt",
    name: "Lithium nitrate trihydrate (PCM)",
    kind: "pcm",
    density: 1550,
    cp: 2000,
    k: 0.6,
    emissivity: 0.9,
    pcm: { meltK: 303, latentJkg: 296_000 },
    notes: "Heat-sink phase-change material used on the Venera landers. Melts at 30 °C.",
  },
  ice: {
    id: "ice",
    name: "Water ice (PCM)",
    kind: "pcm",
    density: 917,
    cp: 2100,
    k: 2.2,
    emissivity: 0.95,
    pcm: { meltK: 273.15, latentJkg: 334_000 },
  },
  basalt: {
    id: "basalt",
    name: "Basalt",
    kind: "rock",
    density: 2900,
    cp: 840,
    k: 2,
    emissivity: 0.9,
    meltK: 1400,
  },
} as const satisfies Record<string, Material>;

export type MaterialId = keyof typeof MATERIAL_TABLE;
export const MATERIALS: Record<MaterialId, Material> = MATERIAL_TABLE;

export function material(id: MaterialId): Material {
  return MATERIALS[id];
}

/** Linear interpolation in a [degC, value] curve, clamped at the ends. */
export function curveAt(curve: ReadonlyArray<readonly [number, number]>, tempK: number): number {
  const c = tempK - 273.15;
  if (c <= curve[0][0]) return curve[0][1];
  for (let i = 0; i < curve.length - 1; i++) {
    const [x0, y0] = curve[i];
    const [x1, y1] = curve[i + 1];
    if (c <= x1) return y0 + ((y1 - y0) * (c - x0)) / (x1 - x0);
  }
  return Math.max(0, curve[curve.length - 1][1]);
}

/** Fraction of room-temperature yield strength left at temperature. */
export function yieldFraction(m: Material, tempK: number): number {
  if (!m.yieldCurve) return 1;
  return curveAt(m.yieldCurve, tempK) / m.yieldCurve[0][1];
}

export const INSULATIONS = Object.values(MATERIALS).filter((m) => m.kind === "insulation");
export const STRUCTURAL = Object.values(MATERIALS).filter((m) => m.kind === "metal" || m.kind === "composite");
export const PCMS = Object.values(MATERIALS).filter((m) => m.kind === "pcm");
