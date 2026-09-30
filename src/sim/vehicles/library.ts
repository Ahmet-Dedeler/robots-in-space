/**
 * Preset vehicles. Every number here is either from a public spec sheet, a
 * mission paper, or an explicit guess (see `notes`). Fidelity labels say
 * which.
 */
import { cToK } from "../constants";
import type { VehicleBuild } from "./types";

/**
 * Torque fraction below which the stock unitree_rl_gym walking policy falls
 * over under Venus gravity + 65 kg/m^3 CO2 (MuJoCo sweep in
 * tools/, 15 s rollouts at 0.5 m/s command). G1 still walks, slower, at 0.6.
 */
export const WALK_TORQUE_MIN = { g1: 0.58, h1: 0.63 } as const;

const optimus: VehicleBuild = {
  id: "optimus",
  name: "Tesla Optimus (approx.)",
  tagline: "Stock humanoid, dropped on the surface as-is.",
  fidelity: "approximation",
  notes: [
    "No public CAD or model exists. Mechanics use the Unitree H1 body (1.8 m, 47 kg) as a stand-in with its real walking policy.",
    "Thermal/material numbers from public Optimus Gen 2 specs: ~57 kg, ~1.73 m, 2.3 kWh pack in the torso, automotive-grade AI computer.",
    "Actuator magnets assumed NdFeB SH grade and class H windings (typical for EV/robot motors); frame assumed aluminum.",
  ],
  mechanics: { kind: "humanoid", robot: "h1", finish: "white" },
  massKg: 57,
  volumeM3: 0.05,
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
    "Mechanics: official Unitree MJCF + pretrained walking policy from unitree_rl_gym (runs in your browser).",
    "Thermal: 35 kg, ~0.5 kWh battery (9 Ah @ 54 V), aluminum + engineering plastic body. Internal layout guessed.",
  ],
  mechanics: { kind: "humanoid", robot: "g1" },
  massKg: 35,
  volumeM3: 0.03,
  exteriorAreaM2: 1.1,
  charLengthM: 0.12,
  skin: { material: "pcabs", massKg: 3, emissivity: 0.9 },
  frame: { material: "al6061", massKg: 12, loadFraction: 0.35 },
  enclosure: { kind: "open", internalExposure: 0.35 },
  insulation: { material: "aerogel", thicknessMm: 0 },
  electronics: { part: "siCommercial", solder: "sac305", massKg: 2, powerW: 60 },
  battery: { part: "liIon", capacityWh: 486 },
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

export const VEHICLES: VehicleBuild[] = [optimus, g1, g1Hardened, venera13, sealedBox];

export function vehicleById(id: string): VehicleBuild | undefined {
  return VEHICLES.find((v) => v.id === id);
}
