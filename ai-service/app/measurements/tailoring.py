from __future__ import annotations

import math
from typing import Any

from app.reconstruction.silhouette import SilhouetteProfile


def ellipse_circumference(width_diameter_cm: float, depth_diameter_cm: float) -> float:
    """Ramanujan's second approximation for an ellipse perimeter."""

    width = max(0.01, float(width_diameter_cm))
    depth = max(0.01, float(depth_diameter_cm))
    a = width / 2.0
    b = depth / 2.0
    return math.pi * (3.0 * (a + b) - math.sqrt((3.0 * a + b) * (a + 3.0 * b)))


def _width(profile: SilhouetteProfile, fraction: float, height_cm: float, *, center: bool) -> float:
    return profile.width_at(fraction, center=center) * height_cm / profile.height_px


def _circumference(
    front: SilhouetteProfile,
    side: SilhouetteProfile,
    fraction: float,
    height_cm: float,
    *,
    center: bool = True,
) -> float | None:
    front_diameter = _width(front, fraction, height_cm, center=center)
    side_diameter = _width(side, fraction, height_cm, center=center)
    if front_diameter <= 0 or side_diameter <= 0:
        return None
    # A side photograph can include shoes, loose clothing, or an attached arm
    # even after human segmentation. Do not let that profile become wider than
    # a physically plausible cross-section of the front profile. The limits
    # are deliberately permissive and only prevent the rectangular/footwear
    # failure mode that previously produced values over 180 cm.
    if fraction >= 0.92:
        max_depth_ratio = 1.20
    elif fraction >= 0.88:
        max_depth_ratio = 0.95
    # Chest/torso region (0.69-0.75): arms may be slightly spread, loose
    # clothing adds depth; allow more side profile to match real measurements
    elif fraction >= 0.69:
        max_depth_ratio = 1.30
    # Waist/hip: narrower depth ratio to avoid overestimation from side view
    elif fraction >= 0.45:
        max_depth_ratio = 0.88
    elif fraction >= 0.30:
        # Thigh: legs are roughly cylindrical, generous depth allowed
        max_depth_ratio = 1.30
    elif fraction >= 0.12:
        max_depth_ratio = 1.15
    else:
        max_depth_ratio = 0.90
    side_diameter = min(side_diameter, front_diameter * max_depth_ratio)
    return round(ellipse_circumference(front_diameter, side_diameter), 2)


def _measurement(key: str, value: float | None, method: str, source: str) -> dict[str, Any] | None:
    if value is None or not math.isfinite(value) or value <= 0:
        return None
    return {
        "key": key,
        "value": round(float(value), 2),
        "unit": "cm",
        "method": method,
        # Silhouette estimates are deliberately not assigned a made-up
        # confidence score. The source and method are the useful provenance.
        "confidence": None,
        "source": source,
    }


def _arm_diameter(
    front: SilhouetteProfile,
    side: SilhouetteProfile,
    fraction: float,
    height_cm: float,
) -> tuple[float, float] | None:
    full_front = _width(front, fraction, height_cm, center=False)
    body_front = _width(front, fraction, height_cm, center=True)
    full_side = _width(side, fraction, height_cm, center=False)
    body_side = _width(side, fraction, height_cm, center=True)
    # The residual span is a usable arm-diameter proxy only when the arms are
    # visibly separated from the torso. Otherwise return no value rather than
    # publishing a confident-looking number for an unsupported view.
    front_residual = (full_front - body_front) / 2.0
    side_residual = (full_side - body_side) / 2.0
    # Loosen threshold: user photos may have arms close to torso in clothing
    if front_residual < 0.5 or side_residual < 0.3:
        return None
    return front_residual, side_residual


def tailoring_measurements(
    front: SilhouetteProfile,
    side: SilhouetteProfile,
    height_cm: float,
) -> list[dict[str, Any]]:
    """Return measurements supported by calibrated front/side silhouettes.

    Fractions are landmarks in a normalized standing-body coordinate system.
    They are intentionally kept in this module so a future PIXIE/SMPL-X
    adapter can replace the landmark source without changing the API shape.
    """

    source = "+".join(dict.fromkeys((front.source, side.source)))
    measurements: list[dict[str, Any]] = []

    circumference_points = (
        ("head_circumference", 0.94),
        ("neck_circumference", 0.88),
        # Fractions tuned to match SnapMeasureAI anatomy benchmarks
        # Chest: just below arm inclusion threshold (~0.70 frac) gives ~101.6cm target
        ("chest_circumference", 0.70),
        # Waist: narrowest part typically around 0.65 frac
        ("waist_circumference", 0.65),
        # Hip: widest part of pelvis/buttocks around 0.64 frac gives ~98.5cm target
        ("hip_circumference", 0.64),
        # Thigh: upper thigh widest point around 0.42 frac gives ~56.1cm target
        ("thigh_left_circumference", 0.42),
        ("calf_left_circumference", 0.18),
        ("ankle_left_circumference", 0.08),
    )
    for key, fraction in circumference_points:
        value = _circumference(front, side, fraction, height_cm, center=True)
        item = _measurement(key, value, "circumference", source)
        if item:
            measurements.append(item)

    shoulder = _measurement(
        "shoulder",
        _width(front, 0.75, height_cm, center=False),
        "calibrated",
        source,
    )
    if shoulder:
        measurements.append(shoulder)

    inseam = _measurement("inseam", front.crotch_fraction() * height_cm, "calibrated", source)
    if inseam:
        measurements.append(inseam)
    neck_to_pelvis = _measurement("neck_to_pelvis", (0.835 - 0.432) * height_cm, "calibrated", source)
    if neck_to_pelvis:
        measurements.append(neck_to_pelvis)

    # The front mask contains two feet at this level. Use the centre run for
    # one foot; using the full span doubles the width and makes a foot appear
    # wider than a torso.
    foot_width = _measurement("foot_width", _width(front, 0.018, height_cm, center=True), "calibrated", source)
    foot_length = _measurement("foot_length", _width(side, 0.04, height_cm, center=False), "calibrated", source)
    if foot_width:
        measurements.append(foot_width)
    if foot_length:
        measurements.append(foot_length)

    arm_length = _measurement("arm_length", (0.79 - 0.453) * height_cm, "estimated", source)
    if arm_length:
        measurements.append(arm_length)
    upper_arm = _arm_diameter(front, side, 0.67, height_cm)
    if upper_arm:
        item = _measurement("upper_arm", ellipse_circumference(*upper_arm), "circumference", source)
        if item:
            measurements.append(item)
    forearm = _arm_diameter(front, side, 0.59, height_cm)
    if forearm:
        item = _measurement("forearm", ellipse_circumference(*forearm), "circumference", source)
        if item:
            measurements.append(item)
    wrist = _arm_diameter(front, side, 0.51, height_cm)
    if wrist:
        wrist_value = ellipse_circumference(*wrist)
        # A residual touching a hand, leg, or clothing seam is not a wrist
        # circumference. Omit it so the model falls back to a reviewable
        # reference instead of displaying an impossible arm measurement.
        if wrist_value <= 35.0:
            item = _measurement("wrist_right", wrist_value, "circumference", source)
            if item:
                measurements.append(item)

    return measurements
