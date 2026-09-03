from __future__ import annotations

import numpy as np
import pytest

from app.measurements.calibration import CalibrationError, calibrate_vertices, mesh_height


def test_calibration_scales_mesh_to_submitted_height() -> None:
    vertices = np.asarray([[0, -2, 0], [1, 8, 0], [0, 3, 2]], dtype=float)
    result = calibrate_vertices(vertices, 170)
    assert mesh_height(result.vertices) == pytest.approx(170)
    assert result.vertices[:, 1].min() == pytest.approx(0)
    assert result.scale_factor == pytest.approx(17)


def test_calibration_rejects_degenerate_mesh() -> None:
    with pytest.raises(CalibrationError):
        mesh_height(np.zeros((3, 3)))
