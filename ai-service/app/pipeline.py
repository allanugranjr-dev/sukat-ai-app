from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any, Callable

import numpy as np

from app.core.config import Settings
from app.fitting.anny_fitter import AnnyFittingError, fit_anny_body
from app.measurements.tailoring import tailoring_measurements
from app.reconstruction.mesh_exporter import export_glb
from app.reconstruction.base import ReconstructionError
from app.reconstruction.silhouette import resolve_front_side_profiles
from app.schemas.api import (
    BodyScanResponse,
    MeasurementValue,
    ProcessingStatus,
    ReconstructionMetadata,
    ScanQuality,
    ValidationIssue,
)
from app.validation.image_validator import ImageValidationError, validate_views
from app.validation.pose_validator import PoseObservation, PoseValidationError, validate_pose


SAFE_SCAN_ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
PROCESSING_VERSION = "sukatai-anny-clad-v1"


class PipelineFailure(RuntimeError):
    """A user-safe pipeline error with a stable API code and HTTP status."""

    def __init__(
        self,
        message: str,
        code: str = "PROCESSING_FAILED",
        status_code: int = 500,
        issues: tuple[ValidationIssue, ...] = (),
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.issues = issues

    def __str__(self) -> str:
        return self.message


def _issue(code: str, message: str, severity: str = "warning", view: str | None = None) -> ValidationIssue:
    return ValidationIssue(code=code, message=message, severity=severity, view=view)


def _measurement_values(raw: list[dict[str, Any]]) -> list[MeasurementValue]:
    try:
        return [MeasurementValue(**value) for value in raw]
    except Exception as error:
        raise PipelineFailure(f"The measurement adapter returned an invalid value: {error}", "INVALID_PROVIDER_RESULT", 502) from error


def _guide_fractions(measurements: dict[str, Any]) -> dict[str, float]:
    """Expose CLAD's measured body levels so the browser can place guides."""
    # Do not invent head/neck or any other mannequin landmarks. A level is
    # published only when CLAD returned the corresponding provider landmark.
    levels: dict[str, float] = {}
    source_keys = {
        "chest": "_bust_pct",
        "waist": "_waist_pct",
        "hip": "_hip_pct",
        "thigh": "_thigh_pct",
        "calf": "_calf_pct",
        "upper_arm": "_upperarm_pct",
        "wrist": "_wrist_pct",
    }
    for guide_key, source_key in source_keys.items():
        raw_value = measurements.get(source_key)
        try:
            fraction = float(raw_value) / 100.0
        except (TypeError, ValueError):
            continue
        if np.isfinite(fraction) and 0.05 < fraction < 0.99:
            levels[guide_key] = round(fraction, 5)
    return levels


def _point_key(point: np.ndarray) -> tuple[int, int, int]:
    return tuple(np.rint(np.asarray(point, dtype=np.float64) / 1e-5).astype(np.int64).tolist())


def _polygon_area_xy(points: list[np.ndarray]) -> float:
    if len(points) < 3:
        return 0.0
    coordinates = np.asarray(points, dtype=np.float64)
    return float(abs(np.sum(coordinates[:, 0] * np.roll(coordinates[:, 1], -1) - np.roll(coordinates[:, 0], -1) * coordinates[:, 1])) * 0.5)


def _mesh_plane_contour(vertices: np.ndarray, faces: np.ndarray, level_z: float) -> list[np.ndarray] | None:
    """Extract the largest closed horizontal contour from the fitted mesh.

    The contour is generated from the same calibrated vertices and faces that
    are exported to the GLB. It is therefore a provider geometry fact, not an
    ellipse reconstructed from a displayed measurement value.
    """
    if len(vertices) < 3 or len(faces) < 1 or not np.isfinite(level_z):
        return None
    epsilon = 1e-6
    nodes: dict[tuple[int, int, int], np.ndarray] = {}
    adjacency: dict[tuple[int, int, int], set[tuple[int, int, int]]] = {}
    edges: set[tuple[tuple[int, int, int], tuple[int, int, int]]] = set()

    def add_point(point: np.ndarray) -> tuple[int, int, int]:
        normalized = np.asarray(point, dtype=np.float64)
        key = _point_key(normalized)
        nodes.setdefault(key, normalized.copy())
        adjacency.setdefault(key, set())
        return key

    for face in np.asarray(faces, dtype=np.int64):
        if len(face) < 3 or np.any(face < 0) or np.any(face >= len(vertices)):
            continue
        triangle = np.asarray(vertices[face[:3], :3], dtype=np.float64)
        distances = triangle[:, 2] - level_z
        intersections: list[np.ndarray] = []
        for start_index, end_index in ((0, 1), (1, 2), (2, 0)):
            start = triangle[start_index]
            end = triangle[end_index]
            start_distance = float(distances[start_index])
            end_distance = float(distances[end_index])
            if abs(start_distance) <= epsilon:
                intersections.append(start)
            if abs(end_distance) <= epsilon:
                intersections.append(end)
            if (start_distance < -epsilon and end_distance > epsilon) or (start_distance > epsilon and end_distance < -epsilon):
                blend = start_distance / (start_distance - end_distance)
                intersections.append(start + (end - start) * blend)
        unique: list[np.ndarray] = []
        seen: set[tuple[int, int, int]] = set()
        for point in intersections:
            key = _point_key(point)
            if key not in seen:
                seen.add(key)
                unique.append(point)
        if len(unique) < 2:
            continue
        # A non-degenerate triangle intersects a plane in one segment. If a
        # vertex lies exactly on the plane, connect the unique intersection to
        # the other point(s) so the graph remains traversable.
        start_key = add_point(unique[0])
        for point in unique[1:]:
            end_key = add_point(point)
            if start_key == end_key:
                continue
            edge = (start_key, end_key) if start_key < end_key else (end_key, start_key)
            if edge in edges:
                continue
            edges.add(edge)
            adjacency[start_key].add(end_key)
            adjacency[end_key].add(start_key)

    if not nodes:
        return None

    visited: set[tuple[tuple[int, int, int], tuple[int, int, int]]] = set()
    candidates: list[list[np.ndarray]] = []

    def edge_key(start: tuple[int, int, int], end: tuple[int, int, int]) -> tuple[tuple[int, int, int], tuple[int, int, int]]:
        return (start, end) if start < end else (end, start)

    for start_key, neighbours in adjacency.items():
        for first_key in neighbours:
            first_edge = edge_key(start_key, first_key)
            if first_edge in visited:
                continue
            visited.add(first_edge)
            points = [nodes[start_key]]
            previous_key = start_key
            current_key = first_key
            closed = False
            for _ in range(len(nodes) + 2):
                if current_key == start_key:
                    closed = True
                    break
                points.append(nodes[current_key])
                next_keys = [key for key in adjacency[current_key] if key != previous_key]
                if not next_keys:
                    break
                next_key = next((key for key in next_keys if edge_key(current_key, key) not in visited), next_keys[0])
                visited.add(edge_key(current_key, next_key))
                previous_key, current_key = current_key, next_key
            if closed and len(points) >= 8 and _polygon_area_xy(points) > 1e-7:
                candidates.append(points)

    if not candidates:
        return None
    contour = max(candidates, key=_polygon_area_xy)
    if len(contour) > 2048:
        sample_indices = np.linspace(0, len(contour) - 1, 2048, dtype=np.int64)
        contour = [contour[int(index)] for index in sample_indices]
    return contour


def _guide_geometry(vertices: np.ndarray, faces: np.ndarray, guide_fractions: dict[str, float], height_cm: float) -> dict[str, Any]:
    """Return provider-authored contours in the exported GLB coordinate system."""
    height_m = float(height_cm) / 100.0
    contours: dict[str, Any] = {}
    for key, raw_fraction in guide_fractions.items():
        fraction = float(raw_fraction)
        if not np.isfinite(fraction) or not 0.05 < fraction < 0.99:
            continue
        contour = _mesh_plane_contour(vertices, faces, fraction * height_m)
        if contour is None:
            continue
        # export_glb converts Anny's Z-up [x, y, z] to GLB Y-up [x, z, -y].
        points = [(round(float(point[0]), 5), round(float(point[2]), 5), round(float(-point[1]), 5)) for point in contour]
        contours[key] = {
            "level_fraction": round(fraction, 5),
            "level_height_cm": round(fraction * float(height_cm), 5),
            "points": points,
            "source": "provider-mesh-plane-intersection",
        }
    return {
        "coordinate_system": "glb-y-up-right-handed",
        "units": "m",
        "up_axis": "y",
        "calibrated_height_cm": round(float(height_cm), 5),
        "contours": contours,
    }


class BodyScanPipeline:
    """Application service for CPU image validation, Anny fitting, CLAD, and export."""

    def __init__(self, settings: Settings | None = None):
        self.settings = settings or Settings.from_env()

    @staticmethod
    def _anny_targets(
        images: dict[str, bytes],
        height_cm: float,
        pose_observations: dict[str, PoseObservation] | None = None,
    ) -> tuple[dict[str, float], dict[str, Any]]:
        """Derive fitting targets from two calibrated silhouettes.

        These values are never returned as customer measurements. They only
        constrain Anny; CLAD measures the fitted mesh afterward.
        """
        resolved = resolve_front_side_profiles(images, pose_observations)
        front, side = resolved.front, resolved.side
        if "prior" in front.source.lower() or "prior" in side.source.lower():
            raise PipelineFailure(
                "A reliable person silhouette could not be extracted from both views.",
                "SILHOUETTE_UNRELIABLE",
                422,
            )
        scale_difference = abs(front.height_px - side.height_px) / max(front.height_px, side.height_px)
        if scale_difference > 0.12:
            raise PipelineFailure(
                "Front and side views have inconsistent body scale. Retake both photos from the same distance.",
                "VIEW_SCALE_MISMATCH",
                422,
            )
        estimated = tailoring_measurements(front, side, height_cm)
        by_key = {item["key"]: float(item["value"]) for item in estimated if item.get("value")}
        aliases = {
            "chest_circumference": "bust_cm",
            "waist_circumference": "waist_cm",
            "hip_circumference": "hip_cm",
            "thigh_left_circumference": "thigh_cm",
            "upper_arm": "upperarm_cm",
            "shoulder": "shoulder_width_cm",
            "inseam": "inseam_cm",
        }
        targets = {"height_cm": float(height_cm)}
        targets.update({target: by_key[source] for source, target in aliases.items() if source in by_key})
        return targets, {"view_height_difference": round(scale_difference, 4), "silhouette_sources": [front.source, side.source]}

    def process(
        self,
        scan_id: str,
        images: dict[str, bytes],
        height_cm: float | None,
        on_progress: Callable[[int, str], None] | None = None,
    ) -> BodyScanResponse:
        def progress(value: int, message: str) -> None:
            if on_progress:
                on_progress(value, message)
        if not SAFE_SCAN_ID.fullmatch(scan_id):
            raise PipelineFailure("scan_id contains unsafe characters.", "SCAN_ID_INVALID", 400)
        try:
            validated, validation_issues, quality = validate_views(
                images,
                height_cm,
                self.settings.max_upload_bytes,
                self.settings.max_image_long_edge,
            )
        except ImageValidationError as error:
            raise PipelineFailure(
                "The uploaded scan views did not pass validation.",
                "VALIDATION_FAILED",
                422,
                tuple(error.issues),
            ) from error
        if height_cm is None:
            raise PipelineFailure("Height is required for calibration.", "HEIGHT_REQUIRED", 422)

        try:
            progress(25, "Validated the two required full-body photos.")
            scan_images = {view: image.data for view, image in validated.items() if view in {"front", "side"}}
            # Pose validation runs before expensive segmentation/fitting.
            front_pose = validate_pose("front", scan_images["front"], self.settings.pose_landmarker_model_path)
            side_pose = validate_pose("side", scan_images["side"], self.settings.pose_landmarker_model_path)
            progress(45, "Detected body landmarks and validated both views.")
            targets, target_metadata = self._anny_targets(
                scan_images,
                float(height_cm),
                {"front": front_pose, "side": side_pose},
            )
            progress(55, "Calibrated front and side body proportions.")
            fitted = fit_anny_body(
                targets,
                max_iterations=self.settings.anny_max_iterations,
                early_stop_delta=self.settings.anny_early_stop_delta,
                on_progress=progress,
            )
            progress(82, "Fitted your Anny body model on this CPU.")
        except PoseValidationError as error:
            raise PipelineFailure("The uploaded scan views did not pass pose validation.", "POSE_VALIDATION_FAILED", 422, tuple(error.issues)) from error
        except AnnyFittingError as error:
            raise PipelineFailure(str(error), "FITTING_FAILED", 422) from error
        except ReconstructionError as error:
            raise PipelineFailure(str(error), "RECONSTRUCTION_FAILED", 422) from error
        except PipelineFailure:
            raise
        except Exception as error:
            raise PipelineFailure(f"Body scan processing failed: {error}", "PROCESSING_FAILED", 500) from error

        fitted_vertices = np.asarray(fitted.vertices, dtype=np.float32)
        if fitted_vertices.ndim != 2 or fitted_vertices.shape[1] < 3 or len(fitted_vertices) < 3:
            raise PipelineFailure("The fitted Anny mesh has invalid coordinates.", "INVALID_PROVIDER_RESULT", 502)
        mesh_min_z = float(np.min(fitted_vertices[:, 2]))
        mesh_max_z = float(np.max(fitted_vertices[:, 2]))
        mesh_height_cm = (mesh_max_z - mesh_min_z) * 100.0
        if not np.isfinite(mesh_height_cm) or mesh_height_cm <= 0:
            raise PipelineFailure("The fitted Anny mesh has no measurable height.", "INVALID_PROVIDER_RESULT", 502)
        scale_factor = float(height_cm) / mesh_height_cm
        if not np.isfinite(scale_factor) or not 0.5 <= scale_factor <= 2.0:
            raise PipelineFailure("The fitted Anny mesh could not be calibrated to the supplied height.", "CALIBRATION_FAILED", 422)
        # Keep the GLB and the CLAD values in one physical coordinate system.
        # Anny's neutral mesh can be a little taller or shorter than the user
        # supplied reference, so apply one uniform scale and place the feet on
        # z=0 before the exporter converts the mesh to browser-standard Y-up.
        # This does not alter body proportions.
        calibrated_vertices = fitted_vertices * scale_factor
        calibrated_vertices[:, 2] -= mesh_min_z * scale_factor
        calibrated_measurements = {
            key: (float(height_cm) if key == "height_cm" else float(value) * scale_factor)
            for key, value in fitted.measurements.items()
        }

        measurement_names = {
            "height_cm": "height",
            "bust_cm": "chest_circumference",
            "waist_cm": "waist_circumference",
            "hip_cm": "hip_circumference",
            "thigh_cm": "thigh_left_circumference",
            "upperarm_cm": "upper_arm",
            "shoulder_width_cm": "shoulder",
            "inseam_cm": "inseam",
        }
        measurements = _measurement_values([
            {"key": measurement_names[key], "value": value, "unit": "cm", "method": "mesh", "confidence": None, "source": "clad-body-fitted-anny"}
            for key, value in calibrated_measurements.items()
            if key in measurement_names
        ])
        # ``fit_anny_body`` already converts CLAD's internal ``_*_pct``
        # metadata into the public body-level fraction map.  Do not pass that
        # normalized map through ``_guide_fractions`` again: that helper is
        # intentionally for raw CLAD metadata and would drop every guide.
        guide_fractions = dict(fitted.guide_fractions)
        guide_geometry = _guide_geometry(calibrated_vertices, fitted.faces, guide_fractions, float(height_cm))
        progress(91, "Calculated CLAD-Body measurements from the calibrated mesh.")
        try:
            artifact = export_glb(
                calibrated_vertices,
                fitted.faces,
                self.settings.output_dir,
                scan_id,
                vertical_axis=2,
            )
            progress(97, "Validated the fitted GLB model.")
        except ReconstructionError as error:
            raise PipelineFailure(str(error), "RECONSTRUCTION_FAILED", 422) from error

        reconstruction_metadata = ReconstructionMetadata(
            backend="anny-clad-cpu",
            device=self.settings.resolved_device(),
            views_used=["front", "side"],
            calibrated_height_cm=round(float(height_cm), 2),
            mesh_height_cm_before_calibration=round(mesh_height_cm, 4),
            scale_factor=round(scale_factor, 6),
            fit_parameters=fitted.parameters,
            fit_initial_error=round(fitted.initial_error, 6),
            fit_final_error=round(fitted.final_error, 6),
            fit_evaluations=fitted.evaluations,
            guide_fractions=guide_fractions,
            guide_geometry=guide_geometry,
            **target_metadata,
        )
        return BodyScanResponse(
            scan_id=scan_id,
            status=ProcessingStatus.completed,
            progress=100,
            status_message="Your fitted 3D body and measurements are ready.",
            scan_quality=quality,
            quality_issues=validation_issues,
            measurements=measurements,
            model={
                "format": artifact["format"],
                "url": None,
                "size_bytes": artifact["size_bytes"],
            },
            reconstruction=reconstruction_metadata,
            processing_version=PROCESSING_VERSION,
        )
