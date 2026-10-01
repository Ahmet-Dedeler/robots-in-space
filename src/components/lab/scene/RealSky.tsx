"use client";

/**
 * The real night sky for airless worlds and Mars, oriented by sim/planets/sky.ts:
 *
 * - Stars: the Yale Bright Star Catalogue (9,096 stars to V ~6.5, the
 *   naked-eye limit), with real positions, magnitudes and B-V colours. The
 *   constellations wheel about the body's true celestial pole (near Polaris
 *   for neither: the Moon's is in Draco, Mars's between Deneb and Alderamin).
 * - Earth from the Moon: NASA Blue Marble texture, 1.9° across, spinning on
 *   its tilted axis once per sidereal day. Lit by the true Sun direction even
 *   when the Sun is below the local horizon, so at lunar midnight it shows
 *   as a near-full Earth, as it really does.
 * - Phobos and Deimos from Mars: real orbit radii, periods and sizes. Phobos
 *   is ~0.2° overhead (a third of our Moon), races across the sky west to
 *   east in ~4.5 h; Deimos is barely more than a bright star.
 *
 * Star brightness is compressed (flux ~ 10^(-0.4 V) to the 0.4 power) so the
 * faint ones stay visible on a monitor; the ordering is kept.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { EARTH_SIDEREAL_S, MARS_MOONS, moonletEnu, type Mat3 } from "@/sim/planets/sky";
import type { Body } from "@/sim/planets/bodies";

/** Local ENU (east, north, up) -> three.js (x east, y up, z south). */
export function enuToThree(m: Mat3, out = new THREE.Matrix4()): THREE.Matrix4 {
  // Rows of m give E, N, U for a J2000 vector; three rows are E, U, -N.
  return out.set(m[0], m[1], m[2], 0, m[6], m[7], m[8], 0, -m[3], -m[4], -m[5], 0, 0, 0, 0, 1);
}

export const enuVecToThree = ([e, n, u]: readonly number[], out = new THREE.Vector3()) => out.set(e, u, -n);

/** Approximate star colour from B-V (Mitchell Charity, "What colour are the stars?"). */
const BV_COLORS: [number, [number, number, number]][] = [
  [-0.33, [155, 176, 255]],
  [-0.17, [170, 191, 255]],
  [0.0, [202, 215, 255]],
  [0.3, [248, 247, 255]],
  [0.65, [255, 244, 234]],
  [0.81, [255, 210, 161]],
  [1.4, [255, 204, 111]],
];
function bvColor(bv: number): [number, number, number] {
  if (bv <= BV_COLORS[0][0]) return BV_COLORS[0][1].map((c) => c / 255) as [number, number, number];
  for (let i = 1; i < BV_COLORS.length; i++) {
    const [b1, c1] = BV_COLORS[i];
    const [b0, c0] = BV_COLORS[i - 1];
    if (bv <= b1) {
      const f = (bv - b0) / (b1 - b0);
      return c0.map((c, k) => (c + (c1[k] - c) * f) / 255) as [number, number, number];
    }
  }
  return BV_COLORS[BV_COLORS.length - 1][1].map((c) => c / 255) as [number, number, number];
}

const STAR_VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float mag;
  attribute vec3 tint;
  uniform float uVisible;
  uniform float uTau;
  uniform vec3 uUp;
  varying vec3 vColor;
  void main() {
    vec3 dir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
    float h = dot(dir, uUp);
    // Dust extinction through the column: tau per airmass (Mars only).
    float airmass = 1.0 / max(h, 0.04);
    float flux = pow(10.0, -0.4 * mag) * exp(-uTau * airmass);
    float b = pow(flux, 0.4);
    vColor = tint * min(1.6, 1.15 * b) * uVisible * step(-0.01, h);
    gl_PointSize = clamp(1.0 + 2.6 * pow(b, 0.6), 1.0, 4.5);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;
const STAR_FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  varying vec3 vColor;
  void main() {
    #include <logdepthbuf_fragment>
    vec2 c = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.15, length(c));
    if (a <= 0.0 || dot(vColor, vec3(1.0)) < 0.003) discard;
    gl_FragColor = vec4(vColor * a, 1.0);
  }
`;

/**
 * The catalogue stars at `radius`, in J2000. The parent sets the rotation
 * (matrix) and the uniforms uVisible (0-1) and uTau (dust optical depth).
 */
export const StarField = forwardRef<THREE.Points, { radius: number }>(function StarField({ radius }, ref) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/sky/stars.bin")
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        if (!alive) return;
        const raw = new Int16Array(buf);
        const n = raw.length / 5;
        const pos = new Float32Array(n * 3);
        const mag = new Float32Array(n);
        const tint = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          const s = radius / 32767;
          pos[i * 3] = raw[i * 5] * s;
          pos[i * 3 + 1] = raw[i * 5 + 1] * s;
          pos[i * 3 + 2] = raw[i * 5 + 2] * s;
          mag[i] = raw[i * 5 + 3] / 1000;
          tint.set(bvColor(raw[i * 5 + 4] / 1000), i * 3);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        g.setAttribute("mag", new THREE.BufferAttribute(mag, 1));
        g.setAttribute("tint", new THREE.BufferAttribute(tint, 3));
        setGeometry(g);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [radius]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        uniforms: { uVisible: { value: 0 }, uTau: { value: 0 }, uUp: { value: new THREE.Vector3(0, 1, 0) } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );
  return (
    <points ref={ref} geometry={geometry ?? undefined} material={material} userData={{ noShadow: true }} frustumCulled={false} renderOrder={-2} matrixAutoUpdate={false} visible={geometry !== null} />
  );
});

// ---- Sunlit spheres in the sky (Earth, Phobos, Deimos) ------------------------------

const BODY_VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;
const BODY_FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uSun;
  uniform float uSunScale;
  uniform vec3 uAlbedo;
  uniform sampler2D uMap;
  uniform float uHasMap;
  uniform vec3 uLimb;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying vec2 vUv;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vNormal);
    vec3 base = mix(uAlbedo, texture2D(uMap, vUv).rgb, uHasMap);
    float mu = dot(n, uSun);
    // Lambert, like the ground; a soft terminator for Earth's atmosphere.
    float lit = smoothstep(-0.06, 0.12, mu) * max(mu, 0.0) + 0.04 * smoothstep(-0.2, 0.05, mu) * uHasMap;
    vec3 col = base * uSunScale * lit + uLimb * smoothstep(-0.1, 0.2, mu) * pow(1.0 - abs(dot(n, normalize(cameraPosition - vWorld))), 2.0);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function sunlitMaterial(map: THREE.Texture | null, albedo: THREE.Color, limb: THREE.Color) {
  return new THREE.ShaderMaterial({
    vertexShader: BODY_VERT,
    fragmentShader: BODY_FRAG,
    uniforms: {
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uSunScale: { value: 1 },
      uAlbedo: { value: albedo },
      uMap: { value: map },
      uHasMap: { value: map ? 1 : 0 },
      uLimb: { value: limb },
    },
  });
}

export interface SkyState {
  /** J2000 -> three.js rotation for this frame. */
  rot: THREE.Matrix4;
  /** True Sun direction in three.js coordinates (not clamped to the horizon). */
  sun: THREE.Vector3;
  /** Radiance scale of full sunlight (matches the ground's Lambert shading). */
  sunScale: number;
  sunElevDeg: number;
  /** Mission time [s]. */
  t: number;
}

/** Earth seen from the Moon: Blue Marble on a tilted, spinning globe at its true 1.9° size. */
export function Earth({ dir, distance, sky }: { dir: THREE.Vector3; distance: number; sky: React.RefObject<SkyState> }) {
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3 } | null;
  const ref = useRef<THREE.Mesh>(null);
  const material = useMemo(() => {
    const map = new THREE.TextureLoader().load("/sky/earth.jpg");
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    return sunlitMaterial(map, new THREE.Color(1, 1, 1), new THREE.Color(0.06, 0.12, 0.3));
  }, []);
  const tmp = useMemo(() => ({ spin: new THREE.Matrix4(), basis: new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0)) }), []);
  useFrame(() => {
    const m = ref.current;
    const s = sky.current;
    if (!m || !s) return;
    m.position.copy(controls?.target ?? new THREE.Vector3()).addScaledVector(dir, distance);
    // Earth-fixed -> J2000 is a spin about z (Greenwich angle; arbitrary at t = 0).
    tmp.spin.makeRotationZ((2 * Math.PI * s.t) / EARTH_SIDEREAL_S);
    m.matrix.copy(s.rot).multiply(tmp.spin).multiply(tmp.basis);
    m.matrix.setPosition(m.position);
    m.matrixWorldNeedsUpdate = true;
    const u = (m.material as THREE.ShaderMaterial).uniforms;
    u.uSun.value.copy(s.sun);
    // Earth's Bond albedo (~0.3) is baked into the Blue Marble colours.
    u.uSunScale.value = s.sunScale;
  });
  // Earth is 12,742 km wide at 384,400 km: 1.90°.
  const r = distance * Math.tan(0.95 * (Math.PI / 180));
  return (
    <mesh ref={ref} material={material} userData={{ noShadow: true }} matrixAutoUpdate={false} renderOrder={-1}>
      <sphereGeometry args={[r, 64, 32]} />
    </mesh>
  );
}

/** Phobos and Deimos from a Martian site. Positions are drawn at a fixed sky distance, scaled to their true angular size. */
export function MarsMoons({ body, latDeg, distance, sky }: { body: Body; latDeg: number; distance: number; sky: React.RefObject<SkyState> }) {
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3 } | null;
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const materials = useMemo(
    // Geometric albedo ~0.07: dark, slightly reddish-grey rock (Phobos is darker than asphalt).
    () => MARS_MOONS.map((m) => sunlitMaterial(null, new THREE.Color(m.albedo * 2.2, m.albedo * 2.0, m.albedo * 1.8), new THREE.Color(0, 0, 0))),
    [],
  );
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const s = sky.current;
    if (!s) return;
    MARS_MOONS.forEach((moon, i) => {
      const mesh = refs.current[i];
      if (!mesh) return;
      // Arbitrary starting phases (no calendar date in the scenario): Phobos just risen in the west, Deimos near the meridian.
      const p = moonletEnu(moon, body, latDeg, s.t, i === 0 ? -0.6 : 0.3);
      enuVecToThree(p.dir, v);
      // Dark rock against a bright dusty sky: effectively invisible by day.
      mesh.visible = p.dir[2] > -0.005 && s.sunElevDeg < -3;
      mesh.position.copy(controls?.target ?? new THREE.Vector3()).addScaledVector(v, distance);
      // True angular radius, drawn at `distance`.
      mesh.scale.setScalar((distance * moon.radiusM) / p.distanceM);
      const u = (mesh.material as THREE.ShaderMaterial).uniforms;
      u.uSun.value.copy(s.sun);
      u.uSunScale.value = s.sunScale;
    });
  });
  return (
    <>
      {MARS_MOONS.map((m, i) => (
        <mesh key={m.name} ref={(el) => void (refs.current[i] = el)} material={materials[i]} userData={{ noShadow: true }} renderOrder={-1}>
          <sphereGeometry args={[1, 24, 12]} />
        </mesh>
      ))}
    </>
  );
}
