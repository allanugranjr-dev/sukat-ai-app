from __future__ import annotations

"""MediaPipe Tasks validation for the two required scan views.

This module intentionally fails closed.  A scan is never passed to fitting when
the Lite pose asset is unavailable or when MediaPipe cannot establish one full
body in each image.
"""

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image

from app.schemas.api import ValidationIssue


class PoseValidationError(ValueError):
    def __init__(self, issues: list[ValidationIssue]):
        super().__init__("; ".join(issue.message for issue in issues))
        self.issues = issues


@dataclass(frozen=True)
class PoseObservation:
    view: str
    landmarks: dict[str, tuple[float, float, float]]
    body_height_px: float
    shoulder_width_px: float
    hip_width_px: float
    coverage: str = "full_body"
    estimated_full_height_px: float | None = None
    estimated_full_height_fraction: float | None = None


_LANDMARKS = {
    "nose": 0,
    "left_shoulder": 11,
    "right_shoulder": 12,
    "left_elbow": 13,
    "right_elbow": 14,
    "left_wrist": 15,
    "right_wrist": 16,
    "left_hip": 23,
    "right_hip": 24,
    "left_knee": 25,
    "right_knee": 26,
    "left_ankle": 27,
    "right_ankle": 28,
    "left_heel": 29,
    "right_heel": 30,
}


def _issue(code: str, message: str, view: str) -> ValidationIssue:
    return ValidationIssue(code=code, message=message, view=view, severity="error")


def _distance(left: tuple[float, float, float], right: tuple[float, float, float]) -> float:
    return float(np.hypot(left[0] - right[0], left[1] - right[1]))


def _load_landmarker(model_path: Path):
    if not model_path.is_file():
        raise PoseValidationError([
            ValidationIssue(
                code="POSE_MODEL_MISSING",
                message="The private MediaPipe Lite pose model is not installed on this scanner.",
                severity="error",
            )
        ])
    try:
        import mediapipe as mp  # type: ignore
        from mediapipe.tasks import python  # type: ignore
        from mediapipe.tasks.python import vision  # type: ignore
    except ImportError as error:
        raise PoseValidationError([
            ValidationIssue(code="MEDIAPIPE_UNAVAILABLE", message="MediaPipe is not installed on this scanner.", severity="error")
        ]) from error
    options = vision.PoseLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=str(model_path)),
        running_mode=vision.RunningMode.IMAGE,
        num_poses=2,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    return mp, vision.PoseLandmarker.create_from_options(options)


def validate_pose(view: str, data: bytes, model_path: Path) -> PoseObservation:
    mp, landmarker = _load_landmarker(model_path)
    try:
        with Image.open(BytesIO(data)) as image:
            rgb = np.asarray(image.convert("RGB"))
        result = landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    finally:
        landmarker.close()

    poses = result.pose_landmarks
    if len(poses) != 1:
        code = "PERSON_NOT_DETECTED" if not poses else "MULTIPLE_PEOPLE_DETECTED"
        message = "One person must be fully visible." if not poses else "Use a photo containing exactly one person."
        raise PoseValidationError([_issue(code, message, view)])
    pose = poses[0]
    if len(pose) <= max(_LANDMARKS.values()):
        raise PoseValidationError([_issue("POSE_INCOMPLETE", "Body landmarks were incomplete. Retake the photo.", view)])
    points = {
        name: (float(pose[index].x), float(pose[index].y), float(getattr(pose[index], "visibility", 0.0)))
        for name, index in _LANDMARKS.items()
    }

    # Head and shoulders are essential for both full-body and half-body scans
    required_upper = ("nose", "left_shoulder", "right_shoulder")
    if any(points[name][2] < 0.45 for name in required_upper):
        raise PoseValidationError([_issue("UPPER_BODY_NOT_VISIBLE", "Keep your head and both shoulders clearly visible.", view)])

    shoulder_width = _distance(points["left_shoulder"], points["right_shoulder"])
    estimated_head_height = max(0.05, shoulder_width * 0.40)
    crown_y = points["nose"][1] - estimated_head_height
    if crown_y < 0.015:
        raise PoseValidationError([_issue("HEAD_CROPPED", "Leave a small margin above the head.", view)])

    # Check ankle/heel visibility to distinguish full-body from half-body / upper-body scans
    ankles_visible = points["left_ankle"][2] >= 0.4 and points["right_ankle"][2] >= 0.4
    has_hips = points["left_hip"][2] >= 0.35 or points["right_hip"][2] >= 0.35
    hip_width = _distance(points["left_hip"], points["right_hip"]) if has_hips else shoulder_width * 0.82

    if ankles_visible:
        coverage = "full_body"
        foot_y = max(points["left_heel"][1], points["right_heel"][1], points["left_ankle"][1], points["right_ankle"][1])
        body_height = foot_y - points["nose"][1]
        if body_height < 0.40:
            raise PoseValidationError([_issue("BODY_TOO_SMALL", "Move closer while keeping your full body in frame.", view)])
        if foot_y > 0.97:
            raise PoseValidationError([_issue("FEET_CROPPED", "Leave a small margin below both feet.", view)])
        estimated_full_height = body_height
    else:
        coverage = "half_body"
        # Half-body / upper-body scan: ankles/feet are not in frame
        candidates_y: list[float] = []
        for name in ("left_knee", "right_knee", "left_hip", "right_hip", "left_wrist", "right_wrist", "left_elbow", "right_elbow"):
            if points[name][2] >= 0.35:
                candidates_y.append(points[name][1])
        if not candidates_y:
            candidates_y.append(max(points["left_shoulder"][1], points["right_shoulder"][1]) + shoulder_width * 0.8)
        lowest_y = max(candidates_y)
        body_height = lowest_y - points["nose"][1]
        if body_height < 0.15:
            raise PoseValidationError([_issue("BODY_TOO_SMALL", "Move closer so your upper body fills the frame.", view)])

        # Anthropometric stature ratio estimation:
        # Distance from crown to hip is ~0.50 of total stature.
        # Distance from crown to shoulder is ~0.19 of total stature.
        # Shoulder width is ~0.23 of total stature.
        if has_hips:
            hip_y = max(points["left_hip"][1], points["right_hip"][1])
            crown_to_hip = max(0.20, hip_y - crown_y)
            estimated_full_height = max(body_height * 1.3, crown_to_hip / 0.50)
        elif any(points[name][2] >= 0.35 for name in ("left_knee", "right_knee")):
            knee_y = max(points[name][1] for name in ("left_knee", "right_knee") if points[name][2] >= 0.35)
            estimated_full_height = max(body_height * 1.15, (knee_y - crown_y) / 0.72)
        else:
            shoulder_y = (points["left_shoulder"][1] + points["right_shoulder"][1]) / 2.0
            crown_to_shoulder = max(0.12, shoulder_y - crown_y)
            estimated_full_height = max(body_height * 1.4, crown_to_shoulder / 0.19, shoulder_width / 0.23)

    if view == "front" and min(shoulder_width, hip_width) < 0.03:
        raise PoseValidationError([_issue("POSE_UNUSABLE", "Stand naturally with arms slightly away from the body.", view)])
    if view == "front" and shoulder_width < 0.06:
        raise PoseValidationError([_issue("FRONT_ORIENTATION_INVALID", "Face the camera directly for the front view.", view)])
    if view == "side" and shoulder_width > 0.28:
        raise PoseValidationError([_issue("SIDE_ORIENTATION_INVALID", "Turn one full side toward the camera for the side view.", view)])

    return PoseObservation(
        view=view,
        landmarks=points,
        body_height_px=body_height * rgb.shape[0],
        shoulder_width_px=shoulder_width * rgb.shape[1],
        hip_width_px=hip_width * rgb.shape[1],
        coverage=coverage,
        estimated_full_height_px=estimated_full_height * rgb.shape[0],
        estimated_full_height_fraction=estimated_full_height,
    )
