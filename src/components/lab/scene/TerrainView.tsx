"use client";

/**
 * Renders the Venus ground from the same deterministic height function the
 * MuJoCo heightfield uses, so what you see is what the feet hit.
 *
 * Three nested levels of detail:
 * - near  (±7 m,  2.5 cm): identical sampling to the physics heightfield
 * - mid   (±45 m, 15 cm):  plates still resolved, fades into the haze
 * - far   (±9 km, 60 m):   regional swells to the horizon (visibility ~3-4 km)
 * Each coarser level is pushed a few cm down where a finer one covers it.
 *
 * Colours are albedo-level (basalt is dark, ~0.1-0.2 reflectance); the orange
 * look comes from the light, as in the Venera 13/14 colour panoramas.
 *
 * Hazard map (toggle in the viewport): the same meshes, unlit, coloured by
 * obstacle height above the soil and by slope (survey.ts bands), over a
 * hillshade and a 1 m grid. It's how a rover team reads a site, and it works
 * in the dark (shadowed crater floors) and under Venus's flat orange light,
 * where 3-5 cm plate edges are nearly invisible.
 */
import { useMemo } from "react";
import * as THREE from "three";
import { useGroundView } from "@/lib/ground-view";
import { hazardClass } from "@/sim/terrain/survey";
import type { Terrain } from "@/sim/terrain/terrain";

/** Hazard colours (linear RGB) for classes 1-3; class 0 stays grey. Matches the legend in the viewport. */
export const HAZARD_RGB: [number, number, number][] = [
  [0, 0, 0],
  [0.95, 0.72, 0.05],
  [0.98, 0.32, 0.02],
  [0.85, 0.02, 0.03],
];
/** Hillshade light: from the north-west, 45° up (cartographic convention). In three coords (z south). */
const SHADE_DIR = new THREE.Vector3(-1, Math.SQRT2, -1).normalize();

interface Level {
  half: number;
  step: number;
  /** Half-size of the finer level to hide under (0 = none). */
  hole: number;
  detail: boolean;
}

interface LevelMeshes {
  natural: THREE.BufferGeometry;
  hazard: THREE.BufferGeometry;
}

function buildLevel(t: Terrain, { half, step, hole, detail }: Level): LevelMeshes {
  const n = Math.round((2 * half) / step) + 1;
  const pos = new Float32Array(n * n * 3);
  const col = new Float32Array(n * n * 3);
  // Obstacle height above the soil and the soil height itself, for the hazard map.
  const relief = new Float32Array(n * n);
  const soil = new Float32Array(n * n);
  // World-space UVs (1 unit = 1 m) for the cm-scale detail texture.
  const uv = new Float32Array(n * n * 2);
  const s = t.style;
  for (let r = 0; r < n; r++) {
    const y = -half + r * step;
    for (let c = 0; c < n; c++) {
      const x = -half + c * step;
      const i = r * n + c;
      let h: number;
      let rgb: readonly [number, number, number];
      let k = 1;
      if (detail) {
        const smp = t.sample(x, y);
        h = smp.h;
        relief[i] = Math.max(0, smp.h - smp.ground);
        soil[i] = smp.ground;
        if (smp.kind === 0) {
          rgb = s.sedimentColor;
          k = 0.8 + 0.4 * smp.shade;
        } else {
          rgb = s.rockColor;
          // Per-plate tone, lighter weathered rims, dark shadowed cracks.
          k = 0.6 + 0.8 * smp.shade;
          if (smp.kind === 1) k *= smp.edge < s.crackWidth / 2 + 0.02 ? 1.18 : 1;
        }
        if (smp.kind === 0 && smp.edge < s.crackWidth / 2 + 0.004) k *= 0.6;
      } else {
        // Horizon: regional relief plus the craters big enough to show at this spacing.
        h = t.farHeight(x, y, 2 * step);
        soil[i] = h;
        rgb = [(s.rockColor[0] + s.sedimentColor[0]) / 2, (s.rockColor[1] + s.sedimentColor[1]) / 2, (s.rockColor[2] + s.sedimentColor[2]) / 2];
        k = 0.85 + 0.3 * (Math.sin(x * 0.013) * Math.sin(y * 0.017) * 0.5 + 0.5);
      }
      if (hole > 0 && Math.abs(x) < hole && Math.abs(y) < hole) h -= detail ? 0.04 : 1.5;
      // MuJoCo (x east, y north, z up) -> three (x, y up, -z north).
      pos[i * 3] = x;
      pos[i * 3 + 1] = h;
      pos[i * 3 + 2] = -y;
      uv[i * 2] = x;
      uv[i * 2 + 1] = y;
      col[i * 3] = rgb[0] * k;
      col[i * 3 + 1] = rgb[1] * k;
      col[i * 3 + 2] = rgb[2] * k;
    }
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let o = 0;
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const a = r * n + c;
      const b = a + 1;
      const d = a + n;
      const e = d + 1;
      // Counter-clockwise seen from above (z is flipped from MuJoCo's y), so normals point up.
      idx[o++] = a;
      idx[o++] = b;
      idx[o++] = d;
      idx[o++] = b;
      idx[o++] = e;
      idx[o++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();

  // Hazard colours: hillshade grey, tinted by hazard class, with a 1 m grid near the robot (10 m further out).
  const hz = new Float32Array(n * n * 3);
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  const k = Math.max(1, Math.round(0.25 / step)); // slope baseline ~0.5 m
  const grid = step < 0.1 ? 1 : 10;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      const shade = Math.max(0, nrm.getX(i) * SHADE_DIR.x + nrm.getY(i) * SHADE_DIR.y + nrm.getZ(i) * SHADE_DIR.z);
      let rgb = [0.1 + 0.45 * shade, 0.1 + 0.45 * shade, 0.11 + 0.45 * shade];
      if (detail) {
        const c0 = Math.max(0, c - k);
        const c1 = Math.min(n - 1, c + k);
        const r0 = Math.max(0, r - k);
        const r1 = Math.min(n - 1, r + k);
        const gx = (soil[r * n + c1] - soil[r * n + c0]) / ((c1 - c0) * step);
        const gy = (soil[r1 * n + c] - soil[r0 * n + c]) / ((r1 - r0) * step);
        const cls = hazardClass(relief[i], (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI);
        if (cls > 0) {
          const tint = HAZARD_RGB[cls];
          const lit = 0.55 + 0.6 * shade;
          rgb = [tint[0] * lit, tint[1] * lit, tint[2] * lit];
        }
      }
      // Grid lines: one vertex wide where a coordinate crosses a whole metre (or 10 m).
      const x = -half + c * step;
      const y = -half + r * step;
      const onLine = (v: number) => Math.abs(v / grid - Math.round(v / grid)) * grid < step * 0.5;
      if (step <= 0.2 && (onLine(x) || onLine(y))) rgb = rgb.map((v) => v * 0.55 + 0.12);
      hz[i * 3] = rgb[0];
      hz[i * 3 + 1] = rgb[1];
      hz[i * 3 + 2] = rgb[2];
    }
  }
  const hazard = new THREE.BufferGeometry();
  hazard.setAttribute("position", g.attributes.position);
  hazard.setAttribute("normal", g.attributes.normal);
  hazard.setAttribute("color", new THREE.BufferAttribute(hz, 3));
  hazard.setIndex(g.index);
  hazard.boundingSphere = g.boundingSphere;
  return { natural: g, hazard };
}

/**
 * Tileable cm-scale albedo variation (grains, vesicles, weathering stains),
 * multiplied into the per-vertex colour. 1 texture repeat = 0.5 m.
 */
function detailTexture(): THREE.DataTexture {
  const n = 256;
  const data = new Uint8Array(n * n * 4);
  let seed = 99;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Sum of a few tileable value-noise octaves.
  const oct = [8, 16, 32, 64, 128].map((f) => {
    const g = Array.from({ length: f * f }, rnd);
    return { f, g };
  });
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let v = 0;
      let amp = 0.5;
      for (const { f, g } of oct) {
        const fx = (x / n) * f;
        const fy = (y / n) * f;
        const x0 = Math.floor(fx) % f;
        const y0 = Math.floor(fy) % f;
        const x1 = (x0 + 1) % f;
        const y1 = (y0 + 1) % f;
        const tx = fx - Math.floor(fx);
        const ty = fy - Math.floor(fy);
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const a = g[y0 * f + x0] + (g[y0 * f + x1] - g[y0 * f + x0]) * sx;
        const b = g[y1 * f + x0] + (g[y1 * f + x1] - g[y1 * f + x0]) * sx;
        v += amp * (a + (b - a) * sy);
        amp *= 0.55;
      }
      // Occasional dark vesicles / pits.
      const pit = rnd() < 0.004 ? 0.45 : 1;
      const k = Math.max(0, Math.min(255, (0.55 + 0.9 * (v - 0.45)) * pit * 255));
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = k;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, n, n);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function TerrainView({ terrain }: { terrain: Terrain }) {
  const levels = useMemo(
    () => [
      buildLevel(terrain, { half: 7, step: 0.025, hole: 0, detail: true }),
      buildLevel(terrain, { half: 45, step: 0.15, hole: 6.9, detail: true }),
      buildLevel(terrain, { half: 9000, step: 60, hole: 44, detail: false }),
    ],
    [terrain],
  );
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, map: detailTexture() }),
    [],
  );
  // Unlit so the map reads the same in a shadowed crater, at lunar noon and under Venus's orange overcast.
  const hazardMaterial = useMemo(() => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), []);
  const hazards = useGroundView((s) => s.hazards);
  return (
    <group>
      {levels.map((l, i) => (
        <mesh key={i} geometry={hazards ? l.hazard : l.natural} material={hazards ? hazardMaterial : material} receiveShadow={i === 0 && !hazards} />
      ))}
    </group>
  );
}
