from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import trimesh

from app.core.config import Settings
from app.fitting.anny_fitter import FittedAnnyBody
from app.pipeline import BodyScanPipeline, _guide_fractions, _guide_geometry
import app.pipeline as pipeline_module
from app.reconstruction.silhouette import extract_silhouette_profile
from app.validation.pose_validator import PoseObservation
import app.validation.pose_validator as pose_validator_module
from helpers import make_body_image


def build_settings(tmp_path: Path) -> Settings:
    return Settings(
        ai_mode="low_end", device="cpu", reconstruction_backend="anny_clad",
        smplx_model_dir=tmp_path / "smplx", pixie_model_dir=tmp_path / "pixie",
        anthropometry_dir=tmp_path / "anthropometry", output_dir=tmp_path / "output",
        max_upload_bytes=10 * 1024 * 1024, max_image_long_edge=1280,
        max_concurrent_scans=1, anny_max_iterations=60, anny_early_stop_delta=0.002,
        pose_landmarker_model_path=tmp_path / "pose_landmarker_lite.task", api_key=None, allowed_origins=(),
    )


def fitted_body_fixture() -> FittedAnnyBody:
    vertices = np.asarray([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], dtype=np.float32)
    faces = np.asarray([[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]], dtype=np.int64)
    return FittedAnnyBody(
        vertices=vertices, faces=faces, parameters={"height": 0.6, "weight": 0.55},
        measurements={"height_cm": 170.0, "bust_cm": 100.0, "waist_cm": 82.0, "hip_cm": 96.0, "inseam_cm": 76.0},
        initial_error=0.2, final_error=0.1, evaluations=3,
        guide_fractions={"chest": 0.7},
    )


def test_fitted_anny_pipeline_exports_validated_glb(tmp_path: Path, monkeypatch) -> None:
    settings = build_settings(tmp_path)
    monkeypatch.setattr(pipeline_module, "validate_pose", lambda *args, **kwargs: None)
    monkeypatch.setattr(BodyScanPipeline, "_anny_targets", staticmethod(
        lambda *args, **kwargs: ({"height_cm": 170.0, "bust_cm": 100.0, "waist_cm": 82.0}, {"view_height_difference": 0.01})
    ))
    monkeypatch.setattr(pipeline_module, "fit_anny_body", lambda *args, **kwargs: fitted_body_fixture())
    result = BodyScanPipeline(settings).process("scan-test-1", {"front": make_body_image(), "side": make_body_image()}, 170)
    assert result.status.value == "completed"
    assert result.reconstruction is not None and result.reconstruction.backend == "anny-clad-cpu"
    assert result.model is not None and result.model.size_bytes and result.model.size_bytes > 16
    assert {item.key for item in result.measurements} >= {"height", "chest_circumference", "waist_circumference", "hip_circumference"}
    assert all(item.source == "clad-body-fitted-anny" for item in result.measurements)
    assert (tmp_path / "output" / "scan-test-1.glb").is_file()
    exported = trimesh.load(str(tmp_path / "output" / "scan-test-1.glb"), force="mesh")
    assert float(exported.vertices[:, 1].max() - exported.vertices[:, 1].min()) == pytest.approx(1.7, abs=1e-5)
    assert result.reconstruction.scale_factor == pytest.approx(1.7, abs=1e-6)
    assert result.reconstruction.guide_fractions == {"chest": 0.7}
    assert next(item.value for item in result.measurements if item.key == "height") == 170.0


def test_guide_fractions_follow_clad_body_levels() -> None:
    levels = _guide_fractions({"_bust_pct": 71.62735, "_waist_pct": 59.0258, "_hip_pct": 49.3501})
    assert levels["chest"] == pytest.approx(0.71627)
    assert levels["waist"] == pytest.approx(0.59026)
    assert levels["hip"] == pytest.approx(0.4935)


def test_guide_geometry_comes_from_the_calibrated_mesh_and_glb_axes() -> None:
    mesh = trimesh.creation.cylinder(radius=0.3, height=1.7, sections=32)
    vertices = np.asarray(mesh.vertices, dtype=np.float32)
    vertices[:, 2] -= float(vertices[:, 2].min())
    geometry = _guide_geometry(vertices, np.asarray(mesh.faces, dtype=np.int64), {"chest": 0.7}, 170.0)
    contour = geometry["contours"]["chest"]
    assert contour["level_fraction"] == pytest.approx(0.7)
    assert contour["level_height_cm"] == pytest.approx(119.0)
    assert len(contour["points"]) >= 8
    # The provider serializes Anny Z-up [x, y, z] as GLB Y-up [x, z, -y].
    assert {round(point[1], 4) for point in contour["points"]} == {round(1.19, 4)}
    assert max(point[2] for point in contour["points"]) == pytest.approx(0.3, abs=0.02)
    assert min(point[2] for point in contour["points"]) == pytest.approx(-0.3, abs=0.02)


def test_validated_pose_seeds_opencv_silhouette(monkeypatch) -> None:
    monkeypatch.setenv("SUKATAI_PERSON_SEGMENTATION", "off")
    landmarks = {
        "nose": (0.50, 0.08, 1.0),
        "left_shoulder": (0.36, 0.18, 1.0), "right_shoulder": (0.64, 0.18, 1.0),
        "left_elbow": (0.27, 0.35, 1.0), "right_elbow": (0.73, 0.35, 1.0),
        "left_wrist": (0.27, 0.54, 1.0), "right_wrist": (0.73, 0.54, 1.0),
        "left_hip": (0.41, 0.55, 1.0), "right_hip": (0.59, 0.55, 1.0),
        "left_knee": (0.43, 0.63, 1.0), "right_knee": (0.57, 0.63, 1.0),
        "left_ankle": (0.43, 0.94, 1.0), "right_ankle": (0.57, 0.94, 1.0),
        "left_heel": (0.43, 0.96, 1.0), "right_heel": (0.57, 0.96, 1.0),
    }
    pose = PoseObservation("front", landmarks, 845.0, 134.0, 86.0)
    profile = extract_silhouette_profile(make_body_image(), "front", pose)
    assert profile.source == "mediapipe-opencv-grabcut"
    assert profile.height_px > profile.image_height * 0.5
    assert profile.width_at(0.5) > 0


def test_side_pose_allows_naturally_overlapping_projected_shoulders(monkeypatch, tmp_path: Path) -> None:
    class FakeMp:
        class ImageFormat:
            SRGB = "SRGB"

        @staticmethod
        def Image(**kwargs):
            return kwargs

    points = [SimpleNamespace(x=0.5, y=0.5, visibility=1.0) for _ in range(33)]
    points[0] = SimpleNamespace(x=0.5, y=0.2, visibility=1.0)
    points[11] = SimpleNamespace(x=0.48, y=0.3, visibility=1.0)
    points[12] = SimpleNamespace(x=0.49, y=0.3, visibility=1.0)
    points[23] = SimpleNamespace(x=0.47, y=0.5, visibility=1.0)
    points[24] = SimpleNamespace(x=0.485, y=0.5, visibility=1.0)
    for index in (27, 28):
        points[index] = SimpleNamespace(x=0.48, y=0.85, visibility=1.0)
    for index in (29, 30):
        points[index] = SimpleNamespace(x=0.48, y=0.87, visibility=1.0)

    class FakeLandmarker:
        def detect(self, _image):
            return SimpleNamespace(pose_landmarks=[points])

        def close(self):
            return None

    monkeypatch.setattr(pose_validator_module, "_load_landmarker", lambda _model_path: (FakeMp, FakeLandmarker()))
    observation = pose_validator_module.validate_pose("side", make_body_image(), tmp_path / "pose.task")
    assert observation.view == "side"
    assert observation.shoulder_width_px < observation.body_height_px
