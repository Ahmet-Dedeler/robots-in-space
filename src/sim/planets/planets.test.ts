/**
 * Validation for the Moon, Mars and Mercury: the regolith model against
 * orbiter measurements, the Sun against orbital mechanics, and preset
 * missions against what actually happened to them.
 */
import { describe, expect, it } from "vitest";
import { runExperiment, type Scenario } from "../mission/run";
import { vehicleById } from "../vehicles/library";
import type { VehicleBuild } from "../vehicles/types";
import { BODIES, siteById } from "./bodies";
import { marsPressure } from "./mars";
import { albedoAt, periodicSurface } from "./regolith";
import { clockForLocalHour, sunAt, terminatorSpeed } from "./solar";
import type { PlanetScenario } from "./world";

function surfaceCycle(siteId: string) {
  const site = siteById(siteId)!;
  const body = BODIES[site.body];
  const clock = { body, site, lsDeg: 0 };
  const p = site.regolith ?? body.regolith;
  const sol = periodicSurface(
    p,
    (tau) => {
      const s = sunAt(clock, tau);
      const inc = Math.acos(Math.min(1, s.mu));
      return { absorbedWm2: (1 - albedoAt(p, inc)) * s.fluxNormal * s.mu, irDownWm2: site.shadowed?.wallIrWm2 ?? 0 };
    },
    body.solarDayS,
    `test-${siteId}`,
  );
  const arr = Array.from(sol.surfaceK);
  return { max: Math.max(...arr), min: Math.min(...arr), atHour: (h: number) => arr[Math.round(((clockForLocalHour(clock, h) / body.solarDayS) * arr.length)) % arr.length] };
}

describe("regolith temperatures vs measurements", () => {
  it("lunar equator: noon ~390 K, pre-dawn ~95 K (Diviner; Williams et al. 2017)", () => {
    const c = surfaceCycle("apollo11");
    expect(c.max).toBeGreaterThan(375);
    expect(c.max).toBeLessThan(400);
    expect(c.atHour(5.9)).toBeGreaterThan(85);
    expect(c.atHour(5.9)).toBeLessThan(105);
  });

  it("Mercury: ~700 K at the hot longitude, ~570 K at the warm one, ~100 K nights (Vasavada 1999)", () => {
    const hot = surfaceCycle("mercuryHot");
    const warm = surfaceCycle("mercuryWarm");
    expect(hot.max).toBeGreaterThan(680);
    expect(hot.max).toBeLessThan(720);
    expect(warm.max).toBeGreaterThan(550);
    expect(warm.max).toBeLessThan(600);
    expect(hot.min).toBeGreaterThan(85);
    expect(hot.min).toBeLessThan(130);
  });

  it("Shackleton's permanently shadowed floor sits near 45 K (Diviner PSR maps)", () => {
    const c = surfaceCycle("shackletonFloor");
    expect(c.max).toBeGreaterThan(35);
    expect(c.max).toBeLessThan(60);
  });
});

describe("the Sun and the air", () => {
  it("Mercury's Sun backs up in the sky around perihelion at the hot longitude", () => {
    const clock = { body: BODIES.mercury, site: siteById("mercuryHot")!, lsDeg: 0 };
    const a = sunAt(clock, 0).localHour;
    const b = sunAt(clock, 86_400).localHour;
    // Noon at perihelion, and one Earth day later it's slightly *earlier* than noon.
    expect(a).toBeCloseTo(12, 3);
    expect(b).toBeLessThan(12);
    expect(b).toBeGreaterThan(11.9);
  });

  it("the day-night line crawls at ~0.34 m/s at 70°N on Mercury", () => {
    const v = terminatorSpeed({ body: BODIES.mercury, site: siteById("mercury70N")!, lsDeg: 0 });
    expect(v).toBeGreaterThan(0.3);
    expect(v).toBeLessThan(0.38);
  });

  it("Mars surface pressure: ~7-9 mbar at Gale (REMS), under 1 mbar on Olympus Mons", () => {
    for (const ls of [150, 250]) {
      const gale = marsPressure(-4_500, ls);
      expect(gale).toBeGreaterThan(700);
      expect(gale).toBeLessThan(950);
    }
    expect(marsPressure(21_200, 150)).toBeLessThan(100);
  });
});

function mission(id: string, override: Partial<PlanetScenario> = {}, activity: Scenario["activity"] = "walking") {
  const b = vehicleById(id) as VehicleBuild;
  const { maxDays, ...home } = b.home!;
  const planet: PlanetScenario = { chaseSun: false, ...home, ...override };
  const site = siteById(planet.siteId)!;
  const maxDurationS = maxDays ? maxDays * 86_400 : undefined;
  return runExperiment(b, { elevationM: site.elevationM, ground: site.ground, windMs: 5, start: { kind: "surface" }, activity, planet, maxDurationS });
}

describe("missions vs history", () => {
  it("Pragyan works through its lunar day and dies in its first night (it never woke up)", () => {
    const r = mission("pragyan");
    expect(r.verdict.deathS).not.toBeNull();
    const days = r.verdict.deathS! / 86_400;
    expect(days).toBeGreaterThan(10);
    expect(days).toBeLessThan(16);
    expect(r.events.some((e) => e.title === "Electronics cold damage")).toBe(true);
    expect(r.events.some((e) => e.title === "Sunrise")).toBe(false);
  });

  it("Lunokhod 1 outlives its 3-lunar-day design and freezes around day 300 as its Po-210 heater fades (real: day 301)", () => {
    const r = mission("lunokhod1");
    expect(r.verdict.deathS).not.toBeNull();
    const days = r.verdict.deathS! / 86_400;
    expect(days).toBeGreaterThan(250);
    expect(days).toBeLessThan(340);
    expect(r.events.filter((e) => e.title === "Sunrise").length).toBeGreaterThanOrEqual(6);
    expect(r.events.some((e) => e.title === "Electronics cold damage")).toBe(true);
  });

  it("IPEx keeps digging through the polar summer day without overheating", () => {
    const r = mission("ipex");
    expect(r.verdict.deathS).toBeNull();
    expect(r.verdict.walkStopS).toBeNull();
    expect(r.events.some((e) => e.severity === "fail" || e.severity === "fatal")).toBe(false);
  });

  it("Yutu-2 sleeps through lunar nights and wakes up every time", () => {
    const r = mission("yutu2");
    expect(r.verdict.deathS).toBeNull();
    expect(r.events.filter((e) => e.title === "Sunrise").length).toBeGreaterThanOrEqual(2);
    expect(r.events.some((e) => e.title.includes("cold damage") || e.title === "Battery frozen")).toBe(false);
  });

  it("Curiosity runs through 60 sols on its RTG, dust storm or not", () => {
    for (const dustTau of [0.5, 10.8]) {
      const r = mission("curiosity", { dustTau });
      expect(r.verdict.deathS).toBeNull();
      expect(r.durationS).toBeGreaterThan(55 * BODIES.mars.solarDayS);
    }
  });

  it("Opportunity lives on sunlight, and the 2018 storm (tau 10.8) kills it within weeks", () => {
    const fine = mission("opportunity");
    expect(fine.verdict.deathS).toBeNull();
    const storm = mission("opportunity", { dustTau: 10.8 });
    expect(storm.verdict.deathS).not.toBeNull();
    expect(storm.verdict.deathS! / BODIES.mars.solarDayS).toBeLessThan(30);
  });

  it("a Mercury rover survives by chasing the dawn, and cooks if it stops", () => {
    const chase = mission("dawn-crawler", { chaseSun: true });
    expect(chase.verdict.deathS).toBeNull();
    expect(chase.durationS / 86_400).toBeGreaterThan(170);
    const parked = mission("dawn-crawler", { chaseSun: false });
    expect(parked.verdict.deathS).not.toBeNull();
  });

  it("stays fast enough for interactive use", () => {
    const r = mission("yutu2");
    expect(r.computeMs).toBeLessThan(500);
  });
});

describe("Venus robots elsewhere", () => {
  it("a stock G1 on the Moon dies in the lunar night, not in minutes as on Venus", () => {
    const b = vehicleById("g1")!;
    const planet: PlanetScenario = { body: "moon", siteId: "apollo11", localHour: 8, lsDeg: 0, dustTau: 0, chaseSun: false };
    const r = runExperiment(b, { elevationM: -1900, ground: "lunarMare", windMs: 0, start: { kind: "surface" }, activity: "idle", planet });
    expect(r.verdict.deathS).not.toBeNull();
    expect(r.verdict.deathS!).toBeGreaterThan(3600);
  });
});
