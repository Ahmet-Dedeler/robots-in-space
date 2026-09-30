"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { bodyOf, decodeConfig, useLab } from "@/lib/lab-store";
import { BODIES } from "@/sim/planets/bodies";
import { ConfigPanel } from "./ConfigPanel";
import { ResultsPanel } from "./ResultsPanel";
import { TimeBar } from "./TimeBar";

const Viewport = dynamic(() => import("./Viewport"), {
  loading: () => <div className="h-full w-full animate-pulse bg-[#6b4424]" />,
});

export function Lab() {
  const loadConfig = useLab((s) => s.loadConfig);
  const world = BODIES[useLab((s) => bodyOf(s.config.scenario))];

  // Restore a shared experiment from ?x=...
  useEffect(() => {
    const x = new URLSearchParams(location.search).get("x");
    const c = x && decodeConfig(x);
    if (c) loadConfig(c);
  }, [loadConfig]);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-white/5 px-4">
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-semibold tracking-tight text-amber-100">Venus Lab</span>
          <span className="hidden text-xs text-stone-500 sm:inline">What survives on {world.name === "Moon" ? "the Moon" : world.name}, and for how long. Real data, real physics, in your browser.</span>
        </div>
        <span className="font-mono text-[10px] text-stone-600">{world.blurb}</span>
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)_400px]">
        <aside className="order-2 min-h-0 overflow-y-auto border-white/5 lg:order-1 lg:border-r">
          <ConfigPanel />
        </aside>
        <section className="order-1 flex min-h-[55vh] flex-col lg:order-2 lg:min-h-0">
          <div className="min-h-0 flex-1">
            <Viewport />
          </div>
          <TimeBar />
        </section>
        <aside className="order-3 min-h-0 overflow-y-auto border-white/5 lg:border-l">
          <ResultsPanel />
        </aside>
      </main>
    </div>
  );
}
