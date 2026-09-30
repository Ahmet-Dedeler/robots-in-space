"""Bake real-gas CO2 properties into a lookup table for the browser.

Near the Venus surface CO2 is supercritical (~737 K, ~9.2 MPa), so ideal-gas
estimates of density are ~1% off and transport properties (conductivity,
viscosity) need a proper model. We use CoolProp's HEOS backend for CO2
(Span-Wagner EOS + Laesecke/Huber transport correlations) and write a regular
grid over (T, log10 P) that the TS side bilinearly interpolates.

Venus atmosphere is ~96.5% CO2 / 3.5% N2; we treat it as pure CO2 here. The N2
fraction shifts properties by a few percent at most, well inside the other
model uncertainties (convection correlations are +/-20%).

Output: src/sim/data/co2-props.json
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from CoolProp.CoolProp import PropsSI

OUT = Path(__file__).resolve().parents[1] / "src/sim/data/co2-props.json"

# Grid covers everything from the upper atmosphere (~150 K, ~1 Pa) to hot
# surface films (~1000 K, 12 MPa).
T_GRID = np.linspace(150.0, 1100.0, 96)  # K, 10 K steps
LOGP_GRID = np.linspace(0.0, math.log10(1.2e7), 72)  # log10(Pa)

T_TRIPLE = 216.592
T_CRIT = 304.1282


def props(T: float, P: float) -> tuple[float, float, float, float]:
    """rho [kg/m3], cp [J/kg/K], k [W/m/K], mu [Pa s] of gas-phase CO2.

    If (T, P) falls inside the liquid/solid region we clamp P just below the
    saturation/sublimation line: bodies in the Venus atmosphere never touch
    condensed CO2, and the clamp keeps interpolation smooth near the corners.
    """
    if T < T_CRIT:
        if T >= T_TRIPLE:
            p_sat = PropsSI("P", "T", T, "Q", 1, "CO2")
        else:
            # Crude sublimation curve (Clausius-Clapeyron through triple point).
            p_sat = 517950.0 * math.exp(-3137.0 * (1 / T - 1 / T_TRIPLE))
        P = min(P, 0.95 * p_sat)
    T_eval = max(T, T_TRIPLE + 0.5)  # CoolProp HEOS lower limit
    rho = PropsSI("D", "T", T_eval, "P", P, "CO2")
    cp = PropsSI("C", "T", T_eval, "P", P, "CO2")
    k = PropsSI("L", "T", T_eval, "P", P, "CO2")
    mu = PropsSI("V", "T", T_eval, "P", P, "CO2")
    if T_eval != T:
        rho *= T_eval / T  # ideal-gas scaling for the tiny sub-triple corner
    return rho, cp, k, mu


def main() -> None:
    nT, nP = len(T_GRID), len(LOGP_GRID)
    rho = np.zeros((nT, nP))
    cp = np.zeros((nT, nP))
    k = np.zeros((nT, nP))
    mu = np.zeros((nT, nP))
    for i, T in enumerate(T_GRID):
        for j, lp in enumerate(LOGP_GRID):
            rho[i, j], cp[i, j], k[i, j], mu[i, j] = props(float(T), 10.0**lp)

    def pack(a: np.ndarray, sig: int = 5) -> list[float]:
        return [float(f"{v:.{sig}g}") for v in a.ravel()]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "source": "CoolProp HEOS::CO2 (Span-Wagner EOS, Laesecke 2017 / Huber 2016 transport)",
                "tMin": float(T_GRID[0]),
                "tMax": float(T_GRID[-1]),
                "nT": nT,
                "logPMin": float(LOGP_GRID[0]),
                "logPMax": float(LOGP_GRID[-1]),
                "nP": nP,
                "layout": "row-major [iT][iP]",
                "rho": pack(rho),
                "cp": pack(cp),
                "k": pack(k),
                "mu": pack(mu),
            },
            separators=(",", ":"),
        )
    )
    s = PropsSI
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")
    print(
        "surface check (737 K, 9.2 MPa): rho=%.2f cp=%.0f k=%.4f mu=%.3e"
        % (
            s("D", "T", 737, "P", 9.2e6, "CO2"),
            s("C", "T", 737, "P", 9.2e6, "CO2"),
            s("L", "T", 737, "P", 9.2e6, "CO2"),
            s("V", "T", 737, "P", 9.2e6, "CO2"),
        )
    )


if __name__ == "__main__":
    main()
