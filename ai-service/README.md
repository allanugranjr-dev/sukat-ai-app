# SukatAI AI service

This directory contains the isolated Python boundary for body-scan processing. It accepts private front/side (and optional back) images, validates them, fits a CPU-only Anny body, measures that fitted mesh with CLAD-Body, calibrates the mesh to the submitted height in centimetres, and exports a GLB model.

## Current behavior

The active `anny_clad` backend fails closed unless MediaPipe Lite can validate one full person in each required view and the real Anny/CLAD packages can produce a fitted mesh. It uses a bounded coordinate search and one active job at a time for the target low-end CPU. No confidence percentage is fabricated; the provider returns `null` when it cannot calculate one.

The older PIXIE, SMPL-X, SMPL-Anthropometry, and silhouette modules remain isolated for compatibility and diagnostics. They are not selected by the active pipeline until a separately verified runner is registered. See [MODEL_SETUP.md](MODEL_SETUP.md).

## Run locally

```powershell
cd ai-service
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
Copy-Item .env.example .env
python scripts/download_pose_model.py
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The pose asset is about 6 MB, is downloaded from the official MediaPipe model
hosting URL, and is ignored by Git. The service refuses to process a scan when
the asset is missing instead of silently switching to a template.

The service exposes OpenAPI documentation at `http://127.0.0.1:8000/docs`.

## API

- `GET /health` — dependency, device, and model-asset diagnostics. This endpoint is public so a deployment probe can use it.
- `GET /api/v1/body-scan/status` — configured backend, available processing states, assets, and dependency diagnostics.
- `POST /api/v1/body-scan` — multipart submission with `front_image`, `side_image`, optional `back_image`, `height_cm`, and optional safe `scan_id`.
- `GET /api/v1/body-scan/{scan_id}` — complete result.
- `GET /api/v1/body-scan/{scan_id}/status` — queued progress; once complete, the same authoritative measurements and model metadata as the result endpoint.
- `GET /api/v1/body-scan/{scan_id}/measurements` — measurement values with method and source metadata.
- `GET /api/v1/body-scan/{scan_id}/model` — model artifact metadata.
- `GET /api/v1/body-scan/{scan_id}/model-file` — exported GLB file.

If `AI_SERVICE_API_KEY` is configured, all `/api/v1/*` endpoints require either `Authorization: Bearer <key>` or `X-API-Key: <key>`. Do not put this key in browser code.

Example submission:

```powershell
curl.exe -X POST http://127.0.0.1:8000/api/v1/body-scan `
  -F "front_image=@front.jpg" `
  -F "side_image=@side.jpg" `
  -F "height_cm=170" `
  -F "scan_id=scan-demo-1"
```

Uploads are read with a bounded byte limit and processed in memory; the service does not retain the uploaded photos. Only the generated GLB is written to `OUTPUT_DIR`. Scan status is held in memory inside this provider because the Node/Supabase integration owns durable scan state and private storage. Restarting the provider alone clears its in-flight queue; the gateway can retry the persisted scan.

## Checks

From the repository root:

```powershell
ai-service\.venv\Scripts\python.exe ai-service\scripts\system_check.py
ai-service\.venv\Scripts\python.exe -m pytest -q ai-service\tests
```

The system check reports missing model assets clearly. Missing assets are expected until licensed checkpoints are installed and never cause a fabricated personalized result.
