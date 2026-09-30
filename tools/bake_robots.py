"""Bake Unitree G1 / H1 robots for the browser.

Source: unitreerobotics/unitree_rl_gym (MJCF models + pretrained walking
policies). For each robot we:

1. copy the MJCF, pointing meshdir at our public folder,
2. decimate the STL meshes (24 MB -> ~2 MB) so they load fast on the web,
   dynamics are unaffected because every body has an explicit <inertial>,
3. export the recurrent walking policy (LSTM 64 + MLP) to plain JSON weights
   so the browser can run it without onnxruntime,
4. write a reference rollout (obs/action pairs) used by the TS unit tests to
   check that our TS policy + observation code matches PyTorch exactly,
5. re-run the policy headless with the decimated meshes to make sure walking
   still works on Earth and under Venus surface conditions.

Usage: uv run python bake_robots.py [path/to/unitree_rl_gym]
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import mujoco
import numpy as np
import torch
import trimesh
import yaml

REPO = Path(__file__).resolve().parents[1]
CACHE = Path(__file__).resolve().parent / ".cache"
PUBLIC = REPO / "public/robots"
FIXTURES = REPO / "src/sim/robots/__fixtures__"

ROBOTS = {
    "g1": {"xml": "g1_description/g1_12dof.xml", "cfg": "g1.yaml"},
    "h1": {"xml": "h1/h1.xml", "cfg": "h1.yaml"},
}
TARGET_FACES = 1500


def ensure_source(arg: str | None) -> Path:
    if arg:
        return Path(arg)
    src = CACHE / "unitree_rl_gym"
    if not src.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["git", "clone", "--depth", "1", "https://github.com/unitreerobotics/unitree_rl_gym.git", str(src)],
            check=True,
        )
    return src


def decimate(src: Path, dst: Path) -> None:
    mesh = trimesh.load_mesh(src)
    if len(mesh.faces) > TARGET_FACES:
        mesh = mesh.simplify_quadric_decimation(face_count=TARGET_FACES)
    dst.write_bytes(mesh.export(file_type="stl"))


# ---- Plastic yield hinges ------------------------------------------------------------
#
# Rigid bodies can't bend, so each thigh and shin is cut in half and the halves
# are joined by two passive hinges (pitch + roll) with a stiff spring (the
# limb's elastic bending stiffness). At runtime the spring rest angle is moved
# whenever the bending moment exceeds the section's plastic moment
# M_p(T) = M_p0 * yield(T)/yield(20 C) (return mapping), so the limb is
# elastic below yield and bends *permanently* above it:
# elastic-perfectly-plastic behaviour. MuJoCo's frictionloss was tried first
# but creeps under sustained load. See src/sim/robots/robot-world.ts.

def _quat_to_mat(q):
    w, x, y, z = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def _vec(el, attr, default):
    v = el.get(attr)
    return np.array([float(t) for t in v.split()]) if v else np.array(default, dtype=float)


def _fmt(v):
    return " ".join(f"{x:.6g}" for x in v)


def add_yield_hinges(out: Path) -> list[dict]:
    """Split thigh and shin bodies in robot.xml; returns hinge metadata."""
    tree = ET.parse(out / "robot.xml")
    root = tree.getroot()
    asset = root.find("asset")
    parent_of = {c: p for p in root.iter() for c in p}
    bodies = {b.get("name"): b for b in root.iter("body")}
    hinges = []

    for side in ("left", "right"):
        knee = bodies[f"{side}_knee_link"]
        thigh = parent_of[knee]
        for link in (thigh, knee):
            child = next(c for c in link if c.tag == "body")
            v = _vec(child, "pos", [0, 0, 0])
            L = np.linalg.norm(v)
            n = v / L
            cut = v * 0.5
            name = link.get("name")

            # Meshes of this link, in the link frame, split at the cut plane.
            parts = {"upper": [], "lower": []}
            vol = {"upper": 0.0, "lower": 0.0}
            cen = {"upper": np.zeros(3), "lower": np.zeros(3)}
            for g in [c for c in link if c.tag == "geom"]:
                if g.get("type") != "mesh":
                    side_key = "upper" if np.dot(_vec(g, "pos", [0, 0, 0]) - cut, n) < 0 else "lower"
                    parts[side_key].append(("prim", g))
                    continue
                mname = g.get("mesh")
                mfile = next(m.get("file") for m in asset.iter("mesh") if m.get("name") == mname)
                mesh = trimesh.load_mesh(out / "meshes" / mfile)
                T = np.eye(4)
                T[:3, :3] = _quat_to_mat(_vec(g, "quat", [1, 0, 0, 0]))
                T[:3, 3] = _vec(g, "pos", [0, 0, 0])
                mesh.apply_transform(T)
                for key, normal, origin in (("upper", -n, cut), ("lower", n, cut)):
                    piece = mesh.slice_plane(origin, normal, cap=True)
                    if piece is None or len(piece.faces) == 0:
                        continue
                    if key == "lower":
                        piece.apply_translation(-cut)
                    new_name = f"{mname}_{key}"
                    new_file = f"{Path(mfile).stem}_{key}.STL"
                    (out / "meshes" / new_file).write_bytes(piece.export(file_type="stl"))
                    if not any(m.get("name") == new_name for m in asset.iter("mesh")):
                        ET.SubElement(asset, "mesh", {"name": new_name, "file": new_file})
                    parts[key].append(("mesh", g, new_name))
                    if g.get("group") == "1":  # visual copy: use it to split mass
                        vol[key] += abs(piece.volume) if piece.is_volume else piece.area * 0.002
                        c = piece.center_mass if piece.is_volume else piece.centroid
                        cen[key] = c + (cut if key == "lower" else 0)

            total_v = vol["upper"] + vol["lower"]
            fu = vol["upper"] / total_v if total_v > 0 else 0.5
            fl = 1 - fu

            # Build the lower body.
            lower = ET.Element("body", {"name": f"{name}_lower", "pos": _fmt(cut)})
            inertial = link.find("inertial")
            m = float(inertial.get("mass"))
            com = _vec(inertial, "pos", [0, 0, 0])
            diag = _vec(inertial, "diaginertia", [1e-4] * 3)
            # Preserve the original COM exactly: shift mesh centroids by a common offset.
            delta = com - (fu * cen["upper"] + fl * cen["lower"])
            cu, cl = cen["upper"] + delta, cen["lower"] + delta
            inertial.set("mass", f"{m * fu:.6g}")
            inertial.set("pos", _fmt(cu))
            inertial.set("diaginertia", _fmt(np.maximum(diag * fu, 1e-6)))
            ET.SubElement(lower, "inertial", {
                "pos": _fmt(cl - cut),
                "quat": inertial.get("quat", "1 0 0 0"),
                "mass": f"{m * fl:.6g}",
                "diaginertia": _fmt(np.maximum(diag * fl, 1e-6)),
            })
            for axis, tag in (("0 1 0", "pitch"), ("1 0 0", "roll")):
                ET.SubElement(lower, "joint", {
                    "name": f"{name}_yield_{tag}",
                    "type": "hinge",
                    "axis": axis,
                    "range": "-1.3 1.3",
                    # ~ 4EI/L for an aluminium limb tube (D 5 cm, 3 mm wall, L 0.4 m) is ~8e4;
                    # 2e4 keeps the explicit spring stable at dt = 2 ms (deflection ~0.3 deg at 100 N m).
                    "stiffness": "20000",
                    "damping": "40",
                    # Extra rotor inertia keeps the stiff spring stable; small next to the limb's own.
                    "armature": "0.1",
                    "actuatorfrclimited": "false",
                })

            # Replace link geoms by the upper halves, give the lower halves to the new body.
            for g in [c for c in link if c.tag == "geom"]:
                link.remove(g)
            for entry in parts["upper"]:
                if entry[0] == "prim":
                    link.append(entry[1])
                else:
                    g, new_name = entry[1], entry[2]
                    ng = ET.SubElement(link, "geom", {k: v for k, v in g.attrib.items() if k not in ("pos", "quat")})
                    ng.set("mesh", new_name)
            for entry in parts["lower"]:
                if entry[0] == "prim":
                    g = entry[1]
                    g.set("pos", _fmt(_vec(g, "pos", [0, 0, 0]) - cut))
                    lower.append(g)
                else:
                    g, new_name = entry[1], entry[2]
                    ng = ET.SubElement(lower, "geom", {k: v for k, v in g.attrib.items() if k not in ("pos", "quat")})
                    ng.set("mesh", new_name)
            # Move the next body under the lower half.
            link.remove(child)
            child.set("pos", _fmt(v - cut))
            lower.append(child)
            link.append(lower)
            hinges.append({
                "name": name,
                "joints": [f"{name}_yield_pitch", f"{name}_yield_roll"],
                "lengthM": float(L),
                "massSplit": [round(fu, 3), round(fl, 3)],
            })

    ET.indent(tree)
    tree.write(out / "robot.xml")
    return hinges


def export_policy(pt: Path) -> dict:
    policy = torch.jit.load(str(pt))
    sd = {k: v.detach().numpy() for k, v in policy.named_parameters()}

    def arr(a: np.ndarray) -> list[float]:
        return [float(f"{x:.7g}") for x in a.ravel()]

    return {
        "arch": "lstm1-elu-mlp",
        "hidden": int(sd["memory.weight_hh_l0"].shape[1]),
        "inputs": int(sd["memory.weight_ih_l0"].shape[1]),
        "outputs": int(sd["actor.2.weight"].shape[0]),
        # PyTorch LSTM gate order: input, forget, cell(g), output.
        "lstm": {
            "wIh": arr(sd["memory.weight_ih_l0"]),
            "wHh": arr(sd["memory.weight_hh_l0"]),
            "bIh": arr(sd["memory.bias_ih_l0"]),
            "bHh": arr(sd["memory.bias_hh_l0"]),
        },
        "mlp": [
            {"w": arr(sd["actor.0.weight"]), "b": arr(sd["actor.0.bias"]), "rows": int(sd["actor.0.weight"].shape[0])},
            {"w": arr(sd["actor.2.weight"]), "b": arr(sd["actor.2.bias"]), "rows": int(sd["actor.2.weight"].shape[0])},
        ],
    }


def gravity_orientation(q: np.ndarray) -> np.ndarray:
    qw, qx, qy, qz = q
    return np.array([2 * (-qz * qx + qw * qy), -2 * (qz * qy + qw * qx), 1 - 2 * (qw * qw + qz * qz)])


def rollout(xml: Path, cfg: dict, pt: Path, *, g: float, rho: float, mu: float, seconds: float, record: int = 0):
    """Replicates unitree_rl_gym/deploy/deploy_mujoco/deploy_mujoco.py headless."""
    scene = xml.parent / "_scene.xml"
    scene.write_text(
        f'<mujoco><include file="{xml.name}"/><worldbody>'
        '<geom name="floor" size="0 0 0.05" type="plane"/></worldbody></mujoco>'
    )
    m = mujoco.MjModel.from_xml_path(str(scene))
    scene.unlink()
    d = mujoco.MjData(m)
    m.opt.timestep = cfg["simulation_dt"]
    m.opt.gravity[:] = [0, 0, -g]
    m.opt.density = rho
    m.opt.viscosity = mu
    policy = torch.jit.load(str(pt))
    kps, kds = np.array(cfg["kps"]), np.array(cfg["kds"])
    default = np.array(cfg["default_angles"], dtype=np.float32)
    na, no = cfg["num_actions"], cfg["num_obs"]
    cmd = np.array(cfg["cmd_init"], dtype=np.float32)
    action = np.zeros(na, np.float32)
    target = default.copy()
    obs = np.zeros(no, np.float32)
    frames = []
    jid = m.actuator_trnid[:, 0]
    qi = m.jnt_qposadr[jid]
    vi = m.jnt_dofadr[jid]
    for k in range(int(seconds / m.opt.timestep)):
        d.ctrl[:] = (target - d.qpos[qi]) * kps - d.qvel[vi] * kds
        mujoco.mj_step(m, d)
        if (k + 1) % cfg["control_decimation"] == 0:
            t = (k + 1) * m.opt.timestep
            phase = t % 0.8 / 0.8
            obs[:3] = d.qvel[3:6] * cfg["ang_vel_scale"]
            obs[3:6] = gravity_orientation(d.qpos[3:7])
            obs[6:9] = cmd * np.array(cfg["cmd_scale"])
            obs[9 : 9 + na] = (d.qpos[qi] - default) * cfg["dof_pos_scale"]
            obs[9 + na : 9 + 2 * na] = d.qvel[vi] * cfg["dof_vel_scale"]
            obs[9 + 2 * na : 9 + 3 * na] = action
            obs[9 + 3 * na : 9 + 3 * na + 2] = [np.sin(2 * np.pi * phase), np.cos(2 * np.pi * phase)]
            with torch.no_grad():
                action = policy(torch.from_numpy(obs).unsqueeze(0)).numpy().squeeze().astype(np.float32)
            target = action * cfg["action_scale"] + default
            if len(frames) < record:
                frames.append({"obs": obs.tolist(), "action": action.tolist()})
    yield_dofs = [m.jnt_dofadr[j] for j in range(m.njnt) if "_yield_" in (m.joint(j).name or "")]
    bend = float(np.max(np.abs(d.qpos[[m.jnt_qposadr[j] for j in range(m.njnt) if "_yield_" in (m.joint(j).name or "")]]))) if yield_dofs else 0.0
    return {"x": float(d.qpos[0]), "z": float(d.qpos[2]), "maxBendRad": bend}, frames


def main() -> None:
    src = ensure_source(sys.argv[1] if len(sys.argv) > 1 else None)
    robots_dir = src / "resources/robots"
    FIXTURES.mkdir(parents=True, exist_ok=True)

    for rid, spec in ROBOTS.items():
        xml_src = robots_dir / spec["xml"]
        cfg = yaml.safe_load((src / "deploy/deploy_mujoco/configs" / spec["cfg"]).read_text())
        pt = src / "deploy/pre_train" / rid / "motion.pt"

        out = PUBLIC / rid
        if out.exists():
            shutil.rmtree(out)
        (out / "meshes").mkdir(parents=True)

        xml = xml_src.read_text()
        xml = re.sub(r'meshdir="[^"]*"', 'meshdir="meshes/"', xml)
        (out / "robot.xml").write_text(xml)

        mesh_files = sorted(set(re.findall(r'file="([^"]+\.(?:STL|stl))"', xml)))
        for f in mesh_files:
            decimate(xml_src.parent / "meshes" / f, out / "meshes" / f)

        hinges = add_yield_hinges(out)
        policy = export_policy(pt)
        policy["config"] = {
            k: cfg[k]
            for k in [
                "simulation_dt",
                "control_decimation",
                "kps",
                "kds",
                "default_angles",
                "ang_vel_scale",
                "dof_pos_scale",
                "dof_vel_scale",
                "action_scale",
                "cmd_scale",
                "num_actions",
                "num_obs",
                "cmd_init",
            ]
        }
        policy["meshes"] = sorted({p.name for p in (out / "meshes").iterdir()})
        policy["yieldHinges"] = hinges
        (out / "policy.json").write_text(json.dumps(policy, separators=(",", ":")))

        size = sum(p.stat().st_size for p in out.rglob("*") if p.is_file()) / 1e6
        print(f"[{rid}] {len(mesh_files)} meshes, {size:.1f} MB total")

        # Sanity: the decimated model must still walk, on Earth and on Venus.
        for label, g, rho, mu in [("earth", 9.81, 0.0, 0.0), ("venus", 8.87, 65.0, 3.3e-5)]:
            res, _ = rollout(out / "robot.xml", cfg, pt, g=g, rho=rho, mu=mu, seconds=10)
            print(f"  {label}: walked x={res['x']:.2f} m, pelvis z={res['z']:.2f} m, max yield-hinge bend {res['maxBendRad']:.4f} rad")

        # Reference frames for the TS policy test (Earth, no fluid).
        _, frames = rollout(out / "robot.xml", cfg, pt, g=9.81, rho=0, mu=0, seconds=0.2, record=8)
        (FIXTURES / f"{rid}-policy-ref.json").write_text(json.dumps(frames))


if __name__ == "__main__":
    main()
