from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from app.reconstruction.base import ModelAssetError, ReconstructionError


class SmplxAdapter:
    """Convert PIXIE/SMPL-X parameters to a mesh when official assets exist."""

    def __init__(self, model_dir: Path, device: str = "cpu"):
        self.model_dir = Path(model_dir)
        self.device = device

    def readiness(self) -> dict[str, Any]:
        files = [path for path in self.model_dir.rglob("*") if path.is_file()] if self.model_dir.is_dir() else []
        model_files = [path for path in files if path.suffix.lower() in {".npz", ".pkl"}]
        return {"ready": bool(model_files), "path": str(self.model_dir), "model_count": len(model_files)}

    def mesh_from_parameters(self, parameters: dict[str, Any], gender: str = "NEUTRAL") -> tuple[np.ndarray, np.ndarray]:
        if not self.readiness()["ready"]:
            raise ModelAssetError("SMPL-X model asset not installed. See ai-service/MODEL_SETUP.md")
        try:
            import torch  # type: ignore
            import smplx  # type: ignore
        except ImportError as error:
            raise ReconstructionError("The SMPL-X Python package and PyTorch are required for mesh generation.") from error

        try:
            model = smplx.create(
                str(self.model_dir),
                model_type="smplx",
                gender=gender.lower(),
                use_pca=False,
                batch_size=1,
            ).to(self.device)
            tensor_parameters = {
                key: torch.as_tensor(value, dtype=torch.float32, device=self.device).reshape(1, -1)
                for key, value in parameters.items()
                if key in {"betas", "global_orient", "body_pose", "left_hand_pose", "right_hand_pose", "jaw_pose", "expression"}
            }
            with torch.no_grad():
                output = model(return_verts=True, **tensor_parameters)
            return output.vertices.detach().cpu().numpy().squeeze(0), np.asarray(model.faces, dtype=np.int32)
        except ModelAssetError:
            raise
        except Exception as error:
            raise ReconstructionError(f"SMPL-X mesh generation failed: {error}") from error
