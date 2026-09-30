"use client";

/**
 * Telemetry charts: part temperatures vs time (one axis, °C) and capability
 * (torque, frame strength, battery charge; one axis, %). A playhead follows
 * the experiment clock; click anywhere to seek.
 */
import { useEffect, useMemo, useRef } from "react";
import type uPlot from "uplot";
import { useLab } from "@/lib/lab-store";
import type { RunResult } from "@/sim/mission/run";
import type { Role } from "@/sim/vehicles/thermal-model";
import { AMBIENT_COLOR, ROLE_COLOR, ROLE_SHORT } from "./format";
import { UPlot } from "./UPlot";

const AXIS = {
  stroke: "#a39d94",
  grid: { stroke: "rgba(255,255,255,0.06)", width: 1 },
  ticks: { stroke: "rgba(255,255,255,0.1)", width: 1 },
  font: "11px var(--font-geist-mono), ui-monospace, monospace",
};

function timeUnit(end: number): { div: number; label: string } {
  if (end < 180) return { div: 1, label: "s" };
  if (end < 3 * 3600) return { div: 60, label: "min" };
  if (end < 3 * 86400) return { div: 3600, label: "h" };
  return { div: 86400, label: "days" };
}

/** Draws the playhead and lets clicks seek. Returns a uPlot plugin. */
function usePlayhead(div: number) {
  const plots = useRef(new Set<uPlot>());
  const tRef = useRef(0);
  useEffect(() => {
    let raf = 0;
    let last = -1;
    const loop = () => {
      const t = useLab.getState().playback.t;
      if (t !== last) {
        last = t;
        tRef.current = t;
        plots.current.forEach((u) => u.redraw(false, false));
      }
      raf = window.setTimeout(loop, 80) as unknown as number;
    };
    loop();
    return () => clearTimeout(raf);
  }, []);

  return useMemo<uPlot.Plugin>(
    () => ({
      hooks: {
        init: [
          (u) => {
            plots.current.add(u);
            u.over.addEventListener("click", () => {
              const x = u.posToVal(u.cursor.left ?? 0, "x");
              useLab.getState().seek(x * div);
            });
          },
        ],
        destroy: [(u) => void plots.current.delete(u)],
        draw: [
          (u) => {
            const x = u.valToPos(tRef.current / div, "x", true);
            const ctx = u.ctx;
            ctx.save();
            ctx.strokeStyle = "rgba(255,236,200,0.85)";
            ctx.lineWidth = 1.5 * devicePixelRatio;
            ctx.beginPath();
            ctx.moveTo(x, u.bbox.top);
            ctx.lineTo(x, u.bbox.top + u.bbox.height);
            ctx.stroke();
            ctx.restore();
          },
        ],
      },
    }),
    [div],
  );
}

function deathMarker(result: RunResult, div: number): uPlot.Plugin {
  return {
    hooks: {
      draw: [
        (u) => {
          const d = result.verdict.deathS;
          if (d === null) return;
          const x = u.valToPos(d / div, "x", true);
          const ctx = u.ctx;
          ctx.save();
          ctx.setLineDash([4 * devicePixelRatio, 4 * devicePixelRatio]);
          ctx.strokeStyle = "rgba(239,68,68,0.7)";
          ctx.lineWidth = devicePixelRatio;
          ctx.beginPath();
          ctx.moveTo(x, u.bbox.top);
          ctx.lineTo(x, u.bbox.top + u.bbox.height);
          ctx.stroke();
          ctx.restore();
        },
      ],
    },
  };
}

export function TemperatureChart({ result }: { result: RunResult }) {
  const unit = timeUnit(result.durationS);
  const playhead = usePlayhead(unit.div);
  const { options, data } = useMemo(() => {
    const s = result.series;
    const x = Array.from(s.t, (t) => t / unit.div);
    const visible = result.nodes.map((n, i) => ({ ...n, i }));
    const data: uPlot.AlignedData = [
      x,
      Array.from(s.ambientK, (k) => k - 273.15),
      ...visible.map((n) => Array.from(s.nodeK[n.i], (k) => k - 273.15)),
    ];
    const options: Omit<uPlot.Options, "width" | "height"> = {
      padding: [8, 8, 0, 0],
      cursor: { drag: { x: false, y: false }, points: { size: 8 } },
      legend: { live: true },
      scales: { x: { time: false } },
      axes: [
        { ...AXIS, label: `Time (${unit.label})`, labelSize: 18, labelFont: AXIS.font },
        { ...AXIS, label: "°C", labelSize: 18, labelFont: AXIS.font, size: 44 },
      ],
      series: [
        { label: unit.label, value: (_u, v) => (v == null ? "—" : v.toFixed(unit.div === 1 ? 0 : 1)) },
        { label: "Ambient", stroke: AMBIENT_COLOR, width: 1.5, dash: [5, 4], value: (_u, v) => (v == null ? "—" : `${v.toFixed(0)}°`) },
        ...visible.map((n) => ({
          label: ROLE_SHORT[n.id as Role] ?? n.label,
          stroke: ROLE_COLOR[n.id as Role] ?? "#ccc",
          width: 2,
          value: (_u: uPlot, v: number | null) => (v == null ? "—" : `${v.toFixed(0)}°`),
        })),
      ],
      plugins: [playhead, deathMarker(result, unit.div)],
    };
    return { options, data };
  }, [result, unit.div, unit.label, playhead]);

  return <UPlot options={options} data={data} height={220} className="uplot-venus w-full" />;
}

export function CapabilityChart({ result }: { result: RunResult }) {
  const unit = timeUnit(result.durationS);
  const playhead = usePlayhead(unit.div);
  const { options, data } = useMemo(() => {
    const s = result.series;
    const cap = result.build.battery.capacityWh;
    const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(0)}%`);
    const series: { label: string; color: string; values: number[] }[] = [];
    if (result.build.motors)
      series.push({ label: "Motor torque", color: ROLE_COLOR.motors, values: Array.from(s.torqueFraction, (v) => v * 100) });
    series.push({ label: "Frame strength", color: ROLE_COLOR.frame, values: Array.from(s.frameYieldFraction, (v) => v * 100) });
    series.push({ label: "Battery charge", color: ROLE_COLOR.battery, values: Array.from(s.batteryWh, (v) => (v / cap) * 100) });
    const options: Omit<uPlot.Options, "width" | "height"> = {
      padding: [8, 8, 0, 0],
      cursor: { drag: { x: false, y: false }, points: { size: 8 } },
      scales: { x: { time: false }, y: { range: [0, 105] } },
      axes: [
        { ...AXIS, label: `Time (${unit.label})`, labelSize: 18, labelFont: AXIS.font },
        { ...AXIS, label: "% of new", labelSize: 18, labelFont: AXIS.font, size: 44 },
      ],
      series: [
        { label: unit.label, value: (_u, v) => (v == null ? "—" : v.toFixed(unit.div === 1 ? 0 : 1)) },
        ...series.map((x) => ({ label: x.label, stroke: x.color, width: 2, value: (_u: uPlot, v: number | null) => pct(v) })),
      ],
      plugins: [playhead, deathMarker(result, unit.div)],
    };
    const data: uPlot.AlignedData = [Array.from(s.t, (t) => t / unit.div), ...series.map((x) => x.values)];
    return { options, data };
  }, [result, unit.div, unit.label, playhead]);

  return <UPlot options={options} data={data} height={160} className="uplot-venus w-full" />;
}
