"use client";

/**
 * Venus look: thick orange haze, soft overcast light from everywhere, and
 * flat fractured basalt plates like the Venera 13/14 panoramas.
 *
 * Haze follows altitude: bright and dense inside the cloud deck (48-70 km),
 * dimmer and redder below it, clearing to a pale sky above.
 */
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useLab } from "@/lib/lab-store";
import { stateAt } from "@/sim/mission/run";

function hazeFor(altKm: number): { color: THREE.Color; density: number; light: number } {
  const below = new THREE.Color("#b8743a");
  const cloud = new THREE.Color("#e8c690");
  const above = new THREE.Color("#f3e6c8");
  if (altKm < 48) {
    const f = altKm / 48;
    return { color: below.clone().lerp(cloud, f * 0.6), density: 0.012 + f * 0.01, light: 0.55 + f * 0.35 };
  }
  if (altKm < 70) return { color: cloud, density: 0.06, light: 1.1 };
  return { color: above, density: 0.004, light: 1.6 };
}

function basaltTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#5a3d28";
  ctx.fillRect(0, 0, size, size);
  // Deterministic pseudo-random so the ground looks the same every load.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Tile-able Voronoi plates.
  const pts: [number, number, number][] = [];
  for (let i = 0; i < 70; i++) pts.push([rnd() * size, rnd() * size, rnd()]);
  const img = ctx.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let d1 = Infinity;
      let d2 = Infinity;
      let shade = 0;
      for (const [px, py, s] of pts) {
        let dx = Math.abs(x - px);
        let dy = Math.abs(y - py);
        dx = Math.min(dx, size - dx);
        dy = Math.min(dy, size - dy);
        const d = dx * dx + dy * dy;
        if (d < d1) {
          d2 = d1;
          d1 = d;
          shade = s;
        } else if (d < d2) d2 = d;
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      const crack = edge < 3 ? 0.35 : edge < 6 ? 0.7 : 1;
      const grain = 0.9 + 0.2 * rnd();
      const k = (0.75 + shade * 0.4) * crack * grain;
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, 118 * k);
      img.data[i + 1] = Math.min(255, 84 * k);
      img.data[i + 2] = Math.min(255, 56 * k);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(120, 120);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function Rocks() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const count = 260;
  const geometry = useMemo(() => new THREE.DodecahedronGeometry(1, 0), []);
  useLayoutEffect(() => {
    {
      const m = mesh.current;
      if (!m) return;
      let seed = 3;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const o = new THREE.Object3D();
      for (let i = 0; i < count; i++) {
        const r = 4 + rnd() * 90;
        const a = rnd() * Math.PI * 2;
        const s = 0.05 + rnd() ** 3 * 0.8;
        o.position.set(Math.cos(a) * r, s * 0.15, Math.sin(a) * r);
        o.scale.set(s * (1 + rnd()), s * 0.35, s * (1 + rnd()));
        o.rotation.set(0, rnd() * Math.PI, 0);
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
    }
  }, []);
  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, count]} receiveShadow castShadow>
      <meshStandardMaterial color="#4a3222" roughness={0.95} flatShading />
    </instancedMesh>
  );
}

export function VenusEnvironment() {
  const hemi = useRef<THREE.HemisphereLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const ground = useMemo(() => (typeof document === "undefined" ? null : basaltTexture()), []);
  const fogRef = useRef<THREE.FogExp2>(null);
  const bgRef = useRef<THREE.Color>(null);
  const groundRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const { result, playback, config } = useLab.getState();
    const st = stateAt(result, playback.t);
    const altitudeKm = st.altitudeM / 1000;
    if (groundRef.current) groundRef.current.visible = st.altitudeM - config.scenario.elevationM < 3000;
    const h = hazeFor(altitudeKm);
    const fog = fogRef.current;
    if (fog) {
      fog.color.lerp(h.color, 0.1);
      fog.density += (h.density - fog.density) * 0.1;
      bgRef.current?.copy(fog.color);
    }
    if (hemi.current) hemi.current.intensity = 1.6 * h.light;
    if (sun.current) sun.current.intensity = 0.9 * h.light;
  });

  return (
    <>
      <fogExp2 ref={fogRef} attach="fog" args={["#b8743a", 0.015]} />
      <color ref={bgRef} attach="background" args={["#b8743a"]} />
      <hemisphereLight ref={hemi} args={["#ffd9a0", "#6b3d1f", 1.2]} />
      <directionalLight
        ref={sun}
        position={[20, 40, 10]}
        color="#ffc98a"
        intensity={0.8}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        shadow-bias={-0.0005}
      />
      {ground && (
        <group ref={groundRef}>
          <mesh rotation-x={-Math.PI / 2} receiveShadow>
            <planeGeometry args={[800, 800]} />
            <meshStandardMaterial map={ground} roughness={0.95} metalness={0} />
          </mesh>
          <Rocks />
        </group>
      )}
    </>
  );
}
