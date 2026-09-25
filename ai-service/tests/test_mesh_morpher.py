from __future__ import annotations

from pathlib import Path
import numpy as np
import pytest
import trimesh

from app.reconstruction.mesh_morpher import get_canonical_mesh, morph_canonical_human_body
from app.reconstruction.mesh_exporter import export_glb
from app.pipeline import _guide_geometry


def test_canonical_mesh_has_articulated_human_topology() -> None:
    verts, faces = get_canonical_mesh()
    assert len(verts) == 13718
    assert len(faces) == 27420
    assert verts.ndim == 2 and verts.shape[1] == 3
    assert faces.ndim == 2 and faces.shape[1] == 3

    # Check Z-up height is approximately standard stature ~1.70m
    z_span = float(verts[:, 2].max() - verts[:, 2].min())
    assert 1.60 <= z_span <= 1.80
    assert verts[:, 2].min() == pytest.approx(0.0, abs=1e-3)

    # Check lateral symmetry (A-pose span > 0.8m across X)
    x_span = float(verts[:, 0].max() - verts[:, 0].min())
    assert x_span > 0.8


def test_morph_canonical_human_body_scales_to_targets() -> None:
    targets = {
        "height_cm": 180.0,
        "bust_cm": 105.0,
        "waist_cm": 85.0,
        "hip_cm": 102.0,
        "thigh_cm": 58.0,
        "shoulder_width_cm": 46.0,
        "upperarm_cm": 34.0,
    }
    verts, faces = morph_canonical_human_body(targets, 180.0)
    assert len(verts) == 13718
    assert len(faces) == 27420

    # Stature should match 180cm (1.80m)
    total_height = float(verts[:, 2].max() - verts[:, 2].min())
    assert total_height == pytest.approx(1.80, abs=1e-3)
    assert verts[:, 2].min() == pytest.approx(0.0, abs=1e-3)

    # Leg separation: left leg has x < 0, right leg has x > 0 below crotch
    crotch_level = 1.80 * 0.48
    below_crotch = verts[verts[:, 2] < crotch_level]
    assert np.any(below_crotch[:, 0] < -0.05)  # Left leg exists
    assert np.any(below_crotch[:, 0] > 0.05)   # Right leg exists


def test_morph_and_glb_export_with_guide_contours(tmp_path: Path) -> None:
    targets = {
        "height_cm": 165.0,
        "bust_cm": 92.0,
        "waist_cm": 74.0,
        "hip_cm": 94.0,
        "thigh_cm": 52.0,
    }
    verts, faces = morph_canonical_human_body(targets, 165.0)
    artifact = export_glb(verts, faces, tmp_path, "test_morphed", vertical_axis=2)
    assert artifact["format"] == "glb"
    assert artifact["size_bytes"] > 400000

    loaded = trimesh.load(str(artifact["path"]), force="mesh")
    # In GLB, vertical is Y-axis
    glb_height = float(loaded.vertices[:, 1].max() - loaded.vertices[:, 1].min())
    assert glb_height == pytest.approx(1.65, abs=1e-3)

    # Verify guide contour extraction
    guide_fractions = {"chest": 0.70, "waist": 0.62, "hip": 0.54, "thigh": 0.40}
    geom = _guide_geometry(verts, faces, guide_fractions, 165.0)
    for key in ("chest", "waist", "hip", "thigh"):
        assert key in geom["contours"]
        assert len(geom["contours"][key]["points"]) >= 20
