import { describe, expect, it } from "vitest";
import { vehicleById } from "../vehicles/library";
import { runExperiment, type Scenario } from "./run";

const surface: Scenario = { elevationM: 0, windMs: 0.5, start: { kind: "surface" }, activity: "walking" };

describe("Venera 13 validation", () => {
  const venera = vehicleById("venera13")!;
  const r = runExperiment(venera, {
    elevationM: 1500,
    windMs: 0.5,
    start: { kind: "descent", fromKm: 62 },
    activity: "idle",
  });

  it("descends in about an hour and lands at ~7.5 m/s", () => {
    const { landedS, touchdownMs } = r.verdict;
    expect(landedS).not.toBeNull();
    expect(landedS! / 60).toBeGreaterThan(45);
    expect(landedS! / 60).toBeLessThan(75);
    expect(touchdownMs!).toBeGreaterThan(6.5);
    expect(touchdownMs!).toBeLessThan(8.5);
  });

  it("survives ~127 min on the surface (+/-25%)", () => {
    const surfaceMin = (r.verdict.deathS! - r.verdict.landedS!) / 60;
    expect(surfaceMin).toBeGreaterThan(127 * 0.75);
    expect(surfaceMin).toBeLessThan(127 * 1.25);
  });
});

describe("humanoids on the surface", () => {
  it("a stock Optimus-class robot dies within minutes", () => {
    const r = runExperiment(vehicleById("optimus")!, surface);
    expect(r.verdict.deathS).not.toBeNull();
    expect(r.verdict.deathS!).toBeLessThan(30 * 60);
    expect(r.verdict.walkStopS!).toBeLessThanOrEqual(r.verdict.deathS!);
  });

  it("the Venus-hardened G1 outlasts the stock one by orders of magnitude", () => {
    const stock = runExperiment(vehicleById("g1")!, surface);
    const hard = runExperiment(vehicleById("g1-hardened")!, { ...surface, activity: "idle" });
    const hardLife = hard.verdict.deathS ?? hard.durationS;
    expect(hardLife).toBeGreaterThan(100 * stock.verdict.deathS!);
  });

  it("runs fast enough for interactive use", () => {
    const r = runExperiment(vehicleById("venera13")!, { ...surface, start: { kind: "descent", fromKm: 62 }, activity: "idle" });
    expect(r.computeMs).toBeLessThan(500);
  });
});
