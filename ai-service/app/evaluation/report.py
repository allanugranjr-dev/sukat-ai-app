from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping

from app.evaluation.reference import EvaluationReference

# Provider measurement keys to tape-reference aliases. A tape measure uses a
# simple body-part name ("chest", "waist") while the provider persists a longer
# canonical key ("chest_circumference"). Matching happens on the normalized
# measurement key directly first, then through this alias table.
MEASUREMENT_ALIASES: Mapping[str, str] = {
    "chest_circumference": "chest",
    "waist_circumference": "waist",
    "hip_circumference": "hip",
    "thigh_left_circumference": "thigh",
    "thigh_right_circumference": "thigh",
    "upper_arm": "upperarm",
    "upperarm_cm": "upperarm",
    "shoulder_width_cm": "shoulder",
    "inseam_cm": "inseam",
    "bust_cm": "chest",
    "waist_cm": "waist",
    "hip_cm": "hip",
    "height_cm": "height",
}
ALIAS_BY_PROVIDER_KEY: Mapping[str, str] = {
    normalized: alias for normalized, alias in MEASUREMENT_ALIASES.items()
}
# Reverse alias map: reference/tape alias → all matching provider keys.
# A reference key like "chest" maps to "chest_circumference" AND "bust_cm".
REFERENCE_ALIASES_TO_PROVIDER_KEYS: Mapping[str, list[str]] = {}
for _provider_key, _alias in MEASUREMENT_ALIASES.items():
    REFERENCE_ALIASES_TO_PROVIDER_KEYS.setdefault(_alias, []).append(_provider_key)


def provider_value_cm(measurement: Mapping[str, Any]) -> float | None:
    """Return a measurement's value in centimeters, or None when absent/invalid."""
    value = measurement.get("value")
    unit = str(measurement.get("unit", "cm")).strip().lower()
    if unit != "cm":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return round(number, 2)


def _provider_measurements(result: Mapping[str, Any]) -> dict[str, float]:
    """Flatten a BodyScanResponse-shaped mapping into {normalized_key: cm}."""
    by_key: dict[str, float] = {}
    for measurement in result.get("measurements", []) or []:
        if not isinstance(measurement, Mapping):
            continue
        raw_key = measurement.get("key")
        if not isinstance(raw_key, str):
            continue
        normalized = raw_key.strip().lower()
        if not normalized:
            continue
        value_cm = provider_value_cm(measurement)
        if value_cm is None:
            continue
        by_key[normalized] = value_cm
    return by_key


@dataclass(frozen=True)
class MeasurementError:
    key: str
    provider_cm: float | None
    reference_cm: float
    delta_cm: float | None
    error_cm: float | None
    error_pct: float | None


@dataclass(frozen=True)
class EvaluationReport:
    internal_evaluation: bool = True
    measurement_errors: list[MeasurementError] = field(default_factory=list)
    matched_count: int = 0
    referenced_count: int = 0
    note: str = (
        "Internal evaluation only — per-measurement error is not a "
        "customer-facing accuracy claim."
    )


def evaluate_result(
    result: Mapping[str, Any],
    references: Iterable[EvaluationReference],
) -> EvaluationReport:
    """Compare a provider result with tape references (read-only, pure).

    Returns per-measurement error for references that have a matching provider
    value. A reference with no provider match is emitted with ``None`` error
    fields and is excluded from the matched count — it is never assigned a
    fabricated error. This function never mutates ``result`` and never writes
    anywhere.
    """
    provider_by_key = _provider_measurements(result)
    report: list[MeasurementError] = []
    matched = 0
    referenced = 0

    for reference in references:
        if not reference.consented:
            continue
        referenced += 1
        key = reference.key.strip().lower()
        provider_cm = provider_by_key.get(key)
        if provider_cm is None:
            for candidate in REFERENCE_ALIASES_TO_PROVIDER_KEYS.get(key, []):
                provider_cm = provider_by_key.get(candidate)
                if provider_cm is not None:
                    break
        if provider_cm is None:
            report.append(
                MeasurementError(
                    key=key,
                    provider_cm=None,
                    reference_cm=reference.value_cm,
                    delta_cm=None,
                    error_cm=None,
                    error_pct=None,
                )
            )
            continue
        matched += 1
        delta_cm = round(provider_cm - reference.value_cm, 2)
        error_cm = round(abs(delta_cm), 2)
        error_pct = round(error_cm / reference.value_cm * 100.0, 2) if reference.value_cm > 0 else None
        report.append(
            MeasurementError(
                key=key,
                provider_cm=provider_cm,
                reference_cm=reference.value_cm,
                delta_cm=delta_cm,
                error_cm=error_cm,
                error_pct=error_pct,
            )
        )

    return EvaluationReport(
        measurement_errors=report,
        matched_count=matched,
        referenced_count=referenced,
    )
