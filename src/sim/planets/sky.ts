/**
 * The real sky over a site: which way the stars, Earth, Phobos and Deimos
 * sit, consistent with the sim's own Sun.
 *
 * Everything is done in the J2000 equatorial frame of the star catalogue
 * (x to the vernal equinox, z to Earth's north celestial pole). Two
 * directions fix the rotation from there to the local sky (east, north, up):
 *
 * - the body's spin axis: IAU pole (Archinal et al. 2018, "Report of the
 *   IAU WGCCRE: 2015", Celest. Mech. Dyn. Astr. 130:22), which locally sits
 *   due north at an elevation equal to the site latitude;
 * - the Sun: its J2000 direction from the body's orbit, and its local
 *   azimuth/elevation from the sim (planets/solar.ts).
 *
 * So the Sun in the 3D view is always where the thermal sim put it, and the
 * constellations around it are the ones really behind it at that season.
 *
 * Orbits: JPL "Keplerian elements for approximate positions of the major
 * planets" (Standish, J2000 ecliptic, valid 1800-2050). Martian moons: JPL
 * planetary satellite mean elements (Jacobson 2010) and NSSDCA fact sheets.
 */
import type { Body, BodyId } from "./bodies";

const DEG = Math.PI / 180;
export type Vec3 = [number, number, number];
/** Row-major 3x3. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** Obliquity of the ecliptic at J2000 (IAU 2006): 84381.406". */
const EPS_EARTH = 23.439279 * DEG;

/**
 * Spin-axis direction at J2000 [RA, Dec in deg] (Archinal 2018, epoch terms).
 * Moon: the mean IAU pole sits on the ecliptic pole; the real one circles it
 * at 1.54° every 18.6 years (Cassini state). We take the two main periodic
 * terms (E1, E2) at the J2000 epoch, which gives the right 1.54° tilt.
 */
const POLES: Record<BodyId, [number, number]> = {
  venus: [272.76, 67.16],
  moon: [266.9326, 65.6457],
  // IAU 2009 (Archinal et al. 2011) epoch values: the 2015 constants move a ~1.5° slow
  // periodic term into the series, so they alone don't give the 25.19° obliquity.
  mars: [317.68143, 52.8865],
  mercury: [281.0103, 61.4155],
};

/** Heliocentric orbit orientation in the J2000 ecliptic [deg] (Standish). Moon: Earth's orbit. */
const ORBITS: Record<BodyId, { i: number; node: number; peri: number }> = {
  venus: { i: 3.39467605, node: 76.67984255, peri: 131.60246718 },
  moon: { i: 0, node: 0, peri: 102.93768193 },
  mars: { i: 1.84969142, node: 49.55953891, peri: -23.94362959 },
  mercury: { i: 7.00497902, node: 48.33076593, peri: 77.45779628 },
};

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));

export function radec(raDeg: number, decDeg: number): Vec3 {
  const a = raDeg * DEG;
  const d = decDeg * DEG;
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
}

/** J2000 ecliptic -> J2000 equatorial. */
function eclToEq([x, y, z]: Vec3): Vec3 {
  const c = Math.cos(EPS_EARTH);
  const s = Math.sin(EPS_EARTH);
  return [x, c * y - s * z, s * y + c * z];
}

export function poleJ2000(body: BodyId): Vec3 {
  return radec(...POLES[body]);
}

/** Normal of the body's orbital plane (the Sun's apparent path in its sky), J2000 equatorial. */
export function orbitNormalJ2000(body: BodyId): Vec3 {
  const { i, node } = ORBITS[body];
  const I = i * DEG;
  const O = node * DEG;
  return eclToEq([Math.sin(I) * Math.sin(O), -Math.sin(I) * Math.cos(O), Math.cos(I)]);
}

/** Angle between spin axis and orbit normal [deg]: the obliquity, as a check on the tables. */
export function obliquityDeg(body: BodyId): number {
  return Math.acos(dot(poleJ2000(body), orbitNormalJ2000(body))) / DEG;
}

/**
 * Sun direction from the body, given its longitude along the Sun's apparent
 * path measured from the body's own vernal equinox (Mars: this is Ls).
 */
export function sunFromSeasonJ2000(body: BodyId, lsDeg: number): Vec3 {
  const P = poleJ2000(body);
  const N = orbitNormalJ2000(body);
  // Equinox: where the Sun crosses the equator northward, in both planes.
  const e1 = norm(cross(P, N));
  const e2 = cross(N, e1);
  const L = lsDeg * DEG;
  return norm([0, 1, 2].map((k) => e1[k] * Math.cos(L) + e2[k] * Math.sin(L)) as Vec3);
}

/** Sun direction from a body at true anomaly nu (heliocentric orbit), J2000 equatorial. */
export function sunFromOrbitJ2000(body: BodyId, trueAnomalyRad: number): Vec3 {
  const { i, node, peri } = ORBITS[body];
  const O = node * DEG;
  const I = i * DEG;
  const u = trueAnomalyRad + (peri - node) * DEG; // argument of latitude
  const r: Vec3 = [
    Math.cos(O) * Math.cos(u) - Math.sin(O) * Math.sin(u) * Math.cos(I),
    Math.sin(O) * Math.cos(u) + Math.cos(O) * Math.sin(u) * Math.cos(I),
    Math.sin(u) * Math.sin(I),
  ];
  return scale(eclToEq(r), -1);
}

/** Local east/north/up unit vector from azimuth (from north, through east) and elevation. */
export function enu(azDeg: number, elDeg: number): Vec3 {
  const a = azDeg * DEG;
  const e = elDeg * DEG;
  return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
}

/**
 * Rotation J2000 equatorial -> local ENU, from the pole and the Sun known in
 * both frames. Rows of the result map a J2000 vector to (east, north, up).
 */
export function skyRotation(body: BodyId, latDeg: number, sunJ2000: Vec3, sunAzDeg: number, sunElDeg: number): Mat3 {
  const triad = (p: Vec3, s: Vec3): [Vec3, Vec3, Vec3] => {
    const b = norm(sub(s, scale(p, dot(s, p))));
    return [p, b, cross(p, b)];
  };
  const [aj, bj, cj] = triad(poleJ2000(body), sunJ2000);
  const [al, bl, cl] = triad(enu(0, latDeg), enu(sunAzDeg, sunElDeg));
  // R = A_local * A_j2000^T
  const m = new Array(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) m[r * 3 + c] = al[r] * aj[c] + bl[r] * bj[c] + cl[r] * cj[c];
  return m;
}

export function apply(m: Mat3, v: Vec3): Vec3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

/** Sun's longitude along its path for a lunar season given as the Sun's declination (bodies.ts sites). */
export function lunarSeasonDeg(declinationDeg: number, body: Body): number {
  const s = Math.sin(declinationDeg * DEG) / Math.sin(body.obliquityDeg * DEG);
  return Math.asin(Math.max(-1, Math.min(1, s))) / DEG;
}

/** Mean motion of the Sun along the ecliptic as seen from the body [deg/s]. */
export function sunMeanMotionDegS(body: Body): number {
  return 360 / body.orbit.periodS;
}

/** Earth's sidereal rotation period [s] (IERS). */
export const EARTH_SIDEREAL_S = 86_164.0905;

// ---- Martian moons ----------------------------------------------------------------

export interface Moonlet {
  name: string;
  /** Orbit radius [m], sidereal period [s], mean radius [m], geometric albedo. */
  aM: number;
  periodS: number;
  radiusM: number;
  albedo: number;
}

/** Jacobson 2010 (AJ 139:668) mean elements; radii and albedo from Thomas 1989 / NSSDCA. */
export const MARS_MOONS: Moonlet[] = [
  { name: "Phobos", aM: 9_376_000, periodS: 0.31891023 * 86_400, radiusM: 11_080, albedo: 0.071 },
  { name: "Deimos", aM: 23_463_200, periodS: 1.263 * 86_400, radiusM: 6_200, albedo: 0.068 },
];

/**
 * Direction and distance of a Martian moon from a surface site, in local
 * ENU. Both orbits lie within ~1-2° of Mars's equator, taken as exactly
 * equatorial and circular. `phase0` places the moon at t = 0 (arbitrary:
 * the scenario has no calendar date).
 */
export function moonletEnu(m: Moonlet, body: Body, latDeg: number, t: number, phase0: number): { dir: Vec3; distanceM: number } {
  // Longitude of the moon in the rotating (body-fixed) frame, relative to the site's meridian.
  const dLon = phase0 + 2 * Math.PI * t * (1 / m.periodS - 1 / body.siderealDayS);
  const lat = latDeg * DEG;
  const R = body.radiusM;
  // Body-fixed frame with x through the site's meridian on the equator, z north.
  const site: Vec3 = [R * Math.cos(lat), 0, R * Math.sin(lat)];
  const moon: Vec3 = [m.aM * Math.cos(dLon), m.aM * Math.sin(dLon), 0];
  const d = sub(moon, site);
  // Local axes at the site: east = +y, north = (-sin lat, 0, cos lat), up = (cos lat, 0, sin lat).
  const v: Vec3 = [d[1], -Math.sin(lat) * d[0] + Math.cos(lat) * d[2], Math.cos(lat) * d[0] + Math.sin(lat) * d[2]];
  const distanceM = Math.hypot(...v);
  return { dir: scale(v, 1 / distanceM), distanceM };
}
