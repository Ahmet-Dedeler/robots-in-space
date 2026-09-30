import { describe, expect, it } from "vitest";
import { ThermalNetwork, type ThermalNode } from "./network";

const env = (n: number, h = 0) => ({ ambientK: 700, radiantK: 700, h: new Float64Array(n).fill(h) });

describe("thermal network", () => {
  it("conserves energy between two isolated nodes", () => {
    const nodes: ThermalNode[] = [
      { id: "a", label: "a", C: 1000 },
      { id: "b", label: "b", C: 3000 },
    ];
    const net = new ThermalNetwork(nodes, [{ a: 0, b: 1, G: 5 }], [400, 300]);
    const e0 = net.H[0] + net.H[1];
    for (let i = 0; i < 200; i++) net.step(10, env(2), new Float64Array(2));
    expect(net.H[0] + net.H[1]).toBeCloseTo(e0, 6);
    expect(net.T[0]).toBeCloseTo(325, 1);
    expect(net.T[1]).toBeCloseTo(325, 1);
  });

  it("matches the analytic exponential for a convectively heated lump", () => {
    // C dT/dt = hA (Ta - T), no radiation (emissivity 0).
    const node: ThermalNode = {
      id: "x",
      label: "x",
      C: 5000,
      exposure: { area: 1, emissivity: 0, lengthM: 1, convFactor: 1, seriesR: 0 },
    };
    const net = new ThermalNetwork([node], [], 300);
    const h = 50;
    const dt = 0.5;
    for (let t = 0; t < 100; t += dt) net.step(dt, env(1, h), new Float64Array(1));
    const exact = 700 - 400 * Math.exp((-h * 100) / 5000);
    expect(Math.abs(net.T[0] - exact)).toBeLessThan(1.5);
  });

  it("holds at the melting point while a PCM melts", () => {
    const node: ThermalNode = { id: "p", label: "p", C: 100, pcm: { meltK: 303, latentJ: 100_000, bandK: 2 } };
    const net = new ThermalNetwork([node], [], 290);
    const q = new Float64Array([100]); // 100 W
    for (let t = 0; t < 600; t += 1) net.step(1, env(1), q);
    // Sensible 290->302 = 1.2 kJ, then 100 kJ of melting: at t=600 s it is mid-melt.
    expect(net.T[0]).toBeGreaterThan(302);
    expect(net.T[0]).toBeLessThan(304);
  });
});
