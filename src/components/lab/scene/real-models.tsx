"use client";

/**
 * Real 3D models of the vehicles, baked by tools/bake_models.py from NASA's
 * 3D resources and CC-BY Sketchfab models (sources, licenses and scale
 * checks: docs/models.md, tools/models.json).
 *
 * Every GLB is in metres at its published size, in the lab frame: x forward
 * (or up the stack for rockets lying on their side in the source), y up,
 * z to the right, origin on the ground under the vehicle. Moving parts sit
 * under empties at their real pivots (`rocker_L`, `wheel_R2`, `flap_fwd_L`,
 * `leg_3`...), whose rest positions are also in models.gen.json so the
 * kinematics can be solved without touching the scene graph.
 *
 * A vehicle whose model hasn't been baked (e.g. a Sketchfab source without
 * an API token on this machine) keeps its procedural stand-in; `hasModel`
 * tells the views which to draw.
 */
import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import type { Mechanics as VehicleMechanics } from "@/sim/vehicles/types";
import META from "./models.gen.json";

export interface ModelMeta {
  file: string;
  /** Length (x), height (y), width (z) [m]. */
  sizeM: [number, number, number];
  /** Rest pivot of every rig node, lab frame [m]. */
  pivots: Record<string, [number, number, number]>;
  /** Size of each rig node's own meshes (x, y, z) [m]. */
  parts?: Record<string, [number, number, number]>;
  tris: number;
  mb: number;
  title: string;
  credit: string;
  license: string;
  page: string;
  scaleRef: string;
  checks?: { what: string; modelM: number; publishedM: number; ref: string }[];
}

const MODELS = META as unknown as Record<string, ModelMeta>;

export const modelMeta = (id: string | null): ModelMeta | null => (id && MODELS[id]) || null;
export const hasModel = (id: string | null) => modelMeta(id) !== null;

/** Which baked model draws a vehicle (null: no real model for it). */
export function modelIdFor(m: VehicleMechanics): string | null {
  // Humanoids already use Unitree's own meshes (HumanoidView); the sealed probe is a made-up box by design.
  const id =
    m.kind === "rover"
      ? m.model
      : m.kind === "spacecraft"
        ? ({ starship: "starship", falcon9: "falcon9", newglenn: "newglenn", lm: "apollo-lm" } as const)[m.model]
        : m.kind === "wheeled"
          ? m.model
          : m.kind === "static" && m.shape === "lander"
            ? "venera"
            : null;
  return id && MODELS[id] ? id : null;
}

export interface RealModel {
  /** A private clone of the model (share geometry, own materials). */
  scene: THREE.Group;
  /** Rig empties by name. */
  nodes: Record<string, THREE.Object3D>;
  /** Every material in the clone (for heat glow and charring). */
  materials: THREE.MeshStandardMaterial[];
  meta: ModelMeta;
}

/** Load (suspends) and clone a baked model. Materials are cloned so per-vehicle effects don't leak. */
export function useRealModel(id: string): RealModel {
  const meta = MODELS[id];
  const gltf = useGLTF(meta.file);
  return useMemo(() => {
    const scene = gltf.scene.clone(true);
    const nodes: Record<string, THREE.Object3D> = {};
    const materials: THREE.MeshStandardMaterial[] = [];
    const seen = new Map<THREE.Material, THREE.Material>();
    scene.traverse((o) => {
      nodes[o.name] = o;
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const swap = (m: THREE.Material) => {
        let c = seen.get(m);
        if (!c) {
          c = m.clone();
          seen.set(m, c);
          if ((c as THREE.MeshStandardMaterial).isMeshStandardMaterial) materials.push(c as THREE.MeshStandardMaterial);
        }
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
    return { scene, nodes, materials, meta };
  }, [gltf, meta]);
}

/** Emissive heat glow on a set of materials (colour already scaled by intensity). */
export function setGlow(materials: THREE.MeshStandardMaterial[], c: THREE.Color) {
  for (const m of materials) {
    m.emissive.copy(c);
    m.emissiveIntensity = 1;
  }
}
