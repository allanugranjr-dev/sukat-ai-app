from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

import numpy as np

# A measurement key that maps to a provider value in centimeters.
# Values are bounded so a malformed reference cannot distort an error report.
MIN_REFERENCE_CM = 5.0
MAX_REFERENCE_CM = 300.0


@dataclass(frozen=True)
class EvaluationReference:
    key: str
    value_cm: float
    source: str = "tape"
    consented: bool = True


def _finite_cm(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(number):
        return None
    if number < MIN_REFERENCE_CM or number > MAX_REFERENCE_CM:
        return None
    return round(number, 2)


def _normalize_key(key: Any) -> str | None:
    if not isinstance(key, str):
        return None
    normalized = key.strip().lower()
    if not normalized:
        return None
    # Keep only reasonably short, safe measurement keys.
    if len(normalized) > 64 or any(char.isspace() for char in normalized):
        return None
    return normalized


def parse_references(data: Mapping[str, Any] | list[Any] | None) -> list[EvaluationReference]:
    """Parse a tape-reference dataset into valid, consented references.

    Both a dict of {key: cm} and a list of {key, value_cm, ...} records are
    accepted. Malformed rows are dropped rather than raised, so an operator
    error cannot crash an internal evaluation run. References are used only
    for internal evaluation and never alter production values.
    """
    if data is None:
        return []
    records: list[Any]
    if isinstance(data, Mapping):
        records = [{"key": key, "value_cm": value} for key, value in data.items()]
    elif isinstance(data, list):
        records = list(data)
    else:
        return []

    references: list[EvaluationReference] = []
    for record in records:
        if not isinstance(record, Mapping):
            continue
        key = _normalize_key(record.get("key"))
        if key is None:
            continue
        value_cm = _finite_cm(record.get("value_cm") if "value_cm" in record else record.get("value"))
        if value_cm is None:
            continue
        consented = bool(record.get("consented", True))
        if not consented:
            continue
        source = str(record.get("source", "tape")).strip().lower() or "tape"
        references.append(EvaluationReference(key=key, value_cm=value_cm, source=source, consented=True))
    return references
