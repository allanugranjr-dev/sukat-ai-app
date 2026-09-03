from __future__ import annotations

from pathlib import Path
import sys
from typing import Any

import numpy as np

from app.reconstruction.base import ModelAssetError, ReconstructionError


class AnthropometryAdapter:
    """Adapter for the upstream SMPL-Anthropometry package.

    The upstream project documents measurements for a neutral T-pose. This
    adapter only calls it for the finalized mesh and preserves the source
    label so callers can distinguish upstream values from custom estimates.
    """

    def __init__(self, package_dir: Path):
        self.package_dir = Path(package_dir)

    def readiness(self) -> dict[str, Any]:
        ready = (self.package_dir / "measure.py").is_file() and (self.package_dir / "measurement_definitions.py").is_file()
        return {"ready": ready, "path": str(self.package_dir)}

    def measure(self, vertices: np.ndarray) -> dict[str, dict[str, Any]]:
        if not self.readiness()["ready"]:
            raise ModelAssetError("SMPL-Anthropometry source is not installed. See ai-service/MODEL_SETUP.md")
        package_path = str(self.package_dir.resolve())
        if package_path not in sys.path:
            sys.path.insert(0, package_path)
        try:
            from measure import MeasureBody  # type: ignore

            measurer = MeasureBody("smplx")
            measurer.from_verts(verts=np.asarray(vertices, dtype=np.float32))
            names = list(measurer.all_possible_measurements)
            measurer.measure(names)
            labeled = getattr(measurer, "labeled_measurements", {}) or {}
            raw = labeled or getattr(measurer, "measurements", {}) or {}
        except Exception as error:
            raise ReconstructionError(f"SMPL-Anthropometry failed: {error}") from error

        result: dict[str, dict[str, Any]] = {}
        for key, value in raw.items():
            try:
                numeric = float(value)
            except (TypeError, ValueError):
                continue
            if np.isfinite(numeric) and numeric > 0:
                result[str(key)] = {"value": numeric, "method": "anthropometry", "source": "SMPL-Anthropometry"}
        if not result:
            raise ReconstructionError("SMPL-Anthropometry returned no usable measurements")
        return result
