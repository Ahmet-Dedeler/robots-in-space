# Third-party notices

Venus Lab's own code is MIT licensed (see `LICENSE`). It includes or derives data from:

| What | Where | Source | License |
|---|---|---|---|
| Unitree G1 / H1 robot models (MJCF + meshes, decimated and split) and pretrained walking-policy weights | `public/robots/` | [unitreerobotics/unitree_rl_gym](https://github.com/unitreerobotics/unitree_rl_gym) | BSD 3-Clause, see `public/robots/LICENSE-unitree` |
| MuJoCo physics engine (WebAssembly, installed from npm and copied to `public/mujoco/` at install time) | `@mujoco/mujoco` | [google-deepmind/mujoco](https://github.com/google-deepmind/mujoco) | Apache 2.0 |
| Real-gas CO2 property table (generated) | `src/sim/data/co2-props.json` | [CoolProp](https://github.com/CoolProp/CoolProp) | MIT |
| Venus International Reference Atmosphere table | `src/sim/data/vira.ts` | Seiff et al. 1985, via [WoutSchaerlaecken/Venus_Balloon_Preliminary_Design](https://github.com/WoutSchaerlaecken/Venus_Balloon_Preliminary_Design) | published scientific data |

Material, component and vehicle numbers are from the cited handbooks, datasheets and papers noted next to each value in `src/sim/`.
Tesla, Optimus, Unitree, Caterpillar, CAT and Venera are names of their respective owners; this project is not affiliated with them.
