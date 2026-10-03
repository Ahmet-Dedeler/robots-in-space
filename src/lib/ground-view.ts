"use client";

/**
 * View-only state for reading the ground: the hazard-map overlay toggle and
 * the last fall the 3D view diagnosed. Kept out of the lab store because none
 * of it is part of an experiment (not saved in share links, never re-runs).
 */
import { create } from "zustand";
import type { FallCause } from "@/sim/robots/trip";

interface GroundView {
  /** Colour the ground by obstacle height and slope instead of albedo. */
  hazards: boolean;
  setHazards: (on: boolean) => void;
  /** Most recent fall in the live MuJoCo view (cleared on reset). */
  fall: FallCause | null;
  setFall: (f: FallCause | null) => void;
}

export const useGroundView = create<GroundView>((set) => ({
  hazards: false,
  setHazards: (hazards) => set({ hazards }),
  fall: null,
  setFall: (fall) => set({ fall }),
}));
