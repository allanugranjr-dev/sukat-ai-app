from __future__ import annotations

"""Read-only internal evaluation harness for TRUTH-04.

Loads a stored provider result JSON and a tape-reference JSON, then prints a
per-measurement error report. This harness is deliberately read-only: it never
touches a database, never writes to disk, and never mutates production values.
The output is explicitly marked as an internal evaluation, not a customer-
facing accuracy claim.
"""

import argparse
import json
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.evaluation.reference import parse_references  # noqa: E402
from app.evaluation.report import evaluate_result  # noqa: E402


def _print_table(errors: list) -> None:
    print(f"{'key':<28} {'provider':>9} {'reference':>10} {'delta':>8} {'error cm':>9} {'error %':>8}")
    print("-" * 78)
    for row in errors:
        key = str(row.key).strip().lower()
        provider = f"{row.provider_cm:.1f}" if row.provider_cm is not None else "-"
        reference = f"{row.reference_cm:.1f}" if row.reference_cm is not None else "-"
        delta = f"{row.delta_cm:+.1f}" if row.delta_cm is not None else "-"
        error_cm = f"{row.error_cm:.1f}" if row.error_cm is not None else "-"
        error_pct = f"{row.error_pct:.1f}%" if row.error_pct is not None else "-"
        print(f"{key:<28} {provider:>9} {reference:>10} {delta:>8} {error_cm:>9} {error_pct:>8}")


def _print_json(errors: list) -> None:
    print(
        json.dumps(
            [{"key": str(e.key).strip().lower(), "provider_cm": e.provider_cm, "reference_cm": e.reference_cm,
              "delta_cm": e.delta_cm, "error_cm": e.error_cm, "error_pct": e.error_pct} for e in errors],
            indent=2,
        )
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Internal, read-only evaluation of a provider result against tape references."
    )
    parser.add_argument("--result", required=True, help="Path to a provider result JSON (BodyScanResponse).")
    parser.add_argument("--references", required=True, help="Path to a tape-reference JSON (dict of key -> cm).")
    parser.add_argument("--json", action="store_true", dest="as_json", help="Print per-measurement errors as JSON.")
    args = parser.parse_args(argv)

    result_path = Path(args.result)
    references_path = Path(args.references)

    if not result_path.is_file():
        print(f"Error: result file not found: {result_path}", file=sys.stderr)
        return 2
    if not references_path.is_file():
        print(f"Error: reference file not found: {references_path}", file=sys.stderr)
        return 2

    try:
        result = json.loads(result_path.read_text(encoding="utf-8"))
        references_raw = json.loads(references_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        print(f"Error: cannot read JSON: {error}", file=sys.stderr)
        return 2

    if not isinstance(result, dict):
        print("Error: result JSON must be an object", file=sys.stderr)
        return 2
    if not isinstance(references_raw, (dict, list)):
        print("Error: references JSON must be a dict or list", file=sys.stderr)
        return 2

    references = parse_references(references_raw)
    report = evaluate_result(result, references)

    print("Internal evaluation — not a customer accuracy claim.")
    print(f"Matched {report.matched_count}/{report.referenced_count} referenced measurements.\n")
    if not report.measurement_errors:
        print("No measurements to report.")
        return 0

    if args.as_json:
        _print_json(report.measurement_errors)
    else:
        _print_table(report.measurement_errors)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
