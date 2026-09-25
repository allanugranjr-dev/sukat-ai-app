from __future__ import annotations

from enum import Enum
from typing import Any, Literal

import numpy as np

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ProcessingStatus(str, Enum):
    queued = "queued"
    validating = "validating"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class ScanQuality(str, Enum):
    good = "good"
    acceptable = "acceptable"
    poor = "poor"


class MeasurementMethod(str, Enum):
    anthropometry = "anthropometry"
    mesh = "mesh"
    circumference = "circumference"
    calibrated = "calibrated"
    estimated = "estimated"
    manually_corrected = "manually-corrected"


class MeasurementValue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(min_length=2, max_length=80, pattern=r"^[a-zA-Z0-9_ -]+$")
    value: float = Field(gt=0, lt=500)
    unit: Literal["cm"] = "cm"
    method: MeasurementMethod
    confidence: float | None = Field(default=None, ge=0, le=100)
    # A published value must identify where it came from. Confidence remains
    # nullable because the provider must not manufacture a percentage.
    source: str = Field(min_length=2, max_length=120)

    @field_validator("value")
    @classmethod
    def finite_value(cls, value: float) -> float:
        if value != value or value in (float("inf"), float("-inf")):
            raise ValueError("measurement value must be finite")
        return round(value, 2)


class ValidationIssue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=2, max_length=64)
    message: str = Field(min_length=2, max_length=300)
    view: str | None = Field(default=None, max_length=20)
    severity: Literal["error", "warning"] = "error"


class ModelArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    format: Literal["glb", "gltf"]
    url: str | None = None
    size_bytes: int | None = Field(default=None, ge=0)


class GuideContour(BaseModel):
    """One provider-authored closed contour in exported GLB coordinates."""

    model_config = ConfigDict(extra="forbid")

    level_fraction: float = Field(gt=0.05, lt=0.99)
    level_height_cm: float = Field(gt=0, le=500)
    points: list[tuple[float, float, float]] = Field(min_length=8, max_length=2048)
    source: str = Field(min_length=2, max_length=120)

    @field_validator("level_fraction", "level_height_cm")
    @classmethod
    def finite_level(cls, value: float) -> float:
        if not np.isfinite(value):
            raise ValueError("guide level must be finite")
        return round(value, 5)

    @field_validator("points")
    @classmethod
    def finite_points(cls, value: list[tuple[float, float, float]]) -> list[tuple[float, float, float]]:
        rounded: list[tuple[float, float, float]] = []
        for point in value:
            if any(not np.isfinite(coordinate) or abs(coordinate) > 100 for coordinate in point):
                raise ValueError("guide points must be finite and bounded")
            rounded.append(tuple(round(float(coordinate), 5) for coordinate in point))
        return rounded


class GuideLine(BaseModel):
    """One provider-authored dimension line in exported GLB coordinates.

    Length and breadth measurements (height, inseam, shoulder) cannot be shown
    as a horizontal circumference, so they are returned as a straight line that
    actually represents the measurement.
    """

    model_config = ConfigDict(extra="forbid")

    level_fraction: float = Field(ge=0, le=1.5)
    level_height_cm: float = Field(ge=0, le=500)
    points: list[tuple[float, float, float]] = Field(min_length=2, max_length=8)
    source: str = Field(min_length=2, max_length=120)

    @field_validator("level_fraction", "level_height_cm")
    @classmethod
    def finite_level(cls, value: float) -> float:
        if not np.isfinite(value):
            raise ValueError("guide level must be finite")
        return round(value, 5)

    @field_validator("points")
    @classmethod
    def finite_points(cls, value: list[tuple[float, float, float]]) -> list[tuple[float, float, float]]:
        rounded: list[tuple[float, float, float]] = []
        for point in value:
            if any(not np.isfinite(coordinate) or abs(coordinate) > 100 for coordinate in point):
                raise ValueError("guide points must be finite and bounded")
            rounded.append(tuple(round(float(coordinate), 5) for coordinate in point))
        return rounded


class GuideGeometry(BaseModel):
    """Coordinate contract shared by the provider mesh and the browser viewer."""

    model_config = ConfigDict(extra="forbid")

    coordinate_system: Literal["glb-y-up-right-handed"]
    units: Literal["m"]
    up_axis: Literal["y"]
    calibrated_height_cm: float = Field(gt=0, le=500)
    contours: dict[str, GuideContour] = Field(default_factory=dict)
    lines: dict[str, GuideLine] = Field(default_factory=dict)

    @field_validator("calibrated_height_cm")
    @classmethod
    def finite_height(cls, value: float) -> float:
        if not np.isfinite(value):
            raise ValueError("calibrated guide height must be finite")
        return round(value, 5)

    @field_validator("contours", "lines")
    @classmethod
    def valid_guide_keys(cls, value: dict[str, object]) -> dict[str, object]:
        for key in value:
            if not key or not key.replace("_", "").isalnum() or not key[0].islower():
                raise ValueError("guide keys must be named body levels")
        return value


class OverlayView(BaseModel):
    """Pixel dimensions of one resized source image the overlay is drawn on."""

    model_config = ConfigDict(extra="forbid")

    width_px: int = Field(gt=0, le=4096)
    height_px: int = Field(gt=0, le=4096)


class OverlayLine(BaseModel):
    """One image-normalized guide line showing where a measurement was taken.

    Coordinates are normalized to [0, 1] on the tagged view's resized pixel
    dimensions (top-left origin, y-down). The value itself remains the
    provider's source of truth; this line only visualizes where it was measured.
    """

    model_config = ConfigDict(extra="forbid")

    view: Literal["front", "side"]
    kind: Literal["circumference", "length", "width"]
    points: list[tuple[float, float]] = Field(min_length=2, max_length=8)
    level_fraction: float | None = Field(default=None, ge=0, le=1.5)
    source: str = Field(min_length=2, max_length=120)

    @field_validator("points")
    @classmethod
    def finite_points(cls, value: list[tuple[float, float]]) -> list[tuple[float, float]]:
        rounded: list[tuple[float, float]] = []
        for point in value:
            if len(point) != 2 or any(
                not np.isfinite(coordinate) or coordinate < 0.0 or coordinate > 1.0
                for coordinate in point
            ):
                raise ValueError("overlay points must be finite and within [0,1]")
            rounded.append(tuple(round(float(coordinate), 5) for coordinate in point))
        return rounded


class OverlayGeometry(BaseModel):
    """Image-space overlay contract shared by the AI service and the photo viewer."""

    model_config = ConfigDict(extra="forbid")

    coordinate_system: Literal["image-normalized"]
    origin: Literal["top-left"]
    views: dict[str, OverlayView] = Field(default_factory=dict)
    lines: dict[str, OverlayLine] = Field(default_factory=dict)

    @field_validator("views", "lines")
    @classmethod
    def valid_overlay_keys(cls, value: dict[str, object]) -> dict[str, object]:
        for key in value:
            if not key or not key.replace("_", "").isalnum() or not key[0].islower():
                raise ValueError("overlay keys must be named views or body levels")
        return value

    @model_validator(mode="after")
    def views_cover_lines(self) -> "OverlayGeometry":
        for key, line in self.lines.items():
            if line.view not in self.views:
                raise ValueError(
                    f"overlay line '{key}' references view '{line.view}' absent from views"
                )
        return self


class ReconstructionMetadata(BaseModel):
    model_config = ConfigDict(extra="allow")

    backend: str
    device: str
    views_used: list[str]
    calibrated_height_cm: float
    mesh_height_cm_before_calibration: float
    scale_factor: float
    sex: Literal["male", "female", "neutral"] | None = None
    guide_fractions: dict[str, float] = Field(default_factory=dict)
    guide_geometry: GuideGeometry | None = None
    overlay_geometry: OverlayGeometry | None = None


class BodyScanResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scan_id: str
    status: ProcessingStatus
    progress: int = Field(default=0, ge=0, le=100)
    status_message: str | None = Field(default=None, max_length=240)
    error_code: str | None = Field(default=None, max_length=80)
    status_url: str | None = Field(default=None, max_length=500)
    scan_quality: ScanQuality
    quality_issues: list[ValidationIssue] = Field(default_factory=list)
    measurements: list[MeasurementValue] = Field(default_factory=list)
    model: ModelArtifact | None = None
    reconstruction: ReconstructionMetadata | None = None
    processing_version: str

    @field_validator("measurements")
    @classmethod
    def unique_keys(cls, values: list[MeasurementValue]) -> list[MeasurementValue]:
        keys = [item.key.casefold() for item in values]
        if len(keys) != len(set(keys)):
            raise ValueError("provider response contains duplicate measurement keys")
        return values


class ServiceHealth(BaseModel):
    status: Literal["ok", "degraded"]
    service: str
    assets: dict[str, Any]
    optional_dependencies: dict[str, bool]


class ErrorResponse(BaseModel):
    error: str
    code: str
    details: list[ValidationIssue] = Field(default_factory=list)
