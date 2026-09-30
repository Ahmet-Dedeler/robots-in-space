"use client";

/**
 * Visual damage driven by the thermal model, so the 3D view shows what the
 * numbers say:
 *
 * - Polymer covers: soften past their service limit (colour shifts, surface
 *   turns glossy as it goes molten), then pyrolyse past the melt/decompose
 *   point (no oxygen on Venus, so they char instead of burning) and slump.
 * - Metals: no melting at 460 °C; titanium picks up a faint temper tint.
 * - Incandescence: nothing glows below the Draper point (~525 °C / 798 K).
 *   Venus air is 462 °C, so only things hotter than the air (a battery in
 *   thermal runaway) visibly glow.
 *
 * Everything is a pure function of temperatures at the current experiment
 * time, so scrubbing backwards "undoes" damage consistently.
 */
import * as THREE from "three";
import { MATERIALS, type Material } from "@/sim/materials/materials";
import type { VehicleBuild } from "@/sim/vehicles/types";

const DRAPER_K = 798;

/** Approximate blackbody colour for a temperature (Tanner Helland fit), linear RGB. */
function kelvinToRgb(k: number): THREE.Color {
  const t = k / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v: number) => Math.min(1, Math.max(0, v / 255));
  return new THREE.Color().setRGB(c(r), c(g), c(b), THREE.SRGBColorSpace);
}

/** Visible thermal glow (emissive colour x intensity). Zero below the Draper point. */
export function incandescence(tempK: number): THREE.Color {
  if (tempK <= DRAPER_K) return new THREE.Color(0, 0, 0);
  // Radiance grows ~T^4 but the eye sees the first glow as very dim deep red.
  const f = Math.min(1, ((tempK - DRAPER_K) / 700) ** 2);
  return kelvinToRgb(Math.min(tempK, 3000)).multiplyScalar(1.6 * f);
}

export interface ShellDamage {
  /** 0..1 softening (service limit -> melt). */
  soft: number;
  /** 0..1 molten fraction. */
  melt: number;
  /** 0..1 charring (pyrolysis). */
  char: number;
  /** Downward slump of the cover surface [m]. */
  sag: number;
  /** 0..1 how actively material is dripping right now. */
  drip: number;
  /** 0..1 pyrolysis fume rate. */
  fume: number;
  /** Heat tint colour and strength (metals). */
  tint: THREE.Color;
  tintAmount: number;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function shellDamage(skin: Material, tempK: number): ShellDamage {
  const d: ShellDamage = { soft: 0, melt: 0, char: 0, sag: 0, drip: 0, fume: 0, tint: new THREE.Color("#c9a45c"), tintAmount: 0 };
  if (skin.kind === "polymer" || skin.kind === "composite") {
    const service = skin.maxServiceK ?? 373;
    const melt = skin.meltK ?? 500;
    const decompose = skin.decomposeK ?? melt + 120;
    d.soft = smooth(service, skin.thermoset ? decompose : melt, tempK);
    // Thermosets never flow: they go straight from soft to charred.
    d.melt = skin.thermoset ? 0 : smooth(melt - 30, melt + 40, tempK);
    // Pyrolysis (charring) from the decomposition onset over ~100 K.
    d.char = smooth(decompose, decompose + 100, tempK);
    d.sag = 0.012 * d.soft + 0.05 * d.melt;
    // Drips while molten, until the melt has charred solid.
    d.drip = d.melt * (1 - d.char * 0.9);
    // Some outgassing while molten, heavy fumes during pyrolysis, tapering once charred through.
    d.fume = 0.25 * d.melt + 0.75 * smooth(decompose - 30, decompose + 30, tempK) * (1 - 0.7 * smooth(decompose + 100, decompose + 200, tempK));
  } else if (skin.kind === "metal" && skin.id === "ti64") {
    // Temper colours: straw -> bronze from ~300 °C in an oxidizing gas. CO2 is weakly oxidizing.
    d.tintAmount = 0.35 * smooth(570, 740, tempK);
  }
  return d;
}

export interface DamageUniforms {
  uSoft: { value: number };
  uMelt: { value: number };
  uChar: { value: number };
  uSag: { value: number };
  uTint: { value: THREE.Color };
  uTintAmount: { value: number };
  uGlow: { value: THREE.Color };
  /** World position of the hot source (battery pack). */
  uGlowCenter: { value: THREE.Vector3 };
}

export function createDamageUniforms(): DamageUniforms {
  return {
    uSoft: { value: 0 },
    uMelt: { value: 0 },
    uChar: { value: 0 },
    uSag: { value: 0 },
    uTint: { value: new THREE.Color("#c9a45c") },
    uTintAmount: { value: 0 },
    uGlow: { value: new THREE.Color(0, 0, 0) },
    uGlowCenter: { value: new THREE.Vector3() },
  };
}

/**
 * MeshStandardMaterial with damage uniforms spliced in:
 * - vertex: world-space slump (sag), never below the ground plane
 * - fragment: soften/char colour, molten gloss, heat tint, incandescent glow
 * `glow` = false for parts that should not show internal (battery) heat.
 */
export function createDamageMaterial(
  base: THREE.MeshStandardMaterialParameters,
  uniforms: DamageUniforms,
  opts: { shell: boolean; glow: boolean },
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial(base);
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uIsShell: { value: opts.shell ? 1 : 0 }, uGlowOn: { value: opts.glow ? 1 : 0 } });
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uSag;
        uniform float uIsShell;
        varying vec3 vDmgLocal;
        varying vec3 vDmgWorld;
        float dmgHash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float dmgNoise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(dmgHash(i), dmgHash(i + vec3(1, 0, 0)), f.x), mix(dmgHash(i + vec3(0, 1, 0)), dmgHash(i + vec3(1, 1, 0)), f.x), f.y),
            mix(mix(dmgHash(i + vec3(0, 0, 1)), dmgHash(i + vec3(1, 0, 1)), f.x), mix(dmgHash(i + vec3(0, 1, 1)), dmgHash(i + vec3(1, 1, 1)), f.x), f.y),
            f.z);
        }
        // Organic patches in the part's own frame, so damage sticks to the body as it moves.
        float dmgBlot(vec3 p) {
          return 0.6 * dmgNoise(p * 11.0) + 0.3 * dmgNoise(p * 31.0) + 0.1 * dmgNoise(p * 90.0);
        }`,
      )
      .replace(
        "#include <project_vertex>",
        `vDmgLocal = transformed;
        vec4 dmgWorld = modelMatrix * vec4(transformed, 1.0);
        float dmgN = dmgBlot(transformed * 0.7);
        dmgWorld.y = max(dmgWorld.y - uIsShell * uSag * (0.3 + 0.9 * dmgN), 0.004);
        vDmgWorld = dmgWorld.xyz;
        vec4 mvPosition = viewMatrix * dmgWorld;
        gl_Position = projectionMatrix * mvPosition;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uSoft;
        uniform float uMelt;
        uniform float uChar;
        uniform float uIsShell;
        uniform float uGlowOn;
        uniform vec3 uTint;
        uniform float uTintAmount;
        uniform vec3 uGlow;
        uniform vec3 uGlowCenter;
        varying vec3 vDmgLocal;
        varying vec3 vDmgWorld;
        float dmgHash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float dmgNoise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(dmgHash(i), dmgHash(i + vec3(1, 0, 0)), f.x), mix(dmgHash(i + vec3(0, 1, 0)), dmgHash(i + vec3(1, 1, 0)), f.x), f.y),
            mix(mix(dmgHash(i + vec3(0, 0, 1)), dmgHash(i + vec3(1, 0, 1)), f.x), mix(dmgHash(i + vec3(0, 1, 1)), dmgHash(i + vec3(1, 1, 1)), f.x), f.y),
            f.z);
        }
        // Organic patches in the part's own frame, so damage sticks to the body as it moves.
        float dmgBlot(vec3 p) {
          return 0.6 * dmgNoise(p * 11.0) + 0.3 * dmgNoise(p * 31.0) + 0.1 * dmgNoise(p * 90.0);
        }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        if (uIsShell > 0.5) {
          float n = dmgBlot(vDmgLocal);
          // Softening: plastics yellow, then brown where they start to cook.
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.95, 0.8, 0.55), uSoft * (0.45 + 0.35 * n));
          // Pyrolysis front: patches char first where the noise is low, then spread.
          float front = uChar * 1.3 - 0.15;
          float c = smoothstep(n - 0.12, n + 0.12, front);
          float scorch = smoothstep(n - 0.35, n, front) * (1.0 - c);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.19, 0.08), scorch * 0.8);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.035, 0.028, 0.024) * (0.8 + 0.4 * n), c);
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uTint * 1.4, uTintAmount);`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        if (uIsShell > 0.5) {
          // Molten plastic is glossy; char is dead matte.
          roughnessFactor = mix(roughnessFactor, 0.18, uMelt * (1.0 - uChar));
          roughnessFactor = mix(roughnessFactor, 0.97, smoothstep(0.2, 0.9, uChar));
        }`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        // Heat shows through cracks in the charred shell near the pack, fading with distance.
        float near = smoothstep(0.3, 0.06, distance(vDmgWorld, uGlowCenter));
        float crack = smoothstep(0.55, 0.75, dmgBlot(vDmgLocal * 1.7));
        totalEmissiveRadiance += uGlow * uGlowOn * near * (0.15 + 0.85 * crack);`,
      );
  };
  // Separate program per variant flag combination.
  mat.customProgramCacheKey = () => `dmg-${opts.shell ? 1 : 0}-${opts.glow ? 1 : 0}`;
  return mat;
}

export function applyShellDamage(u: DamageUniforms, d: ShellDamage) {
  u.uSoft.value = d.soft;
  u.uMelt.value = d.melt;
  u.uChar.value = d.char;
  u.uSag.value = d.sag;
  u.uTint.value.copy(d.tint);
  u.uTintAmount.value = d.tintAmount;
}

export const skinMaterialOf = (b: VehicleBuild) => MATERIALS[b.skin.material];
