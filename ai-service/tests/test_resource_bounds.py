from __future__ import annotations

import os
from pathlib import Path
import sys

import pytest

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.core.config import Settings
from app.validation.image_validator import validate_image
from helpers import make_body_image


class TestConfigDefaults:
    def test_config_defaults_bound_cpu_resources(self, monkeypatch) -> None:
        """Assert the built-in CPU/resource defaults cannot silently regress."""
        # Clear any env that might override defaults
        for var in ("SUKATAI_AI_MODE", "RECONSTRUCTION_BACKEND", "MAX_IMAGE_LONG_EDGE",
                    "MAX_CONCURRENT_SCANS", "MAX_UPLOAD_BYTES"):
            monkeypatch.delenv(var, raising=False)

        settings = Settings.from_env()

        assert settings.resolved_device() == "cpu", "Device must be cpu (never CUDA)"
        assert settings.ai_mode == "low_end"
        assert settings.max_image_long_edge == 1280, "Long edge bound must be 1280 px"
        assert settings.max_concurrent_scans == 1, "Concurrency must be 1 (single active job)"
        assert settings.max_upload_bytes == 10 * 1024 * 1024, "Upload bound must be 10 MB"


class TestImageDownsampling:
    def test_oversized_image_is_downsampled(self) -> None:
        """An image larger than max_image_long_edge is downsampled to that bound."""
        large = make_body_image(width=2000, height=4000)
        result = validate_image(large, "front", 10 * 1024 * 1024, max_image_long_edge=1280)
        assert max(result.width, result.height) == 1280
        assert min(result.width, result.height) > 0

    def test_undersized_image_is_rejected(self) -> None:
        """The validator rejects images below 320x480 minimum dimensions."""
        from app.validation.image_validator import ImageValidationError
        tiny = make_body_image(width=64, height=128)
        with pytest.raises(ImageValidationError) as exc:
            validate_image(tiny, "front", 10 * 1024 * 1024, max_image_long_edge=1280)
        codes = [issue.code for issue in exc.value.issues]
        assert "IMAGE_TOO_SMALL" in codes


class TestConcurrency:
    def test_in_memory_concurrency_default_is_one(self) -> None:
        """The FastAPI app's semaphore is bound to settings.max_concurrent_scans."""
        # Clear env to get defaults
        for var in ("MAX_CONCURRENT_SCANS",):
            os.environ.pop(var, None)
        import importlib
        import app.main as main_module
        importlib.reload(main_module)
        try:
            assert main_module.scan_semaphore._value == 1
        finally:
            # Restore original module state for other tests
            importlib.reload(main_module)