/**
 * Construction and mining machines: the Cat machines people actually build
 * with on Earth, NASA's lunar excavator, and two concepts for what a working
 * machine would need on the Moon and on Venus.
 *
 * Mechanics live in robots/machines.ts (MuJoCo geometry from the same spec
 * sheets). Here: masses, materials and parts for the thermal model. Stock
 * machines are diesel; every one of them can be switched to battery-electric
 * in the UI, which fits `powerplant.electricPackWh` instead of the starter
 * battery.
 */
import { cToK } from "../constants";
import type { VehicleBuild } from "./types";

/** Shared by the stock Cat machines: steel, powder coat, automotive electronics, mineral hydraulics. */
const catStock = {
  fidelity: "approximation",
  enclosure: { kind: "open", internalExposure: 0.35 },
  insulation: { material: "aerogel", thicknessMm: 0 },
  paint: "powderCoat",
  electronics: { part: "siAutomotive", solder: "sac305", massKg: 6, powerW: 80 },
  payloadMassKg: 0,
  initialTempK: cToK(20),
} as const satisfies Partial<VehicleBuild>;

const CAT_ASSUMED =
  "Assumed for every stock Cat machine: quenched & tempered steel frame and panels, polyester powder-coat paint, mineral hydraulic oil with nitrile seals, automotive-grade ECUs, lead-acid starter batteries.";

export const cat299: VehicleBuild = {
  ...catStock,
  id: "cat299",
  name: "CAT 299D3 compact track loader",
  tagline: "The skid steer on rubber tracks. Same diesel problem, new ways to fail.",
  notes: [
    "Cat spec sheet: 5,200 kg operating weight, 73 kW Cat C3.8 diesel, 1,931 mm wide over 400 mm rubber tracks, 1,767 mm of track on the ground, vertical lift, 1,580 kg rated capacity.",
    "Rubber tracks are steel cords moulded into rubber. On Venus the rubber pyrolyses off the cords and the machine settles onto its bare rollers.",
    CAT_ASSUMED,
    "Electric conversion: 60 kWh pack (the class of today's electric compact track loaders, e.g. Bobcat's T7X at 62 kWh).",
  ],
  mechanics: { kind: "wheeled", model: "trackloader" },
  massKg: 5200,
  exteriorAreaM2: 26,
  charLengthM: 1.7,
  skin: { material: "steel4140", massKg: 520, emissivity: 0.9 },
  frame: { material: "steel4140", massKg: 3100, loadFraction: 0.3 },
  battery: { part: "leadAcid", capacityWh: 1100 },
  motors: { magnet: "ndfebSH", winding: "classH", lubricant: "grease", massKg: 150, electricW: 25_000, heatFraction: 0.12, sizeFactor: 1 },
  tires: { material: "tireRubber", massKg: 520, kind: "tracks" },
  hydraulics: { part: "mineral", massKg: 80 },
  powerplant: { kind: "diesel", powerKw: 73, electricPackWh: 60_000 },
  camera: "cmos",
};

export const catD6: VehicleBuild = {
  ...catStock,
  id: "catd6",
  name: "CAT D6 dozer",
  tagline: "22 tonnes of steel on steel tracks. The tracks will outlive everything else.",
  notes: [
    "Cat spec sheet (standard push arm, 6SU blade): 22,130 kg, 161 kW Cat C9.3B, 1,930 mm track gauge, 610 mm shoes, 2,964 mm of track on the ground, 54 kPa ground pressure, 3,188 mm high, 5,436 mm long with the 3.31 m x 1.41 m blade, elevated sprocket, 11.7 km/h top speed.",
    "Steel track shoes shrug off 460 °C (they keep ~60% of their strength), so on Venus the dozer is limited by its hydraulics, electronics and engine, not its running gear.",
    CAT_ASSUMED,
    "Electric conversion: 300 kWh pack (guess, sized like Cat's 320 electric prototype). Cat already sells the D6 XE with electric drive, but it's diesel-electric: the engine still needs oxygen.",
  ],
  mechanics: { kind: "wheeled", model: "dozer" },
  massKg: 22_130,
  exteriorAreaM2: 60,
  charLengthM: 2.8,
  skin: { material: "steel4140", massKg: 1400, emissivity: 0.9 },
  frame: { material: "steel4140", massKg: 14_500, loadFraction: 0.3 },
  electronics: { part: "siAutomotive", solder: "sac305", massKg: 10, powerW: 150 },
  battery: { part: "leadAcid", capacityWh: 2400 },
  motors: { magnet: "ndfebSH", winding: "classH", lubricant: "grease", massKg: 700, electricW: 70_000, heatFraction: 0.08, sizeFactor: 1 },
  tires: { material: "steel4140", massKg: 3800, kind: "tracks" },
  hydraulics: { part: "mineral", massKg: 250 },
  powerplant: { kind: "diesel", powerKw: 161, electricPackWh: 300_000 },
  camera: "cmos",
};

export const cat320: VehicleBuild = {
  ...catStock,
  id: "cat320",
  name: "CAT 320 excavator",
  tagline: "The world's default 20-tonne digger. Watch the boom when the seals go.",
  notes: [
    "Cat spec sheet (5.7 m boom, 2.9 m stick, 1.19 m³ bucket): 21,700 kg, 128.5 kW Cat C4.4, 2,380 mm track gauge, 4,450 mm tracks with 2,690 kg of 600 mm triple-grouser shoes, 2,830 mm tail swing, 2,960 mm cab height, 350 bar hydraulics, 150 kN bucket digging force, 11.25 rpm swing.",
    "Hydraulics hold the boom up. When the nitrile seals leak, the boom, stick and bucket sink to the ground; the swing has a spring-applied brake, so it stays put.",
    CAT_ASSUMED,
    "Electric conversion: 300 kWh pack, like the battery-electric 320 prototypes Cat showed at Bauma 2022 (256-320 kWh, up to 8 h per charge).",
  ],
  mechanics: { kind: "wheeled", model: "excavator" },
  massKg: 21_700,
  exteriorAreaM2: 65,
  charLengthM: 2.5,
  skin: { material: "steel4140", massKg: 1200, emissivity: 0.9 },
  frame: { material: "steel4140", massKg: 13_500, loadFraction: 0.3 },
  electronics: { part: "siAutomotive", solder: "sac305", massKg: 10, powerW: 150 },
  battery: { part: "leadAcid", capacityWh: 2400 },
  // Electric conversion: an 8 h shift on 300 kWh averages ~35 kW.
  motors: { magnet: "ndfebSH", winding: "classH", lubricant: "grease", massKg: 600, electricW: 35_000, heatFraction: 0.1, sizeFactor: 1 },
  tires: { material: "steel4140", massKg: 2690, kind: "tracks" },
  hydraulics: { part: "mineral", massKg: 300 },
  powerplant: { kind: "diesel", powerKw: 128.5, electricPackWh: 300_000 },
  camera: "cmos",
};

export const venusDozer: VehicleBuild = {
  ...catD6,
  id: "venus-dozer",
  name: "D6, Venus-hardened (hypothetical)",
  tagline: "What earthmoving on Venus would take: no oil, no silicon, no lithium.",
  fidelity: "hypothetical",
  notes: [
    "Same body, mass and steel tracks as the D6. Everything that melts, boils or cracks at 460 °C is swapped for a part rated for it today.",
    "Drive: battery-electric, switched-reluctance motors (no magnets) with ceramic-insulated windings and MoS2 dry lubricant, 30% oversized for the weaker motors.",
    "Hydraulics: polyphenyl ether fluid with metal seals (jet-engine class, ~450 °C), the most heat-stable fluid there is. Venus is hotter, so the blade still drops once the oil soaks to ambient: a real Venus dozer would use electromechanical (ball-screw) actuators instead.",
    "Control: SiC JFET logic on Pt/alumina boards (NASA Glenn ran these for 60 days in Venus conditions). Power: a molten-salt thermal battery that only works when it's hot, which on Venus is free.",
    "The catch: SiC logic has ~1970s-level integration. Enough to run a teleoperated dozer, nowhere near enough for autonomy.",
  ],
  paint: undefined,
  skin: { material: "steel4140", massKg: 1400, emissivity: 0.8 },
  electronics: { part: "sicJfet", solder: "ptHtcc", massKg: 15, powerW: 60 },
  battery: { part: "thermal", capacityWh: 300_000 },
  motors: { magnet: "none", winding: "ceramic", lubricant: "mos2", massKg: 900, electricW: 70_000, heatFraction: 0.12, sizeFactor: 1.3 },
  hydraulics: { part: "ppe", massKg: 250 },
  powerplant: { kind: "electric", powerKw: 161, electricPackWh: 300_000 },
  camera: "hardened",
};

export const ipex: VehicleBuild = {
  id: "ipex",
  name: "NASA IPEx lunar excavator",
  tagline: "30 kg robot meant to dig 10 tonnes of regolith at the lunar south pole.",
  fidelity: "approximation",
  notes: [
    "NASA KSC design paper (Schuler et al., ASCEND 2024): 30 kg class, four-wheel skid steer with no suspension, two arms each with a pair of counter-rotating bucket drums, up to 30 kg of regolith per trip, 30 cm/s, 11-day mission moving 10 t (42 kg/h) for an oxygen-extraction plant.",
    "Counter-rotating drums cancel most of the digging force, so a 30 kg robot in 1/6 g can dig without the weight a Cat machine relies on for traction.",
    "Thermal design from the paper: the radiator stays covered against dust while digging and a phase-change heat sink soaks up the heat; once it has melted, IPEx stops, opens the cover and radiates it away.",
    "IPEx has no solar array: it recharges wirelessly at its lander. Modelled as the lander's vertical array feeding it. Guessed: battery size, PCM mass, dimensions, average power.",
  ],
  mechanics: { kind: "wheeled", model: "ipex" },
  massKg: 30,
  exteriorAreaM2: 1.0,
  charLengthM: 0.5,
  skin: { material: "al6061", massKg: 2, emissivity: 0.8, absorptivity: 0.3 },
  frame: { material: "al6061", massKg: 8, loadFraction: 0.2 },
  enclosure: { kind: "box", wall: { material: "al6061", areaM2: 0.45, thicknessMm: 1.5 }, internalH: 3 },
  insulation: { material: "vacuumMli", thicknessMm: 10 },
  electronics: { part: "siMilitary", solder: "snpb", massKg: 2, powerW: 30 },
  battery: { part: "liIonSpace", capacityWh: 500 },
  // ThinGap frameless motors + harmonic drives, greased (the paper's life tests flag the grease).
  motors: { magnet: "ndfebSH", winding: "polyimide", lubricant: "pfpe", massKg: 6, electricW: 150, heatFraction: 0.4, sizeFactor: 1 },
  tires: { material: "al6061", massKg: 6 },
  camera: "cmos",
  pcm: { material: "eicosane", massKg: 1.5 },
  radiator: { areaM2: 0.12, openAboveK: cToK(37) },
  solar: { areaM2: 0.6, efficiency: 0.3, mount: "vertical" },
  heaters: { electricW: 15, setpointK: cToK(-20) },
  payloadMassKg: 3,
  initialTempK: cToK(15),
  home: { body: "moon", siteId: "southPoleRidge", localHour: 8, lsDeg: 0, dustTau: 0 },
};

export const lunarLoader: VehicleBuild = {
  ...cat299,
  id: "lunar-loader",
  name: "Lunar construction loader (hypothetical)",
  tagline: "A track loader built for an Artemis base. Power is the real problem.",
  fidelity: "hypothetical",
  notes: [
    "Caterpillar and NASA have worked on lunar construction since 2007; their first lunar loader prototypes were remote-controlled Cat 287C multi-terrain loaders. This is a guess at a flight version on the 299D3 body.",
    "Cold-proofed: silicone tracks (flexible to -110 °C; ordinary rubber turns to glass at -55 °C), synthetic ester hydraulics, PFPE grease, samarium-cobalt motors, space-grade electronics and batteries in MLI jackets with heaters.",
    "Power: a 100 kWh pack and 10 m² of vertical solar panels for the low polar Sun. Digging draws ~25 kW, so it works a few hours, then spends most of a day recharging. A real base would run it off a fission reactor or a charging cable.",
    "Mass kept at 5.2 t: in 1/6 g a loader only has 1/6 of its traction, and digging force comes from weight.",
    "In vacuum nothing carries heat away by convection, so the electronics and pack get a switchable radiator. Without it they cook at 100 °C+ while the ground is at -50 °C.",
  ],
  enclosure: { kind: "open", internalExposure: 0.35 },
  insulation: { material: "vacuumMli", thicknessMm: 20 },
  paint: "powderCoat",
  electronics: { part: "siMilitary", solder: "snpb", massKg: 8, powerW: 120 },
  battery: { part: "liIonSpace", capacityWh: 100_000 },
  motors: { magnet: "smco", winding: "polyimide", lubricant: "pfpe", massKg: 180, electricW: 25_000, heatFraction: 0.12, sizeFactor: 1 },
  tires: { material: "silicone", massKg: 520, kind: "tracks" },
  hydraulics: { part: "syntheticEster", massKg: 80 },
  powerplant: { kind: "electric", powerKw: 73, electricPackWh: 100_000 },
  solar: { areaM2: 10, efficiency: 0.3, mount: "vertical" },
  // Li-ion won't take a charge below 0 °C, so the pack is kept just above it.
  heaters: { electricW: 300, setpointK: cToK(5) },
  // No air to carry heat away: electronics and batteries need their own radiator.
  radiator: { areaM2: 0.6, openAboveK: cToK(30) },
  camera: "hardened",
  home: { body: "moon", siteId: "southPoleRidge", localHour: 8, lsDeg: 0, dustTau: 0 },
};

export const CONSTRUCTION_VEHICLES: VehicleBuild[] = [cat299, catD6, cat320, venusDozer, ipex, lunarLoader];
