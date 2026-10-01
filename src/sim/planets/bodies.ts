/**
 * Planetary bodies other than Venus's atmosphere model: orbit, spin,
 * gravity, regolith and landing sites. Venus is listed too so every body
 * can be handled the same way, but its environment still comes from VIRA
 * (env/atmosphere.ts).
 *
 * Sources:
 * - Radii, GM, orbits, spin: NASA/NSSDCA planetary fact sheets (2024).
 * - Solar constant at 1 AU: 1361 W/m^2 (Kopp & Lean 2011).
 * - Moon regolith: Hayne et al. 2017 (JGR Planets 122, "Global regolith
 *   thermophysical properties of the Moon from Diviner"), the parameters of
 *   their heat1d model.
 * - Mercury regolith: lunar-like (Vasavada, Paige & Wood 1999, Icarus 141),
 *   with Mercury's lower albedo (Mallama et al. 2002).
 * - Mars: Viking/REMS surface pressure, MGS TES/THEMIS thermal inertia and
 *   albedo per site (Fergason et al. 2006, 2012; Hamilton et al. 2014).
 */
import type { TerrainId } from "../terrain/terrain";

export type BodyId = "venus" | "moon" | "mars" | "mercury";

export const AU = 1.495978707e11;
export const SOLAR_CONSTANT_1AU = 1361; // W/m^2 (Kopp & Lean 2011)
const DAY = 86_400;

/** Thermophysical model of the top metre of the surface (see regolith.ts). */
export interface RegolithParams {
  /** Normal-incidence bolometric Bond albedo. */
  albedo: number;
  /** Incidence dependence A(i) = A0 + a (i/45°)^3 + b (i/90°)^8 (Keihm 1984, Hayne 2017). 0 for Mars. */
  albedoA: number;
  albedoB: number;
  emissivity: number;
  /** Density at the surface and at depth, e-folding scale H [kg/m^3, m]. */
  rhoS: number;
  rhoD: number;
  hM: number;
  /** Contact conductivity at the surface and at depth [W/m/K]. */
  kS: number;
  kD: number;
  /** Radiative conductivity: k = kc (1 + chi (T/350)^3). */
  chi: number;
  /** Heat capacity: "lunar" = Hemingway/Ledlow polynomial, otherwise constant [J/kg/K]. */
  cp: "lunar" | number;
  /** Interior heat flow [W/m^2]. */
  geothermalWm2: number;
}

export interface Body {
  id: BodyId;
  name: string;
  radiusM: number;
  gm: number;
  surfaceGravity: number;
  /** Mean solar day (sunrise to sunrise) [s]. */
  solarDayS: number;
  /** Heliocentric orbit (for Mercury, the whole day/night pattern follows from it). */
  orbit: { aAU: number; e: number; periodS: number };
  /** Sidereal rotation period [s] (only used where the orbit matters within a day: Mercury). */
  siderealDayS: number;
  obliquityDeg: number;
  atmosphere: "venus" | "mars" | "none";
  regolith: RegolithParams;
  /** Longest experiment we run on this body [s]. */
  maxDurationS: number;
  /** Colour hint for the UI. */
  accent: string;
  blurb: string;
}

/** Lunar regolith, Hayne et al. 2017 (Diviner global fit). */
const LUNAR_REGOLITH: RegolithParams = {
  albedo: 0.12,
  albedoA: 0.06,
  albedoB: 0.25,
  emissivity: 0.95,
  rhoS: 1100,
  rhoD: 1800,
  hM: 0.06,
  kS: 7.4e-4,
  kD: 3.4e-3,
  chi: 2.7,
  cp: "lunar",
  geothermalWm2: 0.018,
};

export const BODIES: Record<BodyId, Body> = {
  venus: {
    id: "venus",
    name: "Venus",
    radiusM: 6_051_800,
    gm: 3.24859e14,
    surfaceGravity: 8.87,
    solarDayS: 116.75 * DAY,
    orbit: { aAU: 0.723332, e: 0.006772, periodS: 224.701 * DAY },
    siderealDayS: -243.025 * DAY,
    obliquityDeg: 177.36,
    atmosphere: "venus",
    // Not used: the Venus surface is set by the atmosphere, not by sunlight.
    regolith: { ...LUNAR_REGOLITH, albedo: 0.1 },
    maxDurationS: 60 * DAY,
    accent: "#f59e0b",
    blurb: "737 K · 92 bar · CO₂",
  },
  moon: {
    id: "moon",
    name: "Moon",
    radiusM: 1_737_400,
    gm: 4.9048695e12,
    surfaceGravity: 1.62,
    solarDayS: 29.530589 * DAY,
    orbit: { aAU: 1, e: 0, periodS: 365.256 * DAY },
    siderealDayS: 27.321661 * DAY,
    // Spin axis vs the ecliptic: the Sun never gets more than 1.54° above a pole's horizon.
    obliquityDeg: 1.543,
    atmosphere: "none",
    regolith: LUNAR_REGOLITH,
    // Three lunar days: long enough to see whether it survives two nights.
    maxDurationS: 90 * DAY,
    accent: "#a8a29e",
    blurb: "Vacuum · 1.62 m/s² · −170 to +120 °C",
  },
  mars: {
    id: "mars",
    name: "Mars",
    radiusM: 3_389_500,
    gm: 4.282837e13,
    surfaceGravity: 3.72,
    solarDayS: 88_775.24,
    orbit: { aAU: 1.52368, e: 0.0934, periodS: 686.98 * DAY },
    siderealDayS: 88_642.66,
    obliquityDeg: 25.19,
    atmosphere: "mars",
    // Default site values; sites override albedo and thermal inertia.
    regolith: marsRegolith(0.22, 300),
    maxDurationS: 60 * 88_775.24,
    accent: "#ea580c",
    blurb: "6 mbar CO₂ · 3.72 m/s² · dust",
  },
  mercury: {
    id: "mercury",
    name: "Mercury",
    radiusM: 2_439_700,
    gm: 2.2032e13,
    surfaceGravity: 3.7,
    // 3:2 spin-orbit resonance: one solar day = two orbits = three rotations.
    solarDayS: 175.9408 * DAY,
    orbit: { aAU: 0.387098, e: 0.20563, periodS: 87.9691 * DAY },
    siderealDayS: 58.6462 * DAY,
    obliquityDeg: 0.034,
    atmosphere: "none",
    // Lunar-like regolith, darker (Vasavada 1999; Mallama 2002 Bond albedo ~0.07-0.09).
    regolith: { ...LUNAR_REGOLITH, albedo: 0.07 },
    // Sunrise to the next sunrise takes 176 days; one full day is enough.
    maxDurationS: 176 * DAY,
    accent: "#94a3b8",
    blurb: "Vacuum · 3.70 m/s² · −180 to +430 °C",
  },
};

/**
 * Mars regolith from thermal inertia I = sqrt(k rho c). We keep density and
 * heat capacity typical of Martian fines (Fergason 2006: rho ~1600,
 * c ~ 800) and derive conductivity; no depth structure.
 */
export function marsRegolith(albedo: number, thermalInertia: number): RegolithParams {
  const rho = 1600;
  const c = 800;
  const k = (thermalInertia * thermalInertia) / (rho * c);
  return {
    albedo,
    albedoA: 0,
    albedoB: 0,
    emissivity: 0.98,
    rhoS: rho,
    rhoD: rho,
    hM: 1,
    kS: k,
    kD: k,
    chi: 0,
    cp: c,
    geothermalWm2: 0.02,
  };
}

export interface PlanetSite {
  id: string;
  body: Exclude<BodyId, "venus">;
  name: string;
  latDeg: number;
  /** East longitude. Matters on Mercury (hot vs warm longitudes). */
  lonDeg: number;
  /** Relative to the reference radius / Mars areoid [m]. */
  elevationM: number;
  ground: TerrainId;
  note: string;
  /** Replaces the body's regolith parameters (Mars sites). */
  regolith?: RegolithParams;
  /**
   * Permanently shadowed crater floor: no sunlight ever, only the infrared
   * glow of the sunlit crater walls [W/m^2]. Tuned to the measured floor
   * temperature (Diviner: Paige et al. 2010; Mercury: Paige et al. 2013).
   */
  shadowed?: { wallIrWm2: number };
  /** Sun's declination for this scenario [deg] (Moon: season; ignored on Mars, which uses Ls). */
  declinationDeg?: number;
}

export const PLANET_SITES: PlanetSite[] = [
  // ---- Moon ------------------------------------------------------------------
  {
    id: "apollo11",
    body: "moon",
    name: "Apollo 11 · Mare Tranquillitatis",
    latDeg: 0.67,
    lonDeg: 23.47,
    elevationM: -1_900,
    ground: "lunarMare",
    note: "Equatorial mare. Noon ground ~120 °C, night ~−180 °C, 14.8 Earth days each (Diviner).",
  },
  {
    id: "lunokhod1",
    body: "moon",
    name: "Lunokhod 1 · Mare Imbrium",
    latDeg: 38.24,
    lonDeg: -35.0,
    elevationM: -2_500,
    ground: "lunarMare",
    note: "Where Luna 17 set down the first planetary rover in November 1970. Mid-latitude mare: hot noons, −170 °C nights.",
  },
  {
    id: "change4",
    body: "moon",
    name: "Chang'e 4 · Von Kármán crater (far side)",
    latDeg: -45.44,
    lonDeg: 177.6,
    elevationM: -5_900,
    ground: "lunarMare",
    note: "Yutu-2's site. Nights reach −190 °C at the surface; the rover sleeps through every one.",
  },
  {
    id: "chandrayaan3",
    body: "moon",
    name: "Chandrayaan-3 · Shiv Shakti point",
    latDeg: -69.37,
    lonDeg: 32.32,
    elevationM: 0,
    ground: "lunarHighlands",
    note: "Pragyan's site, high southern latitude: low Sun even at noon (~20° up), long cold shadows.",
  },
  {
    id: "southPoleRidge",
    body: "moon",
    name: "South pole ridge (Artemis region, summer)",
    latDeg: -89.45,
    lonDeg: 222,
    elevationM: 1_900,
    ground: "lunarHighlands",
    declinationDeg: -1.5,
    note: "Southern summer: the Sun circles 1-2° above the horizon and never sets. Flat-horizon approximation; real ridges get shadowed by distant peaks part of the time.",
  },
  {
    id: "shackletonFloor",
    body: "moon",
    name: "Shackleton crater floor (permanent shadow)",
    latDeg: -89.66,
    lonDeg: 129.2,
    elevationM: -2_000,
    ground: "lunarHighlands",
    shadowed: { wallIrWm2: 0.3 },
    note: "No sunlight for billions of years. Floor ~45 K (−228 °C), cold enough to trap water ice.",
  },
  // ---- Mars ------------------------------------------------------------------
  {
    id: "gale",
    body: "mars",
    name: "Gale crater · Curiosity",
    latDeg: -4.59,
    lonDeg: 137.44,
    elevationM: -4_500,
    ground: "marsGale",
    regolith: marsRegolith(0.22, 300),
    note: "Rocky, gravelly crater floor. REMS: ground ~−90 to +20 °C over a sol, ~750-900 Pa.",
  },
  {
    id: "jezero",
    body: "mars",
    name: "Jezero crater · Perseverance",
    latDeg: 18.44,
    lonDeg: 77.45,
    elevationM: -2_600,
    ground: "marsRocky",
    regolith: marsRegolith(0.18, 330),
    note: "Ancient lake bed and delta, rock-strewn floor. MEDA air temperatures ~−85 to −5 °C.",
  },
  {
    id: "meridiani",
    body: "mars",
    name: "Meridiani Planum · Opportunity",
    latDeg: -1.95,
    lonDeg: 354.47,
    elevationM: -1_400,
    ground: "marsMeridiani",
    regolith: marsRegolith(0.13, 200),
    note: "Flat, dark basaltic sand ripples over sulfate bedrock; almost no rocks. Opportunity drove 45 km here.",
  },
  {
    id: "olympus",
    body: "mars",
    name: "Olympus Mons summit",
    latDeg: 18.65,
    lonDeg: 226.2,
    elevationM: 21_200,
    ground: "marsGale",
    regolith: marsRegolith(0.25, 120),
    note: "Highest point in the Solar System: ~0.8 mbar, a tenth of the air at Gale. No lander has been.",
  },
  {
    id: "hellas",
    body: "mars",
    name: "Hellas basin floor",
    latDeg: -42.4,
    lonDeg: 70.5,
    elevationM: -7_150,
    ground: "marsRocky",
    regolith: marsRegolith(0.22, 300),
    note: "Deepest point on Mars: the thickest air anywhere (~11-12 mbar).",
  },
  // ---- Mercury ---------------------------------------------------------------
  {
    id: "mercuryHot",
    body: "mercury",
    name: "Equator, hot longitude (0°)",
    latDeg: 0,
    lonDeg: 0,
    elevationM: 0,
    ground: "mercuryPlains",
    note: "Noon falls at perihelion: ground reaches ~430 °C. Nights last 88 Earth days and fall to ~−170 °C.",
  },
  {
    id: "mercuryWarm",
    body: "mercury",
    name: "Equator, warm longitude (90°E)",
    latDeg: 0,
    lonDeg: 90,
    elevationM: 0,
    ground: "mercuryPlains",
    note: "Noon falls at aphelion, ~300 °C. Near perihelion the Sun stops and backs up in the sky for a few days.",
  },
  {
    id: "mercury70N",
    body: "mercury",
    name: "70°N, hot longitude",
    latDeg: 70,
    lonDeg: 0,
    elevationM: 0,
    ground: "mercuryPlains",
    note: "Here the day-night line moves at 0.34 m/s (1.2 km/h): a slow rover can keep pace with the dawn indefinitely.",
  },
  {
    id: "prokofiev",
    body: "mercury",
    name: "Prokofiev crater floor (shadowed ice)",
    latDeg: 85.7,
    lonDeg: 297.3,
    elevationM: -2_000,
    ground: "mercuryPlains",
    shadowed: { wallIrWm2: 5.6 },
    note: "Permanently shadowed polar crater where MESSENGER found water ice under dark organics. Floor ~−170 °C.",
  },
];

export const sitesFor = (body: BodyId) => PLANET_SITES.filter((s) => s.body === body);
export const siteById = (id: string) => PLANET_SITES.find((s) => s.id === id);

/** Gravity at elevation above the reference radius. */
export function gravityAt(body: Body, elevationM: number): number {
  const r = body.radiusM + elevationM;
  return body.gm / (r * r);
}
