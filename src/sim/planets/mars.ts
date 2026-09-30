/**
 * Mars near-surface atmosphere, engineering level.
 *
 * - Pressure: hydrostatic from an annual-mean 560 Pa at MOLA 0 km with a
 *   10.8 km scale height (RT/Mg at ~210 K), plus the seasonal CO2 cycle
 *   (the polar caps freeze out ~25% of the atmosphere): +/-11% with the
 *   maximum near Ls 250. Calibrated to Viking Lander 1 (-3.6 km, ~7.9 mbar
 *   annual mean) and Curiosity REMS at Gale (-4.5 km, ~730-920 Pa).
 * - Sunlight through dust (column optical depth tau): direct beam
 *   exp(-tau/mu); dust scatters strongly forward, so much of the rest
 *   arrives as diffuse skylight: 0.7 exp(-0.3 tau) of the scattered part.
 *   This matches Appelbaum & Flood (1990) at tau ~0.5 (85% of the
 *   top-of-atmosphere flux at noon) and Opportunity's array output in the
 *   2018 storm (tau 10.8: ~3-4% of pre-storm). Calibrated.
 * - Downwelling infrared from CO2 and dust: eps(tau) sigma T_atm^4 with
 *   eps = 0.2 + 0.25 tau (capped at 0.95) and T_atm = 200 K + 3 K * tau:
 *   ~30 W/m^2 at tau 0.5, matching REMS-derived nighttime values (Martinez
 *   et al. 2017). Dust absorbs sunlight in the air, so a storm warms the
 *   lower atmosphere and the nights (Opportunity's site stayed near -30 to
 *   -40 °C during the 2018 storm). Calibrated.
 * - Air at ~1.5 m follows the ground damped and delayed (REMS: air swing
 *   ~65% of the ground's, peaking ~1 h later). Approximation.
 *
 * Mars air is 95% CO2, so the real-gas CO2 table covers its properties.
 */
import { SIGMA } from "../constants";

export const MARS_DATUM_PA = 560;
export const MARS_SCALE_HEIGHT_M = 10_800;

export function marsPressure(elevationM: number, lsDeg: number): number {
  const seasonal = 1 + 0.11 * Math.cos(((lsDeg - 250) * Math.PI) / 180);
  return MARS_DATUM_PA * Math.exp(-elevationM / MARS_SCALE_HEIGHT_M) * seasonal;
}

/** Fractions of the top-of-atmosphere horizontal flux (S mu) reaching the ground. */
export function marsTransmission(tau: number, mu: number): { direct: number; diffuse: number } {
  if (mu <= 0) return { direct: 0, diffuse: 0 };
  // Airmass floor ~ spherical-atmosphere limit near the horizon.
  const m = 1 / Math.max(mu, 0.035);
  const direct = Math.exp(-tau * m);
  return { direct, diffuse: (1 - direct) * 0.7 * Math.exp(-0.3 * tau) };
}

export function marsSkyIr(tau: number): number {
  return Math.min(0.95, 0.2 + 0.25 * tau) * SIGMA * (200 + 3 * tau) ** 4;
}

/** Air temperature at lander height from the ground temperature history (see header). */
export function marsAirFromGround(groundK: (tau: number) => number, meanGroundK: number, tau: number, solS: number): number {
  const lagged = groundK(tau - solS / 24);
  return meanGroundK + 0.65 * (lagged - meanGroundK);
}
