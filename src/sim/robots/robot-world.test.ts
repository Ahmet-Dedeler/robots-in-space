/**
 * Integration tests: the real MuJoCo WASM build + our TS controller, terrain,
 * buoyancy and plastic hinges, in Node. Same code path as the browser.
 */
import { readFile } from "node:fs/promises";
import loadMujoco, { type MainModule } from "@mujoco/mujoco";
import { beforeAll, describe, expect, it } from "vitest";
import { atmosphere } from "../env/atmosphere";
import { terrain, type TerrainId } from "../terrain/terrain";
import { RobotWorld, type FileProvider } from "./robot-world";

const files: FileProvider = {
  text: (p) => readFile(`public/${p}`, "utf8"),
  bytes: async (p) => new Uint8Array(await readFile(`public/${p}`)),
};

let mj: MainModule;
beforeAll(async () => {
  mj = await loadMujoco();
}, 30_000);

const atm = atmosphere(0);
function world(robot: "g1" | "h1", ground: TerrainId, massKg = robot === "g1" ? 35 : 47) {
  return RobotWorld.create(mj, files, {
    robot,
    gravity: atm.gravity,
    gasDensity: atm.densityKgM3,
    gasViscosity: atm.gas.mu,
    windMs: 0.5,
    massKg,
    displacedVolumeM3: massKg / 3000,
    terrain: terrain(ground),
    plasticMoment0: 400,
    terrainHalf: 5,
    terrainRes: 0.025,
  });
}

function walk(w: RobotWorld, seconds: number, torqueScale = 1, plasticScale = 1, command: [number, number, number] = [0.5, 0, 0]) {
  let fellAt: number | null = null;
  const standZ = w.pelvis.z - w.options.terrain.height(0, 0);
  for (let t = 0; t < seconds; t += 0.02) {
    w.advance(0.02, { torqueScale, plasticScale, command });
    const p = w.pelvis;
    if (fellAt === null && p.z - w.options.terrain.height(p.x, p.y) < standZ * 0.55) fellAt = t;
  }
  return { fellAt, ...w.pelvis };
}

describe("RobotWorld (MuJoCo WASM in Node)", () => {
  it("heightfield matches the terrain function (ray casts)", async () => {
    const w = await world("g1", "venera14");
    const t = w.options.terrain;
    const out = new mj.IntBuffer(1);
    const normal = new mj.DoubleBuffer(3);
    try {
      for (const [x, y] of [[1.3, -2.1], [-3.7, 0.4], [2.2, 3.9], [-1.1, -4.2]]) {
        const d = mj.mj_ray(w.model, w.data, [x, y, 5], [0, 0, -1], [1, 1, 1, 1, 1, 1], true, -1, out, normal);
        const hit = 5 - d;
        expect(Math.abs(hit - t.height(x, y))).toBeLessThan(0.012);
      }
    } finally {
      out.delete();
      normal.delete();
      w.dispose();
    }
  });

  it("G1 walks on flat ground under Venus gravity, CO2 density and buoyancy", async () => {
    const w = await world("g1", "flat");
    const r = walk(w, 8);
    w.dispose();
    expect(r.fellAt).toBeNull();
    expect(r.x).toBeGreaterThan(2);
  });

  it("limbs stay straight when cold and bend permanently when the frame is hot and weak", async () => {
    const w = await world("g1", "flat");
    walk(w, 3);
    expect(w.maxPermanentBend).toBeLessThan(0.01);
    // Frame at 3% strength while the motors still push: legs buckle and stay buckled.
    walk(w, 3, 1, 0.03);
    const bent = w.maxPermanentBend;
    expect(bent).toBeGreaterThan(0.1);
    walk(w, 1, 0, 0.03);
    expect(w.maxPermanentBend).toBeGreaterThanOrEqual(bent * 0.9);
    w.dispose();
  });
}, 60_000);
