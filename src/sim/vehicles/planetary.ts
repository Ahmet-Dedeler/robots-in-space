/**
 * Vehicles for the Moon, Mars and Mercury. Where a real mission flew, its
 * record is the test: Pragyan never woke from its first lunar night, Yutu-2
 * has slept through dozens, Curiosity runs on its RTG year-round, and
 * Opportunity lasted 14 years on sunlight until a planet-wide dust storm
 * starved it. Numbers from mission papers or press kits unless marked as
 * guesses in `notes`.
 */
import { cToK } from "../constants";
import type { VehicleBuild } from "./types";

const pragyan: VehicleBuild = {
  id: "pragyan",
  name: "Pragyan rover (Chandrayaan-3, 2023)",
  tagline: "Built for one lunar day. Never woke from its first night.",
  fidelity: "approximation",
  notes: [
    "ISRO specs: 26 kg, 917 x 750 x 397 mm, six-wheel rocker-bogie, 50 W solar panel, Li-ion battery, ~1 cm/s top speed.",
    "Landed at 69.4°S at local sunrise on 23 Aug 2023, drove ~100 m, and was put to sleep on 2 Sep with a charged battery and its receiver on. It never answered again.",
    "No radioisotope heaters and no night-survival design: ISRO said a wake-up would be a bonus. The model predicts why it didn't.",
    "Guessed: battery capacity, avionics grade (automotive-class), insulation, power split.",
  ],
  // ~100 m driven in its ~10-day mission.
  mechanics: { kind: "rover", model: "pragyan", speedMs: 0.01, dutyCycle: 0.012 },
  massKg: 26,
  exteriorAreaM2: 2.2,
  charLengthM: 0.6,
  skin: { material: "al6061", massKg: 3, emissivity: 0.5, absorptivity: 0.4 },
  frame: { material: "al6061", massKg: 7, loadFraction: 0.2 },
  enclosure: { kind: "box", wall: { material: "al6061", areaM2: 1.2, thicknessMm: 1.5 }, internalH: 3 },
  insulation: { material: "vacuumMli", thicknessMm: 10 },
  radiator: { areaM2: 0.05, openAboveK: cToK(30) },
  electronics: { part: "siAutomotive", solder: "snpb", massKg: 3, powerW: 20 },
  battery: { part: "liIon", capacityWh: 150 },
  motors: { magnet: "ndfebSH", winding: "classH", lubricant: "pfpe", massKg: 3, electricW: 15, heatFraction: 0.4, sizeFactor: 1 },
  camera: "cmos",
  solar: { areaM2: 0.2, efficiency: 0.28, mount: "vertical" },
  hibernate: { sleepW: 1 },
  payloadMassKg: 4,
  initialTempK: cToK(20),
  home: { body: "moon", siteId: "chandrayaan3", localHour: 7, lsDeg: 0, dustTau: 0 },
};

const yutu2: VehicleBuild = {
  id: "yutu2",
  name: "Yutu-2 rover (Chang'e 4, 2019-)",
  tagline: "Far side of the Moon. Sleeps through every night; still working years later.",
  fidelity: "calibrated",
  notes: [
    "CNSA specs: 135 kg, 1.5 x 1.0 x 1.1 m, six wheels, two solar wings, ~200 m/h max. Landed in Von Kármán crater on 3 Jan 2019.",
    "Night survival: it powers down completely for each 14-day night and wakes when light hits the array. Radioisotope heat (Pu-238) is carried into the body by a two-phase fluid loop, and one wing folds over the body as a lid.",
    "The heat-unit wattage and insulation are not published: tuned so the electronics stay above their -55 °C survival rating through a -190 °C night. Calibration, not prediction.",
  ],
  // ~1.6 km in five years: a few tens of metres per lunar day.
  mechanics: { kind: "rover", model: "yutu", speedMs: 0.055, dutyCycle: 0.0004 },
  massKg: 135,
  exteriorAreaM2: 4.5,
  charLengthM: 1.2,
  skin: { material: "al6061", massKg: 10, emissivity: 0.5, absorptivity: 0.35 },
  frame: { material: "al6061", massKg: 35, loadFraction: 0.2 },
  enclosure: { kind: "box", wall: { material: "al6061", areaM2: 2.6, thicknessMm: 2 }, internalH: 3 },
  insulation: { material: "vacuumMli", thicknessMm: 30 },
  radiator: { areaM2: 0.35, openAboveK: cToK(25) },
  electronics: { part: "siMilitary", solder: "snpb", massKg: 12, powerW: 60 },
  battery: { part: "liIon", capacityWh: 800 },
  motors: { magnet: "ndfebSH", winding: "polyimide", lubricant: "pfpe", massKg: 10, electricW: 10, heatFraction: 0.4, sizeFactor: 1 },
  camera: "hardened",
  solar: { areaM2: 1.0, efficiency: 0.22, mount: "tracking" },
  hibernate: { sleepW: 0 },
  rhuW: 45,
  payloadMassKg: 30,
  initialTempK: cToK(20),
  home: { body: "moon", siteId: "change4", localHour: 8, lsDeg: 0, dustTau: 0 },
};

const lunokhod1: VehicleBuild = {
  id: "lunokhod1",
  name: "Lunokhod 1 (Luna 17, 1970-71)",
  tagline: "The first rover on another world. Drove 10.5 km until its polonium heater faded.",
  fidelity: "calibrated",
  notes: [
    "Soviet specs: 756 kg (some sources give 840 kg, Lunokhod 2's mass), 1.35 m high, 1.7 m long, 1.6 m wide, eight independently driven wire-mesh wheels, two speeds (~0.8 and ~2 km/h), 180 W solar array on the inside of a hinged lid.",
    "A sealed magnesium-alloy tub held the electronics in pressurised gas that fans circulated past radiators. At night the lid closed over the tub and a polonium-210 heat source kept the inside warm.",
    "Po-210 has a 138-day half-life. Designed for three lunar days, Lunokhod 1 ran eleven (Nov 1970 to Sep 1971, 10.54 km) and stopped when the heat source had faded too far to carry it through the night.",
    "Heat-source power, insulation and battery are not published in detail. A 1.3 kW source (behind a thermostatic valve, like the real gas loop) reproduces the end: nights get colder from the seventh on, and the electronics freeze around day 300 (real: last contact on day 301). Calibration, not prediction.",
  ],
  // 10.54 km in ~11 lunar days of driving at ~0.8 km/h.
  mechanics: { kind: "rover", model: "lunokhod", speedMs: 0.22, dutyCycle: 0.0042 },
  massKg: 756,
  exteriorAreaM2: 9,
  charLengthM: 1.6,
  skin: { material: "az31", massKg: 30, emissivity: 0.8, absorptivity: 0.3 },
  frame: { material: "az31", massKg: 120, loadFraction: 0.2 },
  enclosure: { kind: "sealed", hull: { material: "az31", radiusM: 0.75, thicknessMm: 3 }, seal: "viton", internalH: 3 },
  insulation: { material: "vacuumMli", thicknessMm: 25 },
  // The radiator ring around the top of the tub (closed by the lid at night).
  radiator: { areaM2: 1.5, openAboveK: cToK(15) },
  electronics: { part: "siMilitary", solder: "snpb", massKg: 80, powerW: 60 },
  battery: { part: "silverZinc", capacityWh: 3000 },
  motors: { magnet: "ndfebSH", winding: "polyimide", lubricant: "mos2", massKg: 40, electricW: 10, heatFraction: 0.4, sizeFactor: 1 },
  camera: "hardened",
  // ~180 W at noon from the lid's cells.
  solar: { areaM2: 1.4, efficiency: 0.12, mount: "horizontal" },
  hibernate: { sleepW: 0 },
  // ~9 g of Po-210 (140 W/g). Tuned: see notes.
  rhuW: 1300,
  rhuHalfLifeDays: 138.4,
  rhuValveK: cToK(5),
  payloadMassKg: 200,
  initialTempK: cToK(20),
  home: { body: "moon", siteId: "lunokhod1", localHour: 8, lsDeg: 0, dustTau: 0, maxDays: 330 },
};

const curiosity: VehicleBuild = {
  id: "curiosity",
  name: "Curiosity rover (MSL, 2012-)",
  tagline: "Nuclear-powered: no night, winter or dust storm stops it.",
  fidelity: "approximation",
  notes: [
    "JPL specs: 899 kg, 3.0 m long, MMRTG ~110 W electric / ~2,000 W thermal at launch, two 43 Ah Li-ion batteries (~2.4 kWh), RAD750 avionics, ~150 m/h on the flat.",
    "A pumped fluid loop carries RTG waste heat into the warm electronics box and batteries; the rest leaves through the RTG fins.",
    "Actuators use Braycote 601EF grease (rated -80 °C) and are still warmed on cold mornings before driving.",
    "Guessed: share of RTG heat piped inside, insulation thickness, average avionics draw.",
  ],
  // ~35 km in 12 years, ~8 m per sol on average.
  mechanics: { kind: "rover", model: "msl", speedMs: 0.04, dutyCycle: 0.002 },
  massKg: 899,
  exteriorAreaM2: 14,
  charLengthM: 2,
  skin: { material: "al6061", massKg: 60, emissivity: 0.85, absorptivity: 0.5 },
  frame: { material: "ti64", massKg: 180, loadFraction: 0.2 },
  enclosure: { kind: "box", wall: { material: "al6061", areaM2: 5, thicknessMm: 3 }, internalH: 3 },
  insulation: { material: "aerogel", thicknessMm: 25 },
  radiator: { areaM2: 0.6, openAboveK: cToK(30) },
  electronics: { part: "siMilitary", solder: "snpb", massKg: 45, powerW: 70 },
  battery: { part: "liIonSpace", capacityWh: 2400 },
  // Drive + arm actuators, averaged over a sol's duty cycle (a few hours of driving).
  motors: { magnet: "ndfebSH", winding: "polyimide", lubricant: "pfpe", massKg: 60, electricW: 40, heatFraction: 0.4, sizeFactor: 1 },
  camera: "hardened",
  rtg: { electricW: 110, thermalW: 2000, interiorFraction: 0.08 },
  heaters: { electricW: 60, setpointK: cToK(-30) },
  hibernate: { sleepW: 15 },
  payloadMassKg: 150,
  initialTempK: cToK(10),
  home: { body: "mars", siteId: "gale", localHour: 10, lsDeg: 150, dustTau: 0.5 },
};

const opportunity: VehicleBuild = {
  id: "opportunity",
  name: "Opportunity rover (MER-B, 2004-2018)",
  tagline: "90-sol warranty, 5,111 sols of sunlight. Try the 2018 dust storm.",
  fidelity: "approximation",
  notes: [
    "JPL specs: 185 kg, 1.3 m² triple-junction GaInP/GaAs/Ge array (~27%), two 8 Ah Li-ion batteries (~500 Wh), eight 1 W radioisotope heater units, warm electronics box insulated with aerogel.",
    "Dust settling on the array costs ~0.15% of output per sol (cleaning gusts, which kept Opportunity alive for years, aren't modelled).",
    "Set dust opacity to ~10.8 to recreate June 2018: the array fell to a few percent of normal, and Opportunity went silent on sol 5111, about 11 sols into the storm.",
    "The 2007 storm (opacity ~5) it survived only because the team switched off heaters and ran on ~130 Wh/sol; this preset keeps its heaters on, so it doesn't.",
    "Guessed: heater setpoint and wattage, average avionics draw.",
  ],
  // 45 km in 5,111 sols, ~9 m per sol on average.
  mechanics: { kind: "rover", model: "mer", speedMs: 0.05, dutyCycle: 0.002 },
  massKg: 185,
  exteriorAreaM2: 5,
  charLengthM: 1.2,
  skin: { material: "al6061", massKg: 12, emissivity: 0.85, absorptivity: 0.5 },
  frame: { material: "ti64", massKg: 40, loadFraction: 0.2 },
  enclosure: { kind: "box", wall: { material: "al6061", areaM2: 2, thicknessMm: 2 }, internalH: 3 },
  insulation: { material: "aerogel", thicknessMm: 50 },
  electronics: { part: "siMilitary", solder: "snpb", massKg: 15, powerW: 35 },
  battery: { part: "liIonSpace", capacityWh: 500 },
  motors: { magnet: "ndfebSH", winding: "polyimide", lubricant: "pfpe", massKg: 10, electricW: 8, heatFraction: 0.4, sizeFactor: 1 },
  camera: "hardened",
  solar: { areaM2: 1.3, efficiency: 0.27, mount: "horizontal" },
  hibernate: { sleepW: 3 },
  rhuW: 8,
  heaters: { electricW: 20, setpointK: cToK(-30) },
  payloadMassKg: 25,
  initialTempK: cToK(10),
  home: { body: "mars", siteId: "meridiani", localHour: 10, lsDeg: 340, dustTau: 0.5 },
};

const dawnCrawler: VehicleBuild = {
  id: "dawn-crawler",
  name: "Mercury dawn crawler (hypothetical)",
  tagline: "Rides the sunrise at 70°N: prospect, build, never see noon.",
  fidelity: "hypothetical",
  notes: [
    "A concept for robots that mine and build on Mercury: at 70°N the day-night line moves at only 0.34 m/s, so a rover driving 0.4 m/s west can stay at local dawn forever.",
    "Dawn means low Sun (vertical solar panels work best), ground around 0 °C, and enough light to run. Stop and the day catches up: noon ground here is ~270 °C.",
    "Everything is a design guess: aluminium body, MLI blankets, space-grade silicon, Li-ion with heaters.",
  ],
  mechanics: { kind: "rover", model: "crawler", speedMs: 0.4, dutyCycle: 1 },
  massKg: 250,
  exteriorAreaM2: 7,
  charLengthM: 1.4,
  skin: { material: "al6061", massKg: 15, emissivity: 0.8, absorptivity: 0.2 },
  frame: { material: "ti64", massKg: 60, loadFraction: 0.2 },
  enclosure: { kind: "box", wall: { material: "al6061", areaM2: 3, thicknessMm: 2 }, internalH: 3 },
  insulation: { material: "vacuumMli", thicknessMm: 20 },
  radiator: { areaM2: 0.4, openAboveK: cToK(25) },
  electronics: { part: "siMilitary", solder: "snpb", massKg: 15, powerW: 80 },
  battery: { part: "liIon", capacityWh: 2000 },
  motors: { magnet: "smco", winding: "polyimide", lubricant: "pfpe", massKg: 25, electricW: 150, heatFraction: 0.4, sizeFactor: 1 },
  camera: "hardened",
  solar: { areaM2: 1.5, efficiency: 0.28, mount: "vertical" },
  heaters: { electricW: 40, setpointK: cToK(-30) },
  payloadMassKg: 40,
  initialTempK: cToK(20),
  home: { body: "mercury", siteId: "mercury70N", localHour: 7, lsDeg: 0, dustTau: 0, chaseSun: true },
};

export const PLANETARY_VEHICLES: VehicleBuild[] = [lunokhod1, pragyan, yutu2, curiosity, opportunity, dawnCrawler];
