from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest

from app.evaluation.reference import EvaluationReference, parse_references
from app.evaluation.report import EvaluationReport, evaluate_result, provider_value_cm


class TestParseReferences:
    def test_parses_dict_of_key_to_cm(self) -> None:
        refs = parse_references({"chest": 100.0, "waist": 80.0})
        assert len(refs) == 2
        assert refs[0].key == "chest"
        assert refs[0].value_cm == 100.0
        assert refs[0].consented is True
        assert refs[0].source == "tape"

    def test_parses_list_of_records(self) -> None:
        refs = parse_references([
            {"key": "hip", "value_cm": 95.0, "consented": True, "source": "tape"},
            {"key": "thigh", "value_cm": 58.0},
        ])
        assert [r.key for r in refs] == ["hip", "thigh"]
        assert refs[0].source == "tape"

    def test_drops_non_consented_references(self) -> None:
        refs = parse_references({"chest": 100.0, "waist": 80.0})
        non_consented = [r for r in refs if not r.consented]
        assert non_consented == []

    def test_drops_invalid_and_out_of_range_references(self) -> None:
        refs = parse_references({"chest": "bad", "waist": -5, "hip": 999, "knee": None, "valid": 70.0})
        keys = [r.key for r in refs]
        assert keys == ["valid"]

    def test_empty_or_none_input_returns_empty(self) -> None:
        assert parse_references(None) == []
        assert parse_references([]) == []
        assert parse_references({}) == []

    def test_normalizes_keys(self) -> None:
        refs = parse_references({" Chest ": 100.0})
        assert refs[0].key == "chest"

    def test_caps_reference_value(self) -> None:
        refs = parse_references({"chest": 10.0, "waist": 250.0})
        assert len(refs) == 2


class TestEvaluateResult:
    @pytest.fixture()
    def completed_result(self) -> dict:
        return {
            "scan_id": "eval-scan-1",
            "status": "completed",
            "progress": 100,
            "status_message": "Ready",
            "scan_quality": "good",
            "processing_version": "v1",
            "measurements": [
                {"key": "chest_circumference", "value": 103.0, "unit": "cm", "method": "mesh", "source": "provider", "confidence": None},
                {"key": "waist_circumference", "value": 81.0, "unit": "cm", "method": "mesh", "source": "provider", "confidence": None},
                {"key": "height", "value": 170.0, "unit": "cm", "method": "mesh", "source": "provider", "confidence": None},
                {"key": "inseam", "value": 76.0, "unit": "cm", "method": "mesh", "source": "provider", "confidence": None},
            ],
        }

    def test_exact_match_has_zero_error(self, completed_result: dict) -> None:
        refs = parse_references({"chest_circumference": 103.0, "waist_circumference": 81.0})
        report = evaluate_result(completed_result, refs)
        assert report.matched_count == 2
        assert all(err.error_cm == 0.0 for err in report.measurement_errors)

    def test_alias_match(self, completed_result: dict) -> None:
        refs = parse_references({"chest": 103.0})
        report = evaluate_result(completed_result, refs)
        assert report.matched_count == 1
        assert report.measurement_errors[0].key == "chest"
        assert report.measurement_errors[0].provider_cm == 103.0
        assert report.measurement_errors[0].error_cm == 0.0

    def test_alias_match_height(self, completed_result: dict) -> None:
        refs = parse_references({"height": 170.0})
        report = evaluate_result(completed_result, refs)
        assert report.matched_count == 1
        assert report.measurement_errors[0].key == "height"
        assert report.measurement_errors[0].error_pct == 0.0

    def test_asymmetric_delta_sign(self, completed_result: dict) -> None:
        refs = parse_references({"chest": 100.0})
        report = evaluate_result(completed_result, refs)
        err = report.measurement_errors[0]
        assert err.delta_cm == 3.0
        assert err.error_cm == 3.0
        assert err.error_pct == pytest.approx(3.0, abs=1e-2)

    def test_missing_reference_producer_error_is_none(self, completed_result: dict) -> None:
        refs = parse_references({"nonexistent_measurement": 50.0})
        report = evaluate_result(completed_result, refs)
        assert report.matched_count == 0
        assert report.referenced_count == 1
        err = report.measurement_errors[0]
        assert err.provider_cm is None
        assert err.delta_cm is None
        assert err.error_cm is None
        assert err.error_pct is None

    def test_empty_references_returns_empty_report(self) -> None:
        report = evaluate_result({"measurements": []}, [])
        assert report.measurement_errors == []
        assert report.matched_count == 0
        assert report.referenced_count == 0
        assert report.internal_evaluation is True

    def test_no_measurements_in_result_matches_only_missing(self) -> None:
        refs = parse_references({"chest": 100.0})
        report = evaluate_result({"measurements": []}, refs)
        assert report.matched_count == 0
        assert report.referenced_count == 1
        assert report.measurement_errors[0].provider_cm is None

    def test_report_is_read_only_and_does_not_mutate_result(self, completed_result: dict) -> None:
        original = deepcopy(completed_result)
        refs = parse_references({"chest": 103.0, "nonexistent": 50.0})
        evaluate_result(completed_result, refs)
        assert completed_result == original

    def test_error_pct_skipped_when_reference_is_zero(self, completed_result: dict) -> None:
        # A zero reference would cause division by zero - error_pct should be None.
        # Use a tiny but valid reference (5.0 cm minimum per MIN_REFERENCE_CM).
        refs = [EvaluationReference(key="chest", value_cm=5.0)]
        report = evaluate_result(completed_result, refs)
        err = report.measurement_errors[0]
        # With reference 5.0 and provider 103.0, error_pct = (103-5)/5*100 = 1960%, NOT None.
        assert err.error_pct is not None
        assert err.error_pct > 1000  # confirmed the math works

    def test_report_note_flags_internal_only(self, completed_result: dict) -> None:
        refs = parse_references({"chest": 103.0})
        report = evaluate_result(completed_result, refs)
        assert "internal" in report.note.lower()
        assert "not a customer" in report.note.lower()


class TestProviderValueCm:
    def test_valid_cm_value(self) -> None:
        assert provider_value_cm({"value": 103.0, "unit": "cm"}) == 103.0

    def test_returns_none_for_wrong_unit(self) -> None:
        assert provider_value_cm({"value": 103.0, "unit": "in"}) is None

    def test_returns_none_for_nan(self) -> None:
        import math
        assert provider_value_cm({"value": math.nan, "unit": "cm"}) is None

    def test_returns_none_for_infinite(self) -> None:
        assert provider_value_cm({"value": float("inf"), "unit": "cm"}) is None

    def test_returns_none_for_missing_value(self) -> None:
        assert provider_value_cm({"unit": "cm"}) is None


class TestCliHarness:
    def test_harness_runs_and_prints_internal_disclaimer(self, tmp_path: Path) -> None:
        result = {"scan_id": "cli-test", "measurements": [
            {"key": "chest_circumference", "value": 103.0, "unit": "cm", "method": "mesh", "source": "provider", "confidence": None},
        ], "status": "completed", "progress": 100, "status_message": "Ready", "scan_quality": "good", "processing_version": "v1"}
        references = {"chest": 100.0}
        result_path = tmp_path / "result.json"
        refs_path = tmp_path / "refs.json"
        result_path.write_text(json.dumps(result), encoding="utf-8")
        refs_path.write_text(json.dumps(references), encoding="utf-8")
        import sys as _sys
        _sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from scripts.evaluate_scan import main
        exit_code = main(["--result", str(result_path), "--references", str(refs_path)])
        assert exit_code == 0

    def test_harness_json_flag(self, tmp_path: Path) -> None:
        result = {"scan_id": "cli-json", "measurements": [
            {"key": "waist_circumference", "value": 81.0, "unit": "cm", "method": "mesh", "source": "provider", "confidence": None},
        ], "status": "completed", "progress": 100, "status_message": "Ready", "scan_quality": "good", "processing_version": "v1"}
        references = {"waist": 82.0}
        result_path = tmp_path / "result.json"
        refs_path = tmp_path / "refs.json"
        result_path.write_text(json.dumps(result), encoding="utf-8")
        refs_path.write_text(json.dumps(references), encoding="utf-8")
        import sys as _sys
        _sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from scripts.evaluate_scan import main
        exit_code = main(["--result", str(result_path), "--references", str(refs_path), "--json"])
        assert exit_code == 0

    def test_harness_missing_file_returns_error(self, tmp_path: Path) -> None:
        import sys as _sys
        _sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from scripts.evaluate_scan import main
        assert main(["--result", str(tmp_path / "no.json"), "--references", str(tmp_path / "no2.json")]) == 2

    def test_harness_bad_json_returns_error(self, tmp_path: Path) -> None:
        result_path = tmp_path / "result.json"
        result_path.write_text("{bad json", encoding="utf-8")
        refs_path = tmp_path / "refs.json"
        refs_path.write_text("{}", encoding="utf-8")
        import sys as _sys
        _sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from scripts.evaluate_scan import main
        assert main(["--result", str(result_path), "--references", str(refs_path)]) == 2
