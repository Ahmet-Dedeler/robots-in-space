import { describe, expect, it } from "vitest";
import { BODIES } from "./bodies";
import { apply, enu, MARS_MOONS, moonletEnu, obliquityDeg, poleJ2000, radec, skyRotation, sunFromSeasonJ2000 } from "./sky";

const DEG = Math.PI / 180;
const angle = (a: number[], b: number[]) => Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) / DEG;

describe("real sky", () => {
  it("pole + orbit tables reproduce the published obliquities", () => {
    expect(obliquityDeg("mars")).toBeCloseTo(25.19, 1);
    expect(obliquityDeg("moon")).toBeCloseTo(1.54, 1);
    expect(obliquityDeg("mercury")).toBeLessThan(0.1);
  });

  it("Mars Ls gives the right solar declination", () => {
    const P = poleJ2000("mars");
    for (const ls of [0, 90, 180, 270]) {
      const s = sunFromSeasonJ2000("mars", ls);
      const dec = Math.asin(s[0] * P[0] + s[1] * P[1] + s[2] * P[2]) / DEG;
      expect(dec).toBeCloseTo(25.19 * Math.sin(ls * DEG), 1);
    }
  });

  it("Martian north celestial pole sits near Deneb/Alderamin (Cygnus-Cepheus)", () => {
    const deneb = radec(310.358, 45.28);
    expect(angle(poleJ2000("mars"), deneb)).toBeLessThan(12);
  });

  it("the sky rotation puts the Sun and the pole where they belong", () => {
    // Lunar equinox at 45°S, two hours (30° of hour angle) before noon: Sun at az 39.2°, el 37.8°.
    const sun = sunFromSeasonJ2000("moon", 0);
    const R = skyRotation("moon", -45, sun, 39.23, 37.76);
    const s = apply(R, sun);
    // The pole is placed exactly; the Sun to within the sim/orbit declination mismatch (small).
    expect(angle(apply(R, poleJ2000("moon")), enu(0, -45))).toBeLessThan(1e-4);
    expect(angle(s, enu(39.23, 37.76))).toBeLessThan(0.1);
  });

  it("Phobos is ~0.2° wide overhead at the equator and rises in the west", () => {
    const mars = BODIES.mars;
    const ph = MARS_MOONS[0];
    const over = moonletEnu(ph, mars, 0, 0, 0);
    expect(over.dir[2]).toBeCloseTo(1, 6);
    expect((2 * Math.atan(ph.radiusM / over.distanceM)) / DEG).toBeCloseTo(0.21, 1.5);
    // A little later it has moved east (it outruns Mars's spin): rises west, sets east.
    const later = moonletEnu(ph, mars, 0, 600, 0);
    expect(later.dir[0]).toBeGreaterThan(0);
  });
});
