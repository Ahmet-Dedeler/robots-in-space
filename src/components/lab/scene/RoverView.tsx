"use client";

/**
 * Planetary rovers, drawn from their published dimensions (no official
 * meshes are used). Kinematic, not MuJoCo: at 1-5 cm/s on a rocker-bogie
 * the dynamics are quasi-static, so each wheel simply rests on the same
 * terrain height function the rest of the lab uses, and the body sits on
 * the plane through the wheels (what a rocker-bogie averages to).
 *
 * The rover drives a slow circle at its real speed (real time, independent
 * of the thermal clock) whenever the sim says it can move, stops when it
 * can't, and folds up for the night when it hibernates (Yutu-2 folds a
 * solar wing over its deck; masts stow).
 *
 * Sizes (m): Opportunity 1.6 L x 2.3 W (wings) x 1.5 H; Curiosity 3.0 x 2.7
 * x 2.2 with a 0.64 m MMRTG at the back; Yutu-2 1.5 x 1.0 x 1.1; Pragyan
 * 0.92 x 0.75 x 0.40.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useLab } from "@/lib/lab-store";
import { stateAt } from "@/sim/mission/run";
import type { RoverModel } from "@/sim/vehicles/types";
import { useTerrain } from "./useScene";

interface Spec {
  body: [number, number, number];
  clearance: number;
  wheelR: number;
  wheelW: number;
  /** Wheel x positions (along the body) and half track. */
  wheelX: number[];
  track: number;
  mastH: number;
  bodyColor: string;
  mli: boolean;
  wings: "mer" | "yutu" | "side" | "fins" | "none";
  rtg: boolean;
}

const SPECS: Record<RoverModel, Spec> = {
  mer: { body: [1.1, 0.35, 0.8], clearance: 0.3, wheelR: 0.125, wheelW: 0.16, wheelX: [0.55, 0, -0.55], track: 0.6, mastH: 1.0, bodyColor: "#d8d4ca", mli: false, wings: "mer", rtg: false },
  msl: { body: [1.9, 0.55, 1.3], clearance: 0.6, wheelR: 0.25, wheelW: 0.4, wheelX: [1.0, 0.1, -0.9], track: 1.2, mastH: 1.3, bodyColor: "#e9e6de", mli: false, wings: "none", rtg: true },
  yutu: { body: [1.0, 0.5, 0.8], clearance: 0.3, wheelR: 0.15, wheelW: 0.15, wheelX: [0.5, 0, -0.5], track: 0.55, mastH: 0.55, bodyColor: "#c9a23a", mli: true, wings: "yutu", rtg: false },
  pragyan: { body: [0.6, 0.22, 0.5], clearance: 0.13, wheelR: 0.09, wheelW: 0.08, wheelX: [0.33, 0, -0.33], track: 0.34, mastH: 0.12, bodyColor: "#c9a23a", mli: true, wings: "side", rtg: false },
  lunokhod: { body: [1.7, 0.5, 1.2], clearance: 0.4, wheelR: 0.25, wheelW: 0.2, wheelX: [0.75, 0.25, -0.25, -0.75], track: 0.8, mastH: 0.3, bodyColor: "#b9b6ae", mli: false, wings: "none", rtg: false },
  crawler: { body: [1.4, 0.5, 1.0], clearance: 0.45, wheelR: 0.3, wheelW: 0.25, wheelX: [0.75, 0, -0.75], track: 0.75, mastH: 0.6, bodyColor: "#e4e1d8", mli: false, wings: "fins", rtg: false },
};

const PATH_R = 4;

function Wheel({ r, w }: { r: number; w: number }) {
  return (
    <group rotation={[Math.PI / 2, 0, 0]}>
      <mesh>
        <cylinderGeometry args={[r, r, w, 20, 1]} />
        <meshStandardMaterial color="#9d9b96" metalness={0.75} roughness={0.45} />
      </mesh>
      {/* Grousers: the cleats that give aluminium wheels grip in loose regolith. */}
      {Array.from({ length: 12 }, (_, i) => (
        <mesh key={i} rotation={[0, (i / 12) * Math.PI * 2, 0]} position={[Math.cos((i / 12) * Math.PI * 2) * r, 0, -Math.sin((i / 12) * Math.PI * 2) * r]}>
          <boxGeometry args={[0.012 + r * 0.04, w * 1.01, 0.012 + r * 0.04]} />
          <meshStandardMaterial color="#77756f" metalness={0.7} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

const SOLAR = { color: "#141c3c", metalness: 0.35, roughness: 0.25 };

export function RoverView({ model }: { model: RoverModel }) {
  const spec = SPECS[model];
  const terrain = useTerrain();
  const root = useRef<THREE.Group>(null);
  const wheels = useRef<(THREE.Group | null)[]>([]);
  const lid = useRef<THREE.Group>(null);
  const mast = useRef<THREE.Group>(null);
  const fins = useRef<THREE.Group>(null);
  const s = useRef(0);
  const spin = useRef(0);
  const fold = useRef(0);
  const controls = useThree((st) => st.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const camera = useThree((st) => st.camera);
  const tmp = useMemo(() => ({ n: new THREE.Vector3(), q: new THREE.Quaternion(), yaw: new THREE.Quaternion(), up: new THREE.Vector3(0, 1, 0) }), []);

  useFrame((_, dt) => {
    const { result, playback, config } = useLab.getState();
    const st = stateAt(result, playback.t);
    const mech = config.build.mechanics;
    const speed = mech.kind === "rover" ? mech.speedMs : 0;
    const moving = playback.playing && st.canWalk && st.world.awake > 0.5 && config.scenario.activity === "walking";
    if (moving) {
      s.current += speed * Math.min(dt, 0.1);
      spin.current += (speed * Math.min(dt, 0.1)) / spec.wheelR;
    }
    // Hibernating: fold up over ~2 s of real time.
    fold.current += ((st.world.awake > 0.5 ? 0 : 1) - fold.current) * Math.min(1, dt * 1.5);

    // Pose on the circle (terrain coords: x east, y north). Local rover frame:
    // u forward, v to three's +z side, which is -left in terrain coords.
    const a = s.current / PATH_R;
    const cx = PATH_R * Math.sin(a);
    const cy = PATH_R - PATH_R * Math.cos(a);
    const heading = a;
    const fx = Math.cos(heading);
    const fy = Math.sin(heading);
    const toTerrain = (u: number, v: number) => [cx + fx * u + fy * v, cy + fy * u - fx * v] as const;
    // Rocker-bogie: fit a plane through the wheel contact points.
    const pts = spec.wheelX.flatMap((u) =>
      [-1, 1].map((side) => {
        const v = side * spec.track;
        const [x, y] = toTerrain(u, v);
        return { u, v, h: terrain.height(x, y) };
      }),
    );
    const mean = pts.reduce((m, p) => m + p.h, 0) / pts.length;
    const su = pts.reduce((m, p) => m + p.u * (p.h - mean), 0) / Math.max(1e-6, pts.reduce((m, p) => m + p.u * p.u, 0));
    const sv = pts.reduce((m, p) => m + p.v * (p.h - mean), 0) / Math.max(1e-6, pts.reduce((m, p) => m + p.v * p.v, 0));
    const g = root.current;
    if (g) {
      g.position.set(cx, mean, -cy);
      // Ground normal in three coords from the slopes along u and v, then yaw about it.
      const dhdx = su * fx + sv * fy;
      const dhdy = su * fy - sv * fx;
      tmp.n.set(-dhdx, 1, dhdy).normalize();
      tmp.q.setFromUnitVectors(tmp.up, tmp.n);
      tmp.yaw.setFromAxisAngle(tmp.up, heading);
      g.quaternion.copy(tmp.q).multiply(tmp.yaw);
    }
    pts.forEach((p, i) => {
      const w = wheels.current[i];
      if (!w) return;
      const plane = mean + su * p.u + sv * p.v;
      w.position.y = spec.wheelR + (p.h - plane);
      w.rotation.z = -spin.current;
    });
    if (lid.current) lid.current.rotation.x = THREE.MathUtils.lerp(-0.5, -Math.PI + 0.05, fold.current);
    if (mast.current) mast.current.scale.y = 1 - 0.6 * fold.current;
    if (fins.current) {
      // Vertical arrays turn to face the Sun (azimuth relative to the heading).
      const sunYaw = (-st.world.sunAzDeg * Math.PI) / 180 + Math.PI / 2 - heading;
      fins.current.rotation.y = sunYaw;
    }
    if (controls && g) {
      const target = new THREE.Vector3(g.position.x, g.position.y + spec.clearance + spec.body[1], g.position.z);
      const shift = target.clone().sub(controls.target);
      controls.target.add(shift);
      camera.position.add(shift);
      controls.update();
    }
  });

  const [L, H, W] = spec.body;
  const deckY = spec.clearance + H;
  const bodyMat = spec.mli ? { color: spec.bodyColor, metalness: 0.85, roughness: 0.32 } : { color: spec.bodyColor, metalness: 0.1, roughness: 0.7 };

  return (
    <group ref={root}>
      {/* Wheels, pairwise left/right at each station, ordered like the contact points. */}
      {spec.wheelX.flatMap((wx, k) =>
        [-1, 1].map((side, j) => (
          <group key={`${k}-${j}`} ref={(el) => void (wheels.current[k * 2 + j] = el)} position={[wx, spec.wheelR, side * spec.track]}>
            <Wheel r={spec.wheelR} w={spec.wheelW} />
          </group>
        )),
      )}
      {/* Rocker-bogie / suspension beams. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[0, spec.wheelR + (spec.clearance - spec.wheelR) * 0.6, side * spec.track]}>
          <boxGeometry args={[Math.abs(spec.wheelX[0] - spec.wheelX[spec.wheelX.length - 1]) + 0.05, 0.035, 0.035]} />
          <meshStandardMaterial color="#b8b5ad" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
      {/* Body / warm box. */}
      <mesh position={[0, spec.clearance + H / 2, 0]}>
        <boxGeometry args={[L, H, W]} />
        <meshStandardMaterial {...bodyMat} />
      </mesh>

      {spec.wings === "mer" && (
        // Deck-top array plus the fixed wings (MER's "dragonfly" deck).
        <group position={[0, deckY + 0.02, 0]}>
          <mesh>
            <boxGeometry args={[1.5, 0.02, 1.1]} />
            <meshStandardMaterial {...SOLAR} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh key={side} position={[-0.15, 0, side * 0.9]}>
              <boxGeometry args={[1.0, 0.02, 0.7]} />
              <meshStandardMaterial {...SOLAR} />
            </mesh>
          ))}
        </group>
      )}
      {spec.wings === "yutu" && (
        <>
          {/* Fixed wing on one side; the other is hinged and folds over the deck at night. */}
          <mesh position={[0, deckY - 0.05, -W / 2 - 0.42]} rotation={[0.45, 0, 0]}>
            <boxGeometry args={[0.95, 0.02, 0.8]} />
            <meshStandardMaterial {...SOLAR} />
          </mesh>
          <group ref={lid} position={[0, deckY, W / 2]}>
            <mesh position={[0, 0, 0.4]}>
              <boxGeometry args={[0.95, 0.02, 0.8]} />
              <meshStandardMaterial {...SOLAR} />
            </mesh>
          </group>
        </>
      )}
      {spec.wings === "side" && (
        // Pragyan: one panel on its side, near-vertical for the low polar Sun.
        <mesh position={[0, deckY + 0.08, W / 2 + 0.02]} rotation={[-0.25, 0, 0]}>
          <boxGeometry args={[0.55, 0.33, 0.015]} />
          <meshStandardMaterial {...SOLAR} />
        </mesh>
      )}
      {spec.wings === "fins" && (
        <group ref={fins} position={[0, deckY, 0]}>
          {[-0.35, 0.35].map((z) => (
            <mesh key={z} position={[0, 0.45, z]}>
              <boxGeometry args={[1.2, 0.8, 0.02]} />
              <meshStandardMaterial {...SOLAR} />
            </mesh>
          ))}
        </group>
      )}
      {spec.rtg && (
        // MMRTG: finned cylinder angled off the back.
        <group position={[-L / 2 - 0.25, spec.clearance + H * 0.55, 0]} rotation={[0, 0, -0.9]}>
          <mesh>
            <cylinderGeometry args={[0.2, 0.2, 0.66, 16]} />
            <meshStandardMaterial color="#2b2b2d" metalness={0.5} roughness={0.5} />
          </mesh>
          {Array.from({ length: 8 }, (_, i) => (
            <mesh key={i} rotation={[0, (i / 8) * Math.PI * 2, 0]} position={[Math.cos((i / 8) * Math.PI * 2) * 0.3, 0, -Math.sin((i / 8) * Math.PI * 2) * 0.3]}>
              <boxGeometry args={[0.2, 0.62, 0.012]} />
              <meshStandardMaterial color="#3a3a3c" metalness={0.5} roughness={0.5} />
            </mesh>
          ))}
        </group>
      )}
      {spec.mastH > 0.1 && (
        <group ref={mast} position={[L * 0.3, deckY, W * 0.2]}>
          <mesh position={[0, spec.mastH / 2, 0]}>
            <cylinderGeometry args={[0.03, 0.035, spec.mastH, 10]} />
            <meshStandardMaterial color="#d6d3cb" metalness={0.3} roughness={0.6} />
          </mesh>
          <mesh position={[0.02, spec.mastH + 0.06, 0]}>
            <boxGeometry args={[0.14, 0.12, 0.34]} />
            <meshStandardMaterial color="#e2dfd7" metalness={0.2} roughness={0.6} />
          </mesh>
          {[-0.1, 0.1].map((z) => (
            <mesh key={z} position={[0.095, spec.mastH + 0.06, z]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.025, 0.025, 0.02, 12]} />
              <meshStandardMaterial color="#111" metalness={0.8} roughness={0.2} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}
