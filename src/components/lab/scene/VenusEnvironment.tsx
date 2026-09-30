"use client";

/**
 * Venus optics, from physics rather than taste:
 *
 * - Extinction: Rayleigh scattering by CO2, beta = N * sigma(lambda), with
 *   sigma(532 nm) = 1.24e-30 m^2 (Sneep & Ubachs 2005) scaled by lambda^-4.
 *   At the surface (N ~ 8.9e26 m^-3) beta(550 nm) ~ 1e-3 m^-1: green light
 *   fades over ~1 km, blue much faster, red slower, so distant ground turns
 *   reddish before vanishing. Below ~30 km there is almost no aerosol
 *   (Moroz 2002), so this dominates visibility at the surface.
 * - Cloud deck (48-70 km): H2SO4 droplets add grey Mie extinction of
 *   ~1-3 km^-1 (Pioneer Venus LCPS, Knollenberg & Hunten 1980; approx.).
 * - Light: the direct solar beam is gone after an optical depth of ~20+,
 *   so the surface is lit only by diffuse light from the whole sky:
 *   3-3.5 klux measured by Venera 13/14 (a dim overcast day), strongly
 *   depleted in blue. No hard shadows; ambient occlusion does the shading.
 */
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { useLab } from "@/lib/lab-store";
import { atmosphere } from "@/sim/env/atmosphere";
import { stateAt } from "@/sim/mission/run";

// Spectral fog: exp(-beta_rgb * d) per channel instead of three's grey fog.
// beta_rgb = fogDensity * (lambda/550nm)^-4 for R=650, G=550, B=450 nm.
THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    vec3 fogTransmit = exp(-fogDensity * vFogDepth * vec3(0.513, 1.0, 2.23));
    gl_FragColor.rgb = mix(fogColor, gl_FragColor.rgb, fogTransmit);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
  #endif
#endif`;

const SIGMA_550 = 1.24e-30 * (532 / 550) ** 4; // m^2 per CO2 molecule
const AVOGADRO = 6.02214076e23;
const M_CO2 = 0.04401;

/** Extinction at 550 nm [1/m]: Rayleigh + approximate cloud/haze Mie. */
export function extinction550(altitudeM: number): number {
  const rho = atmosphere(altitudeM).densityKgM3;
  const rayleigh = (rho / M_CO2) * AVOGADRO * SIGMA_550;
  const km = altitudeM / 1000;
  let mie = 0;
  if (km > 31 && km <= 48) mie = 0.0002; // lower haze
  else if (km > 48 && km <= 51) mie = 0.003; // lower cloud (largest droplets)
  else if (km > 51 && km <= 57) mie = 0.0012; // middle cloud
  else if (km > 57 && km <= 70) mie = 0.0015; // upper cloud
  return rayleigh + mie;
}

/** Colour of the scattered light (airlight / sky) with altitude. */
function airlight(km: number): THREE.Color {
  const surface = new THREE.Color().setRGB(0.5, 0.27, 0.1); // deep orange: blue removed on the way down
  const cloud = new THREE.Color().setRGB(0.95, 0.85, 0.62); // bright pale yellow inside the H2SO4 deck
  const above = new THREE.Color().setRGB(0.85, 0.83, 0.78);
  if (km < 48) return surface.clone().lerp(cloud, (km / 48) ** 2);
  if (km < 70) return cloud;
  return cloud.clone().lerp(above, Math.min(1, (km - 70) / 20));
}

/** Diffuse illuminance relative to the surface (~3.5 klux at the ground, much brighter up high). */
function lightLevel(km: number): number {
  const solar = atmosphere(km * 1000).solarSubsolarWm2;
  return Math.pow(solar / 120, 0.45);
}

export function VenusEnvironment() {
  const fogRef = useRef<THREE.FogExp2>(null);
  const bgRef = useRef<THREE.Color>(null);
  const sky = useRef<THREE.HemisphereLight>(null);
  const fill = useRef<THREE.DirectionalLight>(null);

  useFrame(() => {
    const { result, playback } = useLab.getState();
    const st = stateAt(result, playback.t);
    const km = st.altitudeM / 1000;
    const fog = fogRef.current;
    if (fog) {
      fog.color.lerp(airlight(km), 0.2);
      fog.density += (extinction550(st.altitudeM) - fog.density) * 0.2;
      bgRef.current?.copy(fog.color);
    }
    const L = lightLevel(km);
    if (sky.current) sky.current.intensity = 1.05 * L;
    if (fill.current) fill.current.intensity = 1.1 * L;
  });

  return (
    <>
      <fogExp2 ref={fogRef} attach="fog" args={["#9e5c26", 0.001]} />
      <color ref={bgRef} attach="background" args={["#9e5c26"]} />
      {/* Sky dome light: warm orange from above, dark basalt-bounced light from below (albedo ~0.1). */}
      <hemisphereLight ref={sky} args={["#ffab5e", "#1c120b", 1.05]} />
      {/* The brighter part of the overcast sky, toward the hidden Sun: very soft, no hard shadows. */}
      <directionalLight ref={fill} position={[20, 80, 15]} color="#ffb870" intensity={1.1} />
    </>
  );
}
