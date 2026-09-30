/**
 * Displaced volume for buoyancy.
 *
 * On Venus the air at the surface is 65 kg/m^3, so buoyancy is a few percent
 * of weight and must be counted. What displaces the gas depends on the body:
 * - Sealed craft: the whole outer envelope (the hot gas cannot get in).
 * - Open bodies (every real robot): 92-bar CO2 floods every cavity, so only
 *   the solid material displaces gas: sum of part masses / part densities.
 */
import { BATTERIES } from "../materials/components";
import { MATERIALS } from "../materials/materials";
import type { VehicleBuild } from "./types";

/** Densities of lumped parts that aren't a single material [kg/m^3]. */
const PART_DENSITY = { motors: 5000, electronics: 1500, battery: 2500, payload: 1000, other: 3000 };

export function displacedVolumeM3(b: VehicleBuild): number {
  if (b.enclosure.kind === "sealed") {
    if (b.volumeM3) return b.volumeM3;
    const r = b.enclosure.hull.radiusM + b.insulation.thicknessMm / 1000;
    return (4 / 3) * Math.PI * r ** 3;
  }
  const batteryMass = b.battery.capacityWh / BATTERIES[b.battery.part].whPerKg;
  const parts: [number, number][] = [
    [b.skin.massKg, MATERIALS[b.skin.material].density],
    [b.frame.massKg, MATERIALS[b.frame.material].density],
    [b.electronics.massKg, PART_DENSITY.electronics],
    [batteryMass, PART_DENSITY.battery],
    [b.payloadMassKg, PART_DENSITY.payload],
  ];
  if (b.motors) parts.push([b.motors.massKg, PART_DENSITY.motors]);
  if (b.pcm) parts.push([b.pcm.massKg, MATERIALS[b.pcm.material].density]);
  const listed = parts.reduce((s, [m]) => s + m, 0);
  // Wiring, fasteners, gearboxes etc. not itemised in the build.
  if (b.massKg > listed) parts.push([b.massKg - listed, PART_DENSITY.other]);
  return parts.reduce((s, [m, rho]) => s + m / rho, 0);
}
