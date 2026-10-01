# Spacecraft: rockets landing on Venus, the Moon, Mars and Mercury

Status (2026-10-01): four rocket landers fly a powered descent on any world, then (if they're still in one piece) run the usual thermal survival sim on the surface. Drag and lift now come from each stage's geometry at its angle of attack and Mach number, and entry heating runs through a real heat-shield model (tiles, blanket, skin).

## Vehicles

| Vehicle | Landing engines | Published | Guessed |
|---|---|---|---|
| Starship V3 (ship) | 3 × Raptor 3 SL (350 bar) | 9 m × ~52 m, 1,600 t propellant, 2.75 MN per Raptor | ~120 t dry, 200 t landing propellant, 6 bar tanks, flap area, entry AoA, tile thickness, legs |
| Falcon 9 booster (Block 5) | 1 × Merlin 1D (97 bar) | 41.2 m × 3.66 m, 22.2 t dry, 845 kN / 282 s SL, throttle 40% | 20 t landing propellant, 3.5 bar tanks |
| New Glenn GS1 | 3 × BE-4 (134 bar) | 57.5 m × 7 m, tank volumes, 2,450 kN | ~100 t dry, area ratio 20, Isp 310 s SL |
| Apollo LM (Eagle) | LMDE (7 bar, pressure-fed) | 15,103 kg, 8,248 kg descent propellant, 45 kN / 311 s, throttle 10-100% | lumped cabin and thermal build |

Presets: `src/sim/vehicles/spacecraft.ts`. Each `notes` entry says what's published and what's guessed.

## Physics (`src/sim/spacecraft/`)

- **Engines** (`engines.ts`). Each engine is pinned to one published (thrust, Isp) point. Thrust anywhere else comes from the ideal nozzle equations (Sutton & Biblarz ch. 3) with the Summerfield separation criterion: when the wall pressure drops below 0.4 × ambient, the flow leaves the wall and the rest of the bell does nothing. Throttling lowers the chamber pressure, so a throttled-down engine separates sooner. Check: Merlin pinned at sea level predicts the published 311 s vacuum Isp.
- **Flight** (`landing.ts`). 2-D point mass over a curved body: gravity, the centrifugal term vx²/r, drag, lift, buoyancy (ρgV, with the tank volume while sealed), thrust.
- **Aerodynamics** (`aero.ts`). Slender-body crossflow model (Allen & Perkins 1951, NACA TR 1048; Jorgensen 1977, NASA TR R-474). The body is a cylinder (length × diameter) plus flat-plate control surfaces:
  - normal force = q · Cdc(M sin α) · sin²α · L·d (+ flaps/fins broadside), with Cdc the 2-D cylinder drag vs crossflow Mach (1.2 subsonic, transonic peak ~1.75, modified-Newtonian ~1.28 hypersonic);
  - axial force = q · Ca(M) · cos²α · πd²/4 (+ grid fins facing the flow), Ca for a blunt engine end (Hoerner: flat disk 1.05 → 1.7 supersonic) or an ogive nose;
  - drag and lift are those rotated into the wind. Lift direction is the guidance's (bank angle).
  - Speed of sound from CO₂'s heat-capacity ratio (NIST Shomate fit): ~230 m/s on Mars, ~410 m/s at the Venus surface.
  - Attitude is commanded, not integrated: boosters fall engines-first (AoA 180°), Starship enters at 60° and skydives at 90° (belly flop), then flips in 6 s.
- **Entry heating** (`tps.ts`). Sutton-Graves convective stagnation flux for CO₂ (k = 1.9027e-4, Sutton & Graves 1971, NASA TR R-376):
  - windward side: a cylinder of the body's radius (stagnation line 1/√2 of a sphere), swept: × sin(α)^1.5;
  - nose-first: sphere of the body radius × cos; engines-first base: flat face, effective radius ≈ the diameter;
  - lee side: a share of the peak (Starship 3%, boosters 5%; guesses).
  - Radiative shock-layer heating is not included (small below ~6 km/s in CO₂, Tauber & Sutton 1991); the descent warns above 6 km/s.
- **Heat shield** (`tps.ts`). Each surface is a 1-D wall: tiles or blanket (12-node explicit finite differences, temperature-dependent k and cp) over a lumped skin, outer face re-radiating εσT⁴, inner face adiabatic. Tiles past their single-use limit fail and expose the skin; a skin past its structural limit means burn-through (tanks rupture, outcome "burned").
  - Starship tiles: LI-900-class silica (144 kg/m³, ε 0.85, reusable to 1260 °C, single-use ~1480 °C; Cleland & Iannetti 1989, NASA CR-4227). SpaceX's composition and thickness aren't published: 25 mm is a guess.
  - Booster base: ceramic-fibre blanket (type unpublished, a guess).
  - Structural limits: 2219 aluminium at 316 °C (yield down to ~20%, MMPDS); 300-series stainless ~900 °C (ASM). SpaceX's 30X steel isn't published.
- **Entry burn** (boosters without a heat shield, entering from orbit): full retro-thrust high up until 1.5 km/s or half the propellant is gone, as Falcon 9 does on Earth (end speed is a guess from webcast telemetry).
  - Venus: starts at 62 km at terminal velocity (after entry), belly-first for Starship.
  - Mars: entry interface at 125 km, 3.5 km/s, 3° below horizontal. Starship flies a bank-steered lifting entry (L/D 0.4, guessed); the boosters and the LM fall ballistic. Engines light once drag has peaked and stopping in the height left needs 75% of the available deceleration, then full-thrust retropropulsion, then the final descent.
  - Moon/Mercury: circular orbit at 15 km (Apollo's PDI altitude). Braking burn that kills the sideways speed while holding a descent rate that reaches ~500 m as it ends.
  - Final descent: vertical velocity profile v = −√(1 + 2 a_ref h) with feedback. If the engines can't throttle low enough to hover (Falcon 9 always), they shut down and relight: a hoverslam.
  - **Tanks**: thin, pressure-stabilised shells. They buckle when outside pressure exceeds tank pressure + a small stiffener margin. *Flood empty tanks* vents them to the outside instead (no crush, no buoyancy).
  - **Legs**: under the rating = landed; up to the break speed = hard landing (damaged, standing); above = crash (destroyed).
- **3D**: real models (`docs/models.md`). Plumes come from each model's own nozzle exits; Falcon 9's legs deploy, Starship's flaps trim and fold. Starship's flap area in the aero model (~110 m²) was measured on its model.
- **Coupling with the thermal run** (`mission/run.ts`): the flight is computed first. If the thermal sim then kills the flight computer before touchdown, the flight is re-flown with the engines going quiet at that moment ("Nobody flying"). Everything before that moment is unchanged, so the second run is consistent.

## What each world does to them (default loads)

| | Venus | Mars | Moon | Mercury |
|---|---|---|---|---|
| Starship V3 | tanks crushed at ~34 km | lands, ~70 t left; tiles peak ~640 °C at 35 kW/m², steel behind them stays below 0 °C | lands, ~64 t left | lands with ~0.5 t left |
| Falcon 9 booster | tanks crushed at ~40 km | entry burn only gets to 2.7 km/s on 10 t; base blanket peaks ~930 °C (103 kW/m²); crashes out of propellant | lands with ~0.5 t left | crashes |
| New Glenn GS1 | tanks crushed at ~39 km | entry burn to 2.8 km/s, crashes | crashes (out of propellant) | crashes |
| Apollo LM | cabin buckles at ~1 bar (~50 km), engine dead below ~34 km, tanks crushed ~23 km | burns through 94 km up (0.6 mm aluminium, no heat shield) | lands, 1.3 t left | crashes |

Peaks per run (dynamic pressure, heat flux, hottest surface and skin, felt g, Mach) are in `flight.peaks`; the Telemetry tab charts them.

Findings worth knowing:

- **Venus crushes rockets before it cooks them.** Rocket tanks hold themselves up with internal pressure (3-6 bar). Venus passes that 35-40 km up, still 30+ minutes from the ground.
- **Flood the tanks and the avionics cook instead.** A vented Starship reaches the surface intact, but its unprotected avionics pass 175 °C about 17 minutes into the descent. Nobody is left to fly the landing burn, so it hits at ~13 m/s. With 20 mm of aerogel on the e-bay and battery it lands at 1.2 m/s, then lasts ~40 min on the surface (~50 min with 100 mm).
- **Chamber pressure decides who can fly at the bottom of Venus.** Raptor (350 bar) keeps ~51% of its sea-level thrust at 92 bar, BE-4 (134 bar) ~28%, Merlin (97 bar) ~16%, and the LM's 7-bar engine nothing below ~34 km.
- **Mercury is the hardest landing.** Orbital speed at 15 km is 3 km/s, almost double the Moon's. Starship's default 200 t barely gets it down.
- **Apollo margins:** the model lands Eagle in ~8 min with 1.3 t left; Armstrong took 12.6 min and landed with ~45 s of fuel after flying past a boulder field. The model's straight-in guidance is the difference.

## Known gaps

- Radiative shock-layer heating isn't included (matters above ~6 km/s in CO₂, i.e. a Venus entry from orbit).
- Attitude is commanded, not integrated: no pitching moments, flap trim or control authority limits. The aero coefficients are good to maybe ±25%, heat fluxes ±30%.
- No ablation, no tile-to-tile gap heating, no catalytic-wall effects; inner walls are adiabatic (no credit for cold propellant behind them).
- Cryogenic boil-off during the long Venus descent isn't modelled.
- No gas-generator turbine back-pressure limit (Merlin's turbine exhaust would also struggle at depth).
- No slopes/rocks under the legs, no tipping; horizontal drift at touchdown is nulled by guidance.
- Starship HLS (solar arrays, mid-body landing thrusters) isn't a separate preset.
