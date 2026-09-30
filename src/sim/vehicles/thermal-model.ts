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

export type Role = "skin" | "frame" | "hull" | "motors" | "electronics" | "battery" | "camera" | "pcm" | "payload";

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

export function buildThermalModel(b: VehicleBuild, batteryWhPerKg: number): ThermalModel {
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
  const insT = b.insulation.thicknessMm / 1000;
  const sealed = b.enclosure.kind === "sealed";
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
  if (b.enclosure.kind === "sealed") {
    const h = b.enclosure.hull;
    const hm = MATERIALS[h.material];
    const area = 4 * Math.PI * h.radiusM ** 2;
    hullMassKg = area * (h.thicknessMm / 1000) * hm.density;
    hull = add("hull", { label: `Pressure hull (${hm.name})`, C: hullMassKg * hm.cp });
    const gIns = insT > 0 ? (ins.k * area) / insT : 2000 * area;
    link(skin, hull, gIns);
    // Structural attachments (struts/brackets through the insulation). Ti struts:
    // k*A/L ~ 6.7 W/m/K * 10 x 7e-4 m^2 / 0.5 m ~ 0.1 W/K; allow for bolts and cabling.
    link(frame, hull, 0.3);
  }

  /** Internal part: sealed -> couples to hull; open -> flooded, behind its jacket. */
  const internal = (r: Role, label: string, massKg: number, cp: number, density: number, jacketed: boolean) => {
    const area = compactArea(massKg, density);
    const seriesR = jacketed && insT > 0 ? insT / (ins.k * area) : 0;
    const exposure: Exposure = { area, emissivity: 0.8, lengthM: 0.1, convFactor: cavity, seriesR };
    const i = add(r, { label, C: massKg * cp, exposure: sealed ? undefined : exposure });
    if (b.enclosure.kind === "sealed") {
      link(i, hull, b.enclosure.internalH * area);
      breachExposure.set(i, { ...exposure, seriesR: 0 });
    }
    return i;
  };

  const electronics = internal("electronics", "Electronics bay", b.electronics.massKg, 900, 1500, true);
  link(electronics, frame, 2);

  const batteryMassKg = b.battery.capacityWh / batteryWhPerKg;
  const battery = internal("battery", "Battery pack", batteryMassKg, 1000, 2500, true);
  link(battery, frame, 3);

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

  if (b.camera) {
    const cam = internal("camera", "Cameras", 0.5, 800, 2000, false);
    link(cam, sealed ? hull : frame, 0.5);
  }

  return { nodes, links, role, breachExposure, batteryMassKg, hullMassKg };
}
