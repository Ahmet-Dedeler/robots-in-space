# Real 3D models

Status (2026-10-01): vehicles are drawn from real models, not shapes made up in three.js. Seven are in: NASA's own Curiosity, Opportunity and Apollo LM, and CC-BY models of Starship V3, the Falcon 9 booster, New Glenn's first stage and Lunokhod 1. Where no accurate model exists (Venera 13, Pragyan, Yutu-2, the Cat machines, IPEx) the vehicle keeps its stand-in drawn from published dimensions, and the reason is listed below.

## Pipeline

`pnpm bake:models [ids...]` runs `tools/bake_models.py` inside Blender (headless). Per model, from `tools/models.json`:

1. Download once into `tools/.cache/models/`. NASA files come straight from GitHub; Sketchfab needs `SKETCHFAB_API_TOKEN` (env or `.env.local`; get it at sketchfab.com/settings/password).
2. Pose animated sources at a chosen `frame` (NASA's rover files play their deploy sequence: frame 0 is the folded cruise configuration).
3. Drop helpers: cameras, lights, objects hidden in the viewport, and the manifest's `hide` (own name) / `hideTree` (subtree) patterns. Bake modifiers (geometry nodes) into plain meshes and strip constraints and animation.
4. Rotate into the lab frame and **scale to a published dimension** (`scale`), then compare every other published dimension in `check` and print OK/OFF. A wrong scale shows up as a mismatch.
5. Flatten to world space; split fused meshes into loose parts where asked (`split`); then rebuild a small rig: one empty per moving part at its real pivot (`rocker_L`, `bogie_R`, `steer_L0`, `wheel_R2`, `mast`...). Meshes are joined per rig node (fewer draw calls), decimated to `maxTris`, textures capped at 1024 px and exported as WebP inside `public/models/<id>.glb`.
6. Write `src/components/lab/scene/models.gen.json`: size, pivot positions (three.js frame: x forward, y up, z right; rockets: y up the stack, +x the windward/belly side), triangle count, credit, license, and the scale checks.

At runtime `scene/real-models.tsx` loads and clones a model (materials cloned per instance for heat glow) and `modelIdFor` maps a vehicle to it. A vehicle without a baked model, or a rover without rocker pivots, falls back to its stand-in. The viewport shows the model's credit and license bottom-left (CC-BY requires it).

## Models

| Lab vehicle | Model | Source | License | Rig |
|---|---|---|---|---|
| Curiosity (MSL) | Curiosity Rover (Clean) | [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Curiosity%20Rover%20(MSL)) | NASA media guidelines (not copyrighted) | rocker-bogie, corner steering, 6 wheels |
| Opportunity (MER-B) | Mars Exploration Rover | [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Mars%20Exploration%20Rover%20-%20Spirit%20and%20Opportunity) | NASA | rocker-bogie, corner steering, Pancam mast folds at night |
| Apollo LM | Apollo Lunar Module | [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Apollo%20Lunar%20Module) | NASA | static (the real legs were fixed) |
| Starship V3 | SpaceX Starship Block 3, Clarence365 (2026) | [Sketchfab](https://sketchfab.com/3d-models/6f6c6f88a3eb4b4d822fdca66733fbb2) | CC BY 4.0 | 4 flaps (trim in the skydive, fold for the burn), 3 sea-level + 3 vacuum Raptors (plumes from the real nozzle exits) |
| Falcon 9 booster | Falcon 9, Stanley Creative (made for Rocket Explorer) | [Sketchfab](https://sketchfab.com/3d-models/394f7cf52d124bbd9db69f24d1ff2f08) | CC BY 4.0 | 4 legs hinged at their base, deployed on final approach |
| New Glenn GS1 | Blue Origin New Glenn, Clarence365 (2026) | [Sketchfab](https://sketchfab.com/3d-models/60e49f5c126841469b7e5b97517e5271) | CC BY 4.0 | 7 BE-4s (centre + 2 light for landing); legs drawn stowed as modelled |
| Lunokhod 1 | Lunokhod 1, sheffrator | [Sketchfab](https://sketchfab.com/3d-models/3f5a5f02ad53447b9dff335e42d2469c) | CC BY 4.0 | 8 independently sprung wheels, lid closes at night |
| Unitree G1 / H1 (and "Optimus") | Unitree's own meshes | unitree_rl_gym | BSD-3 | MuJoCo (HumanoidView) |

Second stages, fairings, Super Heavy and the diorama Moon under Lunokhod are dropped by the bake (`hideTree` / `keep`).

Still stand-ins, and why:

- **Venera 13**: the only Venera 12-14 model (tashtego, CC-BY) is the whole spacecraft in cruise (bus, solar panels, entry sphere), without the lander itself. No other free model found (Sketchfab, Wikimedia Commons, NASA).
- **Pragyan**: the only CC model shows 4 wheels; Pragyan has 6 on a rocker-bogie. The other one says itself it's "not accurate".
- **Yutu-2**: the one CC model (Yutu) misses the published 1.5 × 1.0 × 1.1 m proportions by ~25%.
- **Cat 262D3**: the CC model is a 242D, a radial-lift machine; the MuJoCo rig follows the 262D3's vertical-lift arms, so the real arms would swing on the wrong arc. **299D3, D6, 320**: only photogrammetry scans (one fused mesh) or a toy, which can't follow the MuJoCo joints.
- **NASA IPEx**: no public model (RASSOR 2.0, its predecessor, is one fused 2M-triangle CAD mesh).
- **Mercury dawn crawler, sealed probe**: hypothetical, nothing real to copy.

## Accuracy checks (from the bake)

| Model | Scaled by | Checks |
|---|---|---|
| Curiosity | 2.2 m tall (NASA) | width 2.76 m vs 2.8 m (−1%); length 3.92 m incl. the deployed arm vs ~3 m body |
| Opportunity | 2.3 m wide (NASA) | height 1.60 m vs 1.5 m (+7%); length 1.97 m incl. the arm vs 1.6 m body |
| Apollo LM | 6.98 m tall (22 ft 11 in, Grumman) | landing-gear span 8.95 m vs 9.45 m (−5%); descent-engine exit 1.40 m across vs 1.37 m |
| Starship V3 | 52.1 m ship (124.4 m stack − 72.3 m booster) | body 9.1 m across vs 9 m; Raptor 3 SL exits 1.23 m, RVac 2.36 m; flaps 11.9 × 3.4 m aft, ~6.5 × 2.4 m forward (→ ~110 m² in the aero model) |
| Falcon 9 | modelled in cm (×0.01) | full stack 71.0 m vs 70 m (+1.4%); first stage + interstage 48.7 m vs ~47.7 m (+2%); legs 9.3 m |
| New Glenn | GS1 57.5 m (Blue Origin) | body 7.03 m across vs 7 m; BE-4 exits 2.34 m |
| Lunokhod 1 | wheel 0.51 m (0.365 units in the source) | track 1.79 m vs 1.6 m (+12%) |

The source scales were already right for the NASA rovers (×0.995, ×1.009); NASA's LM file is 1.39× too small and is corrected by the bake.

## Rigs in use

- Rovers (`scene/RealRoverView.tsx`): rocker-bogie solved per side on the model's own pivots (bogie keeps its two wheels down, rocker joins front wheel and bogie pivot, differential sets body pitch to the mean rocker angle and roll from the pivot heights). The corner wheels steer (Ackermann) toward the centre of the 4 m driving circle, as the real corner actuators do. Wheels spin at drive speed / radius. Opportunity's Pancam mast folds at night. Lunokhod: the body sits on the plane fitted through its eight wheel contacts, each wheel takes up its residual within ±12 cm of spring travel (guess), and the lid closes over the tub at night.
- Spacecraft (`scene/SpacecraftView.tsx`): the model sits on its base at y = 0 with the windward side toward +x, so the flight's pitch tilts it the right way. Plumes come from the rigged nozzle exits (`engine_*` pivots at the bottom of each bell, radius from the bell). Falcon 9's legs swing ~102° out and down about their base hinge on final approach (the angle that puts a 9.3 m leg's tip on the ground). Starship's flaps trim ±5° in antiphase while it falls belly-first and fold 40° leeward for the burn. Real V3 ships have no legs, so none are drawn (the sim still assumes guessed legs). Heat glow uses the hotter of the thermal run's skin and the entry-heating surface temperature (nothing glows below ~525 °C), and an additive shock-layer glow appears in front of the windward side above ~5 kW/m².

## Adding a model

1. Find a model with a license that allows redistribution (NASA, CC0, CC-BY). Note the author and page.
2. Add an entry to `tools/models.json`: `source`, `credit`, `license`, `page`, `forward`/`up` (source axes), `scale` (a published dimension with its source), `check` (other published dimensions), `hide`/`hideTree`, `maxTris`, `rig`.
3. Inspect the source hierarchy (object names and origins) to write the rig. A rig node takes meshes by name (`objects`), by position (`box`, lab-frame metres; with `objects` it only takes those names inside the box). Pivots: `origin` of a source object, `center` of a subtree, `part` (the node's own meshes: `{"z": "min"}` = bottom centre) or `at` (lab-frame metres). Mark unusable sources `"status": "rejected"` with the reason.
4. `pnpm bake:models <id>`, read the OK/OFF lines, and look at it in the lab. Add the source to `THIRD_PARTY_NOTICES.md`.
