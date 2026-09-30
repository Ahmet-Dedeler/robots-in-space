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
    for k in range(int(seconds / m.opt.timestep)):
        d.ctrl[:] = (target - d.qpos[7:]) * kps - d.qvel[6:] * kds
        mujoco.mj_step(m, d)
        if (k + 1) % cfg["control_decimation"] == 0:
            t = (k + 1) * m.opt.timestep
            phase = t % 0.8 / 0.8
            obs[:3] = d.qvel[3:6] * cfg["ang_vel_scale"]
            obs[3:6] = gravity_orientation(d.qpos[3:7])
            obs[6:9] = cmd * np.array(cfg["cmd_scale"])
            obs[9 : 9 + na] = (d.qpos[7:] - default) * cfg["dof_pos_scale"]
            obs[9 + na : 9 + 2 * na] = d.qvel[6:] * cfg["dof_vel_scale"]
            obs[9 + 2 * na : 9 + 3 * na] = action
            obs[9 + 3 * na : 9 + 3 * na + 2] = [np.sin(2 * np.pi * phase), np.cos(2 * np.pi * phase)]
            with torch.no_grad():
                action = policy(torch.from_numpy(obs).unsqueeze(0)).numpy().squeeze().astype(np.float32)
            target = action * cfg["action_scale"] + default
            if len(frames) < record:
                frames.append({"obs": obs.tolist(), "action": action.tolist()})
    return {"x": float(d.qpos[0]), "z": float(d.qpos[2])}, frames


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
        policy["meshes"] = mesh_files
        (out / "policy.json").write_text(json.dumps(policy, separators=(",", ":")))

        size = sum(p.stat().st_size for p in out.rglob("*") if p.is_file()) / 1e6
        print(f"[{rid}] {len(mesh_files)} meshes, {size:.1f} MB total")

        # Sanity: the decimated model must still walk, on Earth and on Venus.
        for label, g, rho, mu in [("earth", 9.81, 0.0, 0.0), ("venus", 8.87, 65.0, 3.3e-5)]:
            res, _ = rollout(out / "robot.xml", cfg, pt, g=g, rho=rho, mu=mu, seconds=10)
            print(f"  {label}: walked x={res['x']:.2f} m, pelvis z={res['z']:.2f} m")

        # Reference frames for the TS policy test (Earth, no fluid).
        _, frames = rollout(out / "robot.xml", cfg, pt, g=9.81, rho=0, mu=0, seconds=0.2, record=8)
        (FIXTURES / f"{rid}-policy-ref.json").write_text(json.dumps(frames))


if __name__ == "__main__":
    main()
