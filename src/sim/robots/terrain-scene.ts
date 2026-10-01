/**
 * Shared MuJoCo scene pieces for anything standing on Venus ground: the
 * Venera-derived heightfield (same function the renderer uses) and the Venus
 * medium (gravity, CO2 density/viscosity, wind). Buoyancy is applied by the
 * caller because MuJoCo's fluid model has none.
 */
import type { MjModel } from "@mujoco/mujoco";
import type { Terrain } from "../terrain/terrain";

export interface GroundOptions {
  terrain: Terrain;
  half: number;
  res: number;
}

export interface GroundScene {
  /** <asset> contents (empty for flat ground). */
  asset: string;
  /** <worldbody> ground geom. */
  geom: string;
  /** Write heightfield samples into a compiled model. */
  upload(model: MjModel): void;
  /** Lowest terrain height in the patch [m]. */
  base: number;
}

export function groundScene({ terrain, half, res }: GroundOptions): GroundScene {
  const n = Math.round((2 * half) / res) + 1;
  const style = terrain.style;
  const flat = terrain.isFlat;
  const friction = `${style.friction} 0.005 0.0001`;
  if (flat) {
    return {
      asset: "",
      geom: `<geom name="ground" type="plane" size="0 0 0.05" friction="${friction}"/>`,
      upload: () => {},
      base: 0,
    };
  }
  const grid = terrain.grid(0, 0, half, n);
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of grid) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const range = Math.max(hi - lo, 1e-3);
  return {
    asset: `<hfield name="terrain" nrow="${n}" ncol="${n}" size="${half} ${half} ${range} 0.2"/>`,
    geom: `<geom name="ground" type="hfield" hfield="terrain" pos="0 0 ${lo}" friction="${friction}"/>`,
    upload(model) {
      const hd = model.hfield_data as Float32Array;
      for (let i = 0; i < grid.length; i++) hd[i] = (grid[i] - lo) / range;
    },
    base: lo,
  };
}

export function mediumOption(o: { gravity: number; gasDensity: number; gasViscosity: number; windMs: number }, timestep: number) {
  return `<option timestep="${timestep}" gravity="0 0 ${-o.gravity}" density="${o.gasDensity}" viscosity="${o.gasViscosity}" wind="${o.windMs} 0 0"/>`;
}
