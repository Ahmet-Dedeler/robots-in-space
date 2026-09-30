"use client";

/**
 * A humanoid running in MuJoCo (WASM) under Venus gravity, CO2 density and
 * wind, driven by its real walking policy. Each physics step, motor torque is
 * scaled by what the thermal model says the actuators can still deliver at
 * the current experiment time; when the controller dies, the joints go limp.
 *
 * Mechanics always run in real time. The thermal clock can be warped, so a
 * 10-minute soak plays out while you watch the robot walk.
 *
 * Damage is visual *and* mechanical: covers soften, char, slump and drip
 * (driven by the skin temperature), a battery in runaway glows and vents, and
 * a weakening frame caps how much load the joints can carry.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useLab } from "@/lib/lab-store";
import { surfaceMedium } from "@/sim/planets/world";
import { stateAt } from "@/sim/mission/run";
import type { MjModel } from "@mujoco/mujoco";
import { RobotWorld, type FileProvider } from "@/sim/robots/robot-world";
import { displacedVolumeM3 } from "@/sim/vehicles/volume";
import { loadMujoco } from "../mujoco";
import { useTerrain } from "./useScene";
import {
  applyShellDamage,
  createDamageMaterial,
  createDamageUniforms,
  incandescence,
  shellDamage,
  skinMaterialOf,
  type DamageUniforms,
} from "./damage";
import { MeltDrips, Plume, type DripsHandle, type PlumeHandle } from "./effects";

const MJ_MESH = 7;

const FINISH = {
  stock: { light: "#d9d6d0", dark: "#2a2a2e", metal: 0.35 },
  white: { light: "#f1efea", dark: "#1c1c1f", metal: 0.15 },
  titanium: { light: "#a7a39c", dark: "#6f6a63", metal: 0.8 },
} as const;
export type Finish = keyof typeof FINISH;

interface RigMesh {
  geom: number;
  obj: THREE.Mesh;
  /** Visible vertex count, used to sample drip/fume sources. */
  verts: number;
}

function buildMeshes(model: MjModel, finish: Finish, uniforms: DamageUniforms): { group: THREE.Group; meshes: RigMesh[] } {
  const group = new THREE.Group();
  const meshes: RigMesh[] = [];
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
  const gbody = model.geom_bodyid as Int32Array;
  const geometries = new Map<number, THREE.BufferGeometry>();
  const materials = new Map<string, THREE.MeshStandardMaterial>();

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
    // Body 1 is the pelvis/torso, where the battery sits: it can glow in runaway.
    const torso = gbody[g] === 1;
    const key = `${dark ? "d" : "l"}${torso ? "t" : ""}`;
    let mat = materials.get(key);
    if (!mat) {
      mat = createDamageMaterial(
        { color: new THREE.Color(dark ? f.dark : f.light), metalness: dark ? 0.2 : f.metal, roughness: 0.45 },
        uniforms,
        { shell: true, glow: torso },
      );
      materials.set(key, mat);
    }
    const obj = new THREE.Mesh(geo, mat);
    obj.castShadow = true;
    obj.matrixAutoUpdate = false;
    group.add(obj);
    meshes.push({ geom: g, obj, verts: vnum[m] });
  }
  return { group, meshes };
}

const browserFiles: FileProvider = {
  text: (p) => fetch(`/${p}`).then((r) => r.text()),
  bytes: async (p) => new Uint8Array((await fetch(`/${p}`).then((r) => r.arrayBuffer())) as ArrayBuffer),
};

/** Everything the frame loop mutates lives here, outside React state. */
interface Runtime {
  world: RobotWorld;
  meshes: RigMesh[];
  wasAlive: boolean;
  lastReset: number;
  dripAcc: number;
  fumeAcc: number;
  ventAcc: number;
  wasMelting: boolean;
}

/** Walk a ~5 m circle (0.5 m/s, 0.1 rad/s) so the robot stays on the detailed terrain patch. */
const WALK: [number, number, number] = [0.5, 0, 0.1];
const STAND: [number, number, number] = [0, 0, 0];

export function HumanoidView({
  robot,
  finish = "stock",
  onReady,
}: {
  robot: "g1" | "h1";
  finish?: Finish;
  onReady?: (ok: boolean, err?: string) => void;
}) {
  // Gravity and gas of whichever world we're on (Venus CO2, thin Mars air, or vacuum).
  const gravity = useLab((s) => surfaceMedium(s.config.scenario).gravity);
  const gasDensity = useLab((s) => surfaceMedium(s.config.scenario).densityKgM3);
  const gasViscosity = useLab((s) => surfaceMedium(s.config.scenario).viscosity);
  const windMs = useLab((s) => surfaceMedium(s.config.scenario).windMs);
  const massKg = useLab((s) => s.config.build.massKg);
  const volume = useLab((s) => displacedVolumeM3(s.config.build));
  const loadFraction = useLab((s) => s.config.build.frame.loadFraction);
  const terrain = useTerrain();
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const runtime = useRef<Runtime | null>(null);
  const followTarget = useRef(new THREE.Vector3(0, 0.8, 0));
  const tmp = useRef(new THREE.Matrix4());
  const uniforms = useMemo(() => createDamageUniforms(), []);
  const drips = useRef<DripsHandle>(null);
  const plume = useRef<PlumeHandle>(null);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;

  // (Re)build the MuJoCo world when the robot, the medium or the ground changes.
  useEffect(() => {
    let cancelled = false;
    loadMujoco()
      .then((mj) =>
        RobotWorld.create(mj, browserFiles, {
          robot,
          gravity,
          gasDensity,
          gasViscosity,
          windMs,
          massKg,
          displacedVolumeM3: volume,
          terrain,
          frameLoadFraction: loadFraction,
          terrainHalf: 7,
          terrainRes: 0.025,
        }),
      )
      .then((world) => {
        if (cancelled) return world.dispose();
        const rig = buildMeshes(world.model, finish, uniforms);
        runtime.current = {
          world,
          meshes: rig.meshes,
          wasAlive: true,
          lastReset: useLab.getState().playback.resetToken,
          dripAcc: 0,
          fumeAcc: 0,
          ventAcc: 0,
          wasMelting: false,
        };
        setGroup(rig.group);
        onReady?.(true);
      })
      .catch((e: unknown) => onReady?.(false, e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      runtime.current?.world.dispose();
      runtime.current = null;
      setGroup(null);
    };
  }, [robot, finish, gravity, gasDensity, gasViscosity, windMs, massKg, volume, loadFraction, terrain, onReady, uniforms]);

  useFrame((_, delta) => {
    const rt = runtime.current;
    if (!rt) return;
    const { world } = rt;
    const { playback, result, config } = useLab.getState();
    const st = stateAt(result, playback.t);

    // Reset on restart, or when scrubbing back from dead to alive.
    const alive = st.controller && st.power;
    if (rt.lastReset !== playback.resetToken || (alive && !rt.wasAlive)) {
      rt.lastReset = playback.resetToken;
      world.reset();
      drips.current?.clear();
      plume.current?.clear();
    }
    rt.wasAlive = alive;

    if (playback.playing) {
      // Thermal model -> mechanics: available motor torque (limp when dead) and the
      // frame's hot yield strength, which sets the limbs' plastic moment.
      world.advance(delta, {
        torqueScale: alive ? st.torqueFraction : 0,
        plasticScale: st.frameYieldFraction,
        command: config.scenario.activity === "walking" ? WALK : STAND,
      });
    }

    // Copy MuJoCo poses (Z-up) into the three.js meshes; parent group rotates to Y-up.
    const xpos = world.data.geom_xpos as Float64Array;
    const xmat = world.data.geom_xmat as Float64Array;
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

    // ---- Thermal damage visuals ---------------------------------------------------
    const idx = (id: string) => result.nodes.findIndex((n) => n.id === id);
    const skinK = st.nodeK[idx("skin")] ?? st.ambientK;
    const dmg = shellDamage(skinMaterialOf(result.build), skinK);
    applyShellDamage(uniforms, dmg);
    const iB = idx("battery");
    const batteryK = iB >= 0 ? st.nodeK[iB] : 0;
    uniforms.uGlow.value.copy(incandescence(batteryK));
    // Battery pack sits ~25 cm up the torso axis from the pelvis origin (MuJoCo z-up -> three y-up).
    {
      const xp = world.data.xpos as Float64Array;
      const xm = world.data.xmat as Float64Array;
      uniforms.uGlowCenter.value.set(xp[3] + 0.25 * xm[9 + 2], xp[5] + 0.25 * xm[9 + 8], -(xp[4] + 0.25 * xm[9 + 5]));
    }

    // Scrubbed back before the covers melted: remove puddles and fumes.
    const melting = dmg.melt > 0.02;
    if (!melting && rt.wasMelting) {
      drips.current?.clear();
      plume.current?.clear();
    }
    rt.wasMelting = melting;

    if (playback.playing) {
      const sample = () => {
        const mesh = rt.meshes[Math.floor(Math.random() * rt.meshes.length)];
        const pos = mesh.obj.geometry.attributes.position as THREE.BufferAttribute;
        return new THREE.Vector3().fromBufferAttribute(pos, Math.floor(Math.random() * mesh.verts)).applyMatrix4(mesh.obj.matrixWorld);
      };
      rt.dripAcc += dmg.drip * 45 * delta;
      const newDrips: THREE.Vector3[] = [];
      while (rt.dripAcc >= 1) {
        newDrips.push(sample());
        rt.dripAcc -= 1;
      }
      if (newDrips.length) drips.current?.spawn(newDrips);
      rt.fumeAcc += dmg.fume * 30 * delta;
      while (rt.fumeAcc >= 1) {
        plume.current?.emit(sample(), { color: new THREE.Color(0.42, 0.36, 0.3), size: 0.07, rise: 0.22, spread: 0.02, life: 3.5 });
        rt.fumeAcc -= 1;
      }
      // Battery venting after runaway, while the pack is still hotter than the air.
      const runaway = result.events.find((e) => e.title === "Thermal runaway");
      const excess = batteryK - st.ambientK;
      if (runaway && playback.t >= runaway.t && excess > 30) {
        rt.ventAcc += Math.min(1, excess / 400) * 70 * delta;
        const torso = uniforms.uGlowCenter.value.clone();
        const hot = Math.min(1, excess / 500);
        while (rt.ventAcc >= 1) {
          plume.current?.emit(torso, { color: new THREE.Color(0.1 + 0.25 * hot, 0.09 + 0.1 * hot, 0.08), size: 0.14, rise: 0.6, spread: 0.12, life: 5 });
          rt.ventAcc -= 1;
        }
      }
    }

    // Camera follows the pelvis (MuJoCo x,y,z -> three x,z,-y).
    const qp = world.data.qpos as Float64Array;
    const target = followTarget.current;
    target.lerp(new THREE.Vector3(qp[0], qp[2] * 0.8 + 0.1, -qp[1]), 0.08);
    if (controls) {
      const shift = target.clone().sub(controls.target);
      controls.target.add(shift);
      camera.position.add(shift);
      controls.update();
    }
  });

  return (
    <>
      {group && <primitive object={group} rotation-x={-Math.PI / 2} />}
      <MeltDrips ref={drips} groundAt={(x, z) => terrain.height(x, -z)} />
      <Plume ref={plume} />
    </>
  );
}
