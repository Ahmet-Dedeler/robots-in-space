"use client";

/**
 * MuJoCo (official WASM bindings) loading for the browser: one module per
 * page, robot files cached in its in-memory filesystem, and a scene wrapper
 * that sets Venus gravity, CO2 density/viscosity and wind.
 */
import type { MainModule, MjData, MjModel } from "@mujoco/mujoco";
import type { PolicyJson } from "@/sim/robots/policy";

let modulePromise: Promise<MainModule> | null = null;

export function loadMujoco(): Promise<MainModule> {
  modulePromise ??= import("@mujoco/mujoco").then((m) =>
    m.default({ locateFile: (path: string) => `/mujoco/${path}` }),
  );
  return modulePromise;
}

const staged = new Map<string, Promise<PolicyJson>>();

/** Fetch a robot's MJCF, meshes and policy into MuJoCo's virtual FS (once). */
function stageRobot(mj: MainModule, robot: string): Promise<PolicyJson> {
  const existing = staged.get(robot);
  if (existing) return existing;
  const p = (async () => {
    const base = `/robots/${robot}`;
    const policy = (await fetch(`${base}/policy.json`).then((r) => r.json())) as PolicyJson;
    const xml = await fetch(`${base}/robot.xml`).then((r) => r.text());
    const dir = `/${robot}`;
    mj.FS.mkdirTree(`${dir}/meshes`, 0o777);
    mj.FS.writeFile(`${dir}/robot.xml`, xml);
    await Promise.all(
      policy.meshes.map(async (m) => {
        const buf = new Uint8Array((await fetch(`${base}/meshes/${m}`).then((r) => r.arrayBuffer())) as ArrayBuffer);
        mj.FS.writeFile(`${dir}/meshes/${m}`, buf);
      }),
    );
    return policy;
  })();
  staged.set(robot, p);
  return p;
}

export interface VenusMedium {
  gravity: number;
  density: number;
  viscosity: number;
  windMs: number;
}

export interface RobotSim {
  mj: MainModule;
  model: MjModel;
  data: MjData;
  policy: PolicyJson;
  dispose: () => void;
}

export async function createRobotSim(robot: "g1" | "h1", medium: VenusMedium): Promise<RobotSim> {
  const mj = await loadMujoco();
  const policy = await stageRobot(mj, robot);
  const scene = `<mujoco model="venus-${robot}">
  <include file="robot.xml"/>
  <option timestep="${policy.config.simulation_dt}" gravity="0 0 ${-medium.gravity}"
          density="${medium.density}" viscosity="${medium.viscosity}" wind="${medium.windMs} 0 0"/>
  <worldbody>
    <geom name="floor" type="plane" size="0 0 0.05" friction="0.9 0.005 0.0001"/>
  </worldbody>
</mujoco>`;
  mj.FS.writeFile(`/${robot}/scene.xml`, scene);
  const model = mj.MjModel.from_xml_path(`/${robot}/scene.xml`);
  const data = new mj.MjData(model);
  mj.mj_forward(model, data);
  return {
    mj,
    model,
    data,
    policy,
    dispose() {
      data.delete();
      model.delete();
    },
  };
}
