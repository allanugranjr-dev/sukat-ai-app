from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from app.reconstruction.base import ModelAssetError, ReconstructionError, ReconstructionResult


PixieRunner = Callable[[dict[str, bytes], str], dict[str, Any]]


class PixieAdapter:
    """Small boundary around PIXIE's single-view regression API.

    PIXIE's official repository and checkpoints have their own dependency and
    licensing requirements. The adapter deliberately does not import PIXIE at
    module import time; the web/API service can therefore run diagnostics and
    validate uploads on CPU without loading a protected checkpoint.
    """

    def __init__(self, model_dir: Path, device: str = "cpu", runner: PixieRunner | None = None):
        self.model_dir = Path(model_dir)
        self.device = device
        self.runner = runner

    def readiness(self) -> dict[str, Any]:
        files = [path for path in self.model_dir.rglob("*") if path.is_file()] if self.model_dir.is_dir() else []
        checkpoints = [path for path in files if path.suffix.lower() in {".pt", ".pth", ".pkl", ".tar"}]
        return {
            "ready": bool(checkpoints),
            "path": str(self.model_dir),
            "checkpoint_count": len(checkpoints),
        }

    def reconstruct(self, images: dict[str, bytes]) -> ReconstructionResult:
        if not self.readiness()["ready"]:
            raise ModelAssetError("PIXIE model asset not installed. See ai-service/MODEL_SETUP.md")
        if self.runner is None:
            raise ReconstructionError(
                "PIXIE assets are present, but no compatible PIXIE runner is configured. "
                "Install the pinned adapter dependencies described in ai-service/MODEL_SETUP.md."
            )
        try:
            raw = self.runner(images, self.device)
        except Exception as error:  # keep model-specific errors behind the service boundary
            raise ReconstructionError(f"PIXIE reconstruction failed: {error}") from error
        required = ("vertices", "faces")
        if any(key not in raw for key in required):
            raise ReconstructionError("PIXIE adapter returned no mesh vertices/faces")
        return ReconstructionResult(
            vertices=raw["vertices"],
            faces=raw["faces"],
            shape_parameters=raw.get("shape_parameters", {}),
            pose_parameters=raw.get("pose_parameters", {}),
            landmarks=raw.get("landmarks", {}),
            backend="pixie",
            views_used=tuple(raw.get("views_used", images.keys())),
            metadata={"device": self.device, **raw.get("metadata", {})},
        )
