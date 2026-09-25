from __future__ import annotations

"""Anatomical 3D human body mesh morpher for SukatAI.

Provides fast, CPU-first, photorealistic human mesh reconstruction.
Deforms the canonical 13,718-vertex human body template using continuous
linear blend skinning weights to guarantee zero tearing, smooth contours,
and watertight anatomical manifold geometry.
"""

from pathlib import Path
import threading
from typing import Any

import numpy as np

_MODELS_DIR = Path(__file__).resolve().parent.parent.parent / "models"
_WEIGHTS_FILE = _MODELS_DIR / "canonical_human_weights.npz"
_LOCK = threading.Lock()

_CACHED_DATA: dict[str, np.ndarray] | None = None


def _load_data() -> dict[str, np.ndarray]:
    global _CACHED_DATA

    if _CACHED_DATA is not None:
        return _CACHED_DATA

    with _LOCK:
        if _CACHED_DATA is not None:
            return _CACHED_DATA

        if _WEIGHTS_FILE.is_file():
            data = np.load(str(_WEIGHTS_FILE))
            _CACHED_DATA = {k: data[k] for k in data.files}
            return _CACHED_DATA

        # Fallback to computing from anny model directly if npz missing
        try:
            import anny  # type: ignore

            a = anny.Anny()
            verts = a()["vertices"][0].detach().cpu().numpy().astype(np.float32)
            faces = a.faces.detach().cpu().numpy().astype(np.int64)
            weights = a.vertex_bone_weights.detach().cpu().numpy().astype(np.float32)
            indices = a.vertex_bone_indices.detach().cpu().numpy()
            labels = a.bone_labels

            torso_bones = {i for i, l in enumerate(labels) if any(s in l for s in ["spine", "root", "pelvis"])}
            arm_l_bones = {
                i
                for i, l in enumerate(labels)
                if ".L" in l and any(s in l for s in ["clavicle", "shoulder", "arm", "wrist", "finger", "metacarpal"])
            }
            arm_r_bones = {
                i
                for i, l in enumerate(labels)
                if ".R" in l and any(s in l for s in ["clavicle", "shoulder", "arm", "wrist", "finger", "metacarpal"])
            }
            leg_l_bones = {i for i, l in enumerate(labels) if ".L" in l and any(s in l for s in ["leg", "foot", "toe"])}
            leg_r_bones = {i for i, l in enumerate(labels) if ".R" in l and any(s in l for s in ["leg", "foot", "toe"])}

            def get_w(bone_set: set[int]) -> np.ndarray:
                mask = np.isin(indices, list(bone_set))
                return np.sum(weights * mask, axis=1).astype(np.float32)

            _CACHED_DATA = {
                "vertices": verts,
                "faces": faces,
                "w_torso": get_w(torso_bones),
                "w_arm_l": get_w(arm_l_bones),
                "w_arm_r": get_w(arm_r_bones),
                "w_leg_l": get_w(leg_l_bones),
                "w_leg_r": get_w(leg_r_bones),
            }
            try:
                _WEIGHTS_FILE.parent.mkdir(parents=True, exist_ok=True)
                np.savez_compressed(_WEIGHTS_FILE, **_CACHED_DATA)
            except Exception:
                pass
            return _CACHED_DATA
        except Exception as error:
            raise RuntimeError(f"Could not load canonical human body mesh weights: {error}") from error


def get_canonical_mesh() -> tuple[np.ndarray, np.ndarray]:
    """Return canonical human vertices and faces (Z-up, normalized height ~1.70m)."""
    data = _load_data()
    v = data["vertices"].copy()
    f = data["faces"].copy()
    z_min = float(v[:, 2].min())
    z_max = float(v[:, 2].max())
    v *= 1.70 / max(z_max - z_min, 1e-4)
    v[:, 2] -= float(v[:, 2].min())
    return v, f


def morph_canonical_human_body(
    targets: dict[str, Any],
    height_cm: float,
    sex: str | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Morph canonical articulated human mesh to match measurements smoothly using skinning weights.

    Parameters:
        targets: Dictionary containing target measurements in cm.
        height_cm: Target total body height in cm.
        sex: ``male``/``female``/``neutral``. The canonical template is
            female-derived, so a male scan flattens the bust and widens the
            shoulders to read as male.

    Returns:
        (vertices, faces): Morphed vertices (Z-up meters) and triangle face indices.
    """
    if not np.isfinite(height_cm) or height_cm <= 0:
        raise ValueError("A positive height is required to morph the body mesh.")

    data = _load_data()
    v = data["vertices"].copy()
    faces = data["faces"]
    w_torso = data["w_torso"]
    w_arm_l = data["w_arm_l"]
    w_arm_r = data["w_arm_r"]
    w_leg_l = data["w_leg_l"]
    w_leg_r = data["w_leg_r"]

    z_min = float(v[:, 2].min())
    z_max = float(v[:, 2].max())
    h_base = max(z_max - z_min, 1e-4)
    z_norm = (v[:, 2] - z_min) / h_base

    # Target measurements
    bust_target = float(targets.get("bust_cm", 95.0))
    waist_target = float(targets.get("waist_cm", 78.0))
    hip_target = float(targets.get("hip_cm", 96.0))
    thigh_target = float(targets.get("thigh_cm", 54.0))

    # Baselines scaled to target stature
    s_h = float(height_cm) / 162.5
    base_bust = 73.9 * s_h
    base_waist = 69.8 * s_h
    base_hip = 84.3 * s_h
    base_thigh = 46.9 * s_h

    # Bounded proportional scaling factors to ensure physically plausible human anatomy
    s_bust = float(np.clip(bust_target / max(base_bust, 1.0), 0.75, 1.30))
    s_waist = float(np.clip(waist_target / max(base_waist, 1.0), 0.75, 1.30))
    s_hip = float(np.clip(hip_target / max(base_hip, 1.0), 0.75, 1.30))
    s_thigh = float(np.clip(thigh_target / max(base_thigh, 1.0), 0.75, 1.30))

    # Torso profile scale curve along z_norm (smooth interpolation across key landmarks)
    z_ctrl = np.array([0.48, 0.54, 0.62, 0.70, 0.80, 0.84], dtype=np.float32)
    s_ctrl = np.array([s_hip, s_hip, s_waist, s_bust, (s_bust + 1.0) / 2.0, 1.0], dtype=np.float32)
    s_torso = np.interp(z_norm, z_ctrl, s_ctrl).astype(np.float32)

    # 1. Continuous torso displacement modulated by torso bone skinning weights
    v[:, 0] += w_torso * v[:, 0] * (s_torso - 1.0)
    v[:, 1] += w_torso * v[:, 1] * (s_torso - 1.0)

    # 2. Continuous arm lateral translation so shoulders and arms move smoothly with chest
    arm_shift = (s_bust - 1.0) * 0.08
    v[:, 0] -= w_arm_l * arm_shift
    v[:, 0] += w_arm_r * arm_shift

    # 3. Continuous leg radial scaling around leg bone centerlines
    xc_l, xc_r = -0.095, 0.095
    v[:, 0] += w_leg_l * (v[:, 0] - xc_l) * (s_thigh - 1.0)
    v[:, 1] += w_leg_l * v[:, 1] * (s_thigh - 1.0)
    v[:, 0] += w_leg_r * (v[:, 0] - xc_r) * (s_thigh - 1.0)
    v[:, 1] += w_leg_r * v[:, 1] * (s_thigh - 1.0)

    # 3b. Sex-specific silhouette. The canonical template is female-derived, so
    # a male scan flattens the bust band (front/back projection and chest width)
    # and modestly broadens the shoulders. Gaussian bands keep the mesh smooth
    # and watertight.
    if (sex or "neutral").strip().lower() == "male":
        chest_band = np.exp(-((z_norm - 0.70) ** 2) / (2.0 * 0.05 ** 2)).astype(np.float32)
        v[:, 0] -= chest_band * v[:, 0] * 0.10
        v[:, 1] -= chest_band * v[:, 1] * 0.22
        shoulder_band = np.exp(-((z_norm - 0.82) ** 2) / (2.0 * 0.04 ** 2)).astype(np.float32)
        v[:, 0] += shoulder_band * v[:, 0] * 0.06

    # 4. Exact stature scaling to user reference height, feet on ground plane (z=0)
    target_h_m = float(height_cm) / 100.0
    scale_h = target_h_m / h_base
    v *= scale_h
    v[:, 2] -= float(v[:, 2].min())

    return v, faces
