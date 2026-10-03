/**
 * Run one experiment: a vehicle build in a scenario, from start (on the
 * surface, or descending from altitude) until it dies, plus some aftermath.
 *
 * Output is a resampled time series (for charts and 3D playback), an event
 * timeline, and a verdict. Pure and deterministic, so it runs the same in the
 * browser, a worker, or a Node test.
 */
import { cToK, kToC } from "../constants";
import type { AtmosphereSample } from "../env/atmosphere";
import { convection } from "../env/convection";
import {
  BATTERIES,
  CAMERAS,
  ELECTRONICS,
  HYDRAULICS,
  LUBRICANTS,
  MAGNETS,
  SEALS,
  SOLDERS,
  WINDINGS,
  magnetTorqueFraction,
  type PartBase,
} from "../materials/components";
import { MATERIALS, curveAt, yieldFraction } from "../materials/materials";
import { WORLD_CHANNELS, createWorld, type PlanetScenario, type WorldChannel } from "../planets/world";
import { ThermalNetwork } from "../thermal/network";
import walking from "../data/walking.json";
import { TERRAINS, type TerrainId, type TerrainStyle } from "../terrain/terrain";
import { buildThermalModel } from "../vehicles/thermal-model";
import { displacedVolumeM3 } from "../vehicles/volume";
import { runningGear, type VehicleBuild } from "../vehicles/types";
import { MACHINES } from "../robots/machines";
import { flightAt, flyLanding, type Flight } from "../spacecraft/landing";

export type Activity = "walking" | "idle";

export interface Scenario {
  /** Surface elevation relative to mean radius [m]. */
  elevationM: number;
  /** Ground type at the site (Venera-derived terrain). */
  ground: TerrainId;
  /** Surface wind [m/s]. */
  windMs: number;
  start: { kind: "surface" } | { kind: "descent"; fromKm: number };
  activity: Activity;
  /** Hard cap on simulated time [s]. */
  maxDurationS?: number;
  /** Moon, Mars or Mercury. Absent = Venus. */
  planet?: PlanetScenario;
}

export type Severity = "info" | "warn" | "fail" | "fatal";

export interface SimEvent {
  t: number;
  severity: Severity;
  title: string;
  detail?: string;
  /** Thermal node the event is about, if any. */
  node?: string;
}

export interface Series {
  t: Float64Array;
  altitudeM: Float64Array;
  ambientK: Float64Array;
  pressurePa: Float64Array;
  speedMs: Float64Array;
  /** Per thermal node temperature [K], same order as `nodes`. */
  nodeK: Float64Array[];
  torqueFraction: Float64Array;
  frameYieldFraction: Float64Array;
  batteryWh: Float64Array;
  controller: Uint8Array;
  power: Uint8Array;
  canWalk: Uint8Array;
  /** Sun, solar array, ground temperature, local time, awake/hibernating (zeros on Venus). */
  world: Record<WorldChannel, Float64Array>;
}

export interface Verdict {
  /** Time the vehicle stopped functioning (controller or power lost), or null if it outlived the run. */
  deathS: number | null;
  /** Humanoids: time it could no longer walk. */
  walkStopS: number | null;
  landedS: number | null;
  touchdownMs: number | null;
  firstFailure: SimEvent | null;
  headline: string;
}

export interface RunResult {
  build: VehicleBuild;
  scenario: Scenario;
  nodes: { id: string; label: string }[];
  series: Series;
  events: SimEvent[];
  verdict: Verdict;
  durationS: number;
  /** Rocket landers: the powered descent (spacecraft/landing.ts). */
  flight: Flight | null;
  /** Wall-clock compute time [ms]. */
  computeMs: number;
}

const DAY = 86_400;

interface Watch {
  part: PartBase;
  node: number;
  label: string;
  warned: boolean;
  failed: boolean;
  onFail?: () => void;
}

export function runExperiment(build: VehicleBuild, scenario: Scenario): RunResult {
  const t0 = performance.now();
  const first = runOnce(build, scenario);
  // A rocket whose flight computer cooks before touchdown can't fly its landing burn.
  // The descent up to that moment is unchanged, so fly it again with the engines going quiet then.
  const f = first.flight;
  const died = first.verdict.deathS;
  if (f && died !== null && f.destroyedS === null && f.touchdownS !== null && died < f.touchdownS) {
    const again = runOnce(build, scenario, died);
    return { ...again, computeMs: performance.now() - t0 };
  }
  return { ...first, computeMs: performance.now() - t0 };
}

function runOnce(build: VehicleBuild, scenario: Scenario, controlLostS?: number): RunResult {
  const t0 = performance.now();
  const battery = BATTERIES[build.battery.part];
  const world = createWorld(build, scenario.elevationM, scenario.planet);
  const model = buildThermalModel(build, battery.whPerKg, (m, k) => world.insulationK(m, k));
  const nodes = model.nodes.map((n) => ({ ...n, exposure: n.exposure ? { ...n.exposure } : undefined }));
  const links = [...model.links];
  const R = model.role;
  world.adapt(nodes, links, R);

  // Pyro-activated molten-salt batteries start hot.
  const initial = nodes.map((_, i) =>
    i === R.battery && battery.minOperatingK > build.initialTempK ? battery.minOperatingK + 100 : build.initialTempK,
  );
  const net = new ThermalNetwork(nodes, links, initial);
  const n = nodes.length;

  const events: SimEvent[] = [];
  const emit = (t: number, severity: Severity, title: string, detail?: string, node?: string) =>
    events.push({ t, severity, title, detail, node });

  // ---- State ----------------------------------------------------------------
  // Rocket landers fly their own descent on any world; parachute landers only fall through Venus's air.
  const descending = scenario.start.kind === "descent" && (world.allowDescent || !!build.propulsion);
  const flight =
    descending && build.propulsion
      ? flyLanding(build, {
          body: world.body.id,
          elevationM: scenario.elevationM,
          fromKm: (scenario.start as { fromKm: number }).fromKm,
          lsDeg: scenario.planet?.lsDeg,
          controlLostS,
        })
      : null;
  let altitude = descending ? (scenario.start as { fromKm: number }).fromKm * 1000 : scenario.elevationM;
  let landedS: number | null = descending ? null : 0;
  let touchdownMs: number | null = null;
  let stage = -1;
  let speed = 0;

  let electronicsOk = true;
  let solderOk = true;
  let batteryOk = true;
  let windingOk = true;
  let frameOk = true;
  let breached = false;
  let lubricantFactor = 1;
  let tiresOk = true;
  let batteryWh = build.battery.capacityWh;
  let magnetPeakK = build.initialTempK;
  let deathS: number | null = null;
  let walkStopS: number | null = null;
  let coolerOn = false;
  let controllerOkPrev = true;
  let depletedWarned = false;
  /** Battery ran flat under the motors: they stay off until it's back to 20% (a BMS cut-off). */
  let motorLockout = false;
  let dutyCycling = false;

  const humanoid = build.mechanics.kind === "humanoid";
  // Planetary rovers drive like the skid steer, minus the MuJoCo model.
  const wheeled = build.mechanics.kind === "wheeled" || build.mechanics.kind === "rover";
  const mobile = humanoid || wheeled;
  // Combustion engines need oxygen. Venus air is 96.5% CO2 + 3.5% N2 with only trace O2.
  const engineRuns = build.powerplant?.kind !== "diesel";
  const gait = humanoid ? walkingFor(build, scenario.ground) : null;
  const walkMin = gait?.minTorque ?? 0;
  const magnet = build.motors ? MAGNETS[build.motors.magnet] : undefined;

  if (build.powerplant?.kind === "diesel")
    emit(
      0,
      "fatal",
      "Diesel engine can't run",
      `No oxygen: ${world.body.id === "venus" ? "Venus air is 96.5% CO2 and 3.5% N2" : world.body.id === "mars" ? "Mars air is 95% CO2 at under 1% of Earth's pressure" : "there is no air at all"}. The ${build.powerplant.powerKw} kW engine can't combust, so the machine can't move; only the starter battery powers the electronics.`,
    );
  for (const e of flight?.events ?? []) emit(e.t, e.severity, e.title, e.detail);
  if (battery.minOperatingK > build.initialTempK)
    emit(0, "info", "Thermal battery activated", "Pyrotechnic heater melts the salt electrolyte so the battery can run.", "battery");

  // ---- Part watches -----------------------------------------------------------
  const watches: Watch[] = [];
  const watch = (part: PartBase, node: number | undefined, label: string, onFail?: () => void) => {
    if (node === undefined) return;
    watches.push({ part, node, label, warned: false, failed: false, onFail });
  };
  let tNow = 0;
  watch(ELECTRONICS[build.electronics.part], R.electronics, "Electronics", () => (electronicsOk = false));
  watch(SOLDERS[build.electronics.solder], R.electronics, "Solder joints", () => (solderOk = false));
  watch(battery, R.battery, "Battery", () => {
    batteryOk = false;
    if (battery.runawayFactor > 0 && batteryWh > 0 && R.battery !== undefined) {
      const joules = battery.runawayFactor * batteryWh * 3600;
      net.inject(R.battery, joules);
      emit(tNow, "fail", "Thermal runaway", `Battery cells vent and burn, dumping ~${(joules / 1e6).toFixed(1)} MJ of heat.`, "battery");
    }
    batteryWh = 0;
  });
  world.setHooks({
    electronicsDead: () => (electronicsOk = false),
    batteryDead: () => {
      batteryOk = false;
      batteryWh = 0;
    },
  });
  if (build.motors) {
    watch(WINDINGS[build.motors.winding], R.motors, "Motor windings", () => (windingOk = false));
    watch(LUBRICANTS[build.motors.lubricant], R.motors, "Joint lubricant", () => (lubricantFactor = 0.6));
  }
  if (build.camera) watch(CAMERAS[build.camera], R.camera, "Cameras");
  if (build.hydraulics)
    watch(HYDRAULICS[build.hydraulics.part], R.hydraulics, "Hydraulics", () => {
      const m = build.mechanics.kind === "wheeled" ? build.mechanics.model : "skidsteer";
      const [what, title] = m === "dozer" ? ["blade and ripper", "Blade drops"] : m === "excavator" ? ["boom, stick and bucket", "Boom drops"] : ["arms", "Lift arms drop"];
      emit(tNow, "fail", title, `Seals leak and the oil cracks: no hydraulic pressure left to hold the ${what}.`, "hydraulics");
    });
  if (build.enclosure.kind === "sealed") watch(SEALS[build.enclosure.seal], R.hull, "Hull seals", () => breach("Seals failed"));

  // Events for the outer surface follow the paint if there is one (it fails long before steel does).
  const skinMat = MATERIALS[build.paint ?? build.skin.material];
  const tireMat = build.tires ? MATERIALS[build.tires.material] : undefined;
  const gearName = runningGear(build);
  let tireWarned = false;
  let skinSoftWarned = false;
  let skinMeltWarned = false;
  let skinCharWarned = false;
  const frameMat = MATERIALS[build.frame.material];
  let frameWarned = false;
  let magnetWarned = false;
  let magnetIrrevWarned = false;

  function breach(reason: string) {
    if (breached) return;
    breached = true;
    if (world.body.id !== "venus") {
      emit(tNow, "warn", "Hull breached", `${reason}. The cabin gas leaks out; with no dense air outside, nothing floods in.`);
      return;
    }
    for (const [i, e] of model.breachExposure) nodes[i].exposure = { ...e };
    emit(tNow, "fatal", "Hull breached", `${reason}. Hot CO2 at ${(env.pressurePa / 1e5).toFixed(0)} bar floods the interior.`);
  }

  // ---- Series buffers ---------------------------------------------------------
  const raw: number[][] = [];
  const record = (t: number, env: AtmosphereSample, torque: number, frameYield: number, ctrl: boolean, pwr: boolean, walk: boolean) => {
    raw.push([
      t,
      altitude,
      env.temperatureK,
      env.pressurePa,
      speed,
      torque,
      frameYield,
      batteryWh,
      ctrl ? 1 : 0,
      pwr ? 1 : 0,
      walk ? 1 : 0,
      ...net.T,
      ...world.channels(),
    ]);
  };

  // ---- Main loop --------------------------------------------------------------
  const maxT = scenario.maxDurationS ?? world.maxDurationS;
  const h = new Float64Array(n);
  const Q = new Float64Array(n);
  let dt = 0.05;
  let t = 0;
  let env = world.sample(altitude);
  let stopAt = maxT;
  /** A rocket that dies in the air still falls: keep running until the wreck is down. */
  const afterFlight = (s: number) => (flight?.touchdownS != null && landedS === null ? Math.max(s, Math.min(maxT, flight.touchdownS + 60)) : s);

  const loads = () => {
    const ctrl = electronicsOk && solderOk;
    let w = 0;
    if (ctrl) w += build.electronics.powerW;
    if (ctrl && coolerOn && build.cooler) w += build.cooler.electricW;
    return w;
  };

  while (t < stopAt) {
    tNow = t;
    env = world.sample(altitude);

    // Rocket descent: follow the precomputed flight.
    if (landedS === null && flight) {
      const f = flightAt(flight, t)!;
      altitude = scenario.elevationM + f.h;
      speed = f.speed;
    }
    // Descent: quasi-steady terminal velocity (drag relaxation takes seconds, the fall takes an hour).
    else if (landedS === null && build.descent) {
      const km = altitude / 1000;
      const stages = build.descent.stages;
      let s = 0;
      for (let i = 0; i < stages.length; i++) if (km <= stages[i].belowKm) s = i;
      if (s !== stage) {
        if (stage >= 0) emit(t, "info", `${stages[s].label} deployed`, `At ${km.toFixed(1)} km.`);
        stage = s;
      }
      const gEff = env.gravity * (1 - (env.densityKgM3 * displacedVolumeM3(build)) / build.massKg);
      speed = Math.sqrt((2 * build.massKg * Math.max(gEff, 0)) / (env.densityKgM3 * stages[s].cdA));
    } else if (landedS === null) {
      speed = 0;
    }

    // Capabilities.
    const powerSource = batteryOk && batteryWh > 0 && net.T[R.battery ?? 0] >= battery.minOperatingK;
    const solarW = world.solarW(net.T);
    const power = powerSource || (build.rtg?.electricW ?? 0) > 0 || (solarW > 0 && solarW >= build.electronics.powerW);
    // Crushed or crashed rockets are lost, whatever their avionics are doing.
    const destroyed = flight?.destroyedS != null && t >= flight.destroyedS;
    const controller = electronicsOk && solderOk && power && !destroyed;
    // Hibernating is not dead: the controller is fine but switched off for the night.
    const awake = controller && !world.asleep();
    if (magnet && R.motors !== undefined) magnetPeakK = Math.max(magnetPeakK, net.T[R.motors]);
    const magnetFrac = magnet && R.motors !== undefined ? magnetTorqueFraction(magnet, net.T[R.motors], magnetPeakK) : 1;
    const sizeFrac = build.motors && magnet ? Math.min(1, magnet.relativeTorque * build.motors.sizeFactor) : 1;
    const coldFrac = world.coldTorque(net.T);
    const torque = build.motors ? (windingOk ? magnetFrac * sizeFrac * lubricantFactor * coldFrac : 0) * (engineRuns ? 1 : 0) : 0;
    const frameYield = yieldFraction(frameMat, net.T[R.frame!]);
    const walking = mobile && scenario.activity === "walking" && landedS !== null;
    // Blind walking policies trip on rough ground even when healthy (MuJoCo calibration).
    const tripped = walking && gait !== null && !gait.walksAtFull && gait.meanTripS !== null && landedS !== null && t - landedS >= gait.meanTripS;
    // Motors need energy too: with the battery empty, only what the array/RTG supplies beyond the avionics.
    const supplyW = (build.rtg?.electricW ?? 0) + solarW;
    if (motorLockout && batteryWh > 0.2 * build.battery.capacityWh) motorLockout = false;
    const motorsPowered = (powerSource && !motorLockout) || supplyW >= build.electronics.powerW + (build.motors?.electricW ?? 0);
    const canWalk = humanoid
      ? awake && frameOk && torque >= walkMin && !tripped && motorsPowered
      : wheeled && awake && engineRuns && frameOk && torque >= 0.3 && world.mobilityOk() && motorsPowered;

    if (controllerOkPrev && !controller && deathS === null && destroyed) {
      // The flight already narrated it; let the wreck reach the ground, then a minute more.
      deathS = t;
      stopAt = Math.min(maxT, Math.max(t, flight!.touchdownS ?? t) + 60);
    } else if (controllerOkPrev && !controller && deathS === null) {
      deathS = t;
      const why = !power ? "no power" : !electronicsOk ? "electronics failed" : "solder joints opened";
      const recoverable = world.canRecover && electronicsOk && solderOk;
      if (recoverable && world.asleep())
        emit(t, "warn", "Battery offline while asleep", "Battery too cold or empty to power the receiver and heaters. The array can restart the vehicle at sunrise if nothing freezes first.", "battery");
      else
        emit(t, recoverable ? "fail" : "fatal", recoverable ? "Power lost" : "Controller dead", `Vehicle stops functioning (${why}).${recoverable ? " It may come back when the Sun recharges it." : ""}`);
      if (!recoverable) stopAt = afterFlight(Math.min(maxT, t + Math.max(300, 0.25 * t)));
    } else if (!controllerOkPrev && controller && deathS !== null) {
      emit(t, "info", "Back online", "Sunlight on the array brought the vehicle back.");
      deathS = null;
    } else if (deathS !== null && !(electronicsOk && solderOk) && stopAt === maxT) {
      stopAt = afterFlight(Math.min(maxT, t + Math.max(300, 0.25 * t)));
    }
    controllerOkPrev = controller;
    // Asleep, or joints too cold until the morning warms them: a pause, not the end of driving.
    const pausedForCold = coldFrac < 1 && controller && frameOk;
    // Flat battery with the Sun still charging it: a pause, not the end.
    const pausedForPower = !motorsPowered && controller && supplyW > 0;
    if (mobile && walkStopS === null && !canWalk && landedS !== null && !(controller && world.asleep()) && !pausedForCold && !pausedForPower) {
      walkStopS = t;
      if (wheeled) {
        const why = !engineRuns ? "the diesel engine cannot run without oxygen" : !controller ? "controller dead" : !frameOk ? "frame yielded" : `drive torque down to ${(torque * 100).toFixed(0)}%`;
        emit(t, "fail", "Machine stops", `Can no longer drive: ${why}.`);
      }
    }
    if (humanoid && walkStopS === t && landedS !== null) {
      const why = !controller
        ? "controller dead"
        : !frameOk
          ? "frame yielded"
          : tripped
            ? tripReason(gait!, scenario.ground, !!scenario.planet)
            : `motor torque down to ${(torque * 100).toFixed(0)}%, below the ${(walkMin * 100).toFixed(0)}% it needs on this ground`;
      emit(t, "fail", "Robot falls", `Can no longer walk: ${why}.`);
    }

    // Heat loads.
    Q.fill(0);
    if (awake && R.electronics !== undefined) Q[R.electronics] += build.electronics.powerW;
    let motorW = 0;
    if (walking && canWalk && build.motors && R.motors !== undefined) {
      motorW = build.motors.electricW;
      Q[R.motors] += motorW * build.motors.heatFraction;
    }
    let drawW = (awake ? loads() : 0) + motorW;
    if (R.battery !== undefined && powerSource) Q[R.battery] += 0.03 * drawW;
    if (build.cooler && R.electronics !== undefined && controller) {
      const Tc = net.T[R.electronics];
      if (coolerOn ? Tc > build.cooler.setpointK - 2 : Tc > build.cooler.setpointK) coolerOn = true;
      else coolerOn = false;
      if (coolerOn) {
        const Th = Math.max(net.T[R.skin!], Tc + 1);
        const cop = Math.min(5, (build.cooler.carnotFraction * Tc) / (Th - Tc));
        const lift = cop * build.cooler.electricW;
        Q[R.electronics] -= lift;
        Q[R.skin!] += lift + build.cooler.electricW;
      }
    }
    if (build.rtg && R.skin !== undefined) Q[R.skin] += build.rtg.thermalW;
    // Sunlight, heater units, survival heaters (Moon/Mars/Mercury; nothing on Venus).
    drawW += world.heat(Q, net.T, powerSource || solarW > 0);

    // Convection coefficients.
    const walkSpeed = walking && canWalk ? 0.5 : 0;
    const flow = landedS === null ? speed : Math.hypot(scenario.windMs, walkSpeed);
    for (let i = 0; i < n; i++) {
      const e = nodes[i].exposure;
      h[i] = e && !world.airless
        ? convection({
            surfaceK: net.T[i],
            ambientK: env.temperatureK,
            pressurePa: env.pressurePa,
            gravity: env.gravity,
            speed: flow,
            lengthM: e.lengthM,
          }).h
        : 0;
    }

    record(t, env, torque, frameYield, controller, power, canWalk);

    // Step.
    const before = Float64Array.from(net.T);
    net.step(dt, { ambientK: env.temperatureK, radiantK: env.radiantK, h }, Q);
    let maxDelta = 0;
    for (let i = 0; i < n; i++) maxDelta = Math.max(maxDelta, Math.abs(net.T[i] - before[i]));

    // Battery energy (RTG and solar cover load first; surplus charges at 90%).
    const net_W = drawW - (build.rtg?.electricW ?? 0) - solarW;
    if (net_W > 0 && powerSource) batteryWh = Math.max(0, batteryWh - (net_W * dt) / 3600);
    else if (net_W < 0 && batteryOk && R.battery !== undefined && world.canCharge(net.T[R.battery]))
      batteryWh = Math.min(build.battery.capacityWh, batteryWh - (0.9 * net_W * dt) / 3600);
    // Duty-cycling on a charger: warn once, not every cycle.
    if (batteryWh > 0.2 * build.battery.capacityWh && !dutyCycling) depletedWarned = false;
    const flat = net_W > 0 && powerSource && batteryWh === 0;
    if (flat && motorW > 0) motorLockout = true;
    if (flat && !depletedWarned && (depletedWarned = true)) {
      const charging = supplyW > 0;
      if (motorW > 0 && charging) dutyCycling = true;
      emit(
        t + dt,
        world.canRecover || (build.rtg?.electricW ?? 0) > 0 ? "warn" : "fatal",
        "Battery depleted",
        motorW > 0 && charging
          ? `Ran out of stored energy. The motors wait until the pack is back to 20%, then work again: from here on, the ${Math.round(supplyW)} W supply sets how much it can do.`
          : `Ran out of stored energy.`,
        "battery",
      );
    }

    // Descent position.
    if (landedS === null && flight) {
      if (flight.touchdownS !== null && t + dt >= flight.touchdownS) {
        altitude = scenario.elevationM;
        landedS = flight.touchdownS;
        touchdownMs = flight.touchdownMs;
        speed = 0;
      }
    } else if (landedS === null) {
      altitude -= speed * dt;
      if (altitude <= scenario.elevationM) {
        altitude = scenario.elevationM;
        landedS = t + dt;
        touchdownMs = speed;
        emit(landedS, "info", "Touchdown", `Hit the surface at ${speed.toFixed(1)} m/s after ${(landedS / 60).toFixed(0)} min of descent.`);
        speed = 0;
      }
    }

    t += dt;
    tNow = t;
    const mech = build.mechanics;
    const groundSpeed =
      walking && canWalk ? (mech.kind === "rover" ? mech.speedMs * mech.dutyCycle : mech.kind === "wheeled" ? MACHINES[mech.model].avgSpeedMs : (gait?.metersPerS ?? 0.5)) : 0;
    world.advance(dt, groundSpeed, controller, (sev, title, detail, node) => emit(t, sev, title, detail, node));
    world.checkCold(net.T, (sev, title, detail, node) => emit(t, sev, title, detail, node));

    // Part thresholds.
    for (const w of watches) {
      const T = net.T[w.node];
      if (!w.warned && T >= w.part.warnK) {
        w.warned = true;
        emit(t, "warn", `${w.label} out of spec`, `${w.part.name} rated to ${kToC(w.part.warnK).toFixed(0)} °C; now ${kToC(T).toFixed(0)} °C.`, nodes[w.node].id);
      }
      if (!w.failed && T >= w.part.failK) {
        w.failed = true;
        emit(t, "fail", `${w.label} failed`, `${w.part.name} at ${kToC(T).toFixed(0)} °C (limit ${kToC(w.part.failK).toFixed(0)} °C).`, nodes[w.node].id);
        w.onFail?.();
      }
    }
    if (magnet && build.motors && R.motors !== undefined) {
      const T = net.T[R.motors];
      if (!magnetWarned && T > magnet.maxOperatingK) {
        magnetWarned = true;
        emit(t, "warn", "Magnets past max rating", `${magnet.name} above ${kToC(magnet.maxOperatingK).toFixed(0)} °C: losses become permanent.`, "motors");
      }
      if (!magnetIrrevWarned && T > magnet.curieK) {
        magnetIrrevWarned = true;
        emit(t, "fail", "Magnets demagnetized", `Past the Curie point (${kToC(magnet.curieK).toFixed(0)} °C). Motors have no permanent field left.`, "motors");
      }
    }
    const fy = yieldFraction(frameMat, net.T[R.frame!]);
    if (!frameWarned && fy < build.frame.loadFraction * 1.5) {
      frameWarned = true;
      emit(t, "warn", "Frame weakening", `${frameMat.name} down to ${(fy * 100).toFixed(0)}% of its room-temperature strength.`, "frame");
    }
    if (frameOk && fy < build.frame.loadFraction) {
      frameOk = false;
      emit(t, humanoid ? "fail" : "warn", "Frame yields", `Strength (${(fy * 100).toFixed(0)}%) below working stress (${(build.frame.loadFraction * 100).toFixed(0)}%). Structure sags under its own weight.`, "frame");
    }
    const Tskin = net.T[R.skin!];
    if (skinMat.maxServiceK && !skinSoftWarned && Tskin > skinMat.maxServiceK) {
      skinSoftWarned = true;
      emit(t, "warn", "Outer shell softening", `${skinMat.name} past its service limit (${kToC(skinMat.maxServiceK).toFixed(0)} °C).`, "skin");
    }
    if (skinMat.meltK && !skinMat.thermoset && !skinMeltWarned && Tskin > skinMat.meltK) {
      skinMeltWarned = true;
      emit(t, "warn", "Outer shell melting", `${skinMat.name}: flows at ${kToC(skinMat.meltK).toFixed(0)} °C and starts dripping.`, "skin");
    }
    if (skinMat.decomposeK && !skinCharWarned && Tskin > skinMat.decomposeK) {
      skinCharWarned = true;
      emit(t, "warn", "Outer shell charring", `${skinMat.name}: decomposes above ${kToC(skinMat.decomposeK).toFixed(0)} °C. No oxygen to burn, so it pyrolyses into char and fumes.`, "skin");
    }
    if (tireMat && R.tires !== undefined && tiresOk) {
      const Tt = net.T[R.tires];
      if (!tireWarned && tireMat.maxServiceK && Tt > tireMat.maxServiceK) {
        tireWarned = true;
        emit(
          t,
          "warn",
          `${gearName} softening`,
          `${tireMat.name} past ${kToC(tireMat.maxServiceK).toFixed(0)} °C: ${tireMat.kind === "metal" ? "the steel loses strength but keeps rolling" : gearName === "Tracks" ? "the rubber reverts and the lugs start to tear" : "rubber reverts, pressure climbs"}.`,
          "tires",
        );
      }
      if (tireMat.decomposeK && Tt > tireMat.decomposeK) {
        tiresOk = false;
        emit(
          t,
          "fail",
          `${gearName} pyrolysing`,
          `Rubber decomposes above ${kToC(tireMat.decomposeK).toFixed(0)} °C; ${gearName === "Tracks" ? "it falls off the steel cords and the machine settles onto its bare rollers" : "the tyres collapse onto the steel rims"}.`,
          "tires",
        );
      }
    }
    if (build.enclosure.kind === "sealed" && !breached && R.hull !== undefined) {
      const { hull } = build.enclosure;
      const hm = MATERIALS[hull.material];
      const tt = hull.thicknessMm / 1000;
      const dp = env.pressurePa - 1e5;
      const E = hm.modulusCurve ? curveAt(hm.modulusCurve, net.T[R.hull]) * 1e9 : 70e9;
      const pBuckle = 0.365 * E * (tt / hull.radiusM) ** 2; // Classical sphere buckling x 0.3 knockdown.
      const stress = hm.yieldCurve ? curveAt(hm.yieldCurve, net.T[R.hull]) * 1e6 : Infinity;
      const membrane = (dp * hull.radiusM) / (2 * tt);
      if (dp > pBuckle) breach(`Hull buckled (collapse pressure ${(pBuckle / 1e5).toFixed(0)} bar)`);
      else if (membrane > stress) breach(`Hull wall yielded (${(membrane / 1e6).toFixed(0)} MPa vs ${(stress / 1e6).toFixed(0)} MPa)`);
    }

    // Adaptive step: aim for <=1 K change per step; tight during descent.
    const target = 1.0;
    const grow = maxDelta > 0 ? Math.min(2, Math.max(0.3, target / maxDelta)) : 2;
    const cap = landedS === null ? (flight ? 0.5 : 2) : 600;
    dt = Math.min(cap, Math.max(0.02, dt * grow));
    if (t + dt > stopAt) dt = Math.max(0.02, stopAt - t);
  }

  env = world.sample(altitude);
  record(t, env, 0, yieldFraction(frameMat, net.T[R.frame!]), deathS === null, batteryWh > 0, false);

  events.sort((a, b) => a.t - b.t);
  const series = resample(raw, n, 900);
  const firstFailure = events.find((e) => e.severity === "fail" || e.severity === "fatal") ?? null;

  return {
    build,
    scenario,
    nodes: nodes.map((x) => ({ id: x.id, label: x.label })),
    series,
    events,
    verdict: {
      deathS,
      walkStopS,
      landedS,
      touchdownMs,
      firstFailure,
      headline: flight
        ? flight.destroyedS !== null || flight.touchdownS === null
          ? flight.summary
          : `${flight.summary} ${headline(build, deathS, walkStopS, landedS, t)}${world.summary()}`
        : headline(build, deathS, walkStopS, landedS, t) + world.summary(),
    },
    durationS: t,
    flight,
    computeMs: performance.now() - t0,
  };
}

interface Gait {
  walksAtFull: boolean;
  minTorque: number | null;
  meanTripS: number | null;
  metersPerS: number;
  /** Most common fall cause in the calibration runs (robots/trip.ts). */
  tripCause?: "obstacle" | "slope" | "balance" | "weak" | null;
}

/** Why a healthy robot falls on this ground, from the calibration's fall diagnosis. */
function tripReason(gait: Gait, ground: TerrainId, offVenus: boolean): string {
  const after = `typical after ~${gait.meanTripS!.toFixed(0)} s`;
  const blind = offVenus ? "its walking policy is blind and was trained on flat ground under Earth gravity" : "its walking policy is blind and was trained on flat ground";
  const t = TERRAINS[ground] as TerrainStyle;
  switch (gait.tripCause) {
    case "balance":
      return `lost its balance on open ground, not on a rock (${after}; ${offVenus ? "a gait trained under Earth gravity runs away in this gravity" : "the gait itself goes unstable here"})`;
    case "slope":
      return `lost its footing on the slope (${after}; ${blind})`;
    default: {
      const what = t.slopeDeg > 10 && t.boulders.density > 0 ? "boulder slope" : t.craters ? "rocks and crater rims" : t.plateSize > 0 ? "rock plates" : "rocks";
      return `caught a foot on the ${what} (${after}; ${blind})`;
    }
  }
}

/** Walking capability from scripts/calibrate-walking.ts; falls back to the same robot's body. */
export function walkingFor(build: VehicleBuild, ground: TerrainId): Gait | null {
  const results = walking.results as Record<string, Record<string, Gait>>;
  const byBuild = results[build.id] ?? (build.mechanics.kind === "humanoid" ? results[build.mechanics.robot === "h1" ? "optimus" : "g1"] : undefined);
  return byBuild?.[ground] ?? byBuild?.flat ?? null;
}

export function formatDuration(s: number): string {
  if (s < 90) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  if (s < 5400) return `${(s / 60).toFixed(s < 600 ? 1 : 0)} min`;
  if (s < 2 * DAY) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / DAY).toFixed(1)} days`;
}

function headline(b: VehicleBuild, death: number | null, walkStop: number | null, landed: number | null, end: number) {
  const onSurface = (x: number) => (landed ? x - landed : x);
  if (death === null) return `${b.name} is still working after ${formatDuration(end)}.`;
  if (landed === null || death < landed) return `${b.name} died during descent, ${formatDuration(death)} after the start.`;
  const alive = formatDuration(onSurface(death));
  const moved = b.mechanics.kind === "wheeled" && b.mechanics.model === "excavator" ? "Worked" : b.mechanics.kind === "wheeled" || b.mechanics.kind === "rover" ? "Drove" : "Walked";
  if (walkStop !== null && walkStop <= (landed ?? 0) + 0.5 && b.mechanics.kind === "wheeled") return `Never moved; electronics dead after ${alive}.`;
  if (walkStop !== null && walkStop < death) return `${moved} for ${formatDuration(onSurface(walkStop))}, dead after ${alive} on the surface.`;
  return `Survived ${alive} on the surface.`;
}

/** Resample raw records onto a uniform time grid. */
function resample(raw: number[][], nNodes: number, points: number): Series {
  const tEnd = raw[raw.length - 1][0];
  const m = Math.min(points, raw.length);
  const s: Series = {
    t: new Float64Array(m),
    altitudeM: new Float64Array(m),
    ambientK: new Float64Array(m),
    pressurePa: new Float64Array(m),
    speedMs: new Float64Array(m),
    nodeK: Array.from({ length: nNodes }, () => new Float64Array(m)),
    torqueFraction: new Float64Array(m),
    frameYieldFraction: new Float64Array(m),
    batteryWh: new Float64Array(m),
    controller: new Uint8Array(m),
    power: new Uint8Array(m),
    canWalk: new Uint8Array(m),
    world: Object.fromEntries(WORLD_CHANNELS.map((c) => [c, new Float64Array(m)])) as Record<WorldChannel, Float64Array>,
  };
  let j = 0;
  for (let k = 0; k < m; k++) {
    const t = m === 1 ? 0 : (tEnd * k) / (m - 1);
    while (j < raw.length - 2 && raw[j + 1][0] <= t) j++;
    const a = raw[j];
    const b = raw[Math.min(j + 1, raw.length - 1)];
    const f = b[0] > a[0] ? Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))) : 0;
    const L = (i: number) => a[i] + (b[i] - a[i]) * f;
    s.t[k] = t;
    s.altitudeM[k] = L(1);
    s.ambientK[k] = L(2);
    s.pressurePa[k] = L(3);
    s.speedMs[k] = L(4);
    s.torqueFraction[k] = L(5);
    s.frameYieldFraction[k] = L(6);
    s.batteryWh[k] = L(7);
    s.controller[k] = a[8];
    s.power[k] = a[9];
    s.canWalk[k] = a[10];
    for (let i = 0; i < nNodes; i++) s.nodeK[i][k] = L(11 + i);
    WORLD_CHANNELS.forEach((c, i) => {
      const col = 11 + nNodes + i;
      // Angles and clocks wrap (359° -> 0°, 23 h -> 0 h): don't interpolate across the wrap.
      const jumps = c !== "clockS" && Math.abs(b[col] - a[col]) > (c === "localHour" ? 12 : 180);
      s.world[c][k] = c === "awake" || jumps ? a[col] : L(col);
    });
  }
  return s;
}

/** Look up the state at an arbitrary time (for 3D playback). */
export function stateAt(r: RunResult, t: number) {
  const s = r.series;
  const m = s.t.length;
  const x = Math.min(Math.max(t, 0), s.t[m - 1]);
  let lo = 0;
  let hi = m - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s.t[mid] <= x) lo = mid;
    else hi = mid;
  }
  const f = s.t[hi] > s.t[lo] ? (x - s.t[lo]) / (s.t[hi] - s.t[lo]) : 0;
  const L = (a: Float64Array) => a[lo] + (a[hi] - a[lo]) * f;
  return {
    t: x,
    altitudeM: L(s.altitudeM),
    ambientK: L(s.ambientK),
    pressurePa: L(s.pressurePa),
    speedMs: L(s.speedMs),
    torqueFraction: L(s.torqueFraction),
    frameYieldFraction: L(s.frameYieldFraction),
    batteryWh: L(s.batteryWh),
    controller: s.controller[lo] === 1,
    power: s.power[lo] === 1,
    canWalk: s.canWalk[lo] === 1,
    nodeK: s.nodeK.map(L),
    world: Object.fromEntries(
      WORLD_CHANNELS.map((c) => {
        const a = s.world[c];
        const wraps = c === "awake" || Math.abs(a[hi] - a[lo]) > (c === "localHour" ? 12 : 180);
        return [c, wraps ? a[lo] : L(a)];
      }),
    ) as Record<WorldChannel, number>,
  };
}

export type PlaybackState = ReturnType<typeof stateAt>;

export { cToK };
