"use client";

/**
 * Rocket landers in 3D: Starship, the Falcon 9 and New Glenn boosters, the
 * Apollo LM, drawn from real models where baked (NASA's LM; docs/models.md)
 * and from published dimensions otherwise (metres). The pose comes from the powered-descent
 * sim (spacecraft/landing.ts): height, pitch (belly-flop, flip, gravity turn),
 * engines lit and throttle, crushed tanks.
 *
 * - Plumes: one cone per lit engine. In vacuum the exhaust balloons out wide
 *   and faint; in thick air it stays a short, tight, bright column (Venus's
 *   92 bar squeezes it to a stub).
 * - Ground: the real altitude is shown up to 3 km (the craft drops onto the
 *   terrain you see); above that it hangs in the frame with air streaking past.
 * - Touchdown: dust blown out radially (far and fast in vacuum, lazily in
 *   thick air). A crash shows a fireball (the propellants carry their own
 *   oxidiser) and the toppled wreck; crushed tanks squash the hull.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useLab } from "@/lib/lab-store";
import { flightAt } from "@/sim/spacecraft/landing";
import type { SpacecraftModel } from "@/sim/vehicles/types";
import { incandescence } from "./damage";
import { modelIdFor, modelMeta, useRealModel } from "./real-models";
import { useTerrain } from "./useScene";

// ---- Geometry specs ------------------------------------------------------------

interface Bell {
  x: number;
  z: number;
  /** Exit radius [m]. */
  r: number;
  len: number;
  /** Used for landing (lit in order). */
  landing: boolean;
}

interface Leg {
  az: number;
  hingeR: number;
  hingeY: number;
  footR: number;
  /** Already out (LM) or folded up the body until the last few hundred metres. */
  fixed?: boolean;
}

interface Spec {
  height: number;
  radius: number;
  /** Bottom of the body (top of the engine bells) above the feet [m]. */
  baseY: number;
  bells: Bell[];
  legs: Leg[];
  legRadius: number;
  plume: { core: string; outer: string; opacity: number };
}

const ring = (n: number, r: number, offset = 0) => Array.from({ length: n }, (_, i) => offset + (i / n) * Math.PI * 2).map((a) => [Math.cos(a) * r, Math.sin(a) * r] as const);

const METHALOX = { core: "#e3e6ff", outer: "#8b7dff", opacity: 0.55 };
const KEROLOX = { core: "#fff4cf", outer: "#ff9638", opacity: 0.7 };
// Aerozine/N2O4 burns nearly transparent (Apollo footage shows almost nothing).
const HYPERGOLIC = { core: "#ffe7c4", outer: "#ffb27a", opacity: 0.09 };

const SPECS: Record<SpacecraftModel, Spec> = {
  starship: {
    height: 52.1,
    radius: 4.5,
    baseY: 3.5,
    bells: [
      ...ring(3, 1.05, Math.PI / 2).map(([x, z]) => ({ x, z, r: 0.65, len: 2.0, landing: true })),
      ...ring(3, 3.1, -Math.PI / 2).map(([x, z]) => ({ x, z, r: 1.15, len: 3.0, landing: false })),
    ],
    legs: ring(6, 1, Math.PI / 6).map(([x, z]) => ({ az: Math.atan2(z, x), hingeR: 4.4, hingeY: 9, footR: 7.5 })),
    legRadius: 0.35,
    plume: METHALOX,
  },
  falcon9: {
    // First stage + interstage (the real model: 48.7 m).
    height: 48.7,
    radius: 1.83,
    baseY: 2.2,
    bells: [{ x: 0, z: 0, r: 0.46, len: 1.6, landing: true }, ...ring(8, 1.25).map(([x, z]) => ({ x, z, r: 0.46, len: 1.6, landing: false }))],
    // Feet ~11 m out: the model's 9.3 m legs hinged 1.95 m from the axis, 1.9 m up, swung down to the ground.
    legs: ring(4, 1, Math.PI / 4).map(([x, z]) => ({ az: Math.atan2(z, x), hingeR: 1.95, hingeY: 1.9, footR: 11 })),
    legRadius: 0.22,
    plume: KEROLOX,
  },
  newglenn: {
    height: 57.5,
    radius: 3.5,
    baseY: 3.0,
    bells: [
      { x: 0, z: 0, r: 0.85, len: 2.4, landing: true },
      ...ring(6, 2.25).map(([x, z], i) => ({ x, z, r: 0.85, len: 2.4, landing: i % 3 === 0 })),
    ],
    // The model's six legs are drawn stowed, ~4 m from the axis.
    legs: ring(6, 1, Math.PI / 6).map(([x, z]) => ({ az: Math.atan2(z, x), hingeR: 3.5, hingeY: 5, footR: 4.0 })),
    legRadius: 0.3,
    plume: METHALOX,
  },
  lm: {
    height: 6.98,
    radius: 2.1,
    // LMDE exit 1.37 m across, 0.42 m above the pads (NASA model, docs/models.md).
    baseY: 1.82,
    bells: [{ x: 0, z: 0, r: 0.69, len: 1.4, landing: true }],
    // Footpads on the ±x/±z axes of the NASA model, ~4.0 m from the centre.
    legs: ring(4, 1).map(([x, z]) => ({ az: Math.atan2(z, x), hingeR: 2.2, hingeY: 2.0, footR: 4.0, fixed: true })),
    legRadius: 0.09,
    plume: HYPERGOLIC,
  },
};

export const spacecraftHeight = (m: SpacecraftModel) => SPECS[m].height;

// ---- Shared pieces -----------------------------------------------------------------

/** Engine bells hanging below the body (exit planes at baseY - len). */
function Bells({ bells, baseY }: { bells: Bell[]; baseY: number }) {
  return (
    <>
      {bells.map((b, i) => (
        <mesh key={i} position={[b.x, baseY - b.len / 2, b.z]} castShadow>
          <cylinderGeometry args={[b.r * 0.42, b.r, b.len, 24, 1, true]} />
          <meshStandardMaterial color="#3b3633" metalness={0.75} roughness={0.45} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </>
  );
}

/** Ogive nose from radius r down to a rounded tip over `len`. */
function noseGeometry(r: number, len: number, phiLength = Math.PI * 2) {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const f = i / 24;
    pts.push(new THREE.Vector2(r * Math.sqrt(Math.max(0, 1 - f * f)) * (1 - 0.08 * f), f * len));
  }
  return new THREE.LatheGeometry(pts, 48, 0, phiLength);
}

type GlowRef = React.RefObject<THREE.MeshStandardMaterial | null>;

function StarshipModel({ glow, c }: { glow: GlowRef; c: number }) {
  const R = 4.5;
  const nose = useMemo(() => noseGeometry(R, 14), []);
  // Tiles on local +x: the side that faces down when the ship lies belly-first (pitch 90°).
  const tiles = useMemo(() => noseGeometry(R + 0.03, 14, Math.PI), []);
  const body = 38 - c;
  return (
    <group>
      <mesh position-y={c + body / 2} castShadow receiveShadow>
        <cylinderGeometry args={[R, R, body, 64]} />
        <meshStandardMaterial ref={glow} color="#c9ccd1" metalness={0.55} roughness={0.38} />
      </mesh>
      {/* Black hexagonal tiles over the windward half. */}
      <mesh position-y={c + body / 2 + 0.5} castShadow>
        <cylinderGeometry args={[R + 0.03, R + 0.03, body - 1, 64, 1, true, 0, Math.PI]} />
        <meshStandardMaterial color="#15151a" roughness={0.85} metalness={0.05} />
      </mesh>
      <mesh geometry={nose} position-y={38} castShadow>
        <meshStandardMaterial color="#c9ccd1" metalness={0.55} roughness={0.38} />
      </mesh>
      <mesh geometry={tiles} position-y={38} castShadow>
        <meshStandardMaterial color="#15151a" roughness={0.85} side={THREE.DoubleSide} />
      </mesh>
      {/* Aft flaps (big) and forward flaps (small), on the leeward/windward line. */}
      {[1, -1].map((s) => (
        <group key={s}>
          <mesh position={[0, c + 7, s * (R + 1.4)]} castShadow>
            <boxGeometry args={[0.35, 9, 2.8]} />
            <meshStandardMaterial color="#1b1b20" roughness={0.8} />
          </mesh>
          <mesh position={[0, 44, s * (R - 0.3)]} rotation-x={s * 0.12} castShadow>
            <boxGeometry args={[0.3, 6.5, 2.2]} />
            <meshStandardMaterial color="#1b1b20" roughness={0.8} />
          </mesh>
        </group>
      ))}
      {/* Aft skirt ring. */}
      <mesh position-y={c + 0.3}>
        <cylinderGeometry args={[R + 0.05, R + 0.05, 0.6, 64, 1, true]} />
        <meshStandardMaterial color="#8e9196" metalness={0.8} roughness={0.4} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function Falcon9Model({ glow, c }: { glow: GlowRef; c: number }) {
  const R = 1.83;
  const H = 41.2;
  return (
    <group>
      <mesh position-y={c + (H - 6.5 - c) / 2} castShadow receiveShadow>
        <cylinderGeometry args={[R, R, H - 6.5 - c, 48]} />
        <meshStandardMaterial ref={glow} color="#eceef0" metalness={0.15} roughness={0.55} />
      </mesh>
      {/* Soot-stained lower third, black carbon-composite interstage. */}
      <mesh position-y={c + 6}>
        <cylinderGeometry args={[R + 0.01, R + 0.01, 12, 48, 1, true]} />
        <meshStandardMaterial color="#5d5753" roughness={0.9} transparent opacity={0.55} side={THREE.DoubleSide} />
      </mesh>
      <mesh position-y={H - 3.25} castShadow>
        <cylinderGeometry args={[R, R, 6.5, 48]} />
        <meshStandardMaterial color="#17181b" roughness={0.6} />
      </mesh>
      {/* Octaweb heat shield. */}
      <mesh position-y={c + 0.15}>
        <cylinderGeometry args={[R, R, 0.3, 48]} />
        <meshStandardMaterial color="#2a2a2e" roughness={0.7} />
      </mesh>
      {/* Titanium grid fins near the top. */}
      {ring(4, R + 0.75).map(([x, z], i) => (
        <mesh key={i} position={[x, H - 4.2, z]} rotation-y={-Math.atan2(z, x)} castShadow>
          <boxGeometry args={[1.5, 1.2, 0.18]} />
          <meshStandardMaterial color="#6e6a66" metalness={0.8} roughness={0.5} wireframe={false} />
        </mesh>
      ))}
    </group>
  );
}

function NewGlennModel({ glow, c }: { glow: GlowRef; c: number }) {
  const R = 3.5;
  const H = 57.5;
  return (
    <group>
      <mesh position-y={c + 4 + (H - 4 - c - 7) / 2} castShadow receiveShadow>
        <cylinderGeometry args={[R, R, H - 4 - c - 7, 64]} />
        <meshStandardMaterial ref={glow} color="#e6e8ec" metalness={0.2} roughness={0.5} />
      </mesh>
      {/* Copper-coloured aft module. */}
      <mesh position-y={c + 2}>
        <cylinderGeometry args={[R, R + 0.05, 4, 64]} />
        <meshStandardMaterial color="#9a5b34" metalness={0.7} roughness={0.45} />
      </mesh>
      {/* Forward module and its four fins. */}
      <mesh position-y={H - 3.5} castShadow>
        <cylinderGeometry args={[R, R, 7, 64]} />
        <meshStandardMaterial color="#1f2a44" metalness={0.3} roughness={0.5} />
      </mesh>
      {ring(4, R + 1.1).map(([x, z], i) => (
        <mesh key={i} position={[x, H - 4, z]} rotation-y={-Math.atan2(z, x)} castShadow>
          <boxGeometry args={[2.2, 4.5, 0.25]} />
          <meshStandardMaterial color="#2a344f" roughness={0.6} />
        </mesh>
      ))}
      {/* Aft strakes. */}
      {[1, -1].map((s) => (
        <mesh key={s} position={[0, c + 12, s * (R + 0.4)]} castShadow>
          <boxGeometry args={[0.3, 16, 0.8]} />
          <meshStandardMaterial color="#d5d8dd" roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function LunarModuleModel({ glow, c }: { glow: GlowRef; c: number }) {
  const descentH = 1.65;
  const y0 = c;
  return (
    <group>
      {/* Octagonal descent stage in gold Kapton foil. */}
      <mesh position-y={y0 + descentH / 2} rotation-y={Math.PI / 8} castShadow receiveShadow>
        <cylinderGeometry args={[2.1, 2.1, descentH, 8]} />
        <meshStandardMaterial ref={glow} color="#d4a843" metalness={0.6} roughness={0.4} />
      </mesh>
      {ring(4, 1.55, Math.PI / 4).map(([x, z], i) => (
        <mesh key={i} position={[x, y0 + descentH / 2, z]} rotation-y={-Math.atan2(z, x)}>
          <boxGeometry args={[0.02, descentH * 0.9, 1.6]} />
          <meshStandardMaterial color="#1a1814" roughness={0.9} />
        </mesh>
      ))}
      {/* Ascent stage: crew cabin, aft equipment bay, tunnel, antennas. */}
      <group position-y={y0 + descentH}>
        <mesh position={[0.35, 1.25, 0]} castShadow>
          <cylinderGeometry args={[1.2, 1.2, 2.3, 10]} />
          <meshStandardMaterial color="#a6a6a2" metalness={0.5} roughness={0.55} />
        </mesh>
        <mesh position={[-1.1, 1.3, 0]} castShadow>
          <boxGeometry args={[1.3, 1.9, 2.6]} />
          <meshStandardMaterial color="#3c3b39" roughness={0.7} />
        </mesh>
        <mesh position={[1.25, 1.55, 0]} rotation-y={Math.PI / 2}>
          <boxGeometry args={[1.4, 0.75, 0.6]} />
          <meshStandardMaterial color="#25262b" roughness={0.3} metalness={0.3} />
        </mesh>
        {/* Triangular windows. */}
        {[0.45, -0.45].map((z) => (
          <mesh key={z} position={[1.56, 1.85, z]} rotation-y={Math.PI / 2}>
            <circleGeometry args={[0.28, 3]} />
            <meshStandardMaterial color="#0d0f14" roughness={0.1} metalness={0.6} />
          </mesh>
        ))}
        <mesh position={[0.35, 2.65, 0]}>
          <cylinderGeometry args={[0.45, 0.5, 0.5, 16]} />
          <meshStandardMaterial color="#8d8c88" metalness={0.5} roughness={0.5} />
        </mesh>
        <mesh position={[-0.6, 3.1, 0.9]} rotation-x={-0.6}>
          <sphereGeometry args={[0.45, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2.8]} />
          <meshStandardMaterial color="#d8d6cf" side={THREE.DoubleSide} roughness={0.6} />
        </mesh>
      </group>
    </group>
  );
}

// ---- Exhaust plumes ---------------------------------------------------------------------

function PlumeCone({ color, opacity, inner }: { color: string; opacity: number; inner?: boolean }) {
  // Unit cone hanging down from y = 0 (scaled per frame): narrow at the nozzle, wider at the far end.
  const geo = useMemo(() => {
    const g = new THREE.CylinderGeometry(inner ? 0.7 : 1, inner ? 0.25 : 1, 1, 24, 1, true);
    g.translate(0, -0.5, 0);
    return g;
  }, [inner]);
  return (
    <mesh geometry={geo} renderOrder={5}>
      <meshBasicMaterial color={color} transparent opacity={opacity} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}

// ---- Dust and debris --------------------------------------------------------------------

const MAX_DUST = 900;

/** Soft round sprite for dust (points are squares otherwise). */
function makeSoftDot() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function makeDustGeometry() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_DUST * 3).fill(-1e5), 3));
  return geo;
}

interface DustState {
  vel: Float32Array;
  life: Float32Array;
  next: number;
}

let seed = 4242;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/** Which of a real model's engines light for landing (the sim's `landingEngines`, in the vehicle's real pattern). */
const LANDING_ENGINES: Record<string, string[]> = {
  starship: ["engine_0", "engine_1", "engine_2"],
  // Centre BE-4 plus two opposite ring engines.
  newglenn: ["engine_0", "engine_1", "engine_3"],
};

/** Nozzle exits from a real model's engine pivots (bottom centre, radius from the bell's size); null if not rigged. */
function realExits(id: string | null, model: SpacecraftModel) {
  const m = modelMeta(id);
  if (!m) return null;
  const names = Object.keys(m.pivots).filter((k) => k.startsWith("engine_"));
  if (!names.length) {
    // Falcon 9's octaweb is one mesh: the centre Merlin 1D's exit sits at the base (0.92 m across).
    return model === "falcon9" ? [{ x: 0, y: 0.05, z: 0, r: 0.46, landing: true }] : null;
  }
  const landing = new Set(LANDING_ENGINES[id!] ?? names);
  return names.map((k) => ({ x: m.pivots[k][0], y: m.pivots[k][1], z: m.pivots[k][2], r: (m.parts?.[k]?.[0] ?? 1) / 2, landing: landing.has(k) }));
}

/** The real model (docs/models.md): base at y = 0, belly (windward) toward +x. Hands its materials up for heat glow. */
function RealBody({
  id,
  materialsRef,
  legsRef,
  flapsRef,
}: {
  id: string;
  materialsRef: React.RefObject<THREE.MeshStandardMaterial[]>;
  legsRef: React.RefObject<THREE.Object3D[]>;
  flapsRef: React.RefObject<Record<string, THREE.Object3D>>;
}) {
  const m = useRealModel(id);
  useEffect(() => {
    // Heat glow goes on the tiles where the model has them (Starship), else on everything.
    const tiles = m.materials.filter((x) => /tile|heat ?shield/i.test(x.name));
    materialsRef.current = tiles.length ? tiles : m.materials;
    legsRef.current = Object.keys(m.nodes)
      .filter((k) => /^leg_\d$/.test(k))
      .map((k) => m.nodes[k]);
    flapsRef.current = Object.fromEntries(Object.entries(m.nodes).filter(([k]) => k.startsWith("flap_")));
    return () => {
      materialsRef.current = [];
      legsRef.current = [];
      flapsRef.current = {};
    };
  }, [m, materialsRef, legsRef, flapsRef]);
  return <primitive object={m.scene} />;
}

// ---- The view ---------------------------------------------------------------------------

const SHOW_TRUE_ALTITUDE_M = 3000;

export function SpacecraftView({ model }: { model: SpacecraftModel }) {
  const spec = SPECS[model];
  const terrain = useTerrain();
  const root = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const glow = useRef<THREE.MeshStandardMaterial>(null);
  const realId = modelIdFor({ kind: "spacecraft", model });
  const realMats = useRef<THREE.MeshStandardMaterial[]>([]);
  const plasma = useRef<THREE.Mesh>(null);
  const plasmaMat = useRef<THREE.MeshBasicMaterial>(null);
  const legs = useRef<(THREE.Group | null)[]>([]);
  const plumes = useRef<(THREE.Group | null)[]>([]);
  const streaks = useRef<THREE.Points>(null);
  const dustPts = useRef<THREE.Points>(null);
  const dustMat = useRef<THREE.PointsMaterial>(null);
  const fireball = useRef<THREE.Mesh>(null);
  const fireMat = useRef<THREE.MeshBasicMaterial>(null);
  const crash = useRef<{ startedAt: number | null; lastT: number }>({ startedAt: null, lastT: 0 });
  const dustGeo = useMemo(() => makeDustGeometry(), []);
  const dot = useMemo(() => makeSoftDot(), []);
  const dustState = useRef<DustState | null>(null);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const camera = useThree((s) => s.camera);
  // Nozzle exits: from the real model's engine pivots (bottom centre of each bell) when rigged, else the stand-in spec.
  const exits = useMemo(() => realExits(realId, model) ?? spec.bells.map((b) => ({ x: b.x, y: spec.baseY - b.len, z: b.z, r: b.r, landing: b.landing })), [realId, model, spec]);
  const landingBells = exits.map((b, i) => (b.landing ? i : -1)).filter((i) => i >= 0);
  const realLegNodes = useRef<THREE.Object3D[]>([]);
  const flapNodes = useRef<Record<string, THREE.Object3D>>({});

  // Feet rest on the highest ground under them.
  const groundY = useMemo(() => {
    let h = terrain.height(0, 0);
    for (const l of spec.legs) h = Math.max(h, terrain.height(Math.cos(l.az) * l.footR, Math.sin(l.az) * l.footR));
    return h;
  }, [terrain, spec]);

  const streakPos = useMemo(() => {
    const p = new Float32Array(500 * 3);
    let s = 7;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5;
    for (let i = 0; i < 500; i++) {
      p[i * 3] = r() * spec.height * 2.5;
      p[i * 3 + 1] = r() * spec.height * 2.5;
      p[i * 3 + 2] = r() * spec.height * 2.5;
    }
    return p;
  }, [spec.height]);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const pts = dustPts.current;
    if (!pts) return;
    const posAttr = pts.geometry.attributes.position;
    const dust = { pos: posAttr.array as Float32Array, ...(dustState.current ??= { vel: new Float32Array(MAX_DUST * 3), life: new Float32Array(MAX_DUST), next: 0 }) };
    const ds = dustState.current;
    const { playback, result } = useLab.getState();
    const f = result.flight;
    const st = f ? flightAt(f, playback.t) : null;
    const h = st?.h ?? 0;
    const shownH = Math.min(h, SHOW_TRUE_ALTITUDE_M);
    const td = f?.touchdownS ?? null;
    const landed = td === null ? !f : playback.t >= td;
    const outcome = f?.outcome ?? "landed";
    const wrecked = landed && (outcome === "crashed" || outcome === "crushed" || outcome === "burned");
    const crushed = st?.crushed ?? false;
    const airy = (st?.pressurePa ?? 0) > 50;

    // Pose.
    if (root.current && tilt.current && body.current) {
      if (wrecked) {
        root.current.position.y = groundY;
        tilt.current.position.y = spec.radius * 0.85;
        tilt.current.rotation.z = model === "lm" ? 0.5 : Math.PI / 2 - 0.08;
      } else {
        root.current.position.y = groundY + shownH;
        tilt.current.position.y = spec.height / 2;
        tilt.current.rotation.z = (-(st?.pitchDeg ?? 0) * Math.PI) / 180;
        // Gentle buffeting while falling through air.
        if (!landed && airy) tilt.current.rotation.x = Math.sin(playback.t * 0.9) * 0.02;
        else tilt.current.rotation.x = 0;
      }
      body.current.position.y = -spec.height / 2;
      // A stepped-on can: the tank section flattens.
      const squash = crushed || (wrecked && outcome === "crushed");
      body.current.scale.set(squash ? 0.62 : wrecked ? 0.95 : 1, squash ? 0.86 : 1, squash ? 1.12 : 1);
    }

    // Legs: folded until the last ~4 vehicle heights, then out.
    const deploy = landed ? 1 : Math.min(1, Math.max(0, (4 * spec.height - h) / (2 * spec.height)));
    spec.legs.forEach((l, i) => {
      const g = legs.current[i];
      if (!g) return;
      const dep = Math.atan2(l.footR - l.hingeR, -l.hingeY);
      const a = l.fixed ? dep : 0.04 + (dep - 0.04) * deploy;
      g.rotation.z = -a;
      if (wrecked && outcome === "crashed") g.rotation.z = -dep * 0.6;
    });
    // Real Falcon 9 legs: hinged at their base on the tank, they swing out and down ~102° to reach the ground.
    realLegNodes.current.forEach((n) => {
      const r = Math.hypot(n.position.x, n.position.z) || 1;
      const angle = (wrecked && outcome === "crashed" ? 0.6 : deploy) * ((102 * Math.PI) / 180);
      n.quaternion.setFromAxisAngle(new THREE.Vector3(n.position.z / r, 0, -n.position.x / r), angle);
    });
    // Starship's flaps: small antiphase trim while it falls belly-first, folded leeward for the burn and on the ground.
    const fl = flapNodes.current;
    if (fl.flap_aft_L) {
      const bellyFirst = !landed && st !== null && st.aoaDeg < 150 && st.lit === 0 && airy;
      const trim = bellyFirst ? 0.09 * Math.sin(playback.t * 0.7) : 0;
      const fold = bellyFirst || (!landed && !airy) ? 0 : 0.7;
      fl.flap_aft_L.rotation.y = fold + trim;
      fl.flap_aft_R.rotation.y = -fold - trim;
      fl.flap_fwd_L.rotation.y = fold - trim;
      fl.flap_fwd_R.rotation.y = -fold + trim;
    }

    // Plumes.
    const thr = landed ? 0 : (st?.throttle ?? 0);
    const lit = landed ? 0 : (st?.lit ?? 0);
    const p = st?.pressurePa ?? 0;
    // Vacuum: long and wide; thick air: short, tight column (pressure-squeezed).
    const dense = p / 1e5;
    const lengthK = (airy ? 1 / (1 + 0.35 * dense) : 1.4) * (0.5 + thr);
    const widthK = airy ? 1 + 1 / (1 + dense) : 3.2;
    exits.forEach((b, i) => {
      const g = plumes.current[i];
      if (!g) return;
      const rank = landingBells.indexOf(i);
      const on = rank >= 0 && rank < lit && thr > 0.001;
      g.visible = on;
      if (on) {
        const flicker = 1 + 0.06 * Math.sin(state.clock.elapsedTime * 47 + i * 1.7);
        g.scale.set(b.r * widthK, b.r * 2 * 9 * lengthK * flicker, b.r * widthK);
      }
    });

    // Air rushing past when high up.
    if (streaks.current) {
      const speed = st?.speed ?? 0;
      streaks.current.visible = !landed && airy && h > 30;
      const arr = streaks.current.geometry.attributes.position.array as Float32Array;
      const v = (2 + Math.log1p(speed) * 4) * (spec.height / 20);
      const span = spec.height * 1.25;
      for (let i = 0; i < 500; i++) {
        arr[i * 3 + 1] += v * dt;
        if (arr[i * 3 + 1] > span) arr[i * 3 + 1] -= 2 * span;
      }
      streaks.current.geometry.attributes.position.needsUpdate = true;
      streaks.current.position.y = groundY + shownH + spec.height / 2;
    }

    // Dust kicked up by the exhaust near the ground (radially; ballistic in vacuum, lazy in air).
    const nearGround = !landed && thr > 0.01 && h < spec.height * 1.6 + 25;
    const tGround = playback.t;
    const realStep = tGround !== crash.current.lastT;
    if (nearGround && realStep) {
      const n = Math.round(12 * thr * (1 - h / (spec.height * 1.6 + 25)) + 2);
      const v0 = airy ? (dense > 10 ? 3 : 18) : 45;
      for (let k = 0; k < n; k++) {
        const i = ds.next;
        ds.next = (i + 1) % MAX_DUST;
        const a = rnd() * Math.PI * 2;
        const r = 1 + rnd() * spec.radius;
        dust.pos.set([Math.cos(a) * r, groundY + 0.3, Math.sin(a) * r], i * 3);
        const s = v0 * (0.5 + rnd());
        dust.vel.set([Math.cos(a) * s, (airy ? 0.6 : 0.15) * s * rnd(), Math.sin(a) * s], i * 3);
        dust.life[i] = 2.5 + rnd() * 2;
      }
    }
    // Crash: fireball (real seconds, so it reads at any time warp), smoke and debris.
    if (wrecked && outcome === "crashed") {
      if (crash.current.startedAt === null) {
        crash.current.startedAt = state.clock.elapsedTime;
        for (let k = 0; k < 250; k++) {
          const i = ds.next;
          ds.next = (i + 1) % MAX_DUST;
          const a = rnd() * Math.PI * 2;
          dust.pos.set([0, groundY + 1, 0], i * 3);
          const s = (airy ? 6 : 30) * (0.3 + rnd());
          dust.vel.set([Math.cos(a) * s, s * (0.3 + rnd()), Math.sin(a) * s], i * 3);
          dust.life[i] = 4 + rnd() * 3;
        }
      }
    } else crash.current.startedAt = null;
    crash.current.lastT = tGround;
    const age = crash.current.startedAt === null ? Infinity : state.clock.elapsedTime - crash.current.startedAt;
    if (fireball.current && fireMat.current) {
      const on = age < 3.5;
      fireball.current.visible = on;
      if (on) {
        const k = age / 3.5;
        fireball.current.position.set(0, groundY + spec.radius * (1 + 2 * k), 0);
        fireball.current.scale.setScalar(spec.radius * (1.2 + 5 * Math.sqrt(k)));
        fireMat.current.opacity = 0.9 * (1 - k);
        fireMat.current.color.setHSL(0.07 - 0.05 * k, 1, 0.55 - 0.3 * k);
      }
    }
    const g = airy ? -0.6 : -1.62;
    for (let i = 0; i < MAX_DUST; i++) {
      if (dust.life[i] <= 0) continue;
      dust.life[i] -= dt;
      if (dust.life[i] <= 0) {
        dust.pos[i * 3 + 1] = -1e5;
        continue;
      }
      const drag = airy ? Math.exp(-1.5 * dt) : 1;
      dust.vel[i * 3] *= drag;
      dust.vel[i * 3 + 2] *= drag;
      dust.vel[i * 3 + 1] = dust.vel[i * 3 + 1] * drag + g * dt;
      dust.pos[i * 3] += dust.vel[i * 3] * dt;
      dust.pos[i * 3 + 1] = Math.max(groundY + 0.05, dust.pos[i * 3 + 1] + dust.vel[i * 3 + 1] * dt);
      dust.pos[i * 3 + 2] += dust.vel[i * 3 + 2] * dt;
    }
    posAttr.needsUpdate = true;
    if (dustMat.current) dustMat.current.size = Math.max(0.6, spec.radius * 0.5);

    // Incandescence on the shell (nothing glows below ~525 °C): the thermal run's skin, or entry heating's hottest surface.
    const skinK = Math.max(useLab.getState().result.nodes.length ? stateSkinK() : 300, !landed && st ? st.surfaceK : 0);
    const hot = incandescence(skinK);
    if (glow.current) glow.current.emissive.copy(hot);
    for (const m of realMats.current) m.emissive.copy(hot);
    // Entry plasma: the shock layer ahead of the windward side glows once the heat flux is large.
    if (plasma.current && plasmaMat.current) {
      const q = !landed && st ? st.heatWm2 : 0;
      const k = Math.min(1, Math.max(0, Math.log10(Math.max(q, 1) / 5_000) / 1.5));
      plasma.current.visible = k > 0;
      plasmaMat.current.opacity = 0.35 * k;
      // Belly-first: in front of the windward side (+x); engines-first: below the base.
      const belly = (st?.aoaDeg ?? 180) < 150;
      plasma.current.position.set(belly ? spec.radius * 0.9 : 0, belly ? spec.height * 0.5 : -spec.radius * 0.2, 0);
      plasma.current.scale.set(belly ? spec.radius * 0.6 : spec.radius * 1.4, belly ? spec.height * 0.55 : spec.radius * 0.5, spec.radius * 1.4);
    }

    // Camera follows the craft.
    if (controls) {
      const target = new THREE.Vector3(0, groundY + (wrecked ? spec.radius : shownH + spec.height * 0.45), 0);
      const shift = target.clone().sub(controls.target);
      controls.target.add(shift);
      camera.position.add(shift);
      controls.update();
    }
  });

  const plumeColor = spec.plume;
  const c = spec.baseY;

  return (
    <>
      <group ref={root}>
        <group ref={tilt}>
          <group ref={body}>
            {realId ? (
              <Suspense fallback={<StandIn model={model} glow={glow} c={c} />}>
                <RealBody id={realId} materialsRef={realMats} legsRef={realLegNodes} flapsRef={flapNodes} />
              </Suspense>
            ) : (
              <StandIn model={model} glow={glow} c={c} />
            )}
            <mesh ref={plasma} visible={false}>
              <sphereGeometry args={[1, 32, 16]} />
              <meshBasicMaterial ref={plasmaMat} color="#ff9a6a" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
            </mesh>
            {exits.map((b, i) => (
              <group key={i} ref={(el) => void (plumes.current[i] = el)} position={[b.x, b.y, b.z]} visible={false}>
                <PlumeCone color={plumeColor.outer} opacity={plumeColor.opacity * 0.6} />
                <group scale={[0.55, 0.45, 0.55]}>
                  <PlumeCone color={plumeColor.core} opacity={plumeColor.opacity} inner />
                </group>
              </group>
            ))}
            {!realId && spec.legs.map((l, i) => {
              const len = Math.hypot(l.footR - l.hingeR, l.hingeY);
              return (
                <group key={i} rotation-y={-l.az}>
                  <group ref={(el) => void (legs.current[i] = el)} position={[l.hingeR, l.hingeY, 0]}>
                    <mesh position-y={len / 2} castShadow>
                      <cylinderGeometry args={[spec.legRadius, spec.legRadius * 0.8, len, 10]} />
                      <meshStandardMaterial color={model === "lm" ? "#c9a03f" : model === "falcon9" ? "#1c1c1f" : "#9ea2a8"} metalness={0.6} roughness={0.45} />
                    </mesh>
                    <mesh position-y={len} castShadow>
                      <cylinderGeometry args={[spec.legRadius * 2.6, spec.legRadius * 2.8, spec.legRadius * 0.7, 16]} />
                      <meshStandardMaterial color="#77736d" metalness={0.5} roughness={0.5} />
                    </mesh>
                  </group>
                </group>
              );
            })}
          </group>
        </group>
      </group>
      <points ref={streaks} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[streakPos, 3]} />
        </bufferGeometry>
        <pointsMaterial color="#fff0d0" size={Math.max(0.12, spec.height / 300)} transparent opacity={0.5} depthWrite={false} />
      </points>
      <points ref={dustPts} geometry={dustGeo} frustumCulled={false}>
        <pointsMaterial ref={dustMat} map={dot} color={new THREE.Color(...terrain.style.sedimentColor).multiplyScalar(1.4)} size={1} transparent opacity={0.6} depthWrite={false} />
      </points>
      <mesh ref={fireball} visible={false}>
        <sphereGeometry args={[1, 32, 16]} />
        <meshBasicMaterial ref={fireMat} color="#ff8a2a" transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
    </>
  );
}

/** Stand-in drawn from published dimensions, for vehicles whose real model isn't baked (docs/models.md). */
function StandIn({ model, glow, c }: { model: SpacecraftModel; glow: GlowRef; c: number }) {
  const spec = SPECS[model];
  return (
    <>
      {model === "starship" ? (
        <StarshipModel glow={glow} c={c} />
      ) : model === "falcon9" ? (
        <Falcon9Model glow={glow} c={c} />
      ) : model === "newglenn" ? (
        <NewGlennModel glow={glow} c={c} />
      ) : (
        <LunarModuleModel glow={glow} c={c} />
      )}
      <Bells bells={spec.bells} baseY={c} />
    </>
  );
}

/** Outer-shell temperature now (first thermal node is the skin). */
function stateSkinK(): number {
  const { result, playback } = useLab.getState();
  const s = result.series;
  const n = s.t.length;
  if (!n) return 300;
  let i = 0;
  while (i < n - 1 && s.t[i + 1] <= playback.t) i++;
  return s.nodeK[0][i];
}
