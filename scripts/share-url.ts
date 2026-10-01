/**
 * Print a lab URL for a vehicle preset, e.g. for headless screenshots:
 *   npx tsx scripts/share-url.ts curiosity [body] [k=v ...scenario overrides]
 */
import { defaultScenario, encodeConfig } from "@/lib/lab-store";
import { vehicleById } from "@/sim/vehicles/library";
import type { BodyId } from "@/sim/planets/bodies";

const [id, body, ...rest] = process.argv.slice(2);
const v = vehicleById(id);
if (!v) throw new Error(`no vehicle ${id}`);
const scenario = { ...defaultScenario(v, (body as BodyId) || undefined) } as Record<string, unknown>;
for (const kv of rest) {
  const [k, val] = kv.split("=");
  scenario[k] = isNaN(Number(val)) ? val : Number(val);
}
const base = process.env.LAB_URL ?? "http://localhost:3217";
console.log(`${base}/?x=${encodeConfig({ baseId: v.id, build: v, scenario: scenario as never })}`);
