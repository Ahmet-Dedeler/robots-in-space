"use client";

/**
 * Powered-descent telemetry: what the air and the engines do to a rocket
 * lander, sample by sample from the flight (spacecraft/landing.ts).
 *
 * Trajectory (altitude, speed), aerodynamics (Mach, dynamic pressure),
 * entry heating (heat flux, tile face and skin temperatures), attitude and
 * load (angle of attack, felt g), and mass/weight. Each quantity keeps one
 * colour everywhere (FLIGHT_COLOR).
 */
import { useMemo } from "react";
import type uPlot from "uplot";
import type { RunResult } from "@/sim/mission/run";
import { BODIES, gravityAt } from "@/sim/planets/bodies";
import type { Flight } from "@/sim/spacecraft/landing";
import { AXIS, timeUnit, usePlayhead } from "./Charts";
import { UPlot } from "./UPlot";

/** Fixed colour per flight quantity. */
export const FLIGHT_COLOR = {
  altitude: "#7dd3fc",
  speed: "#fbbf24",
  mach: "#c4b5fd",
  q: "#f472b6",
  heat: "#fb923c",
  surface: "#ef4444",
  skin: "#a3a3a3",
  aoa: "#34d399",
  g: "#f5f5f4",
  mass: "#60a5fa",
  weight: "#fde68a",
} as const;

interface Line {
  label: string;
  color: keyof typeof FLIGHT_COLOR;
  values: ArrayLike<number>;
  axis: "y" | "y2";
  fmt: (v: number) => string;
}

function DualChart({ flight, lines, yLabel, y2Label, height = 150 }: { flight: Flight; lines: Line[]; yLabel: string; y2Label: string; height?: number }) {
  const end = flight.t[flight.t.length - 1] ?? 1;
  const unit = timeUnit(end);
  const playhead = usePlayhead(unit.div);
  const { options, data } = useMemo(() => {
    const options: Omit<uPlot.Options, "width" | "height"> = {
      padding: [8, 4, 0, 0],
      cursor: { drag: { x: false, y: false }, points: { size: 7 } },
      scales: { x: { time: false }, y: { auto: true }, y2: { auto: true } },
      axes: [
        { ...AXIS, label: `Time (${unit.label})`, labelSize: 18, labelFont: AXIS.font },
        { ...AXIS, scale: "y", label: yLabel, labelSize: 18, labelFont: AXIS.font, size: 48 },
        { ...AXIS, scale: "y2", side: 1, label: y2Label, labelSize: 18, labelFont: AXIS.font, size: 48, grid: { show: false } },
      ],
      series: [
        { label: unit.label, value: (_u, v) => (v == null ? "—" : v.toFixed(unit.div === 1 ? 0 : 1)) },
        ...lines.map((l) => ({
          label: l.label,
          scale: l.axis,
          stroke: FLIGHT_COLOR[l.color],
          width: 2,
          value: (_u: uPlot, v: number | null) => (v == null ? "—" : l.fmt(v)),
        })),
      ],
      plugins: [playhead],
    };
    const data: uPlot.AlignedData = [Array.from(flight.t, (t) => t / unit.div), ...lines.map((l) => Array.from(l.values))];
    return { options, data };
  }, [flight, lines, yLabel, y2Label, unit.div, unit.label, playhead]);
  return <UPlot options={options} data={data} height={height} className="uplot-venus w-full" />;
}

export function FlightCharts({ result }: { result: RunResult }) {
  const f = result.flight;
  const groups = useMemo(() => {
    if (!f) return null;
    const body = BODIES[result.scenario.planet?.body ?? "venus"];
    const elev = result.scenario.elevationM;
    const C = (k: number) => k - 273.15;
    const weightKn = Array.from(f.massKg, (m, i) => (m * gravityAt(body, elev + f.h[i])) / 1000);
    const air = f.qPa.some((q) => q > 1);
    const heated = f.heatWm2.some((q) => q > 100);
    return { weightKn, air, heated, C };
  }, [f, result.scenario]);
  if (!f || !groups) return null;
  const { weightKn, air, heated, C } = groups;
  return (
    <div className="space-y-4">
      <Group title="Trajectory">
        <DualChart
          flight={f}
          yLabel="km"
          y2Label="m/s"
          lines={[
            { label: "Altitude", color: "altitude", values: Array.from(f.h, (h) => h / 1000), axis: "y", fmt: (v) => `${v.toFixed(v < 10 ? 2 : 1)} km` },
            { label: "Speed", color: "speed", values: Array.from(f.vx, (vx, i) => Math.hypot(vx, f.vz[i])), axis: "y2", fmt: (v) => `${v.toFixed(0)} m/s` },
          ]}
        />
      </Group>
      {air && (
        <Group title="Air: Mach and dynamic pressure">
          <DualChart
            flight={f}
            yLabel="Mach"
            y2Label="kPa"
            lines={[
              { label: "Mach", color: "mach", values: f.mach, axis: "y", fmt: (v) => v.toFixed(2) },
              { label: "Dynamic pressure", color: "q", values: Array.from(f.qPa, (q) => q / 1000), axis: "y2", fmt: (v) => `${v.toFixed(2)} kPa` },
            ]}
          />
        </Group>
      )}
      {heated && (
        <Group title="Entry heating and heat shield">
          <DualChart
            flight={f}
            yLabel="kW/m²"
            y2Label="°C"
            lines={[
              { label: "Heat flux", color: "heat", values: Array.from(f.heatWm2, (q) => q / 1000), axis: "y", fmt: (v) => `${v.toFixed(0)} kW/m²` },
              { label: "Hottest surface", color: "surface", values: Array.from(f.surfaceK, C), axis: "y2", fmt: (v) => `${v.toFixed(0)} °C` },
              { label: "Skin behind it", color: "skin", values: Array.from(f.skinK, C), axis: "y2", fmt: (v) => `${v.toFixed(0)} °C` },
            ]}
          />
        </Group>
      )}
      <Group title="Attitude and load">
        <DualChart
          flight={f}
          yLabel="AoA °"
          y2Label="g"
          lines={[
            ...(air ? [{ label: "Angle of attack", color: "aoa" as const, values: f.aoaDeg, axis: "y" as const, fmt: (v: number) => `${v.toFixed(0)}°` }] : []),
            ...(!air ? [{ label: "Tilt from vertical", color: "aoa" as const, values: Array.from(f.pitchDeg, Math.abs), axis: "y" as const, fmt: (v: number) => `${v.toFixed(0)}°` }] : []),
            { label: "Felt load", color: "g", values: f.gLoad, axis: "y2", fmt: (v) => `${v.toFixed(2)} g` },
          ]}
        />
      </Group>
      <Group title="Mass and weight">
        <DualChart
          flight={f}
          yLabel="t"
          y2Label="kN"
          lines={[
            { label: "Mass", color: "mass", values: Array.from(f.massKg, (m) => m / 1000), axis: "y", fmt: (v) => `${v.toFixed(1)} t` },
            { label: `Weight on ${BODIES[result.scenario.planet?.body ?? "venus"].name}`, color: "weight", values: weightKn, axis: "y2", fmt: (v) => `${v.toFixed(0)} kN` },
          ]}
        />
      </Group>
      <p className="text-[11px] text-stone-500">
        Angle of attack is measured from the nose: 180° is engines first (a booster&apos;s fall, every landing burn), ~60° Starship&apos;s entry, 90° its belly flop. Felt load is
        everything but gravity (thrust, drag, lift, buoyancy).
      </p>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-[11px] tracking-wide text-stone-500 uppercase">{title}</h4>
      {children}
    </div>
  );
}
