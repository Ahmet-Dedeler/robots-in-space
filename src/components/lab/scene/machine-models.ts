/**
 * Detailed 3D models of the construction machines, drawn from the same spec
 * sheet dimensions as their MuJoCo bodies (robots/machines.ts). Each model is
 * a set of groups keyed by physics body name; MachineView poses them from the
 * simulation every frame. Nothing here affects the physics.
 *
 * No manufacturer CAD is used: shapes are simplified side profiles of the
 * real machines (cab, engine housing, lift arms, blade, boom...).
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { MachineDef, MachineModel, Tracks } from "@/sim/robots/machines";
import {
  type Belt,
  type MachineMaterials,
  type P2,
  type Ram,
  boxGeo,
  cylX,
  cylY,
  cylZ,
  decal,
  grouserWheel,
  makeBelt,
  makeRam,
  onFlank,
  rimGeometry,
  sideProfile,
  sprocketGeometry,
  thickLine,
  topProfile,
  tube,
  tyreGeometry,
} from "./machine-parts";

export interface MachineRig {
  /** In the MuJoCo frame (z up); the caller rotates it into three's y-up world. */
  root: THREE.Group;
  /** Groups posed from the physics bodies of the same name. */
  bodies: Map<string, THREE.Group>;
  belts: Belt[];
  /** Rollers, idlers and sprockets turning with the belt on one side. */
  wheels: { obj: THREE.Object3D; side: 1 | -1; r: number }[];
  /** Tyres that shrink onto their rims when the rubber burns (gear joint index). */
  tyres: { obj: THREE.Object3D; gear: number }[];
  rams: Ram[];
}

type V3 = [number, number, number];

class Builder {
  readonly root = new THREE.Group();
  readonly bodies = new Map<string, THREE.Group>();
  readonly belts: Belt[] = [];
  readonly wheels: MachineRig["wheels"] = [];
  readonly tyres: MachineRig["tyres"] = [];
  readonly rams: Ram[] = [];
  constructor(readonly m: MachineMaterials) {}

  body(name: string) {
    let g = this.bodies.get(name);
    if (!g) {
      g = new THREE.Group();
      g.matrixAutoUpdate = false;
      this.bodies.set(name, g);
      this.root.add(g);
    }
    return g;
  }

  add(body: string | THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    (typeof body === "string" ? this.body(body) : body).add(mesh);
    return mesh;
  }

  ram(a: string, at: V3, b: string, bt: V3, r: number, barrel: number, barrelMat = this.m.paint) {
    const ram = makeRam({ body: a, at }, { body: b, at: bt }, r, barrel, { barrel: barrelMat, rod: this.m.chrome });
    ram.barrel.castShadow = ram.rod.castShadow = true;
    this.root.add(ram.barrel, ram.rod);
    this.rams.push(ram);
  }

  /** Both sides (y and -y) of a symmetric part. */
  pair(fn: (side: 1 | -1) => void) {
    fn(1);
    fn(-1);
  }

  /** Rubber belt or steel shoes around the pulleys, with turning wheels on the chassis. */
  tracks(gear: Tracks, wheels: { x: number; z: number; r: number; kind: "roller" | "idler" | "sprocket" }[]) {
    this.pair((side) => {
      const y = side * gear.halfGauge;
      const belt = makeBelt({ pulleys: gear.pulleys, y, side, width: gear.width, pitch: gear.pitch, kind: gear.shoe, material: this.m.track });
      belt.mesh.castShadow = true;
      this.body("chassis").add(belt.mesh);
      this.belts.push(belt);
      for (const w of wheels) {
        const g = new THREE.Group();
        g.position.set(w.x, y, w.z);
        const width = w.kind === "roller" ? gear.width * 0.8 : gear.width * 0.55;
        if (w.kind === "sprocket") this.add(g, sprocketGeometry(w.r, width * 0.6), this.m.steel);
        else {
          this.add(g, cylY(w.r, width, [0, 0, 0], 28), this.m.dark);
          this.add(g, cylY(w.r * 0.45, width * 1.08, [0, 0, 0], 12), this.m.steel);
        }
        this.body("chassis").add(g);
        this.wheels.push({ obj: g, side, r: w.r });
      }
    });
  }

  rig(): MachineRig {
    return { root: this.root, bodies: this.bodies, belts: this.belts, wheels: this.wheels, tyres: this.tyres, rams: this.rams };
  }
}

/** Glass-sided operator cab: posts, panes, roof, seat. x0..x1 along the machine, z0..z1 high. */
function cab(b: Builder, body: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, roof: THREE.Material) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const L = x1 - x0;
  const W = y1 - y0;
  const H = z1 - z0;
  const post = 0.07;
  for (const x of [x0 + post / 2, x1 - post / 2]) for (const y of [y0 + post / 2, y1 - post / 2]) b.add(body, boxGeo(post, post, H, [x, y, z0 + H / 2]), b.m.dark);
  // Lower panels, then glass above the beltline.
  const belt = z0 + H * 0.18;
  b.add(body, boxGeo(L, W, belt - z0, [cx, cy, (z0 + belt) / 2]), b.m.dark);
  b.add(body, boxGeo(L - post, W - post, z1 - belt - 0.03, [cx, cy, (belt + z1) / 2]), b.m.glass);
  b.add(body, boxGeo(L + 0.08, W + 0.08, 0.08, [cx, cy, z1 + 0.03]), roof);
  // Seat and controls, visible through the glass. Nobody's driving: on Venus nobody could.
  b.add(body, boxGeo(0.45, 0.48, 0.12, [cx - L * 0.12, cy, belt + 0.12]), b.m.seat);
  b.add(body, boxGeo(0.12, 0.48, 0.6, [cx - L * 0.12 - 0.24, cy, belt + 0.42]), b.m.seat);
  for (const s of [-1, 1]) b.add(body, cylZ(0.015, 0.25, [cx + L * 0.1, cy + s * 0.27, belt + 0.25]), b.m.seat);
}

// ---------------------------------------------------------------------------
// Cat 262D3 skid steer and 299D3 compact track loader (same vertical-lift body).
// ---------------------------------------------------------------------------
function buildLoader(def: MachineDef, m: MachineMaterials, label: string): MachineRig {
  const b = new Builder(m);
  const tracked = def.gear.kind === "tracks";
  const dz = tracked ? 0.08 : 0;
  const Z = (pts: P2[]) => pts.map(([x, z]) => [x, z + dz] as P2);

  // Main body: low nose under the cab, rising to the rear towers that carry the lift arms.
  b.add("chassis", sideProfile(Z([[1.0, 0.3], [1.06, 0.55], [0.98, 0.97], [-0.42, 0.97], [-0.5, 1.3], [-0.8, 1.56], [-1.22, 1.5], [-1.44, 1.22], [-1.46, 0.42], [-1.3, 0.3]]), 1.06), m.paint);
  b.add("chassis", boxGeo(1.9, 1.0, 0.08, [-0.2, 0, 0.3 + dz]), m.dark);
  // Rear engine door: grille, tail lights, counterweight bar.
  b.add("chassis", boxGeo(0.04, 0.78, 0.5, [-1.47, 0, 0.9 + dz]), m.grille);
  b.add("chassis", boxGeo(0.1, 1.0, 0.16, [-1.47, 0, 0.42 + dz]), m.dark);
  b.pair((s) => b.add("chassis", boxGeo(0.03, 0.09, 0.14, [-1.48, s * 0.44, 1.22 + dz]), m.tail));
  // Lift-arm towers' pivot bosses.
  b.add("chassis", cylY(0.08, 1.62, [-0.86, 0, 1.42]), m.dark);
  cab(b, "chassis", -0.45, 0.63, -0.47, 0.47, 0.97 + dz, 2.06 + dz, m.dark);
  b.pair((s) => b.add("chassis", boxGeo(0.05, 0.12, 0.08, [0.66, s * 0.36, 1.98 + dz]), m.lamp));
  b.add("chassis", boxGeo(0.05, 0.14, 0.08, [-0.47, 0, 2.0 + dz]), m.lamp);
  b.pair((s) => b.body("chassis").add(onFlank(decal(label, 0.12), s, [-1.0, s * 0.535, 1.18 + dz])));

  if (def.gear.kind === "wheels") {
    const wheels = def.gear;
    wheels.at.forEach(([, y], i) => {
      const g = new THREE.Group();
      const out = Math.sign(y);
      b.add(g, tyreGeometry(wheels.r, wheels.width), m.rubber);
      const rim = b.add(g, rimGeometry(0.26, wheels.width * 0.9), m.paint);
      rim.position.y = out * 0.01;
      b.body(`gear${i}`).add(g);
      b.tyres.push({ obj: g, gear: i });
    });
  } else {
    const g = def.gear;
    b.pair((s) => b.add("chassis", sideProfile([[0.92, 0.2], [0.98, 0.36], [0.6, 0.5], [-0.62, 0.52], [-0.95, 0.4], [-0.9, 0.2]], 0.16, s * g.halfGauge), m.dark));
    b.tracks(g, [
      ...[-0.66, -0.22, 0.22, 0.66].map((x) => ({ x, z: 0.17, r: 0.12, kind: "roller" as const })),
      { x: 0.9, z: 0.27, r: 0.23, kind: "idler" },
      { x: -0.84, z: 0.36, r: 0.33, kind: "sprocket" },
    ]);
  }

  // Lift arms (arm frame: origin at the rear pivot; bucket pin at (2.08, -1.04)).
  b.pair((s) => {
    b.add("arms", sideProfile([[-0.14, 0.12], [0.45, 0.16], [1.25, 0.0], [1.9, -0.62], [2.16, -0.98], [2.12, -1.12], [1.98, -1.1], [1.72, -0.8], [1.12, -0.22], [0.4, -0.1], [-0.14, -0.14]], 0.08, s * 0.74), m.paint);
    b.add("arms", cylY(0.06, 0.12, [2.08, s * 0.74, -1.04]), m.dark);
  });
  b.add("arms", tube([1.74, 0.74, -0.78], [1.74, -0.74, -0.78], 0.065), m.paint);

  // Bucket (pin at origin, level when tilt cancels lift).
  const hw = def.model === "trackloader" ? 0.99 : 0.865;
  b.add("bucket", sideProfile(thickLine([[-0.05, 0.3], [-0.08, 0.02], [-0.02, -0.22], [0.12, -0.33], [0.7, -0.36]], 0.03), 2 * hw), m.dark);
  b.pair((s) => b.add("bucket", sideProfile([[-0.06, 0.3], [0.22, 0.3], [0.72, -0.3], [0.72, -0.37], [0.12, -0.37], [-0.04, -0.25], [-0.1, 0.0]], 0.025, s * (hw - 0.012)), m.dark));
  b.add("bucket", boxGeo(0.26, 2 * hw, 0.025, [0.08, 0, 0.3]), m.dark);
  b.add("bucket", boxGeo(0.14, 2 * hw, 0.03, [0.66, 0, -0.355]), m.worn);
  b.add("bucket", boxGeo(0.04, 1.1, 0.52, [-0.12, 0, 0.0]), m.dark);

  // Lift and tilt rams.
  b.pair((s) => b.ram("chassis", [-1.16, s * 0.62, 0.72 + dz], "arms", [0.62, s * 0.66, -0.16], 0.055, 0.7));
  b.pair((s) => b.ram("arms", [1.62, s * 0.34, -0.62], "bucket", [-0.1, s * 0.34, 0.26], 0.045, 0.32));
  return b.rig();
}

// ---------------------------------------------------------------------------
// Cat D6 dozer.
// ---------------------------------------------------------------------------
function buildDozer(def: MachineDef, m: MachineMaterials): MachineRig {
  const b = new Builder(m);
  const g = def.gear as Tracks;
  // Undercarriage: roller frames, eight bottom rollers, front/rear idlers, elevated sprocket.
  b.pair((s) => b.add("chassis", sideProfile([[1.45, 0.22], [1.56, 0.55], [0.9, 0.7], [-1.1, 0.7], [-1.52, 0.55], [-1.45, 0.22]], 0.3, s * g.halfGauge), m.dark));
  b.tracks(g, [
    ...Array.from({ length: 8 }, (_, i) => ({ x: -1.31 + i * 0.374, z: 0.165, r: 0.13, kind: "roller" as const })),
    { x: 1.58, z: 0.42, r: 0.38, kind: "idler" },
    { x: -1.58, z: 0.42, r: 0.38, kind: "idler" },
    { x: -1.02, z: 1.2, r: 0.44, kind: "sprocket" },
  ]);
  b.add("chassis", boxGeo(3.2, 1.2, 0.6, [0, 0, 0.72]), m.dark);
  // Engine housing with radiator grille up front.
  b.add("chassis", sideProfile([[0.05, 1.0], [1.95, 1.0], [1.99, 1.6], [1.86, 1.9], [0.12, 2.02], [0.0, 1.9]], 1.15), m.paint);
  b.add("chassis", boxGeo(0.06, 1.0, 0.72, [1.99, 0, 1.36]), m.grille);
  for (let i = 0; i < 6; i++) b.add("chassis", boxGeo(0.05, 1.04, 0.035, [2.02, 0, 1.06 + i * 0.12]), m.paint);
  b.pair((s) => {
    for (let i = 0; i < 4; i++) b.add("chassis", boxGeo(0.5, 0.01, 0.05, [1.15, s * 0.58, 1.38 + i * 0.1]), m.grille);
  });
  b.add("chassis", cylZ(0.075, 0.6, [1.3, -0.32, 2.3]), m.dark);
  b.add("chassis", cylZ(0.11, 0.3, [1.3, 0.3, 2.15]), m.dark);
  // Fenders over the tracks, cab platform, rear fuel tank.
  b.pair((s) => b.add("chassis", boxGeo(1.95, 0.72, 0.08, [-0.85, s * 0.95, 1.38]), m.paint));
  b.add("chassis", boxGeo(1.5, 1.2, 0.45, [-1.05, 0, 1.18]), m.paint);
  b.add("chassis", boxGeo(0.4, 1.4, 0.6, [-1.88, 0, 1.12]), m.paint);
  b.pair((s) => b.add("chassis", tube([-1.85, s * 1.3, 1.75], [0.0, s * 1.3, 1.75], 0.022), m.dark));
  cab(b, "chassis", -1.78, -0.38, -0.8, 0.8, 1.42, 3.1, m.paint);
  b.add("chassis", cylZ(0.06, 0.1, [-1.5, 0.5, 3.2]), new THREE.MeshStandardMaterial({ color: "#ff9f1a", emissive: "#b35a00", emissiveIntensity: 0.5 }));
  b.pair((s) => b.add("chassis", boxGeo(0.06, 0.16, 0.1, [-0.34, s * 0.55, 3.05]), m.lamp));
  b.pair((s) => b.body("chassis").add(onFlank(decal("D6", 0.3), s, [0.85, s * 0.58, 1.68])));

  // Blade on push arms (blade frame origin at the trunnions, (-0.2, 0, 0.62) on the chassis).
  b.pair((s) => {
    b.add("blade", sideProfile([[0, 0.12], [2.4, 0.06], [2.4, -0.26], [0, -0.12]], 0.16, s * 1.36), m.paint);
    b.add("blade", cylY(0.11, 0.22, [0, s * 1.36, 0]), m.dark);
  });
  const face: P2[] = [[2.74, -0.62], [2.62, -0.38], [2.55, -0.05], [2.56, 0.3], [2.62, 0.58], [2.72, 0.79]];
  b.add("blade", sideProfile(thickLine(face, 0.07), 2.4), m.paint);
  b.pair((s) => {
    // 6SU end wings, toed in 16°.
    const wing = sideProfile(thickLine(face, 0.07), 0.46).translate(-2.6, s * 0.23, 0).rotateZ(-s * 0.28).translate(2.6, s * 1.2, 0);
    b.add("blade", wing, m.paint);
  });
  b.add("blade", boxGeo(0.28, 2.3, 0.95, [2.36, 0, 0.05]), m.dark);
  b.add("blade", boxGeo(0.07, 2.4, 0.14, [2.75, 0, -0.55]), m.worn);
  // Ripper.
  b.add("ripper", boxGeo(0.35, 1.7, 0.25, [-0.3, 0, 0]), m.paint);
  b.pair((s) => b.add("ripper", tube([0, s * 0.6, 0.05], [-0.3, s * 0.6, 0.05], 0.06), m.dark));
  for (const y of [-0.55, 0, 0.55]) {
    b.add("ripper", sideProfile([[-0.45, 0.1], [-0.25, 0.1], [-0.4, -0.6], [-0.55, -1.02], [-0.72, -1.14], [-0.66, -0.95], [-0.56, -0.6]], 0.07, y), m.dark);
    b.add("ripper", boxGeo(0.14, 0.08, 0.08, [-0.66, y, -1.07]).rotateY(0.5), m.worn);
  }
  // Blade lift and ripper rams.
  b.pair((s) => b.ram("chassis", [1.78, s * 0.64, 1.72], "blade", [2.3, s * 0.64, 0.45], 0.075, 0.95));
  b.pair((s) => b.ram("chassis", [-1.8, s * 0.42, 1.3], "ripper", [-0.3, s * 0.42, 0.12], 0.07, 0.4));
  return b.rig();
}

// ---------------------------------------------------------------------------
// Cat 320 excavator.
// ---------------------------------------------------------------------------
function buildExcavator(def: MachineDef, m: MachineMaterials): MachineRig {
  const b = new Builder(m);
  const g = def.gear as Tracks;
  b.pair((s) => b.add("chassis", sideProfile([[1.75, 0.22], [1.92, 0.55], [1.55, 0.8], [-1.55, 0.8], [-1.92, 0.55], [-1.75, 0.22]], 0.42, s * g.halfGauge), m.dark));
  b.tracks(g, [
    ...Array.from({ length: 7 }, (_, i) => ({ x: -1.2 + i * 0.4, z: 0.145, r: 0.11, kind: "roller" as const })),
    ...[-0.6, 0.6].map((x) => ({ x, z: 0.87, r: 0.085, kind: "roller" as const })),
    { x: 1.825, z: 0.42, r: 0.34, kind: "idler" },
    { x: -1.825, z: 0.42, r: 0.35, kind: "sprocket" },
  ]);
  b.add("chassis", boxGeo(1.6, 1.9, 0.48, [0, 0, 0.71]), m.dark);
  b.add("chassis", cylZ(0.85, 0.06, [0, 0, 0.97], 40), m.dark);

  // Upper structure (frame origin on the swing bearing, 1.0 m up).
  b.add("upper", boxGeo(3.6, 2.54, 0.1, [-0.35, 0, 0.1]), m.dark);
  const tail = 2.83;
  const reach = Math.asin(1.27 / tail);
  const arc: P2[] = Array.from({ length: 17 }, (_, i) => {
    const a = Math.PI - reach + (2 * reach * i) / 16;
    return [Math.cos(a) * tail, -Math.sin(a) * tail];
  });
  b.add("upper", topProfile([[-2.05, -1.27], ...arc.reverse().map(([x, y]) => [x, -y] as P2), [-2.05, 1.27]], 0.06, 1.15), m.dark);
  b.add("upper", sideProfile([[-2.05, 0.12], [-0.35, 0.12], [-0.35, 1.2], [-0.55, 1.42], [-2.05, 1.42]], 2.5), m.paint);
  b.pair((s) => {
    for (let i = 0; i < 5; i++) b.add("upper", boxGeo(0.7, 0.01, 0.05, [-1.25, s * 1.255, 0.6 + i * 0.12]), m.grille);
  });
  b.add("upper", boxGeo(1.55, 0.7, 1.0, [0.45, -0.9, 0.62]), m.paint);
  b.add("upper", boxGeo(0.8, 0.5, 0.75, [0.55, -0.12, 0.55]), m.paint);
  b.add("upper", cylZ(0.07, 0.4, [-1.0, -0.6, 1.62]), m.dark);
  b.add("upper", tube([-2.0, -1.24, 1.75], [0.95, -1.24, 1.75], 0.022), m.paint);
  cab(b, "upper", -0.25, 1.35, 0.27, 1.25, 0.12, 1.94, m.dark);
  b.add("upper", boxGeo(0.06, 0.18, 0.1, [1.38, 0.5, 1.85]), m.lamp);
  b.pair((s) => b.body("upper").add(onFlank(decal("320", 0.24), s, [-1.25, s * 1.256, 1.2])));

  // Boom: box-section "banana", foot at the origin, nose pin at (5.7, 0).
  b.add("boom", sideProfile([[-0.18, 0.22], [1.0, 0.75], [2.6, 1.08], [4.0, 0.64], [5.62, 0.2], [5.86, 0.0], [5.72, -0.2], [4.0, 0.16], [2.6, 0.5], [1.2, 0.24], [0.12, -0.26], [-0.22, -0.06]], 0.58), m.paint);
  b.add("boom", cylY(0.11, 0.75, [0, 0, 0]), m.dark);
  b.add("boom", boxGeo(0.25, 0.3, 0.2, [2.5, 0, 1.12]), m.paint);
  b.add("boom", boxGeo(0.12, 0.16, 0.1, [1.6, 0, 0.95]).rotateY(0.3), m.lamp);
  // Stick, with its tail above the boom-nose pin for the stick ram.
  b.add("stick", sideProfile([[-0.68, 0.46], [-0.3, 0.52], [1.0, 0.28], [2.86, 0.12], [3.02, 0.0], [2.86, -0.15], [0.5, -0.25], [-0.2, -0.22], [-0.72, 0.2]], 0.42), m.paint);
  b.add("stick", cylY(0.09, 0.62, [0, 0, 0]), m.dark);
  b.add("stick", cylY(0.07, 0.62, [2.9, 0, 0]), m.dark);
  // Bucket (pin at origin; teeth at ~1.57 m tip radius, opening on the -z side).
  const shell: P2[] = [[0.05, 0.08], [0.6, 0.42], [1.2, 0.38], [1.55, 0.02], [1.52, -0.42], [1.45, -0.62]];
  b.add("bucket", sideProfile(thickLine(shell, -0.035), 1.1), m.dark);
  b.pair((s) => b.add("bucket", sideProfile([...shell, [0.25, -0.18], [0.0, -0.05]], 0.025, s * 0.56), m.dark));
  b.add("bucket", boxGeo(0.12, 1.12, 0.05, [1.47, 0, -0.55]).rotateY(0), m.worn);
  for (let i = 0; i < 5; i++) b.add("bucket", boxGeo(0.07, 0.08, 0.2, [1.42, -0.44 + i * 0.22, -0.72]).rotateY(-0.33), m.worn);
  b.pair((s) => b.add("bucket", sideProfile([[-0.15, 0.15], [0.35, 0.3], [0.3, -0.1], [-0.1, -0.12]], 0.04, s * 0.22), m.dark));

  b.pair((s) => b.ram("upper", [1.05, -0.12 + s * 0.38, 0.38], "boom", [2.3, s * 0.38, 0.4], 0.085, 1.5));
  b.ram("boom", [2.55, 0, 1.12], "stick", [-0.62, 0, 0.42], 0.08, 1.4);
  b.ram("stick", [0.15, 0, 0.36], "bucket", [-0.02, 0, 0.3], 0.07, 1.1);
  return b.rig();
}

// ---------------------------------------------------------------------------
// NASA IPEx.
// ---------------------------------------------------------------------------
function buildIpex(def: MachineDef, m: MachineMaterials): MachineRig {
  const b = new Builder(m);
  b.add("chassis", new RoundedBoxGeometry(0.54, 0.36, 0.2, 3, 0.025).translate(0, 0, 0.22), m.white);
  // Dust cover over the radiator (also carries the wireless-charging antenna).
  b.add("chassis", new RoundedBoxGeometry(0.36, 0.3, 0.025, 2, 0.008).translate(-0.04, 0, 0.335), m.alu);
  b.add("chassis", boxGeo(0.06, 0.2, 0.06, [0.24, 0, 0.36]), m.dark);
  b.pair((s) => {
    b.add("chassis", cylX(0.018, 0.02, [0.275, s * 0.06, 0.365], 12), m.glass);
    b.add("chassis", cylY(0.05, 0.06, [0.17, s * 0.19, 0.15]), m.dark);
    b.add("chassis", cylY(0.05, 0.06, [-0.17, s * 0.19, 0.15]), m.dark);
  });
  b.add("chassis", boxGeo(0.02, 0.14, 0.03, [0.275, 0, 0.29]), m.lamp);
  if (def.gear.kind === "wheels") def.gear.at.forEach((_, i) => b.add(`gear${i}`, grouserWheel(0.15, 0.1), m.alu));
  for (const [arm, sign] of [
    ["front", 1],
    ["rear", -1],
  ] as const) {
    b.add(arm, boxGeo(0.34, 0.07, 0.045, [0.17 * sign, 0, 0]), m.alu);
    b.add(arm, cylY(0.045, 0.12, [0, 0, 0]), m.dark);
    b.add(arm, cylY(0.04, 0.14, [0.34 * sign, 0, 0]), m.dark);
    // Bucket drums: open cylinders with staggered scoops.
    const drums = `${arm}_drums`;
    b.pair((s) => {
      b.add(drums, cylY(0.14, 0.22, [0, s * 0.18, 0], 32), m.alu);
      b.add(drums, cylY(0.15, 0.012, [0, s * 0.29, 0], 32), m.steel);
      b.add(drums, cylY(0.15, 0.012, [0, s * 0.07, 0], 32), m.steel);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + (s > 0 ? 0 : Math.PI / 8);
        b.add(drums, boxGeo(0.02, 0.18, 0.05, [0.15, s * 0.18, 0]).rotateY(-a), m.dark);
      }
    });
  }
  return b.rig();
}

const LABEL: Partial<Record<MachineModel, string>> = { skidsteer: "262D3", trackloader: "299D3" };

export function buildMachine(def: MachineDef, m: MachineMaterials): MachineRig {
  switch (def.model) {
    case "skidsteer":
    case "trackloader":
      return buildLoader(def, m, LABEL[def.model]!);
    case "dozer":
      return buildDozer(def, m);
    case "excavator":
      return buildExcavator(def, m);
    case "ipex":
      return buildIpex(def, m);
  }
}
