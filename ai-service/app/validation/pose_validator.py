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
        raise PoseValidationError([_issue("POSE_INCOMPLETE", "Body landmarks were incomplete. Retake the full-body photo.", view)])
    points = {
        name: (float(pose[index].x), float(pose[index].y), float(getattr(pose[index], "visibility", 0.0)))
        for name, index in _LANDMARKS.items()
    }
    required = ("nose", "left_shoulder", "right_shoulder", "left_hip", "right_hip", "left_ankle", "right_ankle")
    if any(points[name][2] < 0.5 for name in required):
        raise PoseValidationError([_issue("FULL_BODY_NOT_VISIBLE", "Keep your head, shoulders, hips, and both feet visible.", view)])
    foot_y = max(points["left_heel"][1], points["right_heel"][1], points["left_ankle"][1], points["right_ankle"][1])
    body_height = foot_y - points["nose"][1]
    if body_height < 0.42:
        raise PoseValidationError([_issue("BODY_TOO_SMALL", "Move closer while keeping your full body in frame.", view)])
    shoulder_width = _distance(points["left_shoulder"], points["right_shoulder"])
    hip_width = _distance(points["left_hip"], points["right_hip"])
    # A front view needs enough projected shoulder and hip separation to
    # distinguish the arms and torso. In a true side view those landmarks
    # naturally overlap in 2D, so applying the same minimum would reject
    # valid profile photos after the normal working-copy resize.
    if view == "front" and min(shoulder_width, hip_width) < 0.03:
        raise PoseValidationError([_issue("POSE_UNUSABLE", "Stand naturally with arms slightly away from the body.", view)])
    # The nose is not the top of the head. Estimate the crown from the
    # validated shoulder scale so ordinary portrait framing is accepted while
    # a genuinely clipped head or foot is rejected.
    estimated_head_height = max(0.05, shoulder_width * 0.40)
    if points["nose"][1] - estimated_head_height < 0.02:
        raise PoseValidationError([_issue("HEAD_CROPPED", "Leave a small margin above the head.", view)])
    if foot_y > 0.97:
        raise PoseValidationError([_issue("FEET_CROPPED", "Leave a small margin below both feet.", view)])
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
    )
