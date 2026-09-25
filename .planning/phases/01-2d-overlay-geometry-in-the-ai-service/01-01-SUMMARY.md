---
phase: 01-2d-overlay-geometry-in-the-ai-service
plan: 01
subsystem: api
tags: [overlay-geometry, silhouette, pydantic, numpy, cpu, pipeline]

# Dependency graph
requires:
  - phase: (none)
    provides: existing SilhouetteProfile + guide_fractions already computed in the pipeline
provides:
  - _overlay_geometry() helper deriving per-measurement normalized 2D guide lines
  - _anny_targets 3-tuple return (targets, target_metadata, resolved) wiring resolved profiles into process()
  - reconstruction.overlay_geometry dict on BodyScanResponse (image-normalized, view-keyed)
affects: [01-02 overlay Pydantic schema + clean rejection, Phase 2 dual-runtime parity, Phase 3 photo rendering]

# Actuals (#2632)
actuals:
  tokens: 6951
  tasks: 2
  commits: 4

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level geometry helper mirroring _guide_geometry, emitting a plain dict shaped for a later Pydantic promotion"
    - "Return-tuple refactor to hand back an already-bound resource instead of re-computing it"

key-files:
  created:
    - ai-service/tests/test_overlay_geometry.py
  modified:
    - ai-service/app/pipeline.py
    - ai-service/tests/test_silhouette_pipeline.py

key-decisions:
  - "Emitted overlay as an unvalidated dict via ReconstructionMetadata extra=allow; the declared OverlayGeometry schema is 01-02"
  - "upper_arm omitted entirely in v1 — profile stores per-row width scalars, not run x-positions, so no truthful arm segment"
  - "Line view tagged from profile.view (swap-safe), never a string literal by analysis role"

patterns-established:
  - "Overlay derivation reuses resolved silhouette profiles with a single resolve_front_side_profiles call (CPU budget preserved)"
  - "Truthful-or-omitted lines: any zero-width level or non-finite fraction draws no line while the value stays in measurements"

requirements-completed: [PIPE-01, PIPE-02]

coverage:
  - id: D1
    description: "process() attaches reconstruction.overlay_geometry with a truthful waist_circumference line and matching per-view width_px/height_px (PIPE-01)"
    requirement: PIPE-01
    verification:
      - kind: unit
        ref: "tests/test_overlay_geometry.py#test_overlay_present_with_dims"
        status: pass
    human_judgment: false
  - id: D2
    description: "Horizontal endpoints reproduce width_at(fraction) centered on the bbox; y == round(bottom - fraction*height_px); coords in [0,1] (D-08/D-09/D-10)"
    requirement: PIPE-01
    verification:
      - kind: unit
        ref: "tests/test_overlay_geometry.py#test_endpoints_match_silhouette"
        status: pass
    human_judgment: false
  - id: D3
    description: "On a swapped scan every emitted line.view equals resolved.front.view, the submitted slot (D-07)"
    requirement: PIPE-01
    verification:
      - kind: unit
        ref: "tests/test_overlay_geometry.py#test_view_tag_follows_submitted_slot"
        status: pass
    human_judgment: false
  - id: D4
    description: "Zero-width levels and upper_arm draw no line while their values remain in measurements (D-02)"
    requirement: PIPE-01
    verification:
      - kind: unit
        ref: "tests/test_overlay_geometry.py#test_unanchorable_line_omitted"
        status: pass
      - kind: unit
        ref: "tests/test_overlay_geometry.py#test_upper_arm_never_drawn"
        status: pass
    human_judgment: false
  - id: D5
    description: "Overlay derivation runs on CPU: resolve_front_side_profiles invoked exactly once and reconstruction.device == 'cpu' (PIPE-02)"
    requirement: PIPE-02
    verification:
      - kind: unit
        ref: "tests/test_overlay_geometry.py#test_cpu_only_no_reresolve"
        status: pass
    human_judgment: false

# Metrics
duration: 37min
completed: 2026-09-25
status: complete
---

# Phase 1 Plan 01: 2D overlay geometry in the AI service Summary

**CPU-only `_overlay_geometry()` derives per-measurement normalized guide lines from the already-resolved SilhouetteProfile, wired back through `_anny_targets`' new 3-tuple return and attached as `reconstruction.overlay_geometry`.**

## Performance

- **Duration:** ~37 min
- **Started:** 2026-09-25T15:14Z
- **Completed:** 2026-09-25T15:51Z
- **Tasks:** 2
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments
- `_anny_targets` now returns `(targets, target_metadata, resolved)`, handing the already-bound `ResolvedSilhouetteProfiles` back to `process()` — the single missing wire — with no second `resolve_front_side_profiles` call.
- New module-level `_overlay_geometry()` emits one truthful line per anchorable measurement: chest/waist/hip/thigh (`circumference`), shoulder (`width`), height/inseam (`length`), each normalized to [0,1] on the drawing profile's dims and tagged with its swap-safe `.view`.
- `upper_arm` and any zero-width/non-finite level are omitted (truthful-or-nothing, D-02); the values still appear in `response.measurements`.
- Overlay attaches as a dict on `ReconstructionMetadata` (`extra="allow"`) so 01-02 can wrap it in a declared schema without reworking the derivation.

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1: End-to-end waist overlay line through process()** — `0be83e5` (test), `cbfdd0d` (feat)
2. **Task 2: Expand overlay to all anchorable measurements** — `3f04678` (test), `e7d0405` (feat)

**Plan metadata:** committed separately (docs: complete plan)

## Files Created/Modified
- `ai-service/app/pipeline.py` — `_anny_targets` 3-tuple return; `_OVERLAY_FRACTION_KEYS`/`_OVERLAY_FIXED_FRACTIONS` maps; `_overlay_geometry()` helper; `process()` unpacks `resolved` and attaches `overlay_geometry`.
- `ai-service/tests/test_overlay_geometry.py` — new module: presence/dims, endpoint math, view-swap, omission, upper_arm, CPU-once.
- `ai-service/tests/test_silhouette_pipeline.py` — two monkeypatched `_anny_targets` lambdas updated to the 3-tuple arity.

## Decisions Made
- Overlay is emitted as an unvalidated dict in this plan (attaches via `extra="allow"`); the declared `OverlayGeometry` Pydantic schema and clean-rejection (PIPE-03) are plan 01-02, as scoped.
- `height` spans feet→head with `level_fraction` 1.0; `inseam` spans crotch→feet with `level_fraction` from `crotch_fraction()`; both are vertical center-line dimension lines.
- Line `view` and per-view dims are read from the drawing profile (`resolved.front`), which carries the submitted slot even after an analysis swap (D-07).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. The `test_overlay_present_with_dims` tracer runs the real `_anny_targets` (colour-distance silhouette on the synthetic body image, no HOG/hog-body-prior), confirmed by probe before writing the test.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- 01-02 can now wrap the emitted dict shape in `OverlayView`/`OverlayLine`/`OverlayGeometry` and add guarded clean-rejection without touching the derivation.
- Full ai-service suite green (74 passed); plan `<verify>` (`test_overlay_geometry.py` + `test_silhouette_pipeline.py`) green (14 passed).

---
*Phase: 01-2d-overlay-geometry-in-the-ai-service*
*Completed: 2026-09-25*

## Self-Check: PASSED

- Files created/modified verified present: `ai-service/tests/test_overlay_geometry.py`, `ai-service/app/pipeline.py`, `01-01-SUMMARY.md`.
- Task commits verified in git history: `0be83e5`, `cbfdd0d`, `3f04678`, `e7d0405`.
- Plan `<verify>` green: `test_overlay_geometry.py` + `test_silhouette_pipeline.py` (14 passed); full ai-service suite 74 passed.
