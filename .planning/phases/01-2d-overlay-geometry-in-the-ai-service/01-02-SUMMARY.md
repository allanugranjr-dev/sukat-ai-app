---
phase: 01-2d-overlay-geometry-in-the-ai-service
plan: 02
subsystem: api
tags: [overlay-geometry, pydantic, validation, silhouette, cpu, pipeline]

# Dependency graph
requires:
  - phase: 01-01
    provides: _overlay_geometry() dict shape + reconstruction.overlay_geometry attach point (extra=allow)
provides:
  - OverlayView/OverlayLine/OverlayGeometry Pydantic models (finite/[0,1]-bounded, extra=forbid)
  - overlay_geometry declared field on ReconstructionMetadata (typed, view-keyed contract)
  - guarded OverlayGeometry(**overlay) construction in process() raising PipelineFailure(INVALID_PROVIDER_RESULT, 502)
affects: [Phase 2 dual-runtime parity (matching overlay shape), Phase 3 photo rendering]

# Actuals (#2632)
actuals:
  tokens: 1850
  tasks: 2
  commits: 4

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Overlay models mirror GuideLine/GuideGeometry finite/bounded/extra=forbid conventions, bounded to [0,1] instead of meters"
    - "model_validator(mode=after) cross-field check: every line.view must have a matching key in views"
    - "Guarded schema construction outside the processing try/except converts ValidationError to a stable PipelineFailure, mirroring _measurement_values"

key-files:
  created: []
  modified:
    - ai-service/app/schemas/api.py
    - ai-service/app/pipeline.py
    - ai-service/tests/test_overlay_geometry.py

key-decisions:
  - "overlay_geometry declared on ReconstructionMetadata (extra=allow), NOT as a top-level BodyScanResponse field (stays extra=forbid)"
  - "points validator bounds coords to [0,1] (image-normalized) and rounds survivors to 5 dp; rejects non-finite / out-of-range"
  - "process() passes the validated OverlayGeometry instance, or None when no lines were drawn (least-surprising)"

patterns-established:
  - "Guarded promotion of an unvalidated pipeline dict into a declared schema, re-raising a domain PipelineFailure so a malformed provider result never escapes as an unhandled 500"

requirements-completed: [PIPE-01, PIPE-03]

coverage:
  - id: D1
    description: "OverlayGeometry with OverlayView/OverlayLine exists; points validator rejects non-finite / out-of-[0,1] coords and rounds to 5 dp (PIPE-03)"
    requirement: PIPE-03
    verification:
      - kind: unit
        ref: "tests/test_overlay_geometry.py#test_schema_accepts_valid_overlay"
        status: pass
      - kind: unit
        ref: "tests/test_overlay_geometry.py#test_malformed_rejected"
        status: pass
    human_judgment: false
  - id: D2
    description: "ReconstructionMetadata declares overlay_geometry: OverlayGeometry | None = None — typed, view-keyed contract with per-view width_px/height_px (PIPE-01, PIPE-03)"
    requirement: PIPE-01
    verification:
      - kind: unit
        ref: "tests/test_overlay_geometry.py#test_overlay_present_with_dims"
        status: pass
    human_judgment: false
  - id: D3
    description: "A malformed overlay (NaN/inf/out-of-[0,1] point, or line.view absent from views) is rejected cleanly as PipelineFailure INVALID_PROVIDER_RESULT / HTTP 502, not an unhandled 500 (PIPE-03)"
    requirement: PIPE-03
    verification:
      - kind: unit
        ref: "tests/test_overlay_geometry.py#test_malformed_rejected_is_clean_502"
        status: pass
    human_judgment: false
  - id: D4
    description: "points bounded (min_length=2/max_length=8); width_px/height_px gt=0/le=4096; every overlay model extra=forbid (PIPE-03, DoS mitigation)"
    requirement: PIPE-03
    verification:
      - kind: unit
        ref: "tests/test_overlay_geometry.py#test_malformed_rejected"
        status: pass
    human_judgment: false

# Metrics
duration: 10min
completed: 2026-09-25
status: complete
---

# Phase 1 Plan 02: 2D overlay geometry in the AI service Summary

**The 01-01 overlay dict is now a declared, finite/[0,1]-bounded Pydantic contract (`OverlayView`/`OverlayLine`/`OverlayGeometry`) on `ReconstructionMetadata`, with guarded construction in `process()` that rejects a malformed payload cleanly as `PipelineFailure(INVALID_PROVIDER_RESULT, 502)` instead of crashing with a 500.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-09-25T16:11Z
- **Completed:** 2026-09-25T16:21Z
- **Tasks:** 2
- **Files modified:** 3 (0 created, 3 modified)

## Accomplishments
- Added three models to `schemas/api.py` next to `GuideGeometry`, each `extra="forbid"`: `OverlayView` (`width_px`/`height_px` `Field(gt=0, le=4096)`), `OverlayLine` (`view`/`kind` literals, `points` `Field(min_length=2, max_length=8)` with a finite + `[0,1]` + `round(5)` validator mirroring `GuideLine.finite_points`, nullable `level_fraction`), and `OverlayGeometry` (dict-keyed `views`/`lines` with a key validator plus a `model_validator(mode="after")` requiring every `line.view` to exist in `views`).
- Declared `overlay_geometry: OverlayGeometry | None = None` on `ReconstructionMetadata` directly under `guide_geometry`; `BodyScanResponse` is untouched (stays `extra="forbid"`).
- Guarded the overlay promotion in `process()`: `OverlayGeometry(**overlay_dict)` runs inside a try/except catching `pydantic.ValidationError`/`ValueError` and re-raising `PipelineFailure(..., "INVALID_PROVIDER_RESULT", 502)` — because `ReconstructionMetadata(...)` is built outside the guarded processing try/except, this is exactly where a raw `ValidationError` would otherwise surface as a 500.
- Full ai-service suite green: 77 passed (Wave 1 baseline 74 + 3 new overlay tests).

## Task Commits

Each task was committed atomically (TDD RED then GREEN):

1. **Task 1: OverlayView/OverlayLine/OverlayGeometry schema + declared field** — `08412d0` (test), `b96407f` (feat)
2. **Task 2: Validated construction + clean rejection in process()** — `edf4054` (test), `be3c4ac` (feat)

**Plan metadata:** committed separately (docs: complete plan).

## Files Created/Modified
- `ai-service/app/schemas/api.py` — new `OverlayView`/`OverlayLine`/`OverlayGeometry` classes; `overlay_geometry` field on `ReconstructionMetadata`; `model_validator` added to the pydantic import.
- `ai-service/app/pipeline.py` — import `OverlayGeometry` and `pydantic`; guarded `OverlayGeometry(**overlay_dict)` construction re-raising `PipelineFailure(INVALID_PROVIDER_RESULT, 502)`; passes the validated instance (or `None` when no lines) into `ReconstructionMetadata`.
- `ai-service/tests/test_overlay_geometry.py` — added `test_schema_accepts_valid_overlay`, `test_malformed_rejected`, `test_malformed_rejected_is_clean_502`, plus a `_valid_overlay_dict()` helper and `pydantic` / `OverlayGeometry` imports.

## Decisions Made
- Overlay coords are bounded to `[0,1]` (image-normalized) rather than the meters bound `abs(coordinate) > 100` used by `GuideLine`; everything else (5-dp rounding, `extra="forbid"`, dict-keyed containers, key validator) mirrors the guide-geometry precedent verbatim.
- The view-presence cross-field check is a `model_validator(mode="after")` so it can see both `views` and `lines`; it raises `ValueError` (surfaced by pydantic as `ValidationError`) naming the offending line and view.
- `process()` stores `None` (not an empty `OverlayGeometry`) when no lines are drawn, so the field reads as "no overlay" rather than an empty contract; existing tests only exercise the non-empty path (height is always drawn when `front` is present), so this branch is currently untested by design.

## Deviations from Plan

### Notes

**1. [Note] Unavoidable bundling of pre-existing pivot edits in `schemas/api.py`**
- **Found during:** Task 1 (feat commit `b96407f`).
- **Issue:** The working tree carried pre-existing, unrelated milestone-pivot edits to `ai-service/app/schemas/api.py` (~38 insertions) that could not be separated from my schema additions non-interactively.
- **Resolution:** Staged the whole file per plan guidance; commit `b96407f` therefore bundles those pre-existing api.py edits alongside the three overlay models. This bundling was confined to `schemas/api.py`; every other file (`pipeline.py`, `tests/test_overlay_geometry.py`) was staged individually and swept in no unrelated changes.
- **Commit:** `b96407f`

Otherwise, plan executed as written.

## Issues Encountered
None. Because Task 1 already declared `overlay_geometry` as an `OverlayGeometry` type, the Task 2 RED test failed exactly as the plan predicted — a raw `pydantic.ValidationError` at the `ReconstructionMetadata(...)` construction (a 500-equivalent) — which the guarded construction then converted to the clean 502.

## User Setup Required
None — no external service configuration, no new dependencies (reuses pydantic/numpy already in `ai-service/requirements.txt`).

## Next Phase Readiness
- The overlay is now a typed, validated, view-keyed contract, ready for Phase 2 (PHP runtime returns a matching, possibly empty, overlay shape) and Phase 3 (photo rendering over the `image-normalized`, `top-left`-origin coordinates).
- Full ai-service suite green (77 passed); plan `<verify>` (`test_overlay_geometry.py` + `test_silhouette_pipeline.py`) green (17 passed).

---
*Phase: 01-2d-overlay-geometry-in-the-ai-service*
*Completed: 2026-09-25*

## Self-Check: PASSED

- Files modified verified present: `ai-service/app/schemas/api.py`, `ai-service/app/pipeline.py`, `ai-service/tests/test_overlay_geometry.py`.
- Task commits verified in git history: `08412d0`, `b96407f`, `edf4054`, `be3c4ac`.
- Plan `<verify>` green: `test_overlay_geometry.py` + `test_silhouette_pipeline.py` (17 passed); full ai-service suite 77 passed.
