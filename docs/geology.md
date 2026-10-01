# Ground: terrain, rocks, soil, hazards

Status (2026-10-01). How the ground of each world is built, what it's checked against, and how to read it in the app. Code: `src/sim/terrain/` (terrain, soil, survey), `src/sim/robots/trip.ts` (fall diagnosis), `src/components/lab/GroundPanel.tsx` and `scene/GroundOverlay.tsx`.

## One function for everything

`Terrain.sample(x, y)` returns the height, the soil-surface height under any rock (`ground`), and what's there (plate / sediment / boulder). The same function feeds:

- the MuJoCo heightfield the feet collide with (2.5 cm grid over ±7 m),
- the rendered ground (identical sampling near the robot, coarser further out, craters to the horizon),
- the hazard map, the Ground tab's survey, and the fall diagnosis.

**Fixed 2026-10-01:** the physics used to treat any ground without plates, boulders or slope as a flat plane. That covered lunar mare, Mercury plains and rock-strewn Mars, even though they render craters and rocks. Robots walked through rocks they appeared to hit, and fell on flat planes where the picture showed rocks. `Terrain.isFlat` now counts craters, rocks and ripples, and a test checks that every ground except the test pad gets a heightfield. Effect on the walking calibration (same seeds):

| Robot | Ground | Before (flat plane) | After (real relief) |
|---|---|---|---|
| G1, Venus-hardened | Rock-strewn Mars | walks 0.44 m/s | catches a foot on rocks after ~4 s |
| G1 | Rock-strewn Mars | falls after ~15 s | catches a foot on rocks after ~4 s |
| G1 | Mercury plains | walks | falls after ~7 s |

Venus ground is bit-identical to before (checked on 200,000 points), and so is the robot pad on the other worlds.

## Grounds and sources

| Ground | World | Used at | Model | Fidelity |
|---|---|---|---|---|
| Venera 14 bedrock plates | Venus | lowland plains | Voronoi plates 2-5 cm thick, laminae, sediment in cracks; read off the panoramas | approximation |
| Venera 13 plates + soil | Venus | Venera 13 | plates mostly buried in fines, pebbles | approximation |
| Venera 9 talus | Venus | Beta Regio | 17° slope, blocks to 60 x 20 cm | approximation |
| Lunar mare | Moon | Apollo 11, Chang'e 4 | equilibrium craters N(>D) = 10^-1.1 D^-2 (Gault 1970), Golombek-Rapp rocks k = 0.01 | calibrated |
| Lunar highlands | Moon | Chandrayaan-3 | same craters, k = 0.02, brighter, 4° slope | calibrated |
| **South pole ridge** (new) | Moon | Artemis ridge | 6° slope (LOLA: <5-10° at 30 m on candidate sites), metre boulders at ~2,400/km² (LROC NAC counts 1,800-3,000/km² on the Shackleton rim / connecting ridge) | approximation |
| **Shadowed crater floor** (new) | Moon | Shackleton floor | smooth (LOLA), very porous regolith (LAMP: ~70% porosity) | hypothetical |
| **Fresh crater ejecta** (new) | Moon | (any site) | Surveyor 7 / Tycho-like block field, k = 0.12 plus boulders to 2 m | approximation |
| Gale crater floor | Mars | Gale | k = 0.07, fractured slabs, few craters (wind erases them) | calibrated |
| Rock-strewn plains | Mars | Jezero, Hellas | k = 0.16 (Viking 2) | calibrated |
| Meridiani ripples | Mars | Meridiani | k < 0.01, 1-2 cm granule ripples over outcrop | calibrated |
| **Dust-mantled volcano** (new) | Mars | Olympus Mons | thermal inertia 40-120 means fine dust (Putzig 2005); Viking drift-material strength | hypothetical |
| **Soft sand ripples** (new) | Mars | (any site) | 25 cm loose-sand drifts like Purgatory / Troy | approximation |
| Mercury smooth plains | Mercury | equator, 70°N | lunar statistics, darker (MESSENGER) | hypothetical |
| **Shadowed polar crater** (new) | Mercury | Prokofiev | 10-20 cm dark lag over ice (Paige 2013), porous | hypothetical |

Beyond the pad, crater statistics continue up to 600 m on the Moon and Mercury and 300 m on Mars, so the horizon shows real crater fields. Craters whose ejecta would reach the pad are skipped, because landing sites are chosen on intercrater ground.

## Soil mechanics (`soil.ts`)

| Soil | c | φ | Bekker n, kc, kφ | Source |
|---|---|---|---|---|
| Lunar regolith | 0.17 kPa | 35° | 1, 1.4 kN/m², 820 kN/m³ | Lunar Sourcebook Table 9.14 (LRV soil type B, matched Apollo 15 driving) |
| Porous polar regolith | 0 | 31° | 1, 0, 820 | LRV soil type A + LAMP porosity |
| Martian soil | 1.0 kPa | 33° | 1.1, 0.99, 1528 | Viking crusty/cloddy (Moore 1987), MER trenches (Sullivan 2011); Bekker moduli from terrestrial dry sand (Wong) |
| Martian drift dust | 1.6 kPa | 18° | guessed | Viking 1 drift material (Moore 1987) |
| Loose aeolian sand | 0 | 30° | 1, 0, 300 (guess) | MER, cohesionless end |
| Venus fines / bedrock | n/a | n/a | measured bearing 0.3-1 MPa / 3-10 MPa | Venera 13 penetrometer; Venera 14 and Vega 2 landing loads ("like sandstone"). Venera 14's penetrometer hit its own lens cap. |

The Ground tab combines these with the selected vehicle's foot or wheel (load per contact under local gravity, Bekker sinkage, Terzaghi bearing capacity with Vesic factors). Checks in `terrain.test.ts`:

- Apollo bootprints: a suited astronaut sinks 0.4-2 cm. ✓
- LRV ruts (~1.25 cm reported): Bekker's rigid wheel gives 0.6-3 cm. ✓
- A MER wheel on loose sand works its bearing capacity more than 3x harder than on firm Mars soil (Spirit at Troy). ✓
- Cohesionless bearing capacity scales with gravity: sand bears less on the Moon, because its grains weigh less.

## Reading the ground in the app

- **Hazard map** (button bottom-left of the viewport): unlit, hillshaded, 1 m grid. Yellow marks 3-10 cm steps or 10-20° slopes (catches a blind policy's toe), orange 10-20 cm or >20°, red >20 cm (a rover's belly). It works in permanent shadow and under Venus's flat orange light, where 3 cm plate edges are almost invisible.
- **Fall card + marker:** when the humanoid goes down, `FallWatch` looks at what its feet passed over in the last second. Red ring: a foot was low over an obstacle ≥3 cm. Amber: slope ≥10°. Blue (on the pelvis): nothing under the feet, so the gait itself went unstable.
- **Ground tab** (results panel): patch survey (obstacles per 100 m², tallest, slopes), soil and its sources, the vehicle's pressure, sinkage and bearing margin, and the calibrated walking result with its most common fall cause.

## Findings

- **Most low-gravity falls aren't trips.** Optimus (H1) falls from balance on every Moon, Mars and Mercury ground: the Earth-tuned gait runs away when the body weighs a third as much. The G1 trips on actual rocks on Gale and rock-strewn Mars, and on plate edges at Venera 13/14 (`walking.json`, `tripCause`). The timeline now says which.
- **Venus plates are toe-catchers, not obstacles.** The Venera 14 plates stand 1-4 cm above the fines, below any rover hazard threshold but enough to catch a blind policy's toe.
- **The poles are the soft spot.** Porous regolith in shadowed craters can't carry a narrow humanoid foot at the surface (Terzaghi utilisation >1): feet punch in until denser soil holds. Wide pads or wheels with low ground pressure do much better (Carrier: almost any round wheel works on the Moon below ~7-10 kPa).
- The G1's MuJoCo foot is four 5 mm contact spheres spanning 17 x 6 cm. A rock can sit between them, so the model under-reports toe catches a little compared with a real sole.

## Known gaps / next

- No wheel-soil contact for rovers (kinematic). The soil parameters are ready for a Bekker-Wong drive model (drawbar pull, slip-sinkage, rolling resistance).
- Soil is rigid in MuJoCo: feet don't sink into porous or loose ground in the 3D view. The Ground tab reports the sinkage instead.
- Crater floors are bowls. Real ones turn flat-floored or concentric once a crater reaches the regolith base (Quaide & Oberbeck 1968), and big fresh craters throw blocky ejecta.
- Ice-cemented regolith below the polar lag (much stronger) isn't modelled; it matters for digging and ISRU.
- Mercury and the polar sites are statistics borrowed from the Moon until a lander measures them.
