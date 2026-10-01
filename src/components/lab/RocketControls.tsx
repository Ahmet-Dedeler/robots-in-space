"use client";

/**
 * Config panel pieces for rocket landers: where the descent starts, how much
 * propellant is left for landing, and how the tanks are held up against the
 * air outside (the thing that kills every rocket on Venus).
 */
import { EARTH_GRAVITY } from "@/sim/constants";
import { bodyOf, useLab } from "@/lib/lab-store";
import { BODIES } from "@/sim/planets/bodies";
import { DESCENT_FROM_KM } from "@/sim/spacecraft/landing";
import { ENGINES, engineModel } from "@/sim/spacecraft/engines";
import { Section, Segmented, SliderField } from "./controls";

const fmtT = (kg: number) => (kg >= 1000 ? `${(kg / 1000).toFixed(kg >= 100_000 ? 0 : 1)} t` : `${Math.round(kg)} kg`);

/** "Descend from X km" vs "Start on surface". */
export function RocketStart() {
  const sc = useLab((s) => s.config.scenario);
  const updateScenario = useLab((s) => s.updateScenario);
  const body = bodyOf(sc);
  const km = DESCENT_FROM_KM[body];
  const label = body === "mars" ? `Entry from ${km} km` : body === "venus" ? `Descend from ${km} km` : `From ${km} km orbit`;
  return (
    <Segmented
      value={sc.start.kind}
      options={[
        { value: "descent", label },
        { value: "surface", label: "Start on surface" },
      ]}
      onChange={(k) => updateScenario({ start: k === "descent" ? { kind: "descent", fromKm: km } : { kind: "surface" } })}
    />
  );
}

export function RocketSection() {
  const b = useLab((s) => s.config.build);
  const sc = useLab((s) => s.config.scenario);
  const update = useLab((s) => s.updateBuild);
  const P = b.propulsion;
  if (!P) return null;
  const E = ENGINES[P.engine];
  const eng = engineModel(P.engine);
  const body = BODIES[bodyOf(sc)];
  // Ideal delta-v in vacuum (rocket equation) and thrust-to-weight on the ground here.
  const ispVac = eng.thrust(1, 0) / (eng.mdotFull * EARTH_GRAVITY);
  const dv = ispVac * EARTH_GRAVITY * Math.log((b.massKg + P.propellantKg) / b.massKg);
  const need = body.id === "mercury" ? 3300 : body.id === "moon" ? 1900 : body.id === "mars" ? 700 : 100;
  const setP = (patch: Partial<typeof P>) => update((x) => ({ ...x, propulsion: x.propulsion && { ...x.propulsion, ...patch } }));
  const setTanks = (patch: Partial<typeof P.tanks>) => update((x) => ({ ...x, propulsion: x.propulsion && { ...x.propulsion, tanks: { ...x.propulsion.tanks, ...patch } } }));

  return (
    <Section title="Landing">
      <SliderField
        label="Landing propellant"
        value={P.propellantKg}
        min={0}
        max={P.capacityKg}
        step={P.capacityKg > 100_000 ? 1000 : 50}
        format={fmtT}
        hint={`Δv ${(dv / 1000).toFixed(2)} km/s in vacuum · ${body.name} needs ~${(need / 1000).toFixed(1)} km/s`}
        onChange={(v) => setP({ propellantKg: v })}
      />
      <Segmented
        value={P.tanks.flood ? "flood" : "sealed"}
        options={[
          { value: "sealed", label: "Sealed tanks" },
          { value: "flood", label: "Flood empty tanks" },
        ]}
        onChange={(v) => setTanks({ flood: v === "flood" })}
      />
      {!P.tanks.flood && (
        <SliderField
          label="Tank pressure"
          value={P.tanks.pressureBar}
          min={1}
          max={20}
          step={0.5}
          format={(v) => `${v.toFixed(1)} bar`}
          hint="Thin tanks buckle once the air outside pushes harder"
          onChange={(v) => setTanks({ pressureBar: v })}
        />
      )}
      <p className="text-[11px] leading-snug text-stone-500">
        {P.landingEngines} × {E.name} for landing ({E.propellants}, {(E.pcPa / 1e5).toFixed(0)} bar chamber, {E.cycle}). Legs rated {P.legs.ratedMs} m/s.
        {P.tanks.flood ? " Empty main tanks are vented to the outside so they can't be crushed; the landing propellant sits in small header tanks." : ""}
      </p>
    </Section>
  );
}
