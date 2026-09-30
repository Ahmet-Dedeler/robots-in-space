"use client";

/** One MuJoCo (official WASM bindings) module per page. */
import type { MainModule } from "@mujoco/mujoco";

let modulePromise: Promise<MainModule> | null = null;

export function loadMujoco(): Promise<MainModule> {
  modulePromise ??= import("@mujoco/mujoco").then((m) =>
    m.default({ locateFile: (path: string) => `/mujoco/${path}` }),
  );
  return modulePromise;
}
