#!/bin/sh
# Bake the real 3D vehicle models (see tools/bake_models.py). Needs Blender 4.2+.
set -e
cd "$(dirname "$0")"
B="${BLENDER:-}"
[ -z "$B" ] && [ -x /Applications/Blender.app/Contents/MacOS/Blender ] && B=/Applications/Blender.app/Contents/MacOS/Blender
[ -z "$B" ] && B="$(command -v blender || true)"
[ -z "$B" ] && { echo "Blender not found: install it or set BLENDER=/path/to/blender"; exit 1; }
exec "$B" -b --factory-startup --python bake_models.py -- "$@"
