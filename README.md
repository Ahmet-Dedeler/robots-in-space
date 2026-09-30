# Venus Lab

What survives on Venus, and for how long?

Venus Lab is a browser sandbox for Venus experiments. Pick something real (a Unitree G1, an Optimus-class humanoid, the Venera 13 lander) or build your own. Put it on the surface or drop it from 62 km, and watch it walk, cook, sag and die, with a timeline of exactly what failed first.

Everything runs client-side:

- **Atmosphere**: VIRA reference profiles (Seiff et al. 1985), 0-100 km.
- **CO₂ properties**: CoolProp's Span-Wagner EOS, baked into a table. Near the surface the gas is supercritical: 737 K, 92 bar, 65 kg/m³.
- **Heat**: a lumped thermal network with natural and forced convection correlations, radiation, phase-change heat sinks, insulation jackets and active coolers.
- **Failures**: per-part datasheet limits for silicon grades, SiC, solders, Li-ion runaway, magnet demagnetization, winding insulation, lubricants, seals, frame yield strength vs temperature, and hull buckling.
- **Walking**: the real Unitree walking policies (G1, H1) running in MuJoCo WASM with Venus gravity, CO₂ density and wind. Motor torque is scaled live by the thermal model, so robots slow down, stumble and collapse when their parts do.
- **Descent**: terminal-velocity descent through the VIRA density profile with parachute and aerobraking-disk stages.
- **Ground**: generated from the Venera 9/13/14 panoramas and measurements. Venera 14 has layered basalt plates with little soil, Venera 13 has plates in loose dark sediment, and Venera 9 is a 17° talus slope of angular boulders up to 60 cm. The same height function is MuJoCo's collision heightfield, so what you see is what the feet and wheels hit.
- **Buoyancy**: MuJoCo's fluid model has none, so it's applied per body from the displaced solid volume. Open bodies are flooded with CO₂, so only their solid material counts.
- **Bending metal**: thighs and shins are cut and rejoined with elastic-perfectly-plastic hinges. Their plastic moment follows the frame's hot yield strength, so limbs bend under load and stay bent.
- **Optics**: spectral Rayleigh extinction for CO₂ at the local density (visibility ~1 km in green, less in blue), cloud-deck Mie haze, and purely diffuse light (3–3.5 klux measured by Venera 13/14; no direct sunbeam reaches the ground).
- **Vehicles**: a CAT 262D3 skid steer from the official specs. Its diesel can't run (no oxygen). The battery-electric conversion drives until its ECU, tyres and hydraulics give out.

## Validation

| Check | Target | Model |
|---|---|---|
| Venera 13 descent time (62 km → surface) | ~1 h | 66 min |
| Venera 13 touchdown speed | ~7.5 m/s | 7.0 m/s |
| Venera 13 surface survival | 127 min | ~2.1 h (calibrated) |
| Walking policy, TS vs PyTorch | identical | matches to 1e-4 |
| Walking on Venus (gravity, 65 kg/m³ CO₂, buoyancy, spec mass) | — | flat ground: both walk; Venera plates: Optimus-class walks, G1 trips after ~2–7 s (blind policy trained on flat ground); Venera 9 boulder slope: all trip within ~3 s. See `src/sim/data/walking.json` |

Venera 13's hull, insulation and heat-sink details aren't published, so its model is **calibrated** to reproduce the 127 minutes, not predicted. Every vehicle is labelled with its fidelity.

## Run

```bash
pnpm install
pnpm dev
```

Tests: `pnpm test`. Rebuild the baked data: `pnpm bake:co2` and `pnpm bake:robots` (need [uv](https://docs.astral.sh/uv/)).

## Sources and credits

- Robot models and policies: [unitreerobotics/unitree_rl_gym](https://github.com/unitreerobotics/unitree_rl_gym)
- Physics: [MuJoCo](https://github.com/google-deepmind/mujoco) official WASM bindings
- VIRA table via [WoutSchaerlaecken/Venus_Balloon_Preliminary_Design](https://github.com/WoutSchaerlaecken/Venus_Balloon_Preliminary_Design)
- Venus flight physics reference: [hackiku/veenie](https://github.com/hackiku/veenie)
- SiC electronics survival data: NASA Glenn GEER / LLISSE papers

See [docs/plan.md](docs/plan.md) for the roadmap.
