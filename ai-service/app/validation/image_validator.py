from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from typing import Iterable

from PIL import Image, ImageChops, ImageFilter, ImageOps, UnidentifiedImageError

from app.schemas.api import ScanQuality, ValidationIssue


SUPPORTED_FORMATS = {"JPEG", "PNG", "WEBP"}
MIN_WIDTH = 320
MIN_HEIGHT = 480
MAX_DIMENSION = 8_000


class ImageValidationError(ValueError):
    def __init__(self, issues: list[ValidationIssue]):
        super().__init__("; ".join(issue.message for issue in issues))
        self.issues = issues


@dataclass(frozen=True)
class ValidatedImage:
    view: str
    data: bytes
    width: int
    height: int
    format: str
    warnings: tuple[ValidationIssue, ...] = ()


def _sharpness_score(image: Image.Image) -> float:
    sample = image.convert("L")
    sample.thumbnail((640, 640))
    edge_image = ImageChops.difference(sample, sample.filter(ImageFilter.GaussianBlur(radius=1.4)))
    histogram = edge_image.histogram()
    total = max(1, sum(histogram))
    mean = sum(index * count for index, count in enumerate(histogram)) / total
    variance = sum(((index - mean) ** 2) * count for index, count in enumerate(histogram)) / total
    return variance


def validate_image(data: bytes, view: str, max_upload_bytes: int, max_image_long_edge: int = 1280) -> ValidatedImage:
    issues: list[ValidationIssue] = []
    if not data:
        issues.append(ValidationIssue(code="IMAGE_REQUIRED", message=f"The {view} image is empty.", view=view))
        raise ImageValidationError(issues)
    if len(data) > max_upload_bytes:
        issues.append(ValidationIssue(code="FILE_TOO_LARGE", message=f"The {view} image is larger than the {max_upload_bytes // (1024 * 1024)} MB limit.", view=view))
        raise ImageValidationError(issues)
    try:
        with Image.open(BytesIO(data)) as image:
            image.verify()
        image = Image.open(BytesIO(data))
    except (UnidentifiedImageError, OSError):
        issues.append(ValidationIssue(code="UNSUPPORTED_IMAGE", message=f"The {view} upload is not a readable JPG, PNG, or WebP image.", view=view))
        raise ImageValidationError(issues)

    image_format = (image.format or "").upper()
    width, height = image.size
    if image_format not in SUPPORTED_FORMATS:
        issues.append(ValidationIssue(code="UNSUPPORTED_IMAGE", message=f"The {view} image format is not supported.", view=view))
    if width < MIN_WIDTH or height < MIN_HEIGHT:
        issues.append(ValidationIssue(code="IMAGE_TOO_SMALL", message=f"The {view} image must be at least {MIN_WIDTH} × {MIN_HEIGHT} pixels.", view=view))
    if width > MAX_DIMENSION or height > MAX_DIMENSION:
        issues.append(ValidationIssue(code="IMAGE_DIMENSIONS_INVALID", message=f"The {view} image dimensions are too large.", view=view))
    if width > 0 and height > 0 and width / height > 2.4:
        issues.append(ValidationIssue(code="FULL_BODY_FRAME_UNLIKELY", message=f"The {view} image is unusually wide; use a portrait frame with the whole body visible.", view=view))
    if _sharpness_score(image) < 7:
        issues.append(ValidationIssue(code="IMAGE_TOO_BLURRY", message=f"The {view} image is too blurry to validate. Retake it with the camera steady.", view=view))
    if any(issue.severity == "error" for issue in issues):
        raise ImageValidationError(issues)

    # Normalize EXIF orientation and downsample before the CPU pose model. The
    # original upload remains in private storage; only this bounded working copy
    # is sent through inference.
    prepared = ImageOps.exif_transpose(image)
    max_edge = max(320, int(max_image_long_edge))
    if max(prepared.size) > max_edge:
        prepared.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
    prepared_width, prepared_height = prepared.size
    if prepared_width != width or prepared_height != height or prepared is not image:
        output = BytesIO()
        save_format = "JPEG" if image_format == "JPEG" else image_format
        save_image = prepared.convert("RGB") if save_format == "JPEG" else prepared
        save_kwargs = {"quality": 92, "optimize": True} if save_format == "JPEG" else {"optimize": True}
        save_image.save(output, format=save_format, **save_kwargs)
        data = output.getvalue()
        if prepared is not image:
            prepared.close()
    image.close()

    return ValidatedImage(view=view, data=data, width=prepared_width, height=prepared_height, format=image_format)


def validate_views(
    images: dict[str, bytes],
    height_cm: float | None,
    max_upload_bytes: int,
    max_image_long_edge: int = 1280,
    required_views: Iterable[str] = ("front", "side"),
) -> tuple[dict[str, ValidatedImage], list[ValidationIssue], ScanQuality]:
    issues: list[ValidationIssue] = []
    if height_cm is None:
        issues.append(ValidationIssue(code="HEIGHT_REQUIRED", message="Enter your height in centimetres before processing the scan."))
    elif not 120 <= height_cm <= 230:
        issues.append(ValidationIssue(code="HEIGHT_INVALID", message="Height must be between 120 and 230 centimetres."))
    validated: dict[str, ValidatedImage] = {}
    for view in required_views:
        if view not in images or not images[view]:
            issues.append(ValidationIssue(code="IMAGE_REQUIRED", message=f"A {view} full-body image is required.", view=view))
            continue
        try:
            validated[view] = validate_image(images[view], view, max_upload_bytes, max_image_long_edge)
        except ImageValidationError as error:
            issues.extend(error.issues)
    if "back" in images and images["back"]:
        try:
            validated["back"] = validate_image(images["back"], "back", max_upload_bytes, max_image_long_edge)
        except ImageValidationError as error:
            issues.extend(error.issues)
    errors = [issue for issue in issues if issue.severity == "error"]
    if errors:
        raise ImageValidationError(issues)
    all_issues = issues + [warning for image in validated.values() for warning in image.warnings]
    quality = ScanQuality.acceptable if any(issue.severity == "warning" for issue in all_issues) else ScanQuality.good
    return validated, all_issues, quality
