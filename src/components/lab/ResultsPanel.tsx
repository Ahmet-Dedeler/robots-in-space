"use client";

import { Check, Link2, Pin, PinOff } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { encodeConfig, useLab } from "@/lib/lab-store";
import { cn } from "@/lib/utils";
import { MATERIALS } from "@/sim/materials/materials";
import { formatDuration, type RunResult } from "@/sim/mission/run";
import { CapabilityChart, TemperatureChart } from "./Charts";
import { FIDELITY_HINT, FidelityBadge } from "./controls";
import { GroundPanel } from "./GroundPanel";
import { SEVERITY_STYLE, fmtClock } from "./format";
import { Sweep } from "./Sweep";
import { PlanetModelNotes } from "./PlanetNotes";
import { WorldChart } from "./WorldChart";

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2">
      <div className="text-[10px] tracking-wide text-stone-500 uppercase">{label}</div>
      <div className="font-mono text-sm text-stone-100 tabular-nums">{value}</div>
      {sub && <div className="truncate text-[10px] text-stone-500">{sub}</div>}
    </div>
  );
}

function surfaceTime(r: RunResult) {
  const { deathS, landedS } = r.verdict;
  if (landedS === null) return "never landed";
  if (deathS === null) return `> ${formatDuration(r.durationS - landedS)}`;
  return formatDuration(Math.max(0, deathS - landedS));
}

function Verdict() {
  const result = useLab((s) => s.result);
  const pinned = useLab((s) => s.pinned);
  const pin = useLab((s) => s.pin);
  const unpin = useLab((s) => s.unpin);
  const config = useLab((s) => s.config);
  const [copied, setCopied] = useState(false);
  const v = result.verdict;

  const share = async () => {
    const url = `${location.origin}${location.pathname}?x=${encodeConfig(config)}`;
    history.replaceState(null, "", url);
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-3 border-b border-white/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] tracking-[0.14em] text-amber-200/70 uppercase">
            Verdict <FidelityBadge fidelity={result.build.fidelity} />
          </div>
          <p className="mt-1 text-[15px] leading-snug font-medium text-stone-50">{v.headline}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="icon-sm" variant="ghost" onClick={pinned ? unpin : pin} title={pinned ? "Unpin comparison" : "Pin this run to compare"}>
            {pinned ? <PinOff /> : <Pin />}
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={share} title="Copy share link">
            {copied ? <Check /> : <Link2 />}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Metric label="On surface" value={surfaceTime(result)} sub={v.walkStopS !== null ? `${result.build.mechanics.kind === "wheeled" ? "drove" : "walked"} ${formatDuration(Math.max(0, v.walkStopS - (v.landedS ?? 0)))}` : undefined} />
        <Metric
          label="Descent"
          value={v.landedS ? formatDuration(v.landedS) : "—"}
          sub={v.touchdownMs ? `touchdown ${v.touchdownMs.toFixed(1)} m/s` : "started on surface"}
        />
        <Metric label="First failure" value={v.firstFailure ? fmtClock(v.firstFailure.t) : "none"} sub={v.firstFailure?.title} />
      </div>
      {pinned && (
        <div className="rounded-md border border-dashed border-white/10 px-3 py-2 text-xs text-stone-400">
          <span className="text-stone-500">Pinned:</span> {pinned.build.name}: <span className="font-mono text-stone-200">{surfaceTime(pinned)}</span> on surface vs{" "}
          <span className="font-mono text-stone-200">{surfaceTime(result)}</span> now.
        </div>
      )}
      <p className="text-[10px] text-stone-600">Computed in {result.computeMs.toFixed(0)} ms · {result.series.t.length} samples</p>
    </div>
  );
}

function Timeline() {
  const events = useLab((s) => s.result.events);
  const landed = useLab((s) => s.result.verdict.landedS);
  const seek = useLab((s) => s.seek);
  // Coarse subscription: re-render when the playhead crosses an event.
  const passed = useLab((s) => events.filter((e) => e.t <= s.playback.t).length);

  return (
    <ol className="space-y-0.5">
      {events.map((e, i) => {
        const st = SEVERITY_STYLE[e.severity];
        return (
          <li key={i}>
            <button
              type="button"
              onClick={() => seek(e.t)}
              className={cn("flex w-full gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/[0.04]", i >= passed && "opacity-45")}
            >
              <span className="w-16 shrink-0 pt-0.5 text-right font-mono text-[11px] text-stone-400 tabular-nums">
                {fmtClock(e.t)}
                {landed !== null && landed > 0 && e.t >= landed && <span className="block text-[9px] text-stone-600">surf +{fmtClock(e.t - landed)}</span>}
              </span>
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", st.dot)} aria-label={st.label} />
              <span className="min-w-0">
                <span className={cn("block text-xs font-medium", st.text)}>{e.title}</span>
                {e.detail && <span className="block text-[11px] leading-snug text-stone-400">{e.detail}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Notes() {
  const build = useLab((s) => s.result.build);
  const planet = useLab((s) => s.result.scenario.planet);
  const materials = [build.frame.material, build.skin.material, build.insulation.material, build.pcm?.material]
    .filter(Boolean)
    .map((id) => MATERIALS[id!])
    .filter((m) => m.notes);
  return (
    <div className="space-y-4 text-xs leading-relaxed text-stone-300">
      <div>
        <div className="mb-1 flex items-center gap-2">
          <FidelityBadge fidelity={build.fidelity} />
          <span className="text-stone-400">{FIDELITY_HINT[build.fidelity]}</span>
        </div>
        <ul className="list-disc space-y-1 pl-4">
          {build.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </div>
      {materials.length > 0 && (
        <div>
          <h4 className="mb-1 text-[11px] tracking-wide text-stone-500 uppercase">Material notes</h4>
          <ul className="list-disc space-y-1 pl-4">
            {materials.map((m) => (
              <li key={m.id}>
                <span className="text-stone-100">{m.name}:</span> {m.notes}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h4 className="mb-1 text-[11px] tracking-wide text-stone-500 uppercase">How this is computed</h4>
        {planet ? (
          <PlanetModelNotes />
        ) : (
        <ul className="list-disc space-y-1 pl-4 text-stone-400">
          <li>Atmosphere: VIRA reference profiles (Seiff et al. 1985); real-gas CO₂ properties from CoolProp (supercritical near the surface).</li>
          <li>Heat: a lumped thermal network (skin, frame, hull, electronics, battery, motors, heat sink) with natural + forced convection correlations and radiation. Correlations are good to about ±20%.</li>
          <li>Failures: datasheet temperature limits per part; magnet torque from remanence loss; frame strength from yield-vs-temperature curves; hull buckling and yield.</li>
          <li>Walking: the real Unitree policy in MuJoCo (WASM) with Venus gravity, 65 kg/m³ CO₂, wind and buoyancy (added by hand: MuJoCo&apos;s fluid model has none), bodies scaled to the spec mass. Torque is scaled live by the thermal model.</li>
          <li>Ground: generated from the Venera 9/13/14 panoramas (layered basalt plates, sediment, boulder talus). The same height function is the collision heightfield, so feet and wheels hit what you see. The Ground tab and the hazard map show what&apos;s there; when the robot falls, the view marks the rock it caught or says it fell on open ground.</li>
          <li>Bending: thighs and shins are split by elastic-perfectly-plastic hinges whose plastic moment follows the frame&apos;s hot yield strength, so limbs bend and stay bent.</li>
          <li>Optics: spectral Rayleigh extinction of CO₂ at the local density, cloud-deck Mie extinction, diffuse-only light (no direct sunbeam reaches the surface).</li>
          <li>Descent: quasi-steady terminal velocity through the VIRA density profile.</li>
        </ul>
        )}
      </div>
    </div>
  );
}

export function ResultsPanel() {
  const result = useLab((s) => s.result);
  const [tab, setTab] = useState("timeline");
  return (
    <div className="flex flex-col">
      <Verdict />
      <Tabs value={tab} onValueChange={(v) => setTab(v as string)} className="gap-0">
        <TabsList variant="line" className="w-full justify-start gap-1 border-b border-white/5 px-3">
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="charts">Telemetry</TabsTrigger>
          <TabsTrigger value="ground">Ground</TabsTrigger>
          <TabsTrigger value="sweep">Sweep</TabsTrigger>
          <TabsTrigger value="notes">Model</TabsTrigger>
        </TabsList>
        <TabsContent value="timeline" className="p-2">
          <Timeline />
        </TabsContent>
        <TabsContent value="ground" className="p-4">
          <GroundPanel />
        </TabsContent>
        <TabsContent value="charts" className="space-y-4 p-4">
          {result.scenario.planet && (
            <div>
              <h4 className="mb-2 text-[11px] tracking-wide text-stone-500 uppercase">Day, night &amp; power</h4>
              <WorldChart result={result} />
            </div>
          )}
          <div>
            <h4 className="mb-2 text-[11px] tracking-wide text-stone-500 uppercase">Part temperatures</h4>
            <TemperatureChart result={result} />
          </div>
          <div>
            <h4 className="mb-2 text-[11px] tracking-wide text-stone-500 uppercase">Capability left</h4>
            <CapabilityChart result={result} />
          </div>
          <p className="text-[11px] text-stone-500">Click a chart to jump the playback there. Red dashed line: time of death.</p>
        </TabsContent>
        <TabsContent value="sweep" className="p-4">
          <Sweep key={result.build.id} />
        </TabsContent>
        <TabsContent value="notes" className="p-4">
          <Notes />
        </TabsContent>
      </Tabs>
    </div>
  );
}
