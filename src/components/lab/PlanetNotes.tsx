"use client";

/** "How this is computed" for the Moon, Mars and Mercury (Model tab). */
export function PlanetModelNotes() {
  return (
    <ul className="list-disc space-y-1 pl-4 text-stone-400">
      <li>
        Ground temperature: 1-D heat conduction through the top metre of regolith, solved to its periodic day/night cycle, with the Diviner lunar
        parameters (Hayne et al. 2017): density and conductivity rising with depth, radiative conductivity between grains, temperature-dependent heat
        capacity, albedo rising at low Sun. Reproduces Diviner&apos;s ~390 K lunar noon and ~95 K pre-dawn, and Mercury&apos;s ~700 K hot-longitude
        noon.
      </li>
      <li>
        Sun: mean-Sun day on the Moon and Mars (declination and distance from the season); on Mercury the full Kepler orbit, so the 3:2 resonance gives
        hot and warm longitudes and the Sun stops and backs up near perihelion.
      </li>
      <li>
        Mars air: hydrostatic pressure calibrated to Viking and Curiosity REMS, a seasonal ±11% CO₂ cycle, dust (optical depth τ) splitting sunlight
        into beam and diffuse sky light and warming the nights. Real-gas CO₂ properties from the same CoolProp table as Venus.
      </li>
      <li>
        Heat: the same lumped thermal network as Venus. In vacuum there is no convection; parts inside an open robot radiate to its shell, rovers keep
        theirs in an insulated warm box. Sunlight heats the shell (beam, sky, and ground reflection). Porous insulation works far better without gas in
        its pores.
      </li>
      <li>
        Survival kit: solar arrays (flat, Sun-tracking or vertical), hibernation, thermostatic heaters, radioisotope heater units, RTG waste heat, and a
        radiator that opens when the box runs warm.
      </li>
      <li>
        Cold failures: minimum operating and survival temperatures per part (Li-ion freezes near -40 °C and can&apos;t charge below 0 °C; commercial
        electronics are stored to ~-55 °C; grease stiffens; rubber turns glassy near -60 °C; BCC steels go brittle).
      </li>
      <li>
        Ground: crater populations from the lunar equilibrium size-frequency law (Gault 1970), out to the horizon, rocks from the Golombek-Rapp
        abundance model used to certify Mars landing sites, LROC boulder counts at the south pole, ripples at Meridiani. Soil mechanics (Bekker
        sinkage, Terzaghi bearing capacity) from the Apollo LRV studies, Viking and MER trenches. Small worlds curve away: the lunar horizon is ~2.4
        km off. See the Ground tab and the hazard map.
      </li>
      <li>
        Checked against history: Pragyan dies in its first lunar night, Yutu-2 wakes up after each one, Curiosity runs through the 2018 dust storm,
        Opportunity dies in it within weeks.
      </li>
      <li>Rovers are kinematic (no MuJoCo). Humanoids use the same MuJoCo model with this world&apos;s gravity and gas (none on the Moon).</li>
    </ul>
  );
}
