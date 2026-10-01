"use client";

/**
 * A rover drawn from its real model (NASA's Curiosity and Opportunity),
 * articulated on the model's own pivots.
 *
 * Rocker-bogie, solved each frame in each side's plane (small-angle
 * approximation: wheel contact points keep their rest x):
 * - each wheel centre sits one radius above the terrain under it;
 * - the bogie turns about its pivot so its two wheels (middle, rear) touch;
 * - the rocker turns about the body pivot so the front wheel and the bogie
 *   pivot both land where they must;
 * - the differential bar makes the body pitch by the mean of the two rocker
 *   angles and roll with the height difference of the two rocker pivots.
 * Rest geometry (pivots, wheel centres, radius) comes from the baked model.
 *
 * Steering: the corner wheels turn (Ackermann) so every wheel's axle points
 * at the centre of the 4 m circle the rover drives, as the real rovers'
 * corner actuators do; the middle wheels are fixed.
 *
 * Independent suspension (Lunokhod 1: eight wheels on torsion bars, skid
 * steered): the body sits on the plane fitted through the wheel contacts and
 * each wheel takes up its own residual within its spring travel.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useLab } from "@/lib/lab-store";
import { stateAt } from "@/sim/mission/run";
import { useRealModel } from "./real-models";
import { useTerrain } from "./useScene";

const PATH_R = 4;
const SIDES = ["L", "R"] as const;

type P2 = [number, number];
const rot = (p: P2, a: number): P2 => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];
const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
const ang = (v: P2) => Math.atan2(v[1], v[0]);

export function RealRoverView({ id, speedMs }: { id: string; speedMs: number }) {
  const model = useRealModel(id);
  const terrain = useTerrain();
  const root = useRef<THREE.Group>(null);
  const pose = useRef<THREE.Group>(null);
  const travelled = useRef(0);
  const spin = useRef(0);
  const fold = useRef(0);
  const controls = useThree((st) => st.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const camera = useThree((st) => st.camera);
  // The rig is a set of three.js objects mutated every frame: keep it in a ref (React Compiler rules).
  const rig = useRef<Record<string, THREE.Object3D>>({});
  useEffect(() => {
    rig.current = model.nodes;
  }, [model]);

  // Rest geometry per side, in the side plane (x forward, y up).
  const geo = useMemo(() => {
    const pv = model.meta.pivots;
    const wheels = Object.keys(pv).filter((k) => /^wheel_[LR]\d$/.test(k));
    if (!pv.rocker_L) {
      // Independent suspension: wheel contacts around their centroid.
      const W = wheels.map((k) => ({ k, x: pv[k][0], y: pv[k][1], z: pv[k][2] }));
      const cx = W.reduce((m, w) => m + w.x, 0) / W.length;
      const cz = W.reduce((m, w) => m + w.z, 0) / W.length;
      const R = (model.meta.parts?.[wheels[0]]?.[1] ?? 0.5) / 2;
      return { kind: "independent" as const, W, cx, cz, R, yRest: W.reduce((m, w) => m + w.y, 0) / W.length, height: model.meta.sizeM[1] };
    }
    const p2 = (n: string): P2 => [pv[n][0], pv[n][1]];
    const sides = SIDES.map((s) => ({
      z: (pv[`wheel_${s}0`][2] + pv[`wheel_${s}1`][2] + pv[`wheel_${s}2`][2]) / 3,
      D: p2(`rocker_${s}`),
      B: p2(`bogie_${s}`),
      W: [0, 1, 2].map((i) => p2(`wheel_${s}${i}`)) as [P2, P2, P2],
    }));
    const R = sides[0].W.reduce((m, w) => m + w[1], 0) / 3;
    const D: P2 = [(sides[0].D[0] + sides[1].D[0]) / 2, (sides[0].D[1] + sides[1].D[1]) / 2];
    // Turning centre on the axis of the fixed middle wheels.
    const xMid = (sides[0].W[1][0] + sides[1].W[1][0]) / 2;
    return { kind: "rockerBogie" as const, sides, R, D, xMid, height: model.meta.sizeM[1] };
  }, [model]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const { result, playback, config } = useLab.getState();
    const st = stateAt(result, playback.t);
    const moving = playback.playing && st.canWalk && st.world.awake > 0.5 && config.scenario.activity === "walking";
    if (moving) {
      travelled.current += speedMs * dt;
      spin.current += (speedMs * dt) / geo.R;
    }
    fold.current += ((st.world.awake > 0.5 ? 0 : 1) - fold.current) * Math.min(1, dt * 1.5);

    // Pose on the circle (terrain x east, y north; three z = -north). Rover frame: x forward, z right.
    const a = travelled.current / PATH_R;
    const cx = PATH_R * Math.sin(a);
    const cy = PATH_R - PATH_R * Math.cos(a);
    const fx = Math.cos(a);
    const fy = Math.sin(a);
    const ground = (u: number, v: number) => terrain.height(cx + fx * u + fy * v, cy + fy * u - fx * v);
    if (root.current) {
      root.current.position.set(cx, 0, -cy);
      root.current.rotation.set(0, a, 0);
    }

    const n = rig.current;
    if (geo.kind === "independent") {
      // Least-squares plane h = a + b u + c v through the wheel-centre targets.
      const pts = geo.W.map((w) => ({ w, u: w.x - geo.cx, v: w.z - geo.cz, h: ground(w.x - geo.cx, w.z - geo.cz) + geo.R }));
      const mean = pts.reduce((m, p) => m + p.h, 0) / pts.length;
      const b = pts.reduce((m, p) => m + p.u * (p.h - mean), 0) / pts.reduce((m, p) => m + p.u * p.u, 0);
      const c = pts.reduce((m, p) => m + p.v * (p.h - mean), 0) / pts.reduce((m, p) => m + p.v * p.v, 0);
      const p = pose.current;
      if (p) {
        p.position.set(geo.cx, mean, geo.cz);
        p.rotation.set(-Math.atan(c), 0, Math.atan(b), "XZY");
      }
      for (const q of pts) {
        const node = n[q.w.k];
        if (!node) continue;
        node.rotation.z = -spin.current;
        // Spring travel ±12 cm (guess; Lunokhod's torsion bars aren't documented in detail).
        node.position.y = q.w.y + Math.max(-0.12, Math.min(0.12, q.h - (mean + b * q.u + c * q.v)));
      }
      // Night: the lid (solar cells on its inside) closes over the instrument tub.
      if (n.lid) n.lid.rotation.z = THREE.MathUtils.lerp(0, -Math.PI / 2, fold.current);
      if (controls && root.current) {
        const target = new THREE.Vector3(root.current.position.x, mean + geo.height * 0.1, root.current.position.z);
        const shift = target.clone().sub(controls.target);
        controls.target.add(shift);
        camera.position.add(shift);
        controls.update();
      }
      return;
    }

    // Solve each side.
    const solved = geo.sides.map((s) => {
      const W = s.W.map((w) => [w[0], ground(w[0], s.z) + geo.R] as P2);
      // Bogie: rotate the rest (middle, rear) pair onto the targets; the pivot follows.
      const db = ang(sub(W[1], W[2])) - ang(sub(s.W[1], s.W[2]));
      const B = add(W[1], rot(sub(s.B, s.W[1]), db));
      // Rocker: front wheel and bogie pivot.
      const dr = ang(sub(B, W[0])) - ang(sub(s.B, s.W[0]));
      const D = add(W[0], rot(sub(s.D, s.W[0]), dr));
      return { db, dr, D };
    });
    const pitch = (solved[0].dr + solved[1].dr) / 2;
    const hD = (solved[0].D[1] + solved[1].D[1]) / 2;
    const xD = (solved[0].D[0] + solved[1].D[0]) / 2;
    const roll = Math.atan2(solved[0].D[1] - solved[1].D[1], geo.sides[1].z - geo.sides[0].z);
    const p = pose.current;
    if (p) {
      // Rotate about the differential pivot: outer group sits on it, the model is offset back.
      p.position.set(xD, hD, 0);
      p.rotation.set(roll, 0, pitch, "XZY");
    }
    SIDES.forEach((s, k) => {
      const sv = solved[k];
      const rocker = n[`rocker_${s}`];
      const bogie = n[`bogie_${s}`];
      if (rocker) rocker.rotation.z = sv.dr - pitch;
      if (bogie) bogie.rotation.z = sv.db - sv.dr;
      for (const i of [0, 1, 2]) {
        const w = n[`wheel_${s}${i}`];
        if (w) w.rotation.z = -spin.current;
        const steer = n[`steer_${s}${i}`];
        if (steer) {
          const [x, , z] = model.meta.pivots[`wheel_${s}${i}`];
          // Turning left (yaw +) about a centre PATH_R to the left (z = -PATH_R).
          steer.rotation.y = Math.atan2(x - geo.xMid, PATH_R + z);
        }
      }
    });
    // Night: the mast folds back onto the deck (MER stows its Pancam mast; harmless elsewhere).
    if (n.mast && id === "mer") n.mast.rotation.z = THREE.MathUtils.lerp(0, Math.PI / 2, fold.current);

    if (controls && root.current) {
      const target = new THREE.Vector3(root.current.position.x, hD + geo.height * 0.15, root.current.position.z);
      const shift = target.clone().sub(controls.target);
      controls.target.add(shift);
      camera.position.add(shift);
      controls.update();
    }
  });

  return (
    <group ref={root}>
      <group ref={pose}>
        <group position={geo.kind === "independent" ? [-geo.cx, -geo.yRest, -geo.cz] : [-geo.D[0], -geo.D[1], 0]}>
          <primitive object={model.scene} />
        </group>
      </group>
    </group>
  );
}
