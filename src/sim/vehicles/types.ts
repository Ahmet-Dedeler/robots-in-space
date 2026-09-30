import type {
  BatteryId,
  HydraulicId,
  CameraId,
  ElectronicsId,
  LubricantId,
  MagnetId,
  SealId,
  SolderId,
  WindingId,
} from "../materials/components";
import type { MaterialId } from "../materials/materials";
import type { PlanetScenario } from "../planets/world";

/** How much to trust a model. Shown on every vehicle and result. */
export type Fidelity = "validated" | "calibrated" | "approximation" | "hypothetical";

export type Mechanics =
  | {
      kind: "humanoid";
      robot: "g1" | "h1";
      /** Visual finish only. */
      finish?: "stock" | "white" | "titanium";
    }
  | { kind: "static"; shape: "lander" | "box" }
  | { kind: "wheeled"; model: "skidsteer" }
  /**
   * Planetary rovers: kinematic 3D model (no MuJoCo). `speedMs` is the drive
   * speed; `dutyCycle` the share of waking time spent driving (the motors'
   * `electricW` is already averaged over it).
   */
  | { kind: "rover"; model: RoverModel; speedMs: number; dutyCycle: number };

export type RoverModel = "yutu" | "pragyan" | "mer" | "msl" | "lunokhod" | "crawler";

export interface DescentStage {
  /** Stage becomes active once altitude drops below this [km]. */
  belowKm: number;
  /** Drag coefficient x reference area [m^2]. */
  cdA: number;
  label: string;
}

/**
 * A vehicle as a set of parts. The thermal network, failure rules and
 * mechanics coupling are all generated from this, so every UI "mod" is just
 * an edit to this object.
 */
export interface VehicleBuild {
  id: string;
  name: string;
  tagline: string;
  fidelity: Fidelity;
  /** Where the numbers come from and what is guessed. */
  notes: string[];
  mechanics: Mechanics;

  /** Total mass (descent dynamics, buoyancy) [kg]. */
  massKg: number;
  /** Sealed craft: outer envelope volume for buoyancy [m^3]. Open bodies derive it from their parts. */
  volumeM3?: number;
  /** Outer surface exposed to the atmosphere [m^2]. */
  exteriorAreaM2: number;
  /** Equivalent diameter for external convection [m]. */
  charLengthM: number;

  skin: {
    material: MaterialId;
    massKg: number;
    emissivity: number;
    /** Solar absorptivity; defaults to the material's as-received value (planets/cold.ts). */
    absorptivity?: number;
  };
  frame: {
    material: MaterialId;
    massKg: number;
    /** Peak working stress / room-temperature yield. Frame fails when yield(T)/yield(20 °C) drops below this. */
    loadFraction: number;
  };

  enclosure:
    | {
        kind: "open";
        /** Convective strength of the hot CO2 flooding the body cavities, relative to outside. */
        internalExposure: number;
      }
    | {
        kind: "sealed";
        hull: { material: MaterialId; radiusM: number; thicknessMm: number };
        seal: SealId;
        /** Internal gas + radiation coupling inside the hull [W/m^2/K]. */
        internalH: number;
      }
    | {
        /** Unpressurized insulated box (a rover's warm electronics box): parts inside, joints and wheels outside. */
        kind: "box";
        wall: { material: MaterialId; areaM2: number; thicknessMm: number };
        /** Radiation + conduction coupling inside the box [W/m^2/K]. */
        internalH: number;
      };

  /** Sealed: wraps the hull. Open: jackets around the electronics bay and battery. */
  insulation: { material: MaterialId; thicknessMm: number };

  electronics: { part: ElectronicsId; solder: SolderId; massKg: number; powerW: number };
  battery: { part: BatteryId; capacityWh: number };
  motors?: {
    magnet: MagnetId;
    winding: WindingId;
    lubricant: LubricantId;
    massKg: number;
    /** Electrical draw while walking [W]. */
    electricW: number;
    /** Share of motor electrical power turned into heat in the motors. */
    heatFraction: number;
    /** Motor size relative to stock (1 = stock). Bigger motors weigh more but give more torque. */
    sizeFactor: number;
  };
  camera?: CameraId;
  /** Pneumatic tyres (rubber) or metal wheels. */
  tires?: { material: MaterialId; massKg: number };
  /** Hydraulic circuit (lift arms, steering). */
  hydraulics?: { part: HydraulicId; massKg: number };
  /** What drives the vehicle. Combustion needs oxygen, which Venus air doesn't have. */
  powerplant?: { kind: "diesel"; powerKw: number } | { kind: "electric"; powerKw: number };
  /** Paint over the outer shell, if any. */
  paint?: MaterialId;
  pcm?: { material: MaterialId; massKg: number };
  /** Active cooler (Stirling-class heat pump) pumping from the electronics bay to the skin. */
  cooler?: { electricW: number; carnotFraction: number; setpointK: number };
  /** Radioisotope power source. */
  rtg?: {
    electricW: number;
    thermalW: number;
    /** Share of the waste heat piped into the electronics bay and battery (Curiosity's fluid loop); the rest leaves from the shell. */
    interiorFraction?: number;
  };
  /** Solar array. `tracking` faces the Sun; `vertical` suits the lunar poles, where the Sun skims the horizon. */
  solar?: { areaM2: number; efficiency: number; mount: "horizontal" | "tracking" | "vertical" };
  /** Sleep through the night: everything off except heaters and a receiver/clock drawing `sleepW`. */
  hibernate?: { sleepW: number };
  /** Thermostatic survival heaters on the electronics bay and battery. */
  heaters?: { electricW: number; setpointK: number };
  /** Radioisotope heater units in the electronics bay and battery [W thermal]. */
  rhuW?: number;
  /** Switchable radiator (heat switch / louver) that dumps heat from inside the box to space when it runs warm. */
  radiator?: { areaM2: number; openAboveK: number };
  /** Instruments and internal structure lumped as one node [kg]. */
  payloadMassKg: number;

  initialTempK: number;
  /** Default landing elevation for this vehicle's scenario [m]. */
  homeElevationM?: number;
  /** Default world for this vehicle (Venus when absent). */
  home?: Omit<PlanetScenario, "chaseSun"> & { chaseSun?: boolean };
  descent?: { stages: DescentStage[] };
}
