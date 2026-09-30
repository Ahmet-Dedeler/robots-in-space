"use client";

/**
 * Static vehicles (landers, probes). During descent the craft hangs in the
 * frame while haze streaks rush past; the ground fades in for the last few
 * hundred meters.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useLab } from "@/lib/lab-store";
import { stateAt } from "@/sim/mission/run";
import { incandescence } from "./damage";
import { useTerrain } from "./useScene";

/** A thin rod between two points. */
function Strut({ from, to, radius = 0.03, color = "#77706a" }: { from: THREE.Vector3; to: THREE.Vector3; radius?: number; color?: string }) {
  const mid = from.clone().add(to).multiplyScalar(0.5);
  const dir = to.clone().sub(from);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return (
    <mesh position={mid} quaternion={q} castShadow>
      <cylinderGeometry args={[radius, radius, dir.length(), 8]} />
      <meshStandardMaterial color={color} metalness={0.7} roughness={0.35} />
    </mesh>
  );
}

/** Venera 9-14 style lander: landing ring, pressure sphere, aerobraking disk, antenna. */
function VeneraModel({ glow }: { glow: React.RefObject<THREE.MeshStandardMaterial | null> }) {
  const struts = Array.from({ length: 10 }, (_, i) => (i / 10) * Math.PI * 2);
  return (
    <group>
      <mesh position-y={0.16} rotation-x={Math.PI / 2} castShadow receiveShadow>
        <torusGeometry args={[1.0, 0.15, 16, 48]} />
        <meshStandardMaterial color="#9a9186" metalness={0.6} roughness={0.4} />
      </mesh>
      {struts.map((a) => (
        <Strut
          key={a}
          from={new THREE.Vector3(Math.cos(a) * 0.95, 0.22, Math.sin(a) * 0.95)}
          to={new THREE.Vector3(Math.cos(a) * 0.42, 0.62, Math.sin(a) * 0.42)}
        />
      ))}
      <mesh position-y={1.0} castShadow>
        <sphereGeometry args={[0.62, 48, 32]} />
        <meshStandardMaterial ref={glow} color="#e9e4da" roughness={0.8} metalness={0.05} />
      </mesh>
      <mesh position-y={1.66} castShadow>
        <cylinderGeometry args={[1.05, 1.05, 0.05, 48]} />
        <meshStandardMaterial color="#cfc8bb" metalness={0.3} roughness={0.5} />
      </mesh>
      <mesh position-y={1.95} castShadow>
        <cylinderGeometry args={[0.08, 0.14, 0.55, 12]} />
        <meshStandardMaterial color="#b9b0a2" metalness={0.4} roughness={0.5} />
      </mesh>
      {/* Camera ports on opposite sides, like the real lander. */}
      {[0, Math.PI].map((a) => (
        <mesh key={a} position={[Math.cos(a) * 0.58, 1.15, Math.sin(a) * 0.58]} castShadow>
          <boxGeometry args={[0.16, 0.26, 0.16]} />
          <meshStandardMaterial color="#3a3530" roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function ProbeModel({ glow }: { glow: React.RefObject<THREE.MeshStandardMaterial | null> }) {
  const legs = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
  return (
    <group>
      <mesh position-y={0.55} castShadow>
        <sphereGeometry args={[0.38, 48, 32]} />
        <meshStandardMaterial ref={glow} color="#d8d2c6" roughness={0.6} metalness={0.2} />
      </mesh>
      {legs.map((a) => (
        <Strut
          key={a}
          radius={0.025}
          from={new THREE.Vector3(Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45)}
          to={new THREE.Vector3(Math.cos(a) * 0.2, 0.4, Math.sin(a) * 0.2)}
        />
      ))}
    </group>
  );
}

function Parachute() {
  return (
    <group position-y={9}>
      <mesh>
        <sphereGeometry args={[4, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2.4]} />
        <meshStandardMaterial color="#f0e2c4" side={THREE.DoubleSide} roughness={0.9} />
      </mesh>
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        const top = new THREE.Vector3(Math.cos(a) * 3.3, 1.9, Math.sin(a) * 3.3);
        const bottom = new THREE.Vector3(0, -6.9, 0);
        const mid = top.clone().add(bottom).multiplyScalar(0.5);
        const len = top.distanceTo(bottom);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(bottom).normalize());
        return (
          <mesh key={i} position={mid} quaternion={q}>
            <cylinderGeometry args={[0.01, 0.01, len, 4]} />
            <meshBasicMaterial color="#d9cbb0" />
          </mesh>
        );
      })}
    </group>
  );
}

/** Haze particles streaming upward to show descent speed. */
function Streaks({ speedRef }: { speedRef: React.RefObject<number> }) {
  const count = 400;
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const p = new Float32Array(count * 3);
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    for (let i = 0; i < count; i++) {
      p[i * 3] = rnd() * 40;
      p[i * 3 + 1] = rnd() * 40;
      p[i * 3 + 2] = rnd() * 40;
    }
    return p;
  }, []);
  useFrame((_, dt) => {
    const pts = ref.current;
    if (!pts) return;
    const arr = pts.geometry.attributes.position.array as Float32Array;
    // Visual speed compresses the real range (5-200 m/s) into something watchable.
    const v = 2 + Math.log1p(speedRef.current ?? 0) * 6;
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] += v * dt;
      if (arr[i * 3 + 1] > 20) arr[i * 3 + 1] -= 40;
    }
    pts.geometry.attributes.position.needsUpdate = true;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#fff0d0" size={0.12} transparent opacity={0.55} depthWrite={false} />
    </points>
  );
}

export function LanderView({ shape }: { shape: "lander" | "box" }) {
  const group = useRef<THREE.Group>(null);
  const glow = useRef<THREE.MeshStandardMaterial>(null);
  const speed = useRef(0);
  const descending = useRef(false);
  const chute = useRef<THREE.Group>(null);
  const streaks = useRef<THREE.Group>(null);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const camera = useThree((s) => s.camera);
  const terrain = useTerrain();
  // Settle on the ground: fit a plane under the 1 m landing ring (tilts on slopes, like Venera 9 did)
  // and rest on the highest rock it touches.
  const { groundY, tilt } = (() => {
    const ring = Array.from({ length: 16 }, (_, k) => {
      const a = (k / 16) * Math.PI * 2;
      return { x: Math.cos(a), y: Math.sin(a), h: terrain.height(Math.cos(a), Math.sin(a)) };
    });
    const mean = ring.reduce((m, p) => m + p.h, 0) / ring.length;
    const sx = ring.reduce((m, p) => m + p.x * (p.h - mean), 0) / ring.reduce((m, p) => m + p.x * p.x, 0);
    const sy = ring.reduce((m, p) => m + p.y * (p.h - mean), 0) / ring.reduce((m, p) => m + p.y * p.y, 0);
    const lift = Math.max(...ring.map((p) => p.h - (mean + sx * p.x + sy * p.y)));
    // MuJoCo (x, y) -> three (x, -z): the ground normal in three coordinates.
    const n = new THREE.Vector3(-sx, 1, sy).normalize();
    return { groundY: mean + lift, tilt: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n) };
  })();

  useFrame(() => {
    const { playback, result, config } = useLab.getState();
    const st = stateAt(result, playback.t);
    const above = st.altitudeM - config.scenario.elevationM;
    descending.current = above > 0.5;
    speed.current = st.speedMs;
    const y = Math.min(above, 40) + groundY;
    if (group.current) {
      group.current.position.y = y;
      if (descending.current) group.current.quaternion.setFromEuler(new THREE.Euler(0, 0, Math.sin(playback.t * 0.7) * 0.03));
      else group.current.quaternion.copy(tilt);
    }
    const stages = result.build.descent?.stages ?? [];
    const km = st.altitudeM / 1000;
    const chuteOn = descending.current && stages.length > 1 && km > stages[1].belowKm;
    if (chute.current) chute.current.visible = chuteOn;
    if (streaks.current) streaks.current.visible = above > 60;
    // Real incandescence only: nothing glows below ~525 °C, so a lander in 462 °C air stays dark.
    const skinK = st.nodeK[0] ?? 300;
    if (glow.current) glow.current.emissive.copy(incandescence(skinK));
    if (controls) {
      const target = new THREE.Vector3(0, y + 1, 0);
      const shift = target.clone().sub(controls.target);
      controls.target.add(shift);
      camera.position.add(shift);
      controls.update();
    }
  });

  return (
    <>
      <group ref={group}>
        {shape === "lander" ? <VeneraModel glow={glow} /> : <ProbeModel glow={glow} />}
        <group ref={chute}>
          <Parachute />
        </group>
        <group ref={streaks}>
          <Streaks speedRef={speed} />
        </group>
      </group>
    </>
  );
}
