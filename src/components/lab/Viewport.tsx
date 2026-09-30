"use client";

import { OrbitControls } from "@react-three/drei";
import { EffectComposer, N8AO } from "@react-three/postprocessing";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { useCallback, useState } from "react";
import { autoWarp, useLab } from "@/lib/lab-store";
import { cn } from "@/lib/utils";
import { stateAt, walkingFor } from "@/sim/mission/run";
import { fmtBar, fmtC, fmtClock } from "./format";
import { HumanoidView } from "./scene/HumanoidView";
import { LanderView } from "./scene/LanderView";
import { TerrainView } from "./scene/TerrainView";
import { useTerrain } from "./scene/useScene";
import { RoverView } from "./scene/RoverView";
import { WorldEnvironment } from "./scene/WorldEnvironment";
import { fmtHour } from "@/sim/planets/world";
import { WheeledView } from "./scene/WheeledView";

/** Advances the experiment clock every rendered frame. */
function Ground() {
  return <TerrainView terrain={useTerrain()} />;
}

function PlaybackDriver() {
  useFrame((_, dt) => useLab.getState().tick(Math.min(dt, 0.1)));
  return null;
}

function Chip({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" | "bad" }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-2 py-1 backdrop-blur-md",
        tone === "ok" && "border-emerald-400/25 bg-emerald-950/40",
        tone === "warn" && "border-amber-400/30 bg-amber-950/40",
        tone === "bad" && "border-red-400/30 bg-red-950/50",
      )}
    >
      <span className="text-[10px] tracking-wide text-stone-300/80 uppercase">{label}</span>
      <span className="font-mono text-xs text-stone-50 tabular-nums">{value}</span>
    </div>
  );
}

function Hud() {
  const result = useLab((s) => s.result);
  const t = useLab((s) => s.playback.t);
  const warp = useLab((s) => s.playback.warp);
  const elevationM = useLab((s) => s.config.scenario.elevationM);
  const st = stateAt(result, t);
  const above = st.altitudeM - elevationM;
  const planet = result.scenario.planet;
  const humanoid = result.build.mechanics.kind === "humanoid";
  const walkMin = walkingFor(result.build, result.scenario.ground)?.minTorque ?? 0.7;
  const w = warp ?? autoWarp(result);
  const iE = result.nodes.findIndex((n) => n.id === "electronics");
  const frameOk = st.frameYieldFraction >= result.build.frame.loadFraction;

  return (
    <>
      <div className="pointer-events-none absolute top-3 left-3 space-y-1 rounded-lg border border-white/10 bg-black/35 px-3 py-2 backdrop-blur-md">
        <div className="text-[10px] tracking-[0.16em] text-amber-200/80 uppercase">
          {above > 1
            ? `Descending · ${(st.altitudeM / 1000).toFixed(1)} km · ${st.speedMs.toFixed(1)} m/s`
            : planet
              ? `${fmtHour(st.world.localHour)} local · Sun ${st.world.sunElevDeg >= 0 ? `${st.world.sunElevDeg.toFixed(0)}° up` : "down"}${st.world.awake < 0.5 && st.controller ? " · asleep" : ""}`
              : "On the surface"}
        </div>
        <div className="flex gap-4 font-mono text-xs text-stone-100 tabular-nums">
          <span>{planet && st.pressurePa < 1 ? `ground ${fmtC(st.ambientK)}` : fmtC(st.ambientK)}</span>
          <span>{fmtBar(st.pressurePa)}</span>
          {iE >= 0 && <span className="text-stone-300">e-bay {fmtC(st.nodeK[iE])}</span>}
        </div>
        <div className="font-mono text-[11px] text-stone-400 tabular-nums">
          T+{fmtClock(st.t)} · thermal clock ×{w.toLocaleString()}
          {humanoid && <span className="text-stone-500"> · mechanics real-time</span>}
        </div>
      </div>
      <div className="pointer-events-none absolute top-3 right-3 flex flex-col items-end gap-1.5">
        <Chip label="Controller" value={st.controller ? "alive" : "dead"} tone={st.controller ? "ok" : "bad"} />
        <Chip label="Power" value={st.power ? `${Math.round(st.batteryWh)} Wh` : "none"} tone={st.power ? "ok" : "bad"} />
        {result.build.solar && <Chip label="Solar" value={`${Math.round(st.world.solarW)} W`} tone={st.world.solarW > result.build.electronics.powerW ? "ok" : st.world.solarW > 0 ? "warn" : "bad"} />}
        {result.build.motors && (
          <Chip
            label={result.build.mechanics.kind === "wheeled" ? "Drive" : "Torque"}
            value={`${Math.round(st.torqueFraction * 100)}%`}
            tone={st.torqueFraction >= Math.max(0.8, walkMin + 0.15) ? "ok" : st.torqueFraction >= walkMin ? "warn" : "bad"}
          />
        )}
        <Chip label="Frame" value={`${Math.round(st.frameYieldFraction * 100)}% strength`} tone={frameOk ? (st.frameYieldFraction > 0.6 ? "ok" : "warn") : "bad"} />
      </div>
    </>
  );
}

export default function Viewport() {
  const mech = useLab((s) => s.config.build.mechanics);
  const [status, setStatus] = useState<{ ok: boolean; err?: string } | null>(null);
  const onReady = useCallback((ok: boolean, err?: string) => setStatus({ ok, err }), []);
  const humanoid = mech.kind === "humanoid";
  const key = mech.kind === "humanoid" ? `${mech.robot}-${mech.finish ?? "stock"}` : mech.kind === "wheeled" || mech.kind === "rover" ? mech.model : mech.shape;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#b8743a]">
      <Canvas
        key={key}
        shadows="percentage"
        dpr={[1, 2]}
        camera={{ position: humanoid ? [2.6, 1.6, 3.2] : mech.kind === "wheeled" ? [6, 3.5, 7.5] : [5, 3.2, 6.5], fov: 45, near: 0.03, far: 12000 }}
        gl={{ antialias: true, logarithmicDepthBuffer: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
      >
        <PlaybackDriver />
        <WorldEnvironment />
        <Ground />
        {mech.kind === "humanoid" ? (
          <HumanoidView robot={mech.robot} finish={mech.finish} onReady={onReady} />
        ) : mech.kind === "wheeled" ? (
          <WheeledView />
        ) : mech.kind === "rover" ? (
          <RoverView model={mech.model} />
        ) : (
          <LanderView shape={mech.shape} />
        )}
        <OrbitControls makeDefault enableDamping maxPolarAngle={Math.PI / 2 - 0.04} minDistance={0.8} maxDistance={60} />
        {/* Under purely diffuse light, ambient occlusion is what shades the ground and the robot. */}
        <EffectComposer>
          <N8AO aoRadius={0.3} intensity={1.3} distanceFalloff={1} halfRes />
        </EffectComposer>
      </Canvas>
      <Hud />
      {humanoid && status === null && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="rounded-lg bg-black/40 px-4 py-2 text-xs text-stone-200 backdrop-blur">Loading MuJoCo + robot model…</div>
        </div>
      )}
      {humanoid && status && !status.ok && (
        <div className="absolute bottom-3 left-3 max-w-sm rounded-lg border border-red-400/30 bg-red-950/60 px-3 py-2 text-xs text-red-100">
          Physics engine failed to load: {status.err}
        </div>
      )}
    </div>
  );
}
