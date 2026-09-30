/**
 * Where the Sun is in a site's sky, and how strong it is, at any moment.
 *
 * Moon and Mars use a mean Sun: the hour angle advances uniformly with the
 * solar day and the Sun's declination and distance are held for the run
 * (a run is at most a few lunar days or ~60 sols, over which the season
 * barely moves). Mars takes both from the season Ls:
 *   sin(dec) = sin(obliquity) sin(Ls)                      (Allison 1997)
 *   r = a (1 - e^2) / (1 + e cos(Ls - 251°))               (perihelion at Ls 251°)
 *
 * Mercury can't be done that way. Its 3:2 spin-orbit resonance makes one
 * solar day last two orbits, and near perihelion the orbital motion
 * outruns the spin, so the Sun stops and backs up in the sky for a few
 * days. We solve Kepler's equation instead:
 *   H(t) = omega_spin * t - nu(t) + longitude,   r(t) = a (1 - e^2) / (1 + e cos nu)
 * with t measured from perihelion. Longitude 0° (and 180°) has noon at
 * perihelion: the "hot poles" (Soter & Ulrichs 1967).
 */
import { AU, SOLAR_CONSTANT_1AU, type Body, type PlanetSite } from "./bodies";

const DEG = Math.PI / 180;
export const MARS_LS_PERIHELION = 251;

export interface SunState {
  /** Local solar time [h], 12 = noon. */
  localHour: number;
  elevationDeg: number;
  /** From north through east [deg]. */
  azimuthDeg: number;
  /** Cosine of the solar zenith angle, clamped at 0 when the Sun is down. */
  mu: number;
  distanceAU: number;
  /** Top-of-atmosphere flux on a surface facing the Sun [W/m^2]. */
  fluxNormal: number;
}

export interface SolarClock {
  body: Body;
  site: PlanetSite;
  /** Mars season (areocentric solar longitude) [deg]. */
  lsDeg: number;
}

/** Solve Kepler's equation M = E - e sin E and return the true anomaly. */
export function trueAnomaly(meanAnomaly: number, e: number): number {
  let E = meanAnomaly + e * Math.sin(meanAnomaly);
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - meanAnomaly) / (1 - e * Math.cos(E));
  return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
}

function declinationAndDistance(c: SolarClock): { dec: number; rAU: number } {
  const { body, site } = c;
  if (body.id === "mars") {
    const ls = c.lsDeg * DEG;
    const { aAU, e } = body.orbit;
    return {
      dec: Math.asin(Math.sin(body.obliquityDeg * DEG) * Math.sin(ls)),
      rAU: (aAU * (1 - e * e)) / (1 + e * Math.cos(ls - MARS_LS_PERIHELION * DEG)),
    };
  }
  return { dec: (site.declinationDeg ?? 0) * DEG, rAU: body.orbit.aAU };
}

/** Hour angle [rad] and heliocentric distance at clock time tau [s]. */
function hourAngle(c: SolarClock, tau: number): { H: number; rAU: number; dec: number } {
  const { body } = c;
  if (body.id === "mercury") {
    const { aAU, e, periodS } = body.orbit;
    const M = ((2 * Math.PI) / periodS) * tau;
    const nu = trueAnomaly(M, e);
    const spin = ((2 * Math.PI) / body.siderealDayS) * tau;
    // Unwrap nu so it grows with M (atan2 folds it into -pi..pi).
    const nuCont = nu + 2 * Math.PI * Math.round((M - nu) / (2 * Math.PI));
    return { H: spin - nuCont + c.site.lonDeg * DEG, rAU: (aAU * (1 - e * e)) / (1 + e * Math.cos(nu)), dec: 0 };
  }
  const { dec, rAU } = declinationAndDistance(c);
  // Mean Sun: tau = 0 is local midnight.
  return { H: 2 * Math.PI * (tau / body.solarDayS) - Math.PI, rAU, dec };
}

export function sunAt(c: SolarClock, tau: number): SunState {
  const { H, rAU, dec } = hourAngle(c, tau);
  const lat = c.site.latDeg * DEG;
  const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const az = Math.atan2(-Math.cos(dec) * Math.sin(H), Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(H));
  const wrapped = (((H / (2 * Math.PI)) % 1) + 1) % 1;
  return {
    localHour: (wrapped * 24 + 12) % 24,
    elevationDeg: el / DEG,
    azimuthDeg: ((az / DEG) + 360) % 360,
    mu: Math.max(0, sinEl),
    distanceAU: rAU,
    fluxNormal: c.site.shadowed ? 0 : SOLAR_CONSTANT_1AU / (rAU * rAU),
  };
}

/**
 * Clock time [s] at which the site first sees the given local hour. For the
 * mean Sun that's exact; for Mercury we scan the solar day (the hour is not
 * monotonic near perihelion, so we take the first crossing).
 */
export function clockForLocalHour(c: SolarClock, hour: number): number {
  const P = c.body.solarDayS;
  if (c.body.id !== "mercury") return ((((hour / 24) % 1) + 1) % 1) * P;
  const n = 4000;
  let prev = sunAt(c, 0).localHour;
  for (let i = 1; i <= n; i++) {
    const tau = (P * i) / n;
    const h = sunAt(c, tau).localHour;
    // Crossing, handling the 24 -> 0 wrap.
    const d0 = ((hour - prev + 36) % 24) - 12;
    const d1 = ((hour - h + 36) % 24) - 12;
    if (d0 > 0 && d1 <= 0) return tau;
    prev = h;
  }
  return 0;
}

/** Ground speed of the day-night line at the site [m/s] (Mercury's is walking pace near the poles). */
export function terminatorSpeed(c: SolarClock): number {
  return (2 * Math.PI * c.body.radiusM * Math.cos(c.site.latDeg * DEG)) / c.body.solarDayS;
}

export { AU };
