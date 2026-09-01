# Technology Stack

**Project:** SukatAI
**Researched:** 2026-09-02
**Research method:** Orchestrator recovery using the existing codebase, cached GSD research questions, and primary official documentation after four parallel researcher workers stalled before writing files.

## Recommended Stack

### Core Framework

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| React + React DOM | Existing 19.x | Customer, tailor, and administrator SPA | Retain the working role-aware UI and Capacitor reuse. |
| Vite | Existing 8.x | Web, Node, and mobile builds | Already provides the runtime-mode build separation; no replacement is needed. |
| Three.js + GLTFLoader | Existing 0.185.1 | Interactive GLB viewer and measurement guides | GLTFLoader is the established glTF 2.0 path; use existing LineLoop/line primitives for guides rather than adding a viewer library. |

### Measurement and Reconstruction

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| MediaPipe Pose Landmarker | Existing `mediapipe==1.0.1` | Full-body pose validation and landmarks | Use image-mode detection for still front/side uploads; keep the lightweight model and validate model-file availability. The official Python API exposes `create_from_options` and `detect` for this use. |
| OpenCV headless | Existing `>=4.10,<5` | Resize, masks, morphology, contours, and connected components | Deterministic CPU preprocessing is already central to the service and avoids desktop GUI dependencies. |
| NumPy, Pillow, trimesh | Existing pins/ranges | Array operations, safe image decoding, mesh measurement, and GLB export | Required by the current pipeline; retain rather than introducing another geometry stack. |
| Anny/CLAD adapters | Existing project code | Bounded CPU fitting and anthropometric measurement | Keep the current adapter boundary and version the provider output; do not substitute an unverified model. |

### Backend and Persistence

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| FastAPI + Uvicorn | Existing `fastapi>=0.115,<1`, `uvicorn[standard]>=0.34,<1` | Private Python provider API | Keep the isolated provider API. Heavy fitting should be handled by a bounded worker/job path, not assumed to complete inside a short request. |
| Express + MariaDB + Socket.IO | Existing | Local Node runtime, persistence, and live status | Preserve local development and XAMPP-adjacent workflows; add durable attempt state before changing queue behavior. |
| Supabase Auth/Postgres/Storage/Edge Functions/Realtime | Existing | Hosted production auth, private assets, persistence, orchestration, and status | Keep Supabase as the hosted authority. Edge Functions should orchestrate and update durable state; heavy reconstruction belongs in the external Python service. |
| Capacitor | Existing | Android/iOS shell | Preserve the mobile shell and fix the shared web flow rather than creating a separate mobile implementation. |

## Recommended Data Contract

The provider result should remain versioned and explicit:

```text
scan_id
provider + provider_version + processing_version
status: validated | processing | ready | failed
scan_quality: good | acceptable | poor
quality_issues: string[]
measurements: value + unit + method + source + nullable confidence
model artifact reference
guide levels/contours in the model coordinate system
calibrated height and calibration metadata
fit diagnostics for internal review only
```

`confidence: null` means no calibrated provider confidence exists. It must not be converted from fitting loss or input quality. An accuracy percentage should only be computed by a separate evaluation path with independent tape measurements.

For guide geometry, keep the persisted preview metadata as the browser-facing contract and optionally duplicate a compact integrity/version marker in glTF `extras`. glTF supports application-specific `extras`, but it does not define measurement-guide runtime behavior; the app must own and version that contract.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Pose | Existing MediaPipe Pose Landmarker | Heavy pose or body model | Adds CPU/RAM cost and conflicts with the target laptop. |
| Image processing | OpenCV + current segmentation fallback | Browser-only segmentation | Would duplicate provider logic and produce different measurements. |
| 3D display | Existing Three.js GLB viewer | New viewer/component library | Adds dependency and risks breaking private asset loading and current interactions. |
| Long-running jobs | Durable DB attempt state plus bounded provider worker | FastAPI in-process background task as the only queue | FastAPI documents `BackgroundTasks` for deferred work but recommends larger tools for heavy computation; in-memory state is not restart-safe. |
| Hosted processing | Supabase function as authenticated orchestrator + external CPU provider | Run fitting inside Edge Function | Edge Functions have strict memory, CPU, and wall-clock limits; heavy jobs should be moved to background workers. |
| Accuracy display | Ground-truth evaluation report | Inferred percentage from quality/fitting loss | It would be misleading and is unsupported by the current dataset. |

## Installation

No new package is required for the first implementation phase. Keep the existing lockfiles and Python requirements. Only add a dependency if a measured gap cannot be solved with the current adapters and the dependency is approved explicitly.

## Sources

- [MediaPipe Pose Landmarker Python API](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/PoseLandmarker) — image/video detection API.
- [OpenCV contour tutorial](https://docs.opencv.org/doc/doxygen/html/d4/d73/tutorial_py_contours_begin.html) and [shape/connected-components API](https://docs.opencv.org/doc/doxygen/html/d3/dc0/group__imgproc__shape.html).
- [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html).
- [Khronos glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html), including `extras` and extension rules.
- [FastAPI background tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/) and [server workers](https://fastapi.tiangolo.com/deployment/server-workers/).
- [Supabase private Storage and signed URLs](https://supabase.com/docs/guides/storage/serving/downloads), [Edge Functions](https://supabase.com/docs/guides/functions), and [function limits](https://supabase.com/docs/guides/functions/limits).
