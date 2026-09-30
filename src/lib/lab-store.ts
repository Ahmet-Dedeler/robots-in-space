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
import { BODIES, siteById, sitesFor, type BodyId } from "@/sim/planets/bodies";
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
  /** Move the current vehicle to another world (resets the scenario to that world's default site). */
  setWorld: (body: BodyId) => void;
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

/** The world a scenario is on. */
export const bodyOf = (s: Scenario): BodyId => s.planet?.body ?? "venus";

export function defaultScenario(build: VehicleBuild, body: BodyId = build.home?.body ?? "venus"): Scenario {
  const mobile = build.mechanics.kind !== "static";
  if (body !== "venus") {
    const home = build.home?.body === body ? build.home : undefined;
    const site = (home && siteById(home.siteId)) || sitesFor(body)[0];
    return {
      elevationM: site.elevationM,
      ground: site.ground,
      windMs: body === "mars" ? 5 : 0,
      start: { kind: "surface" },
      activity: mobile ? "walking" : "idle",
      planet: {
        body,
        siteId: site.id,
        localHour: home?.localHour ?? 8,
        lsDeg: home?.lsDeg ?? 150,
        dustTau: home?.dustTau ?? (body === "mars" ? 0.5 : 0),
        chaseSun: home?.chaseSun ?? false,
      },
    };
  }
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
  // Off Venus the story is day and night: one local day per ~24 s, so sunsets don't strobe.
  // (Humanoids keep the Venus rule so the walking stays watchable.)
  if (r.scenario.planet && r.build.mechanics.kind !== "humanoid") return Math.round(BODIES[r.scenario.planet.body].solarDayS / 24);
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
      // Stay on the world you're looking at: drop a Venus robot on the Moon, or a Moon rover on Mars.
      rerun({ baseId: id, build, scenario: defaultScenario(build, bodyOf(get().config.scenario)) });
      get().restart();
    },
    setWorld(body) {
      const c = get().config;
      rerun({ ...c, scenario: defaultScenario(c.build, body) });
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
