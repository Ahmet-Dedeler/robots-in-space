# Spacecraft: rockets landing on Venus, the Moon, Mars and Mercury

Status (2026-10-01): four rocket landers fly a powered descent on any world, then (if they're still in one piece) run the usual thermal survival sim on the surface.

## Vehicles

| Vehicle | Landing engines | Published | Guessed |
|---|---|---|---|
| Starship V3 (ship) | 3 × Raptor 3 SL (350 bar) | 9 m × ~52 m, 1,600 t propellant, 2.75 MN per Raptor | ~120 t dry, 200 t landing propellant, 6 bar tanks, L/D 0.4 belly-first, legs |
| Falcon 9 booster (Block 5) | 1 × Merlin 1D (97 bar) | 41.2 m × 3.66 m, 22.2 t dry, 845 kN / 282 s SL, throttle 40% | 20 t landing propellant, 3.5 bar tanks |
| New Glenn GS1 | 3 × BE-4 (134 bar) | 57.5 m × 7 m, tank volumes, 2,450 kN | ~100 t dry, area ratio 20, Isp 310 s SL |
| Apollo LM (Eagle) | LMDE (7 bar, pressure-fed) | 15,103 kg, 8,248 kg descent propellant, 45 kN / 311 s, throttle 10-100% | lumped cabin and thermal build |

Presets: `src/sim/vehicles/spacecraft.ts`. Each `notes` entry says what's published and what's guessed.

## Physics (`src/sim/spacecraft/`)

- **Engines** (`engines.ts`). Each engine is pinned to one published (thrust, Isp) point. Thrust anywhere else comes from the ideal nozzle equations (Sutton & Biblarz ch. 3) with the Summerfield separation criterion: when the wall pressure drops below 0.4 × ambient, the flow leaves the wall and the rest of the bell does nothing. Throttling lowers the chamber pressure, so a throttled-down engine separates sooner. Check: Merlin pinned at sea level predicts the published 311 s vacuum Isp.
- **Flight** (`landing.ts`). 2-D point mass over a curved body: gravity, the centrifugal term vx²/r, drag, buoyancy (ρgV, with the tank volume while sealed), thrust.
  - Venus: starts at 62 km at terminal velocity (after entry), belly-first for Starship.
  - Mars: entry interface at 125 km, 3.5 km/s, 3° below horizontal. Starship flies a bank-steered lifting entry (L/D 0.4, guessed); the boosters and the LM fall ballistic. Engines light once drag has peaked and stopping in the height left needs 75% of the available deceleration, then full-thrust retropropulsion, then the final descent.
  - Moon/Mercury: circular orbit at 15 km (Apollo's PDI altitude). Braking burn that kills the sideways speed while holding a descent rate that reaches ~500 m as it ends.
  - Final descent: vertical velocity profile v = −√(1 + 2 a_ref h) with feedback. If the engines can't throttle low enough to hover (Falcon 9 always), they shut down and relight: a hoverslam.
  - **Tanks**: thin, pressure-stabilised shells. They buckle when outside pressure exceeds tank pressure + a small stiffener margin. *Flood empty tanks* vents them to the outside instead (no crush, no buoyancy).
  - **Legs**: under the rating = landed; up to the break speed = hard landing (damaged, standing); above = crash (destroyed).
- **Coupling with the thermal run** (`mission/run.ts`): the flight is computed first. If the thermal sim then kills the flight computer before touchdown, the flight is re-flown with the engines going quiet at that moment ("Nobody flying"). Everything before that moment is unchanged, so the second run is consistent.

## What each world does to them (default loads)

| | Venus | Mars | Moon | Mercury |
|---|---|---|---|---|
| Starship V3 | tanks crushed at ~34 km | lands, ~68 t left | lands, ~64 t left | lands with ~0.5 t left |
| Falcon 9 booster | tanks crushed at ~40 km | crashes (no lift, too little propellant) | lands with ~0.5 t left | crashes |
| New Glenn GS1 | tanks crushed at ~39 km | crashes | crashes (out of propellant) | crashes |
| Apollo LM | cabin buckles at ~1 bar (~50 km), engine dead below ~34 km, tanks crushed ~23 km | crashes (T/W < 1 when full) | lands, 1.3 t left | crashes |

Findings worth knowing:

- **Venus crushes rockets before it cooks them.** Rocket tanks hold themselves up with internal pressure (3-6 bar). Venus passes that 35-40 km up, still 30+ minutes from the ground.
- **Flood the tanks and the avionics cook instead.** A vented Starship reaches the surface intact, but its unprotected avionics pass 175 °C about 17 minutes into the descent. Nobody is left to fly the landing burn, so it hits at ~13 m/s. With 20 mm of aerogel on the e-bay and battery it lands at 1.2 m/s, then lasts ~40 min on the surface (~50 min with 100 mm).
- **Chamber pressure decides who can fly at the bottom of Venus.** Raptor (350 bar) keeps ~51% of its sea-level thrust at 92 bar, BE-4 (134 bar) ~28%, Merlin (97 bar) ~16%, and the LM's 7-bar engine nothing below ~34 km.
- **Mercury is the hardest landing.** Orbital speed at 15 km is 3 km/s, almost double the Moon's. Starship's default 200 t barely gets it down.
- **Apollo margins:** the model lands Eagle in ~8 min with 1.3 t left; Armstrong took 12.6 min and landed with ~45 s of fuel after flying past a boulder field. The model's straight-in guidance is the difference.

## Known gaps

- Entry heating isn't simulated (boosters get a "no heat shield" warning and are assumed to survive).
- Cryogenic boil-off during the long Venus descent isn't modelled.
- No gas-generator turbine back-pressure limit (Merlin's turbine exhaust would also struggle at depth).
- No slopes/rocks under the legs, no tipping; horizontal drift at touchdown is nulled by guidance.
- Starship HLS (solar arrays, mid-body landing thrusters) isn't a separate preset.
