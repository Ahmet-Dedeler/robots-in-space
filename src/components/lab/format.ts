import type { Severity } from "@/sim/mission/run";
import type { Role } from "@/sim/vehicles/thermal-model";

export const fmtC = (k: number) => `${(k - 273.15).toFixed(0)} °C`;
export const fmtBar = (pa: number) =>
  pa < 1 ? "vacuum" : pa >= 1e5 ? `${(pa / 1e5).toFixed(pa > 1e6 ? 0 : 1)} bar` : `${(pa / 100).toFixed(pa < 1000 ? 1 : 0)} hPa`;

/** T+ clock: 0:45, 12:03, 1:02:33, 2d 03:14. */
export function fmtClock(s: number): string {
  const sign = s < 0 ? "-" : "";
  s = Math.abs(s);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const pad = (x: number) => String(x).padStart(2, "0");
  if (d > 0) return `${sign}${d}d ${pad(h)}:${pad(m)}`;
  if (h > 0) return `${sign}${h}:${pad(m)}:${pad(sec)}`;
  return `${sign}${m}:${pad(sec)}`;
}

/**
 * Categorical colors by part role (dark-surface steps of the validated
 * reference palette). Fixed per entity so a part keeps its color across
 * charts and vehicles. Roles that never appear on the same vehicle share a
 * slot: motors (robots) / payload (sealed craft), camera / tyres, hull /
 * hydraulics.
 */
export const ROLE_COLOR: Record<Role, string> = {
  electronics: "#3987e5",
  battery: "#d95926",
  motors: "#199e70",
  payload: "#199e70",
  frame: "#c98500",
  skin: "#d55181",
  hull: "#008300",
  pcm: "#9085e9",
  camera: "#e66767",
  tires: "#e66767",
  hydraulics: "#008300",
};

export const AMBIENT_COLOR = "#8a847c";

export const SEVERITY_STYLE: Record<Severity, { dot: string; text: string; label: string }> = {
  info: { dot: "bg-sky-400", text: "text-sky-300", label: "Info" },
  warn: { dot: "bg-amber-400", text: "text-amber-300", label: "Warning" },
  fail: { dot: "bg-orange-500", text: "text-orange-300", label: "Failure" },
  fatal: { dot: "bg-red-500", text: "text-red-300", label: "Fatal" },
};

/** Short legend names per role (full names live in the Model tab). */
export const ROLE_SHORT: Record<Role, string> = {
  skin: "Shell",
  frame: "Frame",
  hull: "Hull",
  motors: "Motors",
  electronics: "E-bay",
  battery: "Battery",
  camera: "Cameras",
  pcm: "Heat sink",
  payload: "Internals",
  tires: "Tyres",
  hydraulics: "Hydraulics",
};
