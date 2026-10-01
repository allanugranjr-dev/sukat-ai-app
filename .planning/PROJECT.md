# SukatAI

## What This Is

SukatAI is a CPU-only AI body-measurement app for dressmakers and their customers.
A customer takes two guided phone photos (front + side) plus their height; the
service validates the photos, fits a parametric body on the CPU, and returns
tailoring measurements for made-to-measure garments. It runs as a React web app
and a Capacitor mobile app, backed by two interchangeable API runtimes (Node and
PHP/XAMPP) over MariaDB, with a Python FastAPI microservice for the AI pipeline.

## Core Value

Trustworthy tailoring measurements from a simple phone scan — now shown **on the
customer's own photo**, so they can see exactly where each measurement was taken
and trust the numbers.

## Business Context

Users are dressmakers/tailoring shops and their clients. Measurements feed the
order and fitting workflow. Trust in the numbers is the product: a measurement the
customer can visually verify against their own body is worth more than a number in
a table or a line on a generic gray mannequin.

## Requirements

### Validated (already built)

- Guided scan flow: consent → height → front/side capture → processing → results (`src/lib/scanFlow.ts`)
- CPU image + pose validation (`ai-service/app/validation/`)
- Anny parametric fit + CLAD/silhouette tailoring measurements calibrated to SnapMeasureAI (`ai-service/app/measurements/tailoring.py`)
- GLB 3D mannequin viewer with 3D guide lines (Three.js, `src/App.tsx`)
- Dual-runtime action-router API (Node `server/index.mjs`, PHP `xampp/api/index.php`) over MariaDB
- Auth: cookie sessions + bcrypt + email OTP; Socket.IO scan-status streaming

### Active (this milestone — "Real-photo measurement overlay")

See `.planning/REQUIREMENTS.md`. In short: display the customer's real scan photo
as the default result view, with each measurement drawn as a labeled guide line at
its correct body position, shown on whichever view (front/side) reads clearest.
Keep the existing 3D mannequin available behind a toggle.

### Out of Scope (explicitly considered and dropped)

- Photoreal digital twin / real-person-generated 3D model — **superseded by the pivot**
- Cloud GPU processing — stays CPU-only
- Garment try-on / cloth simulation / generated 3D garments
- Face / close-up capture (scan stays height + front + side only)

## Context

- The AI pipeline already computes the data needed for a 2D overlay (per-measurement
  vertical `level_fraction`, silhouette pixel dimensions, 2D pose landmarks) but only
  exports 3D GLB-space guide geometry (`GuideGeometry` in `ai-service/app/schemas/api.py`).
  The overlay milestone surfaces that discarded 2D data rather than computing anything new.
- The client already fetches the customer's front/side photos (`asset.signedUrl`,
  `previewUrl` in `src/App.tsx`) — the surface to draw on already exists.
- `src/App.tsx` is a ~3,300-line monolith; changes concentrate there.

## Constraints

- **CPU-only hard-lock.** Device is locked to `cpu`; never auto-select CUDA. Target
  is Intel integrated-GPU laptops.
- **Dual-runtime parity.** Any API contract change must be mirrored in both
  `server/index.mjs` and `xampp/api/index.php`. PHP/XAMPP is a demo runtime and may
  return empty overlay geometry, but the response shape must match.
- **Desktop renders like mobile:** centered ~480px column via container queries (no iframe).
- **Measurements are source-of-truth from the existing pipeline** — the overlay
  visualizes the CLAD/silhouette-derived values, it does not recompute or replace them.
- Anny gender macro is reversed: `gender=0.0` is MALE, `1.0` is FEMALE.
- Change nothing in the 3D model / pipeline until the roadmap is agreed ("ask first").

## Key Decisions

| Date | Decision | Why |
|------|----------|-----|
| 2026-09-25 | Pivot from photoreal 3D twin to measurement lines on the real photo | User: "dont make 3d model anymore just their real body with lines or the measurements" — simpler, more trustworthy, stays CPU-only |
| 2026-09-25 | Display = labeled lines + values drawn on the real photo | Customer verifies each measurement against their own body |
| 2026-09-25 | Show each measurement on its best view (front/side) | Some measurements (e.g. depth-based) read clearly only on one view |
| 2026-09-25 | Keep the existing 3D mannequin behind a toggle (photo view is default) | Preserve existing work at no cost; photo is the primary experience |
| 2026-09-25 | Derive 2D overlay coords from already-computed data (fractions/widths/pose) | No new models, no cloud, keeps the CPU-only guarantee |
| 2026-09-25 | PHP runtime returns matching (possibly empty) overlay shape; client degrades gracefully | Dual-runtime parity without requiring the demo runtime to run the pipeline |
