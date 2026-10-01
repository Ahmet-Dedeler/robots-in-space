"use client";

/**
 * Reading the ground in the viewport:
 * - TripMarker (inside the canvas): a pulsing ring on the rock or spot where
 *   the robot went down, from the fall diagnosis in robots/trip.ts.
 * - GroundHud (DOM): the hazard-map toggle, its legend, and the "why it
 *   fell" card.
 */
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { useGroundView } from "@/lib/ground-view";
import { cn } from "@/lib/utils";
import { SLOPE_BANDS, STEP_BANDS } from "@/sim/terrain/survey";
import { HAZARD_RGB } from "./TerrainView";
import { useTerrain } from "./useScene";

export function TripMarker() {
  const fall = useGroundView((s) => s.fall);
  const terrain = useTerrain();
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const m = ring.current;
    if (!m) return;
    const k = 1 + 0.25 * Math.sin(clock.elapsedTime * 4);
    m.scale.set(k, k, k);
  });
  if (!fall) return null;
  // Terrain coords (x east, y north, z up) -> three (x, y up, -z north). Sit on the obstacle's top.
  const h = terrain.height(fall.x, fall.y) + 0.01;
  const color = fall.kind === "obstacle" ? "#ff3b30" : fall.kind === "slope" ? "#ff9f0a" : "#64d2ff";
  return (
    <group position={[fall.x, h, -fall.y]}>
      <mesh ref={ring} rotation-x={-Math.PI / 2} renderOrder={10}>
        <ringGeometry args={[0.13, 0.17, 48]} />
        <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.9} depthTest={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.45, 0]} renderOrder={10}>
        <cylinderGeometry args={[0.004, 0.004, 0.9, 6]} />
        <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.6} depthTest={false} />
      </mesh>
    </group>
  );
}

const css = (rgb: [number, number, number]) => `rgb(${rgb.map((v) => Math.round(255 * Math.pow(v, 1 / 2.2))).join(",")})`;
const cm = (m: number) => `${Math.round(m * 100)}`;

export function GroundHud({ humanoid }: { humanoid: boolean }) {
  const hazards = useGroundView((s) => s.hazards);
  const setHazards = useGroundView((s) => s.setHazards);
  const fall = useGroundView((s) => s.fall);
  const legend = [
    { c: HAZARD_RGB[1], label: `${cm(STEP_BANDS[0])}-${cm(STEP_BANDS[1])} cm step · ${SLOPE_BANDS[0]}-${SLOPE_BANDS[1]}° slope`, sub: "catches a toe" },
    { c: HAZARD_RGB[2], label: `${cm(STEP_BANDS[1])}-${cm(STEP_BANDS[2])} cm · >${SLOPE_BANDS[1]}°`, sub: "obstacle for feet and small wheels" },
    { c: HAZARD_RGB[3], label: `>${cm(STEP_BANDS[2])} cm`, sub: "blocks a rover's belly" },
  ] as const;
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 flex max-w-[min(26rem,calc(100%-1.5rem))] flex-col items-start gap-1.5">
      {humanoid && fall && (
        <div
          className={cn(
            "pointer-events-auto rounded-lg border px-3 py-2 text-xs backdrop-blur-md",
            fall.kind === "obstacle" ? "border-red-400/30 bg-red-950/55" : fall.kind === "slope" ? "border-amber-400/30 bg-amber-950/55" : "border-sky-400/30 bg-sky-950/55",
          )}
        >
          <div className="text-[10px] tracking-wide text-stone-300/80 uppercase">Fell at {fall.t.toFixed(1)} s · likely cause</div>
          <div className="text-stone-50">{fall.text}</div>
          <div className="mt-0.5 font-mono text-[10px] text-stone-400">
            tallest thing under a foot {cm(fall.obstacleM)} cm · slope {fall.slopeDeg.toFixed(0)}°{fall.kind === "obstacle" ? " · ring marks the spot" : ""}
          </div>
        </div>
      )}
      {hazards && (
        <div className="rounded-lg border border-white/10 bg-black/55 px-3 py-2 text-[11px] backdrop-blur-md">
          <div className="mb-1 text-[10px] tracking-wide text-stone-400 uppercase">Hazard map · height above the soil, slope over 0.5 m · grid 1 m</div>
          {legend.map((l) => (
            <div key={l.label} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: css(l.c as [number, number, number]) }} />
              <span className="font-mono text-stone-100">{l.label}</span>
              <span className="truncate text-stone-400">{l.sub}</span>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setHazards(!hazards)}
        aria-pressed={hazards}
        className={cn(
          "pointer-events-auto rounded-md border px-2.5 py-1 text-[11px] backdrop-blur-md transition-colors",
          hazards ? "border-amber-400/50 bg-amber-400/15 text-amber-100" : "border-white/15 bg-black/40 text-stone-200 hover:border-white/30",
        )}
      >
        {hazards ? "Hide hazard map" : "Show hazard map"}
      </button>
    </div>
  );
}
