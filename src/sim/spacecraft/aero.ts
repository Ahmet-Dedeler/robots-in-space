/**
 * Aerodynamics of a rocket stage at any angle of attack, from its geometry.
 *
 * The stage is a slender cylinder (length L, diameter d) with flat-plate
 * control surfaces (Starship's flaps, Falcon 9's grid fins, New Glenn's aft
 * fins). Forces come from the classic crossflow model for slender bodies
 * (Allen & Perkins 1951, NACA TR 1048; Jorgensen 1977, NASA TR R-474):
 *
 *   normal force  N = q [ Cdc(Mc) sin^2 a  L d  +  Cf sin^2 a  S_flaps ]
 *   axial force   A = q [ Ca(M, end) cos^2 a  pi d^2/4  +  Cf cos^2 a  S_gridfins ]
 *   drag  D = N sin a + A |cos a|,   lift  L = N cos a sign(..) - A sin a
 *
 * where a is the angle between the body axis and the oncoming flow (0 =
 * engines into the wind, a booster's tail-first fall; 90 = broadside, a
 * belly flop; 180 = nose first), Mc = M sin a the crossflow Mach number and
 * Cdc the 2-D cylinder drag at that Mach number. Lift is the part of the
 * force perpendicular to the flow; its direction is set by the guidance
 * (bank angle), so only its magnitude is returned.
 *
 * Fidelity: approximation (~±25%). No body-flap trim, no base-flow or
 * plume interaction, no Reynolds-number effects (drag crisis), no
 * rotational dynamics: the attitude is what the guidance commands.
 */
import { R_UNIVERSAL as R_GAS } from "../constants";

export interface AeroGeometry {
  /** Body length [m]. */
  lengthM: number;
  /** Body diameter [m]. */
  diameterM: number;
  /**
   * Control surfaces as flat plates [m^2]. "normal": broadside to the flow
   * when the body is (Starship's flaps, New Glenn's fins); "axial": facing
   * the flow when the stage falls tail-first (Falcon 9's grid fins).
   */
  fins?: { areaM2: number; facing: "normal" | "axial" };
}

/** Speed of sound in CO2 (Venus 96.5%, Mars 95%), ideal gas [m/s]. */
export function soundSpeed(tempK: number): number {
  return Math.sqrt(gammaCO2(tempK) * R_CO2 * tempK);
}

/** Specific gas constant of CO2 [J/kg/K] (8.314 / 0.04401). */
export const R_CO2 = R_GAS / 0.04401;

/**
 * Heat-capacity ratio of CO2 from the NIST Shomate fit (Chase 1998, NIST
 * WebBook, valid 298-1200 K; extrapolated below 298 K, where it still gives
 * the known ~1.35 at Mars temperatures).
 */
export function gammaCO2(tempK: number): number {
  const t = Math.min(Math.max(tempK, 150), 1200) / 1000;
  const cp = 24.99735 + 55.18696 * t - 33.69137 * t * t + 7.948387 * t * t * t - 0.136638 / (t * t);
  return cp / (cp - R_GAS);
}

/**
 * 2-D drag coefficient of a circular cylinder vs crossflow Mach number.
 * Approximate reading of Jorgensen 1977 (NASA TR R-474, fig. 3): 1.2
 * subcritical, a transonic peak, falling to the modified-Newtonian value
 * (2/3 Cp_max ~ 1.25) at hypersonic speed. Approximation.
 */
const CROSSFLOW: ReadonlyArray<readonly [number, number]> = [
  [0, 1.2],
  [0.4, 1.2],
  [0.8, 1.45],
  [1.0, 1.7],
  [1.4, 1.75],
  [2.0, 1.55],
  [3.0, 1.4],
  [6.0, 1.28],
];

/**
 * Axial-force coefficient of the stage's ends, on the base area.
 * Engines-first: a blunt end like a flat disk (Hoerner, Fluid-Dynamic Drag,
 * 1965, ch. 3 and 16: Cd 1.17 subsonic, rising to ~1.6-1.7 supersonic, the
 * stagnation-pressure limit). Nose-first: an ogive/cone nose, much lower.
 * Approximation.
 */
const BASE_FIRST: ReadonlyArray<readonly [number, number]> = [
  [0, 1.05],
  [0.6, 1.1],
  [0.9, 1.25],
  [1.2, 1.5],
  [2.0, 1.6],
  [4.0, 1.7],
];
const NOSE_FIRST: ReadonlyArray<readonly [number, number]> = [
  [0, 0.25],
  [0.8, 0.3],
  [1.1, 0.55],
  [2.0, 0.45],
  [4.0, 0.35],
];
/** Flat plate broadside (Hoerner: 1.17-1.28 subsonic), about the same supersonic. Approximation. */
const PLATE_CD = 1.28;

function table(t: ReadonlyArray<readonly [number, number]>, x: number): number {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (x <= t[i][0]) {
      const [x0, y0] = t[i - 1];
      const [x1, y1] = t[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return t[t.length - 1][1];
}

export interface AeroAreas {
  /** Drag area Cd x A [m^2]: drag = q * cdA. */
  cdA: number;
  /** Lift area Cl x A [m^2], magnitude. */
  clA: number;
}

/** Drag and lift areas at angle of attack `aoaDeg` (0 tail-first ... 180 nose-first) and Mach number. */
export function aeroAreas(g: AeroGeometry, aoaDeg: number, mach: number): AeroAreas {
  const a = (Math.min(Math.max(aoaDeg, 0), 180) * Math.PI) / 180;
  const s = Math.sin(a);
  const c = Math.cos(a);
  const plan = g.lengthM * g.diameterM;
  const base = (Math.PI * g.diameterM * g.diameterM) / 4;
  let N = table(CROSSFLOW, mach * s) * s * s * plan;
  let A = table(c >= 0 ? BASE_FIRST : NOSE_FIRST, mach * Math.abs(c)) * c * c * base;
  if (g.fins?.facing === "normal") N += PLATE_CD * s * s * g.fins.areaM2;
  if (g.fins?.facing === "axial") A += PLATE_CD * c * c * g.fins.areaM2;
  // Rotate body-axis forces (N perpendicular, A along the axis) into wind axes.
  const cdA = N * s + A * Math.abs(c);
  const clA = Math.abs(N * Math.abs(c) - A * s);
  return { cdA, clA };
}
