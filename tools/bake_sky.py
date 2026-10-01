"""Bake the real sky for the 3D view: stars and Earth.

Stars: the Yale Bright Star Catalogue, 5th revised edition (Hoffleit &
Warren 1991; CDS V/50). Every star to V ~6.5, the naked-eye limit: ~9,100
stars with J2000 position, V magnitude and B-V colour. Public catalogue.

Earth: NASA Visible Earth "Blue Marble: land surface, ocean colour, sea ice
and clouds" (Stöckli et al., NASA GSFC, 2002). NASA imagery is public domain.

Outputs (public/sky/):
- stars.bin: per star, int16 little-endian [x, y, z, V*1000, (B-V)*1000],
  with (x, y, z) the J2000 equatorial unit vector * 32767 (x to the vernal
  equinox, z to the celestial north pole). Sorted brightest first.
- earth.jpg: equirectangular, 1024 x 512, longitude -180..180 left to right.

Run: cd tools && uv run python bake_sky.py
"""

from __future__ import annotations

import gzip
import math
import shutil
import struct
import subprocess
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/sky"
CACHE = Path(__file__).resolve().parent / ".cache"

BSC5_URL = "https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz"
EARTH_URL = "https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57735/land_ocean_ice_cloud_2048.jpg"


def fetch(url: str, name: str) -> Path:
    CACHE.mkdir(exist_ok=True)
    path = CACHE / name
    if not path.exists():
        print(f"downloading {url}")
        with urllib.request.urlopen(url) as r, open(path, "wb") as f:
            shutil.copyfileobj(r, f)
    return path


def field(line: str, a: int, b: int) -> str:
    """Byte columns a..b (1-based, inclusive) from the BSC5 ReadMe."""
    return line[a - 1 : b].strip()


def bake_stars() -> None:
    rows: list[tuple[float, float, float, float, float]] = []
    with gzip.open(fetch(BSC5_URL, "bsc5.dat.gz"), "rt", encoding="latin-1") as f:
        for line in f:
            ra_h, vmag = field(line, 76, 77), field(line, 103, 107)
            # A handful of entries are novae / non-stellar objects with no J2000 position.
            if not ra_h or not vmag:
                continue
            ra = 15 * (int(ra_h) + int(field(line, 78, 79)) / 60 + float(field(line, 80, 83)) / 3600)
            dec = int(field(line, 85, 86)) + int(field(line, 87, 88)) / 60 + int(field(line, 89, 90)) / 3600
            if field(line, 84, 84) == "-":
                dec = -dec
            bv_s = field(line, 110, 114)
            # Missing colour: call it solar-ish (B-V 0.6) rather than drop a naked-eye star.
            bv = float(bv_s) if bv_s else 0.6
            a, d = math.radians(ra), math.radians(dec)
            rows.append((math.cos(d) * math.cos(a), math.cos(d) * math.sin(a), math.sin(d), float(vmag), bv))
    rows.sort(key=lambda r: r[3])
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / "stars.bin", "wb") as f:
        for x, y, z, v, bv in rows:
            f.write(struct.pack("<5h", round(x * 32767), round(y * 32767), round(z * 32767), round(v * 1000), round(bv * 1000)))
    print(f"stars.bin: {len(rows)} stars, brightest V={rows[0][3]:.2f}, faintest V={rows[-1][3]:.2f}")


def bake_earth() -> None:
    src = fetch(EARTH_URL, "earth_2048.jpg")
    dst = OUT / "earth.jpg"
    # macOS sips; elsewhere just ship the 2048 px original.
    if shutil.which("sips"):
        subprocess.run(["sips", "-z", "512", "1024", "-s", "formatOptions", "85", str(src), "--out", str(dst)], check=True, capture_output=True)
    else:
        shutil.copy(src, dst)
    print(f"earth.jpg: {dst.stat().st_size // 1024} KB")


if __name__ == "__main__":
    bake_stars()
    bake_earth()
