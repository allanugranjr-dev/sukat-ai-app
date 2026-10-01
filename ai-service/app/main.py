from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from app.core.config import Settings, model_asset_status, optional_dependency_status
from app.pipeline import SAFE_SCAN_ID, BodyScanPipeline, PipelineFailure
from app.schemas.api import BodyScanResponse, ErrorResponse, ProcessingStatus, ScanQuality, ServiceHealth


settings = Settings.from_env()
settings.output_dir.mkdir(parents=True, exist_ok=True)
pipeline = BodyScanPipeline(settings)
app = FastAPI(title="SukatAI AI Service", version="1.0.0")
stored_scans: dict[str, BodyScanResponse] = {}
scan_tasks: dict[str, asyncio.Task[None]] = {}
scan_semaphore = asyncio.Semaphore(settings.max_concurrent_scans)

if settings.allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-API-Key"],
    )


def _authorized(
    authorization: Annotated[str | None, Header()] = None,
    x_api_key: Annotated[str | None, Header()] = None,
) -> None:
    if not settings.api_key:
        return
    bearer = authorization.removeprefix("Bearer ").strip() if authorization else ""
    if bearer != settings.api_key and x_api_key != settings.api_key:
        raise HTTPException(status_code=401, detail="The AI service API key is invalid or missing.")


def _error_response(error: PipelineFailure) -> JSONResponse:
    body = ErrorResponse(
        error=error.message,
        code=error.code,
        details=list(error.issues),
    )
    return JSONResponse(status_code=error.status_code, content=body.model_dump(mode="json"))


def _with_model_url(response: BodyScanResponse, request: Request) -> BodyScanResponse:
    # Return same-origin relative paths. The Node and Edge gateways resolve
    # them against the configured provider origin, so a reverse proxy cannot
    # accidentally publish an internal localhost hostname in a stored result.
    status_path = f"/api/v1/body-scan/{response.scan_id}/status"
    update: dict[str, object] = {"status_url": status_path}
    if response.model is not None:
        update["model"] = response.model.model_copy(
            update={"url": f"/api/v1/body-scan/{response.scan_id}/model-file"},
        )
    return response.model_copy(update=update)


def _validate_scan_id(scan_id: str) -> str:
    if not SAFE_SCAN_ID.fullmatch(scan_id):
        raise HTTPException(status_code=400, detail="scan_id contains unsafe characters.")
    return scan_id


async def _read_upload(upload: UploadFile | None) -> bytes | None:
    if upload is None:
        return None
    data = await upload.read(settings.max_upload_bytes + 1)
    await upload.close()
    return data


def _update_progress(scan_id: str, progress: int, message: str) -> None:
    current = stored_scans.get(scan_id)
    if current is None or current.status in {ProcessingStatus.completed, ProcessingStatus.failed}:
        return
    stage = ProcessingStatus.validating if progress <= 10 else ProcessingStatus.processing
    stored_scans[scan_id] = current.model_copy(
        update={"status": stage, "progress": max(current.progress, progress), "status_message": message}
    )


async def _run_scan(scan_id: str, images: dict[str, bytes], height_cm: float, request: Request, sex: str | None = None) -> None:
    async with scan_semaphore:
        _update_progress(scan_id, 10, "Starting private scan validation.")
        try:
            result = await asyncio.to_thread(pipeline.process, scan_id, images, height_cm, lambda value, message: _update_progress(scan_id, value, message), sex)
            stored_scans[scan_id] = _with_model_url(result, request)
        except PipelineFailure as error:
            current = stored_scans.get(scan_id)
            stored_scans[scan_id] = BodyScanResponse(
                scan_id=scan_id,
                status=ProcessingStatus.failed,
                progress=min(99, max(0, current.progress if current else 0)),
                status_message=error.message,
                error_code=error.code,
                scan_quality=ScanQuality.poor,
                quality_issues=list(error.issues),
                processing_version="sukatai-anny-clad-v1",
            )
        except Exception:
            current = stored_scans.get(scan_id)
            stored_scans[scan_id] = BodyScanResponse(
                scan_id=scan_id,
                status=ProcessingStatus.failed,
                progress=min(99, max(0, current.progress if current else 0)),
                status_message="The scan could not be completed. Your private photos were not removed.",
                error_code="PROCESSING_FAILED",
                scan_quality=ScanQuality.poor,
                processing_version="sukatai-anny-clad-v1",
            )
        finally:
            scan_tasks.pop(scan_id, None)


@app.get("/health", response_model=ServiceHealth)
async def health() -> ServiceHealth:
    dependencies = optional_dependency_status()
    # Health is intentionally unauthenticated for load balancers and should
    # not disclose the service's local filesystem layout.
    assets = model_asset_status(settings, include_paths=False)
    required_ready = all(dependencies.get(name, False) for name in ("PIL", "numpy", "trimesh"))
    return ServiceHealth(
        status="ok" if required_ready else "degraded",
        service="sukatai-ai-service",
        assets=assets,
        optional_dependencies=dependencies,
    )


@app.get("/api/v1/body-scan/status")
async def processing_status(_: None = Depends(_authorized)) -> dict[str, object]:
    assets = model_asset_status(settings)
    dependencies = optional_dependency_status()
    return {
        "service": "sukatai-ai-service",
        "configured_backend": settings.reconstruction_backend,
        "device": settings.resolved_device(),
        "processing_states": ["queued", "validating", "processing", "completed", "failed"],
        "assets": assets,
        "optional_dependencies": dependencies,
        "stored_scan_count": len(stored_scans),
        "message": "MediaPipe validation, bounded CPU Anny fitting, CLAD-Body measurements, and GLB validation are required before completion.",
    }


@app.get("/api/v1/body-scan/{scan_id}/status")
async def body_scan_status(scan_id: str, request: Request, _: None = Depends(_authorized)) -> dict[str, object]:
    _validate_scan_id(scan_id)
    result = stored_scans.get(scan_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Body scan was not found in this service instance.")
    status_payload = {
        "scan_id": scan_id,
        "status": result.status.value,
        "progress": result.progress,
        "status_message": result.status_message,
        "error_code": result.error_code,
        "scan_quality": result.scan_quality.value,
        "processing_version": result.processing_version,
        "model_available": result.model is not None,
    }
    # A completed status poll must carry the same authoritative result as the
    # resource endpoint. This lets the Node and Edge gateways poll a short
    # 202 response and then persist the exact CLAD measurements and GLB without
    # inventing a second provider contract.
    if result.status in {ProcessingStatus.completed, ProcessingStatus.failed}:
        return _with_model_url(result, request).model_dump(mode="json")
    return status_payload


@app.post("/api/v1/body-scan", response_model=BodyScanResponse)
async def create_body_scan(
    request: Request,
    front_image: Annotated[UploadFile | None, File()] = None,
    side_image: Annotated[UploadFile | None, File()] = None,
    back_image: Annotated[UploadFile | None, File()] = None,
    height_cm: float | None = None,
    scan_id: str | None = None,
    sex: str | None = None,
    _: None = Depends(_authorized),
) -> BodyScanResponse | JSONResponse:
    # Query parameters are accepted as a convenient curl/Node integration
    # path; multipart form fields can be added later without changing the
    # image contract.
    form = await request.form()
    if height_cm is None and form.get("height_cm") not in (None, ""):
        try:
            height_cm = float(str(form.get("height_cm")))
        except ValueError:
            height_cm = None
    if not sex and form.get("sex") not in (None, ""):
        sex = str(form.get("sex"))
    if not scan_id:
        supplied_scan_id = form.get("scan_id")
        scan_id = str(supplied_scan_id).strip() if supplied_scan_id else None
    resolved_scan_id = scan_id or uuid4().hex
    images = {
        "front": await _read_upload(front_image),
        "side": await _read_upload(side_image),
    }
    if back_image is not None:
        images["back"] = await _read_upload(back_image)
    payload = {key: value for key, value in images.items() if value is not None}
    if height_cm is None:
        return _error_response(PipelineFailure("Height is required for calibration.", "HEIGHT_REQUIRED", 422))
    if resolved_scan_id in stored_scans and stored_scans[resolved_scan_id].status in {ProcessingStatus.queued, ProcessingStatus.validating, ProcessingStatus.processing}:
        return JSONResponse(status_code=202, content=_with_model_url(stored_scans[resolved_scan_id], request).model_dump(mode="json"))
    queued = BodyScanResponse(
        scan_id=resolved_scan_id,
        status=ProcessingStatus.queued,
        # Queued is a lifecycle state, not completed provider work. Keep the
        # initial value at zero so clients never display a made-up percentage.
        progress=0,
        status_message="Your private scan is queued for CPU processing.",
        scan_quality=ScanQuality.acceptable,
        processing_version="sukatai-anny-clad-v1",
    )
    stored_scans[resolved_scan_id] = queued
    scan_tasks[resolved_scan_id] = asyncio.create_task(_run_scan(resolved_scan_id, payload, float(height_cm), request, sex))
    response = JSONResponse(status_code=202, content=_with_model_url(queued, request).model_dump(mode="json"))
    response.headers["Location"] = f"/api/v1/body-scan/{resolved_scan_id}/status"
    return response


@app.get("/api/v1/body-scan/{scan_id}", response_model=BodyScanResponse)
async def get_body_scan(scan_id: str, request: Request, _: None = Depends(_authorized)) -> BodyScanResponse:
    _validate_scan_id(scan_id)
    result = stored_scans.get(scan_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Body scan was not found in this service instance.")
    return _with_model_url(result, request)


@app.get("/api/v1/body-scan/{scan_id}/measurements")
async def get_measurements(scan_id: str, _: None = Depends(_authorized)) -> dict[str, object]:
    _validate_scan_id(scan_id)
    result = stored_scans.get(scan_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Body scan was not found in this service instance.")
    return {"scan_id": scan_id, "measurements": [item.model_dump(mode="json") for item in result.measurements]}


@app.get("/api/v1/body-scan/{scan_id}/model")
async def get_model(scan_id: str, request: Request, _: None = Depends(_authorized)) -> dict[str, object]:
    _validate_scan_id(scan_id)
    result = stored_scans.get(scan_id)
    if result is None or result.model is None:
        raise HTTPException(status_code=404, detail="A body model was not found for this scan.")
    return {"scan_id": scan_id, "model": _with_model_url(result, request).model.model_dump(mode="json")}


@app.get("/api/v1/body-scan/{scan_id}/model-file")
async def get_model_file(scan_id: str, _: None = Depends(_authorized)) -> FileResponse:
    _validate_scan_id(scan_id)
    result = stored_scans.get(scan_id)
    model_path = settings.output_dir / f"{scan_id}.glb"
    if result is None or result.model is None or not model_path.is_file():
        raise HTTPException(status_code=404, detail="A body model file was not found for this scan.")
    return FileResponse(
        path=Path(model_path),
        media_type="model/gltf-binary",
        filename=f"{scan_id}.glb",
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
    )
