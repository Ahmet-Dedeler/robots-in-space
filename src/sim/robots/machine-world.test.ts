import loadMujoco, { type MainModule } from "@mujoco/mujoco";
import { beforeAll, describe, expect, it } from "vitest";
import { atmosphere } from "../env/atmosphere";
import { terrain, type TerrainId } from "../terrain/terrain";
import { MachineWorld, type MachineInputs } from "./machine-world";
import { MACHINES, type MachineModel } from "./machines";

let mj: MainModule;
beforeAll(async () => {
  mj = await loadMujoco();
}, 30_000);

const atm = atmosphere(0);
const make = (model: MachineModel, ground: TerrainId = "venera14") =>
  MachineWorld.create(mj, {
    model,
    gravity: atm.gravity,
    gasDensity: atm.densityKgM3,
    gasViscosity: atm.gas.mu,
    windMs: 0.5,
    massKg: MACHINES[model].refMassKg,
    displacedVolumeM3: MACHINES[model].refMassKg / 7000,
    terrain: terrain(ground),
  });

const ON: MachineInputs = { driveScale: 1, hydraulics: 1, rubber: true, working: true };

function run(w: MachineWorld, seconds: number, input: MachineInputs) {
  for (let t = 0; t < seconds; t += 0.02) w.advance(0.02, input);
}
const moved = (w: MachineWorld, from: { x: number; y: number }) => Math.hypot(w.chassis.x - from.x, w.chassis.y - from.y);
const deg = (w: MachineWorld, joint: string) => (w.jointAngle(joint) * 180) / Math.PI;

describe("construction machines (MuJoCo WASM)", () => {
  it("skid steer drives a circle over Venera 14 plates and stays upright", async () => {
    const w = await make("skidsteer");
    const start = w.chassis;
    run(w, 8, ON);
    expect(moved(w, start)).toBeGreaterThan(1.5);
    expect(w.upright).toBeGreaterThan(0.8);
    w.dispose();
  });

  it("does not move without drive (diesel can't run on Venus)", async () => {
    const w = await make("skidsteer");
    const start = w.chassis;
    run(w, 4, { ...ON, driveScale: 0, command: [0.6, 0.8] });
    expect(moved(w, start)).toBeLessThan(0.3);
    w.dispose();
  });

  it("lift arms fall when hydraulics fail, and it sinks onto the rims when tyres go", async () => {
    const w = await make("skidsteer");
    run(w, 4, { ...ON, driveScale: 0 });
    const held = deg(w, "lift");
    const zTyres = w.chassis.z;
    run(w, 4, { ...ON, driveScale: 0, hydraulics: 0, rubber: false });
    expect(held).toBeLessThan(-15); // raised in the carry/dump cycle
    expect(deg(w, "lift")).toBeGreaterThan(held + 10); // fell under its own weight
    expect(w.chassis.z).toBeLessThan(zTyres - 0.08);
    w.dispose();
  });

  it("track loader and dozer drive on tracks", async () => {
    for (const m of ["trackloader", "dozer"] as const) {
      const w = await make(m);
      const start = w.chassis;
      run(w, 6, ON);
      expect(moved(w, start)).toBeGreaterThan(2);
      expect(w.upright).toBeGreaterThan(0.9);
      w.dispose();
    }
  });

  it("dozer blade drops to the ground without hydraulic pressure", async () => {
    const w = await make("dozer", "flat");
    run(w, 10, ON); // into the reverse pass, blade raised
    const raised = deg(w, "blade");
    run(w, 4, { ...ON, hydraulics: 0, driveScale: 0 });
    expect(raised).toBeLessThan(-8);
    expect(deg(w, "blade")).toBeGreaterThan(raised + 5);
    w.dispose();
  });

  it("excavator digs and swings without walking off; the boom slumps when pressure goes but the swing brake holds", async () => {
    const w = await make("excavator");
    const start = w.chassis;
    run(w, 13.5, ON);
    expect(deg(w, "swing")).toBeGreaterThan(60); // swinging to dump
    expect(moved(w, start)).toBeLessThan(0.8);
    expect(w.upright).toBeGreaterThan(0.95);
    const boom = deg(w, "boom");
    const swing = deg(w, "swing");
    run(w, 4, { ...ON, hydraulics: 0, driveScale: 0 });
    expect(deg(w, "boom")).toBeGreaterThan(boom + 10);
    expect(Math.abs(deg(w, "swing") - swing)).toBeLessThan(3);
    w.dispose();
  });

  it("IPEx drives and digs in lunar gravity", async () => {
    const w = await MachineWorld.create(mj, {
      model: "ipex",
      gravity: 1.62,
      gasDensity: 0,
      gasViscosity: 0,
      windMs: 0,
      massKg: 30,
      displacedVolumeM3: 0,
      terrain: terrain("lunarHighlands"),
    });
    const start = w.chassis;
    run(w, 9, ON);
    expect(deg(w, "front")).toBeGreaterThan(8); // drums down, digging
    run(w, 8, ON);
    expect(moved(w, start)).toBeGreaterThan(1);
    expect(w.upright).toBeGreaterThan(0.8);
    w.dispose();
  });
}, 120_000);
