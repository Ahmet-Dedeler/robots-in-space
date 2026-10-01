<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Robots in Space Simulator

Browser sandbox for physics experiments on other worlds: drop a robot, rover, lander or custom build onto Venus, the Moon, Mars or Mercury (or descend through Venus's atmosphere from 62 km) and see what fails and when. Not a textbook: every screen is an experiment with a verdict. Venus specifics are in `docs/plan.md`, the other worlds in `docs/planets.md`, the ground (terrain, rocks, soil, hazards) in `docs/geology.md`.

## Goal

Simulate reality as closely as we can, so people can plan for it. Before anyone sends a humanoid, a rover, a construction or mining machine, or a floating base to another world, they should be able to try it here first: which design survives, which style of robot works on which ground, what kills it first and when. It's for understanding reality and being prepared, and also for experimenting freely (custom builds, "what if" materials, robots dropped where they were never meant to go).

What that means in practice:

- **Science is the only compass.** Atmosphere, gravity, sunlight, ground, soil, materials, robots: every model is the best public data we can find (mission measurements, datasheets, papers, official specs) and says where it comes from. When nothing is measured, we make an explicit, labelled guess. Never invent precision.
- **What you see is what the physics sees.** Rendered ground, collision ground and survey numbers come from one function. If a robot trips, the user must be able to see on what (hazard map, fall marker), or be told it fell on open ground.
- **Validate against history.** Real missions are the test suite (Venera 13 descent and survival, Pragyan's first night, Yutu-2 waking up, Opportunity in the 2018 storm, Apollo bootprints and LRV ruts). A model that can't reproduce what happened isn't trusted for what hasn't.
- **Every result is an experiment with a verdict and an honest fidelity label** (validated / calibrated / approximation / hypothetical), so a "this works" from a guess never looks like one from data.
- **Keep improving realism** wherever it's the weakest link (today: wheel-soil contact for rovers, thermal-cycling fatigue, topographic shadowing at the poles; see the "Known gaps" sections in `docs/`).

## Layout

- `src/sim/` is the simulation. Pure TypeScript, no DOM or React. It must stay deterministic and runnable in Node (tests, sweeps, scripts).
  - `env/`: VIRA atmosphere, real-gas CO₂ table lookup, convection correlations
  - `materials/`: materials (strength vs temperature) and parts (failure temperatures)
  - `thermal/`: lumped thermal network solver (implicit, enthalpy-based PCM)
  - `vehicles/`: `VehicleBuild` presets and the build → thermal network generator
  - `mission/run.ts`: runs an experiment and returns the series, events and verdict
  - `planets/`: Moon, Mars, Mercury. `world.ts` is the environment the mission loop talks to (Venus is a pass-through to VIRA); `regolith.ts` ground temperatures, `solar.ts` the Sun, `mars.ts` Mars air/dust, `cold.ts` cold limits
  - `robots/policy.ts`: Unitree walking policy (LSTM + MLP) ported to TS
  - `robots/robot-world.ts`, `robots/skidsteer-world.ts`: MuJoCo worlds (terrain heightfield, buoyancy, spec mass, plastic hinges), shared by the browser and Node tests
  - `terrain/terrain.ts`: the ground of every world (Venera-derived plates for Venus; craters, rocks, boulders, ripples elsewhere). One function used for collision, rendering and the hazard survey, so never render terrain from anything else. `Terrain.isFlat` decides plane vs heightfield; anything with relief must be a heightfield
  - `terrain/soil.ts`: soil mechanics per ground (Bekker sinkage, Terzaghi bearing capacity) with sources; `terrain/survey.ts`: obstacle/slope survey, hazard classes, foot and wheel trafficability
  - `robots/trip.ts`: fall diagnosis (caught a rock / slope / lost balance on open ground / too weak), shared by the 3D view and the walking calibration
- `src/components/lab/` is the UI: panels, uPlot charts, and the R3F scene. MuJoCo runs through the official `@mujoco/mujoco` WASM bindings.
- `src/lib/lab-store.ts`: zustand store (config, result, playback, share links). `src/lib/ground-view.ts`: view-only state (hazard map toggle, last fall).
- `tools/` is Python (uv) for offline data baking: `bake_co2.py` (CoolProp) and `bake_robots.py` (meshes, policy weights, reference fixtures).
- `public/robots/` holds the baked robot assets. `public/mujoco/` is copied from node_modules on install (gitignored).

## Rules

- Every number in `sim/` needs a source or an explicit "guess"/"calibrated" note next to it. Keep the fidelity labels (validated / calibrated / approximation / hypothetical) honest.
- Don't break the validation tests (`pnpm test`): Venera 13 descent (~1 h, ~7.5 m/s) and surface survival (127 min ±25%), plus TS policy parity with PyTorch. If a model change moves Venera, recalibrate and say so in the vehicle notes.
- Same for the other worlds (`sim/planets/planets.test.ts`): Diviner lunar temperatures, Mercury hot/warm longitudes, Pragyan dies in its first night, Yutu-2 wakes up, Curiosity survives the 2018 storm, Opportunity doesn't.
- Keep Venus bit-identical when touching `planets/`: the `World` for Venus must not change any Venus number.
- Mutable engine objects (MuJoCo model/data, three.js objects touched per frame) live in refs, not React state or memo. The React Compiler lint rules enforce this.
- Colors for chart series are fixed per part role (`ROLE_COLOR`). Never cycle them.
- Venus ground heights must stay bit-identical too unless a change is deliberate (Venera calibration depends on them). Off-Venus, big horizon craters must never reach the experiment pad.
- After changing terrain, robots or masses, rerun `scripts/calibrate-walking.ts`: it also records *why* each robot falls, which the mission timeline reports.
- Running logs and findings go in `docs/`, not here.

## Commands

- `pnpm dev` starts the app (the dev server uses port 3217 in `.claude/launch.json`)
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`
- `pnpm bake:co2`, `pnpm bake:robots` (needs `uv`; re-run after changing tools/)
- `V=venera13 EL=1500 npx tsx scripts/inspect.ts` prints an experiment's timeline in the terminal (`G=venera14`, `S=surface`, `A=walking`)
- `npx tsx scripts/calibrate-walking.ts` reruns the walking calibration per robot and terrain. Rerun it after changing terrain, robots or masses.
- MuJoCo gotchas: MJCF angles default to degrees unless `<compiler angle="radian">`. MuJoCo applies no buoyancy. Frictionloss creeps under sustained load (so don't use it as a rigid lock).
