from __future__ import annotations

from pathlib import Path

import numpy as np
import pydantic
import pytest

import app.pipeline as pipeline_module
from app.fitting.anny_fitter import FittedAnnyBody
from app.pipeline import BodyScanPipeline, _overlay_geometry
from app.reconstruction.silhouette import ResolvedSilhouetteProfiles, SilhouetteProfile
from app.schemas.api import OverlayGeometry
from helpers import make_body_image
from test_silhouette_pipeline import build_settings, fitted_body_fixture


def _valid_overlay_dict() -> dict:
    """A minimal well-formed overlay dict shaped exactly like _overlay_geometry()."""
    return {
        "coordinate_system": "image-normalized",
        "origin": "top-left",
        "views": {"front": {"width_px": 200, "height_px": 120}},
        "lines": {
            "waist_circumference": {
                "view": "front",
                "kind": "circumference",
                "points": [(0.1, 0.5), (0.6, 0.5)],
                "level_fraction": 0.65,
                "source": "silhouette-width-span",
            }
        },
    }


def _profile(
    view: str,
    *,
    center_width: float,
    full_width: float | None = None,
    top: int = 0,
    bottom: int = 100,
    left: int = 20,
    right: int = 80,
    image_width: int = 200,
    image_height: int = 120,
) -> SilhouetteProfile:
    """Construct a SilhouetteProfile with constant per-row widths for exact math."""

    rows = bottom - top + 1
    full = np.full(rows, float(full_width if full_width is not None else center_width), dtype=np.float32)
    center = np.full(rows, float(center_width), dtype=np.float32)
    return SilhouetteProfile(
        view=view,
        row_full_width=full,
        row_center_width=center,
        top=top,
        bottom=bottom,
        left=left,
        right=right,
        image_width=image_width,
        image_height=image_height,
        source="unit-fixture",
    )


def _fixture_with_upper_arm() -> FittedAnnyBody:
    body = fitted_body_fixture()
    measurements = dict(body.measurements)
    measurements["upperarm_cm"] = 30.0
    measurements["thigh_cm"] = 54.0
    measurements["shoulder_width_cm"] = 42.0
    return FittedAnnyBody(
        vertices=body.vertices,
        faces=body.faces,
        parameters=body.parameters,
        measurements=measurements,
        initial_error=body.initial_error,
        final_error=body.final_error,
        evaluations=body.evaluations,
        guide_fractions=body.guide_fractions,
    )


def test_overlay_present_with_dims(tmp_path: Path, monkeypatch) -> None:
    """A full pipeline run attaches a truthful, dimensioned waist overlay line.

    ``_anny_targets`` runs for real (colour-distance silhouette on the synthetic
    body image), so this exercises the end-to-end wiring: the resolved profiles
    are handed back into ``process()`` and drawn into ``reconstruction.overlay_geometry``.
    """

    settings = build_settings(tmp_path)
    monkeypatch.setattr(pipeline_module, "validate_pose", lambda *args, **kwargs: None)
    monkeypatch.setattr(pipeline_module, "fit_anny_body", lambda *args, **kwargs: fitted_body_fixture())

    result = BodyScanPipeline(settings).process(
        "overlay-scan-1",
        {"front": make_body_image(), "side": make_body_image()},
        170,
    )

    assert result.status.value == "completed"
    overlay = result.reconstruction.model_dump()["overlay_geometry"]
    assert overlay["coordinate_system"] == "image-normalized"
    assert overlay["origin"] == "top-left"

    line = overlay["lines"]["waist_circumference"]
    assert len(line["points"]) == 2
    assert "view" in line
    assert line["kind"] == "circumference"

    view_dims = overlay["views"][line["view"]]
    assert isinstance(view_dims["width_px"], int)
    assert isinstance(view_dims["height_px"], int)
    assert view_dims["width_px"] > 0 and view_dims["height_px"] > 0


def test_endpoints_match_silhouette() -> None:
    front = _profile("front", center_width=60.0)
    side = _profile("side", center_width=40.0)
    fraction = 0.70
    overlay = _overlay_geometry(front, side, {"chest": fraction}, 170.0)

    line = overlay["lines"]["chest_circumference"]
    assert line["kind"] == "circumference"
    view_dims = overlay["views"][line["view"]]
    width_px = view_dims["width_px"]
    height_px = view_dims["height_px"]

    (x0, y0), (x1, y1) = line["points"]
    for coordinate in (x0, y0, x1, y1):
        assert np.isfinite(coordinate)
        assert 0.0 <= coordinate <= 1.0

    # Horizontal span reproduces width_at(fraction), centered on (left+right)/2.
    assert (x1 - x0) * width_px == pytest.approx(front.width_at(fraction, center=True), abs=0.01)
    midpoint_px = (x0 + x1) / 2.0 * width_px
    assert midpoint_px == pytest.approx((front.left + front.right) / 2.0, abs=0.01)
    # Row placement follows bottom - fraction*height_px on the profile's rows.
    assert y0 == pytest.approx(y1, abs=1e-9)
    assert y0 * height_px == pytest.approx(round(front.bottom - fraction * front.height_px), abs=0.05)


def test_view_tag_follows_submitted_slot(tmp_path: Path, monkeypatch) -> None:
    # Submitted "front" is narrower than submitted "side" => analysis swap:
    # resolved.front is the profile whose .view == "side".
    submitted_front = _profile("front", center_width=30.0, left=35, right=65)
    submitted_side = _profile("side", center_width=60.0, left=20, right=80)
    resolved = ResolvedSilhouetteProfiles(
        submitted_front=submitted_front,
        submitted_side=submitted_side,
        front=submitted_side,
        side=submitted_front,
        view_assignment="width-based front-side swap",
    )
    assert resolved.front.view == "side"

    settings = build_settings(tmp_path)
    monkeypatch.setattr(pipeline_module, "validate_pose", lambda *args, **kwargs: None)
    monkeypatch.setattr(BodyScanPipeline, "_anny_targets", staticmethod(
        lambda *args, **kwargs: (
            {"height_cm": 170.0, "bust_cm": 100.0, "waist_cm": 82.0, "hip_cm": 96.0},
            {"view_height_difference": 0.01},
            resolved,
        )
    ))
    monkeypatch.setattr(pipeline_module, "fit_anny_body", lambda *args, **kwargs: fitted_body_fixture())

    result = BodyScanPipeline(settings).process(
        "overlay-swap-1",
        {"front": make_body_image(), "side": make_body_image()},
        170,
    )
    overlay = result.reconstruction.model_dump()["overlay_geometry"]
    assert overlay["lines"], "expected at least one drawn line"
    for line in overlay["lines"].values():
        assert line["view"] == resolved.front.view == "side"


def test_unanchorable_line_omitted(tmp_path: Path, monkeypatch) -> None:
    # A silhouette with zero body width at every level: no circumference/width
    # line can be anchored, so those lines are omitted (D-02).
    zero_front = _profile("front", center_width=0.0, full_width=0.0)
    resolved = ResolvedSilhouetteProfiles(
        submitted_front=zero_front,
        submitted_side=zero_front,
        front=zero_front,
        side=zero_front,
        view_assignment="submitted",
    )
    settings = build_settings(tmp_path)
    monkeypatch.setattr(pipeline_module, "validate_pose", lambda *args, **kwargs: None)
    monkeypatch.setattr(BodyScanPipeline, "_anny_targets", staticmethod(
        lambda *args, **kwargs: (
            {"height_cm": 170.0, "bust_cm": 100.0, "waist_cm": 82.0, "hip_cm": 96.0},
            {"view_height_difference": 0.01},
            resolved,
        )
    ))
    monkeypatch.setattr(pipeline_module, "fit_anny_body", lambda *args, **kwargs: _fixture_with_upper_arm())

    result = BodyScanPipeline(settings).process(
        "overlay-omit-1",
        {"front": make_body_image(), "side": make_body_image()},
        170,
    )
    overlay = result.reconstruction.model_dump()["overlay_geometry"]
    assert "waist_circumference" not in overlay["lines"]
    assert "upper_arm" not in overlay["lines"]

    measurement_keys = {item.key for item in result.measurements}
    assert {"waist_circumference", "upper_arm"} <= measurement_keys


def test_upper_arm_never_drawn() -> None:
    front = _profile("front", center_width=60.0, full_width=120.0)
    side = _profile("side", center_width=40.0, full_width=80.0)
    overlay = _overlay_geometry(front, side, {"upper_arm": 0.67}, 170.0)
    assert "upper_arm" not in overlay["lines"]


def test_cpu_only_no_reresolve(tmp_path: Path, monkeypatch) -> None:
    calls = {"count": 0}
    real_resolve = pipeline_module.resolve_front_side_profiles

    def counting_resolve(*args, **kwargs):
        calls["count"] += 1
        return real_resolve(*args, **kwargs)

    settings = build_settings(tmp_path)
    monkeypatch.setattr(pipeline_module, "validate_pose", lambda *args, **kwargs: None)
    monkeypatch.setattr(pipeline_module, "resolve_front_side_profiles", counting_resolve)
    monkeypatch.setattr(pipeline_module, "fit_anny_body", lambda *args, **kwargs: fitted_body_fixture())

    result = BodyScanPipeline(settings).process(
        "overlay-cpu-1",
        {"front": make_body_image(), "side": make_body_image()},
        170,
    )
    assert calls["count"] == 1
    assert result.reconstruction.device == "cpu"


def test_schema_accepts_valid_overlay() -> None:
    """A well-formed overlay dict constructs an OverlayGeometry and round-trips."""
    overlay = OverlayGeometry(**_valid_overlay_dict())

    assert overlay.coordinate_system == "image-normalized"
    assert overlay.origin == "top-left"
    assert overlay.views["front"].width_px == 200
    assert overlay.views["front"].height_px == 120

    line = overlay.lines["waist_circumference"]
    assert line.view == "front"
    assert line.kind == "circumference"
    assert line.level_fraction == pytest.approx(0.65)
    assert len(line.points) == 2

    dumped = overlay.model_dump()
    assert dumped["coordinate_system"] == "image-normalized"
    (x0, y0), (x1, y1) = dumped["lines"]["waist_circumference"]["points"]
    assert (x0, y0, x1, y1) == pytest.approx((0.1, 0.5, 0.6, 0.5))


def test_malformed_rejected() -> None:
    """Non-finite / out-of-[0,1] points and a line.view absent from views raise."""

    def _overlay_with_first_point(point) -> dict:
        overlay = _valid_overlay_dict()
        overlay["lines"]["waist_circumference"]["points"] = [point, (0.6, 0.5)]
        return overlay

    for bad_point in [
        (float("nan"), 0.5),
        (float("inf"), 0.5),
        (1.5, 0.5),
        (-0.1, 0.5),
    ]:
        with pytest.raises(pydantic.ValidationError):
            OverlayGeometry(**_overlay_with_first_point(bad_point))

    # A line whose view has no matching key in views is rejected.
    missing_view = _valid_overlay_dict()
    missing_view["lines"]["waist_circumference"]["view"] = "side"
    with pytest.raises(pydantic.ValidationError):
        OverlayGeometry(**missing_view)


def test_malformed_rejected_is_clean_502(tmp_path: Path, monkeypatch) -> None:
    """A malformed overlay dict surfaces as PipelineFailure(502), never a raw 500."""
    settings = build_settings(tmp_path)
    monkeypatch.setattr(pipeline_module, "validate_pose", lambda *args, **kwargs: None)
    monkeypatch.setattr(pipeline_module, "fit_anny_body", lambda *args, **kwargs: fitted_body_fixture())

    def _overlay_with_nan(*args, **kwargs) -> dict:
        overlay = _valid_overlay_dict()
        overlay["lines"]["waist_circumference"]["points"] = [(float("nan"), 0.5), (0.6, 0.5)]
        return overlay

    monkeypatch.setattr(pipeline_module, "_overlay_geometry", _overlay_with_nan)

    with pytest.raises(pipeline_module.PipelineFailure) as excinfo:
        BodyScanPipeline(settings).process(
            "overlay-bad-1",
            {"front": make_body_image(), "side": make_body_image()},
            170,
        )
    assert excinfo.value.code == "INVALID_PROVIDER_RESULT"
    assert excinfo.value.status_code == 502

