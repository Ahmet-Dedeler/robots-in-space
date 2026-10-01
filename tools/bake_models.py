"""Bake real 3D models of the vehicles for the browser (runs inside Blender).

Every vehicle in the lab is drawn from a third-party model of the real thing
(NASA's 3D resources, or CC-BY models from Sketchfab), never from shapes made
up in three.js. This script turns each source into a small, consistent GLB:

1. download the source once into tools/.cache/models (NASA files straight
   from github.com/nasa/NASA-3D-Resources; Sketchfab files through its
   download API, which needs SKETCHFAB_API_TOKEN in the environment or in
   .env.local at the repo root);
2. drop helpers (cameras, lights, shadow cards, hidden objects) and anything
   the manifest lists under "hide" (e.g. the Super Heavy booster under a ship);
3. rotate to the lab's frame (x forward / up the stack, z up in Blender, which
   becomes y up in glTF) and scale to the vehicle's *published* size: the
   manifest names the dimension and its source, and every other published
   dimension listed under "check" is compared and printed, so a wrong scale
   shows up as a mismatch instead of a silently wrong vehicle;
4. flatten the source hierarchy into world space, then rebuild it as a small
   rig: one empty per moving part (rocker, bogie, steering, wheel, flap, leg,
   arm...) placed at the real pivot, with the part's meshes under it. The
   browser only ever rotates these empties;
5. join meshes per rig node (fewer draw calls), decimate to the triangle
   budget, cap textures at 1024 px, and export public/models/<id>.glb;
6. write src/components/lab/scene/models.gen.json: sizes, pivot positions
   (three.js frame: x forward, y up, z right), triangle counts, credits.

Usage:
  pnpm bake:models                 # every model whose source is reachable
  pnpm bake:models msl apollo-lm   # just these
Blender is found via $BLENDER, then /Applications/Blender.app, then PATH.
"""

from __future__ import annotations

import fnmatch
import json
import math
import os
import shutil
import sys
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

import bpy
import mathutils

TOOLS = Path(__file__).resolve().parent
REPO = TOOLS.parent
CACHE = TOOLS / ".cache/models"
OUT = REPO / "public/models"
META = REPO / "src/components/lab/scene/models.gen.json"
MANIFEST = TOOLS / "models.json"
MAX_TEX = 1024

AXES = {
    "X": (1, 0, 0), "-X": (-1, 0, 0),
    "Y": (0, 1, 0), "-Y": (0, -1, 0),
    "Z": (0, 0, 1), "-Z": (0, 0, -1),
}


# ---------------------------------------------------------------- download --

def sketchfab_token() -> str | None:
    tok = os.environ.get("SKETCHFAB_API_TOKEN")
    if tok:
        return tok.strip()
    env = REPO / ".env.local"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("SKETCHFAB_API_TOKEN="):
                return line.split("=", 1)[1].strip().strip('"')
    return None


def fetch(mid: str, src: dict) -> Path | None:
    """Download (once) and return the local source file, or None if it can't be fetched."""
    CACHE.mkdir(parents=True, exist_ok=True)
    kind = src["kind"]
    if kind == "url":
        url = src["url"]
        name = mid + Path(urllib.parse.urlparse(url).path).suffix
        dest = CACHE / name
        if not dest.exists():
            print(f"[{mid}] downloading {url}")
            urllib.request.urlretrieve(urllib.parse.quote(url, safe=":/()%"), dest)
        return dest
    if kind == "sketchfab":
        dest_dir = CACHE / mid
        found = list(dest_dir.glob("**/*.gltf")) + list(dest_dir.glob("**/*.glb"))
        if found:
            return found[0]
        tok = sketchfab_token()
        if not tok:
            print(f"[{mid}] skipped: Sketchfab model {src['uid']} needs SKETCHFAB_API_TOKEN (sketchfab.com/settings/password)")
            return None
        req = urllib.request.Request(
            f"https://api.sketchfab.com/v3/models/{src['uid']}/download",
            headers={"Authorization": f"Token {tok}"},
        )
        with urllib.request.urlopen(req) as r:
            info = json.load(r)
        dl = info.get("glb") or info["gltf"]
        dest_dir.mkdir(parents=True, exist_ok=True)
        tmp = dest_dir / ("model.glb" if "glb" in info else "model.zip")
        print(f"[{mid}] downloading Sketchfab {src['uid']} ({dl.get('size', 0) / 1e6:.1f} MB)")
        urllib.request.urlretrieve(dl["url"], tmp)
        if tmp.suffix == ".zip":
            with zipfile.ZipFile(tmp) as z:
                z.extractall(dest_dir)
            tmp.unlink()
        found = list(dest_dir.glob("**/*.gltf")) + list(dest_dir.glob("**/*.glb"))
        return found[0]
    raise ValueError(f"unknown source kind {kind}")


# ------------------------------------------------------------------ import --

def load(path: Path) -> None:
    if path.suffix == ".blend":
        bpy.ops.wm.open_mainfile(filepath=str(path))
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(path))
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")


def ancestors(o):
    while o is not None:
        yield o
        o = o.parent


def matches(name: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatchcase(name, p) for p in patterns)


def visible_meshes() -> list:
    out = []
    for o in bpy.context.scene.objects:
        # Viewport visibility is what the authors curate (NASA's MSL file has a link with hide_render set by mistake).
        if o.type != "MESH" or not o.visible_get():
            continue
        if len(o.data.polygons) == 0:
            continue
        out.append(o)
    return out


def bbox(objs, mat=None):
    lo = mathutils.Vector((math.inf,) * 3)
    hi = -lo
    for o in objs:
        m = (mat or mathutils.Matrix.Identity(4)) @ o.matrix_world
        for v in o.data.vertices:
            w = m @ v.co
            lo = mathutils.Vector(map(min, lo, w))
            hi = mathutils.Vector(map(max, hi, w))
    return lo, hi


def frame_matrix(forward: str, up: str) -> mathutils.Matrix:
    """Rotation taking the source's forward/up axes to Blender +X / +Z."""
    f = mathutils.Vector(AXES[forward])
    u = mathutils.Vector(AXES[up])
    left = u.cross(f)
    r = mathutils.Matrix((f, left, u))
    return r.to_4x4()


# -------------------------------------------------------------------- bake --

def bake(mid: str, spec: dict) -> dict | None:
    src = fetch(mid, spec["source"])
    if src is None:
        return None
    load(src)
    scene = bpy.context.scene
    # Animated sources (NASA's rovers play their deploy sequences): pose them at a chosen frame.
    scene.frame_set(spec.get("frame", scene.frame_start))
    hide, hide_tree = spec.get("hide", []), spec.get("hideTree", [])
    meshes = [o for o in visible_meshes() if not matches(o.name, hide) and not any(matches(a.name, hide_tree) for a in ancestors(o))]
    if spec.get("keep"):
        meshes = [o for o in meshes if any(matches(a.name, spec["keep"]) for a in ancestors(o))]
    # Fused meshes (one OBJ, four tyres in one object) are split into loose parts after flattening.
    split_names = {o.name for o in meshes if any(matches(a.name, spec.get("split", [])) for a in ancestors(o))}
    # Rig membership is decided on the *source* hierarchy, before flattening.
    rig = spec.get("rig", [])
    owner: dict[str, str] = {}
    # Which rig entries name each mesh (by itself or an ancestor); entries with a box use it as a filter later.
    named: dict[str, set[str]] = {o.name: {r["name"] for r in rig if any(matches(a.name, r.get("objects", [])) for a in ancestors(o))} for o in meshes}
    for o in meshes:
        best, depth = "body", math.inf
        for r in rig:
            if "box" in r:
                continue
            for d, a in enumerate(ancestors(o)):
                if d >= depth:
                    break
                if matches(a.name, r.get("objects", [])):
                    best, depth = r["name"], d
                    break
        owner[o.name] = best
    # Source-space pivots (object origins / subtree centres), captured before flattening.
    src_pivots: dict[str, mathutils.Vector] = {}
    by_name = {o.name: o for o in scene.objects}
    for r in rig:
        p = r.get("pivot", {})
        if "origin" in p:
            src_pivots[r["name"]] = by_name[p["origin"]].matrix_world.translation.copy()
        elif "center" in p:
            group = [o for o in meshes if any(matches(a.name, [p["center"]]) for a in ancestors(o))]
            lo, hi = bbox(group)
            src_pivots[r["name"]] = (lo + hi) / 2

    # Normalise: rotate to the lab frame, scale to the published size, put the origin where the view expects it.
    R = frame_matrix(spec.get("forward", "X"), spec.get("up", "Z"))
    lo, hi = bbox(meshes, R)
    size = hi - lo
    sc = spec["scale"]
    # Either a fixed unit factor (a model built in cm) or a published dimension along an axis.
    k = sc["factor"] if "factor" in sc else sc["m"] / size["xyz".index(sc["axis"])]
    S = mathutils.Matrix.Scale(k, 4)
    lo, hi = lo * k, hi * k
    org = spec.get("origin", "base")
    if org == "base":
        o3 = mathutils.Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    elif org == "center":
        o3 = (lo + hi) / 2
    else:
        o3 = mathutils.Vector(org) * 1.0
    T = mathutils.Matrix.Translation(-o3)
    M = T @ S @ R
    dims = [(hi - lo)[i] for i in range(3)]

    # Flatten every kept mesh to world space (single-user data, transforms applied).
    keep = set(o.name for o in meshes)
    # Bake modifiers (geometry nodes, mirrors, arrays) into plain single-user meshes first.
    dg = bpy.context.evaluated_depsgraph_get()
    for o in list(scene.objects):
        if o.name not in keep:
            continue
        o.data = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        o.modifiers.clear()
    bpy.context.view_layer.update()
    world = {n: scene.objects[n].matrix_world.copy() for n in keep}
    # Constraints and drivers (IK arms, track-to cameras) would re-pose the flattened meshes.
    for o in scene.objects:
        o.constraints.clear()
        o.animation_data_clear()
    for o in list(scene.objects):
        if o.name not in keep:
            continue
        mw = M @ world[o.name]
        o.parent = None
        o.data.transform(mw)
        # A mirrored source transform turns the faces inside out once baked in.
        if mw.determinant() < 0:
            o.data.flip_normals()
        o.matrix_world = mathutils.Matrix.Identity(4)
    for o in list(scene.objects):
        if o.name not in keep:
            bpy.data.objects.remove(o, do_unlink=True)

    # Split fused meshes into loose parts; the parts inherit the owner, then rig boxes can claim them.
    for n in sorted(split_names):
        o = scene.objects[n]
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.separate(type="LOOSE")
        bpy.ops.object.mode_set(mode="OBJECT")
        for piece in bpy.context.selected_objects:
            keep.add(piece.name)
            owner[piece.name] = owner[n]
            named[piece.name] = named.get(n, set())
            split_names = split_names | {piece.name}
    centre = {}
    for n in keep:
        lo_, hi_ = bbox([scene.objects[n]])
        centre[n] = (lo_ + hi_) / 2
    # Rig boxes (lab frame, metres, Blender axes: x forward, y left, z up) claim parts by their centre.
    for r in rig:
        if "box" not in r:
            continue
        (x0, y0, z0), (x1, y1, z1) = r["box"]
        for n in keep:
            c = centre[n]
            if not (x0 <= c.x <= x1 and y0 <= c.y <= y1 and z0 <= c.z <= z1):
                continue
            # A box claims split parts and unassigned parts, plus anything its own "objects" name.
            if r.get("objects"):
                # A named box only takes parts with that name (in a corner of the model).
                if r["name"] in named.get(n, set()):
                    owner[n] = r["name"]
            elif n in split_names or owner.get(n) == "body":
                owner[n] = r["name"]
    # Pivots measured on a rig node's own parts: {"part": {"z": "min"}} = bbox centre with z at the bottom.
    part_pivots: dict[str, mathutils.Vector] = {}
    for r in rig:
        spec_p = r.get("pivot", {}).get("part")
        if spec_p is None:
            continue
        objs = [scene.objects[n] for n in keep if owner.get(n) == r["name"]]
        if not objs:
            raise ValueError(f"[{mid}] rig node {r['name']} has no parts to measure a pivot on")
        lo_, hi_ = bbox(objs)
        c = (lo_ + hi_) / 2
        for i, ax in enumerate("xyz"):
            if spec_p.get(ax) == "min":
                c[i] = lo_[i]
            elif spec_p.get(ax) == "max":
                c[i] = hi_[i]
        part_pivots[r["name"]] = c

    # Rebuild a rig of empties at the pivots.
    root = bpy.data.objects.new(mid, None)
    scene.collection.objects.link(root)
    nodes = {"body": bpy.data.objects.new("body", None)}
    scene.collection.objects.link(nodes["body"])
    nodes["body"].parent = root
    pivots_out: dict[str, list[float]] = {}
    for r in rig:
        e = bpy.data.objects.new(r["name"], None)
        scene.collection.objects.link(e)
        if r["name"] in part_pivots:
            p = part_pivots[r["name"]]
        elif r["name"] in src_pivots:
            p = M @ src_pivots[r["name"]]
        else:
            p = mathutils.Vector(r["pivot"]["at"])
        e.location = p
        nodes[r["name"]] = e
        pivots_out[r["name"]] = [round(p.x, 4), round(p.z, 4), round(-p.y, 4)]
    bpy.context.view_layer.update()
    for r in rig:
        e = nodes[r["name"]]
        par = nodes[r.get("parent", "body")]
        mw = e.matrix_world.copy()
        e.parent = par
        e.matrix_world = mw
    bpy.context.view_layer.update()

    # Join meshes per rig node and parent them (keeping world placement).
    tri_total = 0
    parts_out: dict[str, list[float]] = {}
    for name, node in nodes.items():
        objs = [scene.objects[n] for n in keep if owner.get(n) == name]
        if not objs:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        o = bpy.context.view_layer.objects.active
        o.name = f"{name}_mesh"
        lo_, hi_ = bbox([o])
        parts_out[name] = [round(hi_.x - lo_.x, 4), round(hi_.z - lo_.z, 4), round(hi_.y - lo_.y, 4)]
        mw = o.matrix_world.copy()
        o.parent = node
        o.matrix_world = mw
        tri_total += sum(len(p.vertices) - 2 for p in o.data.polygons)

    # Decimate to budget.
    budget = spec.get("maxTris", 120_000)
    if tri_total > budget:
        ratio = budget / tri_total
        for o in scene.objects:
            if o.type == "MESH" and len(o.data.polygons) > 400:
                mod = o.modifiers.new("decimate", "DECIMATE")
                mod.ratio = max(0.02, ratio)
                bpy.context.view_layer.objects.active = o
                bpy.ops.object.modifier_apply(modifier=mod.name)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in scene.objects if o.type == "MESH")

    # Textures: low-bit-depth images (8-bit greyscale PNGs) can't be re-encoded as WebP; copy them to RGBA first.
    for img in list(bpy.data.images):
        if img.has_data and img.size[0] > 0 and img.depth < 24:
            rgba = bpy.data.images.new(img.name + "_rgba", img.size[0], img.size[1], alpha=True)
            rgba.pixels[:] = img.pixels[:]
            rgba.colorspace_settings.name = img.colorspace_settings.name
            img.user_remap(rgba)
    # Cap the size (the glTF exporter re-encodes as WebP).
    for img in bpy.data.images:
        if img.size[0] > MAX_TEX or img.size[1] > MAX_TEX:
            f = MAX_TEX / max(img.size)
            img.scale(max(1, int(img.size[0] * f)), max(1, int(img.size[1] * f)))

    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / f"{mid}.glb"
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(out),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        # WebP is smallest, but OpenImageIO can't write the 1-channel images the exporter builds for some materials.
        export_image_format=spec.get("imageFormat", "WEBP"),
        export_image_quality=85,
        export_animations=False,
    )
    mb = out.stat().st_size / 1e6
    # three.js frame: x forward, y up, z right (Blender y is left).
    meta = {
        "file": f"/models/{mid}.glb",
        "sizeM": [round(dims[0], 3), round(dims[2], 3), round(dims[1], 3)],
        "pivots": pivots_out,
        # Size of each rig node's own meshes (three.js frame) — engine exits, wheel diameters.
        "parts": parts_out,
        "tris": tris,
        "mb": round(mb, 2),
        "title": spec["title"],
        "credit": spec["credit"],
        "license": spec["license"],
        "page": spec["page"],
        "scaleRef": sc.get("ref", ""),
    }
    print(f"[{mid}] {tris} tris, {mb:.2f} MB, size L x W x H = {dims[0]:.2f} x {dims[1]:.2f} x {dims[2]:.2f} m (scale x{k:.3f})")
    for name in sorted(pivots_out):
        print(f"[{mid}]   rig {name}: pivot {pivots_out[name]}, parts {parts_out.get(name)}")
    for chk in spec.get("check", []):
        got = dims["xyz".index(chk["axis"])]
        err = (got - chk["m"]) / chk["m"] * 100
        flag = "OK " if abs(err) <= chk.get("tol", 10) else "OFF"
        print(f"[{mid}]   {flag} {chk['what']}: model {got:.2f} m vs published {chk['m']} m ({err:+.0f}%), {chk['ref']}")
        meta.setdefault("checks", []).append({"what": chk["what"], "modelM": round(got, 3), "publishedM": chk["m"], "ref": chk["ref"]})
    return meta


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    manifest = json.loads(MANIFEST.read_text())
    ids = argv or [k for k in manifest if not k.startswith("_") and manifest[k].get("status") != "rejected"]
    meta = json.loads(META.read_text()) if META.exists() else {}
    for mid in ids:
        m = bake(mid, manifest[mid])
        if m is not None:
            meta[mid] = m
    META.write_text(json.dumps(dict(sorted(meta.items())), indent=2) + "\n")
    print(f"wrote {META.relative_to(REPO)}")


if __name__ == "__main__":
    main()
