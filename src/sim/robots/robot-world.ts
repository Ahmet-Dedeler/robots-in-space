/**
 * A humanoid in MuJoCo on Venus ground. Environment-agnostic: the caller
 * passes the MuJoCo module and a file provider (fetch in the browser, fs in
 * Node), so tests and calibration scripts run the exact same physics as the
 * app.
 *
 * Physics beyond stock MuJoCo:
 * - Terrain: a heightfield sampled from the Venera-derived terrain function,
 *   so feet collide with the same plates and boulders that are rendered.
 * - Buoyancy: MuJoCo's fluid model has none (only velocity-dependent drag),
 *   so we apply rho_gas * V_body * g at each body COM. V_body is the body's
 *   share of the robot's displaced *solid* volume (cavities are flooded).
 * - Real mass: bodies are scaled so the model weighs what the spec says.
 * - Plastic yield hinges in thighs and shins: elastic spring + return mapping
 *   on the rest angle, so limbs bend permanently once the bending moment
 *   exceeds the hot section's plastic moment.
 */
import type { MainModule, MjData, MjModel } from "@mujoco/mujoco";
import type { Terrain } from "../terrain/terrain";
import { WalkController, type PolicyJson } from "./policy";

export interface FileProvider {
  text(path: string): Promise<string>;
  bytes(path: string): Promise<Uint8Array>;
}

export interface RobotWorldOptions {
  robot: "g1" | "h1";
  gravity: number;
  gasDensity: number;
  gasViscosity: number;
  windMs: number;
  /** Target total mass [kg]; bodies are scaled to match. */
  massKg: number;
  /** Displaced solid volume [m^3] for buoyancy. */
  displacedVolumeM3: number;
  terrain: Terrain;
  /**
   * Plastic moment of each limb section at 20 °C [N m]. Defaults to the
   * strongest motor torque / frame working-stress ratio: the structure is
   * sized so peak motor torque loads it to `frameLoadFraction` of yield.
   */
  plasticMoment0?: number;
  frameLoadFraction?: number;
  /** Heightfield half-size [m] and resolution [m]. */
  terrainHalf?: number;
  terrainRes?: number;
}

const staged = new WeakMap<object, Map<string, Promise<PolicyJson>>>();

async function stage(mj: MainModule, files: FileProvider, robot: string): Promise<PolicyJson> {
  let perModule = staged.get(mj);
  if (!perModule) staged.set(mj, (perModule = new Map()));
  const existing = perModule.get(robot);
  if (existing) return existing;
  const p = (async () => {
    const base = `robots/${robot}`;
    const policy = JSON.parse(await files.text(`${base}/policy.json`)) as PolicyJson;
    mj.FS.mkdirTree(`/${robot}/meshes`, 0o777);
    mj.FS.writeFile(`/${robot}/robot.xml`, await files.text(`${base}/robot.xml`));
    await Promise.all(policy.meshes.map(async (m) => mj.FS.writeFile(`/${robot}/meshes/${m}`, await files.bytes(`${base}/meshes/${m}`))));
    return policy;
  })();
  perModule.set(robot, p);
  return p;
}

export interface StepInputs {
  /** Available actuator torque, 0..1 of stock. */
  torqueScale: number;
  /** Plastic moment scale, yield(T)/yield(20 °C). */
  plasticScale: number;
  command: [number, number, number];
}

export class RobotWorld {
  readonly mj: MainModule;
  readonly model: MjModel;
  readonly data: MjData;
  readonly policy: PolicyJson;
  readonly controller: WalkController;
  readonly options: RobotWorldOptions;
  /** Terrain heightfield origin height [m] (lowest sample). */
  readonly terrainBase: number;
  private readonly tau: Float64Array;
  private readonly frcLimit: Float64Array;
  private readonly hinges: { qadr: number; k: number }[];
  private readonly buoyancy: Float64Array;
  private readonly startZ: number;
  private readonly plasticMoment0: number;
  private accumulator = 0;

  private constructor(mj: MainModule, model: MjModel, data: MjData, policy: PolicyJson, options: RobotWorldOptions, terrainBase: number) {
    this.mj = mj;
    this.model = model;
    this.data = data;
    this.policy = policy;
    this.options = options;
    this.terrainBase = terrainBase;

    // Actuated joints, in actuator order.
    const trn = model.actuator_trnid as Int32Array;
    const qadr = model.jnt_qposadr as Int32Array;
    const dadr = model.jnt_dofadr as Int32Array;
    const range = model.jnt_actfrcrange as Float64Array;
    const nu = model.nu;
    const joints = Array.from({ length: nu }, (_, i) => trn[i * 2]);
    this.controller = new WalkController(policy, joints.map((j) => qadr[j]), joints.map((j) => dadr[j]));
    this.tau = new Float64Array(nu);
    this.frcLimit = Float64Array.from(joints, (j) => range[j * 2 + 1] || 1e9);
    this.plasticMoment0 = options.plasticMoment0 ?? Math.max(...this.frcLimit) / (options.frameLoadFraction ?? 0.35);

    // Plastic hinges.
    const stiff = model.jnt_stiffness as Float64Array;
    this.hinges = [];
    for (const h of policy.yieldHinges ?? []) {
      for (const name of h.joints) {
        const j = mj.mj_name2id(model, mj.mjtObj.mjOBJ_JOINT.value, name);
        if (j >= 0) this.hinges.push({ qadr: qadr[j], k: stiff[j] });
      }
    }

    // Real mass: scale bodies (world body 0 excluded).
    const mass = model.body_mass as Float64Array;
    const inertia = model.body_inertia as Float64Array;
    let total = 0;
    for (let b = 1; b < model.nbody; b++) total += mass[b];
    const s = options.massKg / total;
    for (let b = 1; b < model.nbody; b++) {
      mass[b] *= s;
      for (let k = 0; k < 3; k++) inertia[b * 3 + k] *= s;
    }
    mj.mj_setConst(model, data);

    // Buoyancy per body, proportional to its share of the solid volume.
    this.buoyancy = new Float64Array(model.nbody);
    for (let b = 1; b < model.nbody; b++) {
      const vol = options.displacedVolumeM3 * (mass[b] / options.massKg);
      this.buoyancy[b] = options.gasDensity * vol * options.gravity;
    }

    const qpos0 = model.qpos0 as Float64Array;
    this.startZ = qpos0[2] + options.terrain.height(0, 0) + 0.02;
    this.reset();
  }

  static async create(mj: MainModule, files: FileProvider, options: RobotWorldOptions): Promise<RobotWorld> {
    const policy = await stage(mj, files, options.robot);
    const half = options.terrainHalf ?? 8;
    const res = options.terrainRes ?? 0.02;
    const n = Math.round((2 * half) / res) + 1;
    const flat = options.terrain.isFlat;
    const grid = flat ? null : options.terrain.grid(0, 0, half, n);
    let lo = 0;
    let hi = 0;
    if (grid) {
      lo = Infinity;
      hi = -Infinity;
      for (const v of grid) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    const zRange = Math.max(hi - lo, 1e-3);
    const friction = options.terrain.style.friction;
    const ground = grid
      ? `<geom name="ground" type="hfield" hfield="terrain" pos="0 0 ${lo}" friction="${friction} 0.005 0.0001"/>`
      : `<geom name="ground" type="plane" size="0 0 0.05" friction="${friction} 0.005 0.0001"/>`;
    const scene = `<mujoco model="venus-${options.robot}">
  <include file="robot.xml"/>
  <option timestep="${policy.config.simulation_dt}" gravity="0 0 ${-options.gravity}"
          density="${options.gasDensity}" viscosity="${options.gasViscosity}" wind="${options.windMs} 0 0"/>
  ${grid ? `<asset><hfield name="terrain" nrow="${n}" ncol="${n}" size="${half} ${half} ${zRange} 0.2"/></asset>` : ""}
  <worldbody>${ground}</worldbody>
</mujoco>`;
    mj.FS.writeFile(`/${options.robot}/scene.xml`, scene);
    const model = mj.MjModel.from_xml_path(`/${options.robot}/scene.xml`);
    if (grid) {
      const hd = model.hfield_data as Float32Array;
      for (let i = 0; i < grid.length; i++) hd[i] = (grid[i] - lo) / zRange;
    }
    const data = new mj.MjData(model);
    return new RobotWorld(mj, model, data, policy, options, lo);
  }

  reset() {
    const { mj, model, data } = this;
    mj.mj_resetData(model, data);
    const qpos = data.qpos as Float64Array;
    qpos[2] = this.startZ;
    const spring = model.qpos_spring as Float64Array;
    for (const h of this.hinges) spring[h.qadr] = 0;
    mj.mj_forward(model, data);
    this.controller.reset();
    this.accumulator = 0;
  }

  /** Advance by real time `dt` [s] in fixed physics steps. Returns steps taken. */
  advance(dt: number, input: StepInputs): number {
    const { mj, model, data, controller, tau, frcLimit } = this;
    this.accumulator = Math.min(this.accumulator + dt, 0.1);
    const h = model.opt.timestep;
    const qpos = data.qpos as Float64Array;
    const qvel = data.qvel as Float64Array;
    const ctrl = data.ctrl as Float64Array;
    const xfrc = data.xfrc_applied as Float64Array;
    const spring = model.qpos_spring as Float64Array;
    const mp = this.plasticMoment0 * Math.max(input.plasticScale, 0);
    controller.command = input.command;
    for (let b = 1; b < model.nbody; b++) xfrc[b * 6 + 2] = this.buoyancy[b];
    let steps = 0;
    while (this.accumulator >= h) {
      controller.torques(qpos, qvel, tau);
      const s = input.torqueScale;
      for (let j = 0; j < tau.length; j++) {
        const lim = frcLimit[j] * s;
        ctrl[j] = Math.max(-lim, Math.min(lim, tau[j] * s));
      }
      mj.mj_step(model, data);
      controller.afterStep(qpos, qvel);
      // Return mapping: elastic up to the plastic moment, then permanent set.
      for (const hg of this.hinges) {
        const q = qpos[hg.qadr];
        const m = hg.k * (q - spring[hg.qadr]);
        if (Math.abs(m) > mp) spring[hg.qadr] = q - (Math.sign(m) * mp) / hg.k;
      }
      this.accumulator -= h;
      steps++;
    }
    return steps;
  }

  /** Largest permanent bend across the yield hinges [rad]. */
  get maxPermanentBend(): number {
    const spring = this.model.qpos_spring as Float64Array;
    return this.hinges.reduce((m, h) => Math.max(m, Math.abs(spring[h.qadr])), 0);
  }

  get pelvis(): { x: number; y: number; z: number } {
    const q = this.data.qpos as Float64Array;
    return { x: q[0], y: q[1], z: q[2] };
  }

  dispose() {
    this.data.delete();
    this.model.delete();
  }
}
