"use client";

/**
 * Planetary rovers, drawn from their published dimensions (no official
 * meshes are used). Kinematic, not MuJoCo: at 1-20 cm/s the dynamics are
 * quasi-static, so each wheel rests on the same terrain height function the
 * rest of the lab uses.
 *
 * Suspension is solved per frame:
 * - Rocker-bogie (MER, MSL, Yutu-2, Pragyan, the Mercury crawler): the bogie
 *   pivots to keep its two wheels down, the rocker joins the front wheel to
 *   the bogie pivot, and a differential averages the two rockers, so the body
 *   pitches by their mean angle and rolls by their height difference.
 * - Lunokhod: eight independently sprung wheels; the tub sits on the plane
 *   that fits them.
 *
 * The rover drives a slow circle at its real speed (real time, independent
 * of the thermal clock) whenever the sim says it can move, and folds up for
 * the night when it hibernates (Yutu-2 and Lunokhod close a lid over the
 * body; masts stow).
 *
 * Sizes (m): Curiosity 3.0 L x 2.8 W x 2.2 H, 0.5 m wheels, 2.2 m arm, mast
 * top ~2.2 m; Opportunity 1.6 x 2.3 (wings) x 1.5; Yutu-2 1.5 x 1.0 x 1.1;
 * Pragyan 0.92 x 0.75 x 0.40; Lunokhod 1 1.7 x 1.6 x 1.35, 0.51 m wire-mesh
 * wheels.
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
  /** Wheel x positions (front to rear) and half track. */
  wheelX: number[];
  track: number;
  suspension: "rockerBogie" | "independent";
  mastH: number;
  bodyColor: string;
  mli: boolean;
  wheel: "msl" | "mer" | "thin" | "mesh";
}

const SPECS: Record<RoverModel, Spec> = {
  mer: { body: [1.1, 0.3, 0.8], clearance: 0.3, wheelR: 0.13, wheelW: 0.16, wheelX: [0.55, 0, -0.55], track: 0.6, suspension: "rockerBogie", mastH: 0.75, bodyColor: "#d8d4ca", mli: false, wheel: "mer" },
  msl: { body: [1.9, 0.55, 1.3], clearance: 0.6, wheelR: 0.25, wheelW: 0.4, wheelX: [1.05, 0.1, -0.95], track: 1.15, suspension: "rockerBogie", mastH: 0.9, bodyColor: "#e9e6de", mli: false, wheel: "msl" },
  yutu: { body: [1.0, 0.45, 0.8], clearance: 0.3, wheelR: 0.15, wheelW: 0.15, wheelX: [0.5, 0, -0.5], track: 0.55, suspension: "rockerBogie", mastH: 0.3, bodyColor: "#c9a23a", mli: true, wheel: "thin" },
  pragyan: { body: [0.6, 0.2, 0.5], clearance: 0.13, wheelR: 0.09, wheelW: 0.08, wheelX: [0.33, 0, -0.33], track: 0.34, suspension: "rockerBogie", mastH: 0, bodyColor: "#c9a23a", mli: true, wheel: "thin" },
  lunokhod: { body: [1.7, 0.6, 1.2], clearance: 0.35, wheelR: 0.255, wheelW: 0.2, wheelX: [0.72, 0.24, -0.24, -0.72], track: 0.8, suspension: "independent", mastH: 0, bodyColor: "#b9b6ae", mli: false, wheel: "mesh" },
  crawler: { body: [1.4, 0.5, 1.0], clearance: 0.45, wheelR: 0.3, wheelW: 0.25, wheelX: [0.75, 0, -0.75], track: 0.75, suspension: "rockerBogie", mastH: 0.6, bodyColor: "#e4e1d8", mli: false, wheel: "thin" },
};

const PATH_R = 4;
const SOLAR = { color: "#141c3c", metalness: 0.35, roughness: 0.25 };
const ALU = { color: "#a9a7a1", metalness: 0.75, roughness: 0.42 };
const DARK = { color: "#2a2a2c", metalness: 0.4, roughness: 0.55 };
const WHITE = { color: "#e7e4dc", metalness: 0.1, roughness: 0.65 };

/** Rocker-bogie geometry at rest, derived from the wheel layout. */
function rockerGeometry(s: Spec) {
  const [xf, xm, xr] = s.wheelX;
  const R = s.wheelR;
  const bogieH = R * 0.9;
  const pivot: [number, number] = [xm + 0.35 * (xf - xm), s.clearance + s.body[1] * 0.3];
  const F: [number, number] = [xf, R];
  const B: [number, number] = [(xm + xr) / 2, R + bogieH];
  const dx = B[0] - F[0];
  const dz = B[1] - F[1];
  const L = Math.hypot(dx, dz);
  const u: [number, number] = [dx / L, dz / L];
  const v: [number, number] = [-u[1], u[0]];
  const pu = (pivot[0] - F[0]) * u[0] + (pivot[1] - F[1]) * u[1];
  const pv = (pivot[0] - F[0]) * v[0] + (pivot[1] - F[1]) * v[1];
  return { bogieH, pivot, pu: pu / L, pv, restAngle: Math.atan2(F[1] - B[1], F[0] - B[0]) };
}

/** A unit rod (y-axis, length 1) placed between two points each frame. */
function setRod(mesh: THREE.Object3D | null, a: THREE.Vector3, b: THREE.Vector3) {
  if (!mesh) return;
  const d = b.clone().sub(a);
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  mesh.scale.set(1, d.length(), 1);
}

function Wheel({ s }: { s: Spec }) {
  const r = s.wheelR;
  const w = s.wheelW;
  const grousers = s.wheel === "msl" ? 24 : s.wheel === "mer" ? 16 : 14;
  return (
    <group rotation={[Math.PI / 2, 0, 0]}>
      {s.wheel === "mesh" ? (
        <>
          {/* Lunokhod: woven steel-wire tyre between three rims, titanium spokes. */}
          <mesh>
            <cylinderGeometry args={[r, r, w, 28, 3, true]} />
            <meshStandardMaterial color="#8d8a84" metalness={0.8} roughness={0.5} wireframe />
          </mesh>
          {[-w / 2, 0, w / 2].map((y) => (
            <mesh key={y} position={[0, y, 0]}>
              <torusGeometry args={[r, 0.012, 6, 28]} />
              <meshStandardMaterial {...ALU} />
            </mesh>
          ))}
        </>
      ) : (
        <mesh>
          <cylinderGeometry args={[r, r, w, 28, 1]} />
          <meshStandardMaterial {...ALU} />
        </mesh>
      )}
      {/* Hub and spokes (Curiosity's are curved titanium flexures; drawn straight). */}
      <mesh>
        <cylinderGeometry args={[r * 0.22, r * 0.22, w * 1.05, 14]} />
        <meshStandardMaterial {...DARK} />
      </mesh>
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * r * 0.55, w * 0.38, -Math.sin(a) * r * 0.55]} rotation={[0, a, 0]}>
            <boxGeometry args={[r * 0.75, 0.012, 0.018]} />
            <meshStandardMaterial {...(s.wheel === "mesh" ? ALU : DARK)} />
          </mesh>
        );
      })}
      {/* Grousers: cleats that give metal wheels grip in loose regolith (chevrons on Curiosity). */}
      {s.wheel !== "mesh" &&
        Array.from({ length: grousers }, (_, i) => {
          const a = (i / grousers) * Math.PI * 2;
          return (
            <group key={i} rotation={[0, a, 0]}>
              {(s.wheel === "msl" ? [-1, 1] : [0]).map((half) => (
                <mesh key={half} position={[r, (half * w) / 4, 0]} rotation={[half * 0.5, 0, 0]}>
                  <boxGeometry args={[0.012 + r * 0.05, s.wheel === "msl" ? w * 0.55 : w * 1.01, 0.014]} />
                  <meshStandardMaterial color="#77756f" metalness={0.7} roughness={0.5} />
                </mesh>
              ))}
            </group>
          );
        })}
    </group>
  );
}

/** Camera mast: pole, head, stereo lenses. */
function MastHead({ h, head }: { h: number; head: [number, number, number] }) {
  return (
    <>
      <mesh position={[0, h / 2, 0]}>
        <cylinderGeometry args={[0.03, 0.04, h, 10]} />
        <meshStandardMaterial {...WHITE} />
      </mesh>
      <mesh position={[0.02, h + head[1] / 2, 0]}>
        <boxGeometry args={head} />
        <meshStandardMaterial {...WHITE} />
      </mesh>
      {[-head[2] * 0.3, head[2] * 0.3].map((z) => (
        <mesh key={z} position={[head[0] / 2 + 0.02, h + head[1] / 2, z]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.022, 0.022, 0.03, 12]} />
          <meshStandardMaterial color="#111" metalness={0.8} roughness={0.2} />
        </mesh>
      ))}
    </>
  );
}

/** Rover bodies, in the body frame (origin on the rocker pivot axis, x forward, y up, z lateral). */
function Body({ model, s, lid, mast, fins, pivotDrop }: { model: RoverModel; s: Spec; lid: React.Ref<THREE.Group>; mast: React.Ref<THREE.Group>; fins: React.Ref<THREE.Group>; pivotDrop: number }) {
  const [L, H, W] = s.body;
  const base = -pivotDrop;
  const top = base + H;
  const bodyMat = s.mli ? { color: s.bodyColor, metalness: 0.85, roughness: 0.32 } : { color: s.bodyColor, metalness: 0.1, roughness: 0.7 };
  if (model === "lunokhod") {
    // Magnesium tub (wider at the top), radiator ring, hinged convex lid with solar cells inside.
    return (
      <group position={[0, base, 0]}>
        <mesh position={[0, 0.36, 0]} scale={[1.15, 1, 1]}>
          <cylinderGeometry args={[0.82, 0.62, 0.72, 32]} />
          <meshStandardMaterial color="#c3c0b8" metalness={0.55} roughness={0.45} />
        </mesh>
        <mesh position={[0, 0.74, 0]} scale={[1.15, 1, 1]}>
          <cylinderGeometry args={[0.88, 0.84, 0.06, 32]} />
          <meshStandardMaterial color="#e8e6e0" metalness={0.3} roughness={0.3} />
        </mesh>
        <group ref={lid} position={[-0.95, 0.78, 0]}>
          <group position={[0.95, 0, 0]}>
            <mesh scale={[1.15, 0.28, 1]}>
              <sphereGeometry args={[0.9, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color="#d7d4cc" metalness={0.5} roughness={0.4} side={THREE.DoubleSide} />
            </mesh>
            {/* Solar cells on the lid's inner face: down when closed, up when it swings open. */}
            <mesh position={[0, -0.005, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1.15, 1, 1]}>
              <circleGeometry args={[0.86, 32]} />
              <meshStandardMaterial {...SOLAR} side={THREE.DoubleSide} />
            </mesh>
          </group>
        </group>
        {/* TV camera ports on the nose, cone antenna, helical antenna, French laser retroreflector. */}
        {[-0.22, 0.22].map((z) => (
          <mesh key={z} position={[0.92, 0.45, z]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.07, 0.07, 0.12, 16]} />
            <meshStandardMaterial color="#1a1a1a" metalness={0.6} roughness={0.3} />
          </mesh>
        ))}
        <mesh position={[0.98, 0.62, 0]}>
          <boxGeometry args={[0.1, 0.12, 0.3]} />
          <meshStandardMaterial color="#b98a2d" metalness={0.9} roughness={0.2} />
        </mesh>
        <mesh position={[0.35, 1.05, -0.55]}>
          <coneGeometry args={[0.1, 0.35, 12]} />
          <meshStandardMaterial {...ALU} />
        </mesh>
        <mesh position={[0.15, 1.1, 0.6]}>
          <cylinderGeometry args={[0.015, 0.015, 0.6, 6]} />
          <meshStandardMaterial {...ALU} />
        </mesh>
        <mesh position={[0.15, 1.15, 0.6]}>
          <torusGeometry args={[0.05, 0.008, 6, 16]} />
          <meshStandardMaterial {...ALU} />
        </mesh>
        <group position={[-0.25, 0.8, 0.35]}>
          <mesh position={[0, 0.3, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 0.6, 6]} />
            <meshStandardMaterial {...ALU} />
          </mesh>
          <mesh position={[0.05, 0.62, 0]} rotation={[0, 0, -1.1]}>
            <cylinderGeometry args={[0.16, 0.02, 0.1, 16, 1, true]} />
            <meshStandardMaterial {...ALU} side={THREE.DoubleSide} />
          </mesh>
        </group>
        {/* Polonium-210 heat source at the back. */}
        <mesh position={[-0.98, 0.42, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.13, 0.13, 0.24, 16]} />
          <meshStandardMaterial color="#6d6a63" metalness={0.6} roughness={0.4} />
        </mesh>
      </group>
    );
  }

  return (
    <group>
      {/* Warm electronics box. */}
      <mesh position={[0, base + H / 2, 0]}>
        <boxGeometry args={[L, H, W]} />
        <meshStandardMaterial {...bodyMat} />
      </mesh>

      {model === "msl" && (
        <>
          {/* Deck instruments (SAM, CheMin inlets) and hazcams. */}
          <mesh position={[0.2, top + 0.08, -0.25]}>
            <boxGeometry args={[0.5, 0.16, 0.4]} />
            <meshStandardMaterial {...WHITE} />
          </mesh>
          <mesh position={[-0.35, top + 0.05, 0.3]}>
            <boxGeometry args={[0.45, 0.1, 0.35]} />
            <meshStandardMaterial color="#c7c3b8" metalness={0.2} roughness={0.6} />
          </mesh>
          {[-0.12, 0.12].map((z) => (
            <mesh key={z} position={[L / 2 + 0.02, base + 0.12, z]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.025, 0.025, 0.04, 10]} />
              <meshStandardMaterial color="#111" />
            </mesh>
          ))}
          {/* High-gain antenna: flat hexagonal panel on a gimbal, left rear. */}
          <group position={[-0.45, top + 0.18, -0.45]}>
            <mesh position={[0, -0.08, 0]}>
              <cylinderGeometry args={[0.03, 0.03, 0.16, 8]} />
              <meshStandardMaterial {...DARK} />
            </mesh>
            <mesh rotation={[0.3, 0, 0.5]}>
              <cylinderGeometry args={[0.28, 0.28, 0.03, 6]} />
              <meshStandardMaterial color="#d9d5cb" metalness={0.3} roughness={0.5} />
            </mesh>
          </group>
          <mesh position={[-0.7, top + 0.25, 0.45]}>
            <cylinderGeometry args={[0.025, 0.025, 0.5, 8]} />
            <meshStandardMaterial {...WHITE} />
          </mesh>
          {/* Robotic arm, stowed across the front: shoulder, upper arm, forearm, instrument turret. */}
          <group position={[L / 2 - 0.05, base + 0.2, 0.45]}>
            <mesh position={[0.08, 0, 0]}>
              <boxGeometry args={[0.18, 0.18, 0.18]} />
              <meshStandardMaterial {...WHITE} />
            </mesh>
            <mesh position={[0.2, 0.02, -0.45]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.055, 0.055, 0.9, 12]} />
              <meshStandardMaterial {...WHITE} />
            </mesh>
            <mesh position={[0.32, 0.12, -0.6]} rotation={[Math.PI / 2, 0, 0.2]}>
              <cylinderGeometry args={[0.045, 0.045, 0.75, 12]} />
              <meshStandardMaterial {...WHITE} />
            </mesh>
            <group position={[0.36, 0.05, -1.0]}>
              <mesh>
                <cylinderGeometry args={[0.17, 0.17, 0.12, 5]} />
                <meshStandardMaterial {...DARK} />
              </mesh>
              {[0, 1.25, 2.5, 3.75, 5].map((a) => (
                <mesh key={a} position={[Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2]}>
                  <boxGeometry args={[0.1, 0.1, 0.1]} />
                  <meshStandardMaterial color={a === 0 ? "#b3201e" : "#cfcabe"} metalness={0.3} roughness={0.5} />
                </mesh>
              ))}
            </group>
          </group>
          {/* MMRTG: finned cylinder angled off the back. */}
          <group position={[-L / 2 - 0.25, base + H * 0.55, 0]} rotation={[0, 0, -0.9]}>
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
          {/* Remote-sensing mast: Mastcam pair plus ChemCam's big telescope. */}
          <group ref={mast} position={[L * 0.32, top, -0.35]}>
            <MastHead h={s.mastH} head={[0.25, 0.22, 0.42]} />
            <mesh position={[0.16, s.mastH + 0.2, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.07, 0.07, 0.08, 16]} />
              <meshStandardMaterial color="#1a1a1a" metalness={0.8} roughness={0.2} />
            </mesh>
          </group>
        </>
      )}

      {model === "mer" && (
        <>
          {/* Deck array plus the fixed wings (MER's "dragonfly" deck). */}
          <group position={[0, top + 0.02, 0]}>
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
            <mesh position={[-0.55, 0.1, -0.3]}>
              <cylinderGeometry args={[0.14, 0.14, 0.03, 20]} />
              <meshStandardMaterial {...WHITE} />
            </mesh>
            <mesh position={[-0.45, 0.35, 0.35]}>
              <cylinderGeometry args={[0.012, 0.012, 0.7, 6]} />
              <meshStandardMaterial {...WHITE} />
            </mesh>
          </group>
          {/* Instrument arm folded under the front. */}
          <mesh position={[L / 2 + 0.06, base + 0.06, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 0.6, 10]} />
            <meshStandardMaterial {...WHITE} />
          </mesh>
          <mesh position={[L / 2 + 0.08, base + 0.06, 0.3]}>
            <boxGeometry args={[0.12, 0.1, 0.12]} />
            <meshStandardMaterial {...DARK} />
          </mesh>
          <group ref={mast} position={[L * 0.35, top + 0.03, 0.15]}>
            <MastHead h={s.mastH} head={[0.12, 0.1, 0.36]} />
          </group>
        </>
      )}

      {model === "yutu" && (
        <>
          {/* Fixed wing on one side; the other is hinged and folds over the deck at night. */}
          <mesh position={[0, top - 0.05, -W / 2 - 0.42]} rotation={[0.45, 0, 0]}>
            <boxGeometry args={[0.95, 0.02, 0.8]} />
            <meshStandardMaterial {...SOLAR} />
          </mesh>
          <group ref={lid} position={[0, top, W / 2]}>
            <mesh position={[0, 0, 0.4]}>
              <boxGeometry args={[0.95, 0.02, 0.8]} />
              <meshStandardMaterial {...SOLAR} />
            </mesh>
          </group>
          <group ref={mast} position={[L * 0.3, top, W * 0.2]}>
            <MastHead h={s.mastH} head={[0.14, 0.12, 0.34]} />
            <mesh position={[-0.12, s.mastH + 0.2, 0]} rotation={[0, 0, 0.6]}>
              <cylinderGeometry args={[0.13, 0.02, 0.06, 18]} />
              <meshStandardMaterial {...WHITE} />
            </mesh>
          </group>
        </>
      )}

      {model === "pragyan" && (
        <>
          {/* One panel on its side, near-vertical for the low polar Sun; two navcams up front. */}
          <mesh position={[0, top + 0.08, W / 2 + 0.02]} rotation={[-0.25, 0, 0]}>
            <boxGeometry args={[0.55, 0.33, 0.015]} />
            <meshStandardMaterial {...SOLAR} />
          </mesh>
          {[-0.06, 0.06].map((z) => (
            <mesh key={z} position={[L / 2 - 0.05, top + 0.05, z]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.018, 0.018, 0.04, 10]} />
              <meshStandardMaterial color="#111" />
            </mesh>
          ))}
          <mesh position={[-L / 2 + 0.1, top + 0.12, -0.15]}>
            <cylinderGeometry args={[0.008, 0.008, 0.24, 6]} />
            <meshStandardMaterial {...ALU} />
          </mesh>
        </>
      )}

      {model === "crawler" && (
        <>
          <group ref={fins} position={[0, top, 0]}>
            {[-0.35, 0.35].map((z) => (
              <mesh key={z} position={[0, 0.45, z]}>
                <boxGeometry args={[1.2, 0.8, 0.02]} />
                <meshStandardMaterial {...SOLAR} />
              </mesh>
            ))}
          </group>
          <group ref={mast} position={[L * 0.38, top, 0]}>
            <MastHead h={s.mastH} head={[0.14, 0.12, 0.3]} />
          </group>
        </>
      )}
    </group>
  );
}

export function RoverView({ model }: { model: RoverModel }) {
  const spec = SPECS[model];
  const terrain = useTerrain();
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const wheels = useRef<(THREE.Group | null)[]>([]);
  const rods = useRef<(THREE.Mesh | null)[]>([]);
  const lid = useRef<THREE.Group>(null);
  const mast = useRef<THREE.Group>(null);
  const fins = useRef<THREE.Group>(null);
  const s = useRef(0);
  const spin = useRef(0);
  const fold = useRef(0);
  const controls = useThree((st) => st.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const camera = useThree((st) => st.camera);
  const rb = useMemo(() => rockerGeometry(spec), [spec]);
  // Body frame origin sits on the rocker pivots; the box bottom is `clearance` above the ground.
  const pivotDrop = spec.suspension === "rockerBogie" ? rb.pivot[1] - spec.clearance : 0;

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
    const fx = Math.cos(a);
    const fy = Math.sin(a);
    const groundAt = (u: number, v: number) => terrain.height(cx + fx * u + fy * v, cy + fy * u - fx * v);
    const R = spec.wheelR;
    const g = root.current;
    if (g) {
      g.position.set(cx, 0, -cy);
      g.rotation.set(0, a, 0);
    }
    const sides = [-1, 1] as const;
    // Wheel centres (u, height) per side, front to rear.
    const centres = sides.map((side) => spec.wheelX.map((u) => [u, groundAt(u, side * spec.track) + R] as [number, number]));
    centres.forEach((side, k) =>
      side.forEach(([u, h], i) => {
        const w = wheels.current[k * spec.wheelX.length + i];
        if (!w) return;
        w.position.set(u, h, sides[k] * spec.track);
        w.rotation.z = -spin.current;
      }),
    );

    const b = body.current;
    if (spec.suspension === "rockerBogie") {
      // Bogie keeps both rear wheels down; rocker joins the front wheel to the bogie pivot.
      const solved = centres.map(([F, M, Rr]) => {
        const th = Math.atan2(M[1] - Rr[1], M[0] - Rr[0]);
        const B: [number, number] = [(M[0] + Rr[0]) / 2 - Math.sin(th) * rb.bogieH, (M[1] + Rr[1]) / 2 + Math.cos(th) * rb.bogieH];
        const dx = B[0] - F[0];
        const dz = B[1] - F[1];
        const L = Math.hypot(dx, dz);
        const P: [number, number] = [F[0] + rb.pu * dx + (-dz / L) * rb.pv, F[1] + rb.pu * dz + (dx / L) * rb.pv];
        return { F, M, Rr, B, P, angle: Math.atan2(F[1] - B[1], F[0] - B[0]) };
      });
      // Differential: the body takes the mean rocker angle and rolls with their height difference.
      const pitch = (solved[0].angle + solved[1].angle) / 2 - rb.restAngle;
      const hMid = (solved[0].P[1] + solved[1].P[1]) / 2;
      const roll = -Math.atan2(solved[1].P[1] - solved[0].P[1], 2 * spec.track);
      if (b) {
        b.position.set(rb.pivot[0], hMid, 0);
        b.rotation.set(roll, 0, pitch, "ZXY");
      }
      solved.forEach((sv, k) => {
        const z = sides[k] * (spec.track - spec.wheelW * 0.65);
        const V = (p: [number, number]) => new THREE.Vector3(p[0], p[1], z);
        const base = k * 4;
        setRod(rods.current[base], V(sv.F), V(sv.P));
        setRod(rods.current[base + 1], V(sv.P), V(sv.B));
        setRod(rods.current[base + 2], V(sv.B), V(sv.M));
        setRod(rods.current[base + 3], V(sv.B), V(sv.Rr));
      });
    } else if (b) {
      // Independent suspension: the body sits on the plane fitted through the wheel centres.
      const pts = centres.flatMap((side, k) => side.map(([u, h]) => ({ u, v: sides[k] * spec.track, h })));
      const mean = pts.reduce((m, p) => m + p.h, 0) / pts.length;
      const su = pts.reduce((m, p) => m + p.u * (p.h - mean), 0) / pts.reduce((m, p) => m + p.u * p.u, 0);
      const sv = pts.reduce((m, p) => m + p.v * (p.h - mean), 0) / pts.reduce((m, p) => m + p.v * p.v, 0);
      b.position.set(0, mean - R + spec.clearance, 0);
      b.rotation.set(-Math.atan(sv), 0, Math.atan(su), "ZXY");
      pts.forEach((p, i) => {
        const strutTop = new THREE.Vector3(p.u, mean - R + spec.clearance + 0.25 + su * p.u + sv * p.v, p.v * 0.72);
        setRod(rods.current[i], new THREE.Vector3(p.u, p.h, p.v * 0.86), strutTop);
      });
    }

    // Night: Yutu-2 folds a wing over the deck, Lunokhod closes its lid; masts stow.
    if (lid.current) {
      if (model === "lunokhod") lid.current.rotation.z = THREE.MathUtils.lerp(2.5, 0, fold.current);
      else lid.current.rotation.x = THREE.MathUtils.lerp(-0.5, -Math.PI + 0.05, fold.current);
    }
    if (mast.current) mast.current.scale.y = 1 - 0.6 * fold.current;
    if (fins.current) fins.current.rotation.y = (-st.world.sunAzDeg * Math.PI) / 180 + Math.PI / 2 - a;
    if (controls && g) {
      const target = new THREE.Vector3(g.position.x, (b?.position.y ?? 0) + spec.body[1], g.position.z);
      const shift = target.clone().sub(controls.target);
      controls.target.add(shift);
      camera.position.add(shift);
      controls.update();
    }
  });

  const nWheels = spec.wheelX.length * 2;
  const nRods = spec.suspension === "rockerBogie" ? 8 : nWheels;
  return (
    <group ref={root}>
      {Array.from({ length: nWheels }, (_, i) => (
        <group key={i} ref={(el) => void (wheels.current[i] = el)}>
          <Wheel s={spec} />
        </group>
      ))}
      {Array.from({ length: nRods }, (_, i) => (
        <mesh key={i} ref={(el) => void (rods.current[i] = el)}>
          <cylinderGeometry args={[spec.wheelR * 0.14, spec.wheelR * 0.14, 1, 8]} />
          <meshStandardMaterial {...(model === "msl" ? { color: "#d4d1c8", metalness: 0.5, roughness: 0.45 } : ALU)} />
        </mesh>
      ))}
      <group ref={body}>
        <group position={[spec.suspension === "rockerBogie" ? -rb.pivot[0] : 0, 0, 0]}>
          <Body model={model} s={spec} lid={lid} mast={mast} fins={fins} pivotDrop={pivotDrop} />
        </group>
      </group>
    </group>
  );
}
