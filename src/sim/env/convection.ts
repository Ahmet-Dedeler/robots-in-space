/**
 * External convective heat-transfer coefficient for a compact body immersed
 * in the Venus atmosphere.
 *
 * We treat every exposed body as an equivalent sphere of diameter L:
 * - natural convection: Churchill (1983) sphere correlation
 *     Nu = 2 + 0.589 Ra^(1/4) / [1 + (0.469/Pr)^(9/16)]^(4/9)
 * - forced convection: Whitaker (1972) sphere correlation
 *     Nu = 2 + (0.4 Re^(1/2) + 0.06 Re^(2/3)) Pr^0.4
 * - mixed: Nu = (Nu_nat^3 + Nu_forced^3)^(1/3) (Churchill blending)
 *
 * Gas properties are evaluated at the film temperature with the real-gas
 * table, and buoyancy uses the actual density difference (not beta*dT), which
 * matters for the dense supercritical CO2 near the surface.
 *
 * Typical accuracy of these correlations is +/-20-25%.
 */
import { co2Props } from "./co2";

export interface ConvectionInput {
  surfaceK: number;
  ambientK: number;
  pressurePa: number;
  gravity: number;
  /** Relative gas speed past the body [m/s] (wind, walking, descent). */
  speed: number;
  /** Characteristic length (equivalent diameter) [m]. */
  lengthM: number;
}

export interface ConvectionResult {
  h: number; // W/m^2/K
  nuNatural: number;
  nuForced: number;
  rayleigh: number;
  reynolds: number;
  prandtl: number;
}

export function convection({ surfaceK, ambientK, pressurePa, gravity, speed, lengthM }: ConvectionInput): ConvectionResult {
  const filmK = 0.5 * (surfaceK + ambientK);
  const film = co2Props(filmK, pressurePa);
  const nu = film.mu / film.rho; // kinematic viscosity
  const alpha = film.k / (film.rho * film.cp);
  const pr = nu / alpha;

  const rhoAmb = co2Props(ambientK, pressurePa).rho;
  const rhoSurf = co2Props(surfaceK, pressurePa).rho;
  const drho = Math.abs(rhoAmb - rhoSurf) / film.rho;
  const ra = (gravity * drho * lengthM ** 3) / (nu * alpha);
  const nuNatural = 2 + (0.589 * Math.pow(ra, 0.25)) / Math.pow(1 + Math.pow(0.469 / pr, 9 / 16), 4 / 9);

  const re = (Math.abs(speed) * lengthM) / nu;
  const nuForced = 2 + (0.4 * Math.sqrt(re) + 0.06 * Math.pow(re, 2 / 3)) * Math.pow(pr, 0.4);

  const nuMixed = Math.cbrt(nuNatural ** 3 + nuForced ** 3);
  return {
    h: (nuMixed * film.k) / lengthM,
    nuNatural,
    nuForced,
    rayleigh: ra,
    reynolds: re,
    prandtl: pr,
  };
}
