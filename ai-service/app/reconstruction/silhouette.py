from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
import os
from pathlib import Path
from threading import Lock
from typing import Iterable

import numpy as np
from PIL import Image

from app.reconstruction.base import ReconstructionError, ReconstructionResult
from app.validation.pose_validator import PoseObservation


REMBG_MODEL_NAME = "u2net_human_seg"
_rembg_session: object | None = None
_rembg_lock = Lock()
_rembg_disabled = False


@dataclass(frozen=True)
class SilhouetteProfile:
    """A compact, calibrated 2D body profile extracted from one view."""

    view: str
    row_full_width: np.ndarray
    row_center_width: np.ndarray
    top: int
    bottom: int
    left: int
    right: int
    image_width: int
    image_height: int
    source: str = "heuristic"

    @property
    def height_px(self) -> float:
        return float(max(1, self.bottom - self.top))

    @property
    def width_px(self) -> float:
        return float(max(1, self.right - self.left + 1))

    def _row_for_fraction(self, fraction_from_bottom: float) -> int:
        fraction = float(np.clip(fraction_from_bottom, 0.0, 1.0))
        return int(round(self.bottom - fraction * self.height_px))

    def width_at(self, fraction_from_bottom: float, *, center: bool = True) -> float:
        values = self.row_center_width if center else self.row_full_width
        row = self._row_for_fraction(fraction_from_bottom)
        relative = row - self.top
        if relative < 0 or relative >= len(values):
            return 0.0
        window = max(1, int(round(self.height_px * 0.018)))
        start = max(0, relative - window)
        end = min(len(values), relative + window + 1)
        sample = values[start:end]
        valid = sample[sample > 0]
        if valid.size == 0:
            return 0.0
        return float(np.median(valid))

    def crotch_fraction(self) -> float:
        """Estimate the top of the leg gap when it is visible in the front mask."""

        candidates: list[tuple[float, float]] = []
        for fraction in np.linspace(0.30, 0.62, 33):
            full = self.width_at(float(fraction), center=False)
            center = self.width_at(float(fraction), center=True)
            if full > 0 and center > 0:
                candidates.append((float(fraction), center / full))
        narrow = [fraction for fraction, ratio in candidates if ratio < 0.46]
        if narrow:
            return float(np.clip(max(narrow), 0.38, 0.62))
        return 0.48


def _resize_image(data: bytes) -> Image.Image:
    try:
        image = Image.open(BytesIO(data)).convert("RGBA")
    except Exception as error:  # Pillow raises several format-specific errors.
        raise ReconstructionError(f"Could not decode {error}") from error
    image.thumbnail((720, 720), Image.Resampling.LANCZOS)
    return image


def _clean_mask(mask: np.ndarray) -> np.ndarray:
    padded = np.pad(mask.astype(np.uint8), 1, mode="constant")
    neighbours = sum(
        padded[dy : dy + mask.shape[0], dx : dx + mask.shape[1]]
        for dy in range(3)
        for dx in range(3)
        if (dy, dx) != (1, 1)
    )
    # Remove isolated specks while retaining thin limbs and feet.
    return mask & (neighbours >= 2)


def _rembg_model_cached() -> bool:
    """Return whether the optional local human-segmentation weights are present.

    The service does not download model weights during a request unless
    ``REMBG_AUTO_DOWNLOAD=true`` is explicitly set. That keeps a fresh or
    offline deployment from hanging in the upload path.
    """

    configured_home = os.getenv("REMBG_HOME", "").strip()
    if configured_home:
        home = Path(configured_home).expanduser()
    elif os.getenv("U2NET_HOME", "").strip():
        home = Path(os.getenv("U2NET_HOME", "")).expanduser()
        return (home / f"{REMBG_MODEL_NAME}.onnx").is_file() or (home / "models" / REMBG_MODEL_NAME / f"{REMBG_MODEL_NAME}.onnx").is_file()
    else:
        home = Path.home() / ".rembg"
    return (home / "models" / REMBG_MODEL_NAME / f"{REMBG_MODEL_NAME}.onnx").is_file()


def _rembg_person_mask(image: Image.Image) -> np.ndarray | None:
    """Extract a human alpha mask with the optional local U2Net model.

    ``u2net_human_seg`` is a human-specific segmentation model, so furniture
    and the room background do not become part of the body profile. The model
    is optional: the caller still has a deterministic OpenCV/colour fallback.
    """

    global _rembg_session, _rembg_disabled
    if _rembg_disabled or os.getenv("SUKATAI_PERSON_SEGMENTATION", "auto").strip().lower() in {"0", "false", "off", "no"}:
        return None
    if not _rembg_model_cached() and os.getenv("REMBG_AUTO_DOWNLOAD", "false").strip().lower() not in {"1", "true", "yes"}:
        return None
    try:
        from rembg import new_session, remove  # type: ignore

        with _rembg_lock:
            if _rembg_session is None:
                _rembg_session = new_session(REMBG_MODEL_NAME)
            session = _rembg_session
        result = remove(image.convert("RGB"), session=session, post_process_mask=True)
        if isinstance(result, Image.Image):
            rgba = result.convert("RGBA")
        else:
            rgba = Image.open(BytesIO(result)).convert("RGBA")
        mask = np.asarray(rgba.getchannel("A"), dtype=np.uint8) >= 128
        if mask.shape != (image.height, image.width):
            mask_image = Image.fromarray(mask.astype(np.uint8) * 255, mode="L").resize(image.size, Image.Resampling.NEAREST)
            mask = np.asarray(mask_image, dtype=np.uint8) >= 128
        if int(mask.sum()) < max(100, int(mask.size * 0.004)):
            return None
        ys, xs = np.where(mask)
        if ys.size == 0 or (int(ys.max()) - int(ys.min()) + 1) < image.height * 0.32:
            return None
        return mask
    except Exception:
        # A missing/incompatible optional model must not make a scan fail.
        _rembg_disabled = True
        return None


_FRONT_PRIOR_DIAMETERS_CM = (
    (0.00, 9.70),
    (0.065, 9.03),
    (0.18, 13.24),
    (0.36, 19.70),
    (0.49, 34.13),
    (0.605, 30.22),
    (0.735, 36.81),
    (0.79, 52.50),
    (0.835, 13.12),
    (0.93, 20.20),
    (1.00, 12.00),
)

_SIDE_PRIOR_DIAMETERS_CM = (
    (0.00, 26.20),
    (0.065, 6.32),
    (0.18, 9.80),
    (0.36, 15.37),
    (0.49, 25.94),
    (0.605, 21.76),
    (0.735, 26.50),
    (0.79, 26.50),
    (0.835, 10.76),
    (0.93, 17.77),
    (1.00, 11.00),
)


def _prior_diameter_cm(fraction_from_bottom: float, view: str) -> float:
    points = _FRONT_PRIOR_DIAMETERS_CM if view == "front" else _SIDE_PRIOR_DIAMETERS_CM
    fractions = np.asarray([point[0] for point in points], dtype=np.float32)
    diameters = np.asarray([point[1] for point in points], dtype=np.float32)
    return float(np.interp(float(np.clip(fraction_from_bottom, 0.0, 1.0)), fractions, diameters))


def _opencv_person_mask(image: Image.Image, view: str) -> np.ndarray | None:
    """Use OpenCV's person detector to locate a safe fallback body prior.

    HOG returns a detection rectangle, not a silhouette. The previous
    implementation treated that rectangle as foreground, which made the GLB
    a box and inflated ankle measurements. This fallback now creates a smooth,
    height-calibrated human profile inside the detection instead of claiming
    the entire rectangle is the body.
    """

    try:
        import cv2  # type: ignore
    except ImportError:
        return None

    rgb = np.asarray(image.convert("RGB"))
    height, width = rgb.shape[:2]
    if height < 2 or width < 2:
        return None
    detection_scale = min(1.0, 420.0 / max(height, width))
    detection_width = max(2, int(round(width * detection_scale)))
    detection_height = max(2, int(round(height * detection_scale)))
    detection_rgb = cv2.resize(rgb, (detection_width, detection_height), interpolation=cv2.INTER_AREA)
    detection_bgr = cv2.cvtColor(detection_rgb, cv2.COLOR_RGB2BGR)

    try:
        detector = cv2.HOGDescriptor()
        detector.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
        rectangles, weights = detector.detectMultiScale(
            detection_bgr,
            winStride=(4, 4),
            padding=(8, 8),
            scale=1.03,
        )
    except Exception:
        return None
    if len(rectangles) == 0:
        return None

    candidates: list[tuple[float, tuple[int, int, int, int]]] = []
    for index, rectangle in enumerate(rectangles):
        x, y, box_width, box_height = (int(value) for value in rectangle)
        if box_height < detection_height * 0.38 or box_width <= 0:
            continue
        center_distance = abs((x + box_width / 2.0) - detection_width / 2.0) / max(1.0, detection_width)
        if center_distance > 0.36:
            continue
        raw_weight = float(np.asarray(weights[index]).reshape(-1)[0]) if len(weights) > index else 0.0
        score = raw_weight + (box_height / max(1.0, detection_height)) - center_distance
        candidates.append((score, (x, y, box_width, box_height)))
    if not candidates:
        return None

    _, (x, y, box_width, box_height) = max(candidates, key=lambda item: item[0])
    margin_x = max(2, int(round(box_width * 0.06)))
    margin_y = max(2, int(round(box_height * 0.04)))
    left = max(0, x - margin_x)
    top = max(0, y - margin_y)
    right = min(detection_width, x + box_width + margin_x)
    bottom = min(detection_height, y + box_height + max(margin_y, int(round(box_height * 0.07))))
    if right - left < 8 or bottom - top < 16:
        return None

    body_height = max(1, bottom - top)
    body_center = (left + right) / 2.0
    prior = np.zeros((detection_height, detection_width), dtype=np.uint8)
    for row in range(top, bottom):
        fraction = (bottom - row - 0.5) / body_height
        diameter_cm = _prior_diameter_cm(fraction, view)
        # The 170 cm reference is only used to make the fallback shape
        # proportional. The final calibration uses the user's entered height.
        diameter_px = max(2.0, diameter_cm / 170.0 * body_height)
        half = diameter_px / 2.0
        row_left = max(left, int(round(body_center - half)))
        row_right = min(right, int(round(body_center + half)))
        if row_right <= row_left:
            continue
        prior[row, row_left:row_right] = 1

    # Scale the safe prior back to the working image resolution.
    return cv2.resize(prior, (width, height), interpolation=cv2.INTER_NEAREST).astype(bool)


def _pose_grabcut_mask(image: Image.Image, pose: PoseObservation) -> np.ndarray | None:
    """Use validated MediaPipe joints to seed a CPU-only OpenCV segmentation.

    GrabCut is deliberately constrained to the landmark bounding box. The
    joints provide definite foreground strokes while the surrounding box is
    only probable foreground, allowing the image edges to separate clothing
    from a normal room/background without treating the whole rectangle as a
    body. The active Anny pipeline passes a pose observation here; the old
    silhouette preview does not.
    """

    try:
        import cv2  # type: ignore
    except ImportError:
        return None

    rgb = np.asarray(image.convert("RGB"))
    height, width = rgb.shape[:2]
    if height < 32 or width < 24:
        return None
    landmarks = pose.landmarks
    points: dict[str, tuple[int, int]] = {}
    for name, value in landmarks.items():
        if len(value) < 3 or not all(np.isfinite(component) for component in value):
            continue
        x, y, visibility = value
        if visibility < 0.35:
            continue
        points[name] = (
            int(np.clip(round(x * (width - 1)), 0, width - 1)),
            int(np.clip(round(y * (height - 1)), 0, height - 1)),
        )
    if len(points) < 6:
        return None

    all_x = np.asarray([point[0] for point in points.values()], dtype=np.int32)
    all_y = np.asarray([point[1] for point in points.values()], dtype=np.int32)
    margin_x = max(8, int(round(width * 0.055)))
    margin_y = max(8, int(round(height * 0.035)))
    left = max(1, int(all_x.min()) - margin_x)
    top = max(1, int(all_y.min()) - margin_y)
    right = min(width - 2, int(all_x.max()) + margin_x)
    bottom = min(height - 2, int(all_y.max()) + margin_y)
    if right - left < width * 0.06 or bottom - top < height * 0.35:
        return None

    mask = np.full((height, width), cv2.GC_BGD, dtype=np.uint8)
    mask[top : bottom + 1, left : right + 1] = cv2.GC_PR_BGD
    skeleton = (
        ("nose", "left_shoulder"),
        ("nose", "right_shoulder"),
        ("left_shoulder", "right_shoulder"),
        ("left_shoulder", "left_elbow"),
        ("left_elbow", "left_wrist"),
        ("right_shoulder", "right_elbow"),
        ("right_elbow", "right_wrist"),
        ("left_shoulder", "left_hip"),
        ("right_shoulder", "right_hip"),
        ("left_hip", "right_hip"),
        ("left_hip", "left_knee"),
        ("left_knee", "left_ankle"),
        ("right_hip", "right_knee"),
        ("right_knee", "right_ankle"),
        ("left_ankle", "left_heel"),
        ("right_ankle", "right_heel"),
    )
    stroke = max(3, int(round(min(height, width) * 0.035)))
    for start_name, end_name in skeleton:
        start = points.get(start_name)
        end = points.get(end_name)
        if start is not None and end is not None:
            cv2.line(mask, start, end, cv2.GC_FGD, stroke, cv2.LINE_AA)
    for point in points.values():
        cv2.circle(mask, point, max(stroke, int(round(stroke * 1.35))), cv2.GC_FGD, -1, cv2.LINE_AA)

    try:
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        background_model = np.zeros((1, 65), dtype=np.float64)
        foreground_model = np.zeros((1, 65), dtype=np.float64)
        cv2.grabCut(bgr, mask, None, background_model, foreground_model, 3, cv2.GC_INIT_WITH_MASK)
    except Exception:
        return None

    result = np.isin(mask, (cv2.GC_FGD, cv2.GC_PR_FGD))
    kernel = np.ones((3, 3), dtype=np.uint8)
    result = cv2.morphologyEx(result.astype(np.uint8), cv2.MORPH_CLOSE, kernel, iterations=1).astype(bool)
    result = _clean_mask(result)
    ys, _ = np.where(result)
    if ys.size < 100 or int(ys.max()) - int(ys.min()) + 1 < height * 0.35:
        return None
    return result


def _largest_component(mask: np.ndarray) -> np.ndarray:
    height, width = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    best: list[tuple[int, int]] = []
    for y, x in np.argwhere(mask):
        if visited[y, x]:
            continue
        stack = [(int(y), int(x))]
        visited[y, x] = True
        component: list[tuple[int, int]] = []
        while stack:
            cy, cx = stack.pop()
            component.append((cy, cx))
            for ny in range(max(0, cy - 1), min(height, cy + 2)):
                for nx in range(max(0, cx - 1), min(width, cx + 2)):
                    if visited[ny, nx] or not mask[ny, nx]:
                        continue
                    visited[ny, nx] = True
                    stack.append((ny, nx))
        if len(component) < len(best):
            continue
        ys = [point[0] for point in component]
        vertical_span = max(ys) - min(ys) + 1
        # A broad horizontal object should not beat a full-body component just
        # because it contains more pixels.
        score = len(component) * (1.0 + vertical_span / max(1, height))
        best_score = 0.0
        if best:
            best_ys = [point[0] for point in best]
            best_span = max(best_ys) - min(best_ys) + 1
            best_score = len(best) * (1.0 + best_span / max(1, height))
        if score > best_score:
            best = component
    if not best:
        raise ReconstructionError("No connected body silhouette could be detected in the image.")
    component_mask = np.zeros_like(mask, dtype=bool)
    ys, xs = zip(*best)
    component_mask[np.asarray(ys), np.asarray(xs)] = True
    return component_mask


def _foreground_mask(image: Image.Image) -> np.ndarray:
    array = np.asarray(image)
    alpha = array[:, :, 3]
    transparent = float(np.mean(alpha < 245))
    if transparent > 0.01:
        mask = alpha > 25
        return _clean_mask(mask)

    rgb = array[:, :, :3].astype(np.float32)
    border = np.concatenate(
        [rgb[0, :, :], rgb[-1, :, :], rgb[:, 0, :], rgb[:, -1, :]],
        axis=0,
    )
    background = np.median(border, axis=0)
    distance = np.linalg.norm(rgb - background, axis=2)
    border_distance = np.concatenate(
        [distance[0, :], distance[-1, :], distance[:, 0], distance[:, -1]],
        axis=0,
    )
    noise = float(np.percentile(border_distance, 90))
    threshold = max(18.0, noise * 3.0 + 3.0)
    mask = distance > threshold
    cleaned = _clean_mask(mask)
    if int(cleaned.sum()) < max(100, int(mask.size * 0.004)):
        # Low-contrast photographs benefit from a luminance-only pass. This is
        # still deliberately heuristic; final pose/person validation belongs to
        # a configured PIXIE/SMPL-X backend.
        luminance = rgb @ np.asarray([0.2126, 0.7152, 0.0722], dtype=np.float32)
        bg_luminance = float(np.median(border @ np.asarray([0.2126, 0.7152, 0.0722], dtype=np.float32)))
        cleaned = _clean_mask(np.abs(luminance - bg_luminance) > max(14.0, noise * 1.4))
    return cleaned


def extract_silhouette_profile(data: bytes, view: str, pose: PoseObservation | None = None) -> SilhouetteProfile:
    image = _resize_image(data)
    mask_source = "colour-distance"
    mask = _rembg_person_mask(image)
    if mask is not None:
        mask_source = "u2net-human-segmentation"
    else:
        if pose is not None:
            mask = _pose_grabcut_mask(image, pose)
            if mask is not None:
                mask_source = "mediapipe-opencv-grabcut"
        if mask is None and pose is None:
            mask = _opencv_person_mask(image, view)
            if mask is not None:
                mask_source = "hog-body-prior"
    if mask is None:
        mask = _foreground_mask(image)
    component = _largest_component(mask)
    ys, xs = np.where(component)
    if ys.size < 100:
        raise ReconstructionError(f"The {view} view does not contain a usable body silhouette.")
    top, bottom = int(ys.min()), int(ys.max())
    left, right = int(xs.min()), int(xs.max())
    height = bottom - top + 1
    full = np.zeros(height, dtype=np.float32)
    center = np.zeros(height, dtype=np.float32)
    body_center = (left + right) / 2.0
    for image_row in range(top, bottom + 1):
        row_xs = np.flatnonzero(component[image_row])
        if row_xs.size == 0:
            continue
        full[image_row - top] = float(row_xs[-1] - row_xs[0] + 1)
        runs: list[tuple[int, int]] = []
        start = previous = int(row_xs[0])
        for current in row_xs[1:]:
            current_int = int(current)
            if current_int != previous + 1:
                runs.append((start, previous))
                start = current_int
            previous = current_int
        runs.append((start, previous))
        nearest_start, nearest_end = min(runs, key=lambda run: abs(((run[0] + run[1]) / 2.0) - body_center))
        center[image_row - top] = float(nearest_end - nearest_start + 1)
    return SilhouetteProfile(
        view=view,
        row_full_width=full,
        row_center_width=center,
        top=top,
        bottom=bottom,
        left=left,
        right=right,
        image_width=image.width,
        image_height=image.height,
        source=mask_source,
    )


def _profile_width(profile: SilhouetteProfile, fraction: float, height_cm: float, *, center: bool) -> float:
    pixels = profile.width_at(fraction, center=center)
    return float(pixels * height_cm / profile.height_px)


@dataclass(frozen=True)
class ResolvedSilhouetteProfiles:
    submitted_front: SilhouetteProfile
    submitted_side: SilhouetteProfile
    front: SilhouetteProfile
    side: SilhouetteProfile
    view_assignment: str


def resolve_front_side_profiles(
    images: dict[str, bytes],
    pose_observations: dict[str, PoseObservation] | None = None,
) -> ResolvedSilhouetteProfiles:
    """Extract the two required profiles and apply one shared view assignment.

    Phone uploads can be placed in the wrong slot. Keeping this decision in one
    helper is important: the mesh and its measurement rows must use the same
    front/side pair.
    """

    if "front" not in images or "side" not in images:
        raise ReconstructionError("Front and side views are required for calibrated silhouette reconstruction.")
    poses = pose_observations or {}
    submitted_front = extract_silhouette_profile(images["front"], "front", poses.get("front"))
    submitted_side = extract_silhouette_profile(images["side"], "side", poses.get("side"))
    front = submitted_front
    side = submitted_side
    view_assignment = "submitted"
    # For a standing person the frontal silhouette should normally be wider
    # than the side depth. Use a tight threshold so an obvious slot reversal is
    # corrected without changing normal framing differences.
    if front.width_px < side.width_px * 0.98:
        front, side = side, front
        view_assignment = "width-based front-side swap"
    return ResolvedSilhouetteProfiles(
        submitted_front=submitted_front,
        submitted_side=submitted_side,
        front=front,
        side=side,
        view_assignment=view_assignment,
    )


def build_calibrated_profile_mesh(
    front: SilhouetteProfile,
    side: SilhouetteProfile,
    height_cm: float,
    fractions: Iterable[float] | None = None,
    segments: int = 28,
) -> tuple[np.ndarray, np.ndarray]:
    """Create a coarse watertight body volume from the two calibrated profiles."""

    if not np.isfinite(height_cm) or height_cm <= 0:
        raise ReconstructionError("A positive height is required to calibrate the body mesh.")
    levels = list(fractions or np.linspace(0.0, 1.0, 42))
    vertices: list[list[float]] = []
    faces: list[list[int]] = []
    for fraction in levels:
        use_full = fraction > 0.76 or fraction < 0.09
        front_width = _profile_width(front, fraction, height_cm, center=not use_full)
        side_depth = _profile_width(side, fraction, height_cm, center=not use_full)
        if front_width <= 0:
            front_width = max(4.0, height_cm * 0.025)
        if side_depth <= 0:
            side_depth = max(3.0, front_width * 0.42)
        radius_x = max(1.2, front_width / 2.0)
        radius_z = max(1.0, side_depth / 2.0)
        y = float(fraction * height_cm)
        for segment in range(segments):
            angle = 2.0 * np.pi * segment / segments
            vertices.append([radius_x * np.cos(angle), y, radius_z * np.sin(angle)])
    for level in range(len(levels) - 1):
        for segment in range(segments):
            current = level * segments + segment
            next_segment = level * segments + (segment + 1) % segments
            upper = (level + 1) * segments + segment
            upper_next = (level + 1) * segments + (segment + 1) % segments
            faces.extend([[current, upper, next_segment], [next_segment, upper, upper_next]])
    bottom_center = len(vertices)
    top_center = bottom_center + 1
    vertices.extend([[0.0, 0.0, 0.0], [0.0, height_cm, 0.0]])
    for segment in range(segments):
        next_segment = (segment + 1) % segments
        faces.append([bottom_center, next_segment, segment])
        top = (len(levels) - 1) * segments
        faces.append([top_center, top + segment, top + next_segment])
    return np.asarray(vertices, dtype=np.float32), np.asarray(faces, dtype=np.int32)


class SilhouetteReconstructor:
    """CPU-safe fallback that derives a coarse model from real uploaded pixels.

    This is intentionally not presented as a learned body model. It is useful
    for local previews and as a deterministic integration fallback while the
    licensed PIXIE/SMPL-X runner is being installed.
    """

    def __init__(self, height_cm: float):
        self.height_cm = float(height_cm)

    def reconstruct_with_profiles(
        self,
        images: dict[str, bytes],
    ) -> tuple[ReconstructionResult, SilhouetteProfile, SilhouetteProfile]:
        resolved = resolve_front_side_profiles(images)
        submitted_front = resolved.submitted_front
        submitted_side = resolved.submitted_side
        front = resolved.front
        side = resolved.side
        view_assignment = resolved.view_assignment
        back = None
        back_diagnostic_error = None
        if "back" in images:
            try:
                back = extract_silhouette_profile(images["back"], "back")
            except ReconstructionError as error:
                # Back is an optional diagnostic view for this fallback. Keep
                # a valid front/side result available and report the issue in
                # metadata instead of pretending the back projection was used.
                back_diagnostic_error = str(error)[:180]
        vertices, faces = build_calibrated_profile_mesh(front, side, self.height_cm)
        height_difference = abs(front.height_px - side.height_px) / max(front.height_px, side.height_px)
        metadata = {
            "front_profile_height_px": round(front.height_px, 2),
            "side_profile_height_px": round(side.height_px, 2),
            "submitted_front_profile_width_px": round(submitted_front.width_px, 2),
            "submitted_side_profile_width_px": round(submitted_side.width_px, 2),
            "view_assignment": view_assignment,
            "front_profile_source": front.source,
            "side_profile_source": side.source,
            "view_height_difference": round(height_difference, 4),
            "additional_views_received": ["back"] if back is not None else [],
            "back_profile_height_px": round(back.height_px, 2) if back is not None else None,
            "back_view_diagnostic_only": back is not None,
            "back_view_diagnostic_error": back_diagnostic_error,
            "backend_notice": "calibrated silhouette fallback; human segmentation improves the contour, but a licensed PIXIE/SMPL-X runner is required for scan-grade reconstruction",
        }
        result = ReconstructionResult(
            vertices=vertices,
            faces=faces,
            backend="calibrated-silhouette",
            # The fallback currently builds the volume from front and side;
            # a submitted back view is decoded for diagnostics only. A future
            # multi-view runner can replace this adapter and truthfully expand
            # views_used when it fuses all three projections.
            views_used=("front", "side"),
            metadata=metadata,
        )
        return result, front, side

    def reconstruct(self, images: dict[str, bytes]) -> ReconstructionResult:
        result, _, _ = self.reconstruct_with_profiles(images)
        return result
