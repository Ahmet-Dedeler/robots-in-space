/**
 * Why did the robot fall? Watches a RobotWorld's feet and, the moment the
 * pelvis drops, looks at the ground those feet touched in the last second.
 *
 * Causes, in order:
 * - weak: available motor torque was well below stock (thermal damage)
 * - obstacle: a foot was low over a rock / plate edge taller than 3 cm
 *   (the toe-catcher band of the hazard map)
 * - slope: the soil under the robot is tilted 10° or more
 * - balance: none of the above. Open, level ground: the gait itself went
 *   unstable (e.g. an Earth-trained policy in lunar gravity).
 *
 * This is a diagnosis from geometry, labelled "likely" in the UI: it says
 * what was under the feet, not which contact force tipped the robot over.
 * Used by the 3D view and by scripts/calibrate-walking.ts, so the walking
 * calibration records the same causes the viewer shows.
 */
import { STEP_BANDS, SLOPE_BANDS } from "../terrain/survey";
import type { RobotWorld } from "./robot-world";

export type FallKind = "weak" | "obstacle" | "slope" | "balance";

export interface FallCause {
  kind: FallKind;
  /** Seconds since the last reset. */
  t: number;
  /** Where to put the marker (obstacle, or the pelvis) in terrain coords [m]. */
  x: number;
  y: number;
  /** Tallest obstacle a low foot passed over in the last second [m]. */
  obstacleM: number;
  /** Soil slope under the pelvis [deg]. */
  slopeDeg: number;
  /** One-line explanation for people. */
  text: string;
}

/** Pelvis below this fraction of its standing height counts as a fall (same rule as the calibration). */
export const FALL_FRACTION = 0.55;
const WINDOW_S = 1.0;
/** A foot this close to the soil can catch on things [m]. */
const LOW_FOOT = 0.08;
/** Search radius around the ankle for what the sole and toe touched [m]. */
const FOOT_REACH = 0.12;

interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
}

export class FallWatch {
  private readonly world: RobotWorld;
  private readonly feet: number[];
  private samples: Sample[] = [];
  private t = 0;
  private stand = 0;
  private fallen = false;

  constructor(world: RobotWorld) {
    this.world = world;
    const { mj, model } = world;
    const body = (name: string) => mj.mj_name2id(model, mj.mjtObj.mjOBJ_BODY.value, name);
    // G1 has ankle pitch + roll links (the roll link carries the sole), H1 a single ankle link.
    this.feet = ["left", "right"].map((side) => {
      const roll = body(`${side}_ankle_roll_link`);
      return roll >= 0 ? roll : body(`${side}_ankle_link`);
    }).filter((b) => b >= 0);
    this.reset();
  }

  reset() {
    this.samples = [];
    this.t = 0;
    this.fallen = false;
    const p = this.world.pelvis;
    this.stand = p.z - this.world.options.terrain.height(p.x, p.y);
  }

  get hasFallen() {
    return this.fallen;
  }

  /**
   * Call after advancing the world by dt. Returns the diagnosis on the frame
   * the robot goes down, null otherwise (and after it has fallen).
   */
  update(dt: number, torqueScale = 1): FallCause | null {
    if (this.fallen) return null;
    this.t += dt;
    const xpos = this.world.data.xpos as Float64Array;
    for (const b of this.feet) this.samples.push({ t: this.t, x: xpos[b * 3], y: xpos[b * 3 + 1], z: xpos[b * 3 + 2] });
    while (this.samples.length && this.samples[0].t < this.t - WINDOW_S) this.samples.shift();

    const terrain = this.world.options.terrain;
    const p = this.world.pelvis;
    if (p.z - terrain.height(p.x, p.y) >= this.stand * FALL_FRACTION) return null;
    this.fallen = true;

    // Tallest obstacle near a low foot in the last second.
    let best = 0;
    let bx = p.x;
    let by = p.y;
    const g = 0.03;
    for (const s of this.samples) {
      if (s.z - terrain.sample(s.x, s.y).ground > LOW_FOOT) continue;
      for (let dx = -FOOT_REACH; dx <= FOOT_REACH + 1e-9; dx += g) {
        for (let dy = -FOOT_REACH; dy <= FOOT_REACH + 1e-9; dy += g) {
          if (dx * dx + dy * dy > FOOT_REACH * FOOT_REACH) continue;
          const r = terrain.relief(s.x + dx, s.y + dy);
          if (r > best) {
            best = r;
            bx = s.x + dx;
            by = s.y + dy;
          }
        }
      }
    }
    const slope = terrain.slopeDeg(p.x, p.y, 0.3);
    const cm = (m: number) => `${Math.round(m * 100)} cm`;
    const what = terrain.style.plateSize > 0 && best < 0.08 ? "plate edge" : "rock";
    let kind: FallKind;
    let text: string;
    if (torqueScale < 0.75) {
      kind = "weak";
      text = torqueScale <= 0 ? "Motors off (controller or power lost): it collapsed." : `Legs too weak: motors at ${Math.round(torqueScale * 100)}% torque.`;
    } else if (best >= STEP_BANDS[0]) {
      kind = "obstacle";
      text = `Caught a foot on a ${cm(best)} ${what}.`;
    } else if (slope >= SLOPE_BANDS[0]) {
      kind = "slope";
      text = `Lost footing on a ${slope.toFixed(0)}° slope.`;
    } else {
      kind = "balance";
      text = `Fell on open, level ground (nothing over ${cm(STEP_BANDS[0])} under its feet): the gait itself went unstable.`;
    }
    const mark = kind === "obstacle";
    return { kind, t: this.t, x: mark ? bx : p.x, y: mark ? by : p.y, obstacleM: best, slopeDeg: slope, text };
  }
}
