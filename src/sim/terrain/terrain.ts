/**
 * Venus ground, built from what the Venera landers actually photographed.
 *
 * Sources (via Kreslavsky/Carter et al., "Sedimentary Processes on Venus",
 * Space Sci. Rev. 2023, and Garvin et al. 1984 "Venus: the nature of the
 * surface from Venera panoramas"):
 * - Venera 10/13/14: bedrock of laminated, thinly bedded sheets a few cm
 *   thick, with varying coarse sediment between the slabs. Venera 14 had the
 *   least sediment: interlocked, subangular to subrounded, possibly jointed
 *   plates. Venera 13 had more loose, mobile fines (wind stripped sediment off
 *   the lander ring within an hour).
 * - Venera 9: a 15-20 degree talus slope with subangular boulders up to
 *   60 cm wide and 20 cm tall in coarse gravel.
 * - Surface materials: bulk density ~1500 kg/m^3, ~50% porosity (Venera
 *   13/14 mechanical data); strength like dense sand/weak rock (V13) to
 *   sandstone (V14, Vega 2).
 * - Rock composition: basalt (V13 high-K alkaline, V14 tholeiitic). Albedo is
 *   low; the orange colour in the photos is the light, not the rock.
 *
 * Plate sizes and exact layer counts are read off the panoramas (5 cm scale
 * notches on the lander rings), so they are estimates, not measurements.
 *
 * Moon, Mars and Mercury ground (styles with a `body`) adds two statistical
 * models on top:
 * - Craters: cumulative density N(>D) = n1 D^-2 per m^2. On the Moon and
 *   Mercury small craters are in equilibrium (as many erased as formed):
 *   n1 ~ 10^-1.1 (Gault 1970; Trask 1966). Mars erases small craters with
 *   wind, so n1 is 10-50x lower at the rover sites. Simple bowl profile,
 *   depth/diameter 0.2 when fresh, most much shallower (degraded).
 * - Rocks: Golombek & Rapp (1997) rock abundance, the fraction of area
 *   covered by rocks wider than D: F(D) = k exp(-q D), q = 1.79 + 0.152/k.
 *   k is the total rock cover: ~0.01 on lunar mare and Meridiani, ~0.07 at
 *   Viking 1 / Gale, ~0.16 at Viking 2 / Pathfinder. Rock height ~ D/2.
 * - Ripples: aeolian bedforms (Meridiani granule ripples, ~1-2 cm high).
 *
 * Larger craters (to several hundred metres) are added beyond the robot's
 * patch so the horizon of an airless world looks like one, but never under
 * the experiment pad: landing sites are picked on intercrater ground.
 *
 * Each ground also carries its soil mechanics (soil.ts) and a fidelity label.
 *
 * h(x, y) is a pure deterministic function in metres (x east, y north, z up),
 * shared by the MuJoCo collision heightfield and the rendered ground.
 */
import { BODIES, type BodyId } from "../planets/bodies";
import type { Fidelity } from "../vehicles/types";
import { SOILS, type SoilId } from "./soil";

export interface TerrainStyle {
  id: string;
  name: string;
  note: string;
  /** Mean plate (Voronoi cell) size [m]. 0 = no plates. */
  plateSize: number;
  /** Plate thickness range [m]. */
  plateThickness: [number, number];
  /** Fraction of cells that hold a plate (rest is sediment). */
  plateCoverage: number;
  /** Chance a plate has a second, smaller layer on top. */
  layerChance: number;
  /** Gap between plates [m]. */
  crackWidth: number;
  /** Maximum plate tilt [deg]. */
  tiltDeg: number;
  /** Sediment surface height as a fraction of mean plate thickness. */
  sedimentFill: number;
  /** Site slope [deg], downhill toward -x. */
  slopeDeg: number;
  /** Boulders per m^2, max width and height [m]. */
  boulders: { density: number; maxWidth: number; maxHeight: number };
  /** Rock / sediment albedo-ish base colours (linear sRGB, under white light). */
  rockColor: [number, number, number];
  sedimentColor: [number, number, number];
  /** Coulomb friction for feet (basalt/sediment, dry, no water). */
  friction: number;
  /** World this ground belongs to (Venus when absent; `flat` works anywhere). */
  body?: BodyId;
  /**
   * Crater population: N(>D) = n1 D^-2 per m^2 for D in [dMin, dMax] m; depth/D range.
   * farDMax extends the same law to larger craters that are kept off the experiment pad
   * (they shape the mid-distance ground and the horizon).
   */
  craters?: { n1: number; dMin: number; dMax: number; depthRatio: readonly [number, number]; farDMax?: number };
  /** Golombek-Rapp rock abundance k, rocks from dMin to dMax [m]. */
  rocks?: { k: number; dMin: number; dMax: number };
  /** Wind ripples: height [m], wavelength [m], crest direction [deg from east]. */
  ripples?: { height: number; wavelength: number; dirDeg: number };
  /** Soil mechanics of the fines between the rocks (sinkage, bearing strength). */
  soil: SoilId;
  /** How much of this ground is measured vs inferred. */
  fidelity: Fidelity;
  /** Where the numbers come from. */
  sources: string;
}

export const TERRAINS = {
  venera14: {
    id: "venera14",
    name: "Venera 14: bedrock plates",
    note: "Interlocked layered plates, very little soil. Most of the lowland plains likely look like this.",
    plateSize: 0.55,
    plateThickness: [0.02, 0.05],
    plateCoverage: 0.93,
    layerChance: 0.45,
    crackWidth: 0.012,
    tiltDeg: 3,
    sedimentFill: 0.35,
    slopeDeg: 0,
    boulders: { density: 0, maxWidth: 0, maxHeight: 0 },
    rockColor: [0.2, 0.175, 0.15],
    sedimentColor: [0.07, 0.058, 0.047],
    soil: "veneraRock",
    fidelity: "approximation",
    sources: "Venera 14 panorama (Garvin et al. 1984; Carter et al. 2023). Plate sizes read off the 5 cm notches on the lander ring.",
    friction: 0.75,
  },
  venera13: {
    id: "venera13",
    name: "Venera 13: plates + loose soil",
    note: "Layered slabs partly buried in dark, fine, wind-mobile sediment, with scattered pebbles.",
    plateSize: 0.45,
    plateThickness: [0.02, 0.04],
    plateCoverage: 0.65,
    layerChance: 0.3,
    crackWidth: 0.03,
    tiltDeg: 5,
    sedimentFill: 0.7,
    slopeDeg: 0,
    boulders: { density: 1.5, maxWidth: 0.08, maxHeight: 0.03 },
    rockColor: [0.15, 0.13, 0.11],
    sedimentColor: [0.07, 0.06, 0.05],
    soil: "veneraSediment",
    fidelity: "approximation",
    sources: "Venera 13 panorama and penetrometer (Garvin et al. 1984; Surkov et al. 1984; Carter et al. 2023).",
    friction: 0.65,
  },
  venera9: {
    id: "venera9",
    name: "Venera 9: boulder talus slope",
    note: "A 17° slope of angular boulders up to 60 cm wide and 20 cm tall in coarse gravel (Beta Regio).",
    plateSize: 0,
    plateThickness: [0, 0],
    plateCoverage: 0,
    layerChance: 0,
    crackWidth: 0,
    tiltDeg: 0,
    sedimentFill: 0,
    slopeDeg: 17,
    boulders: { density: 0.55, maxWidth: 0.6, maxHeight: 0.2 },
    rockColor: [0.15, 0.135, 0.12],
    sedimentColor: [0.1, 0.085, 0.07],
    soil: "veneraRock",
    fidelity: "approximation",
    sources: "Venera 9 panorama: 15-20° talus, blocks to 60 x 20 cm (Florensky et al. 1977; Garvin et al. 1984).",
    friction: 0.7,
  },
  flat: {
    id: "flat",
    name: "Flat test pad",
    note: "Perfectly flat ground, for comparing against the real terrain.",
    plateSize: 0,
    plateThickness: [0, 0],
    plateCoverage: 0,
    layerChance: 0,
    crackWidth: 0,
    tiltDeg: 0,
    sedimentFill: 0,
    slopeDeg: 0,
    boulders: { density: 0, maxWidth: 0, maxHeight: 0 },
    rockColor: [0.15, 0.13, 0.11],
    sedimentColor: [0.1, 0.085, 0.07],
    soil: "rigid",
    fidelity: "hypothetical",
    sources: "Idealised test pad.",
    friction: 0.75,
  },
  // ---- Moon ---------------------------------------------------------------------
  lunarMare: {
    id: "lunarMare",
    name: "Lunar mare regolith",
    note: "Apollo 11/12, Chang'e: fine grey regolith pocked with craters of every size, few rocks (~1% cover).",
    body: "moon",
    plateSize: 0,
    plateThickness: [0, 0],
    plateCoverage: 0,
    layerChance: 0,
    crackWidth: 0,
    tiltDeg: 0,
    sedimentFill: 0,
    slopeDeg: 0,
    boulders: { density: 0, maxWidth: 0, maxHeight: 0 },
    craters: { n1: 0.079, dMin: 0.4, dMax: 24, depthRatio: [0.03, 0.2], farDMax: 600 },
    rocks: { k: 0.01, dMin: 0.04, dMax: 0.8 },
    // Mare regolith reflects ~7-10% (Apollo photometry); slightly brownish grey.
    rockColor: [0.13, 0.125, 0.115],
    sedimentColor: [0.085, 0.08, 0.074],
    soil: "lunarRegolith",
    fidelity: "calibrated",
    sources: "Craters: lunar equilibrium N(>D) = 10^-1.1 D^-2 (Gault 1970; Trask 1966). Rocks: ~1% cover (Surveyor / Apollo; Diviner rock abundance 0.5% for >1 m, Bandfield et al. 2011).",
    friction: 0.8,
  },
  lunarHighlands: {
    id: "lunarHighlands",
    name: "Lunar highlands",
    note: "Brighter anorthositic regolith, older and more cratered, more blocks (Apollo 16, south pole).",
    body: "moon",
    plateSize: 0,
    plateThickness: [0, 0],
    plateCoverage: 0,
    layerChance: 0,
    crackWidth: 0,
    tiltDeg: 0,
    sedimentFill: 0,
    slopeDeg: 4,
    boulders: { density: 0, maxWidth: 0, maxHeight: 0 },
    craters: { n1: 0.079, dMin: 0.4, dMax: 30, depthRatio: [0.03, 0.2], farDMax: 600 },
    rocks: { k: 0.02, dMin: 0.04, dMax: 1.2 },
    rockColor: [0.26, 0.25, 0.24],
    sedimentColor: [0.19, 0.185, 0.175],
    soil: "lunarRegolith",
    fidelity: "calibrated",
    sources: "Craters as mare (equilibrium). Diviner: highlands 0.4% cover by >1 m rocks (Bandfield et al. 2011); albedo Apollo 16.",
    friction: 0.8,
  },
  lunarPolar: {
    id: "lunarPolar",
    name: "Lunar south pole ridge (Artemis)",
    note: "Sunlit highland ridge near Shackleton: a steady 6° slope, cratered regolith and scattered metre-size boulders.",
    body: "moon",
    plateSize: 0,
    plateThickness: [0, 0],
    plateCoverage: 0,
    layerChance: 0,
    crackWidth: 0,
    tiltDeg: 0,
    sedimentFill: 0,
    slopeDeg: 6,
    // LROC NAC: 1800-3000 boulders >=0.65 m per km^2 on the Shackleton rim / connecting ridge.
    // With this size law ~60% of blocks are >=0.65 m wide, so 0.004 /m^2 -> ~2400 /km^2.
    boulders: { density: 0.004, maxWidth: 2.5, maxHeight: 1.1 },
    craters: { n1: 0.079, dMin: 0.4, dMax: 30, depthRatio: [0.03, 0.2], farDMax: 600 },
    rocks: { k: 0.015, dMin: 0.04, dMax: 0.8 },
    rockColor: [0.27, 0.26, 0.25],
    sedimentColor: [0.2, 0.195, 0.185],
    soil: "lunarRegolith",
    fidelity: "approximation",
    sources: "Slopes <5-10° at 30 m baselines on Artemis candidate sites (LOLA); boulder counts from LROC NAC (LPSC 2022 #1312, 2024 #1898).",
    friction: 0.8,
  },
  lunarShadowed: {
    id: "lunarShadowed",
    name: "Shadowed crater floor (Shackleton)",
    note: "Never-lit floor: smooth, very porous regolith (~70% voids) that may hide ice a few dm down. Feet and wheels sink more.",
    body: "moon",
    plateSize: 0,
    plateThickness: [0, 0],
    plateCoverage: 0,
    layerChance: 0,
    crackWidth: 0,
    tiltDeg: 0,
    sedimentFill: 0,
    slopeDeg: 2,
    boulders: { density: 0, maxWidth: 0, maxHeight: 0 },
    craters: { n1: 0.05, dMin: 0.4, dMax: 24, depthRatio: [0.03, 0.15], farDMax: 600 },
    rocks: { k: 0.008, dMin: 0.04, dMax: 0.6 },
    rockColor: [0.24, 0.235, 0.225],
    sedimentColor: [0.17, 0.165, 0.158],
    soil: "lunarFluffy",
    fidelity: "hypothetical",
    sources: "LAMP far-UV porosity ~70% (Gladstone et al. 2012); LOLA: Shackleton floor smooth at metre scale (Zuber et al. 2012). No lander yet.",
    friction: 0.7,
  },
  lunarBlocky: {
    id: "lunarBlocky",
    name: "Fresh crater ejecta (Surveyor 7, Tycho)",
    note: "Young ejecta blanket: angular blocks from fist- to car-size everywhere. The roughest ground landers have seen on the Moon.",
    body: "moon",
    plateSize: 0,
    plateThickness: [0, 0],
    plateCoverage: 0,
    layerChance: 0,
    crackWidth: 0,
    tiltDeg: 0,
    sedimentFill: 0,
    slopeDeg: 3,
    boulders: { density: 0.02, maxWidth: 2, maxHeight: 0.9 },
    craters: { n1: 0.03, dMin: 0.4, dMax: 20, depthRatio: [0.05, 0.2], farDMax: 600 },
    rocks: { k: 0.12, dMin: 0.04, dMax: 1 },
    rockColor: [0.25, 0.24, 0.23],
    sedimentColor: [0.17, 0.165, 0.155],
    soil: "lunarRegolith",
    fidelity: "approximation",
    sources: "Surveyor 7 was far rockier than the maria (Shoemaker & Morris 1969); k set near Viking 2's 0.16. Young surfaces have not reached crater equilibrium, so fewer small craters.",
    friction: 0.8,
  },
  // ---- Mars -----------------------------------------------------------------------
  marsGale: {
    id: "marsGale",
    name: "Gale crater floor",
    note: "Curiosity's drive: dusty gravel, fractured sandstone slabs and scattered angular rocks (k ~0.07).",
    body: "mars",
    plateSize: 0.9,
    plateThickness: [0.02, 0.06],
    plateCoverage: 0.3,
    layerChance: 0.25,
    crackWidth: 0.03,
    tiltDeg: 4,
    sedimentFill: 0.55,
    slopeDeg: 0,
    boulders: { density: 0, maxWidth: 0, maxHeight: 0 },
    craters: { n1: 0.004, dMin: 0.8, dMax: 24, depthRatio: [0.03, 0.12], farDMax: 300 },
    rocks: { k: 0.07, dMin: 0.04, dMax: 1 },
    // Reflectance of Martian dust ~0.35 red / 0.2 green / 0.08 blue; rocks are darker basalt under dust.
    rockColor: [0.2, 0.12, 0.075],
    sedimentColor: [0.32, 0.18, 0.09],
    soil: "marsSoil",
    fidelity: "calibrated",
    sources: "Rock cover k ~0.07 (Golombek & Rapp 1997 model; MSL site certification). Soil: Viking / MER trenches.",
    friction: 0.7,
  },
  marsRocky: {
    id: "marsRocky",
    name: "Rock-strewn plains (Viking 2 / Jezero)",
    note: "Dense field of vesicular basalt blocks on fine dust (k ~0.16, the rocky end of Mars).",
    body: "mars",
    plateSize: 0,
    plateThickness: [0, 0],
    plateCoverage: 0,
    layerChance: 0,
    crackWidth: 0,
    tiltDeg: 0,
    sedimentFill: 0,
    slopeDeg: 0,
    boulders: { density: 0, maxWidth: 0, maxHeight: 0 },
    craters: { n1: 0.003, dMin: 0.8, dMax: 20, depthRatio: [0.03, 0.1], farDMax: 300 },
    rocks: { k: 0.16, dMin: 0.04, dMax: 1.2 },
    rockColor: [0.17, 0.11, 0.075],
    sedimentColor: [0.33, 0.19, 0.095],
    soil: "marsSoil",
    fidelity: "calibrated",
    sources: "Viking 2 rock cover k ~0.16 (Golombek & Rapp 1997); Jezero floor similar (Mars 2020 site certification).",
    friction: 0.7,
  },
  marsMeridiani: {
    id: "marsMeridiani",
    name: "Meridiani sand ripples",
    note: "Opportunity's plains: dark basaltic sand in ripples over flat sulfate outcrop, almost no rocks.",
    body: "mars",
    plateSize: 1.4,
    plateThickness: [0.01, 0.03],
    plateCoverage: 0.2,
    layerChance: 0.5,
    crackWidth: 0.05,
    tiltDeg: 1,
    sedimentFill: 0.9,
    slopeDeg: 0,
    boulders: { density: 0, maxWidth: 0, maxHeight: 0 },
    craters: { n1: 0.002, dMin: 1, dMax: 20, depthRatio: [0.05, 0.15], farDMax: 300 },
    rocks: { k: 0.008, dMin: 0.03, dMax: 0.4 },
    ripples: { height: 0.02, wavelength: 3, dirDeg: 30 },
    rockColor: [0.3, 0.2, 0.12],
    sedimentColor: [0.16, 0.1, 0.065],
    soil: "marsSoil",
    fidelity: "calibrated",
    sources: "Opportunity: k <0.01, granule ripples 1-2 cm over sulfate outcrop (Golombek et al. 2005; Sullivan et al. 2011).",
    friction: 0.65,
  },
  marsDust: {
    id: "marsDust",
    name: "Dust-mantled volcano (Olympus, Tharsis)",
    note: "Bright, fluffy airfall dust at least centimetres deep, almost no rocks. Weak ground: feet sink, wheels dig.",
    body: "mars",
    plateSize: 0,
    plateThickness: [0, 0],
    plateCoverage: 0,
    layerChance: 0,
    crackWidth: 0,
    tiltDeg: 0,
    sedimentFill: 0,
    slopeDeg: 4,
    boulders: { density: 0, maxWidth: 0, maxHeight: 0 },
    craters: { n1: 0.002, dMin: 1, dMax: 20, depthRatio: [0.02, 0.08], farDMax: 300 },
    rocks: { k: 0.005, dMin: 0.04, dMax: 0.5 },
    rockColor: [0.26, 0.15, 0.09],
    sedimentColor: [0.4, 0.24, 0.13],
    soil: "marsDrift",
    fidelity: "hypothetical",
    sources: "Thermal inertia 40-120 SI over Tharsis means fine dust, cm to m thick (Putzig et al. 2005). Dust strength from Viking drift material. No lander has been.",
    friction: 0.55,
  },
  marsSoftSand: {
    id: "marsSoftSand",
    name: "Soft sand ripples (Purgatory, Troy)",
    note: "Loose, cohesionless sand drifts 20-30 cm tall: the ground that bogged Opportunity for 5 weeks and ended Spirit's driving.",
    body: "mars",
    plateSize: 1.6,
    plateThickness: [0.01, 0.03],
    plateCoverage: 0.15,
    layerChance: 0.3,
    crackWidth: 0.05,
    tiltDeg: 1,
    sedimentFill: 0.9,
    slopeDeg: 0,
    boulders: { density: 0, maxWidth: 0, maxHeight: 0 },
    craters: { n1: 0.002, dMin: 1, dMax: 20, depthRatio: [0.05, 0.15], farDMax: 300 },
    rocks: { k: 0.005, dMin: 0.03, dMax: 0.3 },
    ripples: { height: 0.25, wavelength: 4, dirDeg: 15 },
    rockColor: [0.3, 0.2, 0.12],
    sedimentColor: [0.3, 0.18, 0.1],
    soil: "marsLooseSand",
    fidelity: "approximation",
    sources: "Purgatory ripple ~30 cm tall (Opportunity sol 446); Spirit embedded at Troy, 2009. Soil: Sullivan et al. 2011 (cohesionless end).",
    friction: 0.6,
  },
  // ---- Mercury ------------------------------------------------------------------
  mercuryPlains: {
    id: "mercuryPlains",
    name: "Mercury smooth plains",
    note: "Lunar-like cratered regolith, darker and less red than the Moon (MESSENGER).",
    body: "mercury",
    plateSize: 0,
    plateThickness: [0, 0],
    plateCoverage: 0,
    layerChance: 0,
    crackWidth: 0,
    tiltDeg: 0,
    sedimentFill: 0,
    slopeDeg: 0,
    boulders: { density: 0, maxWidth: 0, maxHeight: 0 },
    craters: { n1: 0.079, dMin: 0.4, dMax: 24, depthRatio: [0.03, 0.2], farDMax: 600 },
    rocks: { k: 0.01, dMin: 0.04, dMax: 0.8 },
    rockColor: [0.1, 0.1, 0.1],
    sedimentColor: [0.07, 0.07, 0.072],
    soil: "mercuryRegolith",
    fidelity: "hypothetical",
    sources: "No lander yet. Lunar crater/rock statistics assumed; reflectance from MESSENGER MDIS (Denevi et al.).",
    friction: 0.8,
  },
  mercuryShadowed: {
    id: "mercuryShadowed",
    name: "Shadowed polar crater (Prokofiev)",
    note: "Dark, porous lag 10-20 cm thick over water ice, in permanent shadow. Hypothetical: nothing has landed there.",
    body: "mercury",
    plateSize: 0,
    plateThickness: [0, 0],
    plateCoverage: 0,
    layerChance: 0,
    crackWidth: 0,
    tiltDeg: 0,
    sedimentFill: 0,
    slopeDeg: 2,
    boulders: { density: 0, maxWidth: 0, maxHeight: 0 },
    craters: { n1: 0.05, dMin: 0.4, dMax: 24, depthRatio: [0.03, 0.15], farDMax: 600 },
    rocks: { k: 0.008, dMin: 0.04, dMax: 0.6 },
    rockColor: [0.07, 0.07, 0.072],
    sedimentColor: [0.045, 0.045, 0.048],
    soil: "lunarFluffy",
    fidelity: "hypothetical",
    sources: "MESSENGER: radar-bright ice under a 10-20 cm dark (organic-rich) lag (Paige et al. 2013; Neumann et al. 2013). Soil assumed like lunar polar regolith.",
    friction: 0.7,
  },
} as const satisfies Record<string, TerrainStyle>;

export const terrainsFor = (body: BodyId) =>
  Object.values(TERRAINS).filter((t: TerrainStyle) => (t.body ?? "venus") === body || t.id === "flat");

export type TerrainId = keyof typeof TERRAINS;

// ---- Deterministic hashing / noise -------------------------------------------------

function hash2(i: number, j: number, seed: number): number {
  let h = (i * 374761393 + j * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(i, j, seed);
  const b = hash2(i + 1, j, seed);
  const c = hash2(i, j + 1, seed);
  const d = hash2(i + 1, j + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, seed: number, octaves: number): number {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    s += amp * valueNoise(x * f, y * f, seed + o * 17);
    amp *= 0.5;
    f *= 2.03;
  }
  return s;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface TerrainSample {
  /** Height [m]. */
  h: number;
  /** 0 = sediment, 1 = rock plate, 2 = boulder. */
  kind: 0 | 1 | 2;
  /** Per-feature random shade 0..1. */
  shade: number;
  /** Distance to the nearest plate edge [m] (for weathering / crack darkening). */
  edge: number;
  /** Height of the soil surface alone (no plates, rocks or boulders) [m]. h - ground = obstacle height. */
  ground: number;
}

/** Clear radius around the experiment pad that big (far-field) craters keep off [m]. */
const PAD_CLEAR = 12;

export class Terrain {
  readonly style: TerrainStyle;
  readonly seed: number;
  private readonly slope: number;
  private readonly boulderCell: number;

  constructor(style: TerrainStyle, seed = 1982) {
    this.style = style;
    this.seed = seed;
    this.slope = Math.tan((style.slopeDeg * Math.PI) / 180);
    // One candidate boulder per cell; probability sets the density.
    this.boulderCell = style.boulders.density > 0 ? Math.max(style.boulders.maxWidth * 1.4, 0.25) : 0;
    this.rockBins = style.rocks ? rockBins(style.rocks) : [];
    this.craterBins = style.craters ? craterBins(style.craters) : [];
    const c = style.craters;
    this.farCraterBins = c?.farDMax && c.farDMax > c.dMax ? craterBins({ n1: c.n1, dMin: c.dMax, dMax: c.farDMax }) : [];
  }

  private readonly rockBins: Bin[];
  private readonly craterBins: Bin[];
  private readonly farCraterBins: Bin[];

  /**
   * True when the ground is a perfect plane (the physics can use a plane geom).
   * Craters, rocks and ripples all count as relief.
   */
  get isFlat(): boolean {
    const s = this.style;
    return s.plateSize === 0 && s.boulders.density === 0 && s.slopeDeg === 0 && !s.craters && !s.rocks && !s.ripples;
  }

  /** Soil mechanics of this ground. */
  get soil() {
    return SOILS[this.style.soil];
  }

  /**
   * Large-scale ground: the local site slope (Venera 9's talus is a local
   * slope, not a planet-wide tilt, so it levels out beyond ~40 m), gentle
   * decimetre undulation, and metre-scale swells toward the horizon (Magellan
   * shows lowland plains are flat to within tens of metres over kilometres).
   */
  base(x: number, y: number): number {
    const r = Math.hypot(x, y);
    // Smoothly saturating slope: ~slope*x near the site, levelling off ~40 m out.
    const local = this.slope * 40 * Math.tanh(x / 40);
    // The test pad is truly flat near the robot (its physics is a plane).
    const small = this.style.id === "flat" ? 0 : 0.04 * (fbm(x / 3, y / 3, this.seed + 5, 3) - 0.5);
    const swell = 6 * (fbm(x / 400, y / 400, this.seed + 41, 4) - 0.5) * smoothstep(30, 300, r);
    // Small worlds curve away fast: from 1.7 m up, the lunar horizon is only ~2.4 km off
    // (sqrt(2 R h)). Negligible under the robot (<0.1 mm over the physics patch).
    const curve = this.style.body ? (r * r) / (2 * BODIES[this.style.body].radiusM) : 0;
    return local + small + swell - curve;
  }

  sample(x: number, y: number): TerrainSample {
    const s = this.style;
    const base = this.base(x, y);
    const tMean = 0.5 * (s.plateThickness[0] + s.plateThickness[1]);
    // Sediment: fine grains (mm) over a slightly wavy fill level.
    let sediment = s.id === "flat" ? 0 : s.sedimentFill * tMean + 0.006 * (fbm(x / 0.5, y / 0.5, this.seed + 9, 2) - 0.5);
    if (s.id === "venera9") sediment += 0.02 * (fbm(x / 0.15, y / 0.15, this.seed + 21, 2) - 0.5); // coarse gravel
    if (s.ripples) {
      const a = (s.ripples.dirDeg * Math.PI) / 180;
      const u = (x * Math.cos(a) + y * Math.sin(a)) / s.ripples.wavelength + 0.3 * fbm(x / 6, y / 6, this.seed + 61, 2);
      // Asymmetric crest: gentle stoss side, steeper lee.
      const f = u - Math.floor(u);
      sediment += s.ripples.height * (f < 0.7 ? f / 0.7 : (1 - f) / 0.3) * (0.6 + 0.4 * fbm(x / 9, y / 9, this.seed + 62, 2));
    }
    const groundH = sediment;
    let h = sediment;
    let kind: 0 | 1 | 2 = 0;
    let shade = fbm(x * 3, y * 3, this.seed + 3, 2);
    let edge = 1;

    if (s.plateSize > 0) {
      const cs = s.plateSize;
      // Domain warp: real joint patterns are irregular (elongated, curved, mixed sizes), not a honeycomb.
      const wx = x + 0.45 * cs * (fbm(x / (2.2 * cs), y / (2.2 * cs), this.seed + 51, 2) - 0.5);
      const wy = y + 0.45 * cs * (fbm(x / (2.2 * cs), y / (2.2 * cs), this.seed + 52, 2) - 0.5);
      const gx = wx / cs;
      const gy = wy / cs;
      const ci = Math.floor(gx);
      const cj = Math.floor(gy);
      let d1 = Infinity;
      let d2 = Infinity;
      let p1x = 0;
      let p1y = 0;
      let p2x = 0;
      let p2y = 0;
      let i1 = 0;
      let j1 = 0;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          const i = ci + di;
          const j = cj + dj;
          const px = (i + 0.15 + 0.7 * hash2(i, j, this.seed)) * cs;
          const py = (j + 0.15 + 0.7 * hash2(i, j, this.seed + 1)) * cs;
          const d = (wx - px) ** 2 + (wy - py) ** 2;
          if (d < d1) {
            d2 = d1;
            p2x = p1x;
            p2y = p1y;
            d1 = d;
            p1x = px;
            p1y = py;
            i1 = i;
            j1 = j;
          } else if (d < d2) {
            d2 = d;
            p2x = px;
            p2y = py;
          }
        }
      }
      // Exact distance to the Voronoi edge (perpendicular bisector).
      const sep = Math.hypot(p2x - p1x, p2y - p1y) || 1;
      edge = (d2 - d1) / (2 * sep);
      const hasPlate = hash2(i1, j1, this.seed + 2) < s.plateCoverage;
      shade = hash2(i1, j1, this.seed + 3);
      const half = s.crackWidth / 2;
      if (hasPlate && edge > half) {
        const t = s.plateThickness[0] + (s.plateThickness[1] - s.plateThickness[0]) * hash2(i1, j1, this.seed + 4);
        const tilt = Math.tan(((s.tiltDeg * Math.PI) / 180) * hash2(i1, j1, this.seed + 5));
        const ang = 2 * Math.PI * hash2(i1, j1, this.seed + 6);
        let top = t + tilt * (Math.cos(ang) * (wx - p1x) + Math.sin(ang) * (wy - p1y));
        // Subrounded edges: bevel over ~1.5 cm.
        top -= 0.4 * t * (1 - smoothstep(half, half + 0.015, edge));
        // Thin laminae: a second, smaller sheet on some plates.
        if (hash2(i1, j1, this.seed + 7) < s.layerChance) {
          const inset = cs * (0.12 + 0.12 * hash2(i1, j1, this.seed + 8));
          const t2 = 0.008 + 0.012 * hash2(i1, j1, this.seed + 9);
          top += t2 * smoothstep(inset, inset + 0.01, edge);
        }
        // Surface texture of weathered basalt (mm scale).
        top += 0.0025 * (fbm(x / 0.08, y / 0.08, this.seed + 11, 2) - 0.5);
        if (top > h) {
          h = top;
          kind = 1;
        }
      }
    }

    if (this.boulderCell > 0) {
      const b = this.boulder(x, y);
      if (b && b.h > h) {
        h = b.h;
        kind = 2;
        shade = b.shade;
      }
    }

    if (this.rockBins.length) {
      const r = this.rock(x, y);
      if (r && r.h > h) {
        h = r.h;
        kind = 2;
        shade = r.shade;
      }
    }

    const dz = base + (this.craterBins.length ? this.crater(x, y, this.craterBins, false) : 0) + (this.farCraterBins.length ? this.crater(x, y, this.farCraterBins, true) : 0);
    return { h: h + dz, kind, shade, edge, ground: groundH + dz };
  }

  /** Obstacle height above the soil surface at (x, y) [m]: rocks, boulders, plate edges. */
  relief(x: number, y: number): number {
    const s = this.sample(x, y);
    return Math.max(0, s.h - s.ground);
  }

  /** Slope of the soil surface (ignoring rocks) over a baseline of 2*d metres [deg]. */
  slopeDeg(x: number, y: number, d = 0.25): number {
    const g = (u: number, v: number) => this.sample(u, v).ground;
    const gx = (g(x + d, y) - g(x - d, y)) / (2 * d);
    const gy = (g(x, y + d) - g(x, y - d)) / (2 * d);
    return (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI;
  }

  /**
   * Height for the far horizon mesh [m]: regional relief plus the craters big
   * enough to show at tens-of-metres resolution (rocks and small pits are
   * below the mesh spacing).
   */
  farHeight(x: number, y: number, minD = 40): number {
    const s = this.style;
    const tMean = 0.5 * (s.plateThickness[0] + s.plateThickness[1]);
    let h = this.base(x, y) + s.sedimentFill * tMean;
    if (this.craterBins.length) h += this.crater(x, y, this.craterBins, false, minD);
    if (this.farCraterBins.length) h += this.crater(x, y, this.farCraterBins, true, minD);
    return h;
  }

  /** Golombek-Rapp rocks, one size bin at a time. Height above the local ground [m]. */
  private rock(x: number, y: number): { h: number; shade: number } | null {
    let best: { h: number; shade: number } | null = null;
    for (let bi = 0; bi < this.rockBins.length; bi++) {
      const bin = this.rockBins[bi];
      const cs = bin.cell;
      const ci = Math.floor(x / cs);
      const cj = Math.floor(y / cs);
      const sd = this.seed + 101 + bi * 13;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          const i = ci + di;
          const j = cj + dj;
          for (let m = 0; m < bin.perCell; m++) {
            if (hash2(i, j, sd + m * 7) > bin.p) continue;
            const D = bin.sample(hash2(i, j, sd + m * 7 + 1));
            const a = D / 2;
            const bb = a * (0.6 + 0.4 * hash2(i, j, sd + m * 7 + 2));
            const H = D * (0.35 + 0.3 * hash2(i, j, sd + m * 7 + 3));
            const cx = (i + hash2(i, j, sd + m * 7 + 4)) * cs;
            const cy = (j + hash2(i, j, sd + m * 7 + 5)) * cs;
            const rot = Math.PI * hash2(i, j, sd + m * 7 + 6);
            const dx = x - cx;
            const dy = y - cy;
            if (dx * dx + dy * dy > a * a) continue;
            const u = (Math.cos(rot) * dx + Math.sin(rot) * dy) / a;
            const v = (-Math.sin(rot) * dx + Math.cos(rot) * dy) / bb;
            const q = Math.abs(u) ** 3 + Math.abs(v) ** 3;
            if (q >= 1) continue;
            const facet = 0.85 + 0.3 * valueNoise(u * 2.5 + i, v * 2.5 + j, sd + 5);
            const hb = H * Math.pow(1 - q, 0.35) * facet - 0.2 * H;
            if (!best || hb > best.h) best = { h: hb, shade: hash2(i, j, sd + m * 7 + 8) };
          }
        }
      }
    }
    return best;
  }

  /**
   * Sum of simple-crater profiles (bowl + rim + ejecta falloff) [m].
   * `far` bins use their own seeds and skip craters whose ejecta would reach the pad;
   * `minD` drops craters too small to resolve (far mesh).
   */
  private crater(x: number, y: number, bins: Bin[], far: boolean, minD = 0): number {
    const c = this.style.craters!;
    let dz = 0;
    for (let bi = 0; bi < bins.length; bi++) {
      const bin = bins[bi];
      if (bin.dMax < minD) continue;
      const cs = bin.cell;
      const ci = Math.floor(x / cs);
      const cj = Math.floor(y / cs);
      const sd = this.seed + (far ? 701 : 301) + bi * 17;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          const i = ci + di;
          const j = cj + dj;
          for (let m = 0; m < bin.perCell; m++) {
            if (hash2(i, j, sd + m * 5) > bin.p) continue;
            const D = bin.sample(hash2(i, j, sd + m * 5 + 1));
            const R = D / 2;
            const cx = (i + hash2(i, j, sd + m * 5 + 2)) * cs;
            const cy = (j + hash2(i, j, sd + m * 5 + 3)) * cs;
            if (D < minD) continue;
            const r = Math.hypot(x - cx, y - cy);
            if (r > 1.6 * R) continue;
            if (far && Math.hypot(cx, cy) < 1.6 * R + PAD_CLEAR) continue;
            // Most craters are old and shallow; a few are fresh bowls.
            const fresh = hash2(i, j, sd + m * 5 + 4) ** 2.5;
            const dr = c.depthRatio[0] + (c.depthRatio[1] - c.depthRatio[0]) * fresh;
            const depth = dr * D;
            const rim = 0.18 * depth;
            const rr = r / R;
            let z: number;
            if (rr < 1) z = rim - depth + depth * rr ** 2 * (0.6 + 0.4 * rr ** 2);
            else z = rim * rr ** -3 * (1 - smoothstep(1.2, 1.6, rr));
            // Soften the rim crest on degraded craters.
            if (rr > 0.85 && rr < 1.15) z = z * (1 - 0.5 * (1 - fresh)) + rim * 0.5 * (1 - fresh) * (1 - Math.abs(rr - 1) / 0.15);
            dz += z;
          }
        }
      }
    }
    return dz;
  }

  height(x: number, y: number): number {
    return this.sample(x, y).h;
  }

  /** Subangular boulders: superellipsoid caps with a random footprint and rotation. */
  private boulder(x: number, y: number): { h: number; shade: number } | null {
    const s = this.style.boulders;
    const cs = this.boulderCell;
    const ci = Math.floor(x / cs);
    const cj = Math.floor(y / cs);
    let best: { h: number; shade: number } | null = null;
    const p = s.density * cs * cs; // expected boulders per cell
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const i = ci + di;
        const j = cj + dj;
        if (hash2(i, j, this.seed + 30) > p) continue;
        // Size distribution skewed to small blocks (power law-ish).
        const size = Math.pow(hash2(i, j, this.seed + 31), 1.5);
        const w = Math.max(0.03, s.maxWidth * size);
        const a = w / 2;
        const bb = a * (0.55 + 0.45 * hash2(i, j, this.seed + 32));
        const H = Math.max(0.01, s.maxHeight * size * (0.6 + 0.4 * hash2(i, j, this.seed + 33)));
        const cx = (i + hash2(i, j, this.seed + 34)) * cs;
        const cy = (j + hash2(i, j, this.seed + 35)) * cs;
        const r = Math.PI * hash2(i, j, this.seed + 36);
        const dx = x - cx;
        const dy = y - cy;
        const u = (Math.cos(r) * dx + Math.sin(r) * dy) / a;
        const v = (-Math.sin(r) * dx + Math.cos(r) * dy) / bb;
        const q = Math.abs(u) ** 3.5 + Math.abs(v) ** 3.5; // subangular footprint
        if (q >= 1) continue;
        // Faceted top: coarse noise so blocks look broken, not smooth.
        const facet = 0.85 + 0.3 * valueNoise(u * 2.5 + i, v * 2.5 + j, this.seed + 37);
        const hb = H * Math.pow(1 - q, 0.3) * facet - 0.25 * H; // partly buried
        if (!best || hb > best.h) best = { h: hb, shade: hash2(i, j, this.seed + 38) };
      }
    }
    return best;
  }

  /**
   * Sample a square grid centred on (cx, cy): n x n points spanning [-half, half].
   * Row-major, row index along +y (MuJoCo hfield convention).
   */
  grid(cx: number, cy: number, half: number, n: number): Float32Array {
    const out = new Float32Array(n * n);
    const step = (2 * half) / (n - 1);
    for (let r = 0; r < n; r++) {
      const y = cy - half + r * step;
      for (let c = 0; c < n; c++) out[r * n + c] = this.height(cx - half + c * step, y);
    }
    return out;
  }
}

interface Bin {
  cell: number;
  /** Largest feature in the bin [m]. */
  dMax: number;
  /** Candidates per cell and the chance each one exists. */
  perCell: number;
  p: number;
  /** Diameter from a uniform random number. */
  sample: (u: number) => number;
}

/** Split a number density into log-spaced size bins with a cell grid each (3x3 search must cover a feature). */
function makeBins(dMin: number, dMax: number, count: (d1: number, d2: number) => number, reach: number, sample: (d1: number, d2: number, u: number) => number): Bin[] {
  const bins: Bin[] = [];
  const nb = Math.max(1, Math.round(Math.log(dMax / dMin) / Math.log(2.2)));
  for (let b = 0; b < nb; b++) {
    const d1 = dMin * (dMax / dMin) ** (b / nb);
    const d2 = dMin * (dMax / dMin) ** ((b + 1) / nb);
    const n = count(d1, d2); // per m^2
    if (n <= 0) continue;
    const cell = Math.max(reach * d2, 0.05);
    const expected = n * cell * cell;
    const perCell = Math.max(1, Math.ceil(expected / 0.8));
    bins.push({ cell, dMax: d2, perCell, p: expected / perCell, sample: (u) => sample(d1, d2, u) });
  }
  return bins;
}

function rockBins(r: { k: number; dMin: number; dMax: number }): Bin[] {
  const q = 1.79 + 0.152 / r.k;
  // Number density from F(D) = k exp(-qD): n(D) dD = k q exp(-qD) / (pi D^2 / 4) dD.
  const count = (d1: number, d2: number) => {
    let s = 0;
    const steps = 40;
    for (let i = 0; i < steps; i++) {
      const d = d1 + ((d2 - d1) * (i + 0.5)) / steps;
      s += ((r.k * q * Math.exp(-q * d)) / ((Math.PI * d * d) / 4)) * ((d2 - d1) / steps);
    }
    return s;
  };
  // Within a bin the 1/D^2 term dominates: inverse CDF of D^-2.
  return makeBins(r.dMin, r.dMax, count, 0.55, (d1, d2, u) => 1 / (1 / d1 - u * (1 / d1 - 1 / d2)));
}

function craterBins(c: { n1: number; dMin: number; dMax: number }): Bin[] {
  return makeBins(c.dMin, c.dMax, (d1, d2) => c.n1 * (d1 ** -2 - d2 ** -2), 0.8, (d1, d2, u) => (d1 ** -2 - u * (d1 ** -2 - d2 ** -2)) ** -0.5);
}

export function terrain(id: TerrainId, seed?: number): Terrain {
  return new Terrain(TERRAINS[id], seed);
}
