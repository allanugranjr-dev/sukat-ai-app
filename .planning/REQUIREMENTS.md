# Requirements: SukatAI — Real-photo measurement overlay

**Milestone goal:** Stop generating any 3D body model as the primary result. Instead
show the customer's real scan photo with each measurement drawn as a labeled guide
line at its correct body position, on whichever view reads clearest. Keep the
existing 3D mannequin behind a toggle.

Requirements the existing app already satisfies (scan flow, validation, measurement
computation, dual-runtime API, auth) are documented in `.planning/PROJECT.md` under
"Validated" and are not re-listed here.

## v1 (this milestone)

### Overlay display (OVL)

- **OVL-01** — The customer's real scan photo is the default result view (replacing the 3D mannequin as default).
- **OVL-02** — Each returned measurement is drawn as a guide line on the photo at its correct body position.
- **OVL-03** — Each guide line is labeled with the measurement name, value, and unit (e.g. "Waist 78 cm"), respecting the user's cm/ftin preference.
- **OVL-04** — Each measurement is shown on whichever captured view (front or side) reads clearest for it ("best view per measurement").
- **OVL-05** — The overlay stays aligned to the body as the photo scales, on both desktop (centered ~480px column) and mobile.
- **OVL-06** — A toggle switches between the photo overlay view and the existing 3D mannequin view.

### Pipeline / coordinates (PIPE)

- **PIPE-01** — The AI service emits, per measurement, 2D overlay geometry (guide-line endpoints) in normalized image coordinates, keyed to the source view (front/side), plus each source view's pixel dimensions.
- **PIPE-02** — Overlay coordinates are derived on the CPU from data already computed (silhouette `level_fraction`/widths + pose landmarks). No new heavy models, no cloud, no CUDA.
- **PIPE-03** — The 2D overlay payload is validated by a Pydantic schema (mirroring `GuideGeometry`) with finite/bounded coordinate checks.

### Contract / data (API)

- **API-01** — The scan-result payload delivers the 2D overlay geometry to the client on the Node runtime.
- **API-02** — The client can retrieve the customer's front/side photos to display (existing `asset.signedUrl` / asset endpoint).
- **API-03** — Overlay geometry persists with the scan result, so re-opening a completed scan shows the overlay without reprocessing.

### Parity / resilience (PAR)

- **PAR-01** — The PHP/XAMPP runtime returns the same response shape; overlay geometry may be empty on the demo runtime.
- **PAR-02** — When overlay geometry is absent or incomplete, the client falls back to showing the photo plus a measurement list (no lines) without crashing.

## v2 (deferred, not this milestone)

- Adjustable/draggable line positions for dressmaker correction
- Show all measurements on all available views simultaneously
- Back-view overlay
- Export an annotated measurement image to share with the dressmaker

## Out of Scope

- Photoreal digital twin / real-person-generated 3D model
- Cloud GPU processing
- Garment try-on, cloth simulation, generated 3D garments
- Face / close-up capture

## Traceability

| Requirement | Phase | Primary files |
|-------------|-------|---------------|
| PIPE-01, PIPE-02, PIPE-03 | 1 | `ai-service/app/pipeline.py`, `ai-service/app/measurements/tailoring.py`, `ai-service/app/schemas/api.py` |
| API-01, API-03, PAR-01 | 2 | `server/index.mjs`, `server/aiService.mjs`, `xampp/api/index.php`, `xampp/database/sukatai.sql` |
| API-02 | 2 | `server/index.mjs`, `src/lib/nodeApi.ts` |
| OVL-01..05, PAR-02 | 3 | `src/App.tsx`, `src/lib/types.ts`, `src/styles.css` |
| OVL-06 | 4 | `src/App.tsx` |
