/**
 * Recurrent walking policy from unitree_rl_gym (LSTM(64) -> Linear -> ELU ->
 * Linear), running in plain TypeScript. Weights are exported by
 * tools/bake_robots.py; math mirrors torch.nn.LSTM exactly (gate order i, f,
 * g, o) and is checked against PyTorch outputs in policy.test.ts.
 *
 * WalkController replicates deploy_mujoco.py: 50 Hz policy, PD torque control
 * at the physics rate, observation = [ang vel, projected gravity, command,
 * joint pos, joint vel, last action, gait phase sin/cos].
 */

export interface PolicyJson {
  hidden: number;
  inputs: number;
  outputs: number;
  lstm: { wIh: number[]; wHh: number[]; bIh: number[]; bHh: number[] };
  mlp: { w: number[]; b: number[]; rows: number }[];
  config: {
    simulation_dt: number;
    control_decimation: number;
    kps: number[];
    kds: number[];
    default_angles: number[];
    ang_vel_scale: number;
    dof_pos_scale: number;
    dof_vel_scale: number;
    action_scale: number;
    cmd_scale: number[];
    num_actions: number;
    num_obs: number;
    cmd_init: number[];
  };
  meshes: string[];
  /** Plastic hinges added to thighs/shins by tools/bake_robots.py. */
  yieldHinges?: { name: string; joints: string[]; lengthM: number; massSplit: [number, number] }[];
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const elu = (x: number) => (x > 0 ? x : Math.exp(x) - 1);

export class RecurrentPolicy {
  private readonly H: number;
  private readonly I: number;
  private readonly wIh: Float32Array;
  private readonly wHh: Float32Array;
  private readonly bias: Float32Array;
  private readonly layers: { w: Float32Array; b: Float32Array; rows: number; cols: number }[];
  private h: Float32Array;
  private c: Float32Array;
  private readonly gates: Float32Array;

  constructor(p: PolicyJson) {
    this.H = p.hidden;
    this.I = p.inputs;
    this.wIh = Float32Array.from(p.lstm.wIh);
    this.wHh = Float32Array.from(p.lstm.wHh);
    this.bias = Float32Array.from(p.lstm.bIh.map((v, i) => v + p.lstm.bHh[i]));
    let cols = p.hidden;
    this.layers = p.mlp.map((l) => {
      const layer = { w: Float32Array.from(l.w), b: Float32Array.from(l.b), rows: l.rows, cols };
      cols = l.rows;
      return layer;
    });
    this.h = new Float32Array(this.H);
    this.c = new Float32Array(this.H);
    this.gates = new Float32Array(4 * this.H);
  }

  reset() {
    this.h.fill(0);
    this.c.fill(0);
  }

  act(obs: ArrayLike<number>): Float32Array {
    const { H, I, wIh, wHh, bias, gates, h, c } = this;
    for (let r = 0; r < 4 * H; r++) {
      let s = bias[r];
      const oi = r * I;
      for (let k = 0; k < I; k++) s += wIh[oi + k] * obs[k];
      const oh = r * H;
      for (let k = 0; k < H; k++) s += wHh[oh + k] * h[k];
      gates[r] = s;
    }
    const hNew = new Float32Array(H);
    for (let k = 0; k < H; k++) {
      const i = sigmoid(gates[k]);
      const f = sigmoid(gates[H + k]);
      const g = Math.tanh(gates[2 * H + k]);
      const o = sigmoid(gates[3 * H + k]);
      c[k] = f * c[k] + i * g;
      hNew[k] = o * Math.tanh(c[k]);
    }
    this.h = hNew;
    let x: Float32Array = hNew;
    this.layers.forEach((l, li) => {
      const y = new Float32Array(l.rows);
      for (let r = 0; r < l.rows; r++) {
        let s = l.b[r];
        const o = r * l.cols;
        for (let k = 0; k < l.cols; k++) s += l.w[o + k] * x[k];
        y[r] = li < this.layers.length - 1 ? elu(s) : s;
      }
      x = y;
    });
    return x;
  }
}

/** Gravity direction in the base frame from a (w, x, y, z) quaternion. */
export function projectedGravity(qw: number, qx: number, qy: number, qz: number): [number, number, number] {
  return [2 * (-qz * qx + qw * qy), -2 * (qz * qy + qw * qx), 1 - 2 * (qw * qw + qz * qz)];
}

export class WalkController {
  readonly cfg: PolicyJson["config"];
  private readonly policy: RecurrentPolicy;
  private readonly obs: Float32Array;
  private action: Float32Array;
  private target: Float32Array;
  private counter = 0;
  /** Velocity command [vx, vy, yaw rate]. */
  command: [number, number, number];
  /** qpos / qvel addresses of the actuated joints, in actuator order. */
  private readonly qIdx: Int32Array;
  private readonly vIdx: Int32Array;

  /**
   * @param qIdx qpos address of each actuated joint (defaults to the floating-base layout 7..).
   * @param vIdx qvel address of each actuated joint (defaults to 6..).
   */
  constructor(p: PolicyJson, qIdx?: ArrayLike<number>, vIdx?: ArrayLike<number>) {
    this.cfg = p.config;
    this.policy = new RecurrentPolicy(p);
    this.obs = new Float32Array(this.cfg.num_obs);
    this.action = new Float32Array(this.cfg.num_actions);
    this.target = Float32Array.from(this.cfg.default_angles);
    this.command = this.cfg.cmd_init.slice(0, 3) as [number, number, number];
    const na = this.cfg.num_actions;
    this.qIdx = Int32Array.from(qIdx ?? Array.from({ length: na }, (_, j) => 7 + j));
    this.vIdx = Int32Array.from(vIdx ?? Array.from({ length: na }, (_, j) => 6 + j));
  }

  reset() {
    this.policy.reset();
    this.action.fill(0);
    this.target = Float32Array.from(this.cfg.default_angles);
    this.counter = 0;
    this.obs.fill(0);
  }

  get lastObservation() {
    return this.obs;
  }
  get lastAction() {
    return this.action;
  }

  /** PD torques toward the current joint targets. qpos/qvel are MuJoCo's full state vectors. */
  torques(qpos: ArrayLike<number>, qvel: ArrayLike<number>, out: Float64Array) {
    const { kps, kds } = this.cfg;
    for (let j = 0; j < this.cfg.num_actions; j++) {
      out[j] = (this.target[j] - qpos[this.qIdx[j]]) * kps[j] - qvel[this.vIdx[j]] * kds[j];
    }
    return out;
  }

  /** Call once after every physics step. Runs the policy every `control_decimation` steps. */
  afterStep(qpos: ArrayLike<number>, qvel: ArrayLike<number>) {
    this.counter++;
    const c = this.cfg;
    if (this.counter % c.control_decimation !== 0) return;
    const na = c.num_actions;
    const o = this.obs;
    const t = this.counter * c.simulation_dt;
    const phase = (t % 0.8) / 0.8;
    o[0] = qvel[3] * c.ang_vel_scale;
    o[1] = qvel[4] * c.ang_vel_scale;
    o[2] = qvel[5] * c.ang_vel_scale;
    const g = projectedGravity(qpos[3], qpos[4], qpos[5], qpos[6]);
    o[3] = g[0];
    o[4] = g[1];
    o[5] = g[2];
    for (let k = 0; k < 3; k++) o[6 + k] = this.command[k] * c.cmd_scale[k];
    for (let j = 0; j < na; j++) {
      o[9 + j] = (qpos[this.qIdx[j]] - c.default_angles[j]) * c.dof_pos_scale;
      o[9 + na + j] = qvel[this.vIdx[j]] * c.dof_vel_scale;
      o[9 + 2 * na + j] = this.action[j];
    }
    o[9 + 3 * na] = Math.sin(2 * Math.PI * phase);
    o[9 + 3 * na + 1] = Math.cos(2 * Math.PI * phase);
    this.action = this.policy.act(o);
    for (let j = 0; j < na; j++) this.target[j] = this.action[j] * c.action_scale + c.default_angles[j];
  }
}
