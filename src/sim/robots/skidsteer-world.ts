/**
 * A CAT 262D3-class skid-steer loader in MuJoCo on Venus ground.
 *
 * Geometry from the Cat spec sheet: 2.99 m long (without bucket), 1.68 m wide
 * over the 12x16.5 tyres (0.83 m diameter), 2.11 m to the cab roof,
 * ~1.21 m wheelbase, 3,763 kg operating weight. Mass is split between
 * chassis, rear engine block, cab, wheels, lift arms and bucket so the centre
 * of mass sits low and rearward like the real machine.
 *
 * Drive: four velocity-controlled wheels (hydrostatic drive), skid steering.
 * Lift arms: a hydraulic position actuator; if the hydraulics fail the arms
 * fall under their own weight. Tyres are slightly compliant contacts; when
 * the rubber pyrolyses the machine settles onto its steel rims.
 */
import type { MainModule, MjData, MjModel } from "@mujoco/mujoco";
import type { Terrain } from "../terrain/terrain";
import { groundScene, mediumOption } from "./terrain-scene";

export interface SkidsteerOptions {
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

export interface SkidsteerInputs {
  /** Drive torque available 0..1 (0 = no power, e.g. diesel on Venus). */
  driveScale: number;
  /** Hydraulic pressure available (lift arms hold) 0..1. */
  hydraulics: number;
  /** Tyres intact (false: collapsed onto rims). */
  tires: boolean;
  /** Forward speed [m/s] and yaw rate [rad/s]. */
  command: [number, number];
}

const WHEEL_R = 0.415;
const RIM_R = 0.26;
const TRACK_HALF = 0.69;
const WHEELBASE_HALF = 0.605;
const DT = 0.002;

function sceneXml(o: SkidsteerOptions, asset: string, ground: string) {
  // Masses [kg] summing to the operating weight (3,763 kg).
  const s = o.massKg / 3763;
  const m = (x: number) => (x * s).toFixed(1);
  const wheels = [
    ["fl", WHEELBASE_HALF, TRACK_HALF],
    ["fr", WHEELBASE_HALF, -TRACK_HALF],
    ["rl", -WHEELBASE_HALF, TRACK_HALF],
    ["rr", -WHEELBASE_HALF, -TRACK_HALF],
  ] as const;
  return `<mujoco model="skidsteer">
  <compiler angle="degree"/>
  ${mediumOption(o, DT)}
  <asset>${asset}</asset>
  <default>
    <geom friction="0.9 0.01 0.001" solref="0.02 1"/>
  </default>
  <worldbody>
    ${ground}
    <body name="chassis" pos="0 0 1">
      <freejoint name="root"/>
      <geom name="paint_chassis" type="box" size="0.95 0.5 0.3" pos="0 0 0.05" mass="${m(1500)}"/>
      <geom name="paint_engine" type="box" size="0.38 0.52 0.32" pos="-0.8 0 0.42" mass="${m(650)}"/>
      <geom name="steel_cabfloor" type="box" size="0.5 0.48 0.03" pos="0.15 0 0.38" mass="${m(80)}"/>
      <geom name="steel_cabroof" type="box" size="0.55 0.5 0.035" pos="0.1 0 1.3" mass="${m(90)}"/>
      ${[
        [0.6, 0.46],
        [0.6, -0.46],
        [-0.4, 0.46],
        [-0.4, -0.46],
      ]
        .map(([x, y], i) => `<geom name="steel_post${i}" type="capsule" fromto="${x} ${y} 0.4 ${x} ${y} 1.27" size="0.035" mass="${m(15)}"/>`)
        .join("\n      ")}
      ${wheels
        .map(
          ([id, x, y]) => `<body name="wheel_${id}" pos="${x} ${y} -0.12">
        <joint name="wheel_${id}" type="hinge" axis="0 1 0" damping="30"/>
        <geom name="tire_${id}" type="cylinder" size="${WHEEL_R} 0.15" euler="90 0 0" mass="${m(60)}" solref="0.01 0.7" friction="0.7 0.02 0.002"/>
        <geom name="rim_${id}" type="cylinder" size="${RIM_R} 0.155" euler="90 0 0" contype="0" conaffinity="0" mass="${m(25)}"/>
      </body>`,
        )
        .join("\n      ")}
      <body name="arms" pos="-0.85 0 0.9">
        <joint name="lift" type="hinge" axis="0 1 0" range="-77 14" damping="4000"/>
        <geom name="paint_armL" type="box" size="1.0 0.05 0.1" pos="0.98 0.9 -0.22" euler="0 13 0" mass="${m(120)}"/>
        <geom name="paint_armR" type="box" size="1.0 0.05 0.1" pos="0.98 -0.9 -0.22" euler="0 13 0" mass="${m(120)}"/>
        <body name="bucket" pos="2.2 0 -0.55">
          <geom name="steel_bucket_floor" type="box" size="0.32 0.84 0.02" pos="0.1 0 -0.38" mass="${m(90)}"/>
          <geom name="steel_bucket_back" type="box" size="0.03 0.84 0.28" pos="-0.2 0 -0.12" mass="${m(70)}"/>
          <geom name="steel_bucket_sideL" type="box" size="0.26 0.02 0.2" pos="0.05 0.82 -0.2" mass="${m(20)}"/>
          <geom name="steel_bucket_sideR" type="box" size="0.26 0.02 0.2" pos="0.05 -0.82 -0.2" mass="${m(20)}"/>
        </body>
      </body>
    </body>
  </worldbody>
  <contact>
    <exclude body1="chassis" body2="arms"/>
    <exclude body1="chassis" body2="bucket"/>
    <exclude body1="arms" body2="bucket"/>
    <exclude body1="arms" body2="wheel_fl"/>
    <exclude body1="arms" body2="wheel_fr"/>
  </contact>
  <actuator>
    ${wheels.map(([id]) => `<velocity name="drive_${id}" joint="wheel_${id}" kv="${(20000 * s).toFixed(0)}" forcerange="-5000 5000" forcelimited="true"/>`).join("\n    ")}
    <position name="lift" joint="lift" kp="${(400000 * s).toFixed(0)}" forcerange="-40000 40000" forcelimited="true"/>
  </actuator>
</mujoco>`;
}

export class SkidsteerWorld {
  readonly mj: MainModule;
  readonly model: MjModel;
  readonly data: MjData;
  readonly options: SkidsteerOptions;
  private readonly buoyancy: Float64Array;
  private readonly tireGeoms: number[];
  private readonly startZ: number;
  private accumulator = 0;
  private tiresIntact = true;
  /** Ramped speed command (hydrostatic drives accelerate at ~1 m/s^2). */
  private v = 0;
  private w = 0;

  private constructor(mj: MainModule, model: MjModel, data: MjData, options: SkidsteerOptions) {
    this.mj = mj;
    this.model = model;
    this.data = data;
    this.options = options;
    const mass = model.body_mass as Float64Array;
    let total = 0;
    for (let b = 1; b < model.nbody; b++) total += mass[b];
    this.buoyancy = new Float64Array(model.nbody);
    for (let b = 1; b < model.nbody; b++) this.buoyancy[b] = options.gasDensity * options.displacedVolumeM3 * (mass[b] / total) * options.gravity;
    this.tireGeoms = ["fl", "fr", "rl", "rr"].map((id) => mj.mj_name2id(model, mj.mjtObj.mjOBJ_GEOM.value, `tire_${id}`));
    // Spawn resting on the highest ground under the wheels.
    const t = options.terrain;
    const under = [
      [WHEELBASE_HALF, TRACK_HALF],
      [WHEELBASE_HALF, -TRACK_HALF],
      [-WHEELBASE_HALF, TRACK_HALF],
      [-WHEELBASE_HALF, -TRACK_HALF],
    ].map(([x, y]) => t.height(x, y));
    this.startZ = Math.max(...under) + WHEEL_R + 0.12 + 0.03;
    this.reset();
  }

  static async create(mj: MainModule, options: SkidsteerOptions): Promise<SkidsteerWorld> {
    // 0.83 m tyres don't feel sub-5 cm detail; a larger patch keeps the loader on real terrain.
    const ground = groundScene({ terrain: options.terrain, half: options.terrainHalf ?? 15, res: options.terrainRes ?? 0.05 });
    mj.FS.mkdirTree("/skidsteer", 0o777);
    mj.FS.writeFile("/skidsteer/scene.xml", sceneXml(options, ground.asset, ground.geom));
    const model = mj.MjModel.from_xml_path("/skidsteer/scene.xml");
    ground.upload(model);
    const data = new mj.MjData(model);
    return new SkidsteerWorld(mj, model, data, options);
  }

  reset() {
    const { mj, model, data } = this;
    mj.mj_resetData(model, data);
    (data.qpos as Float64Array)[2] = this.startZ;
    this.setTires(true);
    mj.mj_forward(model, data);
    this.accumulator = 0;
    this.v = 0;
    this.w = 0;
  }

  private setTires(intact: boolean) {
    if (intact === this.tiresIntact) return;
    this.tiresIntact = intact;
    const size = this.model.geom_size as Float64Array;
    const rbound = this.model.geom_rbound as Float64Array;
    const r = intact ? WHEEL_R : RIM_R + 0.02; // charred rubber stuck to the rims
    for (const g of this.tireGeoms) {
      size[g * 3] = r;
      rbound[g] = Math.hypot(r, size[g * 3 + 1]);
    }
  }

  advance(dt: number, input: SkidsteerInputs): number {
    const { mj, model, data } = this;
    this.setTires(input.tires);
    this.accumulator = Math.min(this.accumulator + dt, 0.1);
    const ctrl = data.ctrl as Float64Array;
    const xfrc = data.xfrc_applied as Float64Array;
    for (let b = 1; b < model.nbody; b++) xfrc[b * 6 + 2] = this.buoyancy[b];
    const r = input.tires ? WHEEL_R : RIM_R + 0.02;
    const step = (cur: number, target: number, rate: number) => cur + Math.max(-rate * dt, Math.min(rate * dt, target - cur));
    this.v = step(this.v, input.command[0], 1.0);
    this.w = step(this.w, input.command[1], 0.4);
    const { v, w } = this;
    const left = (v - w * TRACK_HALF) / r;
    const right = (v + w * TRACK_HALF) / r;
    const gain = model.actuator_gainprm as Float64Array;
    const bias = model.actuator_biasprm as Float64Array;
    const nG = 10;
    // Wheels: velocity servo scaled by available drive; 0 = free-rolling (no power).
    for (let i = 0; i < 4; i++) {
      const kv = 20000 * (this.options.massKg / 3763) * input.driveScale;
      gain[i * nG] = kv;
      bias[i * nG + 2] = -kv;
    }
    ctrl[0] = left;
    ctrl[1] = right;
    ctrl[2] = left;
    ctrl[3] = right;
    // Lift arms: hydraulic position hold at a carry height (negative = raised); no pressure = no stiffness.
    // Two lift cylinders (~60 kN each at ~0.33 m lever) -> ~40 kN m; flow-controlled, so stiff.
    const kp = 400000 * (this.options.massKg / 3763) * input.hydraulics;
    gain[4 * nG] = kp;
    bias[4 * nG + 1] = -kp;
    ctrl[4] = -0.35;
    let steps = 0;
    while (this.accumulator >= DT) {
      mj.mj_step(model, data);
      this.accumulator -= DT;
      steps++;
    }
    return steps;
  }

  get chassis(): { x: number; y: number; z: number } {
    const q = this.data.qpos as Float64Array;
    return { x: q[0], y: q[1], z: q[2] };
  }

  dispose() {
    this.data.delete();
    this.model.delete();
  }
}
