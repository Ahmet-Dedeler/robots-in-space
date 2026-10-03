"use client";

/**
 * Config panel pieces for the Moon, Mars and Mercury: the world picker,
 * the site/season/dust/time-of-day scenario, and the survival kit that
 * decides whether a vehicle lives through the night (solar array,
 * radioisotope heaters, electric heaters, hibernation, radiator).
 */
import { useLab, bodyOf } from "@/lib/lab-store";
import { cn } from "@/lib/utils";
import { BODIES, siteById, sitesFor, type BodyId } from "@/sim/planets/bodies";
import { clockForLocalHour, sunAt, terminatorSpeed } from "@/sim/planets/solar";
import { fmtHour, type PlanetScenario } from "@/sim/planets/world";
import { TERRAINS, terrainsFor, type TerrainId } from "@/sim/terrain/terrain";
import type { VehicleBuild } from "@/sim/vehicles/types";
import { Section, Segmented, SelectField, SliderField } from "./controls";
import { RocketStart } from "./RocketControls";

const WORLDS: BodyId[] = ["venus", "moon", "mars", "mercury"];

export function WorldPicker() {
  const body = useLab((s) => bodyOf(s.config.scenario));
  const setWorld = useLab((s) => s.setWorld);
  return (
    <Section title="World">
      <div className="grid grid-cols-4 gap-1">
        {WORLDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setWorld(id)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-md border px-1 py-2 text-[11px] transition-colors",
              body === id
                ? "border-amber-400/50 bg-amber-400/10 text-stone-50"
                : "border-white/5 bg-white/[0.02] text-stone-400 hover:border-white/15 hover:text-stone-200",
            )}
          >
            <span
              className="size-3.5 rounded-full shadow-inner"
              style={{
                background: `radial-gradient(circle at 35% 35%, ${BODIES[id].accent}, #0c0a09 95%)`,
              }}
            />
            {BODIES[id].name}
          </button>
        ))}
      </div>
      <p className="font-mono text-[10px] text-stone-500">{BODIES[body].blurb}</p>
    </Section>
  );
}

/** Vehicles built for this world first, then everything else (droppable anywhere). */
export function vehiclesFor<T extends VehicleBuild>(list: T[], body: BodyId): T[] {
  const home = (v: VehicleBuild) => (v.builtFor ? null : (v.home?.body ?? "venus"));
  return [...list.filter((v) => home(v) === body), ...list.filter((v) => home(v) !== body)];
}

export function HomeTag({ v }: { v: VehicleBuild }) {
  const body = useLab((s) => bodyOf(s.config.scenario));
  if (v.builtFor) return <span className="shrink-0 text-[10px] text-stone-500">built for {v.builtFor}</span>;
  const home = v.home?.body ?? "venus";
  if (home === body) return null;
  return <span className="shrink-0 text-[10px] text-stone-500">built for {BODIES[home].name}</span>;
}

const SEASONS: [number, string][] = [
  [0, "northern spring"],
  [90, "northern summer"],
  [180, "northern autumn"],
  [270, "northern winter · dust season"],
];

function seasonName(ls: number) {
  let best = SEASONS[0];
  for (const s of SEASONS) if (ls >= s[0]) best = s;
  return best[1];
}

export function PlanetSiteSection() {
  const sc = useLab((s) => s.config.scenario);
  const build = useLab((s) => s.config.build);
  const updateScenario = useLab((s) => s.updateScenario);
  const planet = sc.planet!;
  const body = BODIES[planet.body];
  const site = siteById(planet.siteId)!;
  const setPlanet = (p: Partial<PlanetScenario>) => updateScenario({ planet: { ...planet, ...p } });
  const mech = build.mechanics;
  const mobile = mech.kind !== "static" && mech.kind !== "spacecraft";
  const clock = { body, site, lsDeg: planet.lsDeg };
  // Sun at the chosen start hour (clock time 0 is local midnight).
  const sun = sunAt(clock, clockForLocalHour(clock, planet.localHour));
  const speed = mech.kind === "rover" ? mech.speedMs : mech.kind === "humanoid" ? 0.5 : mech.kind === "wheeled" ? 0.5 : 0;
  const vTerm = terminatorSpeed({ body, site, lsDeg: planet.lsDeg });

  return (
    <Section title="Site & scenario">
      <SelectField
        label="Landing site"
        value={planet.siteId}
        options={sitesFor(planet.body).map((s) => ({
          value: s.id,
          label: s.name,
        }))}
        onChange={(id) => {
          const s = siteById(id)!;
          updateScenario({
            elevationM: s.elevationM,
            ground: s.ground,
            planet: { ...planet, siteId: id },
          });
        }}
      />
      <p className="-mt-1 text-[11px] leading-snug text-stone-500">{site.note}</p>
      <SelectField
        label="Ground"
        value={sc.ground}
        options={terrainsFor(planet.body).map((t) => ({
          value: t.id as TerrainId,
          label: t.name,
        }))}
        hint={TERRAINS[sc.ground].note}
        onChange={(g) => updateScenario({ ground: g })}
      />
      <SliderField
        label="Start at local time"
        value={planet.localHour}
        min={0}
        max={23.75}
        step={0.25}
        format={fmtHour}
        hint={site.shadowed ? "No sunlight here, ever" : `Sun ${sun.elevationDeg.toFixed(0)}° up`}
        onChange={(v) => setPlanet({ localHour: v })}
      />
      {planet.body === "mars" && (
        <>
          <SliderField
            label="Season"
            value={planet.lsDeg}
            min={0}
            max={355}
            step={5}
            format={(v) => `Ls ${v.toFixed(0)}°`}
            hint={seasonName(planet.lsDeg)}
            onChange={(v) => setPlanet({ lsDeg: v })}
          />
          <SliderField
            label="Dust opacity τ"
            value={planet.dustTau}
            min={0.2}
            max={12}
            step={0.1}
            format={(v) => v.toFixed(1)}
            hint={planet.dustTau >= 8 ? "Global storm (2018: 10.8)" : planet.dustTau >= 3 ? "Regional storm" : "Normal skies ~0.5"}
            onChange={(v) => setPlanet({ dustTau: v })}
          />
          <SliderField
            label="Surface wind"
            value={sc.windMs}
            min={0}
            max={25}
            step={0.5}
            format={(v) => `${v.toFixed(1)} m/s`}
            hint="Typical 2-10 m/s; thin air pushes like a breeze"
            onChange={(v) => updateScenario({ windMs: v })}
          />
        </>
      )}
      {mech.kind === "spacecraft" && <RocketStart />}
      {mobile && (
        <Segmented
          value={sc.activity}
          options={[
            {
              value: "walking",
              label: mech.kind === "humanoid" ? "Walking" : "Driving",
            },
            {
              value: "idle",
              label: mech.kind === "humanoid" ? "Standing" : "Parked",
            },
          ]}
          onChange={(a) => updateScenario({ activity: a })}
        />
      )}
      {mobile && !site.shadowed && (
        <div className="space-y-1.5">
          <Segmented
            value={planet.chaseSun ? "chase" : "stay"}
            options={[
              { value: "stay", label: "Stay here" },
              { value: "chase", label: "Chase the Sun" },
            ]}
            onChange={(v) => setPlanet({ chaseSun: v === "chase" })}
          />
          <p className="text-[11px] leading-snug text-stone-500">
            The day-night line moves at {vTerm >= 1 ? `${vTerm.toFixed(1)} m/s` : `${(vTerm * 100).toFixed(0)} cm/s`} here; this vehicle drives at{" "}
            {speed >= 1 ? `${speed.toFixed(1)} m/s` : `${(speed * 100).toFixed(0)} cm/s`}.{" "}
            {speed >= vTerm
              ? "Fast enough to hold its local time forever."
              : `Driving west only stretches the day ${(1 / Math.max(0.001, 1 - speed / vTerm)).toFixed(2)}×.`}
          </p>
        </div>
      )}
    </Section>
  );
}

const MOUNTS: {
  value: NonNullable<VehicleBuild["solar"]>["mount"];
  label: string;
}[] = [
  { value: "horizontal", label: "Flat" },
  { value: "tracking", label: "Tracking" },
  { value: "vertical", label: "Vertical" },
];

export function SurvivalKitSection() {
  const b = useLab((s) => s.config.build);
  const update = useLab((s) => s.updateBuild);
  const solar = b.solar;
  return (
    <Section title="Night survival & power">
      <SliderField
        label="Solar array"
        value={solar?.areaM2 ?? 0}
        min={0}
        max={6}
        step={0.1}
        format={(v) => (v === 0 ? "none" : `${v.toFixed(1)} m²`)}
        hint={solar ? `${(solar.efficiency * 100).toFixed(0)}% cells` : "Triple-junction, 28%"}
        onChange={(v) =>
          update((x) => ({
            ...x,
            solar:
              v <= 0
                ? undefined
                : {
                    areaM2: v,
                    efficiency: x.solar?.efficiency ?? 0.28,
                    mount: x.solar?.mount ?? "tracking",
                  },
          }))
        }
      />
      {solar && (
        <Segmented
          value={solar.mount}
          options={MOUNTS}
          onChange={(m) =>
            update((x) => ({
              ...x,
              solar: x.solar && { ...x.solar, mount: m },
            }))
          }
        />
      )}
      <SliderField
        label="Radioisotope heater units"
        value={b.rhuW ?? 0}
        min={0}
        max={120}
        step={1}
        format={(v) => (v === 0 ? "none" : `${v.toFixed(0)} W`)}
        hint="Pu-238 pellets, ~1 W each"
        onChange={(v) => update((x) => ({ ...x, rhuW: v || undefined }))}
      />
      <SliderField
        label="Electric heaters"
        value={b.heaters?.electricW ?? 0}
        min={0}
        max={200}
        step={5}
        format={(v) => (v === 0 ? "none" : `${v.toFixed(0)} W`)}
        hint="Hold e-bay & battery above -30 °C"
        onChange={(v) =>
          update((x) => ({
            ...x,
            heaters: v <= 0 ? undefined : { electricW: v, setpointK: x.heaters?.setpointK ?? 243.15 },
          }))
        }
      />
      <SliderField
        label="Radiator"
        value={b.radiator?.areaM2 ?? 0}
        min={0}
        max={2}
        step={0.05}
        format={(v) => (v === 0 ? "none" : `${v.toFixed(2)} m²`)}
        hint="Opens above +25 °C to dump heat"
        onChange={(v) =>
          update((x) => ({
            ...x,
            radiator: v <= 0 ? undefined : { areaM2: v, openAboveK: x.radiator?.openAboveK ?? 298.15 },
          }))
        }
      />
      <Segmented
        value={b.hibernate ? "sleep" : "awake"}
        options={[
          { value: "awake", label: "Stay awake at night" },
          { value: "sleep", label: "Hibernate" },
        ]}
        onChange={(v) =>
          update((x) => ({
            ...x,
            hibernate: v === "sleep" ? { sleepW: x.hibernate?.sleepW ?? 1 } : undefined,
          }))
        }
      />
    </Section>
  );
}
