from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

import numpy as np


class ModelAssetError(RuntimeError):
    """Raised when a licensed model/checkpoint is not installed."""


class ReconstructionError(RuntimeError):
    """Raised when a configured reconstruction backend cannot process views."""


@dataclass(frozen=True)
class ReconstructionResult:
    vertices: np.ndarray
    faces: np.ndarray
    shape_parameters: dict[str, Any] = field(default_factory=dict)
    pose_parameters: dict[str, Any] = field(default_factory=dict)
    landmarks: dict[str, int] = field(default_factory=dict)
    backend: str = "unknown"
    views_used: tuple[str, ...] = ()
    metadata: dict[str, Any] = field(default_factory=dict)


class BodyReconstructor(Protocol):
    def reconstruct(self, images: dict[str, bytes]) -> ReconstructionResult:
        ...
