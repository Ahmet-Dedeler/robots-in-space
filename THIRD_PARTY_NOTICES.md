# Third-party notices

Robots in Space Simulator's own code is MIT licensed (see `LICENSE`). It includes or derives data from:

| What | Where | Source | License |
|---|---|---|---|
| Unitree G1 / H1 robot models (MJCF + meshes, decimated and split) and pretrained walking-policy weights | `public/robots/` | [unitreerobotics/unitree_rl_gym](https://github.com/unitreerobotics/unitree_rl_gym) | BSD 3-Clause, see `public/robots/LICENSE-unitree` |
| Curiosity, Opportunity and Apollo Lunar Module 3D models (re-scaled, rigged, decimated) | `public/models/` | [nasa/NASA-3D-Resources](https://github.com/nasa/NASA-3D-Resources) | NASA media usage guidelines: not copyrighted, credit NASA/JPL-Caltech; no endorsement implied |
| MuJoCo physics engine (WebAssembly, installed from npm and copied to `public/mujoco/` at install time) | `@mujoco/mujoco` | [google-deepmind/mujoco](https://github.com/google-deepmind/mujoco) | Apache 2.0 |
| Real-gas CO2 property table (generated) | `src/sim/data/co2-props.json` | [CoolProp](https://github.com/CoolProp/CoolProp) | MIT |
| Venus International Reference Atmosphere table | `src/sim/data/vira.ts` | Seiff et al. 1985, via [WoutSchaerlaecken/Venus_Balloon_Preliminary_Design](https://github.com/WoutSchaerlaecken/Venus_Balloon_Preliminary_Design) | published scientific data |

| Starship Block 3 3D model (ship only; rescaled, decimated, rigged) | `public/models/starship.glb` | ["SpaceX Starship Block 3"](https://sketchfab.com/3d-models/6f6c6f88a3eb4b4d822fdca66733fbb2) by Clarence365 | CC BY 4.0 |
| Falcon 9 3D model (first stage only; rescaled, decimated, rigged) | `public/models/falcon9.glb` | ["Falcon 9 - SpaceX"](https://sketchfab.com/3d-models/394f7cf52d124bbd9db69f24d1ff2f08) by Stanley Creative | CC BY 4.0 |
| New Glenn 3D model (first stage only; rescaled, decimated, rigged) | `public/models/newglenn.glb` | ["Blue Origin New Glenn"](https://sketchfab.com/3d-models/60e49f5c126841469b7e5b97517e5271) by Clarence365 | CC BY 4.0 |
| Lunokhod 1 3D model (rover only; rescaled, decimated, rigged) | `public/models/lunokhod.glb` | ["Lunokhod 1"](https://sketchfab.com/3d-models/3f5a5f02ad53447b9dff335e42d2469c) by sheffrator | CC BY 4.0 |

CC BY 4.0: https://creativecommons.org/licenses/by/4.0/ — the viewport also credits the model on screen. New third-party models baked by `pnpm bake:models` (see `docs/models.md`) must be added here.

Material, component and vehicle numbers are from the cited handbooks, datasheets and papers noted next to each value in `src/sim/`.
Tesla, Optimus, Unitree, Caterpillar, CAT, SpaceX, Starship, Falcon, Blue Origin, New Glenn, NASA and Venera are names of their respective owners; this project is not affiliated with them.
