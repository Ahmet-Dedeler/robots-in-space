# Moon, Mars, Mercury

Status (2026-10-01): the lab runs on four worlds. Pick one in the World panel; any vehicle can go anywhere, and each world has its own missions.

## What's different off Venus

Venus is a constant oven. The other three are about **day and night**: a lunar day is 29.5 Earth days, a Mercury solar day 176, a Mars sol 24.6 h. So the sim gained a clock, a Sun, and everything that follows from them:

| Piece | File | Model | Checked against |
|---|---|---|---|
| Ground temperature | `sim/planets/regolith.ts` | 1-D regolith conduction to periodic steady state, Hayne et al. 2017 (Diviner) parameters | Moon equator 385 K noon / 93 K pre-dawn (Diviner ~390 / ~95); Mercury 706 K hot longitude, 573 K warm (Vasavada 1999 ~700 / ~570); Shackleton floor 48 K |
| Sun | `sim/planets/solar.ts` | Mean Sun for Moon and Mars (season via Ls); full Kepler orbit for Mercury | Mercury's Sun backs up near perihelion; 3:2 resonance hot/warm longitudes |
| Mars air | `sim/planets/mars.ts` | Hydrostatic pressure + CO₂ cycle, dust transmission (beam/diffuse), sky IR warming with dust | REMS 730-920 Pa at Gale; Opportunity 2018 storm array output (~3-4%) |
| Environment object | `sim/planets/world.ts` | Clock, sunlight on the shell, solar power, heaters, RHUs, RTG heat, radiator, hibernation, cold checks, chase-the-Sun | Missions below |
| Cold limits | `sim/planets/cold.ts` | Min operating / survival temps per part; brittle materials; solar absorptivity; insulation in vacuum | Datasheets (cited in file) |
| Ground | `sim/terrain/terrain.ts` | Craters (N(>D) = n1 D⁻², Gault 1970), Golombek-Rapp rocks, Meridiani ripples, planetary curvature | Rock cover within the k values used for Mars landing-site certification |

The mission loop (`mission/run.ts`) talks to a `World`. For Venus that is a pass-through to VIRA, and Venus results are **bit-identical** to before (checked by fingerprinting every Venus vehicle's run; the Venera validation tests still pass).

## Missions vs history (tests in `sim/planets/planets.test.ts`)

| Vehicle | Scenario | Sim | Reality |
|---|---|---|---|
| Pragyan (Chandrayaan-3) | 69°S, lands at dawn | Works ~13.6 days, battery freezes and electronics pass -65 °C within hours of sunset, never wakes | Put to sleep 2 Sep 2023, never woke |
| Lunokhod 1 (Luna 17) | Mare Imbrium, 330 days | Warm through 6 nights, then colder each month as the Po-210 decays; electronics freeze ~day 306, 10.6 km driven | Last contact day 301, 10.54 km |
| Yutu-2 (Chang'e 4) | Von Kármán, far side | Sleeps through every night, wakes at each sunrise (3 of 3 in 90 days) | Still waking up after 60+ lunar nights |
| Curiosity | Gale, Ls 150 | Runs 60 sols on its RTG, also at dust τ 10.8 | Unaffected by the 2018 storm |
| Opportunity | Meridiani, τ 0.5 | Runs 60 sols | 5,111 sols |
| Opportunity | τ 10.8 (June 2018) | Dead in ~12 sols | Went silent ~11 sols into the storm |
| Mercury dawn crawler (hypothetical) | 70°N, chasing the Sun | Holds 07:00 local for 176 days (6,000 km driven) | n/a |
| Same, parked | | Electronics cook as the day comes | n/a |

Calibrated, not predicted: Yutu-2's radioisotope heater power and insulation (not published), rover duty cycles (fitted to real odometry), Mars dust transmission and sky IR.

## Findings worth knowing

- **Walking in low gravity depends on the robot.** On flat ground, the Unitree G1 policy (trained in Earth gravity) walks at every gravity tested, just slower: 0.48 m/s on Earth, 0.39 on Mars, 0.34 on the Moon. The H1-based Optimus stand-in falls within ~5 s at Mars/Mercury gravity and ~7 s on the Moon: Earth-tuned torques launch a body that weighs a third as much, and the gait runs away (0.8 m/s). On real lunar and Martian ground (craters, rocks), both blind policies mostly trip within 3-15 s (`walking.json`, from `scripts/calibrate-walking.ts`, which now runs each terrain under its own world's gravity and gas).
- **The night is the killer, not the day.** Every solar vehicle here that dies, dies in the dark: Li-ion can't deliver below ~-20 °C, freezes near -40 °C, and can't be charged below 0 °C. Hibernation alone doesn't save you (Pragyan hibernated); a radioisotope heat source plus a well-insulated warm box does (Yutu-2).
- **Good night insulation cooks you at noon.** A warm box that survives a -190 °C night hits 60 °C+ in a 14-day lunar noon unless it can dump heat. Rovers need switchable radiators (heat switches, louvers, Yutu-2's controllable fluid loop); the survival kit has one.
- **Mercury's dawn is a place you can stay.** The day-night line crawls at 1 m/s at the equator and 0.34 m/s at 70°N. A rover that keeps driving west never sees noon or night. Relevant for ISRU/construction robots.
- **Vacuum changes insulation.** Aerogel is ~10x better in vacuum than in Venus's 92 bar (0.005 vs 0.05 W/m/K); MLI only works in vacuum.

## Known gaps / next

- Topographic shadowing at the lunar poles (flat-horizon approximation; ridges are shadowed by distant peaks part of the time).
- ChaSTE on Chandrayaan-3 measured ~70 °C at the surface near Pragyan; the flat-ground model gives ~0 °C at 69°S noon. Diviner's flat-terrain values agree with the model; ChaSTE likely sat on a Sun-facing slope next to the lander. Slopes aren't modelled.
- Mars season is fixed over a run (Ls moves ~30° in 60 sols); no CO₂ frost; no dust-cleaning gusts on arrays.
- No Mars entry/descent/landing (Venus descent only). No lunar/Mercury landing burns.
- Rovers are kinematic in 3D (no MuJoCo wheel-soil contact yet). Wheel sinkage in regolith (Bekker-Wong) would be the next realism step.
- Thermal cycling fatigue (solder joints over hundreds of day/night cycles) isn't modelled; parts fail on temperature thresholds only.
- ISRU / "robots building robots" experiments (regolith sintering, solar-cell fabrication, water ice extraction in shadowed craters) would build on the Mercury crawler and Shackleton scenarios.
