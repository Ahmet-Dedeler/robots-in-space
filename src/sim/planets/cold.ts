/**
 * The cold side of the parts and materials database. Venus only ever
 * pushes parts past their upper limits; the Moon, Mars and Mercury also
 * push them below their lower ones: lunar nights reach -180 °C for two
 * weeks, Mars nights -90 °C every sol.
 *
 * Each part has a minimum operating temperature (below it the part doesn't
 * work, but recovers when warmed) and a survival temperature (below it,
 * permanent damage is likely: frozen electrolyte, cracked solder joints and
 * ceramic capacitors from thermal contraction, brittle seals). Values are
 * typical datasheet ratings; real hardware survives somewhat past them, or
 * not, which is why missions keep things warm.
 *
 * Sources:
 * - Electronics: JEDEC/AEC-Q100 temperature grades (commercial 0-70/85 °C,
 *   automotive/military -40/-55 °C; storage to -65 °C). NASA Glenn SiC JFET
 *   ICs: operated -190 °C to +812 °C (Neudeck et al. 2018).
 * - Li-ion: discharge to ~-20 °C, no charging below 0 °C (lithium plating),
 *   electrolyte freezes ~-40 °C. MER and MSL kept their batteries above
 *   -20 °C with heaters (Novak et al. 2005; Bhandari 2013).
 * - Lubricants: MSL actuators use Braycote 601EF (PFPE), rated to -80 °C,
 *   and are still warmed before driving on cold mornings (Jandura 2010).
 * - Elastomers: FKM (Viton) glass transition ~-20 °C, seals leak from
 *   ~-25 °C (the Challenger O-ring failure); tyre rubber Tg ~-60 °C, the
 *   reason the Apollo LRV rolled on woven zinc-coated steel wire tyres.
 * - Steels: body-centred-cubic steels have a ductile-to-brittle transition;
 *   4140 around -40 °C (ASM Handbook vol. 1). Aluminium, titanium, austenitic
 *   stainless and nickel alloys have none and are used at cryogenic temps.
 * - Solar absorptivity (alpha_s): Gilmore, "Spacecraft Thermal Control
 *   Handbook" (2002), appendix A, typical as-received finishes.
 * - Porous insulation vs gas pressure: in vacuum the gas conduction path is
 *   gone. Silica aerogel ~0.005 W/m/K in vacuum, ~0.012 at 6-8 mbar CO2
 *   (MER warm electronics box; Novak 2003). Multilayer insulation in vacuum:
 *   effective emittance ~0.02, ~0.0015 W/m/K equivalent (Gilmore ch. 5).
 */
import { cToK as c } from "../constants";
import type { MaterialId } from "../materials/materials";
import type { BodyId } from "./bodies";

export interface ColdLimit {
  /** Below this the part doesn't work (recovers when warmed) [K]. */
  minOperatingK: number;
  /** Below this, permanent damage is likely [K]. */
  survivalK: number;
  note: string;
}

export const ELECTRONICS_COLD: Record<string, ColdLimit> = {
  siCommercial: { minOperatingK: c(0), survivalK: c(-55), note: "Commercial parts: rated 0-85 °C, stored to ~-55 °C. Colder, solder joints and ceramic capacitors crack from contraction." },
  siAutomotive: { minOperatingK: c(-40), survivalK: c(-65), note: "AEC-Q100: -40 °C operating, -65 °C storage." },
  siMilitary: { minOperatingK: c(-55), survivalK: c(-65), note: "MIL-grade: -55 °C operating, -65 °C storage." },
  soi: { minOperatingK: c(-55), survivalK: c(-65), note: "High-temp SOI parts are also rated -55 °C at the cold end." },
  gan: { minOperatingK: c(-55), survivalK: c(-65), note: "Packaged GaN parts: -55 °C typical rating." },
  sicJfet: { minOperatingK: c(-190), survivalK: c(-196), note: "NASA Glenn SiC JFET ICs ran from -190 °C to +812 °C (Neudeck 2018)." },
};

export interface BatteryCold extends ColdLimit {
  /** Charging below this plates lithium; we just refuse to charge [K]. */
  minChargeK: number;
}

export const BATTERY_COLD: Record<string, BatteryCold> = {
  liIon: { minOperatingK: c(-20), minChargeK: c(0), survivalK: c(-40), note: "Electrolyte freezes around -40 °C; no charging below 0 °C." },
  liIonSpace: { minOperatingK: c(-30), minChargeK: c(-10), survivalK: c(-45), note: "Low-temperature electrolyte; still kept above ~-20 °C in practice." },
  lfp: { minOperatingK: c(-20), minChargeK: c(0), survivalK: c(-40), note: "Like other Li-ion: no charging below 0 °C, electrolyte freezes ~-40 °C." },
  leadAcid: { minOperatingK: c(-30), minChargeK: c(-20), survivalK: c(-50), note: "A charged lead-acid battery freezes near -50 °C; a flat one near -10 °C." },
  silverZinc: { minOperatingK: c(-10), minChargeK: c(0), survivalK: c(-40), note: "Aqueous KOH electrolyte freezes around -40 °C (Apollo LRV kept its AgZn packs warm)." },
  sodiumSulfur: { minOperatingK: c(290), minChargeK: c(290), survivalK: c(98), note: "Sodium freezes at 98 °C; freeze-thaw cycles crack the beta-alumina electrolyte." },
  zebra: { minOperatingK: c(250), minChargeK: c(250), survivalK: c(-40), note: "ZEBRA cells tolerate freezing, but need hours of heating to work again." },
  thermal: { minOperatingK: c(350), minChargeK: Infinity, survivalK: c(340), note: "One-shot: once the salt re-freezes, the battery can't be restarted." },
};

/** Lubricant: below its limit the joints stiffen (torque loss), nothing breaks. */
export const LUBRICANT_COLD: Record<string, { minOperatingK: number; note: string }> = {
  grease: { minOperatingK: c(-30), note: "Ordinary grease turns to wax below ~-30 °C." },
  pfpe: { minOperatingK: c(-80), note: "Braycote 601EF (PFPE), Curiosity's actuator grease: rated to -80 °C." },
  mos2: { minOperatingK: c(-200), note: "Dry film: works at cryogenic temperatures." },
};

export const CAMERA_COLD: Record<string, ColdLimit> = {
  cmos: { minOperatingK: c(-40), survivalK: c(-55), note: "Industrial CMOS modules: -40 °C." },
  hardened: { minOperatingK: c(-55), survivalK: c(-65), note: "Assumed MIL-type rating." },
};

export const SEAL_COLD: Record<string, { brittleK: number; note: string }> = {
  viton: { brittleK: c(-25), note: "FKM goes glassy near -20 °C and stops sealing (the Challenger O-ring failure)." },
  kalrez: { brittleK: c(-15), note: "FFKM: glass transition around -10 to -15 °C." },
  metal: { brittleK: 0, note: "Metal seals don't care." },
};

export const HYDRAULIC_COLD: Record<string, { minOperatingK: number; note: string }> = {
  mineral: { minOperatingK: c(-30), note: "Pour point ~-30 °C; nitrile seals go brittle near -40 °C." },
  syntheticEster: { minOperatingK: c(-50), note: "Low-temperature synthetic fluid." },
  ppe: { minOperatingK: c(5), note: "Polyphenyl ether is nearly solid at room temperature (pour point ~+5 °C)." },
};

/** Materials that turn brittle in the cold [K]. Absent = stays tough (Al, Ti, austenitic steel, Ni alloys, PTFE, PEEK...). */
export const MATERIAL_BRITTLE: Partial<Record<MaterialId, { brittleK: number; note: string }>> = {
  steel4140: { brittleK: c(-40), note: "Ductile-to-brittle transition: a knock that would dent it at 20 °C now cracks it." },
  ph17_4: { brittleK: c(-60), note: "Martensitic stainless: loses impact toughness in the cold." },
  pcabs: { brittleK: c(-40), note: "PC/ABS shells shatter on impact below ~-40 °C." },
  nylon66: { brittleK: c(-40), note: "Dry nylon turns brittle in the cold." },
  tireRubber: { brittleK: c(-55), note: "Below its glass transition (~-60 °C) rubber is glass: tyres crack on the first rock. Apollo's LRV used woven steel wire tyres for this reason." },
  silicone: { brittleK: c(-110), note: "Silicone rubber stays flexible to about -110 °C." },
};

/** Solar absorptivity of as-received surfaces (Gilmore 2002). */
const ALPHA: Partial<Record<MaterialId, number>> = {
  al6061: 0.3,
  al7075: 0.3,
  al2219: 0.3,
  ti64: 0.6,
  ti6242: 0.6,
  ss316: 0.45,
  inconel718: 0.55,
  inconel625: 0.55,
  steel4140: 0.7,
  ph17_4: 0.5,
  copper: 0.3,
  tungsten: 0.5,
  cfrp: 0.93,
  cfrpBmi: 0.93,
  cfrpPolyimide: 0.93,
  carbonCarbon: 0.9,
  sic: 0.9,
  basalt: 0.9,
  alumina: 0.3,
  peek: 0.6,
  pcabs: 0.3,
  powderCoat: 0.25,
  vespel: 0.8,
  kevlar: 0.6,
  nylon66: 0.35,
  silicone: 0.35,
  tireRubber: 0.9,
};

export const solarAbsorptivity = (m: MaterialId) => ALPHA[m] ?? 0.6;

/** Insulation conductivity when the pores hold vacuum or thin Mars air [W/m/K]. Undefined = unchanged. */
const INSULATION_LOW_P: Partial<Record<MaterialId, { vacuum: number; mars: number }>> = {
  aerogel: { vacuum: 0.005, mars: 0.012 },
  microporous: { vacuum: 0.006, mars: 0.014 },
  vacuumMli: { vacuum: 0.0015, mars: 0.004 },
  veneraFoam: { vacuum: 0.02, mars: 0.04 },
};

export function insulationK(m: MaterialId, body: BodyId, venusK: number): number {
  const low = INSULATION_LOW_P[m];
  if (!low || body === "venus") return venusK;
  return body === "mars" ? low.mars : low.vacuum;
}
