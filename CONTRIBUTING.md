# Contributing to Robots in Space Simulator

Thank you for your interest in contributing! This is an open-source physics and robotics sandbox simulating how rovers, humanoids (Unitree G1/H1), construction machinery (Cat excavators/dozers), and landers (Starship, Falcon 9, Apollo LM) behave on Venus, the Moon, Mars, and Mercury.

## Core Principles

1. **Science is the compass:** Atmosphere, gravity, thermal networks, and soil mechanics are built from public mission data (Viking, Curiosity, Venera 13/14, Diviner) and peer-reviewed literature. Never invent precision.
2. **Honest fidelity labels:** Mark every vehicle or environment assumption as `validated`, `calibrated`, `approximation`, or `hypothetical`.
3. **Validation suite:** Tests in `sim/` must pass (`pnpm test`), ensuring real mission benchmarks (e.g. Venera 13 descent, Pragyan lunar night survival, Opportunity dust storm behavior) reproduce accurately.

## Where Things Live

- `src/sim/`: Deterministic, pure TypeScript simulation engine (no React/DOM dependencies).
  - `env/`: Real-gas CO₂ lookup tables and VIRA atmosphere models.
  - `thermal/`: Enthalpy-based lumped thermal network solver.
  - `planets/`: Environment models for the Moon, Mars, Mercury, and Venus.
  - `robots/`: MuJoCo WASM worlds, Unitree locomotion policies (LSTM + MLP).
  - `machines/`: Heavy machinery definitions and hydraulic cycles.
  - `spacecraft/`: Powered descent, nozzle flow separation, and aerodynamic drag.
  - `terrain/`: Bekker sinkage soil mechanics, hazard analysis, and crater heightfields.
- `src/components/lab/`: UI components, uPlot real-time telemetry charts, and React Three Fiber 3D scene.
- `tools/`: Python (`uv`) offline baking tools for CoolProp gas tables, meshes, and sky stars.

## Local Setup

Requirements: Node.js 20+, pnpm, and Python 3.11+ (managed via `uv`).

```bash
# Clone the repository
git clone https://github.com/Ahmet-Dedeler/robots-in-space.git
cd robots-in-space

# Install dependencies
pnpm install

# Run development server
pnpm dev

# Run physics and mission validation tests
pnpm test
```

## How to Contribute

- Browse [open issues](https://github.com/Ahmet-Dedeler/robots-in-space/issues) for `good first issue` and `help wanted` tags.
- Propose new planetary environments, vehicles, or improvements to soil/wheel interactions.
- Ensure all tests pass before opening a Pull Request.
