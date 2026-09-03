# CPU Release Resource Contract — SukatAI

**Target laptop**: Lenovo ThinkPad L380 (Intel integrated-GPU CPU, no CUDA).

## Release Resource Contract

The active CPU provider (`anny_clad`) is configured with the following bounds for the L380 release. These bounds are enforced by the provider code and protected from regression by automated tests.

| Resource | Bound | Enforcement |
|----------|-------|-------------|
| Device | `cpu` (never auto-selects CUDA) | `Settings.resolved_device()` always returns `"cpu"` |
| AI mode | `low_end` | `SUKATAI_AI_MODE=low_end` (default) |
| Max image long edge | **1280 px** | `MAX_IMAGE_LONG_EDGE=1280` — downsamples before inference |
| Max concurrent scans | **1** | `MAX_CONCURRENT_SCANS=1` — `asyncio.Semaphore(1)` in `main.py` |
| Max upload size | **10 MB** | `MAX_UPLOAD_BYTES=10_485_760` — bounded read, in-memory only |
| Min image dimensions | 320 × 480 px | `image_validator.py` rejects smaller |
| Max image dimension (guard) | 8000 px | `image_validator.py` rejects larger |
| Photos retained | No | Uploads processed in memory; only GLB written to disk |

**Explicit statement**: The two-view front/side scan is practical on the L380 CPU. CUDA is not required and is never auto-selected by the provider, even if present on the development machine.

## Provider Configuration (Environment Variables)

| Variable | Default | Purpose |
|----------|---------|---------|
| `SUKATAI_AI_MODE` | `low_end` | Selects bounded CPU resource profile |
| `RECONSTRUCTION_BACKEND` | `anny_clad` | Active reconstruction backend |
| `MAX_IMAGE_LONG_EDGE` | `1280` | Long-edge downsample bound before inference |
| `MAX_CONCURRENT_SCANS` | `1` | Single active job semaphore |
| `MAX_UPLOAD_BYTES` | `10485760` (10 MB) | Upload byte limit |
| `ANNY_MAX_ITERATIONS` | `60` | Fitter iteration cap |
| `ANNY_EARLY_STOP_DELTA` | `0.002` | Convergence threshold |
| `SMPLX_MODEL_DIR` | `./models/smplx` | SMPL-X model assets |
| `PIXIE_MODEL_DIR` | `./models/pixie` | PIXIE model assets |
| `ANTHROPOMETRY_DIR` | `./vendor/SMPL-Anthropometry` | Anthropometry adapter assets |
| `OUTPUT_DIR` | `./output` | GLB export directory |
| `POSE_LANDMARKER_MODEL_PATH` | `./models/pose_landmarker_lite.task` | MediaPipe pose landmarker asset |
| `AI_SERVICE_API_KEY` | *(empty)* | Optional bearer key for `/api/v1/*` |
| `ALLOWED_ORIGINS` | `http://127.0.0.1:5173,http://localhost:5173` | CORS origins |

## Local Startup & Verification

```powershell
cd ai-service
.\.venv\Scripts\Activate.ps1
python scripts/system_check.py   # Reports device, bounds, and model assets
python -m pytest -q ai-service/tests
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The `system_check.py` output now includes:
- `max_image_long_edge`
- `max_concurrent_scans`
- `max_upload_bytes`
- `ai_mode`
- `device` (always `cpu`)

## What This Is Not

- This is not a customer-facing accuracy claim.
- CUDA/GPU acceleration is intentionally disabled for the release path.
- The `anny_clad` backend is the only production-selected backend; PIXIE, SMPL-X, and silhouette modules remain for compatibility/diagnostics only.

---
*See also: `ai-service/README.md`, `ai-service/scripts/system_check.py`, `ai-service/tests/test_resource_bounds.py`*