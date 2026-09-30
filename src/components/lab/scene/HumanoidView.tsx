"use client";

/**
 * A humanoid running in MuJoCo (WASM) under Venus gravity, CO2 density and
 * wind, driven by its real walking policy. Each physics step, motor torque is
 * scaled by what the thermal model says the actuators can still deliver at
 * the current experiment time; when the controller dies, the joints go limp.
 *
 * Mechanics always run in real time. The thermal clock can be warped, so a
 * 10-minute soak plays out while you watch the robot walk.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useLab } from "@/lib/lab-store";
import { atmosphere } from "@/sim/env/atmosphere";
import { stateAt } from "@/sim/mission/run";
import { WalkController } from "@/sim/robots/policy";
import { createRobotSim, type RobotSim } from "../mujoco";

const MJ_MESH = 7;

const FINISH = {
  stock: { light: "#d9d6d0", dark: "#2a2a2e", metal: 0.35 },
  white: { light: "#f1efea", dark: "#1c1c1f", metal: 0.15 },
  titanium: { light: "#a7a39c", dark: "#6f6a63", metal: 0.8 },
} as const;
export type Finish = keyof typeof FINISH;

function buildMeshes(sim: RobotSim, finish: Finish): { group: THREE.Group; meshes: { geom: number; obj: THREE.Mesh }[] } {
  const { model } = sim;
  const group = new THREE.Group();
  const meshes: { geom: number; obj: THREE.Mesh }[] = [];
  const vert = model.mesh_vert as Float32Array;
  const face = model.mesh_face as Int32Array;
  const vadr = model.mesh_vertadr as Int32Array;
  const vnum = model.mesh_vertnum as Int32Array;
  const fadr = model.mesh_faceadr as Int32Array;
  const fnum = model.mesh_facenum as Int32Array;
  const gtype = model.geom_type as Int32Array;
  const ggroup = model.geom_group as Int32Array;
  const gdata = model.geom_dataid as Int32Array;
  const grgba = model.geom_rgba as Float32Array;
  const geometries = new Map<number, THREE.BufferGeometry>();

  for (let g = 0; g < model.ngeom; g++) {
    if (gtype[g] !== MJ_MESH || ggroup[g] !== 1) continue;
    const m = gdata[g];
    let geo = geometries.get(m);
    if (!geo) {
      geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(vert.slice(vadr[m] * 3, (vadr[m] + vnum[m]) * 3), 3));
      geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(face.slice(fadr[m] * 3, (fadr[m] + fnum[m]) * 3)), 1));
      geo.computeVertexNormals();
      geometries.set(m, geo);
    }
    // H1 meshes are all dark in the source model; for the white finish, only the smallest parts stay dark (joints).
    const f = FINISH[finish];
    const dark = finish === "white" ? fnum[m] < 400 : grgba[g * 4] < 0.4;
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(dark ? f.dark : f.light),
      metalness: dark ? 0.2 : f.metal,
      roughness: 0.45,
    });
    const obj = new THREE.Mesh(geo, mat);
    obj.castShadow = true;
    obj.matrixAutoUpdate = false;
    group.add(obj);
    meshes.push({ geom: g, obj });
  }
  return { group, meshes };
}

/** Everything the frame loop mutates lives here, outside React state. */
interface Runtime {
  sim: RobotSim;
  meshes: { geom: number; obj: THREE.Mesh }[];
  controller: WalkController;
  tau: Float64Array;
  frcLimit: Float64Array;
  acc: number;
  wasAlive: boolean;
  lastReset: number;
}

export function HumanoidView({
  robot,
  finish = "stock",
  onReady,
}: {
  robot: "g1" | "h1";
  finish?: Finish;
  onReady?: (ok: boolean, err?: string) => void;
}) {
  const elevationM = useLab((s) => s.config.scenario.elevationM);
  const windMs = useLab((s) => s.config.scenario.windMs);
  const activity = useLab((s) => s.config.scenario.activity);
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const runtime = useRef<Runtime | null>(null);
  const followTarget = useRef(new THREE.Vector3(0, 0.8, 0));
  const tmp = useRef(new THREE.Matrix4());
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;

  // (Re)build the MuJoCo world when the robot or the medium changes.
  useEffect(() => {
    let cancelled = false;
    const atm = atmosphere(elevationM);
    createRobotSim(robot, { gravity: atm.gravity, density: atm.densityKgM3, viscosity: atm.gas.mu, windMs })
      .then((sim) => {
        if (cancelled) return sim.dispose();
        const rig = buildMeshes(sim, finish);
        const trn = sim.model.actuator_trnid as Int32Array;
        const range = sim.model.jnt_actfrcrange as Float64Array;
        runtime.current = {
          sim,
          meshes: rig.meshes,
          controller: new WalkController(sim.policy),
          tau: new Float64Array(sim.model.nu),
          frcLimit: Float64Array.from({ length: sim.model.nu }, (_, i) => range[trn[i * 2] * 2 + 1] || 1e9),
          acc: 0,
          wasAlive: true,
          lastReset: useLab.getState().playback.resetToken,
        };
        setGroup(rig.group);
        onReady?.(true);
      })
      .catch((e: unknown) => onReady?.(false, e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      runtime.current?.sim.dispose();
      runtime.current = null;
      setGroup(null);
    };
  }, [robot, finish, elevationM, windMs, onReady]);

  // Walking or standing still: same policy, zero velocity command.
  useEffect(() => {
    const cmd: [number, number, number] = activity === "walking" ? [0.5, 0, 0] : [0, 0, 0];
    if (runtime.current) runtime.current.controller.command = cmd;
  }, [activity, group]);

  useFrame((_, delta) => {
    const rt = runtime.current;
    if (!rt) return;
    const { sim, controller, tau, frcLimit } = rt;
    const { playback, result } = useLab.getState();
    const st = stateAt(result, playback.t);

    // Reset on restart, or when scrubbing back from dead to alive.
    const alive = st.controller && st.power;
    if (rt.lastReset !== playback.resetToken || (alive && !rt.wasAlive)) {
      rt.lastReset = playback.resetToken;
      sim.mj.mj_resetData(sim.model, sim.data);
      sim.mj.mj_forward(sim.model, sim.data);
      controller.reset();
    }
    rt.wasAlive = alive;

    if (playback.playing) {
      const frameOk = st.frameYieldFraction >= result.build.frame.loadFraction;
      // Thermal model -> actuators: available torque, limp when the controller is dead.
      const scale = alive ? st.torqueFraction * (frameOk ? 1 : 0.3) : 0;
      const dt = sim.model.opt.timestep;
      rt.acc = Math.min(rt.acc + delta, 0.1);
      const qpos = sim.data.qpos as Float64Array;
      const qvel = sim.data.qvel as Float64Array;
      const ctrl = sim.data.ctrl as Float64Array;
      while (rt.acc >= dt) {
        controller.torques(qpos, qvel, tau);
        for (let j = 0; j < tau.length; j++) {
          const lim = frcLimit[j] * scale;
          ctrl[j] = Math.max(-lim, Math.min(lim, tau[j] * scale));
        }
        sim.mj.mj_step(sim.model, sim.data);
        controller.afterStep(qpos, qvel);
        rt.acc -= dt;
      }
    }

    // Copy MuJoCo poses (Z-up) into the three.js meshes; parent group rotates to Y-up.
    const xpos = sim.data.geom_xpos as Float64Array;
    const xmat = sim.data.geom_xmat as Float64Array;
    const m = tmp.current;
    for (const { geom: g, obj } of rt.meshes) {
      const p = g * 3;
      const r = g * 9;
      m.set(
        xmat[r], xmat[r + 1], xmat[r + 2], xpos[p],
        xmat[r + 3], xmat[r + 4], xmat[r + 5], xpos[p + 1],
        xmat[r + 6], xmat[r + 7], xmat[r + 8], xpos[p + 2],
        0, 0, 0, 1,
      );
      obj.matrix.copy(m);
    }

    // Camera follows the pelvis (MuJoCo x,y,z -> three x,z,-y).
    const qp = sim.data.qpos as Float64Array;
    const target = followTarget.current;
    target.lerp(new THREE.Vector3(qp[0], Math.max(0.4, qp[2] * 0.8), -qp[1]), 0.08);
    if (controls) {
      const shift = target.clone().sub(controls.target);
      controls.target.add(shift);
      camera.position.add(shift);
      controls.update();
    }
  });

  if (!group) return null;
  return <primitive object={group} rotation-x={-Math.PI / 2} />;
}
