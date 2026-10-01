/**
 * Rocket landers: Starship, Falcon 9 and New Glenn first stages, the Apollo
 * Lunar Module. They fly a powered descent (spacecraft/landing.ts) and, if
 * they get down in one piece, sit through the usual thermal survival run.
 *
 * Propulsion figures are published; masses of the reusable stages and every
 * tank pressure are estimates (flagged per line). Thermal builds are rough:
 * avionics in unpressurised bays with no insulation, as on the real stages.
 */
import { cToK } from "../constants";
import type { VehicleBuild } from "./types";

const starship: VehicleBuild = {
  id: "starship-v3",
  name: "Starship V3 (ship)",
  tagline: "SpaceX's 52 m upper stage, landing on three Raptor 3s.",
  fidelity: "approximation",
  notes: [
    "V3 / Block 3 ship: 9 m diameter, ~52 m tall (124.4 m stack minus the 72.3 m Super Heavy), 1,600 t of propellant when full, 3 sea-level + 3 vacuum Raptor 3s. Lands on the 3 sea-level engines (gimballed), as on Earth.",
    "Raptor 3: 2.75 MN (280 tf) at sea level, 350 bar chamber. Its thrust at other pressures comes from the nozzle model (engines.ts).",
    "Guessed (not published): ~120 t dry, 6 bar tank pressure, 3 m/s legs (V3 has no legs; lunar/Mars ships will), 200 t of landing propellant, 50 kWh of batteries, avionics drawing 3 kW.",
    "Descent starts after entry: belly-first skydive in air, then the flip. On the Moon and Mercury it starts in a 15 km orbit.",
    "Steel tanks are pressure-stabilised: on Venus they buckle once the air outside beats the ~6 bar inside. 'Flood the tanks' vents the empty main tanks to the outside instead.",
  ],
  mechanics: { kind: "spacecraft", model: "starship" },
  massKg: 120_000,
  exteriorAreaM2: 1_600,
  charLengthM: 9,
  // SpaceX's 30X stainless is proprietary; 316 is the closest austenitic grade in the table. Black tiles cover the windward half.
  skin: { material: "ss316", massKg: 60_000, emissivity: 0.6 },
  frame: { material: "ss316", massKg: 25_000, loadFraction: 0.3 },
  enclosure: { kind: "open", internalExposure: 0.2 },
  insulation: { material: "aerogel", thicknessMm: 0 },
  electronics: { part: "siAutomotive", solder: "sac305", massKg: 300, powerW: 3000 },
  battery: { part: "liIon", capacityWh: 50_000 },
  payloadMassKg: 30_000,
  initialTempK: cToK(15),
  home: { body: "mars", siteId: "jezero", localHour: 10, lsDeg: 150, dustTau: 0.5 },
  propulsion: {
    engine: "raptor3",
    engines: 6,
    landingEngines: 3,
    propellantKg: 200_000,
    capacityKg: 1_600_000,
    tanks: { pressureBar: 6, collapseMarginBar: 0.3, volumeM3: 2_500, flood: false },
    aero: {
      // ~52 m tall with the ogive nose; the cylinder plus most of the nose acts as ~50 m x 9 m in crossflow.
      lengthM: 50,
      diameterM: 9,
      // Two aft + two forward flaps: ~110 m^2, measured on the 3D model (aft 11.9 x 3.4 m each, forward ~6.5 x 2.4 m). Not published.
      fins: { areaM2: 110, facing: "normal" },
      // Not published. Flight-test webcasts show a ~60° entry (belly down, nose up) and a ~90° belly flop
      // in the subsonic skydive (SN8-SN15). Approximation.
      belly: { entryAoADeg: 60, skydiveAoADeg: 90 },
    },
    tps: {
      // ~18,000 hexagonal silica tiles on the windward half. Thickness unpublished: 25 mm is a guess.
      // Skin: 4 mm stainless (early prototype rings; V3 not published).
      windward: { tile: { id: "li900", thicknessMm: 25 }, skin: { material: "ss316", thicknessMm: 4 } },
      base: { skin: { material: "ss316", thicknessMm: 4 } },
      lee: { skin: { material: "ss316", thicknessMm: 4 } },
      // Shadowed leeward steel: a few % of the windward flux (guess; it flies bare on Earth entry).
      leeShare: 0.03,
    },
    legs: { ratedMs: 3, breakMs: 8 },
  },
};

const falcon9: VehicleBuild = {
  id: "falcon9-b5",
  name: "Falcon 9 booster (Block 5)",
  tagline: "The workhorse first stage, landing on one Merlin 1D.",
  fidelity: "approximation",
  notes: [
    "First stage: 41.2 m, 3.66 m diameter, 22.2 t dry, ~395 t of propellant when full; 9 Merlin 1Ds, lands on the centre one.",
    "Merlin 1D: 845 kN and 282 s at sea level, 9.7 MPa chamber, area ratio 16, throttles to 40%. The nozzle model gives 311 s in vacuum, matching the published figure.",
    "Guessed: 20 t of propellant left for landing (SpaceX doesn't publish margins), ~3.5 bar tank pressure, legs rated 4 m/s.",
    "Even at minimum throttle one Merlin out-lifts an empty booster, so it can't hover: every landing is a hoverslam.",
  ],
  mechanics: { kind: "spacecraft", model: "falcon9" },
  massKg: 22_200,
  exteriorAreaM2: 490,
  charLengthM: 3.66,
  // Aluminium-lithium (2195/2198) tanks; 2219 is the nearest alloy in the table.
  skin: { material: "al2219", massKg: 8_000, emissivity: 0.85 },
  frame: { material: "al2219", massKg: 6_000, loadFraction: 0.3 },
  enclosure: { kind: "open", internalExposure: 0.3 },
  insulation: { material: "aerogel", thicknessMm: 0 },
  electronics: { part: "siAutomotive", solder: "sac305", massKg: 100, powerW: 1000 },
  battery: { part: "liIon", capacityWh: 10_000 },
  payloadMassKg: 7_800,
  initialTempK: cToK(15),
  homeElevationM: 0,
  builtFor: "Earth",
  propulsion: {
    engine: "merlin1d",
    engines: 9,
    landingEngines: 1,
    propellantKg: 20_000,
    capacityKg: 395_000,
    tanks: { pressureBar: 3.5, collapseMarginBar: 0.2, volumeM3: 380, flood: false },
    aero: {
      // First stage plus interstage (the 3D model: 48.7 m).
      lengthM: 47.7,
      diameterM: 3.66,
      // Four titanium grid fins, ~1.5 m^2 each, facing the flow when it falls engines-first. Approximation.
      fins: { areaM2: 6, facing: "axial" },
    },
    tps: {
      // Al-Li tank walls, ~4.5 mm (not published, guess). The base carries a heat shield over the engines (type unpublished).
      windward: { skin: { material: "al2219", thicknessMm: 4.5 } },
      base: { tile: { id: "ceramicBlanket", thicknessMm: 20 }, skin: { material: "al2219", thicknessMm: 6 } },
      lee: { skin: { material: "al2219", thicknessMm: 4.5 } },
      // Flanks of a stage falling tail-first: a small share of the base's stagnation flux (guess).
      leeShare: 0.05,
    },
    // Earth drone-ship returns: the entry burn ends around 1.3-1.6 km/s (webcast telemetry; SpaceX doesn't publish). Guess.
    entryBurn: { targetMs: 1500, maxShare: 0.5 },
    legs: { ratedMs: 4, breakMs: 10 },
  },
};

const newGlenn: VehicleBuild = {
  id: "new-glenn-gs1",
  name: "New Glenn booster (GS1)",
  tagline: "Blue Origin's 7 m first stage, landing on BE-4s.",
  fidelity: "approximation",
  notes: [
    "GS1: 57.5 m tall, 7 m diameter, seven BE-4s, six landing legs. Tanks: 850 m^3 LOX + 710 m^3 methane, ~1,270 t of propellant when full.",
    "BE-4: 2,450 kN at sea level, 13.4 MPa chamber. Area ratio and Isp guessed (20, 310 s).",
    "Guessed: ~100 t dry, 60 t of landing propellant, starts the landing burn on three engines and drops to one, ~3.5 bar tanks, legs rated 4 m/s.",
  ],
  mechanics: { kind: "spacecraft", model: "newglenn" },
  massKg: 100_000,
  exteriorAreaM2: 1_340,
  charLengthM: 7,
  // Assumed aluminium tanks.
  skin: { material: "al2219", massKg: 35_000, emissivity: 0.85 },
  frame: { material: "al2219", massKg: 25_000, loadFraction: 0.3 },
  enclosure: { kind: "open", internalExposure: 0.3 },
  insulation: { material: "aerogel", thicknessMm: 0 },
  electronics: { part: "siAutomotive", solder: "sac305", massKg: 200, powerW: 2000 },
  battery: { part: "liIon", capacityWh: 20_000 },
  payloadMassKg: 39_700,
  initialTempK: cToK(15),
  homeElevationM: 0,
  builtFor: "Earth",
  propulsion: {
    engine: "be4",
    engines: 7,
    landingEngines: 3,
    propellantKg: 60_000,
    capacityKg: 1_270_000,
    tanks: { pressureBar: 3.5, collapseMarginBar: 0.3, volumeM3: 1_560, flood: false },
    aero: {
      lengthM: 57.5,
      diameterM: 7,
      // Four aft fins and two forward strakes (~40 m^2, guess): edge-on in a tail-first fall, they bite at an angle.
      fins: { areaM2: 40, facing: "normal" },
    },
    tps: {
      windward: { skin: { material: "al2219", thicknessMm: 6 } },
      base: { tile: { id: "ceramicBlanket", thicknessMm: 20 }, skin: { material: "al2219", thicknessMm: 6 } },
      lee: { skin: { material: "al2219", thicknessMm: 6 } },
      leeShare: 0.05,
    },
    entryBurn: { targetMs: 1500, maxShare: 0.5 },
    legs: { ratedMs: 4, breakMs: 10 },
  },
};

const apolloLm: VehicleBuild = {
  id: "apollo-lm",
  name: "Apollo Lunar Module (Eagle)",
  tagline: "Apollo 11's lander: 12 minutes from orbit to Tranquility Base.",
  fidelity: "approximation",
  notes: [
    "LM-5 Eagle: 15,103 kg at launch = 2,034 kg descent stage + 8,248 kg descent propellant + 4,821 kg ascent stage. After the descent orbit insertion burn ~8,100 kg of propellant remains for the powered descent.",
    "Descent engine (LMDE): 45 kN in vacuum, Isp ~311 s, pressure-fed at only ~7 bar in the chamber, throttle 10-100%.",
    "Apollo 11 started powered descent ~15 km up and landed 12.6 min later with ~45 s of propellant left. This model's guidance is more economical than Armstrong's boulder-dodging, so it keeps more in reserve.",
    "Legs rated 10 ft/s (3 m/s) vertical. Aluminium cabin a fraction of a millimetre thick, pressurised to 0.33 bar; silver-zinc batteries (~2,250 Ah at 28 V); military-grade electronics. Crew not modelled.",
  ],
  mechanics: { kind: "spacecraft", model: "lm" },
  massKg: 6_855,
  volumeM3: 12,
  exteriorAreaM2: 70,
  charLengthM: 4.2,
  skin: { material: "al2219", massKg: 400, emissivity: 0.3, absorptivity: 0.3 },
  frame: { material: "al2219", massKg: 1_500, loadFraction: 0.3 },
  enclosure: {
    kind: "sealed",
    hull: { material: "al2219", radiusM: 1.17, thicknessMm: 0.6 },
    seal: "viton",
    internalH: 3,
  },
  insulation: { material: "vacuumMli", thicknessMm: 25 },
  electronics: { part: "siMilitary", solder: "snpb", massKg: 300, powerW: 1000 },
  battery: { part: "silverZinc", capacityWh: 63_000 },
  payloadMassKg: 3_500,
  initialTempK: cToK(20),
  home: { body: "moon", siteId: "apollo11", localHour: 7, lsDeg: 150, dustTau: 0 },
  propulsion: {
    engine: "lmde",
    engines: 1,
    landingEngines: 1,
    propellantKg: 8_100,
    capacityKg: 8_248,
    // Titanium propellant tanks at ~16 bar (helium pressurant); stiff small shells.
    tanks: { pressureBar: 16, collapseMarginBar: 2, volumeM3: 12, flood: false },
    // Not slender: 6.98 m tall, 4.22 m descent stage (Grumman LM news reference). Crude as a cylinder.
    aero: { lengthM: 6.98, diameterM: 4.22 },
    tps: {
      // Never meant to meet air: thin aluminium under Kapton/Mylar blankets.
      windward: { skin: { material: "al2219", thicknessMm: 0.6 } },
      base: { skin: { material: "al2219", thicknessMm: 0.6 } },
      lee: { skin: { material: "al2219", thicknessMm: 0.6 } },
      leeShare: 0.05,
    },
    legs: { ratedMs: 3, breakMs: 6 },
  },
};

export const SPACECRAFT: VehicleBuild[] = [starship, falcon9, newGlenn, apolloLm];
