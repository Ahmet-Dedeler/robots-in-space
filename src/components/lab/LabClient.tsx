"use client";

import dynamic from "next/dynamic";

/**
 * The lab is a client-only app (WebGL, WASM, and a simulation whose float
 * results can differ in the last digit between server and browser engines).
 */
export const LabClient = dynamic(() => import("./Lab").then((m) => m.Lab), {
  ssr: false,
  loading: () => (
    <div className="grid h-dvh place-items-center bg-background">
      <div className="text-center">
        <div className="text-sm font-semibold text-amber-100">Robots in Space Simulator</div>
        <div className="mt-1 text-xs text-stone-500">Loading the worlds…</div>
      </div>
    </div>
  ),
});
