/**
 * Construction machines in MuJoCo on the shared terrain (see machines.ts for
 * the machines themselves).
 *
 * Drive: every wheel or track roller is a velocity servo (hydrostatic or
 * electric drive), left and right sides commanded separately for skid
 * steering. Torque per joint is capped so the whole machine can't pull more
 * than its rated drawbar pull. Tracks are modelled as a row of contact
 * rollers per side; the belt is drawn around them.
 *
 * Implements (lift arms, blade, boom...): hydraulic position servos. With no
 * pressure they lose all stiffness and only the cylinders' oil damping is
 * left, so arms and blades sink under their own weight. Rubber that burns
 * away (tyres, rubber tracks) shrinks the contact radius onto the steel
 * underneath.
 */
import type { MainModule, MjData, MjModel } from "@mujoco/mujoco";
import type { Terrain } from "../terrain/terrain";
import { MACHINES, type MachineDef, type MachineModel, type WorkStep } from "./machines";
import { groundScene, mediumOption } from "./terrain-scene";

export interface MachineOptions {
  model: MachineModel;
  gravity: number;
  gasDensity: number;
  gasViscosity: number;
  windMs: number;
  massKg: number;
  displacedVolumeM3: number;
  terrain: Terrain;
  terrainHalf?: number;
  terrainRes?: number;
}

export interface MachineInputs {
  /** Drive torque available 0..1 (0 = no power, e.g. a diesel on Venus). */
  driveScale: number;
  /** Hydraulic pressure available 0..1. */
  hydraulics: number;
  /** Rubber intact (false: tyres collapsed onto rims, rubber burnt off the track). */
  rubber: boolean;
  /** Run the work cycle (else park). */
  working: boolean;
  /** Override the work cycle's drive command: forward speed [m/s] and yaw rate [rad/s]. */
  command?: [number, number];
}

const DT = 0.002;

interface GearJoint {
  name: string;
  side: 1 | -1;
  r: number;
  /** Radius once the rubber is gone. */
  bareR: number;
  x: number;
  y: number;
  /** Centre height above level ground. */
  z: number;
  massKg: number;
}

function gearJoints(def: MachineDef): GearJoint[] {
  const g = def.gear;
  if (g.kind === "wheels")
    return g.at.map(([x, y], i) => ({ name: `gear${i}`, side: y > 0 ? 1 : -1, r: g.r, bareR: g.rimR + (g.rimR < g.r ? 0.02 : 0), x, y, z: g.r, massKg: g.massKg }));
  const bare = (g.rubberMm ?? 0) / 1000;
  return [1, -1].flatMap((side) =>
    g.rollers.map((r, i) => ({
      name: `gear${side > 0 ? "L" : "R"}${i}`,
      side: side as 1 | -1,
      r: r.r,
      bareR: r.r - bare,
      x: r.x,
      y: side * g.halfGauge,
      z: r.z ?? r.r,
      massKg: r.massKg,
    })),
  );
}

function sceneXml(def: MachineDef, o: MachineOptions, asset: string, ground: string) {
  const s = o.massKg / def.refMassKg;
  const m = (kg: number) => (kg * s).toPrecision(5);
  const gear = gearJoints(def);
  const g = def.gear;
  const width = g.width / 2;
  const friction = g.kind === "tracks" ? g.friction : 0.75;
  // Tyres are slightly compliant; steel and rubber track contacts are stiffer.
  const solref = g.kind === "wheels" ? "0.01 0.7" : "0.006 1";
  const gearXml = gear
    .map(
      (j) => `<body name="${j.name}" pos="${j.x} ${j.y} ${j.z}">
        <joint name="${j.name}" type="hinge" axis="0 1 0" damping="${(j.massKg * 0.3).toFixed(1)}"/>
        <geom name="contact_${j.name}" type="cylinder" size="${j.r} ${width}" euler="90 0 0" mass="${m(j.massKg)}" solref="${solref}" friction="${friction} 0.02 0.002"/>
      </body>`,
    )
    .join("\n      ");
  const bodies = ["chassis", ...gear.map((j) => j.name), ...def.bodyNames];
  // No self-collisions inside the machine (MuJoCo already skips parent-child pairs).
  const excludes: string[] = [];
  for (let i = 0; i < bodies.length; i++)
    for (let k = i + 1; k < bodies.length; k++) excludes.push(`<exclude body1="${bodies[i]}" body2="${bodies[k]}"/>`);
  // Drive torque per joint: the machine's rated drawbar pull shared over the drive joints.
  const perJointN = (def.drawbarN * s) / gear.length;
  return `<mujoco model="${def.model}">
  <compiler angle="degree"/>
  ${mediumOption(o, DT)}
  <asset>${asset}</asset>
  <default>
    <geom friction="0.9 0.01 0.001" solref="0.02 1"/>
  </default>
  <worldbody>
    ${ground}
    <body name="chassis" pos="0 0 0">
      <freejoint name="root"/>
      ${def.chassis(m)}
      ${gearXml}
      ${def.bodies(m)}
    </body>
  </worldbody>
  <contact>
    ${excludes.join("\n    ")}
  </contact>
  <actuator>
    ${gear.map((j) => `<velocity name="drive_${j.name}" joint="${j.name}" kv="1" forcerange="${-(perJointN * j.r).toFixed(0)} ${(perJointN * j.r).toFixed(0)}" forcelimited="true"/>`).join("\n    ")}
    ${def.implements.map((im) => `<position name="imp_${im.joint}" joint="${im.joint}" kp="${(im.kp * s).toFixed(0)}" forcerange="${-(im.maxTorque * s).toFixed(0)} ${(im.maxTorque * s).toFixed(0)}" forcelimited="true"/>`).join("\n    ")}
    ${(def.spinners ?? []).map((sp) => `<velocity name="spin_${sp.joint}" joint="${sp.joint}" kv="${(sp.maxTorque * s).toFixed(2)}" forcerange="${-(sp.maxTorque * s).toFixed(2)} ${(sp.maxTorque * s).toFixed(2)}" forcelimited="true"/>`).join("\n    ")}
  </actuator>
</mujoco>`;
}

export class MachineWorld {
  readonly mj: MainModule;
  readonly model: MjModel;
  readonly data: MjData;
  readonly options: MachineOptions;
  readonly def: MachineDef;
  readonly gear: GearJoint[];
  /** Work-cycle clock [s] (advances only while working and powered). */
  workT = 0;
  private readonly buoyancy: Float64Array;
  private readonly gearGeoms: number[];
  private readonly gearQadr: number[];
  private readonly impQadr: number[];
  private startZ: number;
  private accumulator = 0;
  private rubberIntact = true;
  /** Ramped drive command (hydrostatic drives accelerate at ~1 m/s^2). */
  private v = 0;
  private w = 0;
  /** Flow-limited implement targets [rad]. */
  private qCmd: number[] = [];

  private constructor(mj: MainModule, model: MjModel, data: MjData, options: MachineOptions, def: MachineDef) {
    this.mj = mj;
    this.model = model;
    this.data = data;
    this.options = options;
    this.def = def;
    this.gear = gearJoints(def);
    const mass = model.body_mass as Float64Array;
    let total = 0;
    for (let b = 1; b < model.nbody; b++) total += mass[b];
    // MuJoCo has no buoyancy: lift each body by its share of the displaced gas.
    this.buoyancy = new Float64Array(model.nbody);
    for (let b = 1; b < model.nbody; b++) this.buoyancy[b] = options.gasDensity * options.displacedVolumeM3 * (mass[b] / total) * options.gravity;
    const id = (type: number, name: string) => mj.mj_name2id(model, type, name);
    const GEOM = mj.mjtObj.mjOBJ_GEOM.value;
    const JOINT = mj.mjtObj.mjOBJ_JOINT.value;
    const qadr = model.jnt_qposadr as Int32Array;
    this.gearGeoms = this.gear.map((j) => id(GEOM, `contact_${j.name}`));
    this.gearQadr = this.gear.map((j) => qadr[id(JOINT, j.name)]);
    this.impQadr = def.implements.map((im) => qadr[id(JOINT, im.joint)]);
    this.startZ = 0;
    this.startZ = this.spawnHeight();
    this.reset();
  }

  static async create(mj: MainModule, options: MachineOptions): Promise<MachineWorld> {
    const def = MACHINES[options.model];
    // Big machines don't feel sub-5 cm detail; a larger patch keeps them on real terrain.
    const ground = groundScene({ terrain: options.terrain, half: options.terrainHalf ?? (def.viewM > 12 ? 25 : 15), res: options.terrainRes ?? (def.viewM > 12 ? 0.08 : 0.05) });
    const dir = `/machine-${def.model}`;
    mj.FS.mkdirTree(dir, 0o777);
    mj.FS.writeFile(`${dir}/scene.xml`, sceneXml(def, options, ground.asset, ground.geom));
    const model = mj.MjModel.from_xml_path(`${dir}/scene.xml`);
    ground.upload(model);
    const data = new mj.MjData(model);
    return new MachineWorld(mj, model, data, options, def);
  }

  /**
   * Lift the machine so no part starts inside the ground: the lowest point of
   * every geom (in the parked pose) against the terrain under it.
   */
  private spawnHeight(): number {
    const { mj, model, data } = this;
    this.reset();
    const type = model.geom_type as Int32Array;
    const size = model.geom_size as Float64Array;
    const body = model.geom_bodyid as Int32Array;
    const xpos = data.geom_xpos as Float64Array;
    const xmat = data.geom_xmat as Float64Array;
    const t = this.options.terrain;
    const BOX = mj.mjtGeom.mjGEOM_BOX.value;
    const CAPSULE = mj.mjtGeom.mjGEOM_CAPSULE.value;
    const CYLINDER = mj.mjtGeom.mjGEOM_CYLINDER.value;
    let lift = -Infinity;
    for (let g = 0; g < model.ngeom; g++) {
      if (body[g] === 0) continue; // the ground itself
      const [sx, sy, sz] = [size[g * 3], size[g * 3 + 1], size[g * 3 + 2]];
      const [r0, r1, r2] = [xmat[g * 9 + 6], xmat[g * 9 + 7], xmat[g * 9 + 8]];
      const half =
        type[g] === BOX
          ? Math.abs(r0) * sx + Math.abs(r1) * sy + Math.abs(r2) * sz
          : type[g] === CAPSULE
            ? Math.abs(r2) * sy + sx
            : type[g] === CYLINDER
              ? Math.hypot(r0, r1) * sx + Math.abs(r2) * sy
              : sx;
      const bottom = xpos[g * 3 + 2] - half;
      lift = Math.max(lift, t.height(xpos[g * 3], xpos[g * 3 + 1]) - bottom);
    }
    return lift + 0.03;
  }

  reset() {
    const { mj, model, data } = this;
    mj.mj_resetData(model, data);
    const q = data.qpos as Float64Array;
    q[2] = this.startZ;
    this.def.implements.forEach((im, i) => (q[this.impQadr[i]] = (this.def.parked[im.joint] ?? 0) * (Math.PI / 180)));
    this.setRubber(true);
    mj.mj_forward(model, data);
    this.accumulator = 0;
    this.v = 0;
    this.w = 0;
    this.workT = 0;
    this.qCmd = this.def.implements.map((im) => ((this.def.parked[im.joint] ?? 0) * Math.PI) / 180);
  }

  private setRubber(intact: boolean) {
    if (intact === this.rubberIntact) return;
    this.rubberIntact = intact;
    const size = this.model.geom_size as Float64Array;
    const rbound = this.model.geom_rbound as Float64Array;
    this.gear.forEach((j, i) => {
      const g = this.gearGeoms[i];
      const r = intact ? j.r : j.bareR;
      size[g * 3] = r;
      rbound[g] = Math.hypot(r, size[g * 3 + 1]);
    });
  }

  /** Current target pose and drive command. */
  step(input: MachineInputs): WorkStep {
    const parked = Object.fromEntries(Object.entries(this.def.parked).map(([k, v]) => [k, (v * Math.PI) / 180]));
    const s = input.working ? this.def.work(this.workT) : { v: 0, w: 0, q: parked };
    return input.command ? { ...s, v: input.command[0], w: input.command[1] } : s;
  }

  advance(dt: number, input: MachineInputs): number {
    const { mj, model, data, def } = this;
    this.setRubber(input.rubber);
    this.accumulator = Math.min(this.accumulator + dt, 0.1);
    // The work cycle waits while the machine has no drive and no hydraulics.
    if (input.working && (input.driveScale > 0 || input.hydraulics > 0)) this.workT += Math.min(dt, 0.1);
    const target = this.step(input);
    const ctrl = data.ctrl as Float64Array;
    const xfrc = data.xfrc_applied as Float64Array;
    for (let b = 1; b < model.nbody; b++) xfrc[b * 6 + 2] = this.buoyancy[b];
    const ramp = (cur: number, to: number, rate: number) => cur + Math.max(-rate * dt, Math.min(rate * dt, to - cur));
    this.v = ramp(this.v, target.v, 1.0);
    this.w = ramp(this.w, target.w, 0.5);
    const gain = model.actuator_gainprm as Float64Array;
    const bias = model.actuator_biasprm as Float64Array;
    const frc = model.actuator_forcerange as Float64Array;
    const nG = 10;
    let a = 0;
    // Drive: velocity servo per joint, stiff enough to saturate at its torque cap; 0 = free-rolling.
    for (const j of this.gear) {
      const r = input.rubber ? j.r : j.bareR;
      const kv = (frc[a * 2 + 1] / 0.3) * input.driveScale;
      gain[a * nG] = kv;
      bias[a * nG + 2] = -kv;
      ctrl[a] = (this.v - j.side * this.w * def.halfTrack) / r;
      a++;
    }
    // Hydraulic implements: position servos with stiffness scaled by available pressure.
    const s = this.options.massKg / def.refMassKg;
    def.implements.forEach((im, i) => {
      const p = im.braked ? Math.max(input.hydraulics, 1) : input.hydraulics;
      const kp = im.kp * s * p;
      gain[a * nG] = kp;
      bias[a * nG + 1] = -kp;
      // No pressure, no flow: the command freezes where it was.
      if (input.hydraulics > 0) this.qCmd[i] = ramp(this.qCmd[i], target.q[im.joint] ?? 0, ((im.maxRateDeg ?? 35) * Math.PI) / 180);
      ctrl[a] = this.qCmd[i];
      a++;
    });
    for (const sp of def.spinners ?? []) {
      const on = input.driveScale > 0 ? 1 : 0;
      gain[a * nG] = sp.maxTorque * s * on;
      bias[a * nG + 2] = -sp.maxTorque * s * on;
      ctrl[a] = target.spin?.[sp.joint] ?? 0;
      a++;
    }
    let steps = 0;
    while (this.accumulator >= DT) {
      mj.mj_step(model, data);
      this.accumulator -= DT;
      steps++;
    }
    return steps;
  }

  /** Running-gear rotation [rad] of one joint (drives the track belt animation). */
  gearAngle(i: number): number {
    return (this.data.qpos as Float64Array)[this.gearQadr[i]];
  }

  jointAngle(name: string): number {
    const id = this.mj.mj_name2id(this.model, this.mj.mjtObj.mjOBJ_JOINT.value, name);
    return (this.data.qpos as Float64Array)[(this.model.jnt_qposadr as Int32Array)[id]];
  }

  get chassis(): { x: number; y: number; z: number } {
    const q = this.data.qpos as Float64Array;
    return { x: q[0], y: q[1], z: q[2] };
  }

  /** Chassis z-axis . world z (1 = upright). */
  get upright(): number {
    const q = this.data.qpos as Float64Array;
    return 1 - 2 * (q[4] * q[4] + q[5] * q[5]);
  }

  dispose() {
    this.data.delete();
    this.model.delete();
  }
}
