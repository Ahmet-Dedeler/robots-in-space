"use client";

/**
 * Left panel: pick a vehicle and a site, then mod the build. Every change
 * reruns the experiment immediately.
 */
import { RotateCcw } from "lucide-react";
import { useLab } from "@/lib/lab-store";
import { cn } from "@/lib/utils";
import { SITES } from "@/sim/env/atmosphere";
import {
  BATTERIES,
  CAMERAS,
  ELECTRONICS,
  LUBRICANTS,
  MAGNETS,
  SEALS,
  SOLDERS,
  WINDINGS,
} from "@/sim/materials/components";
import { INSULATIONS, MATERIALS, PCMS, STRUCTURAL, type MaterialId } from "@/sim/materials/materials";
import { TERRAINS, type TerrainId } from "@/sim/terrain/terrain";
import { VEHICLES } from "@/sim/vehicles/library";
import type { VehicleBuild } from "@/sim/vehicles/types";
import { FidelityBadge, Section, Segmented, SelectField, SliderField } from "./controls";

const opts = <T extends Record<string, { id: string; name: string }>>(db: T) =>
  Object.values(db).map((p) => ({ value: p.id as keyof T & string, label: p.name }));
const matOpts = (list: { id: string; name: string }[]) => list.map((m) => ({ value: m.id as MaterialId, label: m.name }));

const SKIN_MATERIALS = [...STRUCTURAL, MATERIALS.pcabs, MATERIALS.peek];

export function makeCooler(b: VehicleBuild, watts: number): VehicleBuild["cooler"] {
  if (watts <= 0) return undefined;
  // Hold the electronics 10 K under their rating; a good Stirling cooler reaches ~25% of Carnot.
  return { electricW: watts, carnotFraction: 0.25, setpointK: ELECTRONICS[b.electronics.part].warnK - 10 };
}

export function ConfigPanel() {
  const config = useLab((s) => s.config);
  const setVehicle = useLab((s) => s.setVehicle);
  const update = useLab((s) => s.updateBuild);
  const updateScenario = useLab((s) => s.updateScenario);
  const resetBuild = useLab((s) => s.resetBuild);
  const { build: b, scenario: sc } = config;
  const humanoid = b.mechanics.kind === "humanoid";
  const site = SITES.find((s) => s.elevationM === sc.elevationM && s.ground === sc.ground)?.id ?? SITES.find((s) => s.elevationM === sc.elevationM)?.id ?? "custom";

  return (
    <div className="text-sm">
      <Section title="Vehicle">
        <div className="grid gap-2">
          {VEHICLES.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setVehicle(v.id)}
              className={cn(
                "rounded-lg border px-3 py-2.5 text-left transition-colors",
                config.baseId === v.id
                  ? "border-amber-400/50 bg-amber-400/10"
                  : "border-white/5 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-stone-100">{v.name}</span>
                <FidelityBadge fidelity={v.fidelity} />
              </div>
              <p className="mt-0.5 text-[11px] leading-snug text-stone-400">{v.tagline}</p>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Site & scenario">
        <SelectField
          label="Landing site"
          value={site}
          options={[...SITES.map((s) => ({ value: s.id as string, label: s.name })), { value: "custom", label: "Custom elevation" }]}
          onChange={(id) => {
            const s = SITES.find((x) => x.id === id);
            if (s) updateScenario({ elevationM: s.elevationM, ground: s.ground });
          }}
          hint={SITES.find((s) => s.id === site)?.note}
        />
        <SelectField
          label="Ground"
          value={sc.ground}
          options={Object.values(TERRAINS).map((t) => ({ value: t.id as TerrainId, label: t.name }))}
          hint={TERRAINS[sc.ground].note}
          onChange={(g) => updateScenario({ ground: g })}
        />
        <SliderField
          label="Elevation"
          value={sc.elevationM / 1000}
          min={-2}
          max={11}
          step={0.1}
          format={(v) => `${v.toFixed(1)} km`}
          onChange={(v) => updateScenario({ elevationM: Math.round(v * 10) * 100 })}
        />
        <SliderField
          label="Surface wind"
          value={sc.windMs}
          min={0}
          max={3}
          step={0.1}
          format={(v) => `${v.toFixed(1)} m/s`}
          hint="Venera measured 0.3-1 m/s"
          onChange={(v) => updateScenario({ windMs: v })}
        />
        {b.descent && (
          <Segmented
            value={sc.start.kind}
            options={[
              { value: "descent", label: "Descend from 62 km" },
              { value: "surface", label: "Start on surface" },
            ]}
            onChange={(k) => updateScenario({ start: k === "descent" ? { kind: "descent", fromKm: 62 } : { kind: "surface" } })}
          />
        )}
        {humanoid && (
          <Segmented
            value={sc.activity}
            options={[
              { value: "walking", label: "Walking" },
              { value: "idle", label: "Standing" },
            ]}
            onChange={(a) => updateScenario({ activity: a })}
          />
        )}
      </Section>

      <Section
        title="Thermal protection"
        right={
          <button type="button" onClick={resetBuild} className="flex items-center gap-1 text-[11px] text-stone-500 hover:text-stone-300">
            <RotateCcw className="size-3" /> Reset build
          </button>
        }
      >
        <SelectField
          label={b.enclosure.kind === "sealed" ? "Insulation around hull" : "Insulation jackets (e-bay, battery)"}
          value={b.insulation.material}
          options={matOpts(INSULATIONS)}
          hint={MATERIALS[b.insulation.material].k + " W/m·K"}
          onChange={(m) => update((x) => ({ ...x, insulation: { ...x.insulation, material: m } }))}
        />
        <SliderField
          label="Insulation thickness"
          value={b.insulation.thicknessMm}
          min={0}
          max={150}
          format={(v) => `${v.toFixed(0)} mm`}
          onChange={(v) => update((x) => ({ ...x, insulation: { ...x.insulation, thicknessMm: v } }))}
        />
        <SelectField
          label="Heat sink (phase-change)"
          value={b.pcm?.material ?? ("none" as MaterialId)}
          options={[{ value: "none" as MaterialId, label: "None" }, ...matOpts(PCMS)]}
          onChange={(m) =>
            update((x) => ({ ...x, pcm: (m as string) === "none" ? undefined : { material: m, massKg: x.pcm?.massKg || 20 } }))
          }
        />
        {b.pcm && (
          <SliderField
            label="Heat-sink mass"
            value={b.pcm.massKg}
            min={0}
            max={200}
            format={(v) => `${v.toFixed(0)} kg`}
            onChange={(v) => update((x) => ({ ...x, pcm: x.pcm && { ...x.pcm, massKg: v } }))}
          />
        )}
        <SliderField
          label="Active cooler"
          value={b.cooler?.electricW ?? 0}
          min={0}
          max={3000}
          step={50}
          format={(v) => (v === 0 ? "off" : `${v.toFixed(0)} W`)}
          hint="Stirling heat pump on the e-bay"
          onChange={(v) => update((x) => ({ ...x, cooler: makeCooler(x, v) }))}
        />
        <SliderField
          label="Start temperature"
          value={b.initialTempK - 273.15}
          min={-80}
          max={40}
          format={(v) => `${v.toFixed(0)} °C`}
          hint="Pre-chilling buys time"
          onChange={(v) => update((x) => ({ ...x, initialTempK: v + 273.15 }))}
        />
      </Section>

      {b.enclosure.kind === "sealed" && (
        <Section title="Pressure hull">
          <SelectField
            label="Hull material"
            value={b.enclosure.hull.material}
            options={matOpts(STRUCTURAL)}
            onChange={(m) => update((x) => (x.enclosure.kind === "sealed" ? { ...x, enclosure: { ...x.enclosure, hull: { ...x.enclosure.hull, material: m } } } : x))}
          />
          <SliderField
            label="Wall thickness"
            value={b.enclosure.hull.thicknessMm}
            min={1}
            max={40}
            format={(v) => `${v.toFixed(0)} mm`}
            hint={`Radius ${(b.enclosure.hull.radiusM * 100).toFixed(0)} cm`}
            onChange={(v) => update((x) => (x.enclosure.kind === "sealed" ? { ...x, enclosure: { ...x.enclosure, hull: { ...x.enclosure.hull, thicknessMm: v } } } : x))}
          />
          <SelectField
            label="Seals"
            value={b.enclosure.seal}
            options={opts(SEALS)}
            onChange={(s) => update((x) => (x.enclosure.kind === "sealed" ? { ...x, enclosure: { ...x.enclosure, seal: s } } : x))}
          />
        </Section>
      )}

      <Section title="Structure">
        <SelectField
          label="Frame material"
          value={b.frame.material}
          options={matOpts(STRUCTURAL)}
          onChange={(m) => update((x) => ({ ...x, frame: { ...x.frame, material: m } }))}
        />
        <SelectField
          label="Outer shell material"
          value={b.skin.material}
          options={matOpts(SKIN_MATERIALS)}
          onChange={(m) => update((x) => ({ ...x, skin: { ...x.skin, material: m } }))}
        />
      </Section>

      <Section title="Electronics & power">
        <SelectField
          label="Electronics"
          value={b.electronics.part}
          options={opts(ELECTRONICS)}
          onChange={(p) => update((x) => ({ ...x, electronics: { ...x.electronics, part: p }, cooler: x.cooler && makeCooler({ ...x, electronics: { ...x.electronics, part: p } }, x.cooler.electricW) }))}
        />
        <SelectField
          label="Solder / packaging"
          value={b.electronics.solder}
          options={opts(SOLDERS)}
          onChange={(p) => update((x) => ({ ...x, electronics: { ...x.electronics, solder: p } }))}
        />
        <SelectField
          label="Battery chemistry"
          value={b.battery.part}
          options={opts(BATTERIES)}
          hint={`${BATTERIES[b.battery.part].whPerKg} Wh/kg · works ${(BATTERIES[b.battery.part].minOperatingK - 273.15).toFixed(0)} to ${(BATTERIES[b.battery.part].failK - 273.15).toFixed(0)} °C`}
          onChange={(p) => update((x) => ({ ...x, battery: { ...x.battery, part: p } }))}
        />
        <SliderField
          label="Battery capacity"
          value={b.battery.capacityWh}
          min={100}
          max={10000}
          step={50}
          format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kWh` : `${v.toFixed(0)} Wh`)}
          onChange={(v) => update((x) => ({ ...x, battery: { ...x.battery, capacityWh: v } }))}
        />
        {b.camera && (
          <SelectField label="Cameras" value={b.camera} options={opts(CAMERAS)} onChange={(c) => update((x) => ({ ...x, camera: c }))} />
        )}
      </Section>

      {b.motors && (
        <Section title="Actuators">
          <SelectField
            label="Motor magnets"
            value={b.motors.magnet}
            options={opts(MAGNETS)}
            onChange={(m) => update((x) => ({ ...x, motors: x.motors && { ...x.motors, magnet: m } }))}
          />
          <SelectField
            label="Winding insulation"
            value={b.motors.winding}
            options={opts(WINDINGS)}
            onChange={(m) => update((x) => ({ ...x, motors: x.motors && { ...x.motors, winding: m } }))}
          />
          <SelectField
            label="Joint lubricant"
            value={b.motors.lubricant}
            options={opts(LUBRICANTS)}
            onChange={(m) => update((x) => ({ ...x, motors: x.motors && { ...x.motors, lubricant: m } }))}
          />
          <SliderField
            label="Motor size vs stock"
            value={b.motors.sizeFactor}
            min={0.8}
            max={2}
            step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
            hint="Bigger = more torque, more mass"
            onChange={(v) => update((x) => ({ ...x, motors: x.motors && { ...x.motors, sizeFactor: v, massKg: (x.motors.massKg / x.motors.sizeFactor) * v } }))}
          />
        </Section>
      )}
    </div>
  );
}
