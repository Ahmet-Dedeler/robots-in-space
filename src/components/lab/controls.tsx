"use client";

/** Small form primitives for the lab panels. */
import type { ReactNode } from "react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type { Fidelity } from "@/sim/vehicles/types";

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-white/5 px-4 py-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold tracking-[0.14em] text-amber-200/70 uppercase">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-stone-300">{label}</span>
        {hint && <span className="truncate text-[11px] text-stone-500">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function SelectField<T extends string>({
  value,
  options,
  onChange,
  label,
  hint,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-8 w-full rounded-md border border-white/10 bg-white/[0.04] px-2 text-xs text-stone-100 outline-none focus-visible:border-amber-400/60 focus-visible:ring-2 focus-visible:ring-amber-400/20"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-stone-900">
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-3">
        <Slider
          value={[value]}
          min={min}
          max={max}
          step={step}
          onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : (v as number))}
          className="flex-1"
        />
        <span className="w-16 text-right font-mono text-[11px] text-stone-200 tabular-nums">{format(value)}</span>
      </div>
    </Field>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-md border border-white/10 bg-white/[0.03] p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 rounded px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            value === o.value ? "bg-amber-500/20 text-amber-100" : "text-stone-400 hover:text-stone-200",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const FIDELITY_STYLE: Record<Fidelity, string> = {
  validated: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  calibrated: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  approximation: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  hypothetical: "border-violet-400/30 bg-violet-400/10 text-violet-300",
};

export const FIDELITY_HINT: Record<Fidelity, string> = {
  validated: "Checked against real mission data.",
  calibrated: "Tuned to reproduce a real mission; not an independent prediction.",
  approximation: "Built from public specs plus stated guesses.",
  hypothetical: "A design that does not exist; parts are real, the combination is not.",
};

export function FidelityBadge({ fidelity }: { fidelity: Fidelity }) {
  return (
    <span title={FIDELITY_HINT[fidelity]} className={cn("rounded border px-1.5 py-px text-[10px] font-medium tracking-wide uppercase", FIDELITY_STYLE[fidelity])}>
      {fidelity}
    </span>
  );
}
