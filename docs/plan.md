# Robots in Space Simulator: plan (Venus roadmap; other worlds in planets.md)

A browser sandbox for running experiments on Venus. You pick a thing (Optimus, a CAT truck, Venera 13, a balloon, Starship, or your own build), pick where it goes (surface, descent, cloud layer), run it, and see what happens and when: it walks, it drifts, it overheats, its motors lose torque, its frame sags, its electronics die. It isn't a textbook. The output of every run is a **failure timeline + telemetry**, and runs can be compared and swept.

Status (2026-10-01):
- **Built:** Phase 0 and the Phase 1 MVP (surface drop test), plus Venera-style descent from Phase 2 and the sweep/compare/share parts of Phase 4.
- **Stack:** Next.js 16 instead of Vite (decided with Ahmet).
- **Next up:** Starship / rocket engines vs ambient pressure, the cloud layer (balloons), and VCD data.

---

## 1. Does this already exist?

No. Pieces exist, the combination doesn't.

| Thing | What it does | Gap |
|---|---|---|
| [hackiku/veenie](https://github.com/hackiku/veenie) ([live](https://veenie.space/lab), [LPSC 2026 abstract](https://www.hou.usra.edu/meetings/lpsc2026/pdf/2024.pdf)) | Browser Venus **atmospheric flight** engine. TS, RK4 in Web Workers, SvelteKit + Threlte. VIRA atmosphere 0–100 km, cloud opacity, superrotation winds, He permeation, envelope thermal, ISRU. Claims 1.4% error vs VEGA-1 float altitude. Vehicle configs: VEGA, HAVOC, EVE, MIT/JPL aerobot. | No surface, no robots, no contact physics, no electronics/material failure. Last push 2026-03. Best thing to steal from for the cloud layer. |
| Venus: The Last Ascent, VENERA 31 (Steam) | Games with Venus themes | Arcade physics, not real |
| KSP + Realistic Atmospheres / Kerbal Weather Project | Denser Eve, GCM data into a game | KSP aero, no thermal/material model |
| [AMAT](https://github.com/athulpg007/AMAT) | Python entry/descent/aerocapture + heating, has Venus | Stops at descent. Good reference for our descent module. |
| JPL FLOATS | Venus balloon trajectory sim | Internal, papers only |
| MATLAB Simscape Venus rover study ([Springer 2026](https://link.springer.com/chapter/10.1007/978-3-032-05754-9_1)) | Single jumping rover | Desktop, one-off |
| NASA GRAM Suite (Venus-GRAM) | Engineering atmosphere w/ dispersions | Request-only C++ from software.nasa.gov; [GRAMSuite.jl](https://github.com/Space-FALCON-Lab/GRAMSuite.jl) wraps it |

**The original part is the surface one: a robot/vehicle sim where heat, pressure and materials feed back into the mechanics.** Nobody has that in a browser, or open at all as far as I could find.

---

## 2. What actually decides the answer on Venus

Most "would X survive" answers are decided by heat and materials. The rigid-body mechanics mostly aren't the problem. So the engine has to be multi-physics, and each part runs on its own timescale.

Surface conditions: ~737 K (464 °C), ~9.2 MPa (92 bar), CO₂ ≈ 65 kg/m³, g = 8.87 m/s², wind 0.3–1 m/s, dim orange light.

Back-of-envelope numbers (my own, to be confirmed by the sim):

- **Wind:** 1 m/s on the surface pushes like ~7.4 m/s on Earth (√(65/1.2)). Walking-speed drag on a humanoid is ~25 N, about 4% of weight. Buoyancy is ~6.5% of a water-density body. Mechanically, walking works.
- **Motors:** NdFeB magnets (every Optimus/Unitree actuator) are rated to 80–230 °C and have a Curie point of ~310–370 °C. At 464 °C they demagnetize permanently. SmCo tops out ~350 °C. No off-the-shelf PM motor survives without active cooling.
- **Frame:** Al 6061-T6 keeps under ~5–10% of its room-temperature yield at 400 °C+. An aluminum robot sags. Ti-6Al-4V and Inconel are fine.
- **Electronics:** commercial Si is rated to 85 °C, automotive to 125–150 °C, SOI to ~250–300 °C. SiC JFET ICs ran 60 days in NASA's GEER Venus chamber (LLISSE). SAC solder melts at 217 °C.
- **Batteries:** Li-ion separators go at ~130 °C and then thermal runaway. You'd need thermal/molten-salt chemistries.
- **Heat input:** supercritical CO₂ at 92 bar convects heat far better than Earth air, so passive insulation only buys time. Venera 13 had a Ti pressure hull, was pre-chilled, and carried phase-change material. It survived **127 min** (32 were planned).
- **Starship:** belly-flop terminal velocity near the surface is roughly √(2·100t·8.87 / (65·1.2·450 m²)) ≈ **7 m/s**. The atmosphere nearly lands it for you. Raptor is the problem: ambient pressure × nozzle exit area ≈ 92 bar × 1.3 m² ≈ 12 MN of back-pressure against ~2.3 MN of rated thrust. The nozzle flow separates and thrust collapses. That's a good first "surprising result" experiment.

These are hypotheses. The sim should reproduce or overturn them with real models.

---

## 3. Architecture

Everything runs client-side. Headless physics runs in Web Workers, separate from the renderer, so sweeps can run hundreds of headless runs in parallel.

```
            ┌──────────────── Environment ────────────────┐
            │ atm(alt, lat, localTime) → T, P, ρ, wind,   │
            │   solar/IR flux, H2SO4 cloud density         │
            │ CO2 real-gas props (ρ, cp, k, μ) at (P,T)    │
            │ terrain (Magellan DEM + procedural rocks)    │
            └───────────────┬─────────────────────────────┘
                            │
   ┌────────────────────────┼─────────────────────────┐
   ▼                        ▼                         ▼
Mechanics (fast, ms)    Thermal network (s–h)     Trajectory (s–h)
MuJoCo WASM:            lumped nodes: shell,      RK4 3-DOF/6-DOF:
 robots, rovers,        insulation, e-bay,        entry, parachutes,
 contacts, fluid        battery, motors, PCM.     balloons, airships,
 drag/buoyancy/wind     conduction/convection/    retro-propulsion
                        radiation, internal heat
   ▲                        │                         │
   └──── coupling ──────────┤                         │
     motor Kt ← magnet T    ▼                         ▼
     joint limp ← e-death  Materials & failure DB → Event timeline
     stiffness ← metal T   (per-component limits,    "T+08:12 NdFeB demag,
                            strength-vs-T curves)      hip torque −60%"
```

### Engines and libraries (checked)

- **Mechanics: MuJoCo, official WASM bindings** (`@mujoco/mujoco` on npm, maintained by DeepMind in `google-deepmind/mujoco/wasm`, Apache-2.0). It already has what Venus needs: `gravity`, medium `density`/`viscosity`, a global `wind` vector, and the per-geom **ellipsoid fluid model** (drag, lift, Magnus). See the [fluid docs](https://mujoco.readthedocs.io/en/stable/computation/fluid.html). [zalo/mujoco_wasm](https://github.com/zalo/mujoco_wasm) is a working browser demo to copy from.
- **Robot models:** [MuJoCo Menagerie](https://github.com/google-deepmind/mujoco_menagerie) has Unitree G1/H1, Apptronik Apollo, Berkeley Humanoid, Fourier N1, Spot, ANYmal, and arms. **Optimus has no public model.** We build an approximate MJCF from published specs (≈1.73 m, ≈57–73 kg, actuator count) and label it "approximation".
- **Walking controllers:** use RL policies trained in [MuJoCo Playground](https://github.com/google-deepmind/mujoco_playground), export them to ONNX and run them in the browser with `onnxruntime-web`. Experiment built in for free: a policy trained at 1 g on Earth gets dropped into 0.9 g with a 65 kg/m³ medium. Does it still walk? Retrain offline under Venus conditions and compare.
- **Real-gas CO₂:** [CoolProp](https://coolprop.org/coolprop/wrappers/Javascript/index.html) ships as WASM (`coolprop-wasm` on npm, v8 has a clean JS API). Ideal gas is wrong near the surface because CO₂ is supercritical there. We'll likely **pre-bake lookup tables** (ρ, cp, k, μ over the 0–100 km P/T envelope) at build time with Python CoolProp, so we don't ship 5 MB of WASM.
- **Atmosphere data:**
  - MVP: **VIRA** tables, 0–100 km by latitude. Already in veenie and in `VIRAHi.txt` in [WoutSchaerlaecken/Venus_Balloon_Preliminary_Design](https://github.com/WoutSchaerlaecken/Venus_Balloon_Preliminary_Design).
  - Upgrade: **Venus Climate Database v2.3** from LMD. It has a web CGI at `www-venus.lmd.jussieu.fr/vcd_python/cgi-bin/vcdcgi.py` that returns ASCII profiles, but my quick scripted query came back with a stale default file. It needs proper form replay, or use [rcharavit's VCD client](https://github.com/rcharavit/The-Venus-Climate-Database-Project-VCD-), or the VESPA TAP service, or email LMD for the full offline VCD. Bake lat × local-time × altitude grids into static binary files.
- **Rendering:** Three.js via React Three Fiber, plus a volumetric orange haze/fog shader. Later: surface super-refraction, where the horizon appears to curve up.
- **Terrain:** Magellan global topography from USGS/PDS for the site picker, and procedural basalt plains + rocks for the local scene. Venera 13/14 panoramas are the visual reference.
- **Steal from veenie:** its framework-free TS physics modules (atmosphere interpolation, balloon buoyancy, envelope thermal, He permeation, winds) plus its vehicle configs. Port them; don't fork the whole SvelteKit app.

### Stack recommendation

Next.js 16 (App Router, Turbopack) + React 19 + TypeScript + React Three Fiber + `@mujoco/mujoco` + zustand + uPlot + Tailwind v4/shadcn. The lab page renders client-only. Physics packages are pure TS with no DOM, so they run in Node for tests and sweeps too. Monorepo: `packages/env`, `packages/thermal`, `packages/materials`, `packages/trajectory`, `packages/mech` (MuJoCo glue), `apps/web`.

---

## 4. Data we have to build ourselves

This is the actual moat. Everything here is JSON with a source link per value.

1. **Materials DB:** density, k, cp, emissivity, melting/softening point, yield-vs-temperature curve, creep, CO₂/H₂SO₄ compatibility. Starting set: Al 6061/7075, Ti-6Al-4V, 304/316 SS, Inconel 718, CFRP (epoxy matrix dies ~150–200 °C), PEEK, Kapton, Viton/Kalrez seals, aerogel/MLI insulation, basalt (ground contact).
2. **Components DB:** electronics classes (commercial Si, automotive Si, SOI, SiC JFET), batteries (Li-ion, LiFePO₄, thermal/molten-salt, NaS), solders, magnets (NdFeB grades, SmCo), lubricants, cameras/sensors, coolers (Stirling cooler: watts in per watt lifted at 464 °C ambient).
3. **Vehicle library:** each one = geometry (MJCF or trajectory params) + a thermal node network + a component list.
   - Venera 13 (validation)
   - VEGA balloon (validation)
   - Optimus (approx.), Unitree G1/H1, Spot-like quadruped
   - CAT haul truck (approx.)
   - Perseverance-class rover
   - Starship (approx.)
   - HAVOC airship
   - "Sealed box" (for pure insulation experiments)
4. **Validation suite:** automated tests that must stay green.
   - VIRA profile reproduced
   - VEGA-1 float ≈ 53.6 km with ±hundreds-of-m diurnal oscillation
   - Venera 13 descent ≈ 1 h and ~7–8 m/s touchdown
   - Venera 13 survival ≈ 127 min, Venera 14 ≈ 57 min
   - SiC board alive at 60 days (GEER)

   If any of these drift, the sim is lying.

---

## 5. The experiment UX (what makes it not-a-textbook)

- **Scenario = vehicle + location + start state + mods.** Mods: swap the frame material, add insulation cm, electronics class, PCM kg, cooler watts, battery chemistry.
- **Run** gives a live 3D view with time acceleration (1× for walking, 1000× for thermal soak), live telemetry (temps per node, torque available, power, altitude), and an **event timeline** of every threshold crossed.
- **Verdict card:** "Optimus (approx., stock), surface, equator, noon: walking for 3 min 40 s. Died T+6:12. First failure: battery separator 130 °C at T+2:05." The numbers here are illustrative until the sim exists.
- **Compare** runs side by side. **Sweep** one parameter (insulation 0–30 cm → survival-time curve) across workers.
- **Share:** the whole experiment config goes in the URL hash.
- **Build your own:** a parts-based composer (chassis + skin + insulation + e-bay + power + actuators) that generates the thermal network and a simple MJCF automatically.

Every model shows a **fidelity badge**: validated / approximation / guess. People trust conclusions only as far as the weakest model.

---

## 6. Phases

**Phase 0: foundations (≈2–3 days)**
- Repo scaffold (monorepo, Vite/React/R3F, workers, Vitest).
- Bake VIRA + CO₂ property tables. Environment `atm()` API with tests.
- Materials/components DB seed (~30 entries, sourced).

**Phase 1: surface drop test (MVP, ≈1–2 weeks)**
- Thermal network solver (implicit Euler, stiff-safe) + convection correlations for supercritical CO₂ + radiation.
- Failure engine + event timeline + verdict card.
- MuJoCo scene: Venus gravity/density/wind, flat basalt terrain, Unitree G1 walking with a Playground ONNX policy, Optimus-approx standing/walking.
- Thermal → mechanics coupling (magnet T → torque, e-death → limp joints, metal T → stiffness).
- Vehicles: sealed box, Venera 13, Optimus-approx, G1. **Gate: Venera 13 lands within ~20% of 127 min.**

**Phase 2: descent and landing (≈1 week)**
- 3-DOF entry from ~250 km with VIRA/VCD density, Sutton–Graves heating, parachute/airbrake stages, terminal descent, and time spent in the H₂SO₄ clouds.
- Rocket engine vs ambient pressure (Cf with pₐ·Aₑ term + Summerfield separation) → Starship belly-flop / landing-burn experiment.
- Hand the landing state to Phase 1 (land, then cook). **Gate: Venera 13 descent timeline.**

**Phase 3: cloud layer (≈1 week)**
- Port veenie's balloon/aerostat physics. Variable-altitude balloons, airships, HAVOC-style habitat, solar power at altitude, acid exposure/degradation.
- 4-day superrotation drift around the globe view. **Gate: VEGA-1 float.**

**Phase 4: experiment tooling**
- Sweeps, compare view, shareable URLs, parts-based vehicle builder.

**Phase 5: fidelity upgrades**
- VCD grids (lat/local time/season)
- Magellan terrain sites
- Simple FEM or beam model for structural sag
- H₂SO₄ corrosion rates
- Policies retrained under Venus conditions
- CAT truck drivetrain model

---

## 7. Open decisions

1. **Stack:** React + R3F (recommended, bigger ecosystem) or SvelteKit + Threlte (the same as veenie, so its UI copies over directly). The physics is portable either way.
2. **First vertical slice:** surface drop test with Optimus-approx vs Venera 13 (recommended; it's the novel part and has a hard validation target) or Starship descent (more spectacular, less validation data).
3. **VCD:** email LMD for the full offline database now (free, slow reply), in parallel with building on VIRA.

---

## 8. Build log

**2026-10-01, MVP**
- Sim core in `src/sim/`, with 16 tests: atmosphere, CO₂, convection, solver energy conservation, PCM, Venera 13 validation, humanoid survival, and policy parity.
- The unitree_rl_gym G1/H1 policies still walk under Venus gravity and 65 kg/m³ CO₂ (checked in Python MuJoCo). They fall below ~58% / ~63% motor torque.
- Stock humanoids on the surface:
  - Optimus approx: e-bay dies ~80 s, frame yields ~1.7 min, Li-ion runaway ~3 min.
  - G1: dead at ~45 s.
- Hardened G1 (SiC, thermal battery, magnet-free motors, Ti frame): runs until its battery is empty, ~2 days idle.
- Venera 13: 66 min descent, 7.0 m/s touchdown, ~2.1 h on the surface. Calibrated via insulation thickness (30 mm at k = 0.1).
- Found while sweeping: structural struts matter. A strut conductance that was too high (5 W/K) capped the benefit of insulation. Real Ti struts are ~0.1 W/K; now 0.3 W/K.

**2026-10-01, realism pass**
- Terrain from Venera panoramas (Space Sci. Rev. 2023 sediment review: plates a few cm thick, V14 low sediment, V9 talus with ≤60×20 cm boulders on 15–20°, ~1500 kg/m³ at ~50% porosity). One function drives both rendering and the MuJoCo heightfield.
- MuJoCo has **no buoyancy** in its fluid model (verified: acceleration at rest is unchanged with density 1000). Added by hand.
- Walking calibration (walking.json):
  - Optimus-class (H1 body at 57 kg) walks on V13/V14 plates at 0.34–0.37 m/s and falls on the V9 slope.
  - G1 trips on plates after ~2–7 s.
  - Everything falls on V9 within ~3 s.
- Plastic yield hinges: frictionloss creeps, so they use an elastic spring plus return mapping on the rest angle.
- Specs corrected: G1 has CFRP shells and a 0.42 kWh pack; Optimus is 57 kg with a 2.3 kWh / 52 V pack.
- CAT 262D3 skid steer (official dims and mass). The diesel can't run on Venus: no oxygen.
- Optics: CO₂ Rayleigh β(550 nm) ≈ 1e-3 /m at the surface, spectral (λ⁻⁴). Super-refraction bowl skipped, because Venera 9/10 images showed it doesn't appear.
- Library: added high-temperature steels, superalloys, refractory metals, low-melting metals, ceramics and windows, PTFE, Vespel, silicone, tyre rubber, Kevlar, BMI and polyimide CFRP, C/C, GaN and ZEBRA batteries, and hydraulic fluids. Thermosets char but never drip.
