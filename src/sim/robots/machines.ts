/**
 * Construction and mining machines as MuJoCo models: the Cat 262D3 skid
 * steer, Cat 299D3 compact track loader, Cat D6 dozer, Cat 320 excavator and
 * NASA's IPEx lunar excavator.
 *
 * Conventions (MuJoCo, z up, x forward, y left): the chassis frame origin is
 * on the ground plane under the machine's centre, so every height below is a
 * height above level ground straight from the spec sheet. Implement hinges
 * turn about +y: a positive angle tips a forward-pointing link down.
 *
 * Physics geometry is deliberately coarse (boxes, capsules, cylinders); the
 * renderer draws the detailed machine on top of the same bodies. Dimensions
 * are from the manufacturer spec sheets cited per machine; masses split
 * between bodies are guesses that sum to the published operating weight.
 */

export type MachineModel = "skidsteer" | "trackloader" | "dozer" | "excavator" | "ipex";

export interface Wheels {
  kind: "wheels";
  /** Tyre radius and the steel rim it collapses onto [m]. */
  r: number;
  rimR: number;
  width: number;
  massKg: number;
  /** Wheel centres (x, y). */
  at: [number, number][];
}

export interface Tracks {
  kind: "tracks";
  /** Half the track gauge (centre to centre) [m]. */
  halfGauge: number;
  /** Shoe / belt width [m]. */
  width: number;
  /**
   * Contact wheels along each side. Physics only sees these; the belt itself
   * is drawn around them. `z` defaults to `r` (touching level ground).
   */
  rollers: { x: number; r: number; z?: number; massKg: number }[];
  /** Belt outline for rendering: pulleys (x, z, r) the belt wraps, in any order. */
  pulleys: [number, number, number][];
  /** Rubber lugs or steel grouser shoes [m]. */
  shoe: "rubber" | "steel";
  pitch: number;
  /** Rubber thickness lost when a rubber belt burns away [m]. */
  rubberMm?: number;
  friction: number;
}

export type Gear = Wheels | Tracks;

export interface Implement {
  joint: string;
  /** Position-servo stiffness [N m/rad] and torque limit [N m] at the reference mass. */
  kp: number;
  maxTorque: number;
  /** Holds without hydraulic pressure (spring-applied brake, e.g. the excavator swing). */
  braked?: boolean;
  /** Fastest the joint moves [deg/s]: cylinder speed is set by pump flow. Default 35. */
  maxRateDeg?: number;
}

export interface Spinner {
  joint: string;
  maxTorque: number;
}

/** What the machine should be doing at time t of its work cycle. */
export interface WorkStep {
  /** Forward speed [m/s] and yaw rate [rad/s]. */
  v: number;
  w: number;
  /** Implement joint targets [rad]. */
  q: Record<string, number>;
  /** Spinner speeds [rad/s] (IPEx bucket drums). */
  spin?: Record<string, number>;
}

export interface MachineDef {
  model: MachineModel;
  refMassKg: number;
  gear: Gear;
  /** Lateral distance from centre to each drive line (skid-steer kinematics) [m]. */
  halfTrack: number;
  /** Chassis geoms (inside the chassis body). `m(kg)` scales a mass to the build. */
  chassis: (m: (kg: number) => string) => string;
  /** Implement bodies (children of the chassis). */
  bodies: (m: (kg: number) => string) => string;
  /** Names of every implement body (for self-collision exclusion). */
  bodyNames: string[];
  implements: Implement[];
  spinners?: Spinner[];
  /** Work cycle while "working"; parked pose otherwise. */
  work: (t: number) => WorkStep;
  parked: Record<string, number>;
  /** Max tractive effort (drawbar pull) at the reference mass under Earth gravity [N]. */
  drawbarN: number;
  /** Camera distance that frames the machine [m]. */
  viewM: number;
  /** Average ground speed over its work cycle [m/s] (distance driven in long runs). */
  avgSpeedMs: number;
}

const D = Math.PI / 180;
const smooth = (x: number) => x * x * (3 - 2 * x);

/** Piecewise-smooth interpolation through keyframes [t, value...] over a looping period. */
function keyframes(frames: [number, Record<string, number>][], period: number) {
  return (t: number): Record<string, number> => {
    const u = ((t % period) + period) % period;
    let i = 0;
    while (i < frames.length - 1 && frames[i + 1][0] <= u) i++;
    const [t0, a] = frames[i];
    const [t1, b] = i + 1 < frames.length ? frames[i + 1] : [period, frames[0][1]];
    const f = t1 > t0 ? smooth(Math.min(1, (u - t0) / (t1 - t0))) : 1;
    const out: Record<string, number> = {};
    for (const k of Object.keys(a)) out[k] = (a[k] + (b[k] - a[k]) * f) * D;
    return out;
  };
}

const box = (name: string, pos: string, size: string, kg: string, extra = "") =>
  `<geom name="${name}" type="box" pos="${pos}" size="${size}" mass="${kg}" ${extra}/>`;

// ---------------------------------------------------------------------------
// Cat 262D3 skid steer loader.
// Cat spec sheet (AEHQ8210): 3,763 kg operating weight, 49.2 in (1.25 m)
// wheelbase, 1.68 m wide over 12x16.5 tyres (0.84 m dia), 2.11 m to the cab
// roof, 2.99 m long without bucket, vertical lift with 3.17 m bucket pin
// height, 68 in (1.73 m) bucket, 55.4 kW Cat C3.3B, 1,225 kg rated capacity.
// ---------------------------------------------------------------------------
const LIFT_PIVOT: [number, number] = [-0.86, 1.42];

/** Lift arms + bucket shared by the skid steer and the track loader. */
function loaderBodies(m: (kg: number) => string, bucketHalfW: number) {
  // Arm runs from the rear pivot to the bucket pin 0.38 m above ground at x = 1.22 m.
  const [px, pz] = LIFT_PIVOT;
  const dx = 1.22 - px;
  const dz = 0.38 - pz;
  return `<body name="arms" pos="${px} 0 ${pz}">
      <joint name="lift" type="hinge" axis="0 1 0" range="-77 3" damping="6000" armature="200"/>
      <geom name="armL" type="capsule" fromto="0 0.74 0 ${dx} 0.74 ${dz}" size="0.07" mass="${m(130)}"/>
      <geom name="armR" type="capsule" fromto="0 -0.74 0 ${dx} -0.74 ${dz}" size="0.07" mass="${m(130)}"/>
      <geom name="crossbar" type="capsule" fromto="${dx * 0.78} 0.74 ${dz * 0.78} ${dx * 0.78} -0.74 ${dz * 0.78}" size="0.06" mass="${m(40)}"/>
      <body name="bucket" pos="${dx} 0 ${dz}">
        <joint name="tilt" type="hinge" axis="0 1 0" range="-40 110" damping="1500" armature="20"/>
        ${box("bucket_floor", "0.33 0 -0.33", `0.36 ${bucketHalfW} 0.02`, m(90))}
        ${box("bucket_back", "-0.02 0 -0.05", `0.025 ${bucketHalfW} 0.28`, m(70))}
        ${box("bucket_sideL", "0.3 " + (bucketHalfW - 0.01) + " -0.15", "0.3 0.012 0.2", m(18))}
        ${box("bucket_sideR", "0.3 " + -(bucketHalfW - 0.01) + " -0.15", "0.3 0.012 0.2", m(18))}
      </body>
    </body>`;
}

/** Bucket kept level (tilt cancels lift) with an optional curl [deg]. */
const levelBucket = (liftDeg: number, curlDeg = 0) => ({ lift: liftDeg, tilt: -liftDeg + curlDeg });

const skidsteer: MachineDef = {
  model: "skidsteer",
  refMassKg: 3763,
  gear: {
    kind: "wheels",
    r: 0.42,
    rimR: 0.26,
    width: 0.3,
    massKg: 85,
    at: [
      [0.625, 0.69],
      [0.625, -0.69],
      [-0.625, 0.69],
      [-0.625, -0.69],
    ],
  },
  halfTrack: 0.69,
  chassis: (m) => `
      ${box("hull", "0 0 0.62", "0.95 0.5 0.3", m(1450))}
      ${box("engine", "-0.82 0 1.02", "0.36 0.5 0.34", m(650))}
      ${box("cabfloor", "0.15 0 0.95", "0.5 0.46 0.03", m(80))}
      ${box("cabroof", "0.12 0 2.08", "0.55 0.48 0.03", m(90))}
      ${[
        [0.62, 0.45],
        [0.62, -0.45],
        [-0.4, 0.45],
        [-0.4, -0.45],
      ]
        .map(([x, y], i) => `<geom name="post${i}" type="capsule" fromto="${x} ${y} 0.98 ${x} ${y} 2.05" size="0.035" mass="${m(15)}"/>`)
        .join("\n      ")}`,
  bodies: (m) => loaderBodies(m, 0.865),
  bodyNames: ["arms", "bucket"],
  implements: [
    // Two lift cylinders (~60 kN each on a ~0.35 m lever): ~40 kN m. Flow-controlled, so stiff.
    { joint: "lift", kp: 400_000, maxTorque: 45_000 },
    { joint: "tilt", kp: 60_000, maxTorque: 12_000 },
  ],
  work: (t) => ({ v: 0.6, w: 0.8, q: keyframes([[0, levelBucket(-7, -10)], [6, levelBucket(-30, -10)], [9, levelBucket(-7, -10)]], 14)(t) }),
  parked: levelBucket(0, 0),
  // 12x16.5 tyres on dry rock, ~0.8 x weight.
  drawbarN: 30_000,
  viewM: 9,
  avgSpeedMs: 0.6,
};

// ---------------------------------------------------------------------------
// Cat 299D3 compact track loader.
// Cat spec sheet: 5,200 kg operating weight, 73 kW Cat C3.8, 1,931 mm wide
// over 400 mm rubber tracks, 1,767 mm of track on ground, 2,270 mm overall
// track length, vertical lift, 1,580 kg rated capacity (35% tipping load).
// ---------------------------------------------------------------------------
const trackloader: MachineDef = {
  ...skidsteer,
  model: "trackloader",
  refMassKg: 5200,
  gear: {
    kind: "tracks",
    halfGauge: 0.765,
    width: 0.4,
    // Four bogie wheels across the 1.77 m on the ground, plus front idler and rear sprocket.
    rollers: [
      { x: -0.66, r: 0.15, massKg: 40 },
      { x: -0.22, r: 0.15, massKg: 40 },
      { x: 0.22, r: 0.15, massKg: 40 },
      { x: 0.66, r: 0.15, massKg: 40 },
      { x: 0.88, r: 0.24, z: 0.29, massKg: 60 },
      { x: -0.82, r: 0.3, z: 0.38, massKg: 90 },
    ],
    pulleys: [
      [0.9, 0.27, 0.27],
      [-0.84, 0.36, 0.36],
      [0.62, 0.17, 0.17],
      [-0.62, 0.17, 0.17],
    ],
    shoe: "rubber",
    pitch: 0.09,
    rubberMm: 45,
    friction: 0.85,
  },
  halfTrack: 0.765,
  chassis: (m) => `
      ${box("hull", "0 0 0.72", "0.92 0.5 0.3", m(2300))}
      ${box("engine", "-0.82 0 1.08", "0.36 0.5 0.34", m(800))}
      ${box("cabfloor", "0.15 0 1.0", "0.5 0.46 0.03", m(90))}
      ${box("cabroof", "0.12 0 2.1", "0.55 0.48 0.03", m(100))}
      ${box("trackframeL", "0 0.765 0.3", "0.8 0.12 0.12", m(350))}
      ${box("trackframeR", "0 -0.765 0.3", "0.8 0.12 0.12", m(350))}`,
  bodies: (m) => loaderBodies(m, 0.97),
  work: (t) => ({ v: 0.5, w: 0.45, q: keyframes([[0, levelBucket(-7, -10)], [6, levelBucket(-30, -10)], [9, levelBucket(-7, -10)]], 14)(t) }),
  // Rubber tracks: the long footprint grips better than tyres (~0.85 x weight).
  drawbarN: 43_000,
  viewM: 9.5,
  avgSpeedMs: 0.5,
};

// ---------------------------------------------------------------------------
// Cat D6 track-type tractor (standard push arm, 6SU blade).
// Cat spec sheet: 22,130 kg operating weight, 161 kW Cat C9.3B, 1,930 mm
// track gauge, 610 mm shoes, 2,964 mm of track on ground, 8 rollers per side,
// elevated sprocket, 361 mm ground clearance, 3,188 mm high, 4,730 mm long
// without blade and 5,436 mm with it, 6SU blade 3,312 mm wide x 1,408 mm
// high (5.7 m^3), 54 kPa ground pressure, 11.7 km/h top speed.
// ---------------------------------------------------------------------------
const dozer: MachineDef = {
  model: "dozer",
  refMassKg: 22130,
  gear: {
    kind: "tracks",
    halfGauge: 0.965,
    width: 0.61,
    rollers: [
      ...[-1.25, -0.75, -0.25, 0.25, 0.75, 1.25].map((x) => ({ x, r: 0.22, massKg: 120 })),
      // Front and rear idlers sit just off level ground; they carry the machine over a ridge.
      { x: 1.55, r: 0.34, z: 0.4, massKg: 250 },
      { x: -1.55, r: 0.34, z: 0.4, massKg: 250 },
    ],
    pulleys: [
      [1.58, 0.42, 0.42],
      [-1.58, 0.42, 0.42],
      [-1.02, 1.2, 0.46],
      [1.25, 0.16, 0.16],
      [-1.25, 0.16, 0.16],
    ],
    shoe: "steel",
    pitch: 0.203,
    friction: 0.9,
  },
  halfTrack: 0.965,
  chassis: (m) => `
      ${box("mainframe", "0.3 0 0.85", "1.45 0.5 0.45", m(7600))}
      ${box("hood", "1.0 0 1.6", "0.95 0.55 0.4", m(2600))}
      ${box("cab", "-0.95 0 2.3", "0.75 0.8 0.85", m(1700))}
      ${box("fenders", "-0.6 0 1.38", "1.15 1.25 0.05", m(500))}
      ${box("trackframeL", "0 0.965 0.42", "1.6 0.18 0.2", m(1000))}
      ${box("trackframeR", "0 -0.965 0.42", "1.6 0.18 0.2", m(1000))}`,
  bodies: (m) => `<body name="blade" pos="-0.2 0 0.62">
      <joint name="blade" type="hinge" axis="0 1 0" range="-30 9" damping="60000" armature="2000"/>
      <geom name="pusharmL" type="capsule" fromto="0 1.36 0 2.45 1.36 -0.1" size="0.11" mass="${m(450)}"/>
      <geom name="pusharmR" type="capsule" fromto="0 -1.36 0 2.45 -1.36 -0.1" size="0.11" mass="${m(450)}"/>
      ${box("moldboard", "2.68 0 0.08", "0.12 1.656 0.7", m(2500))}
    </body>
    <body name="ripper" pos="-2.05 0 0.95">
      <joint name="ripper" type="hinge" axis="0 1 0" range="-10 40" damping="30000" armature="500"/>
      ${box("ripperbeam", "-0.25 0 0", "0.3 0.85 0.12", m(900))}
      <geom name="shank" type="capsule" fromto="-0.5 0 0 -0.62 0 -1.1" size="0.07" mass="${m(500)}"/>
    </body>`,
  bodyNames: ["blade", "ripper"],
  implements: [
    // Blade + push arms (~3.4 t) on a ~1.8 m lever: ~60 kN m at Earth gravity; two lift cylinders give more.
    { joint: "blade", kp: 3_000_000, maxTorque: 200_000 },
    { joint: "ripper", kp: 800_000, maxTorque: 80_000 },
  ],
  // Dozing pass: push forward with the blade at grade, back up with it raised.
  work: (t) => {
    // 8 s forward at 0.9 m/s, 6 s back at 1.2 m/s: same distance, so it works one strip.
    const u = t % 16;
    const v = u < 8 ? 0.9 : u >= 9 && u < 15 ? -1.2 : 0;
    const q = keyframes([[0, { blade: -2, ripper: 32 }], [7.8, { blade: -2, ripper: 32 }], [8.8, { blade: -14, ripper: 32 }], [15, { blade: -14, ripper: 32 }]], 16)(t);
    return { v, w: 0, q };
  },
  parked: { blade: 4, ripper: 32 },
  // Dozers are rated by drawbar pull: ~0.9 x weight on steel grousers.
  drawbarN: 190_000,
  viewM: 12.5,
  // Back and forth over the same strip.
  avgSpeedMs: 0.75,
};

// ---------------------------------------------------------------------------
// Cat 320 hydraulic excavator (HD reach boom 5.7 m, R2.9 stick, 1.19 m^3 bucket).
// Cat spec sheet: 21,700 kg operating weight, 128.5 kW Cat C4.4, 2,380 mm
// track gauge, 600 mm triple-grouser shoes, 4,450 mm track length, 3,650 mm
// idler-to-sprocket, 470 mm ground clearance, 1,050 mm counterweight
// clearance, 2,830 mm tail swing radius, 2,960 mm to the cab top, 9,530 mm
// transport length, 11.25 rpm swing, 5.7 km/h travel, 205 kN drawbar pull,
// 150 kN bucket digging force, 6,720 mm max digging depth.
// ---------------------------------------------------------------------------
const excavator: MachineDef = {
  model: "excavator",
  refMassKg: 21700,
  gear: {
    kind: "tracks",
    halfGauge: 1.19,
    width: 0.6,
    rollers: [
      ...[-1.2, -0.6, 0, 0.6, 1.2].map((x) => ({ x, r: 0.19, massKg: 110 })),
      { x: 1.825, r: 0.36, z: 0.4, massKg: 300 },
      { x: -1.825, r: 0.36, z: 0.4, massKg: 350 },
    ],
    pulleys: [
      [1.825, 0.42, 0.36],
      [-1.825, 0.42, 0.36],
      [1.3, 0.12, 0.12],
      [-1.3, 0.12, 0.12],
    ],
    shoe: "steel",
    pitch: 0.19,
    friction: 0.85,
  },
  halfTrack: 1.19,
  chassis: (m) => `
      ${box("carbody", "0 0 0.72", "0.75 0.9 0.25", m(3300))}
      ${box("trackframeL", "0 1.19 0.42", "1.9 0.25 0.22", m(1500))}
      ${box("trackframeR", "0 -1.19 0.42", "1.9 0.25 0.22", m(1500))}`,
  bodies: (m) => `<body name="upper" pos="0 0 1.0">
      <joint name="swing" type="hinge" axis="0 0 1" damping="150000" armature="20000"/>
      ${box("deck", "-0.75 0 0.25", "1.6 1.27 0.22", m(4500))}
      ${box("engine", "-1.35 0 0.9", "0.75 1.2 0.45", m(1200))}
      ${box("counterweight", "-2.45 0 0.55", "0.38 1.27 0.5", m(4200))}
      ${box("cab", "0.55 0.75 1.0", "0.6 0.5 0.95", m(700))}
      <body name="boom" pos="0.62 -0.12 0.95">
        <joint name="boom" type="hinge" axis="0 1 0" range="-62 28" damping="300000" armature="30000"/>
        <geom name="boomgeom" type="capsule" fromto="0.2 0 0 5.5 0 0" size="0.22" mass="${m(1700)}"/>
        <body name="stick" pos="5.7 0 0">
          <joint name="stick" type="hinge" axis="0 1 0" range="22 158" damping="80000" armature="6000"/>
          <geom name="stickgeom" type="capsule" fromto="-0.35 0 0 2.75 0 0" size="0.16" mass="${m(800)}"/>
          <body name="bucket" pos="2.9 0 0">
            <joint name="curl" type="hinge" axis="0 1 0" range="-40 150" damping="15000" armature="600"/>
            ${box("bucket_shell", "0.75 0 0.05", "0.72 0.55 0.06", m(600))}
            ${box("bucket_lip", "1.38 0 -0.28", "0.08 0.55 0.3", m(150))}
            ${box("bucket_sideL", "0.85 0.54 -0.18", "0.55 0.02 0.25", m(75))}
            ${box("bucket_sideR", "0.85 -0.54 -0.18", "0.55 0.02 0.25", m(75))}
          </body>
        </body>
      </body>
    </body>`,
  bodyNames: ["upper", "boom", "stick", "bucket"],
  implements: [
    // Swing motor + spring-applied parking brake (it holds the upper even with no pressure).
    { joint: "swing", kp: 1_500_000, maxTorque: 120_000, braked: true, maxRateDeg: 67 },
    // Boom holds ~190 kN m of boom+stick+bucket at full reach; 350 bar on two cylinders gives far more.
    { joint: "boom", kp: 4_000_000, maxTorque: 700_000 },
    { joint: "stick", kp: 1_200_000, maxTorque: 250_000 },
    // ~150 kN bucket digging force at the 1.57 m tip radius: ~240 kN m.
    { joint: "curl", kp: 250_000, maxTorque: 120_000 },
  ],
  // Truck-loading cycle (~20 s, typical for a 20 t class machine): reach, drag, curl, swing, dump, return.
  work: (t) => ({
    v: 0,
    w: 0,
    q: keyframes(
      [
        [0, { swing: 0, boom: -23, stick: 55, curl: -20 }],
        [3.5, { swing: 0, boom: -17, stick: 85, curl: 10 }], [5.2, { swing: 0, boom: -19, stick: 102, curl: 30 }],
        [7, { swing: 0, boom: -18, stick: 118, curl: 60 }],
        [9, { swing: 0, boom: -20, stick: 120, curl: 135 }],
        [13.5, { swing: 90, boom: -42, stick: 95, curl: 135 }],
        [16, { swing: 90, boom: -42, stick: 75, curl: -10 }],
        [17, { swing: 90, boom: -38, stick: 70, curl: -10 }],
      ],
      21,
    )(t),
  }),
  parked: { swing: 0, boom: 0, stick: 150, curl: 120 },
  drawbarN: 205_000,
  viewM: 17,
  // Digs in place.
  avgSpeedMs: 0,
};

// ---------------------------------------------------------------------------
// NASA IPEx (ISRU Pilot Excavator), TRL-5 design (Schuler et al., ASCEND 2024).
// Published: 30 kg class, 4-wheel skid steer with no suspension, VIPER-
// derived aluminium wheels, two arms each carrying a pair of counter-
// rotating bucket drums (~294 mm medium drums), up to 30 kg of regolith per
// trip, 30 cm/s nominal drive, 7.5 cm rocks, 15° slopes, 11-day mission at
// the lunar south pole moving 10 t of regolith (42 kg/h), ThinGap frameless
// motors + harmonic drives, wireless charging at the lander.
// Guessed: overall dimensions and wheel size (from photos), mass split.
// ---------------------------------------------------------------------------
const ipex: MachineDef = {
  model: "ipex",
  refMassKg: 30,
  gear: {
    kind: "wheels",
    r: 0.15,
    rimR: 0.15,
    width: 0.1,
    massKg: 1.5,
    at: [
      [0.17, 0.26],
      [0.17, -0.26],
      [-0.17, 0.26],
      [-0.17, -0.26],
    ],
  },
  halfTrack: 0.26,
  chassis: (m) => `
      ${box("body", "0 0 0.22", "0.27 0.18 0.1", m(11))}`,
  bodies: (m) => {
    const arm = (name: string, sign: number) => `<body name="${name}" pos="${0.27 * sign} 0 0.24">
      <joint name="${name}" type="hinge" axis="0 1 0" range="-60 60" damping="2" armature="0.05"/>
      <geom name="${name}_beam" type="box" pos="${0.17 * sign} 0 0" size="0.17 0.04 0.025" mass="${m(1.5)}"/>
      <body name="${name}_drums" pos="${0.34 * sign} 0 0">
        <joint name="${name}_spin" type="hinge" axis="0 1 0" damping="0.2"/>
        <geom name="${name}_drumL" type="cylinder" pos="0 0.18 0" size="0.147 0.11" euler="90 0 0" mass="${m(2.5)}"/>
        <geom name="${name}_drumR" type="cylinder" pos="0 -0.18 0" size="0.147 0.11" euler="90 0 0" mass="${m(2.5)}"/>
      </body>
    </body>`;
    return arm("front", 1) + arm("rear", -1);
  },
  bodyNames: ["front", "front_drums", "rear", "rear_drums"],
  implements: [
    { joint: "front", kp: 400, maxTorque: 60 },
    { joint: "rear", kp: 400, maxTorque: 60 },
  ],
  spinners: [
    { joint: "front_spin", maxTorque: 40 },
    { joint: "rear_spin", maxTorque: 40 },
  ],
  // Dig while creeping forward with the front drums down, then haul with both raised.
  work: (t) => {
    const u = t % 24;
    const digging = u < 10;
    const q = keyframes([[0, { front: 14, rear: 30 }], [9, { front: 14, rear: 30 }], [10.5, { front: -30, rear: 30 }], [23, { front: -30, rear: 30 }]], 24)(t);
    return { v: digging ? 0.05 : 0.3, w: digging ? 0 : 0.25, q, spin: { front_spin: digging ? 2.5 : 0, rear_spin: 0 } };
  },
  parked: { front: -30, rear: 30 },
  drawbarN: 150,
  viewM: 2.4,
  // 70 km over the 11-day reference mission.
  avgSpeedMs: 0.074,
};

export const MACHINES: Record<MachineModel, MachineDef> = { skidsteer, trackloader, dozer, excavator, ipex };
