from __future__ import annotations

from dataclasses import dataclass

import numpy as np


class CalibrationError(ValueError):
    pass


@dataclass(frozen=True)
class CalibrationResult:
    vertices: np.ndarray
    estimated_height: float
    target_height: float
    scale_factor: float


def mesh_height(vertices: np.ndarray, axis: int = 1) -> float:
    values = np.asarray(vertices, dtype=np.float64)
    if values.ndim != 2 or values.shape[1] != 3 or values.shape[0] < 2:
        raise CalibrationError("mesh vertices must be an N × 3 array with at least two points")
    if axis not in (0, 1, 2):
        raise CalibrationError("mesh axis must be 0, 1, or 2")
    height = float(values[:, axis].max() - values[:, axis].min())
    if not np.isfinite(height) or height <= 0:
        raise CalibrationError("mesh height must be finite and greater than zero")
    return height


def calibrate_vertices(vertices: np.ndarray, height_cm: float, axis: int = 1) -> CalibrationResult:
    if not np.isfinite(height_cm) or not 0 < height_cm < 500:
        raise CalibrationError("target height must be a finite value between 0 and 500 cm")
    values = np.asarray(vertices, dtype=np.float64)
    estimated = mesh_height(values, axis)
    factor = float(height_cm / estimated)
    scaled = values * factor
    minimum = float(scaled[:, axis].min())
    scaled[:, axis] -= minimum
    return CalibrationResult(vertices=scaled, estimated_height=estimated, target_height=float(height_cm), scale_factor=factor)
