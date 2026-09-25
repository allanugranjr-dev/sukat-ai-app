from __future__ import annotations

from pathlib import Path

import app.pipeline as pipeline_module
from app.pipeline import BodyScanPipeline
from helpers import make_body_image
from test_silhouette_pipeline import build_settings, fitted_body_fixture


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
