"use client";

/**
 * CAT 262D3-class skid steer in MuJoCo on the Venera heightfield.
 *
 * Thermal model -> mechanics:
 * - drive: only if the powerplant can run (a diesel can't: no oxygen) and
 *   the controller is alive; scaled by available motor torque
 * - hydraulics: pressure only with a running pump and intact seals/oil;
 *   otherwise the lift arms fall under their own weight
 * - tyres: when the rubber pyrolyses the machine settles onto its steel rims
 * Visuals: CAT-yellow powder coat and tyres soften/char with their temperatures.
 */
import type { MjModel } from "@mujoco/mujoco";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useLab } from "@/lib/lab-store";
import { surfaceMedium } from "@/sim/planets/world";
import { MATERIALS } from "@/sim/materials/materials";
import { stateAt } from "@/sim/mission/run";
import { SkidsteerWorld } from "@/sim/robots/skidsteer-world";
import { displacedVolumeM3 } from "@/sim/vehicles/volume";
import { loadMujoco } from "../mujoco";
import { applyShellDamage, createDamageMaterial, createDamageUniforms, shellDamage, type DamageUniforms } from "./damage";
import { Plume, type PlumeHandle } from "./effects";
import { useTerrain } from "./useScene";

const GEOM_BOX = 6;
const GEOM_CYLINDER = 5;
const GEOM_CAPSULE = 3;

interface Part {
  geom: number;
  obj: THREE.Mesh;
  tire: boolean;
  radius0: number;
}

function buildRig(model: MjModel, name: (i: number) => string, paint: DamageUniforms, rubber: DamageUniforms) {
  const group = new THREE.Group();
  const parts: Part[] = [];
  const type = model.geom_type as Int32Array;
  const size = model.geom_size as Float64Array;
  const mats = {
    paint: createDamageMaterial({ color: "#f2b705", roughness: 0.55, metalness: 0.15 }, paint, { shell: true, glow: false }),
    steel: new THREE.MeshStandardMaterial({ color: "#3b3b3d", roughness: 0.6, metalness: 0.6 }),
    rim: new THREE.MeshStandardMaterial({ color: "#8a8a86", roughness: 0.5, metalness: 0.7 }),
    tire: createDamageMaterial({ color: "#1b1a19", roughness: 0.9, metalness: 0 }, rubber, { shell: true, glow: false }),
  };
  for (let g = 0; g < model.ngeom; g++) {
    const n = name(g) ?? "";
    if (n === "ground") continue;
    const sx = size[g * 3];
    const sy = size[g * 3 + 1];
    const sz = size[g * 3 + 2];
    let geo: THREE.BufferGeometry;
    if (type[g] === GEOM_BOX) geo = new THREE.BoxGeometry(2 * sx, 2 * sy, 2 * sz);
    else if (type[g] === GEOM_CYLINDER) geo = new THREE.CylinderGeometry(sx, sx, 2 * sy, n.startsWith("tire") ? 40 : 24).rotateX(Math.PI / 2);
    else if (type[g] === GEOM_CAPSULE) geo = new THREE.CapsuleGeometry(sx, 2 * sy, 4, 12).rotateX(Math.PI / 2);
    else continue;
    const mat = n.startsWith("paint") ? mats.paint : n.startsWith("tire") ? mats.tire : n.startsWith("rim") ? mats.rim : mats.steel;
    const obj = new THREE.Mesh(geo, mat);
    obj.matrixAutoUpdate = false;
    group.add(obj);
    parts.push({ geom: g, obj, tire: n.startsWith("tire"), radius0: sx });
  }
  return { group, parts };
}

export function WheeledView() {
  // Gravity and gas of whichever world we're on (Venus CO2, thin Mars air, or vacuum).
  const gravity = useLab((s) => surfaceMedium(s.config.scenario).gravity);
  const gasDensity = useLab((s) => surfaceMedium(s.config.scenario).densityKgM3);
  const gasViscosity = useLab((s) => surfaceMedium(s.config.scenario).viscosity);
  const windMs = useLab((s) => surfaceMedium(s.config.scenario).windMs);
  const massKg = useLab((s) => s.config.build.massKg);
  const volume = useLab((s) => displacedVolumeM3(s.config.build));
  const terrain = useTerrain();
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const runtime = useRef<{ world: SkidsteerWorld; parts: Part[]; lastReset: number; fumeAcc: number } | null>(null);
  const paint = useMemo(() => createDamageUniforms(), []);
  const rubber = useMemo(() => createDamageUniforms(), []);
  const plume = useRef<PlumeHandle>(null);
  const tmp = useRef(new THREE.Matrix4());
  const scale = useRef(new THREE.Matrix4());
  const follow = useRef(new THREE.Vector3(0, 1, 0));
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;

  useEffect(() => {
    let cancelled = false;
    loadMujoco()
      .then((mj) =>
        SkidsteerWorld.create(mj, {
          gravity,
          gasDensity,
          gasViscosity,
          windMs,
          massKg,
          displacedVolumeM3: volume,
          terrain,
        }).then((world) => ({ mj, world })),
      )
      .then(({ mj, world }) => {
        if (cancelled) return world.dispose();
        const rig = buildRig(world.model, (i) => mj.mj_id2name(world.model, mj.mjtObj.mjOBJ_GEOM.value, i), paint, rubber);
        runtime.current = { world, parts: rig.parts, lastReset: useLab.getState().playback.resetToken, fumeAcc: 0 };
        setGroup(rig.group);
      });
    return () => {
      cancelled = true;
      runtime.current?.world.dispose();
      runtime.current = null;
      setGroup(null);
    };
  }, [gravity, gasDensity, gasViscosity, windMs, massKg, volume, terrain, paint, rubber]);

  useFrame((_, delta) => {
    const rt = runtime.current;
    if (!rt) return;
    const { world } = rt;
    const { playback, result, config } = useLab.getState();
    const st = stateAt(result, playback.t);
    if (rt.lastReset !== playback.resetToken) {
      rt.lastReset = playback.resetToken;
      world.reset();
      plume.current?.clear();
    }
    const at = (title: string) => result.events.find((e) => e.title === title);
    const passed = (title: string) => {
      const e = at(title);
      return e !== undefined && e.t <= playback.t;
    };
    const runs = result.build.powerplant?.kind !== "diesel";
    const tires = !passed("Tyres pyrolysing");
    const hydraulics = runs && st.power && !passed("Lift arms drop") ? 1 : 0;
    const drive = st.canWalk ? st.torqueFraction : 0;

    if (playback.playing) {
      world.advance(delta, {
        driveScale: drive,
        hydraulics,
        tires,
        command: config.scenario.activity === "walking" ? [0.6, 0.8] : [0, 0],
      });
    }

    // Poses (MuJoCo z-up; parent group rotates to y-up). Collapsed tyres shrink radially.
    const xpos = world.data.geom_xpos as Float64Array;
    const xmat = world.data.geom_xmat as Float64Array;
    const size = world.model.geom_size as Float64Array;
    const m = tmp.current;
    for (const p of rt.parts) {
      const g = p.geom;
      const r = g * 9;
      m.set(
        xmat[r], xmat[r + 1], xmat[r + 2], xpos[g * 3],
        xmat[r + 3], xmat[r + 4], xmat[r + 5], xpos[g * 3 + 1],
        xmat[r + 6], xmat[r + 7], xmat[r + 8], xpos[g * 3 + 2],
        0, 0, 0, 1,
      );
      if (p.tire) {
        const k = size[g * 3] / p.radius0;
        m.multiply(scale.current.makeScale(k, k, 1));
      }
      p.obj.matrix.copy(m);
    }

    // Surface damage from the thermal model.
    const idx = (id: string) => result.nodes.findIndex((n) => n.id === id);
    const skinK = st.nodeK[idx("skin")] ?? st.ambientK;
    const paintDmg = shellDamage(MATERIALS[result.build.paint ?? result.build.skin.material], skinK);
    applyShellDamage(paint, paintDmg);
    const iT = idx("tires");
    const tireDmg = iT >= 0 ? shellDamage(MATERIALS[result.build.tires!.material], st.nodeK[iT]) : null;
    if (tireDmg) applyShellDamage(rubber, tireDmg);

    // Pyrolysis fumes from paint and tyres.
    if (playback.playing) {
      const rate = (paintDmg.fume * 20 + (tireDmg?.fume ?? 0) * 30) * delta;
      rt.fumeAcc += rate;
      while (rt.fumeAcc >= 1) {
        const pick = rt.parts[Math.floor(Math.random() * rt.parts.length)];
        const pos = new THREE.Vector3().setFromMatrixPosition(pick.obj.matrixWorld);
        plume.current?.emit(pos, { color: new THREE.Color(0.35, 0.3, 0.26), size: 0.12, rise: 0.25, spread: 0.4, life: 4 });
        rt.fumeAcc -= 1;
      }
    }

    // Camera follows the chassis.
    const q = world.data.qpos as Float64Array;
    follow.current.lerp(new THREE.Vector3(q[0], q[2] + 0.5, -q[1]), 0.06);
    if (controls) {
      const shift = follow.current.clone().sub(controls.target);
      controls.target.add(shift);
      camera.position.add(shift);
      controls.update();
    }
  });

  return (
    <>
      {group && <primitive object={group} rotation-x={-Math.PI / 2} />}
      <Plume ref={plume} />
    </>
  );
}
