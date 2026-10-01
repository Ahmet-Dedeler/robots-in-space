"use client";

/**
 * Construction machines (Cat skid steer, track loader, dozer, excavator;
 * NASA IPEx) in MuJoCo on the shared terrain, drawn by machine-models.ts.
 *
 * Thermal model -> mechanics:
 * - drive: only if the powerplant can run (a diesel can't: no oxygen) and
 *   the controller is alive; scaled by available motor torque
 * - hydraulics: pressure only with a running pump and intact seals/oil;
 *   otherwise arms, blade and boom sink under their own weight
 * - rubber: burnt tyres collapse onto their rims, rubber tracks onto the rollers
 * Visuals: Cat-yellow powder coat, black paint and rubber soften and char with
 * their temperatures.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useLab } from "@/lib/lab-store";
import { MATERIALS } from "@/sim/materials/materials";
import { stateAt } from "@/sim/mission/run";
import { surfaceMedium } from "@/sim/planets/world";
import { MachineWorld } from "@/sim/robots/machine-world";
import { MACHINES, type MachineModel } from "@/sim/robots/machines";
import { runningGear } from "@/sim/vehicles/types";
import { displacedVolumeM3 } from "@/sim/vehicles/volume";
import { loadMujoco } from "../mujoco";
import { applyShellDamage, createDamageMaterial, createDamageUniforms, shellDamage } from "./damage";
import { Plume, type PlumeHandle } from "./effects";
import { buildMachine, type MachineRig } from "./machine-models";
import { placeRam, standardMaterials, type MachineMaterials } from "./machine-parts";
import { useTerrain } from "./useScene";

const CAT_YELLOW = "#f2b705";
const RUBBER = new THREE.Color("#1b1a19");
const CHAR = new THREE.Color("#0b0908");
const STEEL_SHOE = new THREE.Color("#3a3936");

interface Runtime {
  world: MachineWorld;
  rig: MachineRig;
  bodyIds: [THREE.Group, number][];
  /** Reference gear joint per side for the belt (left, right). */
  beltRef: Record<1 | -1, number>;
  r0: Float64Array;
  lastReset: number;
  fumeAcc: number;
}

export function MachineView({ model }: { model: MachineModel }) {
  // Gravity and gas of whichever world we're on (Venus CO2, thin Mars air, or vacuum).
  const gravity = useLab((s) => surfaceMedium(s.config.scenario).gravity);
  const gasDensity = useLab((s) => surfaceMedium(s.config.scenario).densityKgM3);
  const gasViscosity = useLab((s) => surfaceMedium(s.config.scenario).viscosity);
  const windMs = useLab((s) => surfaceMedium(s.config.scenario).windMs);
  const massKg = useLab((s) => s.config.build.massKg);
  const volume = useLab((s) => displacedVolumeM3(s.config.build));
  const terrain = useTerrain();
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const runtime = useRef<Runtime | null>(null);
  const paint = useMemo(() => createDamageUniforms(), []);
  const rubber = useMemo(() => createDamageUniforms(), []);
  const mats = useMemo<MachineMaterials>(() => {
    const ipex = model === "ipex";
    return {
      ...standardMaterials(),
      paint: createDamageMaterial({ color: CAT_YELLOW, roughness: 0.5, metalness: 0.15 }, paint, { shell: true, glow: false }),
      dark: createDamageMaterial({ color: "#1f1f20", roughness: 0.6, metalness: 0.25 }, paint, { shell: true, glow: false }),
      rubber: createDamageMaterial({ color: "#1b1a19", roughness: 0.92, metalness: 0 }, rubber, { shell: true, glow: false }),
      white: createDamageMaterial({ color: ipex ? "#e9e7e1" : "#dddddd", roughness: 0.55, metalness: 0.1 }, paint, { shell: true, glow: false }),
    };
  }, [model, paint, rubber]);
  const plume = useRef<PlumeHandle>(null);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(1, 1, 1) }), []);
  const follow = useRef(new THREE.Vector3(0, 1, 0));
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;

  useEffect(() => {
    let cancelled = false;
    loadMujoco()
      .then((mj) => MachineWorld.create(mj, { model, gravity, gasDensity, gasViscosity, windMs, massKg, displacedVolumeM3: volume, terrain }).then((world) => ({ mj, world })))
      .then(({ mj, world }) => {
        if (cancelled) return world.dispose();
        const rig = buildMachine(MACHINES[model], mats);
        const BODY = mj.mjtObj.mjOBJ_BODY.value;
        const bodyIds: [THREE.Group, number][] = [...rig.bodies].map(([name, g]) => [g, mj.mj_name2id(world.model, BODY, name)]);
        // Belts follow a ground-contact roller on their side.
        const left = world.gear.findIndex((j) => j.side === 1 && j.z <= j.r + 1e-6);
        const right = world.gear.findIndex((j) => j.side === -1 && j.z <= j.r + 1e-6);
        const r0 = Float64Array.from(world.gear, (j) => j.r);
        runtime.current = { world, rig, bodyIds, beltRef: { 1: left, [-1]: right } as Record<1 | -1, number>, r0, lastReset: useLab.getState().playback.resetToken, fumeAcc: 0 };
        setGroup(rig.root);
      });
    return () => {
      cancelled = true;
      runtime.current?.world.dispose();
      runtime.current = null;
      setGroup(null);
    };
  }, [model, gravity, gasDensity, gasViscosity, windMs, massKg, volume, terrain, mats]);

  useFrame((_, delta) => {
    const rt = runtime.current;
    if (!rt) return;
    const { world, rig } = rt;
    const { playback, result, config } = useLab.getState();
    const st = stateAt(result, playback.t);
    if (rt.lastReset !== playback.resetToken) {
      rt.lastReset = playback.resetToken;
      world.reset();
      plume.current?.clear();
    }
    const passed = (pred: (e: (typeof result.events)[number]) => boolean) => result.events.some((e) => pred(e) && e.t <= playback.t);
    const runs = result.build.powerplant?.kind !== "diesel";
    const gear = runningGear(result.build);
    const rubberOk = !passed((e) => e.title === `${gear} pyrolysing`);
    const hydraulicsFailed = passed((e) => e.node === "hydraulics" && (e.severity === "fail" || e.severity === "fatal"));
    // Pumps need an engine/motor that runs and a controller commanding them.
    const hydraulics = runs && st.controller && !hydraulicsFailed ? 1 : 0;
    const drive = st.canWalk ? st.torqueFraction : 0;

    if (playback.playing) {
      world.advance(delta, { driveScale: drive, hydraulics, rubber: rubberOk, working: config.scenario.activity === "walking" && st.controller });
    }

    // Body poses (MuJoCo frame; the root group turns it y-up).
    const xpos = world.data.xpos as Float64Array;
    const xquat = world.data.xquat as Float64Array;
    for (const [g, id] of rt.bodyIds) {
      tmp.p.set(xpos[id * 3], xpos[id * 3 + 1], xpos[id * 3 + 2]);
      tmp.q.set(xquat[id * 4 + 1], xquat[id * 4 + 2], xquat[id * 4 + 3], xquat[id * 4]);
      g.matrix.compose(tmp.p, tmp.q, tmp.s);
    }
    // Chassis-relative parts (belts, rollers) live in the chassis group; rams span two bodies.
    for (const belt of rig.belts) {
      const i = rt.beltRef[belt.side];
      if (i >= 0) belt.update(world.gearAngle(i) * world.gear[i].r);
    }
    for (const w of rig.wheels) {
      const i = rt.beltRef[w.side];
      if (i >= 0) w.obj.rotation.set(0, (world.gearAngle(i) * world.gear[i].r) / w.r, 0);
    }
    for (const ram of rig.rams) placeRam(ram, rig.bodies);
    // Burnt tyres: shrink radially to what the physics now rolls on.
    for (const t of rig.tyres) {
      const j = world.gear[t.gear];
      const k = (rubberOk ? j.r : j.bareR) / rt.r0[t.gear];
      t.obj.scale.set(k, 1, k);
    }

    // Surface damage from the thermal model.
    const idx = (id: string) => result.nodes.findIndex((n) => n.id === id);
    const skinK = st.nodeK[idx("skin")] ?? st.ambientK;
    const paintDmg = shellDamage(MATERIALS[result.build.paint ?? result.build.skin.material], skinK);
    applyShellDamage(paint, paintDmg);
    const iT = idx("tires");
    const tireMat = result.build.tires ? MATERIALS[result.build.tires.material] : undefined;
    const tireDmg = iT >= 0 && tireMat ? shellDamage(tireMat, st.nodeK[iT]) : null;
    if (tireDmg) applyShellDamage(rubber, tireDmg);
    // Instanced track links can't take the damage shader: tint them instead.
    if (tireMat?.kind === "metal") mats.track.color.copy(STEEL_SHOE);
    else mats.track.color.copy(RUBBER).lerp(CHAR, tireDmg?.char ?? 0);

    // Pyrolysis fumes from paint and rubber.
    if (playback.playing) {
      rt.fumeAcc += (paintDmg.fume * 20 + (tireDmg?.fume ?? 0) * 30) * delta;
      const parts = [...rig.bodies.values()];
      while (rt.fumeAcc >= 1) {
        const pick = parts[Math.floor(Math.random() * parts.length)];
        const pos = new THREE.Vector3().setFromMatrixPosition(pick.matrixWorld);
        plume.current?.emit(pos, { color: new THREE.Color(0.35, 0.3, 0.26), size: 0.12 * Math.sqrt(MACHINES[model].viewM / 9), rise: 0.25, spread: 0.4, life: 4 });
        rt.fumeAcc -= 1;
      }
    }

    // Camera follows the chassis.
    const q = world.data.qpos as Float64Array;
    follow.current.lerp(new THREE.Vector3(q[0], q[2] + MACHINES[model].viewM * 0.06, -q[1]), 0.06);
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
