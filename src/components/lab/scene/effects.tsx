"use client";

/**
 * Particle effects for thermal damage.
 *
 * - MeltDrips: molten polymer falling off the body and pooling as tar on the
 *   basalt. Pools persist (the plastic is gone from the robot).
 * - Plume: soft sprites for pyrolysis fumes and battery venting. Hot gas in
 *   92-bar CO2 rises slowly; the dense air keeps plumes tight and lazy.
 *
 * Sources are sampled from the robot's world-space mesh vertices each frame by
 * the caller via `sample()`.
 */
import { useFrame } from "@react-three/fiber";
import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useLab } from "@/lib/lab-store";
import { surfaceMedium } from "@/sim/planets/world";

let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// ---- Drips + puddles -------------------------------------------------------------

export interface DripsHandle {
  /** Spawn `n` drips at the given world positions. */
  spawn: (points: THREE.Vector3[]) => void;
  clear: () => void;
}

const MAX_DRIPS = 160;
const MAX_POOLS = 500;

/** Ground height under a world point (three.js x, z) [m]. */
export type GroundAt = (x: number, z: number) => number;

export const MeltDrips = forwardRef<DripsHandle, { groundAt: GroundAt }>(function MeltDrips({ groundAt }, ref) {
  const drops = useRef<THREE.InstancedMesh>(null);
  const pools = useRef<THREE.InstancedMesh>(null);
  const state = useRef({
    pos: Array.from({ length: MAX_DRIPS }, () => new THREE.Vector3()),
    vel: new Float32Array(MAX_DRIPS),
    live: new Uint8Array(MAX_DRIPS),
    size: new Float32Array(MAX_DRIPS),
    next: 0,
    pools: 0,
    poolNext: 0,
  });
  const dropGeo = useMemo(() => new THREE.SphereGeometry(1, 8, 6), []);
  const poolGeo = useMemo(() => new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2), []);
  const tmp = useMemo(() => new THREE.Object3D(), []);

  useImperativeHandle(ref, () => ({
    spawn(points) {
      const s = state.current;
      for (const p of points) {
        const i = s.next;
        s.next = (s.next + 1) % MAX_DRIPS;
        s.pos[i].copy(p);
        s.vel[i] = 0;
        s.live[i] = 1;
        s.size[i] = 0.004 + rnd() * 0.008;
      }
    },
    clear() {
      const s = state.current;
      s.live.fill(0);
      s.pools = 0;
      s.poolNext = 0;
      if (pools.current) {
        pools.current.count = 0;
        pools.current.instanceMatrix.needsUpdate = true;
      }
    },
  }));

  // Instanced meshes start with identity matrices; show nothing until something drips.
  useLayoutEffect(() => {
    if (drops.current) drops.current.count = 0;
    if (pools.current) pools.current.count = 0;
  }, []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const s = state.current;
    const d = drops.current;
    const p = pools.current;
    if (!d || !p) return;
    const medium = surfaceMedium(useLab.getState().config.scenario);
    let n = 0;
    for (let i = 0; i < MAX_DRIPS; i++) {
      if (!s.live[i]) continue;
      // Viscous melt stretches before letting go, then falls through dense CO2 (low terminal speed).
      // In vacuum or thin Mars air nothing slows it down.
      s.vel[i] = Math.min(s.vel[i] + medium.gravity * dt, medium.densityKgM3 > 10 ? 1.6 : 20);
      s.pos[i].y -= s.vel[i] * dt;
      const ground = groundAt(s.pos[i].x, s.pos[i].z);
      if (s.pos[i].y <= ground + 0.003) {
        s.live[i] = 0;
        const k = s.poolNext;
        s.poolNext = (s.poolNext + 1) % MAX_POOLS;
        s.pools = Math.min(MAX_POOLS, s.pools + 1);
        const r = s.size[i] * (3 + rnd() * 4);
        const px = s.pos[i].x + (rnd() - 0.5) * 0.02;
        const pz = s.pos[i].z + (rnd() - 0.5) * 0.02;
        tmp.position.set(px, groundAt(px, pz) + 0.002 + k * 1e-6, pz);
        tmp.rotation.set(0, rnd() * Math.PI, 0);
        tmp.scale.set(r * (0.7 + rnd() * 0.6), 1, r);
        tmp.updateMatrix();
        p.setMatrixAt(k, tmp.matrix);
        p.count = s.pools;
        p.instanceMatrix.needsUpdate = true;
        continue;
      }
      tmp.position.copy(s.pos[i]);
      tmp.rotation.set(0, 0, 0);
      const stretch = 1 + s.vel[i] * 1.5;
      tmp.scale.set(s.size[i], s.size[i] * stretch, s.size[i]);
      tmp.updateMatrix();
      d.setMatrixAt(n++, tmp.matrix);
    }
    d.count = n;
    d.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={drops} args={[dropGeo, undefined, MAX_DRIPS]} frustumCulled={false}>
        <meshStandardMaterial color="#2a1a0e" roughness={0.2} metalness={0} />
      </instancedMesh>
      <instancedMesh ref={pools} args={[poolGeo, undefined, MAX_POOLS]} frustumCulled={false} receiveShadow>
        <meshStandardMaterial color="#120b07" roughness={0.12} metalness={0.05} polygonOffset polygonOffsetFactor={-2} />
      </instancedMesh>
    </>
  );
});

// ---- Plume (fumes, venting) --------------------------------------------------------

export interface PlumeHandle {
  emit: (at: THREE.Vector3, opts: { color: THREE.Color; size: number; rise: number; spread: number; life: number }) => void;
  clear: () => void;
}

const MAX_PUFFS = 700;

const plumeVertex = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * 900.0 / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const plumeFragment = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d);
    if (r > 0.5) discard;
    float soft = smoothstep(0.5, 0.0, r);
    gl_FragColor = vec4(vColor, vAlpha * soft * soft);
  }
`;

export const Plume = forwardRef<PlumeHandle>(function Plume(_, ref) {
  const points = useRef<THREE.Points>(null);
  const buf = useMemo(
    () => ({
      pos: new Float32Array(MAX_PUFFS * 3),
      vel: new Float32Array(MAX_PUFFS * 3),
      size: new Float32Array(MAX_PUFFS),
      size0: new Float32Array(MAX_PUFFS),
      alpha: new Float32Array(MAX_PUFFS),
      color: new Float32Array(MAX_PUFFS * 3),
      age: new Float32Array(MAX_PUFFS),
      life: new Float32Array(MAX_PUFFS),
      next: { i: 0 },
    }),
    [],
  );
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(buf.pos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(buf.size, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(buf.alpha, 1));
    g.setAttribute("aColor", new THREE.BufferAttribute(buf.color, 3));
    return g;
  }, [buf]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: plumeVertex,
        fragmentShader: plumeFragment,
        transparent: true,
        depthWrite: false,
      }),
    [],
  );

  useImperativeHandle(ref, () => ({
    emit(at, o) {
      const i = buf.next.i;
      buf.next.i = (i + 1) % MAX_PUFFS;
      buf.pos.set([at.x + (rnd() - 0.5) * o.spread, at.y, at.z + (rnd() - 0.5) * o.spread], i * 3);
      buf.vel.set([(rnd() - 0.5) * 0.08, o.rise * (0.7 + rnd() * 0.6), (rnd() - 0.5) * 0.08], i * 3);
      buf.size0[i] = o.size * (0.6 + rnd() * 0.8);
      buf.age[i] = 0;
      buf.life[i] = o.life * (0.7 + rnd() * 0.6);
      buf.color.set([o.color.r, o.color.g, o.color.b], i * 3);
    },
    clear() {
      buf.life.fill(0);
      buf.alpha.fill(0);
    },
  }));

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    for (let i = 0; i < MAX_PUFFS; i++) {
      if (buf.life[i] <= 0) continue;
      buf.age[i] += dt;
      const f = buf.age[i] / buf.life[i];
      if (f >= 1) {
        buf.life[i] = 0;
        buf.alpha[i] = 0;
        continue;
      }
      // Drift with the 0.5 m/s surface wind (+x in MuJoCo = +x here), slow down as it mixes.
      buf.pos[i * 3] += (buf.vel[i * 3] + 0.25 * f) * dt;
      buf.pos[i * 3 + 1] += buf.vel[i * 3 + 1] * (1 - 0.6 * f) * dt;
      buf.pos[i * 3 + 2] += buf.vel[i * 3 + 2] * dt;
      buf.size[i] = buf.size0[i] * (1 + 3 * f);
      buf.alpha[i] = 0.55 * Math.sin(Math.PI * Math.min(1, f * 1.4 + 0.05)) * (1 - f);
    }
    const g = points.current?.geometry;
    if (!g) return;
    for (const k of ["position", "aSize", "aAlpha", "aColor"]) g.attributes[k].needsUpdate = true;
  });

  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} />;
});
