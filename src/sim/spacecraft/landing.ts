/**
 * Powered landing of a rocket (Starship, a Falcon 9 or New Glenn booster,
 * the Apollo LM) on Venus, Mars, the Moon or Mercury.
 *
 * A 2-D point mass (downrange x, altitude h) over a curved, non-rotating
 * body, with:
 * - gravity, the centrifugal term vx^2/r (a craft in low orbit doesn't fall),
 *   drag 1/2 rho v^2 CdA, and buoyancy rho g V (it matters on Venus, where
 *   the air near the ground is 65 kg/m^3);
 * - engines whose thrust depends on the outside pressure (engines.ts): a
 *   sea-level rocket engine at the bottom of Venus's 92-bar atmosphere is
 *   pushing against air almost as dense as its own exhaust;
 * - thin pressure-stabilised tanks that buckle once the air outside pushes
 *   harder than the gas inside (plus whatever their stiffeners carry);
 * - propellant that runs out, and legs rated for a touchdown speed.
 *
 * Where the descent starts (after entry; we don't model the plasma phase):
 * - Venus and Mars: falling at terminal velocity from `fromKm`, belly-first
 *   for Starship (its "skydive"), engines-first for the boosters.
 * - Moon and Mercury: in a circular orbit `fromKm` up, the classic powered
 *   descent (Apollo started its braking burn at ~15 km).
 *
 * Guidance, kept simple and robust:
 * - Airless worlds: a gravity turn (thrust against the velocity) at a
 *   constant throttle, found by bisection so the braking ends ~500 m up.
 * - Then (and from the start in air): a vertical velocity profile
 *   v_ref(h) = -sqrt(v_td^2 + 2 a_ref h), tracked with feedback. a_ref is a
 *   share of the deceleration available when the burn starts. An engine that
 *   can't throttle low enough to hover just shuts down and relights
 *   (a hoverslam). On Venus, if the engines can't even hold the weight, it
 *   burns everything on the way down to soften the hit.
 *
 * Aerodynamics (aero.ts): drag and lift follow the angle of attack and Mach
 * number from the stage's geometry (crossflow model), so a belly-first
 * Starship and a tail-first booster fall at different speeds for physical
 * reasons, not tuned drag areas. Attitude is commanded, not integrated:
 * entry and skydive angles of attack are presets, the flip takes FLIP_S.
 *
 * Entry heating (tps.ts): Sutton-Graves flux on the windward side, the base
 * and the lee, conducted through the tiles (or blanket) into the skin. Tiles
 * past their limit fail; skin past its structural limit means the tanks
 * rupture (outcome "burned"). Boosters without a heat shield fly an entry
 * burn first, as Falcon 9 does on Earth.
 *
 * Fidelity: approximation. Real landings fly smarter (and longer) guidance;
 * propellant margins here are a bit optimistic (Apollo 11 landed with ~45 s
 * of fuel; this model leaves more).
 */
import { atmosphere } from "../env/atmosphere";
import { BODIES, gravityAt, type BodyId } from "../planets/bodies";
import { marsPressure } from "../planets/mars";
import type { VehicleBuild } from "../vehicles/types";
import { aeroAreas, soundSpeed } from "./aero";
import { ENGINES, engineModel } from "./engines";
import { STRUCTURE_LIMIT_K, TILES, Wall, stagnationFlux } from "./tps";

export type FlightOutcome = "landed" | "hard" | "crashed" | "crushed" | "burned" | "floating";

export interface FlightEvent {
  t: number;
  severity: "info" | "warn" | "fail" | "fatal";
  title: string;
  detail?: string;
}

export interface Flight {
  t: Float64Array;
  /** Height above the ground [m]. */
  h: Float64Array;
  /** Downrange distance [m]. */
  x: Float64Array;
  vx: Float64Array;
  /** Vertical velocity, + up [m/s]. */
  vz: Float64Array;
  /** Thrust as a share of the landing engines' full vacuum thrust (plume size). */
  throttle: Float64Array;
  /** Engines lit. */
  lit: Float64Array;
  /** Vehicle axis from vertical [deg] (90 = lying flat: belly-flop or braking in orbit). */
  pitchDeg: Float64Array;
  propellantKg: Float64Array;
  /** Outside pressure [Pa]. */
  pressurePa: Float64Array;
  /** 1 once the tanks have buckled. */
  crushed: Float64Array;
  /** Angle between the nose axis and the oncoming flow [deg]: 180 = engines first (boosters), ~60 = Starship's entry, 90 = belly flop. */
  aoaDeg: Float64Array;
  mach: Float64Array;
  /** Dynamic pressure 1/2 rho v^2 [Pa]. */
  qPa: Float64Array;
  /** Hottest incident heat flux on any surface [W/m^2]. */
  heatWm2: Float64Array;
  /** Hottest outer surface (tile face or bare skin) [K]. */
  surfaceK: Float64Array;
  /** Hottest structural skin (behind the tiles, if any) [K]. */
  skinK: Float64Array;
  /** Non-gravitational acceleration (drag + lift + thrust) in Earth g. */
  gLoad: Float64Array;
  /** Vehicle mass (dry + propellant) [kg]. */
  massKg: Float64Array;
  /** Peaks over the flight. */
  peaks: { qPa: number; heatWm2: number; surfaceK: number; skinK: number; gLoad: number; mach: number };
  events: FlightEvent[];
  /** Reached the ground at this time (null: never did). */
  touchdownS: number | null;
  touchdownMs: number;
  outcome: FlightOutcome;
  /** Vehicle destroyed (tanks crushed, or crashed) at this time. */
  destroyedS: number | null;
  propellantLeftKg: number;
  /** One sentence for the verdict. */
  summary: string;
}

export interface FlightScenario {
  /** The flight computer died at this time (from the thermal run): no engine commands after it. */
  controlLostS?: number;
  body: BodyId;
  elevationM: number;
  fromKm: number;
  /** Mars season (air pressure). */
  lsDeg?: number;
}

interface Air {
  p: number;
  rho: number;
  g: number;
  /** Air temperature [K] (0 on airless worlds). */
  T: number;
}

/** Mars: same hydrostatic model as the surface sim (mars.ts), isothermal ~210 K. R_CO2 = 188.9 J/kg/K. */
function airAt(sc: FlightScenario, h: number): Air {
  const z = sc.elevationM + h;
  if (sc.body === "venus") {
    const a = atmosphere(z);
    return { p: a.pressurePa, rho: a.densityKgM3, g: a.gravity, T: a.temperatureK };
  }
  const g = gravityAt(BODIES[sc.body], z);
  if (sc.body === "mars") {
    const p = marsPressure(z, sc.lsDeg ?? 150);
    return { p, rho: p / (188.9 * 210), g, T: 210 };
  }
  return { p: 0, rho: 0, g, T: 0 };
}

const FLIP_S = 6;
const TOUCHDOWN_MS = 1;
/** Airless braking aims to end about this high [m]. */
const GATE_M = 500;
/** Below this speed the final vertical descent takes over [m/s]. */
const GATE_SPEED = 40;
/** Light the engines when stopping in the height left needs this share of the deceleration available. */
const IGNITE_SHARE = 0.75;
/** Default start of the descent per world [km]: Venera's 62 km, Mars entry interface, Apollo's 15 km PDI. */
export const DESCENT_FROM_KM: Record<BodyId, number> = { venus: 62, mars: 125, moon: 15, mercury: 15 };
/** Starting at or above this height in air means starting at entry interface [km]. */
export const ENTRY_KM = 80;
/** Entry from low orbit: speed [m/s] and flight path angle below horizontal. */
const ENTRY_SPEED: Partial<Record<BodyId, number>> = { mars: 3_500 };
const ENTRY_ANGLE = (3 * Math.PI) / 180;
/** Density of a wrecked, flooded vehicle (steel, engines, propellant) for buoyancy [kg/m^3]. */
const SOLID_DENSITY = 3000;

export function flyLanding(b: VehicleBuild, sc: FlightScenario): Flight {
  const P = b.propulsion!;
  const eng = engineModel(P.engine);
  const E = ENGINES[P.engine];
  const body = BODIES[sc.body];
  const airless = body.atmosphere === "none";
  const dry = b.massKg;
  let prop = Math.min(P.propellantKg, P.capacityKg);
  const tankLimitPa = (P.tanks.pressureBar + P.tanks.collapseMarginBar) * 1e5;
  const solidV = () => (dry + prop) / SOLID_DENSITY;

  // ---- State -----------------------------------------------------------------
  let t = 0;
  let h = sc.fromKm * 1000;
  let x = 0;
  let vx = 0;
  let vz = 0;
  let crushed = false;
  let crushedS: number | null = null;
  let phase: "entryBurn" | "coast" | "flip" | "braking" | "terminal" = "coast";
  let flipT = 0;
  let aRef = 0;
  const belly = P.aero.belly;
  let pitch = belly ? 90 : 0;
  let engineOn = false;
  let outOfPropAt: number | null = null;
  let cantPushWarned = false;
  let weakWarned = false;
  let floatWarned = false;
  let crushAltKm = "";
  let peakDrag = 0;
  let controlLostWarned = false;
  let pastPeakDrag = false;
  const events: FlightEvent[] = [];
  const emit = (severity: FlightEvent["severity"], title: string, detail?: string) => events.push({ t, severity, title, detail });

  const volume = () => (crushed || burned || P.tanks.flood ? solidV() : P.tanks.volumeM3);
  /** Angle between body axis and flow, aero.ts convention (0 engines first, 180 nose first). */
  let alpha = belly ? 180 - belly.skydiveAoADeg : 0;
  const alphaFor = (mach: number) => {
    if (!belly) return 0;
    if (phase === "coast") {
      // Entry angle of attack above Mach 3, the skydive below Mach 0.8, blended in between.
      const k = Math.min(1, Math.max(0, (mach - 0.8) / 2.2));
      return 180 - (belly.skydiveAoADeg + (belly.entryAoADeg - belly.skydiveAoADeg) * k);
    }
    // The flip swings it from belly-first to engines-first.
    if (phase === "flip") return (180 - belly.skydiveAoADeg) * Math.max(0, 1 - flipT / FLIP_S);
    return 0;
  };
  /** Mach number, attitude and aero areas at this speed and air. */
  const aeroAt = (speed: number, air: Air) => {
    const mach = air.T > 0 ? speed / soundSpeed(air.T) : 0;
    alpha = alphaFor(mach);
    return { mach, ...aeroAreas(P.aero, alpha, mach) };
  };

  // Heated walls: windward side (and nose), engine base, lee side.
  const T0 = airAt(sc, h).T || 250;
  const walls = { windward: new Wall(P.tps.windward, T0), base: new Wall(P.tps.base, T0), lee: new Wall(P.tps.lee, T0) };
  const wallLabel = { windward: belly ? "Windward tiles" : "Windward skin", base: "Engine base", lee: "Lee-side skin" } as const;
  const tileWarned = new Set<string>();
  const tileFailed = new Set<string>();
  let burned = false;
  let burnedS: number | null = null;
  let burnAltKm = "";
  let cur = { mach: 0, q: 0, heat: 0, g: 0 };
  const peaks = { qPa: 0, heatWm2: 0, surfaceK: T0, skinK: T0, gLoad: 0, mach: 0 };
  const prop0 = prop;
  /** Full thrust of the landing engines, the lowest one engine can throttle to, and one engine at full, here [N]. */
  const limits = (pa: number) => ({ max: P.landingEngines * eng.thrust(1, pa), min: eng.thrust(E.minThrottle, pa), one: eng.thrust(1, pa) });
  const vacuumMax = P.landingEngines * eng.thrust(1, 0);

  /** Engines and throttle for a thrust demand: the thrust actually made, propellant flow, engines lit. */
  const deliver = (demand: number, pa: number) => {
    const L = limits(pa);
    const T = Math.min(demand, L.max);
    if (T <= 0 || L.max <= 0) return { T: 0, mdot: 0, lit: 0 };
    const lit = Math.min(P.landingEngines, Math.max(1, Math.ceil(T / Math.max(L.one, 1e-9) - 1e-9)));
    const per = T / lit;
    // Throttle that makes `per` (thrust rises monotonically with chamber pressure).
    let lo = E.minThrottle;
    let hi = 1;
    if (eng.thrust(lo, pa) >= per) hi = lo;
    else
      for (let i = 0; i < 22; i++) {
        const mid = 0.5 * (lo + hi);
        if (eng.thrust(mid, pa) < per) lo = mid;
        else hi = mid;
      }
    return { T: lit * eng.thrust(hi, pa), mdot: lit * hi * eng.mdotFull, lit };
  };

  // ---- Start -------------------------------------------------------------------
  const air0 = airAt(sc, h);
  const r0 = body.radiusM + sc.elevationM + h;
  const entry = !airless && sc.fromKm >= ENTRY_KM;
  if (airless) {
    // Circular orbit.
    vx = Math.sqrt(body.gm / r0);
    phase = "braking";
    // Already turned to fire against the orbital motion.
    pitch = -90;
  } else if (entry) {
    // Entry interface from low orbit: ~orbital speed, shallow flight path angle.
    const v = ENTRY_SPEED[sc.body] ?? Math.sqrt(body.gm / r0);
    vx = v * Math.cos(ENTRY_ANGLE);
    vz = -v * Math.sin(ENTRY_ANGLE);
  } else if (air0.rho > 0) {
    const m = dry + prop;
    const net = Math.max(0, m * air0.g - air0.rho * air0.g * volume());
    // Terminal velocity; Mach (and so drag) depends on it, so iterate.
    vz = -50;
    for (let i = 0; i < 6; i++) vz = -Math.sqrt((2 * net) / (air0.rho * aeroAt(-vz, air0).cdA));
  }

  // ---- Samples -----------------------------------------------------------------
  const rows: number[][] = [];
  let lastRec = -Infinity;
  let lastT = 0;
  let lastLit = 0;
  const rec = (force = false) => {
    if (!force && t - lastRec < 0.5) return;
    lastRec = t;
    const surfK = Math.max(walls.windward.surfaceK, walls.base.surfaceK, walls.lee.surfaceK);
    const skinK = Math.max(walls.windward.skinK, walls.base.skinK, walls.lee.skinK);
    rows.push([
      t,
      Math.max(0, h),
      x,
      vx,
      vz,
      vacuumMax > 0 ? lastT / vacuumMax : 0,
      lastLit,
      pitch,
      prop,
      airAt(sc, Math.max(0, h)).p,
      crushed ? 1 : 0,
      180 - alpha,
      cur.mach,
      cur.q,
      cur.heat,
      surfK,
      skinK,
      cur.g,
      dry + prop,
    ]);
  };

  // Opening narrative.
  {
    const a = airAt(sc, h);
    const surf = airAt(sc, 0);
    const speed0 = Math.hypot(vx, vz);
    const way = belly ? "belly-first" : "engines-first";
    const where =
      sc.body === "venus" && !entry
        ? `Entry is over: falling ${way} at ${speed0.toFixed(0)} m/s through ${(a.p / 1e5).toFixed(2)} bar air, ${sc.fromKm} km up. The ground is at ${(surf.p / 1e5).toFixed(0)} bar.`
        : entry
          ? `Hits the top of the atmosphere ${sc.fromKm} km up at ${(speed0 / 1000).toFixed(1)} km/s, ${way}. The air at the ground is only ${(surf.p / 100).toFixed(1)} mbar: drag takes most of the speed, the engines the rest.`
          : sc.body === "mars"
            ? `Falling ${way} at ${speed0.toFixed(0)} m/s, ${sc.fromKm} km up, in ${(a.p / 100).toFixed(1)} mbar air.`
            : `In orbit ${sc.fromKm} km up, moving sideways at ${(vx / 1000).toFixed(2)} km/s. No air to brake against: every m/s has to come off with propellant.`;
    emit("info", "Descent begins", where);
    if (entry) {
      const w = P.tps.windward;
      const shield = w.tile ? `${TILES[w.tile.id].name}, ${w.tile.thicknessMm} mm, over ${w.skin.thicknessMm} mm of ${w.skin.material === "ss316" ? "stainless steel" : "aluminium"}` : null;
      emit(
        shield ? "info" : "warn",
        shield ? "Heat shield" : "No heat shield",
        shield
          ? `${shield} on the windward side; the lee side is bare. Re-entry heats the windward face to its radiative balance while the tiles keep the steel behind them cool.`
          : `Bare ${w.skin.thicknessMm} mm ${w.skin.material === "ss316" ? "steel" : "aluminium"} flanks${P.tps.base.tile ? ` and a ${TILES[P.tps.base.tile.id].name.toLowerCase()} over the engines` : ""}. ${P.entryBurn ? "This stage was built to come back from a few km/s, not from orbit. It fires its engines first (an entry burn) to cut the speed the air has to take off." : "It was never meant to meet air at all."}`,
      );
      if (speed0 > 6000)
        emit("warn", "Radiative heating not modelled", `At ${(speed0 / 1000).toFixed(1)} km/s the shock layer in CO₂ glows and radiates onto the vehicle (Tauber & Sutton 1991). Only convective heating is computed, so this run is optimistic.`);
    }
    if (entry && P.entryBurn) {
      phase = "entryBurn";
      emit("info", "Entry burn", `${P.landingEngines} × ${E.name} fire against the motion to slow from ${(speed0 / 1000).toFixed(2)} km/s toward ${(P.entryBurn.targetMs / 1000).toFixed(1)} km/s, spending at most ${Math.round(P.entryBurn.maxShare * 100)}% of the propellant.`);
    }
    if (sc.body === "venus") {
      const surfFrac = eng.thrust(1, surf.p) / eng.thrust(1, 101_325);
      if (eng.thrust(1, surf.p) <= 0)
        emit(
          "warn",
          "Engines useless at the bottom",
          `${E.name}: ${(E.pcPa / 1e5).toFixed(0)} bar in the chamber vs ${(surf.p / 1e5).toFixed(0)} bar outside. Below ~${altitudeWherePressure(sc, E.pcPa)} km it can't push exhaust out against the air at all.`,
        );
      else
        emit(
          "info",
          "Thrust at the surface",
          `At ${(surf.p / 1e5).toFixed(0)} bar the nozzle flow separates: each ${E.name} makes only ${(surfFrac * 100).toFixed(0)}% of its Earth sea-level thrust down there (chamber ${(E.pcPa / 1e5).toFixed(0)} bar).`,
        );
    }
  }
  rec(true);

  const finish = (tdS: number | null): Flight => {
    const speed = Math.hypot(vx, vz);
    const left = prop;
    let outcome: FlightOutcome;
    let summary: string;
    let destroyedS: number | null = crushedS ?? burnedS;
    if (tdS === null) {
      outcome = crushed ? "crushed" : burned ? "burned" : "floating";
      summary = crushed
        ? `Tanks crushed ${crushAltKm} km up.`
        : burned
          ? `Burned through ${burnAltKm} km up.`
          : airless
          ? "Still in orbit: no propellant to brake with."
          : `Never reached the ground: floating ${(h / 1000).toFixed(1)} km up.`;
    } else if (crushed) {
      outcome = "crushed";
      summary = `Tanks crushed ${crushAltKm} km up; the wreck hit the ground at ${speed.toFixed(speed < 10 ? 1 : 0)} m/s.`;
      emit("fail", "Wreck hits the ground", `${speed.toFixed(1)} m/s, ${fmtMin(tdS)} after the start.`);
    } else if (burned) {
      outcome = "burned";
      summary = `Burned through ${burnAltKm} km up during entry; the wreck hit the ground at ${speed.toFixed(0)} m/s.`;
      emit("fail", "Wreck hits the ground", `${speed.toFixed(0)} m/s, ${fmtMin(tdS)} after the start.`);
    } else if (speed <= P.legs.ratedMs) {
      outcome = "landed";
      summary = `Landed at ${speed.toFixed(1)} m/s with ${fmtKg(left)} of propellant left.`;
      emit("info", "Touchdown", `${speed.toFixed(1)} m/s (legs rated to ${P.legs.ratedMs} m/s), ${fmtMin(tdS)} after the start, ${fmtKg(left)} of propellant left.`);
    } else if (speed <= P.legs.breakMs) {
      outcome = "hard";
      summary = `Hard landing at ${speed.toFixed(1)} m/s: legs crumpled, but it's standing.`;
      emit("fail", "Hard landing", `${speed.toFixed(1)} m/s, past the ${P.legs.ratedMs} m/s the legs are rated for. They crumple and absorb it; the vehicle stays up, damaged.`);
    } else {
      outcome = "crashed";
      destroyedS = tdS;
      const surf = airAt(sc, 0);
      const why = controlLostWarned ? ", flight computer dead" : outOfPropAt !== null ? ", out of propellant" : limits(surf.p).max < (dry + left) * surf.g ? ", engines too weak in this air" : "";
      summary = `Crashed at ${speed.toFixed(0)} m/s${why}.`;
      emit(
        "fatal",
        "Impact",
        `Hits the ground at ${speed.toFixed(0)} m/s (${(speed * 3.6).toFixed(0)} km/h).${left > 0 ? ` The ${fmtKg(left)} of ${E.propellants} left mixes and burns: it carries its own oxidiser, so it needs no air for the fireball.` : ""}`,
      );
    }
    rec(true);
    return pack(rows, events, { touchdownS: tdS, touchdownMs: tdS === null ? 0 : speed, outcome, destroyedS, propellantLeftKg: left, summary, peaks });
  };

  const MAX_T = 6 * 3600;
  while (t < MAX_T) {
    const air = airAt(sc, Math.max(0, h));
    const m = dry + prop;
    const r = body.radiusM + sc.elevationM + h;
    const gEff = air.g - (vx * vx) / r - (air.rho * air.g * volume()) / m;
    const speed = Math.hypot(vx, vz);
    const ae = aeroAt(speed, air);
    const qDyn = 0.5 * air.rho * speed * speed;
    const D = qDyn * ae.cdA;
    let Dx = speed > 0 ? (-D * vx) / speed : 0;
    let Dz = speed > 0 ? (-D * vz) / speed : 0;
    // Lifting entry (belly-first): bank the lift up or down to sink at ~60 m/s while the air bleeds off the speed.
    if (entry && phase === "coast" && belly && speed > 0) {
      const share = Math.max(-1, Math.min(1, (-60 - vz) / 60));
      const Lf = qDyn * ae.clA * share;
      Dx += (-Lf * vz) / speed;
      Dz += (Lf * Math.abs(vx)) / speed;
    }

    // Tanks.
    if (!crushed && !P.tanks.flood && air.p > tankLimitPa) {
      crushed = true;
      crushedS = t;
      engineOn = false;
      crushAltKm = (h / 1000).toFixed(1);
      emit(
        "fatal",
        "Tanks crushed",
        `${(air.p / 1e5).toFixed(1)} bar outside vs ${P.tanks.pressureBar} bar inside. Rocket tanks are thin, pressure-stiffened shells: once the air pushes harder than the gas inside, they buckle like a stepped-on can. Engines lost.`,
      );
    }

    // Entry heating (tps.ts). The step size is the flight's: the walls sub-step for stability.
    const stepDt = h < 300 || phase === "flip" ? 0.02 : 0.1;
    let qMax = 0;
    // A wreck that has burned through isn't tracked further (its skin is gone).
    if (air.rho > 0 && !burned && !(speed < 200 && peaks.surfaceK < 500)) {
      const a = (alpha * Math.PI) / 180;
      const radius = P.aero.diameterM / 2;
      const qSphere = stagnationFlux(air.rho, speed, radius);
      const qSide = (qSphere / Math.SQRT2) * Math.pow(Math.max(0, Math.sin(a)), 1.5);
      const qNose = qSphere * Math.max(0, -Math.cos(a));
      const qBase = stagnationFlux(air.rho, speed, P.aero.diameterM) * Math.max(0, Math.cos(a));
      const qWind = Math.max(qSide, qNose);
      const q = { windward: qWind, base: qBase, lee: P.tps.leeShare * Math.max(qWind, qBase) };
      qMax = Math.max(qWind, qBase);
      for (const k of ["windward", "base", "lee"] as const) {
        const w = walls[k];
        w.step(q[k], air.T, stepDt);
        const tile = w.spec.tile && TILES[w.spec.tile.id];
        if (tile && w.tiled && w.surfaceK > tile.reuseK && !tileWarned.has(k)) {
          tileWarned.add(k);
          emit("warn", `${wallLabel[k]} past their reuse limit`, `${fmtC(w.surfaceK)} on the ${tile.name.toLowerCase()} (reusable to ${fmtC(tile.reuseK)}), ${(q[k] / 1000).toFixed(0)} kW/m² coming in at ${(speed / 1000).toFixed(2)} km/s.`);
        }
        if (tile && w.tileFailed && !tileFailed.has(k)) {
          tileFailed.add(k);
          emit("fail", `${wallLabel[k]} failing`, `Past ${fmtC(tile.limitK)} the silica shrinks and the coating cracks: tiles come off and the skin behind takes the heat directly.`);
        }
        const lim = STRUCTURE_LIMIT_K[w.spec.skin.material];
        if (lim && !burned && !crushed && w.skinK >= lim) {
          burned = true;
          burnedS = t;
          engineOn = false;
          burnAltKm = (h / 1000).toFixed(1);
          emit(
            "fatal",
            "Burn-through",
            `${wallLabel[k]}: the ${w.spec.skin.thicknessMm} mm ${w.spec.skin.material === "ss316" ? "steel" : "aluminium"} skin reached ${fmtC(w.skinK)} and lost most of its strength. The pressurised tanks behind it split open and the stage breaks up, ${burnAltKm} km up at ${(speed / 1000).toFixed(2)} km/s.`,
          );
        }
      }
    }

    const dragAcc = D / m;
    if (dragAcc > peakDrag) peakDrag = dragAcc;
    else if (peakDrag > 1 && dragAcc < 0.8 * peakDrag) pastPeakDrag = true;

    const L = limits(air.p);
    const aMax = L.max / m - gEff;
    const aMin = L.min / m - gEff;
    const brainDead = sc.controlLostS !== undefined && t >= sc.controlLostS;
    if (brainDead && !controlLostWarned && !crushed) {
      controlLostWarned = true;
      engineOn = false;
      emit("fail", "Nobody flying", "The flight computer is dead: no engine commands, no landing burn. It falls.");
    }
    const live = !crushed && !burned && prop > 0 && !brainDead;

    if (phase === "entryBurn" && (!live || speed <= P.entryBurn!.targetMs || prop <= prop0 * (1 - P.entryBurn!.maxShare))) {
      phase = "coast";
      if (live) emit("info", "Entry burn done", `${(h / 1000).toFixed(0)} km up, down to ${(speed / 1000).toFixed(2)} km/s with ${fmtKg(prop)} of propellant left for landing.`);
    }

    // ---- Phase changes ---------------------------------------------------------
    if (live && phase === "coast" && vz < 0) {
      // Distance fallen while flipping (belly-first craft hold their speed with the engines during the flip).
      const flipFall = belly ? Math.abs(vz) * FLIP_S : 0;
      const hEff = Math.max(1, h - flipFall);
      const weak = aMax <= 0.3;
      const burnS = prop / (P.landingEngines * eng.mdotFull);
      const need = (speed * speed) / (2 * hEff);
      // Entering from orbit, let the air do the work until drag has peaked (unless the ground gets close first).
      const dragFirst = entry && !pastPeakDrag && h > 15_000;
      const go = weak ? h <= Math.abs(vz) * burnS + flipFall : !dragFirst && need >= IGNITE_SHARE * aMax;
      if (go) {
        if (L.max <= 0) {
          if (!cantPushWarned) {
            cantPushWarned = true;
            emit("fail", "Engines can't push", `At ${(air.p / 1e5).toFixed(0)} bar the air outside is at the chamber pressure: no exhaust gets out, no thrust.`);
          }
        } else {
          phase = belly ? "flip" : speed > GATE_SPEED ? "braking" : "terminal";
          aRef = refDecel(aMin, aMax);
          if (weak && !weakWarned) {
            weakWarned = true;
            emit(
              "warn",
              "Not enough thrust to land",
              `Full thrust is ${((L.max / (m * air.g)) * 100).toFixed(0)}% of its weight here${air.p > 2e5 ? ` (${(air.p / 1e5).toFixed(0)} bar outside)` : ""}. It burns everything it has on the way down to soften the hit.`,
            );
          }
          emit(
            "info",
            belly ? "Flip and landing burn" : "Landing burn",
            `${h >= 1000 ? `${(h / 1000).toFixed(1)} km` : `${h.toFixed(0)} m`} up at ${speed.toFixed(0)} m/s.${belly ? " Engines light and swing the ship from belly-first to tail-down." : ""}`,
          );
        }
      }
    }
    if (phase === "flip" && flipT >= FLIP_S) phase = speed > GATE_SPEED ? "braking" : "terminal";
    if (phase === "braking" && (airless ? Math.abs(vx) <= 2 : speed <= GATE_SPEED)) {
      phase = "terminal";
      aRef = refDecel(aMin, aMax);
      if (airless) emit("info", "Braking burn done", `${h >= 1000 ? `${(h / 1000).toFixed(1)} km` : `${Math.round(h)} m`} up, sideways speed gone. Upright for the final descent.`);
    }

    // ---- Thrust ----------------------------------------------------------------
    let Tx = 0;
    let Tz = 0;
    let lit = 0;
    let mdot = 0;
    const apply = (wantX: number, wantZ: number) => {
      const want = Math.hypot(wantX, Math.max(0, wantZ));
      if (want <= 0) return;
      const d = deliver(want, air.p);
      const s = d.T / want;
      Tx = wantX * s;
      Tz = Math.max(0, wantZ) * s;
      mdot = d.mdot;
      lit = d.lit;
    };
    if (live && phase === "entryBurn") {
      // Retrograde at full thrust, high above the dense air (Falcon 9's entry burn, done on Earth at ~70 km).
      apply((-L.max * vx) / Math.max(speed, 1e-6), (-L.max * vz) / Math.max(speed, 1e-6));
    } else if (live && phase === "flip") {
      // Hold the descent speed while the ship swings upright.
      apply(0, Math.min(L.max, Math.max(L.min, m * gEff - Dz)));
    } else if (live && phase === "braking" && airless) {
      // Kill the sideways speed with what's left after holding a descent rate that reaches ~500 m as it runs out.
      const aH = Math.sqrt(Math.max(0.01, aMax * aMax - gEff * gEff));
      const tLeft = Math.max(5, Math.abs(vx) / aH);
      // Never faster than the final descent could stop from here at half the deceleration available.
      const vzRef = -Math.min(250, Math.max(0, h - GATE_M) / tLeft, Math.sqrt(Math.max(0, aMax) * Math.max(0, h - 50)));
      const wantZ = Math.min(L.max, Math.max(0, m * (gEff + 0.5 * (vzRef - vz))));
      // Don't overshoot through zero in one step.
      const wantX = -Math.sign(vx) * Math.min(Math.sqrt(Math.max(0, L.max * L.max - wantZ * wantZ)), (m * Math.abs(vx)) / 0.5);
      apply(wantX, wantZ);
    } else if (live && phase === "braking") {
      // Supersonic retropropulsion: full thrust against the velocity.
      apply((-L.max * vx) / Math.max(speed, 1e-6), (-L.max * vz) / Math.max(speed, 1e-6));
    } else if (live && phase === "terminal") {
      const vRef = -Math.sqrt(TOUCHDOWN_MS * TOUCHDOWN_MS + 2 * aRef * Math.max(0, h));
      // Deceleration that stops it at the ground from here, plus a pull toward the reference profile.
      const aNeed = vz < 0 ? (vz * vz - TOUCHDOWN_MS * TOUCHDOWN_MS) / (2 * Math.max(0.3, h)) : 0;
      const wantZ = m * (gEff + Math.max(0, aNeed) + 0.5 * (vRef - vz)) - Dz;
      const wantX = Math.max(-0.5 * L.max, Math.min(0.5 * L.max, m * (-vx / 3) - Dx));
      const want = Math.hypot(wantX, Math.max(0, wantZ));
      // Can't throttle this low: shut down and fall a little (a hoverslam), relight when the profile calls for it.
      if (engineOn && want < L.min * 0.98) engineOn = false;
      else if (!engineOn && want >= L.min) engineOn = true;
      if (engineOn) apply(wantX, wantZ);
    }
    lastT = Math.hypot(Tx, Tz);
    lastLit = lit;
    // Attitude: along the thrust when burning; coasting, the commanded angle of attack off the flow,
    // belly down (nose rotated up). Turns at most ~20°/s like a real stage.
    const coastPitch = () => {
      if (speed < 1) return belly ? 90 : 0;
      const a = (alpha * Math.PI) / 180;
      const nx = -vx / speed;
      const nz = -vz / speed;
      const up = Math.sin(a) * nx + Math.cos(a) * nz >= -Math.sin(a) * nx + Math.cos(a) * nz ? 1 : -1;
      const ox = nx * Math.cos(up * a) - nz * Math.sin(up * a);
      const oz = nx * Math.sin(up * a) + nz * Math.cos(up * a);
      return (Math.atan2(ox, oz) * 180) / Math.PI;
    };
    const pitchWant = lastT > 0 ? (Math.atan2(Tx, Tz) * 180) / Math.PI : phase === "coast" || phase === "flip" ? coastPitch() : 0;
    const turn = (phase === "flip" ? 90 / FLIP_S : 20) * (h < 300 ? 0.02 : 0.1);
    pitch += Math.max(-turn, Math.min(turn, pitchWant - pitch));

    // Felt acceleration (everything but gravity: thrust, drag, lift, buoyancy) and the peaks.
    const buoy = air.rho * air.g * volume();
    cur = { mach: ae.mach, q: qDyn, heat: qMax, g: Math.hypot(Tx + Dx, Tz + Dz + buoy) / m / EARTH_G };
    peaks.qPa = Math.max(peaks.qPa, qDyn);
    peaks.heatWm2 = Math.max(peaks.heatWm2, qMax);
    peaks.gLoad = Math.max(peaks.gLoad, cur.g);
    peaks.mach = Math.max(peaks.mach, ae.mach);
    peaks.surfaceK = Math.max(peaks.surfaceK, walls.windward.surfaceK, walls.base.surfaceK, walls.lee.surfaceK);
    peaks.skinK = Math.max(peaks.skinK, walls.windward.skinK, walls.base.skinK, walls.lee.skinK);

    // ---- Integrate (semi-implicit Euler) -----------------------------------------
    const dt = stepDt;
    vx += ((Tx + Dx) / m) * dt;
    vz += ((Tz + Dz) / m - gEff) * dt;
    x += vx * dt;
    h += vz * dt;
    if (phase === "flip") flipT += dt;
    if (mdot > 0) {
      prop = Math.max(0, prop - mdot * dt);
      if (prop === 0 && outOfPropAt === null) {
        outOfPropAt = t;
        emit("fail", "Out of propellant", `${h >= 1000 ? `${(h / 1000).toFixed(1)} km` : `${Math.max(0, h).toFixed(0)} m`} up, still moving at ${Math.hypot(vx, vz).toFixed(0)} m/s.`);
      }
    }
    t += dt;
    if (h <= 0) {
      h = 0;
      return finish(t);
    }
    if (!floatWarned && !airless && phase === "coast" && Math.abs(vz) < 0.05 && t > 60) {
      floatWarned = true;
      emit("warn", "Floating", `${(h / 1000).toFixed(1)} km up, the air is dense enough to hold it up.`);
    }
    rec();
  }
  return finish(null);
}

/** Deceleration the final descent aims for, given what the engines allow [m/s^2]. */
function refDecel(aMin: number, aMax: number): number {
  if (aMax <= 0.3) return 0.2;
  const a = 0.6 * aMax;
  // Can't throttle low enough to hold a gentle profile: fly a steeper one (hoverslam).
  return aMin > a ? 0.5 * (aMin + aMax) : a;
}

function altitudeWherePressure(sc: FlightScenario, pa: number): string {
  for (let z = 0; z < 100_000; z += 500) if (airAt(sc, z).p < pa) return (z / 1000).toFixed(0);
  return "100";
}

const EARTH_G = 9.80665;
const fmtC = (k: number) => `${Math.round(k - 273.15)} °C`;
const fmtKg = (kg: number) => (kg >= 1000 ? `${(kg / 1000).toFixed(kg >= 10_000 ? 0 : 1)} t` : `${Math.round(kg)} kg`);
const fmtMin = (s: number) => (s < 120 ? `${s.toFixed(0)} s` : `${(s / 60).toFixed(1)} min`);

function pack(
  rows: number[][],
  events: FlightEvent[],
  rest: Pick<Flight, "touchdownS" | "touchdownMs" | "outcome" | "destroyedS" | "propellantLeftKg" | "summary" | "peaks">,
): Flight {
  const col = (i: number) => Float64Array.from(rows, (r) => r[i]);
  return {
    t: col(0),
    h: col(1),
    x: col(2),
    vx: col(3),
    vz: col(4),
    throttle: col(5),
    lit: col(6),
    pitchDeg: col(7),
    propellantKg: col(8),
    pressurePa: col(9),
    crushed: col(10),
    aoaDeg: col(11),
    mach: col(12),
    qPa: col(13),
    heatWm2: col(14),
    surfaceK: col(15),
    skinK: col(16),
    gLoad: col(17),
    massKg: col(18),
    events,
    ...rest,
  };
}

/** Flight state at time t (linear interpolation; for 3D playback and the run loop). */
export function flightAt(f: Flight, t: number) {
  const n = f.t.length;
  if (n === 0) return null;
  const x = Math.min(Math.max(t, 0), f.t[n - 1]);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (f.t[mid] <= x) lo = mid;
    else hi = mid;
  }
  const k = f.t[hi] > f.t[lo] ? (x - f.t[lo]) / (f.t[hi] - f.t[lo]) : 0;
  const L = (a: Float64Array) => a[lo] + (a[hi] - a[lo]) * k;
  return {
    h: L(f.h),
    x: L(f.x),
    vx: L(f.vx),
    vz: L(f.vz),
    speed: Math.hypot(L(f.vx), L(f.vz)),
    throttle: L(f.throttle),
    lit: Math.round(f.lit[lo]),
    pitchDeg: L(f.pitchDeg),
    propellantKg: L(f.propellantKg),
    pressurePa: L(f.pressurePa),
    crushed: f.crushed[lo] > 0.5,
    aoaDeg: L(f.aoaDeg),
    mach: L(f.mach),
    qPa: L(f.qPa),
    heatWm2: L(f.heatWm2),
    surfaceK: L(f.surfaceK),
    skinK: L(f.skinK),
    gLoad: L(f.gLoad),
    massKg: L(f.massKg),
    ended: t >= f.t[n - 1],
  };
}
