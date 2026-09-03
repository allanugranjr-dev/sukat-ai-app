from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
import app.main as main_module
from app.pipeline import BodyScanPipeline
import app.pipeline as pipeline_module
from app.schemas.api import BodyScanResponse, ProcessingStatus, ScanQuality
from test_silhouette_pipeline import build_settings, fitted_body_fixture
from helpers import make_body_image


def test_api_processes_multipart_scan_and_exposes_result_endpoints(tmp_path: Path, monkeypatch) -> None:
    settings = build_settings(tmp_path)
    monkeypatch.setattr(main_module, "settings", settings)
    monkeypatch.setattr(main_module, "pipeline", BodyScanPipeline(settings))
    monkeypatch.setattr(pipeline_module, "validate_pose", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        BodyScanPipeline,
        "_anny_targets",
        staticmethod(lambda *args, **kwargs: ({"height_cm": 170.0, "bust_cm": 100.0, "waist_cm": 82.0}, {"view_height_difference": 0.01})),
    )
    monkeypatch.setattr(pipeline_module, "fit_anny_body", lambda *args, **kwargs: fitted_body_fixture())
    main_module.stored_scans.clear()

    with TestClient(app) as client:
        files = {
            "front_image": ("front.png", make_body_image(), "image/png"),
            "side_image": ("side.png", make_body_image(), "image/png"),
            "back_image": ("back.png", make_body_image(), "image/png"),
        }
        response = client.post(
            "/api/v1/body-scan",
            files=files,
            data={"height_cm": "170", "scan_id": "api-scan-1"},
        )

        assert response.status_code == 202
        payload = response.json()
        assert payload["scan_id"] == "api-scan-1"
        assert payload["status"] == "queued"
        assert payload["progress"] == 0

        status = client.get("/api/v1/body-scan/api-scan-1/status").json()
        assert status["status"] in {"queued", "validating", "processing", "completed"}
        assert status["progress"] >= 0
        assert response.headers["location"].endswith("/api/v1/body-scan/api-scan-1/status")
        assert "status_message" in status
        assert "error_code" in status


def test_api_rejects_unsafe_scan_id_before_lookup() -> None:
    client = TestClient(app)
    response = client.get("/api/v1/body-scan/..%2Foutside/status")
    assert response.status_code in {400, 404}


def test_completed_status_poll_contains_authoritative_result(tmp_path: Path, monkeypatch) -> None:
    settings = build_settings(tmp_path)
    monkeypatch.setattr(main_module, "settings", settings)
    main_module.stored_scans.clear()
    main_module.stored_scans["api-completed"] = BodyScanResponse(
        scan_id="api-completed",
        status=ProcessingStatus.completed,
        progress=100,
        status_message="Ready",
        scan_quality=ScanQuality.acceptable,
        measurements=[{"key": "height", "value": 170, "unit": "cm", "method": "mesh", "confidence": None, "source": "test-provider"}],
        model={"format": "glb", "size_bytes": 128},
        processing_version="test-v1",
    )
    with TestClient(app) as client:
        response = client.get("/api/v1/body-scan/api-completed/status")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["measurements"][0]["value"] == 170
    assert payload["model"]["url"].endswith("/api/v1/body-scan/api-completed/model-file")
