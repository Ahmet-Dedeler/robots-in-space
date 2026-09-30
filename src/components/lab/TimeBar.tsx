"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { autoWarp, useLab } from "@/lib/lab-store";
import { SEVERITY_STYLE, fmtClock } from "./format";

const WARPS = [1, 10, 60, 600, 3600, 86400];

export function TimeBar() {
  const t = useLab((s) => s.playback.t);
  const playing = useLab((s) => s.playback.playing);
  const warp = useLab((s) => s.playback.warp);
  const result = useLab((s) => s.result);
  const { seek, setPlaying, setWarp, restart } = useLab.getState();
  const end = result.durationS;

  return (
    <div className="flex items-center gap-3 border-t border-white/5 bg-stone-950/80 px-3 py-2">
      <Button size="icon-sm" variant="ghost" onClick={() => setPlaying(!playing)} title={playing ? "Pause" : "Play"}>
        {playing ? <Pause /> : <Play />}
      </Button>
      <Button size="icon-sm" variant="ghost" onClick={restart} title="Restart from T+0">
        <RotateCcw />
      </Button>
      <span className="w-20 font-mono text-xs text-stone-200 tabular-nums">T+{fmtClock(t)}</span>
      <div className="relative flex-1">
        <input
          type="range"
          min={0}
          max={end}
          step={end / 2000}
          value={t}
          onChange={(e) => seek(Number(e.target.value))}
          className="venus-range w-full"
          aria-label="Experiment time"
        />
        {/* Event ticks along the scrubber. */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-0">
          {result.events
            .filter((e) => e.severity !== "info")
            .map((e, i) => (
              <span
                key={i}
                className={`absolute -top-2.5 h-1.5 w-0.5 rounded ${SEVERITY_STYLE[e.severity].dot}`}
                style={{ left: `${(e.t / end) * 100}%` }}
              />
            ))}
        </div>
      </div>
      <span className="w-16 text-right font-mono text-[11px] text-stone-500 tabular-nums">{fmtClock(end)}</span>
      <select
        value={warp ?? "auto"}
        onChange={(e) => setWarp(e.target.value === "auto" ? null : Number(e.target.value))}
        className="h-7 rounded-md border border-white/10 bg-white/[0.04] px-1.5 font-mono text-[11px] text-stone-200"
        title="Thermal clock speed"
      >
        <option value="auto" className="bg-stone-900">
          auto ×{autoWarp(result).toLocaleString()}
        </option>
        {WARPS.map((w) => (
          <option key={w} value={w} className="bg-stone-900">
            ×{w.toLocaleString()}
          </option>
        ))}
      </select>
    </div>
  );
}
