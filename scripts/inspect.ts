
import { vehicleById } from "../src/sim/vehicles/library";
import { runExperiment, formatDuration } from "../src/sim/mission/run";
{
  const id = process.env.V ?? "venera13";
  const b = vehicleById(id)!;
  const r = runExperiment(b, { elevationM: Number(process.env.EL ?? 1500), ground: (process.env.G as never) ?? "venera14", windMs: 0.5, start: process.env.S === "surface" ? { kind: "surface" } : { kind: "descent", fromKm: 62 }, activity: process.env.A === "walking" ? "walking" : "idle" });
  console.log(r.verdict.headline, "compute", r.computeMs.toFixed(0), "ms", "landed", r.verdict.landedS && formatDuration(r.verdict.landedS));
  for (const e of r.events) console.log(formatDuration(e.t).padStart(9), e.severity.padEnd(6), e.title, "-", e.detail ?? "");
  const s = r.series; const m = s.t.length;
  for (const k of [0, Math.floor(m*0.2), Math.floor(m*0.4), Math.floor(m*0.6), Math.floor(m*0.8), m-1])
    console.log(formatDuration(s.t[k]).padStart(9), "alt", (s.altitudeM[k]/1000).toFixed(1), "amb", (s.ambientK[k]-273).toFixed(0), r.nodes.map((n,i)=>`${n.id}:${(s.nodeK[i][k]-273).toFixed(0)}`).join(" "));
}
