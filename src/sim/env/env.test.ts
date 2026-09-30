import { describe, expect, it } from "vitest";
import { atmosphere } from "./atmosphere";
import { co2Props } from "./co2";
import { convection } from "./convection";

describe("atmosphere (VIRA)", () => {
  it("surface conditions", () => {
    const a = atmosphere(0);
    expect(a.temperatureK).toBeCloseTo(735.3, 1);
    expect(a.pressurePa / 1e6).toBeCloseTo(9.21, 2);
    expect(a.densityKgM3).toBeCloseTo(64.79, 1);
    expect(a.gravity).toBeCloseTo(8.87, 2);
  });
  it("Earth-like layer near 50-55 km", () => {
    const a = atmosphere(54_000);
    expect(a.pressurePa).toBeGreaterThan(0.4e5);
    expect(a.pressurePa).toBeLessThan(0.7e5);
    expect(a.temperatureK - 273.15).toBeGreaterThan(10);
    expect(a.temperatureK - 273.15).toBeLessThan(45);
  });
  it("interpolates monotonically", () => {
    let prev = Infinity;
    for (let z = 0; z <= 100_000; z += 500) {
      const p = atmosphere(z).pressurePa;
      expect(p).toBeLessThan(prev);
      prev = p;
    }
  });
});

describe("CO2 properties (CoolProp table)", () => {
  it("supercritical surface state", () => {
    const g = co2Props(737, 9.2e6);
    expect(g.rho).toBeCloseTo(65.7, 0);
    expect(g.k).toBeCloseTo(0.0541, 3);
    expect(g.mu).toBeCloseTo(3.377e-5, 6);
    expect(g.cp).toBeGreaterThan(1150);
    expect(g.cp).toBeLessThan(1220);
  });
});

describe("convection", () => {
  it("a hot-gas-flooded body on the surface gets h ~ 50-200 W/m2K", () => {
    const r = convection({ surfaceK: 330, ambientK: 735, pressurePa: 9.2e6, gravity: 8.87, speed: 0.5, lengthM: 0.5 });
    expect(r.h).toBeGreaterThan(50);
    expect(r.h).toBeLessThan(200);
  });
  it("is much weaker in thin air (same body at 60 km)", () => {
    const surface = convection({ surfaceK: 330, ambientK: 735, pressurePa: 9.2e6, gravity: 8.87, speed: 0.5, lengthM: 0.5 }).h;
    const high = convection({ surfaceK: 330, ambientK: 260, pressurePa: 2.4e4, gravity: 8.7, speed: 0.5, lengthM: 0.5 }).h;
    expect(high).toBeLessThan(surface / 10);
  });
});
