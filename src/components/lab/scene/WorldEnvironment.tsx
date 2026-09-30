"use client";

/**
 * Sky and light for whichever world the experiment is on. Venus keeps its
 * own optics (VenusEnvironment). For the others, from the sim's own Sun:
 *
 * - The Sun sits where the mission clock puts it (elevation/azimuth from
 *   planets/solar.ts, recorded in the run), with its real angular size:
 *   0.53° from the Moon, 0.35° from Mars, up to 1.7° from Mercury.
 * - Airless worlds: black sky, one hard-edged light source, no haze at any
 *   distance, shadows as black as the sky. Stars show when the Sun is
 *   down (in daylight the ground outshines them, as in every Apollo photo).
 *   The only fill light is sunlight bounced off the ground (albedo ~0.07-0.2).
 * - The Moon's near side has Earth fixed in the sky (it's tidally locked),
 *   lit by the same Sun, so its phase is right by construction.
 * - Mars: dust scatters the light into a butterscotch sky, bluish around the
 *   Sun near sunset (forward scattering by ~1.5 µm dust; Lemmon et al. 2004
 *   Pancam sky images). Haze and the beam/diffuse split follow the dust
 *   opacity through the same transmission model as the thermal sim.
 *
 * Brightness is compressed (the eye and the tone mapper can't show a
 * 100,000 lux beam next to a 3,000 lux Venus overcast), but ratios keep
 * their order: Mercury > Moon > Mars > Venus surface.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { forwardRef, useMemo, useRef } from "react";
import * as THREE from "three";
import { useLab } from "@/lib/lab-store";
import { stateAt } from "@/sim/mission/run";
import { BODIES, siteById } from "@/sim/planets/bodies";
import { marsTransmission } from "@/sim/planets/mars";
import { VenusEnvironment } from "./VenusEnvironment";

const DEG = Math.PI / 180;
const SKY_DISTANCE = 4000;

/** Direction (three.js: x east, y up, z south) for an azimuth from north and an elevation. */
function skyDir(azDeg: number, elDeg: number, out = new THREE.Vector3()) {
  const az = azDeg * DEG;
  const el = elDeg * DEG;
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

/** Where Earth hangs in the sky of a near-side lunar site (sub-Earth point at 0°, 0°; libration ignored). */
function earthDirection(latDeg: number, lonDeg: number): { azDeg: number; elDeg: number } | null {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const d = Math.acos(Math.cos(lat) * Math.cos(lon));
  const el = 90 - d / DEG;
  if (el < -2) return null;
  const az = Math.atan2(-Math.sin(lon), -Math.sin(lat) * Math.cos(lon)) / DEG;
  return { azDeg: (az + 360) % 360, elDeg: el };
}

export function WorldEnvironment() {
  const planet = useLab((s) => s.config.scenario.planet);
  if (!planet) return <VenusEnvironment />;
  return <PlanetSky key={`${planet.body}-${planet.siteId}`} />;
}

function PlanetSky() {
  const planet = useLab((s) => s.config.scenario.planet)!;
  const body = BODIES[planet.body];
  const site = siteById(planet.siteId)!;
  const mars = body.atmosphere === "mars";
  const sunAngularDeg = 0.533 / body.orbit.aAU;
  const earth = planet.body === "moon" ? earthDirection(site.latDeg, site.lonDeg) : null;

  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const disk = useRef<THREE.Mesh>(null);
  const bg = useRef<THREE.Color>(null);
  const fog = useRef<THREE.FogExp2>(null);
  const stars = useRef<THREE.Points>(null);
  const earthshine = useRef<THREE.DirectionalLight>(null);
  const scene = useThree((s) => s.scene);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3 } | null;
  const frame = useRef(0);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const skyDay = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    const { result, playback } = useLab.getState();
    const st = stateAt(result, playback.t);
    const w = st.world;
    const target = controls?.target ?? new THREE.Vector3();
    // Shadows: every mesh casts and receives (the robot views don't opt in themselves).
    if (frame.current++ % 30 === 0)
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && !m.userData.noShadow) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });

    const up = w.sunElevDeg > -sunAngularDeg / 2 && !site.shadowed;
    // Share of the Sun's disk above the horizon (sunrise on Mercury takes days).
    const rise = site.shadowed ? 0 : THREE.MathUtils.clamp((w.sunElevDeg + sunAngularDeg / 2) / sunAngularDeg, 0, 1);
    const mu = Math.max(0, Math.sin(w.sunElevDeg * DEG));
    const tr = mars ? marsTransmission(planet.dustTau, Math.max(mu, 0.02)) : { direct: 1, diffuse: 0 };
    const flux = body.orbit.aAU > 0 ? 1 / (body.orbit.aAU * body.orbit.aAU) : 1;
    const beam = rise * Math.pow(flux, 0.3) * (mars ? tr.direct : 1);

    skyDir(w.sunAzDeg, Math.max(w.sunElevDeg, -5), dir);
    if (sun.current) {
      sun.current.intensity = 3.4 * beam;
      sun.current.position.copy(target).addScaledVector(dir, 60);
      sun.current.target.position.copy(target);
      sun.current.target.updateMatrixWorld();
    }
    if (disk.current) {
      disk.current.visible = up && (!mars || planet.dustTau < 6);
      disk.current.position.copy(target).addScaledVector(dir, SKY_DISTANCE);
    }

    const albedo = (site.regolith ?? body.regolith).albedo;
    if (hemi.current) {
      // Fill: ground bounce everywhere; plus the dusty sky on Mars. A trace at night so shapes stay readable.
      const bounce = 3.4 * beam * mu * albedo;
      const skylight = mars ? rise * Math.pow(flux, 0.3) * 3 * (1 - tr.direct) * 0.7 * Math.exp(-0.3 * planet.dustTau) * Math.max(mu, 0.15) : 0;
      hemi.current.intensity = 0.04 + bounce + skylight;
      if (mars) hemi.current.color.setRGB(0.95, 0.72, 0.52);
    }

    if (mars) {
      // Sky: butterscotch by day, going dark and bluish around the Sun at dusk.
      const day = THREE.MathUtils.smoothstep(w.sunElevDeg, -8, 10);
      skyDay.setRGB(0.62, 0.43, 0.3).lerp(new THREE.Color(0.33, 0.37, 0.45), (1 - THREE.MathUtils.smoothstep(w.sunElevDeg, 0, 18)) * 0.5);
      bg.current?.copy(new THREE.Color(0.01, 0.01, 0.015).lerp(skyDay, day * Math.min(1, 0.4 + 0.12 * planet.dustTau + 0.5)));
      if (fog.current) {
        fog.current.color.copy(bg.current ?? skyDay);
        // Extinction ~ tau / scale height, a few km of visibility in a global storm.
        fog.current.density = (0.25 * planet.dustTau) / 11_000;
      }
    } else bg.current?.setRGB(0, 0, 0);

    if (stars.current) {
      stars.current.visible = !up || w.sunElevDeg < 0 || site.shadowed !== undefined;
      stars.current.position.copy(target);
    }
    // Earthshine: at lunar night on the near side, Earth is near full and ~50x brighter than a full Moon.
    if (earthshine.current && earth) {
      const night = 1 - THREE.MathUtils.smoothstep(w.sunElevDeg, -2, 2);
      earthshine.current.intensity = 0.25 * night * THREE.MathUtils.smoothstep(earth.elDeg, -1, 5);
      earthshine.current.position.copy(target).addScaledVector(skyDir(earth.azDeg, earth.elDeg), 60);
      earthshine.current.target.position.copy(target);
      earthshine.current.target.updateMatrixWorld();
    }
  });

  return (
    <>
      <color ref={bg} attach="background" args={["#000000"]} />
      {mars && <fogExp2 ref={fog} attach="fog" args={["#9e6b48", 0.00003]} />}
      <directionalLight
        ref={sun}
        color={planet.body === "mercury" ? "#fffaf0" : "#fff6e8"}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-camera-near={1}
        shadow-camera-far={150}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <hemisphereLight ref={hemi} args={[mars ? "#f2b98a" : "#20242c", mars ? "#5a3a26" : "#6b6660", 0.05]} />
      <mesh ref={disk} userData={{ noShadow: true }} renderOrder={-1}>
        <sphereGeometry args={[SKY_DISTANCE * Math.tan((sunAngularDeg / 2) * DEG) * 1.15, 32, 16]} />
        <meshBasicMaterial color={mars ? "#fff4e0" : "#ffffff"} toneMapped={false} fog={false} />
      </mesh>
      {earth && <Earth dir={skyDir(earth.azDeg, earth.elDeg)} />}
      {earth && <directionalLight ref={earthshine} color="#9fb8ff" intensity={0} />}
      <StarField ref={stars} />
    </>
  );
}

/**
 * Stars: fixed-size points on a sphere (built-in material, so it works with the
 * logarithmic depth buffer), magnitudes skewed so a few are bright and most faint.
 */
const StarField = forwardRef<THREE.Points>(function StarField(_, ref) {
  const geometry = useMemo(() => {
    const n = 5000;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    let seed = 42;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const z = rnd() * 2 - 1;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      const R = SKY_DISTANCE * 1.1;
      pos.set([R * r * Math.cos(a), R * z, R * r * Math.sin(a)], i * 3);
      const b = 0.25 + 0.75 * rnd() ** 6;
      const warm = rnd();
      col.set([b * (0.9 + 0.1 * warm), b * 0.95, b * (1.05 - 0.15 * warm)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g;
  }, []);
  return (
    <points ref={ref} geometry={geometry} userData={{ noShadow: true }} frustumCulled={false}>
      <pointsMaterial size={1.6} sizeAttenuation={false} vertexColors fog={false} toneMapped={false} />
    </points>
  );
});

/** Earth from the Moon: 1.9° across, blue with white cloud bands, phase from the real Sun direction. */
function Earth({ dir }: { dir: THREE.Vector3 }) {
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3 } | null;
  const ref = useRef<THREE.Mesh>(null);
  const texture = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 128;
    const g = c.getContext("2d")!;
    g.fillStyle = "#1d4f8f";
    g.fillRect(0, 0, 256, 128);
    // Continents and clouds, loosely: the point is colour and banding, not a map.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    g.fillStyle = "#5d6b3c";
    for (let i = 0; i < 14; i++) {
      g.beginPath();
      g.ellipse(rnd() * 256, 20 + rnd() * 88, 10 + rnd() * 30, 6 + rnd() * 16, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "rgba(255,255,255,0.75)";
    for (let i = 0; i < 40; i++) {
      g.beginPath();
      g.ellipse(rnd() * 256, rnd() * 128, 8 + rnd() * 26, 2 + rnd() * 5, rnd() * 0.4, 0, Math.PI * 2);
      g.fill();
    }
    g.fillRect(0, 0, 256, 9);
    g.fillRect(0, 119, 256, 9);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useFrame(() => {
    if (ref.current) ref.current.position.copy(controls?.target ?? new THREE.Vector3()).addScaledVector(dir, SKY_DISTANCE * 0.9);
  });
  return (
    <mesh ref={ref} userData={{ noShadow: true }}>
      <sphereGeometry args={[SKY_DISTANCE * 0.9 * Math.tan(0.95 * DEG), 48, 24]} />
      <meshStandardMaterial map={texture} roughness={0.9} metalness={0} fog={false} />
    </mesh>
  );
}
