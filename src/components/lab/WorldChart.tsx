"use client";

/**
 * Day and night off Venus: Sun elevation, ground temperature and solar array
 * output against time, so failures can be read against the sunset that
 * caused them.
 */
import { useMemo } from "react";
import type uPlot from "uplot";
import type { RunResult } from "@/sim/mission/run";
import { AXIS, deathMarker, timeUnit, usePlayhead } from "./Charts";
import { AMBIENT_COLOR, ROLE_COLOR } from "./format";
import { UPlot } from "./UPlot";

/** Sun colour: not a part role, so it gets its own fixed hue. */
const SUN_COLOR = "#e0b000";

export function WorldChart({ result }: { result: RunResult }) {
  const unit = timeUnit(result.durationS);
  const playhead = usePlayhead(unit.div);
  const hasSolar = !!result.build.solar;
  const { options, data } = useMemo(() => {
    const s = result.series;
    const w = s.world;
    const data: uPlot.AlignedData = [
      Array.from(s.t, (t) => t / unit.div),
      Array.from(w.sunElevDeg),
      Array.from(w.groundK, (k) => k - 273.15),
      ...(hasSolar ? [Array.from(w.solarW)] : []),
    ];
    const options: Omit<uPlot.Options, "width" | "height"> = {
      padding: [8, 8, 0, 0],
      cursor: { drag: { x: false, y: false }, points: { size: 8 } },
      scales: { x: { time: false }, deg: { range: [-90, 90] }, c: { auto: true }, w: { range: (_u, _min, max) => [0, Math.max(10, max * 1.1)] } },
      axes: [
        { ...AXIS, label: `Time (${unit.label})`, labelSize: 18, labelFont: AXIS.font },
        { ...AXIS, scale: "c", label: "°C", labelSize: 18, labelFont: AXIS.font, size: 44 },
        ...(hasSolar ? [{ ...AXIS, scale: "w", side: 1 as const, label: "W", labelSize: 18, labelFont: AXIS.font, size: 44, grid: { show: false } }] : []),
      ],
      series: [
        { label: unit.label, value: (_u, v) => (v == null ? "—" : v.toFixed(unit.div === 1 ? 0 : 1)) },
        { label: "Sun elevation", scale: "deg", stroke: SUN_COLOR, width: 1.5, dash: [4, 3], value: (_u, v) => (v == null ? "—" : `${v.toFixed(0)}°`) },
        { label: "Ground", scale: "c", stroke: AMBIENT_COLOR, width: 2, value: (_u, v) => (v == null ? "—" : `${v.toFixed(0)}°`) },
        ...(hasSolar ? [{ label: "Solar array", scale: "w", stroke: ROLE_COLOR.battery, width: 2, value: (_u: uPlot, v: number | null) => (v == null ? "—" : `${v.toFixed(0)} W`) }] : []),
      ],
      plugins: [playhead, deathMarker(result, unit.div)],
    };
    return { options, data };
  }, [result, unit.div, unit.label, playhead, hasSolar]);

  return <UPlot options={options} data={data} height={170} className="uplot-venus w-full" />;
}
