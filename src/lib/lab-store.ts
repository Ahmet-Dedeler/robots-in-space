"use client";

/**
 * Lab state: the experiment config (vehicle build + scenario), the latest
 * result, a pinned result for comparison, and playback.
 *
 * Every config change reruns the experiment. Runs are pure and take
 * ~10-70 ms, so we just run them synchronously.
 */
import { create } from "zustand";
import { runExperiment, type RunResult, type Scenario } from "@/sim/mission/run";
import { SITES } from "@/sim/env/atmosphere";
import { VEHICLES, vehicleById } from "@/sim/vehicles/library";
import type { VehicleBuild } from "@/sim/vehicles/types";

export interface ExperimentConfig {
  baseId: string;
  build: VehicleBuild;
  scenario: Scenario;
}

export interface Playback {
  /** Experiment time being shown [s]. */
  t: number;
  playing: boolean;
  /** Experiment seconds per real second. `null` = auto. */
  warp: number | null;
  /** Bumped to force the 3D mechanics to reset. */
  resetToken: number;
}

interface LabState {
  config: ExperimentConfig;
  result: RunResult;
  pinned: RunResult | null;
  playback: Playback;
  setVehicle: (id: string) => void;
  updateBuild: (patch: (b: VehicleBuild) => VehicleBuild) => void;
  updateScenario: (patch: Partial<Scenario>) => void;
  resetBuild: () => void;
  loadConfig: (c: ExperimentConfig) => void;
  pin: () => void;
  unpin: () => void;
  seek: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setWarp: (w: number | null) => void;
  restart: () => void;
  tick: (realDt: number) => void;
}

export const clone = <T,>(x: T): T => structuredClone(x);

export function defaultScenario(build: VehicleBuild): Scenario {
  const lander = build.mechanics.kind === "static" && build.descent;
  const elevationM = build.homeElevationM ?? 0;
  return {
    elevationM,
    ground: SITES.find((x) => x.elevationM === elevationM)?.ground ?? "venera14",
    windMs: 0.5,
    start: lander ? { kind: "descent", fromKm: 62 } : { kind: "surface" },
    activity: build.mechanics.kind === "humanoid" ? "walking" : "idle",
  };
}

/**
 * Auto time-warp: show the interesting part (until death + a bit) in about
 * 30 real seconds, but never slower than real time. Humanoids stay near 1x
 * so the walking looks right.
 */
export function autoWarp(r: RunResult): number {
  const end = r.verdict.deathS ?? r.durationS;
  const target = r.build.mechanics.kind === "humanoid" ? 40 : 30;
  return Math.max(1, Math.round(end / target));
}

const initialBuild = clone(VEHICLES[0]);
const initialScenario = defaultScenario(initialBuild);

export const useLab = create<LabState>((set, get) => {
  const rerun = (config: ExperimentConfig) => {
    const result = runExperiment(config.build, config.scenario);
    set((s) => ({
      config,
      result,
      playback: { ...s.playback, t: Math.min(s.playback.t, result.durationS) },
    }));
  };

  return {
    config: { baseId: initialBuild.id, build: initialBuild, scenario: initialScenario },
    result: runExperiment(initialBuild, initialScenario),
    pinned: null,
    playback: { t: 0, playing: true, warp: null, resetToken: 0 },

    setVehicle(id) {
      const base = vehicleById(id);
      if (!base) return;
      const build = clone(base);
      rerun({ baseId: id, build, scenario: defaultScenario(build) });
      get().restart();
    },
    updateBuild(patch) {
      const c = get().config;
      rerun({ ...c, build: patch(clone(c.build)) });
    },
    updateScenario(patch) {
      const c = get().config;
      rerun({ ...c, scenario: { ...c.scenario, ...patch } });
    },
    resetBuild() {
      const c = get().config;
      const base = vehicleById(c.baseId);
      if (base) rerun({ ...c, build: clone(base) });
    },
    loadConfig(c) {
      rerun(c);
      get().restart();
    },
    pin() {
      set({ pinned: get().result });
    },
    unpin() {
      set({ pinned: null });
    },
    seek(t) {
      set((s) => ({ playback: { ...s.playback, t: Math.max(0, Math.min(t, s.result.durationS)) } }));
    },
    setPlaying(playing) {
      set((s) => {
        // Pressing play at the end starts over.
        const atEnd = s.playback.t >= s.result.durationS;
        return {
          playback: {
            ...s.playback,
            playing,
            t: playing && atEnd ? 0 : s.playback.t,
            resetToken: playing && atEnd ? s.playback.resetToken + 1 : s.playback.resetToken,
          },
        };
      });
    },
    setWarp(warp) {
      set((s) => ({ playback: { ...s.playback, warp } }));
    },
    restart() {
      set((s) => ({ playback: { ...s.playback, t: 0, playing: true, resetToken: s.playback.resetToken + 1 } }));
    },
    tick(realDt) {
      const { playback, result } = get();
      if (!playback.playing) return;
      const warp = playback.warp ?? autoWarp(result);
      const t = playback.t + realDt * warp;
      if (t >= result.durationS) set({ playback: { ...playback, t: result.durationS, playing: false } });
      else set({ playback: { ...playback, t } });
    },
  };
});

// ---- Share links ---------------------------------------------------------------

interface SharePayload {
  v: string;
  b: Partial<VehicleBuild>;
  s: Scenario;
}

const b64url = {
  encode: (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  decode: (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))),
};

/** Encode only the top-level build fields that differ from the preset. */
export function encodeConfig(c: ExperimentConfig): string {
  const base = vehicleById(c.baseId) ?? c.build;
  const diff: Partial<VehicleBuild> = {};
  for (const k of Object.keys(c.build) as (keyof VehicleBuild)[]) {
    if (JSON.stringify(c.build[k]) !== JSON.stringify(base[k])) (diff as Record<string, unknown>)[k] = c.build[k];
  }
  return b64url.encode(JSON.stringify({ v: c.baseId, b: diff, s: c.scenario } satisfies SharePayload));
}

export function decodeConfig(x: string): ExperimentConfig | null {
  try {
    const p = JSON.parse(b64url.decode(x)) as SharePayload;
    const base = vehicleById(p.v);
    if (!base) return null;
    return { baseId: p.v, build: { ...clone(base), ...p.b }, scenario: { ...defaultScenario(base), ...p.s } };
  } catch {
    return null;
  }
}
