/** Physical constants and Venus planetary parameters (SI units throughout). */

export const SIGMA = 5.670374419e-8; // Stefan-Boltzmann [W/m^2/K^4]
export const R_UNIVERSAL = 8.314462618; // [J/mol/K]
export const C_TO_K = 273.15;

export const VENUS = {
  radius: 6_051_800, // m
  gm: 3.24859e14, // m^3/s^2
  surfaceGravity: 8.87, // m/s^2
  solarConstantTop: 2601, // W/m^2 at 0.723 AU
  /** Mean length of a solar day (sunrise to sunrise), seconds. */
  solarDay: 116.75 * 86_400,
} as const;

export const EARTH_GRAVITY = 9.80665;

export const kToC = (k: number) => k - C_TO_K;
export const cToK = (c: number) => c + C_TO_K;
