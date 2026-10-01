/**
 * Fall diagnosis on the real MuJoCo physics: it should blame the gait on open
 * ground and the rocks when a foot actually caught one.
 */
import { readFile } from "node:fs/promises";
import loadMujoco, { type MainModule } from "@mujoco/mujoco";
import { beforeAll, describe, expect, it } from "vitest";
import { terrain, type TerrainId } from "../terrain/terrain";
import { RobotWorld, type FileProvider } from "./robot-world";
import { FallWatch, type FallCause } from "./trip";

const files: FileProvider = {
  text: (p) => readFile(`public/${p}`, "utf8"),
  bytes: async (p) => new Uint8Array(await readFile(`public/${p}`)),
};

let mj: MainModule;
beforeAll(async () => {
  mj = await loadMujoco();
}, 30_000);

async function walkUntilFall(robot: "g1" | "h1", ground: TerrainId, gravity: number, seed = 1982, seconds = 15): Promise<FallCause | null> {
  const w = await RobotWorld.create(mj, files, {
    robot,
    gravity,
    gasDensity: 0,
    gasViscosity: 0,
    windMs: 0,
    massKg: robot === "g1" ? 35 : 47,
    displacedVolumeM3: 0.01,
    terrain: terrain(ground, seed),
    plasticMoment0: 1e6,
    terrainHalf: 7,
    terrainRes: 0.025,
  });
  const watch = new FallWatch(w);
  try {
    for (let t = 0; t < seconds; t += 0.02) {
      w.advance(0.02, { torqueScale: 1, plasticScale: 1, command: [0.5, 0, 0.1] });
      const f = watch.update(0.02);
      if (f) return f;
    }
    return null;
  } finally {
    w.dispose();
  }
}

describe("FallWatch", () => {
  it("H1 in lunar gravity on the flat pad falls from balance, not from the ground", async () => {
    const f = await walkUntilFall("h1", "flat", 1.62);
    expect(f).not.toBeNull();
    expect(f!.kind).toBe("balance");
    expect(f!.obstacleM).toBe(0);
  }, 60_000);

  it("G1 stays up on the flat pad under Earth-like gravity", async () => {
    expect(await walkUntilFall("g1", "flat", 8.87, 1982, 8)).toBeNull();
  }, 60_000);

  it("a G1 that falls on rock-strewn Mars is blamed on what was under its feet", async () => {
    const f = await walkUntilFall("g1", "marsRocky", 3.71);
    expect(f).not.toBeNull();
    expect(["obstacle", "balance"]).toContain(f!.kind);
    expect(f!.text.length).toBeGreaterThan(10);
  }, 60_000);
});
