from __future__ import annotations

import math

import pytest

from app.schemas.api import MeasurementMethod, MeasurementValue


class TestMeasurementValueNormalization:
    """QA-01: provider normalization coverage."""

    def test_finite_value_within_bounds_passes(self) -> None:
        m = MeasurementValue(key="chest", value=103.0, unit="cm", method=MeasurementMethod.mesh, source="provider")
        assert m.value == 103.0

    def test_value_is_rounded_to_2_decimal_places(self) -> None:
        m = MeasurementValue(key="chest", value=103.456, unit="cm", method=MeasurementMethod.mesh, source="provider")
        assert m.value == 103.46

    def test_negative_value_rejected(self) -> None:
        with pytest.raises(ValueError):
            MeasurementValue(key="chest", value=-10.0, unit="cm", method=MeasurementMethod.mesh, source="provider")

    def test_zero_value_rejected(self) -> None:
        with pytest.raises(ValueError):
            MeasurementValue(key="chest", value=0.0, unit="cm", method=MeasurementMethod.mesh, source="provider")

    def test_value_over_500_rejected(self) -> None:
        with pytest.raises(ValueError):
            MeasurementValue(key="chest", value=501.0, unit="cm", method=MeasurementMethod.mesh, source="provider")

    def test_nan_rejected(self) -> None:
        with pytest.raises(ValueError):
            MeasurementValue(key="chest", value=math.nan, unit="cm", method=MeasurementMethod.mesh, source="provider")

    def test_positive_inf_rejected(self) -> None:
        with pytest.raises(ValueError):
            MeasurementValue(key="chest", value=float("inf"), unit="cm", method=MeasurementMethod.mesh, source="provider")

    def test_negative_inf_rejected(self) -> None:
        with pytest.raises(ValueError):
            MeasurementValue(key="chest", value=float("-inf"), unit="cm", method=MeasurementMethod.mesh, source="provider")

    def test_unit_is_forced_to_cm_literal(self) -> None:
        m = MeasurementValue(key="chest", value=100.0, unit="cm", method=MeasurementMethod.mesh, source="provider")
        assert m.unit == "cm"

    def test_unit_is_strictly_lowercase_cm(self) -> None:
        # Unit is a literal "cm" - case sensitive
        m = MeasurementValue(key="chest", value=100.0, unit="cm", method=MeasurementMethod.mesh, source="provider")
        assert m.unit == "cm"

    def test_confidence_is_nullable(self) -> None:
        m = MeasurementValue(key="chest", value=100.0, unit="cm", method=MeasurementMethod.mesh, source="provider")
        assert m.confidence is None

    def test_confidence_can_be_set(self) -> None:
        m = MeasurementValue(key="chest", value=100.0, unit="cm", method=MeasurementMethod.mesh, source="provider", confidence=85.0)
        assert m.confidence == 85.0

    def test_confidence_must_be_0_to_100(self) -> None:
        with pytest.raises(ValueError):
            MeasurementValue(key="chest", value=100.0, unit="cm", method=MeasurementMethod.mesh, source="provider", confidence=150.0)

    def test_method_is_required(self) -> None:
        with pytest.raises(ValueError):  # pydantic requires the field
            MeasurementValue(key="chest", value=100.0, unit="cm", source="provider")

    def test_source_is_required(self) -> None:
        with pytest.raises(ValueError):  # pydantic requires the field
            MeasurementValue(key="chest", value=100.0, unit="cm", method=MeasurementMethod.mesh)

    def test_method_and_source_are_preserved(self) -> None:
        m = MeasurementValue(
            key="waist",
            value=82.0,
            unit="cm",
            method=MeasurementMethod.circumference,
            source="clad-body-fitted-anny"
        )
        assert m.method == MeasurementMethod.circumference
        assert m.source == "clad-body-fitted-anny"

    def test_key_pattern_enforced(self) -> None:
        m = MeasurementValue(key="chest_circumference", value=100.0, unit="cm", method=MeasurementMethod.mesh, source="provider")
        assert m.key == "chest_circumference"

    def test_invalid_key_pattern_rejected(self) -> None:
        with pytest.raises(ValueError):
            MeasurementValue(key="bad key!", value=100.0, unit="cm", method=MeasurementMethod.mesh, source="provider")

    def test_extra_fields_forbidden(self) -> None:
        with pytest.raises(ValueError):
            MeasurementValue(key="chest", value=100.0, unit="cm", method=MeasurementMethod.mesh, source="provider", extra_field="not allowed")

    def test_duplicate_keys_rejected_in_batch(self) -> None:
        from app.schemas.api import BodyScanResponse, ProcessingStatus, ScanQuality

        with pytest.raises(ValueError) as exc:
            BodyScanResponse(
                scan_id="dup-test",
                status=ProcessingStatus.completed,
                progress=100,
                scan_quality=ScanQuality.good,
                processing_version="v1",
                measurements=[
                    MeasurementValue(key="chest", value=100.0, unit="cm", method=MeasurementMethod.mesh, source="provider"),
                    MeasurementValue(key="chest", value=102.0, unit="cm", method=MeasurementMethod.mesh, source="provider"),
                ]
            )
        assert "duplicate" in str(exc.value).lower()