/**
 * Venus atmosphere as a function of altitude.
 *
 * Structure (T, P, rho) comes from VIRA (Seiff et al. 1985), low latitudes.
 * P and rho are interpolated in log space, T linearly. Above 100 km we hold
 * the top row (the MVP never goes there).
 *
 * Other fields are engineering approximations, labelled as such:
 * - surface wind: Venera 9/10/13 anemometers measured 0.3-1.0 m/s.
 * - solar flux reaching altitude z at the subsolar point: rough fit to the
 *   Pioneer Venus LSFR / Venera photometer profiles (Tomasko et al. 1980),
 *   only ~2-5% of top-of-atmosphere sunlight reaches the ground.
 * - radiative environment: below the cloud base the atmosphere is optically
 *   thick in the thermal IR, so a body "sees" blackbody radiation at roughly
 *   the local air temperature. Above that we use an effective sky temperature
 *   from the Crisp (1989) / Haus (2015) fluxes.
 */
import { SIGMA, VENUS } from "../constants";
import { VIRA_LOW } from "../data/vira";
import { co2Props, type GasProps } from "./co2";

export interface AtmosphereSample {
  altitudeM: number;
  temperatureK: number;
  pressurePa: number;
  densityKgM3: number;
  gravity: number;
  /** Effective radiative temperature of the surroundings [K]. */
  radiantK: number;
  /** Direct+diffuse solar flux on a horizontal surface at subsolar noon [W/m^2]. */
  solarSubsolarWm2: number;
  gas: GasProps;
}

const ALT = VIRA_LOW.map((r) => r[0] * 1000);
const LOG_RHO = VIRA_LOW.map((r) => Math.log(r[1]));
const LOG_P = VIRA_LOW.map((r) => Math.log(r[2]));
const TEMP = VIRA_LOW.map((r) => r[3]);

function bracket(z: number): [number, number] {
  if (z <= ALT[0]) return [0, 0];
  const last = ALT.length - 1;
  if (z >= ALT[last]) return [last, 0];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ALT[mid] <= z) lo = mid;
    else hi = mid;
  }
  return [lo, (z - ALT[lo]) / (ALT[lo + 1] - ALT[lo])];
}

const interp = (arr: number[], i: number, f: number) =>
  f === 0 ? arr[i] : arr[i] + (arr[i + 1] - arr[i]) * f;

/** Solar flux vs altitude at the subsolar point [km, W/m^2]. Approximate. */
const SOLAR_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0, 120],
  [10, 160],
  [20, 220],
  [30, 320],
  [40, 450],
  [48, 600],
  [55, 1000],
  [60, 1400],
  [65, 1900],
  [70, 2300],
  [80, 2550],
  [100, VENUS.solarConstantTop],
];

/** Up+down IR flux (Crisp 1989, Haus 2015) -> effective radiant temperature. */
const IR_PROFILE: ReadonlyArray<readonly [number, number, number]> = [
  [48, 1200, 1000],
  [53, 600, 400],
  [55, 450, 250],
  [60, 280, 80],
  [65, 200, 15],
  [70, 160, 0],
  [100, 150, 0],
];

function table1d(t: ReadonlyArray<readonly number[]>, x: number, col = 1) {
  if (x <= t[0][0]) return t[0][col];
  for (let i = 0; i < t.length - 1; i++) {
    if (x <= t[i + 1][0]) {
      const f = (x - t[i][0]) / (t[i + 1][0] - t[i][0]);
      return t[i][col] + (t[i + 1][col] - t[i][col]) * f;
    }
  }
  return t[t.length - 1][col];
}

export function atmosphere(altitudeM: number): AtmosphereSample {
  const [i, f] = bracket(altitudeM);
  const temperatureK = interp(TEMP, i, f);
  const pressurePa = Math.exp(interp(LOG_P, i, f));
  const densityKgM3 = Math.exp(interp(LOG_RHO, i, f));
  const r = VENUS.radius + altitudeM;
  const gravity = VENUS.gm / (r * r);
  const km = altitudeM / 1000;

  let radiantK = temperatureK;
  if (km > 48) {
    const up = table1d(IR_PROFILE, km, 1);
    const down = table1d(IR_PROFILE, km, 2);
    // A body in the clouds sees warm cloud/lower atmosphere below and cold sky above.
    const effective = Math.pow((up + down) / 2 / SIGMA, 0.25);
    const blend = Math.min(1, (km - 48) / 7);
    radiantK = temperatureK * (1 - blend) + effective * blend;
  }

  return {
    altitudeM,
    temperatureK,
    pressurePa,
    densityKgM3,
    gravity,
    radiantK,
    solarSubsolarWm2: table1d(SOLAR_PROFILE, km),
    gas: co2Props(temperatureK, pressurePa),
  };
}

/** Named surface sites. Elevations relative to mean planetary radius. */
export const SITES = [
  { id: "plains", name: "Mean plains", elevationM: 0, note: "Most of Venus looks like this: basalt plains, 464 °C." },
  { id: "venera13", name: "Venera 13 site (Phoebe Regio)", elevationM: 1_500, note: "7.5°S 303°E, where Venera 13 lasted 127 minutes. Elevation approximate." },
  { id: "lowland", name: "Atalanta Planitia lowland", elevationM: -1_400, note: "One of the deepest lowlands: hottest, densest air." },
  { id: "maxwell", name: "Maxwell Montes summit", elevationM: 10_800, note: "Highest point on Venus: ~380 °C, ~45 bar." },
] as const;

export type SiteId = (typeof SITES)[number]["id"];
