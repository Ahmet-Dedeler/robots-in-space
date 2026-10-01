/**
 * Geometry toolkit for the construction machines. Everything is built in the
 * MuJoCo frame of the body it rides on (z up, x forward, y left), so a part
 * placed at (x, y, z) here sits at that point of the physics body.
 *
 * Machines are mostly flat plate work, so most parts are side profiles
 * (x, z polygons straight off a spec-sheet drawing) extruded across y.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type P2 = [number, number];

/** Side profile (x, z) extruded across y, centred on `y`. */
export function sideProfile(points: P2[], width: number, y = 0, bevel = 0.012): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, width - 2 * bevel),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 6,
  });
  // Shape (x, y) -> (x, z); extrusion along +z -> -y. Then centre on y.
  geo.rotateX(Math.PI / 2);
  geo.translate(0, y + width / 2 - bevel, 0);
  return geo;
}

/** Top-view outline (x, y) extruded upward from z0 to z1. */
export function topProfile(points: P2[], z0: number, z1: number, bevel = 0.015): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0 - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 12 });
  geo.translate(0, 0, z0 + bevel);
  return geo;
}

/** A polyline (x, z) given thickness: plates like bucket shells and blade moldboards. */
export function thickLine(points: P2[], thickness: number): P2[] {
  const n = points.length;
  const off: P2[] = points.map((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    // Left normal of the travel direction.
    return [p[0] - (dz / l) * thickness, p[1] + (dx / l) * thickness];
  });
  return [...points, ...off.reverse()];
}

export function boxGeo(sx: number, sy: number, sz: number, at: [number, number, number] = [0, 0, 0]): THREE.BufferGeometry {
  return new THREE.BoxGeometry(sx, sy, sz).translate(...at);
}

/** Cylinder whose axis runs along y (axles, rollers, pins). */
export function cylY(r: number, len: number, at: [number, number, number] = [0, 0, 0], seg = 24): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r, len, seg).translate(...at);
}

/** Cylinder whose axis runs along x. */
export function cylX(r: number, len: number, at: [number, number, number] = [0, 0, 0], seg = 16): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2).translate(...at);
}

/** Cylinder whose axis runs along z. */
export function cylZ(r: number, len: number, at: [number, number, number] = [0, 0, 0], seg = 16, rTop = r): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rTop, r, len, seg).rotateX(Math.PI / 2).translate(...at);
}

/** A rod between two points. */
export function tube(a: [number, number, number], b: [number, number, number], r: number, seg = 10): THREE.BufferGeometry {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const d = vb.clone().sub(va);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  return g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}

export const merge = (geos: THREE.BufferGeometry[]) => {
  // ExtrudeGeometry carries groups/uv layouts that differ from primitives; normalise first.
  const clean = geos.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== "position" && k !== "normal" && k !== "uv") n.deleteAttribute(k);
    n.clearGroups();
    return n;
  });
  return mergeGeometries(clean, false)!;
};

// ---- Materials ----------------------------------------------------------------

export interface MachineMaterials {
  paint: THREE.Material;
  dark: THREE.Material;
  steel: THREE.MeshStandardMaterial;
  worn: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  rubber: THREE.Material;
  grille: THREE.MeshStandardMaterial;
  lamp: THREE.MeshStandardMaterial;
  tail: THREE.MeshStandardMaterial;
  seat: THREE.MeshStandardMaterial;
  white: THREE.Material;
  gold: THREE.MeshStandardMaterial;
  alu: THREE.MeshStandardMaterial;
  /** Shoes / rubber belt links (instanced, so no damage shader: tinted directly). */
  track: THREE.MeshStandardMaterial;
}

export function standardMaterials(): Omit<MachineMaterials, "paint" | "dark" | "rubber" | "white"> {
  return {
    steel: new THREE.MeshStandardMaterial({ color: "#4a4946", roughness: 0.55, metalness: 0.75 }),
    worn: new THREE.MeshStandardMaterial({ color: "#8d8a83", roughness: 0.42, metalness: 0.85 }),
    chrome: new THREE.MeshStandardMaterial({ color: "#d9d9d6", roughness: 0.16, metalness: 1 }),
    glass: new THREE.MeshStandardMaterial({ color: "#36505e", roughness: 0.04, metalness: 0.55, transparent: true, opacity: 0.72 }),
    grille: new THREE.MeshStandardMaterial({ color: "#121212", roughness: 0.8, metalness: 0.3 }),
    lamp: new THREE.MeshStandardMaterial({ color: "#fff8e6", emissive: "#fff2cc", emissiveIntensity: 0.6, roughness: 0.2 }),
    tail: new THREE.MeshStandardMaterial({ color: "#a3120c", emissive: "#5a0705", emissiveIntensity: 0.4, roughness: 0.3 }),
    seat: new THREE.MeshStandardMaterial({ color: "#1a1a1a", roughness: 0.9 }),
    gold: new THREE.MeshStandardMaterial({ color: "#c9a23a", roughness: 0.32, metalness: 0.85 }),
    alu: new THREE.MeshStandardMaterial({ color: "#b8b6b0", roughness: 0.38, metalness: 0.8 }),
    track: new THREE.MeshStandardMaterial({ color: "#2b2a28", roughness: 0.7, metalness: 0.6 }),
  };
}

/** Model-number decal (black on clear) for the machine's flank. */
export function decal(text: string, heightM: number, color = "#111"): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.font = "bold 104px Helvetica, Arial, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 8, 66);
  const w = ctx.measureText(text).width + 16;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(w / 512, 1);
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry((heightM * w) / 128, heightM), mat);
  return mesh;
}

/** Stick a decal on the +y (left) or -y (right) flank, upright and readable from outside. */
export function onFlank(m: THREE.Mesh, side: 1 | -1, at: [number, number, number]) {
  // Plane: text along local x, up along local y, facing local z.
  const right = new THREE.Vector3(-side, 0, 0);
  const basis = new THREE.Matrix4().makeBasis(right, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, side, 0));
  m.quaternion.setFromRotationMatrix(basis);
  m.position.set(...at);
  return m;
}

// ---- Wheels and tyres -------------------------------------------------------------

/** Pneumatic loader tyre with angled bar lugs (12x16.5 class), axis along y. */
export function tyreGeometry(r: number, width: number): THREE.BufferGeometry {
  const rIn = r * 0.6;
  // Lathe profile: rounded shoulders, slight sidewall bulge.
  const pts: THREE.Vector2[] = [];
  const hw = width / 2;
  const prof: P2[] = [
    [rIn, -hw * 0.9],
    [r * 0.82, -hw],
    [r * 0.94, -hw * 0.95],
    [r - 0.025, -hw * 0.8],
    [r - 0.025, hw * 0.8],
    [r * 0.94, hw * 0.95],
    [r * 0.82, hw],
    [rIn, hw * 0.9],
  ];
  for (const [rr, y] of prof) pts.push(new THREE.Vector2(rr, y));
  const carcass = new THREE.LatheGeometry(pts, 40);
  const lugs: THREE.BufferGeometry[] = [];
  const n = 22;
  for (let i = 0; i < n; i++) {
    for (const s of [-1, 1]) {
      const a = ((i + (s > 0 ? 0.5 : 0)) / n) * Math.PI * 2;
      const lug = new THREE.BoxGeometry(0.06, 0.04, hw * 0.95);
      lug.rotateY(s * 0.45);
      lug.translate(0, r - 0.025, (s * hw) / 2);
      lug.rotateZ(a);
      lugs.push(lug);
    }
  }
  // Lathe revolves around y already (the axle). Lugs were built around z: turn them onto the y axle.
  const lugGeo = merge(lugs).rotateX(Math.PI / 2);
  return merge([carcass, lugGeo]);
}

/** Steel rim with a dished centre and wheel nuts, axis along y. */
export function rimGeometry(r: number, width: number): THREE.BufferGeometry {
  const parts = [cylY(r, width * 0.86, [0, 0, 0], 28), cylY(r * 0.55, width * 0.95, [0, 0, 0], 20), cylY(r * 0.22, width * 1.02, [0, 0, 0], 16)];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    parts.push(cylY(0.018, width * 1.04, [Math.cos(a) * r * 0.38, 0, Math.sin(a) * r * 0.38], 6));
  }
  return merge(parts);
}

/** Planetary-style rigid wheel: aluminium drum with grousers and a hub (IPEx, VIPER-derived). */
export function grouserWheel(r: number, width: number, grousers = 18): THREE.BufferGeometry {
  const parts = [cylY(r * 0.95, width, [0, 0, 0], 32), cylY(r * 0.3, width * 1.15, [0, 0, 0], 16)];
  for (let i = 0; i < grousers; i++) {
    const a = (i / grousers) * Math.PI * 2;
    parts.push(boxGeo(0.024, width, 0.012, [r * 0.96, 0, 0]).rotateY(-a));
  }
  return merge(parts);
}

/** Track sprocket: a disk with teeth, axis along y. */
export function sprocketGeometry(r: number, width: number, teeth = 11): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const n = teeth * 2;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.86;
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const disk = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  disk.translate(0, 0, -width / 2);
  disk.rotateX(Math.PI / 2);
  return merge([disk, cylY(r * 0.45, width * 1.6, [0, 0, 0], 16)]);
}

// ---- Track belts ------------------------------------------------------------------

/** Convex belt around pulleys (x, z, r): points CCW in (x, z) with cumulative length. */
export function beltPath(pulleys: [number, number, number][], outset: number) {
  const pts: P2[] = [];
  for (const [x, z, r] of pulleys)
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push([x + Math.cos(a) * (r + outset), z + Math.sin(a) * (r + outset)]);
    }
  // Monotone-chain convex hull (CCW).
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: P2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: P2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  const cum = [0];
  for (let i = 1; i <= hull.length; i++) {
    const a = hull[i - 1];
    const b = hull[i % hull.length];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = cum[cum.length - 1];
  /** Point and unit tangent at arc length s. */
  const at = (s: number): [number, number, number, number] => {
    const u = ((s % length) + length) % length;
    let lo = 0;
    let hi = hull.length;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= u) lo = mid;
      else hi = mid;
    }
    const a = hull[lo];
    const b = hull[(lo + 1) % hull.length];
    const seg = cum[lo + 1] - cum[lo] || 1;
    const f = (u - cum[lo]) / seg;
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, (b[0] - a[0]) / seg, (b[1] - a[1]) / seg];
  };
  return { length, at };
}

export interface Belt {
  mesh: THREE.InstancedMesh;
  side: 1 | -1;
  update(offset: number): void;
}

/**
 * Track belt of instanced links around the pulleys at y = side * halfGauge.
 * `offset` [m] is how far the belt has turned (bottom run moves -x as it grows).
 */
export function makeBelt(opts: {
  pulleys: [number, number, number][];
  y: number;
  side: 1 | -1;
  width: number;
  pitch: number;
  kind: "steel" | "rubber";
  material: THREE.Material;
}): Belt {
  const t = opts.kind === "steel" ? 0.035 : 0.05;
  const path = beltPath(opts.pulleys, t / 2);
  const n = Math.max(8, Math.round(path.length / opts.pitch));
  const pitch = path.length / n;
  // Link in its own frame: x along the belt, y across, -z outward (see beltPath orientation).
  const parts =
    opts.kind === "steel"
      ? [boxGeo(pitch * 0.94, opts.width, t), boxGeo(0.035, opts.width * 0.98, 0.05, [pitch * 0.15, 0, -t / 2 - 0.022]), boxGeo(pitch * 0.5, 0.09, 0.06, [0, opts.width * 0.18, t / 2 + 0.02]), boxGeo(pitch * 0.5, 0.09, 0.06, [0, -opts.width * 0.18, t / 2 + 0.02])]
      : [boxGeo(pitch * 1.0, opts.width, t * 0.6), boxGeo(pitch * 0.42, opts.width * 0.44, 0.04, [0, opts.width * 0.26, -t * 0.3 - 0.018]).rotateZ(0.0), boxGeo(pitch * 0.42, opts.width * 0.44, 0.04, [0, -opts.width * 0.26, -t * 0.3 - 0.018]), boxGeo(pitch * 0.3, 0.06, 0.04, [0, 0, t * 0.3 + 0.02])];
  const geo = merge(parts);
  const mesh = new THREE.InstancedMesh(geo, opts.material, n);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const axis = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  return {
    mesh,
    side: opts.side,
    update(offset: number) {
      for (let i = 0; i < n; i++) {
        const [x, z, tx, tz] = path.at(i * pitch - offset);
        q.setFromAxisAngle(axis, Math.atan2(-tz, tx));
        m.compose(pos.set(x, opts.y, z), q, one);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---- Hydraulic cylinders -------------------------------------------------------------

export interface Anchor {
  body: string;
  at: [number, number, number];
}

export interface Ram {
  a: Anchor;
  b: Anchor;
  barrel: THREE.Mesh;
  rod: THREE.Mesh;
  /** Barrel length as a fraction of the pin-to-pin distance at build time. */
  barrelLen: number;
}

/**
 * A hydraulic ram between two bodies: barrel from `a`, chrome rod from `b`.
 * Placed every frame from the bodies' poses.
 */
export function makeRam(a: Anchor, b: Anchor, r: number, barrelLen: number, mats: { barrel: THREE.Material; rod: THREE.Material }): Ram {
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 14).translate(0, 0.5, 0), mats.barrel);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, 1, 10).translate(0, 0.5, 0), mats.rod);
  barrel.matrixAutoUpdate = false;
  rod.matrixAutoUpdate = false;
  return { a, b, barrel, rod, barrelLen };
}

const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export function placeRam(ram: Ram, bodies: Map<string, THREE.Object3D>) {
  const A = bodies.get(ram.a.body);
  const B = bodies.get(ram.b.body);
  if (!A || !B) return;
  _pa.set(...ram.a.at).applyMatrix4(A.matrix);
  _pb.set(...ram.b.at).applyMatrix4(B.matrix);
  _d.subVectors(_pb, _pa);
  const len = _d.length();
  _d.normalize();
  _q.setFromUnitVectors(_up, _d);
  const bl = Math.min(ram.barrelLen, len);
  ram.barrel.matrix.compose(_pa, _q, _s.set(1, bl, 1));
  // Rod from b back into the barrel.
  _q.setFromUnitVectors(_up, _d.negate());
  ram.rod.matrix.compose(_pb, _q, _s.set(1, Math.max(0.05, len - bl * 0.85), 1));
}
