"use client";

/**
 * The "Ground" tab: what this patch of ground is made of and what it does to
 * the vehicle on it. Survey of the 14 x 14 m physics patch (obstacles, slopes),
 * soil mechanics with sources, and the selected vehicle's foot or wheel
 * pressure, sinkage and bearing margin. Same terrain function as the physics.
 */
import { useMemo } from "react";
import { useLab } from "@/lib/lab-store";
import { useGroundView } from "@/lib/ground-view";
import { walkingFor } from "@/sim/mission/run";
import { surfaceMedium } from "@/sim/planets/world";
import { SOILS } from "@/sim/terrain/soil";
import { STEP_BANDS, survey, trafficability } from "@/sim/terrain/survey";
import { TERRAINS, terrain, type TerrainStyle } from "@/sim/terrain/terrain";
import { FIDELITY_HINT, FidelityBadge } from "./controls";

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/5 py-1">
      <span className="text-stone-400">{label}</span>
      <span className="text-right">
        <span className="font-mono text-stone-100 tabular-nums">{value}</span>
        {sub && <span className="ml-1.5 text-[10px] text-stone-500">{sub}</span>}
      </span>
    </div>
  );
}

const cm = (m: number) => (m < 0.01 ? `${(m * 1000).toFixed(m < 0.001 ? 1 : 0)} mm` : `${(m * 100).toFixed(m < 0.1 ? 1 : 0)} cm`);
const kPa = (p: number) => (p >= 1e6 ? `${(p / 1e6).toFixed(1)} MPa` : `${(p / 1000).toFixed(p < 1e4 ? 1 : 0)} kPa`);

export function GroundPanel() {
  const ground = useLab((s) => s.config.scenario.ground);
  const scenario = useLab((s) => s.config.scenario);
  const build = useLab((s) => s.config.build);
  const setHazards = useGroundView((s) => s.setHazards);
  const hazards = useGroundView((s) => s.hazards);
  const style = TERRAINS[ground] as TerrainStyle;
  const soil = SOILS[style.soil];
  const gravity = surfaceMedium(scenario).gravity;
  const s = useMemo(() => survey(terrain(ground)), [ground]);
  const tr = trafficability(build, soil, gravity);
  const gait = build.mechanics.kind === "humanoid" ? walkingFor(build, ground) : null;

  const causeText: Record<string, string> = {
    obstacle: "catches a foot on rocks / plate edges",
    slope: "loses footing on the slope",
    balance: "loses balance on open ground (not the rocks)",
    weak: "legs too weak",
  };

  return (
    <div className="space-y-5 text-xs leading-relaxed text-stone-300">
      <div>
        <div className="mb-1 flex items-center gap-2">
          <span className="font-medium text-stone-50">{style.name}</span>
          <FidelityBadge fidelity={style.fidelity} />
        </div>
        <p className="text-stone-400">{style.note}</p>
        <p className="mt-1 text-[11px] text-stone-500">{FIDELITY_HINT[style.fidelity]}</p>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <h4 className="text-[11px] tracking-wide text-stone-500 uppercase">Patch survey · {s.areaM2.toFixed(0)} m² under the robot</h4>
          <button type="button" onClick={() => setHazards(!hazards)} className="text-[11px] text-amber-300/90 hover:text-amber-200">
            {hazards ? "hide map" : "show on map"}
          </button>
        </div>
        <Row label={`Obstacles > ${cm(STEP_BANDS[1])}`} value={`${s.countPer100[1].toFixed(1)}`} sub="per 100 m²" />
        <Row label={`Obstacles > ${cm(STEP_BANDS[2])}`} value={`${s.countPer100[2].toFixed(1)}`} sub="per 100 m²" />
        <Row label="Tallest obstacle" value={cm(s.tallestM)} />
        <Row label={`Area with steps > ${cm(STEP_BANDS[0])}`} value={`${(s.coverAbove[0] * 100).toFixed(1)}%`} />
        <Row label="Slope (0.5 m baseline)" value={`${s.slopeMeanDeg.toFixed(1)}° mean`} sub={`95% < ${s.slopeP95Deg.toFixed(0)}°`} />
        <Row label="Soil surface low to high" value={cm(s.reliefRangeM)} sub="over the patch" />
      </div>

      <div>
        <h4 className="mb-1 flex items-center gap-2 text-[11px] tracking-wide text-stone-500 uppercase">
          Soil · {soil.name} <FidelityBadge fidelity={soil.fidelity} />
        </h4>
        <Row label="Bulk density" value={`${soil.densityKgM3} kg/m³`} />
        <Row label="Cohesion" value={soil.cohesionPa >= 1e4 ? kPa(soil.cohesionPa) : `${(soil.cohesionPa / 1000).toFixed(2)} kPa`} />
        <Row label="Internal friction angle" value={`${soil.frictionDeg}°`} />
        {"bekker" in soil && soil.bekker ? (
          <Row label="Bekker n · kc · kφ" value={`${soil.bekker.n} · ${(soil.bekker.kc / 1000).toFixed(2)} · ${(soil.bekker.kphi / 1000).toFixed(0)}`} sub="kN/m^(n+1), kN/m^(n+2)" />
        ) : "bearingPa" in soil && soil.bearingPa ? (
          <Row label="Measured bearing strength" value={`${kPa(soil.bearingPa[0])} - ${kPa(soil.bearingPa[1])}`} />
        ) : null}
        <p className="mt-1 text-[11px] text-stone-500">{soil.source}</p>
      </div>

      {tr && (
        <div>
          <h4 className="mb-1 text-[11px] tracking-wide text-stone-500 uppercase">
            {build.name} on this ground · {gravity.toFixed(2)} m/s²
          </h4>
          <Row label={`Load per ${tr.contact.label}`} value={`${tr.loadN.toFixed(0)} N`} sub={tr.contact.count > 1 ? `${tr.contact.count} share the weight` : "single support"} />
          <Row label="Ground pressure" value={kPa(tr.pressurePa)} sub={tr.contact.diameterM ? `${cm(tr.contact.diameterM)} x ${cm(tr.contact.widthM)} ${tr.contact.label}` : `${cm(tr.contact.lengthM!)} x ${cm(tr.contact.widthM)} sole`} />
          <Row
            label="Static sinkage"
            value={"bekker" in soil && soil.bekker ? `${tr.utilisation > 1 ? "> " : ""}${cm(tr.sinkageM)}` : "≈ 0"}
            sub={"bekker" in soil && soil.bekker ? (tr.utilisation > 1 ? "Bekker; more once the soil shears" : "Bekker") : "stiff ground"}
          />
          <Row label="Bearing capacity" value={kPa(tr.bearingPa)} sub={`${Math.round(tr.utilisation * 100)}% used`} />
          <div
            className={
              tr.verdict === "firm" ? "mt-1.5 text-emerald-300" : tr.verdict === "sinks" ? "mt-1.5 text-amber-300" : "mt-1.5 text-red-300"
            }
          >
            {tr.verdict === "firm"
              ? "Firm footing: the soil carries it with margin."
              : tr.verdict === "sinks"
                ? "Sinks in: expect high rolling resistance and digging under slip."
                : "Bearing capacity exceeded at the surface: it punches in until deeper, denser soil carries it. Expect deep prints, and wheels that dig in under slip."}
          </div>
          {gravity < 4 && (
            <p className="mt-1 text-[11px] text-stone-500">
              Low gravity cuts both sides: the {tr.contact.label} presses less, but the soil&apos;s frictional strength also scales with g (grains weigh less).
            </p>
          )}
          <p className="mt-1 text-[11px] text-stone-500">Contact: {tr.contact.source}. Static load only; slip-sinkage and dynamic footfalls push deeper.</p>
        </div>
      )}

      {gait && (
        <div>
          <h4 className="mb-1 text-[11px] tracking-wide text-stone-500 uppercase">Walking test (MuJoCo, 3 seeds x 15 s)</h4>
          {gait.walksAtFull ? (
            <p>
              Walks at {gait.metersPerS.toFixed(2)} m/s; falls once torque drops below {Math.round((gait.minTorque ?? 0) * 100)}%.
            </p>
          ) : (
            <p>
              Falls after ~{gait.meanTripS?.toFixed(1)} s on average. Most common cause: <span className="text-stone-50">{causeText[gait.tripCause ?? "obstacle"]}</span>.
            </p>
          )}
        </div>
      )}

      <div>
        <h4 className="mb-1 text-[11px] tracking-wide text-stone-500 uppercase">Sources</h4>
        <p className="text-stone-400">{style.sources}</p>
      </div>
    </div>
  );
}
