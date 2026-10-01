# Construction machines and rovers

Status (2026-10-01): five machines run in MuJoCo (Cat 262D3 skid steer, Cat 299D3 compact track loader, Cat D6 dozer, Cat 320 excavator, NASA IPEx), the planetary rovers got real suspension and detailed bodies, and Lunokhod 1 joined the Moon missions.

## Machines

| Machine | File | Physics | Source |
|---|---|---|---|
| Cat 262D3 skid steer | `sim/robots/machines.ts` | 4 velocity-driven wheels, vertical-lift arms + bucket tilt | Cat spec sheet AEHQ8210: 3,763 kg, 1.25 m wheelbase, 12x16.5 tyres, 3.17 m pin height |
| Cat 299D3 track loader | same | 2 x 6 contact rollers under rubber tracks, same lift arms | Cat spec sheet: 5,200 kg, 400 mm tracks, 1,767 mm on ground, 73 kW |
| Cat D6 dozer | same | 2 x 8 rollers, steel shoes, elevated sprocket, blade on push arms, ripper | Cat spec sheet: 22,130 kg, 1,930 mm gauge, 610 mm shoes, 2,964 mm on ground, 6SU blade 3.31 x 1.41 m |
| Cat 320 excavator | same | 2 x 7 rollers, swing (braked), boom, stick, bucket | Cat 320 spec sheet: 21,700 kg, 5.7 m boom, 2.9 m stick, 2,380 mm gauge, 4,450 mm tracks, 2,830 mm tail swing, 11.25 rpm, 205 kN drawbar |
| NASA IPEx | same | 4 skid-steer wheels, two arms with counter-rotating bucket drums | Schuler et al., "IPEx TRL-5 Design Overview", ASCEND 2024: 30 kg class, 30 cm/s, 30 kg/trip, 11-day south-pole mission, PCM + covered radiator |

How the physics works (`sim/robots/machine-world.ts`):

- **Drive**: each wheel or track roller is a velocity servo. Torque per joint is capped so the machine can't exceed its rated drawbar pull. Tracks are rows of contact rollers per side; the belt is drawn around them (`scene/machine-parts.ts`, `beltPath`) and moves with the rollers.
- **Hydraulics**: implements are position servos whose stiffness scales with pressure and whose command is rate-limited (cylinder speed is set by pump flow; 35°/s default, 67°/s swing). No pressure means only the oil's damping holds them, so arms, blades and booms sink. The excavator swing has a spring-applied brake and holds.
- **Rubber**: burnt tyres shrink to the rim, burnt rubber tracks to the bare rollers. Steel shoes never burn but turn brittle below -40 °C (Moon nights).
- **Work cycles**: loaders carry and dump while circling; the dozer pushes 8 s at grade and backs up 6 s with the blade raised (same distance, so it stays on its strip); the excavator runs a ~21 s truck-loading cycle (reach, drag, curl, swing 90°, dump, return); IPEx digs 10 s with the front drums down, then hauls.
- **Spawn**: the machine is lifted until no geom (not just the wheels) starts inside the terrain. Spawning on wheel heights alone let the dozer blade start inside a Venera plate and flip the machine.

Tuning notes:

- The excavator dig line skims the surface. A deeper line hooks Venera's rigid basalt plates and the 150 kN bucket drags the whole 22 t machine (plausible on bare rock, wrong for a demo).
- Stock Cat machines are diesel: on Venus, Mars and the Moon they can't start, and with no running pump there's no hydraulic pressure at all. Switching to battery-electric fits `powerplant.electricPackWh` (60 kWh loaders, 300 kWh dozer/excavator, matching the 256-320 kWh of Cat's Bauma 2022 battery-electric 320 prototypes).

## Power fix in the mission loop

Machines used to keep driving at full motor power once the battery was flat, as long as the solar array covered the avionics (a 25 kW loader "drove" on a 1 kW array). Now motors only run on battery charge or on supply beyond the avionics, and a flat pack locks them out until it's back to 20% (a BMS cut-off). That makes energy-limited machines duty-cycle: the lunar loader works ~14% of the time on 10 m² of panels. Venus runs are unaffected (fingerprinted bit-identical against the previous commit).

## Rovers

`scene/RoverView.tsx` now solves the suspension each frame instead of laying the body on a plane:

- **Rocker-bogie** (MER, MSL, Yutu-2, Pragyan, Mercury crawler): the bogie pivots to keep its two wheels down, the rocker joins the front wheel to the bogie pivot, and the differential gives the body the mean rocker angle plus a roll from their height difference.
- **Lunokhod**: eight independently sprung wheels; the tub sits on their fitted plane.

Bodies gained what makes them recognisable: Curiosity's remote-sensing mast with ChemCam, stowed 2.2 m arm and turret, hexagonal high-gain antenna, chevron-grouser wheels; MER's deck array, Pancam mast, instrument arm and dish; Yutu-2's mast dish; Pragyan's navcams; Lunokhod's tub, opening solar lid, wire-mesh wheels, cone and helical antennas and the French retroreflector. Mast heights were corrected to the real overall heights (Curiosity ~2.2 m, Opportunity ~1.5 m, Yutu-2 ~1.1 m).

## Lunokhod 1 (calibrated)

| | Model | Reality |
|---|---|---|
| Heat source | 1.3 kW Po-210 (~9 g), half-life 138.4 days, behind a thermostatic valve | Po-210 source in a gas loop; power not published |
| Nights | Warm (+5 °C) through night 6, then ~15 °C colder each lunar month | — |
| End | Electronics freeze around day 306 | Last contact 14 Sep 1971, day 301 |
| Distance | 10.6 km | 10.54 km |

The isotope decay (`rhuHalfLifeDays`) and valve (`rhuValveK`) are new build fields. Without the valve an always-on heater big enough for the nights cooks the tub at noon. The test is in `sim/planets/planets.test.ts`.

## IPEx and the lunar loader

- IPEx at the south-pole ridge in summer (Sun never sets): digs the whole 90-day run, e-bay pinned at ~38 °C by the eicosane wax and the radiator that opens once it has melted.
- Lunar construction loader (hypothetical): silicone tracks, synthetic-ester hydraulics, space electronics, 100 kWh pack, 10 m² vertical panels. Findings: its steel frame passes the -40 °C brittle point in shadow; it needs a radiator (no air to cool electronics in MLI); its pack needs heaters at +5 °C or Li-ion won't take a charge.
- Venus-hardened D6 (hypothetical): survives ~4 h on its thermal battery, but even polyphenyl-ether hydraulics fail once soaked to 462 °C. A Venus dozer needs electromechanical actuators.
