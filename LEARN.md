# Learning Robots in Space: Architecture & Physics

This guide details the physical principles, simulation architecture, and technical stack powering the Robots in Space Simulator.

---

## 1. Simulation Architecture

The simulator is built with a strict separation between **physics** and **presentation**:
- **Headless Physics Engine (`src/sim/`):** Pure TypeScript with zero DOM/React dependencies. Can run in Node.js for automated parameter sweeps, validation testing, and Monte Carlo landing trials.
- **Physics Core (MuJoCo WASM):** Leverages the official Google DeepMind `@mujoco/mujoco` WebAssembly bindings for contact dynamics, hinge joints, and multi-body kinematics.
- **Real-Time Rendering:** React Three Fiber (R3F) and Three.js handle high-fidelity planetary lighting (Rayleigh scattering, Mie haze, solar irradiance).
- **Fast Telemetry:** Real-time data visualization is rendered using canvas-based `uPlot`.

---

## 2. Atmospheric & Thermal Modeling

### Venusian Supercritical Atmosphere
- **Real-Gas CO₂ Properties:** Ideal gas laws fail at 92 bar and 737 K. We pre-bake thermodynamic property tables using CoolProp (Python `tools/bake_co2.py`), interpolating density, isobaric heat capacity, dynamic viscosity, and thermal conductivity.
- **Optics & Visibility:** Implements spectral Rayleigh extinction and cloud-deck Mie scattering calibrated to Venera 13/14 surface flux measurements (~3–3.5 klux).

### Lunar & Planetary Regolith Thermal Solver
- Uses 1-D numerical heat conduction into multi-layer porous regolith with temperature-dependent thermal conductivity, calibrated against NASA LRO Diviner parameters.

---

## 3. Robot Locomotion & Heavy Machinery

### Humanoid Robotics
- Includes Unitree G1 and H1 humanoid models.
- Locomotion policies (trained via reinforcement learning) are ported from PyTorch to an optimized TypeScript matrix pipeline matching PyTorch outputs within \(10^{-4}\) precision.

### Heavy Construction Equipment
- Simulates realistic diesel-to-battery electric conversions for Cat skid steers, dozers, and excavators, alongside NASA's IPEx lunar excavator.
- Soil mechanics are modeled via Bekker sinkage and Terzaghi bearing capacity equations.

---

## 4. Spacecraft Entry, Descent, and Landing (EDL)

- **Variable-Backpressure Rocket Engines:** Thrust and specific impulse (\(I_{sp}\)) dynamically scale using nozzle expansion ratios and flow separation equations (Summerfield criterion).
- **Structural Integrity:** Thin pressure-stabilized rocket hulls model buckling limits under extreme atmospheric external pressure.
