/**
 * Preset vehicles. Every number here is either from a public spec sheet, a
 * mission paper, or an explicit guess (see `notes`). Fidelity labels say
 * which.
 */
import { cToK } from "../constants";
import type { VehicleBuild } from "./types";

const optimus: VehicleBuild = {
  id: "optimus",
  name: "Tesla Optimus (approx.)",
  tagline: "Stock humanoid, dropped on the surface as-is.",
  fidelity: "approximation",
  notes: [
    "Tesla publishes no CAD or model. Mechanics use the Unitree H1 body (1.80 m vs Optimus 1.73 m) with its real walking policy, scaled to Optimus's 57 kg.",
    "Public specs used: 173 cm, 57 kg, 2.3 kWh / 52 V pack in the torso, 28 body DOF, automotive-grade AI computer.",
    "Assumed (not published): NdFeB SH magnets and class H windings (typical EV/robot motors), aluminium frame, PC/ABS covers.",
  ],
  mechanics: { kind: "humanoid", robot: "h1", finish: "white" },
  massKg: 57,
  exteriorAreaM2: 1.6,
  charLengthM: 0.15,
  skin: { material: "pcabs", massKg: 6, emissivity: 0.9 },
  frame: { material: "al6061", massKg: 16, loadFraction: 0.35 },
  enclosure: { kind: "open", internalExposure: 0.35 },
  insulation: { material: "aerogel", thicknessMm: 0 },
  electronics: { part: "siAutomotive", solder: "sac305", massKg: 3, powerW: 100 },
  battery: { part: "liIon", capacityWh: 2300 },
  motors: {
    magnet: "ndfebSH",
    winding: "classH",
    lubricant: "grease",
    massKg: 16,
    electricW: 500,
    heatFraction: 0.3,
    sizeFactor: 1,
  },
  camera: "cmos",
  payloadMassKg: 0,
  initialTempK: cToK(20),
};

const g1: VehicleBuild = {
  id: "g1",
  name: "Unitree G1",
  tagline: "Real robot, real model, real walking policy.",
  fidelity: "approximation",
  notes: [
    "Mechanics: official Unitree MJCF + pretrained walking policy from unitree_rl_gym, scaled to the spec 35 kg (the model file weighs 32 kg).",
    "Official specs: 1.32 m, 35 kg, aluminium-alloy frame, carbon-fibre composite shells, 9 Ah / 46.8 V (0.42 kWh) battery, PMSM joint motors up to 120 N m.",
    "Assumed: NdFeB SH magnets, class H windings, commercial-grade compute. Internal layout guessed.",
  ],
  mechanics: { kind: "humanoid", robot: "g1" },
  massKg: 35,
  exteriorAreaM2: 1.1,
  charLengthM: 0.12,
  skin: { material: "cfrp", massKg: 3, emissivity: 0.85 },
  frame: { material: "al6061", massKg: 12, loadFraction: 0.35 },
  enclosure: { kind: "open", internalExposure: 0.35 },
  insulation: { material: "aerogel", thicknessMm: 0 },
  electronics: { part: "siCommercial", solder: "sac305", massKg: 2, powerW: 60 },
  battery: { part: "liIon", capacityWh: 420 },
  motors: {
    magnet: "ndfebSH",
    winding: "classH",
    lubricant: "grease",
    massKg: 10,
    electricW: 300,
    heatFraction: 0.3,
    sizeFactor: 1,
  },
  camera: "cmos",
  payloadMassKg: 0,
  initialTempK: cToK(20),
};

const g1Hardened: VehicleBuild = {
  ...g1,
  id: "g1-hardened",
  name: "G1, Venus-hardened (hypothetical)",
  tagline: "What it takes: no silicon, no rare-earth magnets, no lithium.",
  fidelity: "hypothetical",
  mechanics: { kind: "humanoid", robot: "g1", finish: "titanium" },
  notes: [
    "Same body and walking policy as the G1, rebuilt from parts that are rated for 460 °C today.",
    "SiC JFET electronics (NASA Glenn, 60 days in GEER) on Pt/alumina boards; molten-salt thermal battery that only works when hot.",
    "Switched-reluctance motors (no magnets) with ceramic windings and MoS2 dry lubricant, 30% bigger to recover torque.",
    "Titanium frame and skin. The catch: SiC logic today is ~1970s-level integration, far too little compute for this walking policy.",
  ],
  massKg: 48,
  skin: { material: "ti64", massKg: 4, emissivity: 0.5 },
  frame: { material: "ti64", massKg: 16, loadFraction: 0.35 },
  electronics: { part: "sicJfet", solder: "ptHtcc", massKg: 3, powerW: 30 },
  battery: { part: "thermal", capacityWh: 1500 },
  motors: {
    magnet: "none",
    winding: "ceramic",
    lubricant: "mos2",
    massKg: 13,
    electricW: 400,
    heatFraction: 0.35,
    sizeFactor: 1.3,
  },
  camera: "hardened",
};

const venera13: VehicleBuild = {
  id: "venera13",
  name: "Venera 13 lander (1982)",
  tagline: "The record holder: 127 minutes on the surface.",
  fidelity: "calibrated",
  notes: [
    "Titanium pressure sphere, external insulation, lithium nitrate trihydrate heat sink, pre-chilled to −10 °C before entry. Lander mass 760 kg.",
    "Descent: parachute from ~62 km, released at 47 km, then free fall braked by a disk; ~1 h total, touchdown ~7.5 m/s.",
    "Hull size, insulation and PCM mass are not published in detail. They were tuned so the model reproduces the 127 min survival: this is a calibration, not a prediction.",
  ],
  mechanics: { kind: "static", shape: "lander" },
  massKg: 760,
  volumeM3: 2.5,
  exteriorAreaM2: 10,
  charLengthM: 2,
  skin: { material: "ti64", massKg: 40, emissivity: 0.8 },
  frame: { material: "ti64", massKg: 80, loadFraction: 0.3 },
  enclosure: {
    kind: "sealed",
    hull: { material: "ti64", radiusM: 0.5, thicknessMm: 12 },
    seal: "metal",
    // Low: Venera also had internal insulation between hull and equipment.
    internalH: 2.5,
  },
  insulation: { material: "veneraFoam", thicknessMm: 30 },
  electronics: { part: "siMilitary", solder: "snpb", massKg: 60, powerW: 300 },
  battery: { part: "silverZinc", capacityWh: 3000 },
  camera: "hardened",
  pcm: { material: "lnt", massKg: 40 },
  payloadMassKg: 150,
  initialTempK: cToK(-10),
  homeElevationM: 1500,
  descent: {
    stages: [
      { belowKm: 1000, cdA: 25, label: "Parachute" },
      { belowKm: 47, cdA: 3.7, label: "Aerobraking disk" },
    ],
  },
};

const sealedBox: VehicleBuild = {
  id: "box",
  name: "Sealed probe (custom)",
  tagline: "A blank pressure sphere to play with.",
  fidelity: "hypothetical",
  notes: ["A 60 cm titanium sphere with insulation and a heat sink. Tweak everything."],
  mechanics: { kind: "static", shape: "box" },
  massKg: 120,
  volumeM3: 0.2,
  exteriorAreaM2: 1.8,
  charLengthM: 0.75,
  skin: { material: "ti64", massKg: 5, emissivity: 0.8 },
  frame: { material: "ti64", massKg: 10, loadFraction: 0.3 },
  enclosure: {
    kind: "sealed",
    hull: { material: "ti64", radiusM: 0.3, thicknessMm: 8 },
    seal: "metal",
    internalH: 6,
  },
  insulation: { material: "microporous", thicknessMm: 50 },
  electronics: { part: "siCommercial", solder: "sac305", massKg: 2, powerW: 20 },
  battery: { part: "liIon", capacityWh: 200 },
  pcm: { material: "ice", massKg: 5 },
  payloadMassKg: 20,
  initialTempK: cToK(20),
  descent: {
    stages: [{ belowKm: 1000, cdA: 1.2, label: "Free fall" }],
  },
};

const cat262: VehicleBuild = {
  id: "cat262",
  name: "CAT 262D3 skid steer",
  tagline: "Stock diesel machine. It can't even start.",
  fidelity: "approximation",
  notes: [
    "Official specs: 3,763 kg operating weight, 2.99 m long (3.71 m with bucket), 2.11 m tall, 1.68 m wide over 12x16.5 tyres, 55.4 kW Cat C3.3B diesel, 1,225 kg rated capacity.",
    "Venus air has no oxygen to burn, so the stock diesel cannot run at all. Switch the powerplant to battery-electric to see what else fails.",
    "Assumed: steel frame and panels (quenched & tempered steel), polyester powder-coat paint, rubber tyres, mineral hydraulic oil with nitrile seals, automotive-grade ECU, 12 V lead-acid starter battery.",
    "Mechanics: a rigid-body skid-steer in MuJoCo with the real footprint and mass on the same Venera heightfield; the lift arms are held by a hydraulic position actuator.",
  ],
  mechanics: { kind: "wheeled", model: "skidsteer" },
  massKg: 3763,
  exteriorAreaM2: 22,
  charLengthM: 1.6,
  skin: { material: "steel4140", massKg: 450, emissivity: 0.9 },
  paint: "powderCoat",
  frame: { material: "steel4140", massKg: 2300, loadFraction: 0.3 },
  enclosure: { kind: "open", internalExposure: 0.35 },
  insulation: { material: "aerogel", thicknessMm: 0 },
  electronics: { part: "siAutomotive", solder: "sac305", massKg: 4, powerW: 60 },
  battery: { part: "leadAcid", capacityWh: 1100 },
  motors: {
    magnet: "ndfebSH",
    winding: "classH",
    lubricant: "grease",
    massKg: 120,
    electricW: 20000,
    heatFraction: 0.12,
    sizeFactor: 1,
  },
  tires: { material: "tireRubber", massKg: 180 },
  hydraulics: { part: "mineral", massKg: 60 },
  powerplant: { kind: "diesel", powerKw: 55.4 },
  payloadMassKg: 0,
  initialTempK: cToK(20),
};

export const VEHICLES: VehicleBuild[] = [optimus, g1, g1Hardened, cat262, venera13, sealedBox];

export function vehicleById(id: string): VehicleBuild | undefined {
  return VEHICLES.find((v) => v.id === id);
}
