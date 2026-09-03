from __future__ import annotations

from helpers import make_body_image
import pytest

from app.validation.image_validator import ImageValidationError, validate_image, validate_views

def test_validation_accepts_supported_full_body_image() -> None:
    result = validate_image(make_body_image(), "front", 10 * 1024 * 1024)
    assert result.width == 480
    assert result.height == 960
    assert result.format == "PNG"


def test_validation_requires_front_and_side_and_height() -> None:
    with pytest.raises(ImageValidationError) as error:
        validate_views({"front": make_body_image()}, None, 10 * 1024 * 1024)
    codes = {issue.code for issue in error.value.issues}
    assert {"HEIGHT_REQUIRED", "IMAGE_REQUIRED"}.issubset(codes)
