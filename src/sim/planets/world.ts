/**
 * The environment an experiment runs in, as one object the mission loop
 * (mission/run.ts) talks to. Venus is a thin wrapper over the VIRA
 * atmosphere; everything else here is for airless bodies and Mars:
 *
 * - a clock: the Sun moves (a lunar day is 29.5 Earth days, Mercury's is
 *   176) and a rover can drive west to hold its local time (chase the Sun)
 * - the ground temperature from the regolith model (regolith.ts), which is
 *   what a vehicle radiates to at night
 * - sunlight: on the shell (direct, diffuse, and reflected off the ground)
 *   and on the solar array
 * - vacuum: no convection; radiation inside an open robot couples its parts
 *   to the inside of the shell instead of straight to the sky
 * - survival kit: hibernation, thermostatic heaters, radioisotope heater
 *   units, RTG waste heat piped inside
 * - cold failures (cold.ts)
 *
 * Radiative environment of a vehicle on the surface: half its view is the
 * ground, half the sky (3 K in vacuum; Mars' CO2/dust glow). The network
 * takes one radiant temperature, so we combine the two by T^4.
 * Absorbed sunlight on a compact body of area A and absorptivity alpha:
 *   alpha A (S_beam / 4 + D_sky / 2 + albedo * G / 2)
 * (a convex body intercepts A/4 of a beam; each hemisphere of diffuse or
 * ground-reflected light reaches half its area). Approximation.
 */
import { SIGMA } from "../constants";
import { atmosphere, type AtmosphereSample } from "../env/atmosphere";
import { co2Props } from "../env/co2";
import { MATERIALS, type MaterialId } from "../materials/materials";
import type { ThermalLink, ThermalNode } from "../thermal/network";
import type { Role } from "../vehicles/thermal-model";
import type { VehicleBuild } from "../vehicles/types";
import { BODIES, gravityAt, siteById, type Body, type BodyId, type PlanetSite } from "./bodies";
import {
  BATTERY_COLD,
  CAMERA_COLD,
  ELECTRONICS_COLD,
  HYDRAULIC_COLD,
  LUBRICANT_COLD,
  MATERIAL_BRITTLE,
  SEAL_COLD,
  insulationK,
  solarAbsorptivity,
  type BatteryCold,
} from "./cold";
import { marsAirFromGround, marsPressure, marsSkyIr, marsTransmission } from "./mars";
import { albedoAt, periodicSurface, sampleSolution, type PeriodicSolution } from "./regolith";
import { clockForLocalHour, sunAt, terminatorSpeed, type SolarClock, type SunState } from "./solar";

export interface PlanetScenario {
  body: Exclude<BodyId, "venus">;
  siteId: string;
  /** Local solar time at the start [h] (6 = sunrise, 12 = noon, 18 = sunset). */
  localHour: number;
  /** Mars season: areocentric solar longitude [deg]. */
  lsDeg: number;
  /** Mars column dust optical depth (0.3-1 typical, 5-11 in global storms). */
  dustTau: number;
  /** Mobile vehicles drive west with the day-night line to hold their local time. */
  chaseSun: boolean;
}

export interface WorldSample extends AtmosphereSample {
  groundK: number;
  sun: SunState | null;
  /** Sunlight on horizontal ground, direct + diffuse [W/m^2]. */
  sunHorizontalWm2: number;
}

type Emit = (severity: "info" | "warn" | "fail" | "fatal", title: string, detail?: string, node?: string) => void;

export interface ColdHooks {
  electronicsDead: () => void;
  batteryDead: () => void;
}

/** Extra series the mission loop records for charts and the 3D sky. */
export const WORLD_CHANNELS = ["sunElevDeg", "sunAzDeg", "sunWm2", "solarW", "groundK", "localHour", "awake"] as const;
export type WorldChannel = (typeof WORLD_CHANNELS)[number];

export interface World {
  readonly body: Body;
  readonly site: PlanetSite | null;
  readonly airless: boolean;
  readonly allowDescent: boolean;
  readonly maxDurationS: number;
  /** Can the vehicle come back from losing power (sunrise recharges it)? */
  readonly canRecover: boolean;
  insulationK(m: MaterialId, venusK: number): number;
  /** Adjust the thermal network for this environment (call once, before building the solver). */
  adapt(nodes: ThermalNode[], links: ThermalLink[], role: Partial<Record<Role, number>>): void;
  sample(altitudeM: number): WorldSample;
  /** Solar array output right now [W]. */
  solarW(T: Float64Array): number;
  /** Is the vehicle hibernating (asleep by design, not dead)? */
  asleep(): boolean;
  /** Adds sunlight, RHU and RTG heat; runs heaters. Returns the heaters' electric draw [W]. */
  heat(Q: Float64Array, T: Float64Array, powered: boolean): number;
  /** Battery charging allowed at this temperature? */
  canCharge(batteryK: number): boolean;
  /** Torque multiplier from cold lubricant/hydraulics (1 = fine). */
  coldTorque(T: Float64Array): number;
  /** False if cold broke the running gear (glassy tyres). */
  mobilityOk(): boolean;
  checkCold(T: Float64Array, emit: Emit): void;
  /** Advance the clock. `groundSpeedMs` > 0 while driving: chasing the Sun slows the local clock. */
  /** `alive`: controller working (asleep counts as alive). */
  advance(dt: number, groundSpeedMs: number, alive: boolean, emit: Emit): void;
  channels(): number[];
  /** Callbacks the cold checks use to kill parts in the mission loop. */
  setHooks(h: ColdHooks): void;
  /** Planet-flavoured end-of-run summary appended to the headline (or ""). */
  summary(): string;
}

export function createWorld(build: VehicleBuild, elevationM: number, planet: PlanetScenario | undefined): World {
  return planet ? new PlanetWorld(build, elevationM, planet) : new VenusWorld();
}

class VenusWorld implements World {
  readonly body = BODIES.venus;
  readonly site = null;
  readonly airless = false;
  readonly allowDescent = true;
  readonly maxDurationS = BODIES.venus.maxDurationS;
  readonly canRecover = false;
  insulationK = (_m: MaterialId, k: number) => k;
  adapt() {}
  sample(altitudeM: number): WorldSample {
    const a = atmosphere(altitudeM);
    return { ...a, groundK: a.temperatureK, sun: null, sunHorizontalWm2: 0 };
  }
  solarW = () => 0;
  asleep = () => false;
  heat = () => 0;
  canCharge = () => true;
  coldTorque = () => 1;
  mobilityOk = () => true;
  checkCold() {}
  advance() {}
  channels = () => [0, 0, 0, 0, 0, 0, 1];
  setHooks() {}
  summary = () => "";
}

const DEG = Math.PI / 180;

class PlanetWorld implements World {
  readonly body: Body;
  readonly site: PlanetSite;
  readonly airless: boolean;
  readonly allowDescent = false;
  readonly maxDurationS: number;
  readonly canRecover: boolean;
  private readonly clock: SolarClock;
  private readonly surface: PeriodicSolution;
  private readonly build: VehicleBuild;
  private readonly elevationM: number;
  private readonly planet: PlanetScenario;
  private tau: number;
  private role: Partial<Record<Role, number>> = {};
  private skinArea = 0;
  private alpha: number;
  private sleeping = false;
  private heatersOn = false;
  private dustFactor = 1;
  private nightsSurvived = 0;
  private wasDark: boolean;
  private chaseWarned = false;
  private distanceM = 0;
  private readonly cold: { key: string; warned: boolean; failed: boolean }[] = [];
  private tiresBroken = false;
  private readonly battery: BatteryCold | undefined;
  private hooks: ColdHooks | undefined;

  constructor(build: VehicleBuild, elevationM: number, planet: PlanetScenario) {
    this.build = build;
    this.elevationM = elevationM;
    this.planet = planet;
    this.body = BODIES[planet.body];
    const site = siteById(planet.siteId);
    if (!site || site.body !== planet.body) throw new Error(`unknown site ${planet.siteId} on ${planet.body}`);
    this.site = site;
    this.airless = this.body.atmosphere === "none";
    this.maxDurationS = this.body.maxDurationS;
    this.canRecover = (build.solar?.areaM2 ?? 0) > 0;
    this.clock = { body: this.body, site, lsDeg: planet.lsDeg };
    this.tau = clockForLocalHour(this.clock, planet.localHour);
    this.alpha = build.skin.absorptivity ?? solarAbsorptivity(build.paint ?? build.skin.material);
    this.battery = BATTERY_COLD[build.battery.part];

    const reg = site.regolith ?? this.body.regolith;
    const tau = planet.dustTau;
    const mars = this.body.atmosphere === "mars";
    const irSky = mars ? marsSkyIr(tau) : 0;
    this.surface = periodicSurface(
      reg,
      (t) => {
        const s = sunAt(this.clock, t);
        if (s.mu <= 0 || s.fluxNormal === 0) return { absorbedWm2: 0, irDownWm2: irSky + (site.shadowed?.wallIrWm2 ?? 0) };
        const inc = Math.acos(Math.min(1, s.mu));
        const tr = mars ? marsTransmission(tau, s.mu) : { direct: 1, diffuse: 0 };
        const G = s.fluxNormal * s.mu * (tr.direct + tr.diffuse);
        return { absorbedWm2: (1 - albedoAt(reg, inc)) * G, irDownWm2: irSky };
      },
      this.body.solarDayS,
      `${site.id}|${planet.lsDeg}|${tau}`,
    );
    this.wasDark = this.sun().mu <= 0;
  }

  private sun(): SunState {
    return sunAt(this.clock, this.tau);
  }

  private groundK(tau = this.tau): number {
    return sampleSolution(this.surface.surfaceK, this.surface.periodS, tau);
  }

  insulationK(m: MaterialId, venusK: number) {
    return insulationK(m, this.body.id, venusK);
  }

  adapt(nodes: ThermalNode[], links: ThermalLink[], role: Partial<Record<Role, number>>) {
    this.role = role;
    const skin = role.skin;
    if (skin === undefined) return;
    this.skinArea = nodes[skin].exposure?.area ?? 0;
    // Enclosed builds already keep their parts off the outside; only open bodies need this.
    if (this.build.enclosure.kind !== "open") return;
    // Inside an open robot the parts see the inside of the shell, not the sky.
    // With gas (Venus, and weakly Mars) convection dominated that path; in
    // vacuum or 6 mbar it's radiation, so couple each part to the shell with
    // a linearized radiative conductance 4 eps sigma T^3 A at ~250 K.
    const Tm = 250;
    for (let i = 0; i < nodes.length; i++) {
      if (i === skin || i === role.tires) continue;
      const e = nodes[i].exposure;
      if (!e) continue;
      const G = 4 * e.emissivity * SIGMA * Tm ** 3 * e.area;
      const Gnode = e.seriesR > 0 ? 1 / (1 / G + e.seriesR) : G;
      nodes[i] = { ...nodes[i], exposure: undefined };
      links.push({ a: i, b: skin, G: Gnode });
    }
  }

  sample(): WorldSample {
    const sun = this.sun();
    const g = gravityAt(this.body, this.elevationM);
    const groundK = this.groundK();
    const shade = this.site.shadowed !== undefined;
    let temperatureK: number;
    let pressurePa: number;
    let radiantK: number;
    let sunHorizontalWm2 = 0;
    if (this.body.atmosphere === "mars") {
      const tau = this.planet.dustTau;
      temperatureK = marsAirFromGround((t) => this.groundK(t), this.surface.meanSurfaceK, this.tau, this.body.solarDayS);
      pressurePa = marsPressure(this.elevationM, this.planet.lsDeg);
      const tr = marsTransmission(tau, sun.mu);
      sunHorizontalWm2 = sun.fluxNormal * sun.mu * (tr.direct + tr.diffuse);
      const skyK = Math.pow(marsSkyIr(tau) / SIGMA, 0.25);
      radiantK = Math.pow(0.5 * groundK ** 4 + 0.5 * skyK ** 4, 0.25);
    } else {
      // No air: "ambient" is shown as the ground temperature, the only thing
      // around to be at a temperature. Convection is switched off.
      temperatureK = groundK;
      pressurePa = 0;
      sunHorizontalWm2 = shade ? 0 : sun.fluxNormal * sun.mu;
      const wallK = shade ? Math.pow(this.site.shadowed!.wallIrWm2 / SIGMA, 0.25) : 3;
      radiantK = Math.pow(0.5 * groundK ** 4 + 0.5 * wallK ** 4, 0.25);
    }
    const gas = co2Props(temperatureK, Math.max(pressurePa, 1));
    return {
      altitudeM: this.elevationM,
      temperatureK,
      pressurePa,
      densityKgM3: pressurePa > 0 ? gas.rho : 0,
      gravity: g,
      radiantK,
      solarSubsolarWm2: sun.fluxNormal,
      gas,
      groundK,
      sun,
      sunHorizontalWm2,
    };
  }

  /** Beam (normal) and diffuse-horizontal sunlight at the surface [W/m^2]. */
  private light(): { beam: number; diffuse: number; global: number; sun: SunState } {
    const sun = this.sun();
    if (sun.mu <= 0 || sun.fluxNormal === 0) return { beam: 0, diffuse: 0, global: 0, sun };
    if (this.body.atmosphere !== "mars") return { beam: sun.fluxNormal, diffuse: 0, global: sun.fluxNormal * sun.mu, sun };
    const tr = marsTransmission(this.planet.dustTau, sun.mu);
    const beam = sun.fluxNormal * tr.direct;
    const diffuse = sun.fluxNormal * sun.mu * tr.diffuse;
    return { beam, diffuse, global: beam * sun.mu + diffuse, sun };
  }

  solarW(): number {
    const s = this.build.solar;
    if (!s || s.areaM2 <= 0) return 0;
    const { beam, diffuse, sun } = this.light();
    const el = sun.elevationDeg * DEG;
    let onPanel: number;
    if (s.mount === "horizontal") onPanel = beam * Math.max(0, Math.sin(el)) + diffuse;
    else if (s.mount === "vertical") onPanel = beam * Math.max(0, Math.cos(el)) + 0.5 * diffuse;
    else onPanel = beam + diffuse;
    return onPanel * s.areaM2 * s.efficiency * this.dustFactor;
  }

  asleep() {
    return this.sleeping;
  }

  setHooks(h: ColdHooks) {
    this.hooks = h;
  }

  heat(Q: Float64Array, T: Float64Array, powered: boolean): number {
    const R = this.role;
    const b = this.build;
    // Sunlight on the shell.
    if (R.skin !== undefined && this.skinArea > 0) {
      const { beam, diffuse, global } = this.light();
      const albedo = (this.site.regolith ?? this.body.regolith).albedo;
      Q[R.skin] += this.alpha * this.skinArea * (beam / 4 + diffuse / 2 + (albedo * global) / 2);
    }
    // Radioisotope heater units: split between the electronics bay and the battery.
    const inside = [R.electronics, R.battery].filter((i): i is number => i !== undefined);
    if (b.rhuW && inside.length) for (const i of inside) Q[i] += b.rhuW / inside.length;
    // RTG waste heat piped into the body (the run loop already put all of it on the shell).
    if (b.rtg?.interiorFraction && R.skin !== undefined && inside.length) {
      const w = b.rtg.thermalW * b.rtg.interiorFraction;
      Q[R.skin] -= w;
      for (const i of inside) Q[i] += w / inside.length;
    }
    // Switchable radiator: opens above its setpoint (2 K band), radiating to the sky with emissivity 0.85.
    if (b.radiator && inside.length) {
      const warm = Math.max(...inside.map((i) => T[i]));
      const open = Math.min(1, Math.max(0, (warm - b.radiator.openAboveK) / 2));
      if (open > 0) {
        const env = this.sample();
        for (const i of inside) Q[i] -= (open * 0.85 * SIGMA * b.radiator.areaM2 * (T[i] ** 4 - env.radiantK ** 4)) / inside.length;
      }
    }
    // Thermostatic survival heaters (with 3 K hysteresis) need battery power.
    let heaterW = 0;
    if (b.heaters && powered && inside.length) {
      const coldest = Math.min(...inside.map((i) => T[i]));
      this.heatersOn = this.heatersOn ? coldest < b.heaters.setpointK + 3 : coldest < b.heaters.setpointK;
      if (this.heatersOn) {
        heaterW = b.heaters.electricW;
        for (const i of inside) Q[i] += heaterW / inside.length;
      }
    }
    // A hibernating vehicle keeps a receiver and clock alive.
    if (this.sleeping && powered && b.hibernate && R.electronics !== undefined) {
      Q[R.electronics] += b.hibernate.sleepW;
      heaterW += b.hibernate.sleepW;
    }
    return heaterW;
  }

  canCharge(batteryK: number) {
    return !this.battery || batteryK >= this.battery.minChargeK;
  }

  coldTorque(T: Float64Array): number {
    const R = this.role;
    let f = 1;
    const lube = this.build.motors ? LUBRICANT_COLD[this.build.motors.lubricant] : undefined;
    if (lube && R.motors !== undefined) f *= stiffness(T[R.motors], lube.minOperatingK);
    const hyd = this.build.hydraulics ? HYDRAULIC_COLD[this.build.hydraulics.part] : undefined;
    const hi = R.hydraulics ?? R.frame;
    if (hyd && hi !== undefined) f *= stiffness(T[hi], hyd.minOperatingK);
    return f;
  }

  mobilityOk() {
    return !this.tiresBroken;
  }

  checkCold(T: Float64Array, emit: Emit) {
    const R = this.role;
    const b = this.build;
    const once = (key: string, kind: "warned" | "failed") => {
      let e = this.cold.find((x) => x.key === key);
      if (!e) this.cold.push((e = { key, warned: false, failed: false }));
      if (e[kind]) return false;
      e[kind] = true;
      return true;
    };
    const C = (k: number) => `${(k - 273.15).toFixed(0)} °C`;

    const el = ELECTRONICS_COLD[b.electronics.part];
    if (el && R.electronics !== undefined) {
      const Te = T[R.electronics];
      if (Te < el.minOperatingK && once("elec", "warned"))
        emit("warn", "Electronics too cold", `Below the ${C(el.minOperatingK)} rating (now ${C(Te)}). ${el.note}`, "electronics");
      if (Te < el.survivalK && once("elec", "failed")) {
        emit("fail", "Electronics cold damage", `Down to ${C(Te)}, past the ${C(el.survivalK)} survival limit. ${el.note}`, "electronics");
        this.hooks?.electronicsDead();
      }
    }
    const bat = this.battery;
    if (bat && R.battery !== undefined) {
      const Tb = T[R.battery];
      if (Tb < bat.survivalK && once("bat", "failed")) {
        emit("fail", "Battery frozen", `${C(Tb)}, below ${C(bat.survivalK)}. ${bat.note}`, "battery");
        this.hooks?.batteryDead();
      }
    }
    const cam = b.camera ? CAMERA_COLD[b.camera] : undefined;
    if (cam && R.camera !== undefined && T[R.camera] < cam.survivalK && once("cam", "failed"))
      emit("fail", "Cameras cold damage", `${C(T[R.camera])}, below ${C(cam.survivalK)}. ${cam.note}`, "camera");
    const lube = b.motors ? LUBRICANT_COLD[b.motors.lubricant] : undefined;
    if (lube && R.motors !== undefined && T[R.motors] < lube.minOperatingK && once("lube", "warned"))
      emit("warn", "Joints stiffening", `Lubricant at ${C(T[R.motors])}. ${lube.note}`, "motors");
    const hyd = b.hydraulics ? HYDRAULIC_COLD[b.hydraulics.part] : undefined;
    const hi = R.hydraulics ?? R.frame;
    if (hyd && hi !== undefined && T[hi] < hyd.minOperatingK && once("hyd", "warned"))
      emit("warn", "Hydraulic oil thickening", `${C(T[hi])}. ${hyd.note}`, "hydraulics");
    if (b.enclosure.kind === "sealed" && R.hull !== undefined) {
      const seal = SEAL_COLD[b.enclosure.seal];
      if (seal && T[R.hull] < seal.brittleK && once("seal", "warned"))
        emit("warn", "Hull seals leaking", `${C(T[R.hull])}. ${seal.note}`, "hull");
    }
    const brittle = (id: MaterialId, i: number | undefined, label: string, node: string) => {
      const m = MATERIAL_BRITTLE[id];
      if (m && i !== undefined && T[i] < m.brittleK && once(`brittle-${node}`, "warned"))
        emit("warn", `${label} brittle`, `${MATERIALS[id].name} at ${C(T[i])}. ${m.note}`, node);
    };
    brittle(b.frame.material, R.frame, "Frame", "frame");
    brittle(b.skin.material, R.skin, "Shell", "skin");
    if (b.tires) {
      const m = MATERIAL_BRITTLE[b.tires.material];
      if (m && R.tires !== undefined && T[R.tires] < m.brittleK && once("tires", "failed")) {
        this.tiresBroken = true;
        emit("fail", "Tyres glassy", `${MATERIALS[b.tires.material].name} at ${C(T[R.tires])}. ${m.note}`, "tires");
      }
    }
  }

  advance(dt: number, groundSpeedMs: number, alive: boolean, emit: Emit) {
    // Chasing the Sun: driving west at v against a terminator moving at V
    // slows the local clock to (1 - v/V).
    let rate = 1;
    if (this.planet.chaseSun && groundSpeedMs > 0) {
      const V = terminatorSpeed(this.clock);
      rate = Math.max(0, 1 - groundSpeedMs / V);
      if (rate > 0 && !this.chaseWarned) {
        this.chaseWarned = true;
        emit(
          "info",
          "Can't keep up with the Sun",
          `The day-night line moves at ${V.toFixed(2)} m/s here; driving at ${groundSpeedMs.toFixed(2)} m/s only slows the local day ${(1 / rate).toFixed(1)}×.`,
        );
      }
    }
    this.tau += dt * rate;
    this.distanceM += groundSpeedMs * dt;
    if (this.body.id === "mars") this.dustFactor = Math.max(0.3, this.dustFactor - (0.0015 * dt) / this.body.solarDayS);

    // Day/night bookkeeping and hibernation.
    const sun = this.sun();
    const dark = sun.mu <= 0 || sun.fluxNormal === 0;
    if (this.wasDark && !dark) {
      if (alive) {
        this.nightsSurvived++;
        emit("info", "Sunrise", `Night ${this.nightsSurvived} survived.`);
      }
    } else if (!this.wasDark && dark) {
      emit("info", "Sunset", `Local night begins: ${this.nightLength()}.`);
    }
    this.wasDark = dark;
    if (this.build.hibernate) {
      // Solar vehicles sleep when the array can't carry the electronics and
      // wake with margin; radioisotope-powered ones sleep through the dark.
      const need = this.build.electronics.powerW;
      const hasArray = (this.build.solar?.areaM2 ?? 0) > 0;
      const s = this.solarW();
      const tooDim = hasArray ? s < 0.5 * need : dark;
      const bright = hasArray ? s > need : !dark;
      if (!this.sleeping && tooDim && alive) {
        this.sleeping = true;
        emit("info", "Going to sleep", hasArray ? "Array output too low to run: everything off except heaters and a receiver." : "Night: everything off except heaters and a receiver, recharging the battery.", "electronics");
      } else if (this.sleeping && bright) {
        this.sleeping = false;
        if (alive) emit("info", "Woke up", "Enough sunlight on the array to run again.", "electronics");
      }
    }
  }

  private nightLength(): string {
    const h = this.body.solarDayS / 2 / 3600;
    return h > 48 ? `~${(h / 24).toFixed(0)} Earth days of darkness` : `~${h.toFixed(0)} hours of darkness`;
  }

  channels(): number[] {
    const s = this.sun();
    return [s.elevationDeg, s.azimuthDeg, this.light().global, this.solarW(), this.groundK(), s.localHour, this.sleeping ? 0 : 1];
  }

  summary(): string {
    const parts: string[] = [];
    const night = this.body.id === "mars" ? "Martian night" : this.body.id === "moon" ? "lunar night" : "Mercurian night";
    if (this.nightsSurvived > 0) parts.push(`Survived ${this.nightsSurvived} ${night}${this.nightsSurvived > 1 ? "s" : ""}.`);
    if (this.planet.chaseSun && this.distanceM > 1000)
      parts.push(`Chased the Sun ${(this.distanceM / 1000).toFixed(0)} km, holding local time at ${fmtHour(this.sun().localHour)}.`);
    else if (this.distanceM > 100) parts.push(`Drove ${this.distanceM >= 1000 ? `${(this.distanceM / 1000).toFixed(1)} km` : `${this.distanceM.toFixed(0)} m`}.`);
    return parts.length ? " " + parts.join(" ") : "";
  }
}

export function fmtHour(h: number): string {
  const m = Math.round(h * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Torque left when a lubricant is below its rating: stiffens over ~40 K to 15%. */
function stiffness(T: number, minK: number): number {
  if (T >= minK) return 1;
  return Math.max(0.15, 1 - (0.85 * (minK - T)) / 40);
}
