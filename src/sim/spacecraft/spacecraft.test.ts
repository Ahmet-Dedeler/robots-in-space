/**
 * Rocket landers: the nozzle model against published engine data, Apollo 11
 * against history, and the physics stories each world should tell.
 */
import { describe, expect, it } from "vitest";
import { defaultScenario } from "@/lib/lab-store";
import { runExperiment } from "../mission/run";
import { SPACECRAFT } from "../vehicles/spacecraft";
import { vehicleById } from "../vehicles/library";
import { engineModel, ispAt } from "./engines";
import { flyLanding } from "./landing";
import { aeroAreas, soundSpeed } from "./aero";
import { TILES, Wall, radiativeEquilibriumK } from "./tps";

const craft = (id: string) => structuredClone(SPACECRAFT.find((v) => v.id === id)!);

describe("engines", () => {
  it("Merlin 1D: pinned at sea level, predicts the published 311 s vacuum Isp", () => {
    expect(ispAt("merlin1d", 1, 101_325)).toBeCloseTo(282, 0);
    expect(ispAt("merlin1d", 1, 0)).toBeGreaterThan(305);
    expect(ispAt("merlin1d", 1, 0)).toBeLessThan(317);
  });

  it("Raptor 3 reaches ~350 s in vacuum from its sea-level point", () => {
    expect(ispAt("raptor3", 1, 0)).toBeGreaterThan(340);
    expect(ispAt("raptor3", 1, 0)).toBeLessThan(360);
  });

  it("thick air: Raptor (350 bar) keeps about half its thrust at the Venus surface, Merlin (97 bar) almost none, the LM engine (7 bar) none", () => {
    const venus = 92e5;
    const frac = (id: "raptor3" | "merlin1d" | "lmde") => engineModel(id).thrust(1, venus) / engineModel(id).thrust(1, 101_325 * (id === "lmde" ? 0 : 1));
    expect(frac("raptor3")).toBeGreaterThan(0.4);
    expect(frac("raptor3")).toBeLessThan(0.65);
    expect(frac("merlin1d")).toBeLessThan(0.25);
    expect(engineModel("lmde").thrust(1, 10e5)).toBe(0);
  });
});

describe("landings", () => {
  it("Apollo LM lands at Tranquility Base from a 15 km orbit, with propellant to spare", () => {
    const lm = craft("apollo-lm");
    const f = flyLanding(lm, { body: "moon", elevationM: -1900, fromKm: 15 });
    expect(f.outcome).toBe("landed");
    expect(f.touchdownMs).toBeLessThan(3);
    // Apollo 11: 12.6 min, ~350 kg usable left after Armstrong flew long. Our guidance is greedier.
    expect(f.touchdownS!).toBeGreaterThan(5 * 60);
    expect(f.touchdownS!).toBeLessThan(14 * 60);
    expect(f.propellantLeftKg).toBeGreaterThan(200);
    expect(f.propellantLeftKg).toBeLessThan(2500);
  });

  it("Starship lands on the Moon and on Mars (lifting entry + retropropulsion) with its default load", () => {
    const s = craft("starship-v3");
    expect(flyLanding(s, { body: "moon", elevationM: -1900, fromKm: 15 }).outcome).toBe("landed");
    const mars = flyLanding(s, { body: "mars", elevationM: -2600, fromKm: 125, lsDeg: 150 });
    expect(mars.outcome).toBe("landed");
    expect(mars.propellantLeftKg).toBeGreaterThan(10_000);
  });

  it("Starship's stock tanks are crushed in Venus's air between 30 and 40 km", () => {
    const f = flyLanding(craft("starship-v3"), { body: "venus", elevationM: 0, fromKm: 62 });
    expect(f.outcome).toBe("crushed");
    const crush = f.events.find((e) => e.title === "Tanks crushed")!;
    const i = f.t.findIndex((t) => t >= crush.t);
    expect(f.h[i] / 1000).toBeGreaterThan(30);
    expect(f.h[i] / 1000).toBeLessThan(40);
  });

  it("flooded Starship on Venus: avionics cook before the landing burn, so nobody flies it down", () => {
    const s = craft("starship-v3");
    s.propulsion!.tanks.flood = true;
    const r = runExperiment(s, defaultScenario(s, "venus"));
    expect(r.flight!.outcome).toBe("crashed");
    expect(r.events.some((e) => e.title === "Nobody flying")).toBe(true);
  });

  it("a Falcon 9 booster can't land on Mars or Mercury on its landing reserve", () => {
    const f9 = craft("falcon9-b5");
    expect(flyLanding(f9, { body: "mars", elevationM: -2600, fromKm: 125, lsDeg: 150 }).outcome).toBe("crashed");
    expect(flyLanding(f9, { body: "mercury", elevationM: 0, fromKm: 15 }).outcome).toBe("crashed");
  });

  it("parachute landers don't get a powered flight", () => {
    const v = vehicleById("venera13")!;
    expect(runExperiment(v, defaultScenario(v)).flight).toBeNull();
  });
});

describe("aerodynamics", () => {
  it("speed of sound in CO2: ~230 m/s on Mars (210 K), ~410 m/s at the Venus surface (735 K)", () => {
    expect(soundSpeed(210)).toBeGreaterThan(220);
    expect(soundSpeed(210)).toBeLessThan(240);
    expect(soundSpeed(735)).toBeGreaterThan(395);
    expect(soundSpeed(735)).toBeLessThan(425);
  });

  it("Falcon 9 falling tail-first: drag area ~15-25 m² (base + grid fins)", () => {
    const g = craft("falcon9-b5").propulsion!.aero;
    const sub = aeroAreas(g, 0, 0.5).cdA;
    expect(sub).toBeGreaterThan(12);
    expect(sub).toBeLessThan(25);
    // Supersonic, the blunt base drags harder.
    expect(aeroAreas(g, 0, 2).cdA).toBeGreaterThan(sub);
  });

  it("Starship belly-first: hundreds of m² of drag, lift-to-drag ~0.3-0.8 at a 60° entry", () => {
    const g = craft("starship-v3").propulsion!.aero;
    const flop = aeroAreas(g, 90, 0.3);
    expect(flop.cdA).toBeGreaterThan(500);
    expect(flop.cdA).toBeLessThan(900);
    expect(flop.clA).toBeLessThan(1);
    const entry = aeroAreas(g, 180 - 60, 10);
    expect(entry.clA / entry.cdA).toBeGreaterThan(0.3);
    expect(entry.clA / entry.cdA).toBeLessThan(0.8);
  });
});

describe("entry heating and tiles", () => {
  it("25 mm of silica tile under 35 kW/m² for 5 min: face near radiative balance, steel behind stays cool", () => {
    const w = new Wall({ tile: { id: "li900", thicknessMm: 25 }, skin: { material: "ss316", thicknessMm: 4 } }, 220);
    for (let t = 0; t < 300; t += 0.1) w.step(35_000, 210, 0.1);
    const eq = radiativeEquilibriumK(35_000, TILES.li900.emissivity, 210);
    expect(w.surfaceK).toBeGreaterThan(eq - 60);
    expect(w.surfaceK).toBeLessThan(eq + 5);
    expect(w.skinK).toBeLessThan(400);
  });

  it("Starship's tiles survive a Mars entry from orbit below their reuse limit; the steel behind stays cold", () => {
    const f = flyLanding(craft("starship-v3"), { body: "mars", elevationM: -2600, fromKm: 125, lsDeg: 150 });
    expect(f.peaks.heatWm2).toBeGreaterThan(10_000);
    expect(f.peaks.surfaceK).toBeLessThan(TILES.li900.reuseK);
    expect(f.peaks.skinK).toBeLessThan(373);
  });

  it("the Apollo LM can't enter Mars's air from orbit: its 0.6 mm aluminium burns through", () => {
    const f = flyLanding(craft("apollo-lm"), { body: "mars", elevationM: -2600, fromKm: 125, lsDeg: 150 });
    expect(f.outcome).toBe("burned");
    expect(f.events.some((e) => e.title === "Burn-through")).toBe(true);
  });

  it("boosters fly an entry burn before meeting Mars's air", () => {
    const f = flyLanding(craft("falcon9-b5"), { body: "mars", elevationM: -2600, fromKm: 125, lsDeg: 150 });
    expect(f.events.some((e) => e.title === "Entry burn done")).toBe(true);
  });
});
