"use client";

/**
 * Parameter sweep: rerun the current experiment across a range of one
 * parameter and plot surface survival time. Runs are pure and quick, so we
 * do them in small batches between frames to keep the UI responsive.
 */
import { Play } from "lucide-react";
import { useMemo, useState } from "react";
import type uPlot from "uplot";
import { Button } from "@/components/ui/button";
import { useLab, clone } from "@/lib/lab-store";
import { formatDuration, runExperiment, type RunResult, type Scenario } from "@/sim/mission/run";
import type { VehicleBuild } from "@/sim/vehicles/types";
import { makeCooler } from "./ConfigPanel";
import { SelectField } from "./controls";
import { ROLE_COLOR } from "./format";
import { UPlot } from "./UPlot";

interface SweepParam {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  apply: (b: VehicleBuild, s: Scenario, v: number) => void;
}

const PARAMS: SweepParam[] = [
  { id: "insulation", label: "Insulation thickness", unit: "mm", min: 0, max: 150, apply: (b, _s, v) => void (b.insulation.thicknessMm = v) },
  {
    id: "pcm",
    label: "Heat-sink (PCM) mass",
    unit: "kg",
    min: 0,
    max: 200,
    apply: (b, _s, v) => void (b.pcm = { material: b.pcm?.material ?? "lnt", massKg: v }),
  },
  { id: "cooler", label: "Active cooler power", unit: "W", min: 0, max: 3000, apply: (b, _s, v) => void (b.cooler = makeCooler(b, v)) },
  { id: "initial", label: "Start temperature", unit: "°C", min: -80, max: 40, apply: (b, _s, v) => void (b.initialTempK = v + 273.15) },
  { id: "elevation", label: "Site elevation", unit: "km", min: -2, max: 11, apply: (_b, s, v) => void (s.elevationM = v * 1000) },
  { id: "battery", label: "Battery capacity", unit: "Wh", min: 100, max: 10000, apply: (b, _s, v) => void (b.battery.capacityWh = v) },
];

/** Time from reaching the surface to death, or the whole run if it never died. */
function surfaceLife(r: RunResult): { value: number; censored: boolean } {
  const landed = r.verdict.landedS ?? 0;
  if (r.verdict.deathS === null) return { value: r.durationS - landed, censored: true };
  return { value: Math.max(0, r.verdict.deathS - landed), censored: false };
}

export function Sweep() {
  const config = useLab((s) => s.config);
  const [paramId, setParamId] = useState("insulation");
  const [points, setPoints] = useState<{ x: number; life: number; censored: boolean }[]>([]);
  const [running, setRunning] = useState(false);
  const param = PARAMS.find((p) => p.id === paramId)!;

  const run = async () => {
    setRunning(true);
    const out: { x: number; life: number; censored: boolean }[] = [];
    const n = 16;
    for (let i = 0; i < n; i++) {
      const x = param.min + ((param.max - param.min) * i) / (n - 1);
      const b = clone(config.build);
      const s = clone(config.scenario);
      param.apply(b, s, x);
      // Cap long runs: a sweep only needs to know "a lot longer".
      const r = runExperiment(b, { ...s, maxDurationS: 30 * 86400 });
      const l = surfaceLife(r);
      out.push({ x, life: l.value, censored: l.censored });
      setPoints([...out]);
      await new Promise((res) => setTimeout(res, 0));
    }
    setRunning(false);
  };

  const unitDiv = useMemo(() => {
    const max = Math.max(1, ...points.map((p) => p.life));
    return max < 180 ? { d: 1, l: "s" } : max < 3 * 3600 ? { d: 60, l: "min" } : max < 3 * 86400 ? { d: 3600, l: "h" } : { d: 86400, l: "days" };
  }, [points]);

  const options = useMemo<Omit<uPlot.Options, "width" | "height">>(
    () => ({
      padding: [8, 8, 0, 0],
      scales: { x: { time: false }, y: { range: (_u, _min, max) => [0, max * 1.1 || 1] } },
      cursor: { drag: { x: false, y: false }, points: { size: 9 } },
      axes: [
        { stroke: "#a39d94", grid: { stroke: "rgba(255,255,255,0.06)" }, label: `${param.label} (${param.unit})`, labelSize: 18 },
        { stroke: "#a39d94", grid: { stroke: "rgba(255,255,255,0.06)" }, label: `Survival on surface (${unitDiv.l})`, labelSize: 18, size: 48 },
      ],
      series: [
        { label: param.unit, value: (_u, v) => (v == null ? "—" : v.toFixed(0)) },
        {
          label: "Survival",
          stroke: ROLE_COLOR.electronics,
          width: 2,
          points: { show: true, size: 8, fill: ROLE_COLOR.electronics },
          value: (_u, v) => (v == null ? "—" : formatDuration(v * unitDiv.d)),
        },
      ],
    }),
    [param, unitDiv],
  );
  const data = useMemo<uPlot.AlignedData>(() => [points.map((p) => p.x), points.map((p) => p.life / unitDiv.d)], [points, unitDiv]);

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-stone-400">
        Rerun this exact experiment across one parameter and see how long it lasts on the surface. Runs that never die are capped at 30 days.
      </p>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <SelectField
            label="Parameter"
            value={paramId}
            options={PARAMS.map((p) => ({ value: p.id, label: `${p.label} (${p.min}-${p.max} ${p.unit})` }))}
            onChange={(v) => {
              setParamId(v);
              setPoints([]);
            }}
          />
        </div>
        <Button size="sm" onClick={run} disabled={running} className="h-8">
          <Play className="size-3.5" /> {running ? "Running…" : "Run sweep"}
        </Button>
      </div>
      {points.length > 1 && <UPlot options={options} data={data} height={200} className="uplot-venus w-full" />}
      {points.length > 0 && (
        <table className="w-full text-[11px] text-stone-300">
          <thead>
            <tr className="text-left text-stone-500">
              <th className="py-1 font-normal">
                {param.label} ({param.unit})
              </th>
              <th className="py-1 text-right font-normal">Survival on surface</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {points.map((p) => (
              <tr key={p.x} className="border-t border-white/5">
                <td className="py-0.5">{p.x.toFixed(param.max - param.min > 20 ? 0 : 1)}</td>
                <td className="py-0.5 text-right">
                  {p.censored ? "≥ " : ""}
                  {formatDuration(p.life)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
