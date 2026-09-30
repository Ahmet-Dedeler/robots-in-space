/**
 * Venus ground, built from what the Venera landers actually photographed.
 *
 * Sources (via Kreslavsky/Carter et al., "Sedimentary Processes on Venus",
 * Space Sci. Rev. 2023, and Garvin et al. 1984 "Venus: the nature of the
 * surface from Venera panoramas"):
 * - Venera 10/13/14: bedrock of laminated, thinly bedded sheets a few cm
 *   thick, with varying coarse sediment between the slabs. Venera 14 had the
 *   least sediment: interlocked, subangular to subrounded, possibly jointed
 *   plates. Venera 13 had more loose, mobile fines (wind stripped sediment off
 *   the lander ring within an hour).
 * - Venera 9: a 15-20 degree talus slope with subangular boulders up to
 *   60 cm wide and 20 cm tall in coarse gravel.
 * - Surface materials: bulk density ~1500 kg/m^3, ~50% porosity (Venera
 *   13/14 mechanical data); strength like dense sand/weak rock (V13) to
 *   sandstone (V14, Vega 2).
 * - Rock composition: basalt (V13 high-K alkaline, V14 tholeiitic). Albedo is
 *   low; the orange colour in the photos is the light, not the rock.
 *
 * Plate sizes and exact layer counts are read off the panoramas (5 cm scale
 * notches on the lander rings), so they are estimates, not measurements.
 *
 * h(x, y) is a pure deterministic function in metres (x east, y north, z up),
 * shared by the MuJoCo collision heightfield and the rendered ground.
 */

export interface TerrainStyle {
  id: string;
  name: string;
  note: string;
  /** Mean plate (Voronoi cell) size [m]. 0 = no plates. */
  plateSize: number;
  /** Plate thickness range [m]. */
  plateThickness: [number, number];
  /** Fraction of cells that hold a plate (rest is sediment). */
  plateCoverage: number;
  /** Chance a plate has a second, smaller layer on top. */
  layerChance: number;
  /** Gap between plates [m]. */
  crackWidth: number;
  /** Maximum plate tilt [deg]. */
  tiltDeg: number;
  /** Sediment surface height as a fraction of mean plate thickness. */
  sedimentFill: number;
  /** Site slope [deg], downhill toward -x. */
  slopeDeg: number;
  /** Boulders per m^2, max width and height [m]. */
  boulders: { density: number; maxWidth: number; maxHeight: number };
  /** Rock / sediment albedo-ish base colours (linear sRGB, under white light). */
  rockColor: [number, number, number];
  sedimentColor: [number, number, number];
  /** Coulomb friction for feet (basalt/sediment, dry, no water). */
  friction: number;
}

export const TERRAINS = {
  venera14: {
    id: "venera14",
    name: "Venera 14: bedrock plates",
    note: "Interlocked layered plates, very little soil. Most of the lowland plains likely look like this.",
    plateSize: 0.55,
    plateThickness: [0.02, 0.05],
    plateCoverage: 0.93,
    layerChance: 0.45,
    crackWidth: 0.012,
    tiltDeg: 3,
    sedimentFill: 0.35,
    slopeDeg: 0,
    boulders: { density: 0, maxWidth: 0, maxHeight: 0 },
    rockColor: [0.2, 0.175, 0.15],
    sedimentColor: [0.07, 0.058, 0.047],
    friction: 0.75,
  },
  venera13: {
    id: "venera13",
    name: "Venera 13: plates + loose soil",
    note: "Layered slabs partly buried in dark, fine, wind-mobile sediment, with scattered pebbles.",
    plateSize: 0.45,
    plateThickness: [0.02, 0.04],
    plateCoverage: 0.65,
    layerChance: 0.3,
    crackWidth: 0.03,
    tiltDeg: 5,
    sedimentFill: 0.7,
    slopeDeg: 0,
    boulders: { density: 1.5, maxWidth: 0.08, maxHeight: 0.03 },
    rockColor: [0.15, 0.13, 0.11],
    sedimentColor: [0.07, 0.06, 0.05],
    friction: 0.65,
  },
  venera9: {
    id: "venera9",
    name: "Venera 9: boulder talus slope",
    note: "A 17° slope of angular boulders up to 60 cm wide and 20 cm tall in coarse gravel (Beta Regio).",
    plateSize: 0,
    plateThickness: [0, 0],
    plateCoverage: 0,
    layerChance: 0,
    crackWidth: 0,
    tiltDeg: 0,
    sedimentFill: 0,
    slopeDeg: 17,
    boulders: { density: 0.55, maxWidth: 0.6, maxHeight: 0.2 },
    rockColor: [0.15, 0.135, 0.12],
    sedimentColor: [0.1, 0.085, 0.07],
    friction: 0.7,
  },
  flat: {
    id: "flat",
    name: "Flat test pad",
    note: "Perfectly flat ground, for comparing against the real terrain.",
    plateSize: 0,
    plateThickness: [0, 0],
    plateCoverage: 0,
    layerChance: 0,
    crackWidth: 0,
    tiltDeg: 0,
    sedimentFill: 0,
    slopeDeg: 0,
    boulders: { density: 0, maxWidth: 0, maxHeight: 0 },
    rockColor: [0.15, 0.13, 0.11],
    sedimentColor: [0.1, 0.085, 0.07],
    friction: 0.75,
  },
} as const satisfies Record<string, TerrainStyle>;

export type TerrainId = keyof typeof TERRAINS;

// ---- Deterministic hashing / noise -------------------------------------------------

function hash2(i: number, j: number, seed: number): number {
  let h = (i * 374761393 + j * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(i, j, seed);
  const b = hash2(i + 1, j, seed);
  const c = hash2(i, j + 1, seed);
  const d = hash2(i + 1, j + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, seed: number, octaves: number): number {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    s += amp * valueNoise(x * f, y * f, seed + o * 17);
    amp *= 0.5;
    f *= 2.03;
  }
  return s;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface TerrainSample {
  /** Height [m]. */
  h: number;
  /** 0 = sediment, 1 = rock plate, 2 = boulder. */
  kind: 0 | 1 | 2;
  /** Per-feature random shade 0..1. */
  shade: number;
  /** Distance to the nearest plate edge [m] (for weathering / crack darkening). */
  edge: number;
}

export class Terrain {
  readonly style: TerrainStyle;
  readonly seed: number;
  private readonly slope: number;
  private readonly boulderCell: number;

  constructor(style: TerrainStyle, seed = 1982) {
    this.style = style;
    this.seed = seed;
    this.slope = Math.tan((style.slopeDeg * Math.PI) / 180);
    // One candidate boulder per cell; probability sets the density.
    this.boulderCell = style.boulders.density > 0 ? Math.max(style.boulders.maxWidth * 1.4, 0.25) : 0;
  }

  /**
   * Large-scale ground: the local site slope (Venera 9's talus is a local
   * slope, not a planet-wide tilt, so it levels out beyond ~40 m), gentle
   * decimetre undulation, and metre-scale swells toward the horizon (Magellan
   * shows lowland plains are flat to within tens of metres over kilometres).
   */
  base(x: number, y: number): number {
    const r = Math.hypot(x, y);
    // Smoothly saturating slope: ~slope*x near the site, levelling off ~40 m out.
    const local = this.slope * 40 * Math.tanh(x / 40);
    const small = 0.04 * (fbm(x / 3, y / 3, this.seed + 5, 3) - 0.5);
    const swell = 6 * (fbm(x / 400, y / 400, this.seed + 41, 4) - 0.5) * smoothstep(30, 300, r);
    return local + small + swell;
  }

  sample(x: number, y: number): TerrainSample {
    const s = this.style;
    const base = this.base(x, y);
    const tMean = 0.5 * (s.plateThickness[0] + s.plateThickness[1]);
    // Sediment: fine grains (mm) over a slightly wavy fill level.
    let sediment = s.sedimentFill * tMean + 0.006 * (fbm(x / 0.5, y / 0.5, this.seed + 9, 2) - 0.5);
    if (s.id === "venera9") sediment += 0.02 * (fbm(x / 0.15, y / 0.15, this.seed + 21, 2) - 0.5); // coarse gravel
    let h = sediment;
    let kind: 0 | 1 | 2 = 0;
    let shade = fbm(x * 3, y * 3, this.seed + 3, 2);
    let edge = 1;

    if (s.plateSize > 0) {
      const cs = s.plateSize;
      // Domain warp: real joint patterns are irregular (elongated, curved, mixed sizes), not a honeycomb.
      const wx = x + 0.45 * cs * (fbm(x / (2.2 * cs), y / (2.2 * cs), this.seed + 51, 2) - 0.5);
      const wy = y + 0.45 * cs * (fbm(x / (2.2 * cs), y / (2.2 * cs), this.seed + 52, 2) - 0.5);
      const gx = wx / cs;
      const gy = wy / cs;
      const ci = Math.floor(gx);
      const cj = Math.floor(gy);
      let d1 = Infinity;
      let d2 = Infinity;
      let p1x = 0;
      let p1y = 0;
      let p2x = 0;
      let p2y = 0;
      let i1 = 0;
      let j1 = 0;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          const i = ci + di;
          const j = cj + dj;
          const px = (i + 0.15 + 0.7 * hash2(i, j, this.seed)) * cs;
          const py = (j + 0.15 + 0.7 * hash2(i, j, this.seed + 1)) * cs;
          const d = (wx - px) ** 2 + (wy - py) ** 2;
          if (d < d1) {
            d2 = d1;
            p2x = p1x;
            p2y = p1y;
            d1 = d;
            p1x = px;
            p1y = py;
            i1 = i;
            j1 = j;
          } else if (d < d2) {
            d2 = d;
            p2x = px;
            p2y = py;
          }
        }
      }
      // Exact distance to the Voronoi edge (perpendicular bisector).
      const sep = Math.hypot(p2x - p1x, p2y - p1y) || 1;
      edge = (d2 - d1) / (2 * sep);
      const hasPlate = hash2(i1, j1, this.seed + 2) < s.plateCoverage;
      shade = hash2(i1, j1, this.seed + 3);
      const half = s.crackWidth / 2;
      if (hasPlate && edge > half) {
        const t = s.plateThickness[0] + (s.plateThickness[1] - s.plateThickness[0]) * hash2(i1, j1, this.seed + 4);
        const tilt = Math.tan(((s.tiltDeg * Math.PI) / 180) * hash2(i1, j1, this.seed + 5));
        const ang = 2 * Math.PI * hash2(i1, j1, this.seed + 6);
        let top = t + tilt * (Math.cos(ang) * (wx - p1x) + Math.sin(ang) * (wy - p1y));
        // Subrounded edges: bevel over ~1.5 cm.
        top -= 0.4 * t * (1 - smoothstep(half, half + 0.015, edge));
        // Thin laminae: a second, smaller sheet on some plates.
        if (hash2(i1, j1, this.seed + 7) < s.layerChance) {
          const inset = cs * (0.12 + 0.12 * hash2(i1, j1, this.seed + 8));
          const t2 = 0.008 + 0.012 * hash2(i1, j1, this.seed + 9);
          top += t2 * smoothstep(inset, inset + 0.01, edge);
        }
        // Surface texture of weathered basalt (mm scale).
        top += 0.0025 * (fbm(x / 0.08, y / 0.08, this.seed + 11, 2) - 0.5);
        if (top > h) {
          h = top;
          kind = 1;
        }
      }
    }

    if (this.boulderCell > 0) {
      const b = this.boulder(x, y);
      if (b && b.h > h) {
        h = b.h;
        kind = 2;
        shade = b.shade;
      }
    }

    return { h: h + base, kind, shade, edge };
  }

  height(x: number, y: number): number {
    return this.sample(x, y).h;
  }

  /** Subangular boulders: superellipsoid caps with a random footprint and rotation. */
  private boulder(x: number, y: number): { h: number; shade: number } | null {
    const s = this.style.boulders;
    const cs = this.boulderCell;
    const ci = Math.floor(x / cs);
    const cj = Math.floor(y / cs);
    let best: { h: number; shade: number } | null = null;
    const p = s.density * cs * cs; // expected boulders per cell
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const i = ci + di;
        const j = cj + dj;
        if (hash2(i, j, this.seed + 30) > p) continue;
        // Size distribution skewed to small blocks (power law-ish).
        const size = Math.pow(hash2(i, j, this.seed + 31), 1.5);
        const w = Math.max(0.03, s.maxWidth * size);
        const a = w / 2;
        const bb = a * (0.55 + 0.45 * hash2(i, j, this.seed + 32));
        const H = Math.max(0.01, s.maxHeight * size * (0.6 + 0.4 * hash2(i, j, this.seed + 33)));
        const cx = (i + hash2(i, j, this.seed + 34)) * cs;
        const cy = (j + hash2(i, j, this.seed + 35)) * cs;
        const r = Math.PI * hash2(i, j, this.seed + 36);
        const dx = x - cx;
        const dy = y - cy;
        const u = (Math.cos(r) * dx + Math.sin(r) * dy) / a;
        const v = (-Math.sin(r) * dx + Math.cos(r) * dy) / bb;
        const q = Math.abs(u) ** 3.5 + Math.abs(v) ** 3.5; // subangular footprint
        if (q >= 1) continue;
        // Faceted top: coarse noise so blocks look broken, not smooth.
        const facet = 0.85 + 0.3 * valueNoise(u * 2.5 + i, v * 2.5 + j, this.seed + 37);
        const hb = H * Math.pow(1 - q, 0.3) * facet - 0.25 * H; // partly buried
        if (!best || hb > best.h) best = { h: hb, shade: hash2(i, j, this.seed + 38) };
      }
    }
    return best;
  }

  /**
   * Sample a square grid centred on (cx, cy): n x n points spanning [-half, half].
   * Row-major, row index along +y (MuJoCo hfield convention).
   */
  grid(cx: number, cy: number, half: number, n: number): Float32Array {
    const out = new Float32Array(n * n);
    const step = (2 * half) / (n - 1);
    for (let r = 0; r < n; r++) {
      const y = cy - half + r * step;
      for (let c = 0; c < n; c++) out[r * n + c] = this.height(cx - half + c * step, y);
    }
    return out;
  }
}

export function terrain(id: TerrainId, seed?: number): Terrain {
  return new Terrain(TERRAINS[id], seed);
}
