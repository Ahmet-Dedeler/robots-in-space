/**
 * Can each humanoid walk on each terrain, and how much motor torque does it
 * need? Runs the exact app physics (MuJoCo WASM + TS controller + terrain
 * heightfield + buoyancy + real mass) headless and writes
 * src/sim/data/walking.json, which the thermal model uses to decide when a
 * weakening robot falls. Each terrain runs under its own world's gravity
 * and gas: Venus CO2, thin Mars air, or vacuum on the Moon and Mercury.
 *
 * Usage: npx tsx scripts/calibrate-walking.ts            (all terrains)
 *        ONLY=lunarMare,marsGale npx tsx scripts/calibrate-walking.ts
 *        (only those; other results are kept from the existing file)
 */
import { readFile, writeFile } from "node:fs/promises";
import loadMujoco from "@mujoco/mujoco";
import { atmosphere } from "../src/sim/env/atmosphere";
import walkingJson from "../src/sim/data/walking.json";
import { BODIES, sitesFor } from "../src/sim/planets/bodies";
import { surfaceMedium } from "../src/sim/planets/world";
import { RobotWorld, type FileProvider } from "../src/sim/robots/robot-world";
import { FallWatch, type FallKind } from "../src/sim/robots/trip";
import { TERRAINS, terrain, type TerrainId } from "../src/sim/terrain/terrain";
import { VEHICLES } from "../src/sim/vehicles/library";
import { displacedVolumeM3 } from "../src/sim/vehicles/volume";

const files: FileProvider = {
  text: (p) => readFile(`public/${p}`, "utf8"),
  bytes: async (p) => new Uint8Array(await readFile(`public/${p}`)),
};
const SECONDS = 15;
const SEEDS = [1982, 7, 314];
const COMMAND: [number, number, number] = [0.5, 0, 0.1]; // walks a ~5 m circle

async function main() {
  const mj = await loadMujoco();
  const atm = atmosphere(0);
  const venus = { gravity: atm.gravity, densityKgM3: atm.densityKgM3, viscosity: atm.gas.mu, windMs: 0.5 };
  const only = process.env.ONLY?.split(",");
  type Gait = { walksAtFull: boolean; minTorque: number | null; meanTripS: number | null; metersPerS: number; tripCause: FallKind | null };
  const out: Record<string, Record<string, Gait>> = only ? structuredClone(walkingJson.results as unknown as Record<string, Record<string, Gait>>) : {};
  /** Gravity and gas for a terrain: its world's, at that world's first listed site. */
  const mediumFor = (tid: TerrainId) => {
    const body = (TERRAINS[tid] as { body?: keyof typeof BODIES }).body;
    if (!body || body === "venus") return venus;
    const site = sitesFor(body)[0];
    return surfaceMedium({ elevationM: site.elevationM, windMs: body === "mars" ? 5 : 0, planet: { body, siteId: site.id, localHour: 12, lsDeg: 150, dustTau: 0.5, chaseSun: false } });
  };
  for (const v of VEHICLES) {
    if (v.mechanics.kind !== "humanoid") continue;
    out[v.id] ??= {};
    for (const tid of Object.keys(TERRAINS) as TerrainId[]) {
      if (only && !only.includes(tid)) continue;
      const medium = mediumFor(tid);
      const worlds = await Promise.all(
        SEEDS.map((seed) =>
          RobotWorld.create(mj, files, {
            robot: (v.mechanics as { robot: "g1" | "h1" }).robot,
            gravity: medium.gravity,
            gasDensity: medium.densityKgM3,
            gasViscosity: medium.viscosity,
            windMs: medium.windMs,
            massKg: v.massKg,
            displacedVolumeM3: displacedVolumeM3(v),
            terrain: terrain(tid, seed),
            plasticMoment0: 1e6,
            terrainHalf: 7,
            terrainRes: 0.025,
          }),
        ),
      );
      /** Runs every seed; returns whether all stayed up, mean time to trip, walking speed, and why they fell. */
      const trial = (scale: number, stopEarly = true) => {
        let ok = true;
        let tripSum = 0;
        let trips = 0;
        let path = 0;
        let time = 0;
        const causes: Partial<Record<FallKind, number>> = {};
        for (const w of worlds) {
          w.reset();
          // Same fall rule as before (pelvis below 55% of standing height), plus what was under the feet.
          const watch = new FallWatch(w);
          let last = w.pelvis;
          for (let t = 0; t < SECONDS; t += 0.02) {
            w.advance(0.02, { torqueScale: scale, plasticScale: 1, command: COMMAND });
            const p = w.pelvis;
            const fall = watch.update(0.02, 1);
            if (fall) {
              ok = false;
              tripSum += t;
              trips++;
              causes[fall.kind] = (causes[fall.kind] ?? 0) + 1;
              break;
            }
            path += Math.hypot(p.x - last.x, p.y - last.y);
            time += 0.02;
            last = p;
          }
          if (!ok && stopEarly) break;
        }
        const top = (Object.entries(causes) as [FallKind, number][]).sort((a, b) => b[1] - a[1])[0];
        return { ok, meanTripS: trips ? tripSum / trips : null, metersPerS: time > 0 ? path / time : 0, tripCause: top ? top[0] : null, causes };
      };
      const full = trial(Math.min(1, v.motors ? v.motors.sizeFactor * (v.motors.magnet === "none" ? 0.7 : 1) : 1), false);
      let minTorque: number | null = null;
      if (full.ok) {
        let lo = 0.3;
        let hi = 1;
        for (let i = 0; i < 6; i++) {
          const mid = (lo + hi) / 2;
          if (trial(mid).ok) hi = mid;
          else lo = mid;
        }
        minTorque = Math.round(hi * 100) / 100;
      }
      out[v.id][tid] = {
        walksAtFull: full.ok,
        minTorque,
        meanTripS: full.meanTripS === null ? null : Math.round(full.meanTripS * 10) / 10,
        metersPerS: Math.round(full.metersPerS * 100) / 100,
        tripCause: full.tripCause,
      };
      console.log(
        v.id.padEnd(12),
        tid.padEnd(15),
        full.ok
          ? `walks ${full.metersPerS.toFixed(2)} m/s, falls below ${Math.round(minTorque! * 100)}% torque`
          : `trips after ~${full.meanTripS!.toFixed(1)} s on average (${full.metersPerS.toFixed(2)} m/s while up); causes ${JSON.stringify(full.causes)}`,
      );
      worlds.forEach((w) => w.dispose());
    }
  }
  await writeFile("src/sim/data/walking.json", JSON.stringify({ generatedBy: "scripts/calibrate-walking.ts", seconds: SECONDS, seeds: SEEDS, command: COMMAND, results: out }, null, 2) + "\n");
}

main();
