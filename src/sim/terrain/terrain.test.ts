/**
 * Ground models: physics sees what's rendered, soil mechanics reproduce what
 * Apollo and the Mars rovers met, and the survey/hazard numbers are sane.
 */
import { describe, expect, it } from "vitest";
import { PLANET_SITES } from "../planets/bodies";
import { groundScene } from "../robots/terrain-scene";
import { VEHICLES } from "../vehicles/library";
import { SOILS, footing, sinkageM } from "./soil";
import { hazardClass, survey, trafficability, wheelSinkageM } from "./survey";
import { TERRAINS, terrain, type TerrainId } from "./terrain";

const MOON_G = 1.62;
const MARS_G = 3.71;

describe("terrain ↔ physics", () => {
  it("every ground with craters, rocks, plates or ripples gets a heightfield, not a plane", () => {
    for (const id of Object.keys(TERRAINS) as TerrainId[]) {
      const t = terrain(id);
      expect(t.isFlat, id).toBe(id === "flat");
      const scene = groundScene({ terrain: t, half: 2, res: 0.05 });
      expect(scene.geom.includes("hfield"), id).toBe(id !== "flat");
    }
  });

  it("the flat test pad is exactly flat under the robot", () => {
    const t = terrain("flat");
    for (let i = 0; i < 50; i++) expect(t.height(Math.sin(i) * 6, Math.cos(i) * 6)).toBe(0);
  });

  it("big horizon craters stay off the experiment pad", () => {
    // Pad slopes on the Moon are set by small equilibrium craters only: gentle on average.
    const s = survey(terrain("lunarMare"), 7, 0.1);
    expect(s.slopeMeanDeg).toBeLessThan(8);
    expect(s.reliefRangeM).toBeLessThan(2);
  });

  it("relief is height above the soil; the soil carries craters and ripples", () => {
    const t = terrain("marsSoftSand");
    // Ripples are soil (slope), not obstacles.
    let maxRelief = 0;
    for (let x = -3; x < 3; x += 0.05) maxRelief = Math.max(maxRelief, t.relief(x, 0.3));
    expect(maxRelief).toBeLessThan(0.05);
    expect(terrain("marsRocky").relief(0, 0)).toBeGreaterThanOrEqual(0);
  });

  it("site grounds exist and belong to their world", () => {
    for (const s of PLANET_SITES) expect((TERRAINS[s.ground] as { body?: string }).body, s.id).toBe(s.body);
  });
});

describe("rock and obstacle statistics", () => {
  it("rocky Mars is much rougher than lunar mare and Meridiani", () => {
    const rocky = survey(terrain("marsRocky"), 5, 0.05);
    const mare = survey(terrain("lunarMare"), 5, 0.05);
    const meridiani = survey(terrain("marsMeridiani"), 5, 0.05);
    expect(rocky.countPer100[1]).toBeGreaterThan(5 * Math.max(mare.countPer100[1], 0.2));
    expect(rocky.countPer100[1]).toBeGreaterThan(5 * Math.max(meridiani.countPer100[1], 0.2));
    // Golombek-Rapp k = 0.16: rocks > 10 cm cover a few % of the ground.
    expect(rocky.coverAbove[1]).toBeGreaterThan(0.02);
    expect(rocky.coverAbove[1]).toBeLessThan(0.15);
  });

  it("hazard classes follow the bands", () => {
    expect(hazardClass(0.01, 2)).toBe(0);
    expect(hazardClass(0.05, 2)).toBe(1);
    expect(hazardClass(0.15, 2)).toBe(2);
    expect(hazardClass(0.3, 2)).toBe(3);
    expect(hazardClass(0, 15)).toBe(1);
    expect(hazardClass(0, 25)).toBe(2);
  });
});

describe("soil mechanics vs. what landers met", () => {
  it("Apollo bootprints: a suited astronaut sinks ~0.5-2 cm in lunar regolith", () => {
    // ~170 kg suited astronaut in lunar gravity on one 33 x 13 cm boot.
    const f = footing(SOILS.lunarRegolith, { forceN: 170 * MOON_G, widthM: 0.13, lengthM: 0.33 }, MOON_G);
    expect(f.sinkageM).toBeGreaterThan(0.004);
    expect(f.sinkageM).toBeLessThan(0.02);
    expect(f.verdict).toBe("firm");
  });

  it("Apollo LRV ruts were ~1.25 cm deep: Bekker's rigid wheel gives the same order", () => {
    // 700 kg loaded LRV, 4 wheels 81 cm x 23 cm (Lunar Sourcebook, Carrier 2006).
    const z = wheelSinkageM(SOILS.lunarRegolith, (700 * MOON_G) / 4, 0.23, 0.81);
    expect(z).toBeGreaterThan(0.006);
    expect(z).toBeLessThan(0.03);
  });

  it("loose Martian sand (Spirit's Troy) barely carries a MER wheel; firm Martian soil does", () => {
    const mer = VEHICLES.find((v) => v.mechanics.kind === "rover" && v.mechanics.model === "mer");
    expect(mer).toBeDefined();
    const loose = trafficability(mer!, SOILS.marsLooseSand, MARS_G)!;
    const firm = trafficability(mer!, SOILS.marsSoil, MARS_G)!;
    expect(loose.utilisation).toBeGreaterThan(3 * firm.utilisation);
    expect(firm.verdict).toBe("firm");
    expect(loose.sinkageM).toBeGreaterThan(firm.sinkageM);
  });

  it("bearing capacity of cohesionless sand scales with gravity", () => {
    const moon = footing(SOILS.marsLooseSand, { forceN: 100, widthM: 0.1, lengthM: 0.2 }, MOON_G).bearingPa;
    const mars = footing(SOILS.marsLooseSand, { forceN: 100, widthM: 0.1, lengthM: 0.2 }, MARS_G).bearingPa;
    expect(mars / moon).toBeCloseTo(MARS_G / MOON_G, 5);
  });

  it("Venus plates hold a humanoid without measurable sinkage", () => {
    const g1 = VEHICLES.find((v) => v.mechanics.kind === "humanoid")!;
    const t = trafficability(g1, SOILS.veneraRock, 8.87)!;
    expect(t.verdict).toBe("firm");
    expect(sinkageM(SOILS.veneraRock, t.pressurePa, 0.07)).toBe(0);
  });
});
