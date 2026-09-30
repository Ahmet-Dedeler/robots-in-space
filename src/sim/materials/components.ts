/**
 * Component database: the parts that actually decide whether something
 * survives on Venus. Each part has a warning temperature (degraded / out of
 * spec) and a failure temperature (stops working). Values are typical
 * datasheet ratings; real parts vary by a few tens of degrees.
 *
 * Sources (general):
 * - Magnets: Arnold Magnetic / Vacuumschmelze grade tables (max operating
 *   temperature, Curie temperature, reversible Br coefficient).
 * - Electronics: JEDEC/AEC-Q100 grades; SOI high-temp parts (~225 °C);
 *   NASA Glenn SiC JFET ICs ran 60 days at 460 °C in the GEER Venus chamber
 *   (Neudeck et al. 2016-2023).
 * - Batteries: separator shutdown ~130 °C, NMC thermal runaway onset
 *   ~150-200 °C; molten-salt thermal batteries operate ~350-550 °C.
 * - Solders: SAC305 217 °C, Sn63Pb37 183 °C, Pb95Sn5 ~310 °C, AuGe 356 °C.
 */

export interface PartBase {
  id: string;
  name: string;
  warnK: number;
  failK: number;
  notes?: string;
}

export interface ElectronicsPart extends PartBase {
  category: "electronics";
}

export interface BatteryPart extends PartBase {
  category: "battery";
  /** Below this the chemistry does not deliver power (molten salt needs heat). */
  minOperatingK: number;
  /** Pack-level specific energy [Wh/kg]. */
  whPerKg: number;
  /** Heat released on thermal runaway, as a multiple of stored energy. 0 = no runaway. */
  runawayFactor: number;
}

export interface MagnetPart extends PartBase {
  category: "magnet";
  /** Reversible remanence coefficient [1/K], negative. */
  alpha: number;
  /** Above this, losses become irreversible [K]. */
  maxOperatingK: number;
  curieK: number;
  /** Torque density relative to a stock NdFeB motor of the same mass. */
  relativeTorque: number;
}

export interface GenericPart extends PartBase {
  category: "winding" | "solder" | "lubricant" | "seal" | "camera";
}

export type Part = ElectronicsPart | BatteryPart | MagnetPart | GenericPart;

const c = (deg: number) => deg + 273.15;

const ELECTRONICS_TABLE = {
  siCommercial: { id: "siCommercial", category: "electronics", name: "Commercial silicon (0-85 °C)", warnK: c(85), failK: c(125) },
  siAutomotive: { id: "siAutomotive", category: "electronics", name: "Automotive silicon (AEC-Q100 grade 0)", warnK: c(150), failK: c(175) },
  siMilitary: { id: "siMilitary", category: "electronics", name: "Military silicon (-55-125 °C)", warnK: c(125), failK: c(150) },
  soi: { id: "soi", category: "electronics", name: "High-temp SOI (225 °C class)", warnK: c(225), failK: c(300) },
  gan: {
    id: "gan",
    category: "electronics",
    name: "GaN HEMT (high-temp demo class)",
    warnK: c(350),
    failK: c(500),
    notes: "GaN transistors have been run at 500 °C+ for hours to days in labs; lifetime at 460 °C is still an open question. Approximate.",
  },
  sicJfet: {
    id: "sicJfet",
    category: "electronics",
    name: "SiC JFET ICs (NASA Glenn)",
    warnK: c(500),
    failK: c(600),
    notes: "Ran 60 days in GEER at 460 °C / 92 bar. Very low integration: think 1970s-era logic, not a GPU.",
  },
} as const satisfies Record<string, ElectronicsPart>;
export const ELECTRONICS: Record<keyof typeof ELECTRONICS_TABLE, ElectronicsPart> = ELECTRONICS_TABLE;

const BATTERIES_TABLE = {
  liIon: {
    id: "liIon",
    category: "battery",
    name: "Li-ion NMC",
    warnK: c(60),
    failK: c(150),
    minOperatingK: c(-20),
    whPerKg: 160,
    runawayFactor: 2,
    notes: "Separator melts ~130 °C; thermal runaway releases more than the stored electrical energy.",
  },
  liIonSpace: {
    id: "liIonSpace",
    category: "battery",
    name: "Li-ion, low-temp electrolyte (JPL, MER/MSL)",
    warnK: c(40),
    failK: c(150),
    minOperatingK: c(-30),
    whPerKg: 90,
    runawayFactor: 2,
    notes: "Yardney/JPL cells with a low-temperature electrolyte: ~70% capacity at -30 °C (Smart et al. 2004). Heavier than consumer packs.",
  },
  lfp: { id: "lfp", category: "battery", name: "LiFePO4", warnK: c(60), failK: c(220), minOperatingK: c(-20), whPerKg: 120, runawayFactor: 0.6 },
  leadAcid: {
    id: "leadAcid",
    category: "battery",
    name: "Lead-acid (12 V starter)",
    warnK: c(50),
    failK: c(110),
    minOperatingK: c(-30),
    whPerKg: 35,
    runawayFactor: 0,
    notes: "Water-based electrolyte boils off above ~110 °C; the lead grids themselves melt at 327 °C.",
  },
  silverZinc: {
    id: "silverZinc",
    category: "battery",
    name: "Silver-zinc (Venera era)",
    warnK: c(50),
    failK: c(90),
    minOperatingK: c(-10),
    whPerKg: 100,
    runawayFactor: 0,
  },
  sodiumSulfur: {
    id: "sodiumSulfur",
    category: "battery",
    name: "Sodium-sulfur (molten)",
    warnK: c(380),
    failK: c(480),
    minOperatingK: c(290),
    whPerKg: 150,
    runawayFactor: 0,
    notes: "Runs molten at ~300-350 °C. Venus ambient is past its comfort zone.",
  },
  zebra: {
    id: "zebra",
    category: "battery",
    name: "Sodium-nickel chloride (ZEBRA)",
    warnK: c(400),
    failK: c(450),
    minOperatingK: c(250),
    whPerKg: 120,
    runawayFactor: 0,
    notes: "Molten-salt EV battery (270-350 °C). Needs heat to work, but Venus is ~100 °C past its rating.",
  },
  thermal: {
    id: "thermal",
    category: "battery",
    name: "Molten-salt Li/FeS2 (thermal battery)",
    warnK: c(550),
    failK: c(650),
    minOperatingK: c(350),
    whPerKg: 100,
    runawayFactor: 0,
    notes: "Electrolyte is solid until ~350 °C, so Venus heat keeps it running. Proposed for long-lived Venus landers.",
  },
} as const satisfies Record<string, BatteryPart>;
export const BATTERIES: Record<keyof typeof BATTERIES_TABLE, BatteryPart> = BATTERIES_TABLE;

const MAGNETS_TABLE = {
  ndfebN: {
    id: "ndfebN",
    category: "magnet",
    name: "NdFeB standard (N42)",
    alpha: -0.0012,
    warnK: c(60),
    failK: c(310),
    maxOperatingK: c(80),
    curieK: c(310),
    relativeTorque: 1,
  },
  ndfebSH: {
    id: "ndfebSH",
    category: "magnet",
    name: "NdFeB high-temp (SH grade)",
    alpha: -0.0011,
    warnK: c(120),
    failK: c(340),
    maxOperatingK: c(150),
    curieK: c(340),
    relativeTorque: 1,
    notes: "Typical for robot/EV actuators.",
  },
  ndfebAH: {
    id: "ndfebAH",
    category: "magnet",
    name: "NdFeB AH grade (230 °C)",
    alpha: -0.001,
    warnK: c(200),
    failK: c(350),
    maxOperatingK: c(230),
    curieK: c(350),
    relativeTorque: 0.95,
  },
  smco: {
    id: "smco",
    category: "magnet",
    name: "SmCo (Sm2Co17)",
    alpha: -0.00035,
    warnK: c(300),
    failK: c(820),
    maxOperatingK: c(350),
    curieK: c(820),
    relativeTorque: 0.85,
    notes: "Best rare-earth option for heat, but still rated only to ~350 °C.",
  },
  alnico: {
    id: "alnico",
    category: "magnet",
    name: "AlNiCo 5",
    alpha: -0.0002,
    warnK: c(500),
    failK: c(860),
    maxOperatingK: c(525),
    curieK: c(860),
    relativeTorque: 0.45,
    notes: "Survives Venus heat, but low coercivity means much weaker motors per kg.",
  },
  none: {
    id: "none",
    category: "magnet",
    name: "No magnets (switched reluctance)",
    alpha: 0,
    warnK: c(2000),
    failK: c(2000),
    maxOperatingK: c(2000),
    curieK: c(2100),
    relativeTorque: 0.7,
    notes: "Heat-proof motor topology; limited only by winding insulation. ~30% less torque per kg.",
  },
} as const satisfies Record<string, MagnetPart>;
export const MAGNETS: Record<keyof typeof MAGNETS_TABLE, MagnetPart> = MAGNETS_TABLE;

const WINDINGS_TABLE = {
  classF: { id: "classF", category: "winding", name: "Enamel wire, class F (155 °C)", warnK: c(155), failK: c(200) },
  classH: { id: "classH", category: "winding", name: "Enamel wire, class H (180 °C)", warnK: c(180), failK: c(230) },
  polyimide: { id: "polyimide", category: "winding", name: "Polyimide (Kapton) insulated", warnK: c(240), failK: c(400) },
  ceramic: { id: "ceramic", category: "winding", name: "Ceramic-coated / mineral insulated", warnK: c(600), failK: c(800) },
} as const satisfies Record<string, GenericPart>;
export const WINDINGS: Record<keyof typeof WINDINGS_TABLE, GenericPart> = WINDINGS_TABLE;

const SOLDERS_TABLE = {
  snpb: { id: "snpb", category: "solder", name: "Sn63Pb37", warnK: c(150), failK: c(183) },
  sac305: { id: "sac305", category: "solder", name: "SAC305 lead-free", warnK: c(180), failK: c(217) },
  highPb: { id: "highPb", category: "solder", name: "High-lead Pb95Sn5", warnK: c(270), failK: c(308) },
  auge: { id: "auge", category: "solder", name: "AuGe eutectic", warnK: c(320), failK: c(356) },
  ptHtcc: {
    id: "ptHtcc",
    category: "solder",
    name: "Pt thick-film on HTCC alumina",
    warnK: c(800),
    failK: c(1000),
    notes: "NASA Glenn packaging that survived 60 days in GEER.",
  },
} as const satisfies Record<string, GenericPart>;
export const SOLDERS: Record<keyof typeof SOLDERS_TABLE, GenericPart> = SOLDERS_TABLE;

const LUBRICANTS_TABLE = {
  grease: { id: "grease", category: "lubricant", name: "Mineral/synthetic grease", warnK: c(120), failK: c(180) },
  pfpe: { id: "pfpe", category: "lubricant", name: "PFPE (Krytox-class)", warnK: c(250), failK: c(320) },
  mos2: { id: "mos2", category: "lubricant", name: "MoS2 dry film", warnK: c(600), failK: c(800) },
} as const satisfies Record<string, GenericPart>;
export const LUBRICANTS: Record<keyof typeof LUBRICANTS_TABLE, GenericPart> = LUBRICANTS_TABLE;

const SEALS_TABLE = {
  viton: { id: "viton", category: "seal", name: "Viton FKM O-ring", warnK: c(200), failK: c(260) },
  kalrez: { id: "kalrez", category: "seal", name: "Kalrez FFKM O-ring", warnK: c(300), failK: c(330) },
  metal: { id: "metal", category: "seal", name: "Metal C-seal / weld", warnK: c(700), failK: c(900) },
} as const satisfies Record<string, GenericPart>;
export const SEALS: Record<keyof typeof SEALS_TABLE, GenericPart> = SEALS_TABLE;

const CAMERAS_TABLE = {
  cmos: { id: "cmos", category: "camera", name: "CMOS camera", warnK: c(70), failK: c(105) },
  hardened: { id: "hardened", category: "camera", name: "Vidicon/high-temp imager", warnK: c(150), failK: c(250) },
} as const satisfies Record<string, GenericPart>;
export const CAMERAS: Record<keyof typeof CAMERAS_TABLE, GenericPart> = CAMERAS_TABLE;

export interface HydraulicPart extends PartBase {
  category: "hydraulic";
}

/** Hydraulic fluids + seals: the first failure is usually the seals, then the fluid cracks. */
const HYDRAULICS_TABLE = {
  mineral: {
    id: "mineral",
    category: "hydraulic",
    name: "Mineral hydraulic oil + nitrile seals",
    warnK: c(90),
    failK: c(150),
    notes: "Nitrile seals harden and leak past ~120-150 °C; oil viscosity collapses and it cracks thermally above ~250 °C.",
  },
  syntheticEster: {
    id: "syntheticEster",
    category: "hydraulic",
    name: "Synthetic ester + Viton seals",
    warnK: c(150),
    failK: c(220),
  },
  ppe: {
    id: "ppe",
    category: "hydraulic",
    name: "Polyphenyl ether + metal seals",
    warnK: c(320),
    failK: c(450),
    notes: "The most heat-stable hydraulic fluid family (jet engines, ~450 °C). Right at the edge on Venus.",
  },
} as const satisfies Record<string, HydraulicPart>;
export const HYDRAULICS: Record<keyof typeof HYDRAULICS_TABLE, HydraulicPart> = HYDRAULICS_TABLE;
export type HydraulicId = keyof typeof HYDRAULICS_TABLE;

export type ElectronicsId = keyof typeof ELECTRONICS_TABLE;
export type BatteryId = keyof typeof BATTERIES_TABLE;
export type MagnetId = keyof typeof MAGNETS_TABLE;
export type WindingId = keyof typeof WINDINGS_TABLE;
export type SolderId = keyof typeof SOLDERS_TABLE;
export type LubricantId = keyof typeof LUBRICANTS_TABLE;
export type SealId = keyof typeof SEALS_TABLE;
export type CameraId = keyof typeof CAMERAS_TABLE;

/**
 * Motor torque available (relative to the stock motor at 20 °C) from magnet
 * temperature. Reversible loss follows the remanence coefficient; above the
 * max operating temperature we add an irreversible loss that grows linearly
 * to 100% at the Curie point. Irreversible loss depends on the hottest
 * temperature ever reached, so cooling back down does not restore it.
 */
export function magnetTorqueFraction(m: MagnetPart, tempK: number, peakK: number): number {
  const reversible = Math.max(0, 1 + m.alpha * (tempK - 293.15));
  const irreversible =
    peakK <= m.maxOperatingK ? 0 : Math.min(1, (peakK - m.maxOperatingK) / (m.curieK - m.maxOperatingK));
  return Math.max(0, reversible * (1 - irreversible));
}
