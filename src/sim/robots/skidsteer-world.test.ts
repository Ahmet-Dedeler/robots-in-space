import loadMujoco, { type MainModule } from "@mujoco/mujoco";
import { beforeAll, describe, expect, it } from "vitest";
import { atmosphere } from "../env/atmosphere";
import { terrain } from "../terrain/terrain";
import { SkidsteerWorld } from "./skidsteer-world";

let mj: MainModule;
beforeAll(async () => {
  mj = await loadMujoco();
}, 30_000);

const atm = atmosphere(0);
const make = () =>
  SkidsteerWorld.create(mj, {
    gravity: atm.gravity,
    gasDensity: atm.densityKgM3,
    gasViscosity: atm.gas.mu,
    windMs: 0.5,
    massKg: 3763,
    displacedVolumeM3: 0.45,
    terrain: terrain("venera14"),
  });

function run(w: SkidsteerWorld, seconds: number, input: Parameters<SkidsteerWorld["advance"]>[1]) {
  for (let t = 0; t < seconds; t += 0.02) w.advance(0.02, input);
}

describe("CAT skid steer (MuJoCo WASM)", () => {
  it("drives a circle over Venera 14 plates and stays upright", async () => {
    const w = await make();
    const start = w.chassis;
    run(w, 8, { driveScale: 1, hydraulics: 1, tires: true, command: [0.6, 0.8] });
    const p = w.chassis;
    const q = w.data.qpos as Float64Array;
    const up = 1 - 2 * (q[4] * q[4] + q[5] * q[5]); // body z-axis . world z
    expect(Math.hypot(p.x - start.x, p.y - start.y)).toBeGreaterThan(1.5);
    expect(up).toBeGreaterThan(0.8);
    w.dispose();
  });

  it("does not move without drive (diesel can't run on Venus)", async () => {
    const w = await make();
    const start = w.chassis;
    run(w, 4, { driveScale: 0, hydraulics: 1, tires: true, command: [0.6, 0.8] });
    expect(Math.hypot(w.chassis.x - start.x, w.chassis.y - start.y)).toBeLessThan(0.3);
    w.dispose();
  });

  it("lift arms fall when hydraulics fail, and it sinks onto the rims when tyres go", async () => {
    const w = await make();
    const lift = mj.mj_name2id(w.model, mj.mjtObj.mjOBJ_JOINT.value, "lift");
    const qadr = (w.model.jnt_qposadr as Int32Array)[lift];
    run(w, 2, { driveScale: 0, hydraulics: 1, tires: true, command: [0, 0] });
    const held = (w.data.qpos as Float64Array)[qadr];
    const zTyres = w.chassis.z;
    run(w, 3, { driveScale: 0, hydraulics: 0, tires: false, command: [0, 0] });
    const dropped = (w.data.qpos as Float64Array)[qadr];
    expect(held).toBeLessThan(-0.25); // raised
    expect(dropped).toBeGreaterThan(held + 0.2); // fell under its own weight
    expect(w.chassis.z).toBeLessThan(zTyres - 0.08);
    w.dispose();
  });
}, 60_000);
