"use client";

import { useMemo } from "react";
import { useLab } from "@/lib/lab-store";
import { terrain, type Terrain } from "@/sim/terrain/terrain";

/** The terrain for the current scenario (same seed as physics, so visuals match collisions). */
export function useTerrain(): Terrain {
  const ground = useLab((s) => s.config.scenario.ground);
  return useMemo(() => terrain(ground), [ground]);
}
