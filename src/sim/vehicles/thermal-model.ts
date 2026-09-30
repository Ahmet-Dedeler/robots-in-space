/**
 * Turn a VehicleBuild into a thermal network.
 *
 * Open bodies (every real robot today) are flooded with 92-bar CO2: each
 * internal part sees the hot gas directly, weakened by `internalExposure`
 * because flow in cavities is sluggish, and only its own insulation jacket
 * protects it. Sealed bodies put the parts inside a pressure hull; the only
 * heat path is conduction through the insulation and hull, then internal
 * convection/radiation.
 *
 * Contact conductances and cavity factors are engineering guesses; they
 * move timings by maybe 2x, but not the ordering of failures.
 */
import { MATERIALS, type MaterialId } from "../materials/materials";
import type { Exposure, ThermalLink, ThermalNode } from "../thermal/network";
import type { VehicleBuild } from "./types";

export type Role = "skin" | "frame" | "hull" | "motors" | "electronics" | "battery" | "camera" | "pcm" | "payload" | "tires" | "hydraulics";

export interface ThermalModel {
  nodes: ThermalNode[];
  links: ThermalLink[];
  role: Partial<Record<Role, number>>;
  /** Exposures switched on if a sealed hull breaches. */
  breachExposure: Map<number, Exposure>;
  /** Battery mass implied by capacity and chemistry [kg]. */
  batteryMassKg: number;
  hullMassKg: number;
}

/** Surface area of a compact, non-spherical lump of mass m and density rho. */
export function compactArea(massKg: number, density: number, shape = 2): number {
  const volume = massKg / density;
  return shape * 4.836 * Math.pow(volume, 2 / 3);
}

const cpOf = (id: MaterialId) => MATERIALS[id].cp;

/**
 * @param insulationK conductivity of the insulation in this environment
 *   (porous insulation is far better in vacuum than in 92-bar CO2).
 */
export function buildThermalModel(b: VehicleBuild, batteryWhPerKg: number, insulationK?: (m: MaterialId, venusK: number) => number): ThermalModel {
  const nodes: ThermalNode[] = [];
  const links: ThermalLink[] = [];
  const role: Partial<Record<Role, number>> = {};
  const breachExposure = new Map<number, Exposure>();
  const add = (r: Role, node: Omit<ThermalNode, "id">) => {
    role[r] = nodes.length;
    nodes.push({ id: r, ...node });
    return nodes.length - 1;
  };
  const link = (a: number | undefined, c: number | undefined, G: number) => {
    if (a === undefined || c === undefined || G <= 0) return;
    links.push({ a, b: c, G });
  };

  const ins = MATERIALS[b.insulation.material];
  const insK = insulationK ? insulationK(b.insulation.material, ins.k) : ins.k;
  const insT = b.insulation.thicknessMm / 1000;
  // Sealed pressure hulls and unpressurized warm boxes both keep the parts off the outside world.
  const sealed = b.enclosure.kind !== "open";
  const cavity = b.enclosure.kind === "open" ? b.enclosure.internalExposure : 0.35;

  // Outer skin / aeroshell.
  const skin = add("skin", {
    label: sealed ? "Outer shell" : "Skin / covers",
    C: b.skin.massKg * cpOf(b.skin.material),
    exposure: { area: b.exteriorAreaM2, emissivity: b.skin.emissivity, lengthM: b.charLengthM, convFactor: 1, seriesR: 0 },
  });

  // Structural frame.
  const frameMat = MATERIALS[b.frame.material];
  const frameArea = compactArea(b.frame.massKg, frameMat.density, 3);
  const frame = add("frame", {
    label: `Frame (${frameMat.name})`,
    C: b.frame.massKg * frameMat.cp,
    exposure: sealed
      ? { area: frameArea, emissivity: frameMat.emissivity, lengthM: 0.1, convFactor: 1, seriesR: 0 }
      : { area: frameArea, emissivity: frameMat.emissivity, lengthM: 0.05, convFactor: cavity, seriesR: 0 },
  });
  link(skin, frame, 300 * 0.15 * b.exteriorAreaM2);

  // Pressure hull (sealed only).
  let hull: number | undefined;
  let hullMassKg = 0;
  if (b.enclosure.kind !== "open") {
    const e = b.enclosure;
    const hm = MATERIALS[e.kind === "sealed" ? e.hull.material : e.wall.material];
    const area = e.kind === "sealed" ? 4 * Math.PI * e.hull.radiusM ** 2 : e.wall.areaM2;
    hullMassKg = area * ((e.kind === "sealed" ? e.hull.thicknessMm : e.wall.thicknessMm) / 1000) * hm.density;
    hull = add("hull", { label: e.kind === "sealed" ? `Pressure hull (${hm.name})` : `Warm electronics box (${hm.name})`, C: hullMassKg * hm.cp });
    const gIns = insT > 0 ? (insK * area) / insT : 2000 * area;
    link(skin, hull, gIns);
    // Structural attachments (struts/brackets through the insulation). Ti struts:
    // k*A/L ~ 6.7 W/m/K * 10 x 7e-4 m^2 / 0.5 m ~ 0.1 W/K; allow for bolts and cabling.
    // Rover warm boxes hang on low-conductance flexures (titanium/G-10) and
    // budget ~0.05 W/K for mounts and harness (MER: Novak et al. 2005). Approximate.
    link(frame, hull, e.kind === "box" ? 0.05 : 0.3);
  }

  /** Internal part: sealed -> couples to hull; open -> flooded, behind its jacket. */
  const internal = (r: Role, label: string, massKg: number, cp: number, density: number, jacketed: boolean) => {
    const area = compactArea(massKg, density);
    const seriesR = jacketed && insT > 0 ? insT / (insK * area) : 0;
    const exposure: Exposure = { area, emissivity: 0.8, lengthM: 0.1, convFactor: cavity, seriesR };
    const i = add(r, { label, C: massKg * cp, exposure: sealed ? undefined : exposure });
    if (b.enclosure.kind !== "open") {
      link(i, hull, b.enclosure.internalH * area);
      breachExposure.set(i, { ...exposure, seriesR: 0 });
    }
    return i;
  };

  // Equipment is bolted to the frame, except in a rover's warm box, where it sits on the insulated box floor.
  const mount = b.enclosure.kind === "box" ? hull : frame;
  const electronics = internal("electronics", "Electronics bay", b.electronics.massKg, 900, 1500, true);
  link(electronics, mount, 2);

  const batteryMassKg = b.battery.capacityWh / batteryWhPerKg;
  const battery = internal("battery", "Battery pack", batteryMassKg, 1000, 2500, true);
  link(battery, mount, 3);

  if (b.payloadMassKg > 0) {
    const payload = internal("payload", "Instruments & internal structure", b.payloadMassKg, 800, 1000, false);
    // Equipment is mounted on a shared internal structure.
    link(payload, electronics, 30);
    link(payload, battery, 30);
  }

  if (b.pcm && b.pcm.massKg > 0) {
    const m = MATERIALS[b.pcm.material];
    const pcm = add("pcm", {
      label: `Heat sink (${m.name})`,
      C: b.pcm.massKg * m.cp,
      pcm: m.pcm ? { meltK: m.pcm.meltK, latentJ: m.pcm.latentJkg * b.pcm.massKg, bandK: 2 } : undefined,
    });
    // PCM packs are built into the equipment it protects.
    link(pcm, electronics, 20 + 1.5 * b.pcm.massKg);
    link(pcm, role.payload, 20);
    link(pcm, battery, 15);
  }

  if (b.motors) {
    const area = compactArea(b.motors.massKg, 5000);
    // Joints sit outside any hull, so motors always see the gas.
    const motors = add("motors", {
      label: "Actuators (motors)",
      C: b.motors.massKg * 480,
      exposure: { area, emissivity: 0.6, lengthM: 0.08, convFactor: sealed ? 0.6 : cavity, seriesR: 0 },
    });
    link(motors, frame, 400 * 0.3 * area);
  }

  if (b.tires) {
    const m = MATERIALS[b.tires.material];
    // Tyres are thin-walled toroids: lots of area per kg, fully exposed.
    const area = compactArea(b.tires.massKg, m.density, 6);
    const tires = add("tires", {
      label: `Tyres (${m.name})`,
      C: b.tires.massKg * m.cp,
      exposure: { area, emissivity: m.emissivity, lengthM: 0.4, convFactor: 1, seriesR: 0 },
    });
    link(tires, frame, 20); // through steel rims and hubs
  }

  if (b.hydraulics) {
    const area = compactArea(b.hydraulics.massKg, 900, 3);
    const hyd = add("hydraulics", {
      label: "Hydraulic oil & seals",
      C: b.hydraulics.massKg * 1900,
      exposure: { area, emissivity: 0.8, lengthM: 0.1, convFactor: cavity, seriesR: 0 },
    });
    link(hyd, frame, 30);
  }

  if (b.camera) {
    const cam = internal("camera", "Cameras", 0.5, 800, 2000, false);
    link(cam, sealed ? hull : frame, 0.5);
  }

  return { nodes, links, role, breachExposure, batteryMassKg, hullMassKg };
}
