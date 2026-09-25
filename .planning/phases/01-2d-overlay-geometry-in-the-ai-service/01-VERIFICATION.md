---
phase: 01-2d-overlay-geometry-in-the-ai-service
verified: 2026-09-26T00:00:00Z
status: passed
score: 7/7 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 1: 2D overlay geometry in the AI service — Verification Report

**Phase Goal:** The AI service returns, per measurement, image-space guide-line endpoints keyed to the source view, computed on the CPU from existing silhouette fractions/widths and pose landmarks; schema-validated (finite, bounded) and rejected cleanly if malformed.
**Verified:** 2026-09-26
**Status:** passed
**Re-verification:** No — initial verification
**HEAD:** 7c3ccb5 (docs commit atop feat be3c4ac; both plans executed & committed)

## Goal Achievement

Goal-backward finding: the codebase actually delivers a truthful, typed, view-keyed 2D measurement overlay derived from already-computed data (guide_fractions × SilhouetteProfile widths), CPU-only, schema-validated with a clean 502 rejection path. Every claim was confirmed against source, not just SUMMARY.md. Full ai-service suite is green (77 passed).

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | A processed scan response carries `reconstruction.overlay_geometry` with, per drawn measurement, two normalized [0,1] endpoints, a `view`, a `kind`, and a matching per-view `width_px`/`height_px` (PIPE-01, SC1). | ✓ VERIFIED | `pipeline.py:333-445` builds the dict; `:660-679` validates + attaches; `:693-709` passes into `ReconstructionMetadata`. Test `test_overlay_geometry.py::test_overlay_present_with_dims` (full pipeline run) asserts 2 points, view, kind, integer per-view dims. |
| 2 | Horizontal endpoints reproduce `width_at(fraction)` centered on `(left+right)/2`, row = `bottom - fraction*height_px`, normalized on the tagged view's dims (D-08/09/10). | ✓ VERIFIED | `_horizontal_points` `pipeline.py:372-381` (cx center, np.clip norm, 5dp round). Test `test_endpoints_match_silhouette` proves `(x1-x0)*width_px == width_at`, midpoint == bbox center, `y*height_px == round(bottom - f*height_px)`, all coords in [0,1]. |
| 3 | On a role-swapped scan, every emitted line's `view` equals `resolved.front.view` (submitted slot), not the analysis role (D-07). | ✓ VERIFIED | View tagged from `front.view` attribute at `pipeline.py:402,414,425,438`. Behavioral test `test_view_tag_follows_submitted_slot` builds a forced-swap `ResolvedSilhouetteProfiles` and asserts every `line["view"] == resolved.front.view == "side"`. |
| 4 | An unanchorable measurement (`upper_arm`, `width_at==0`, or non-finite fraction) produces NO line while its value still appears in `measurements` (D-02). | ✓ VERIFIED | `upper_arm` absent from `_OVERLAY_FRACTION_KEYS`/`_OVERLAY_FIXED_FRACTIONS`, never appended; `_horizontal_points` returns None when `width_px<=0` (`:373-374`); circumference loop skips non-finite fraction (`:395-396`). Tests `test_unanchorable_line_omitted` (asserts values remain in `result.measurements`) and `test_upper_arm_never_drawn`. |
| 5 | Overlay derivation runs on CPU: `resolve_front_side_profiles` invoked exactly once per scan (no re-resolve) and `reconstruction.device` stays `"cpu"` (PIPE-02, SC2). | ✓ VERIFIED | `resolve_front_side_profiles(` appears exactly once (grep: `pipeline.py:465` only), inside `_anny_targets`; `resolved` handed back via 3-tuple and reused. `config.py:94-95 resolved_device()` returns `"cpu"`. Test `test_cpu_only_no_reresolve` asserts call count == 1 and `device == "cpu"`. No new model/dependency added. |
| 6 | `OverlayView`/`OverlayLine`/`OverlayGeometry` exist with `extra="forbid"`, finite/[0,1] point validator (5dp), bounded sizes (points 2..8; width_px/height_px gt=0/le=4096), view-presence cross-field validator; `overlay_geometry` declared on `ReconstructionMetadata`; `BodyScanResponse` unchanged (PIPE-01, PIPE-03). | ✓ VERIFIED | `schemas/api.py:160-224` (three models, all `ConfigDict(extra="forbid")`, `finite_points` validator `:185-196`, `points Field(min_length=2,max_length=8)`, `width_px/height_px Field(gt=0,le=4096)`, `views_cover_lines` model_validator `:217-224`). Declared field `:239`; `BodyScanResponse` still `extra="forbid"` `:243`. Tests `test_schema_accepts_valid_overlay`, `test_malformed_rejected`. |
| 7 | A malformed overlay (NaN/inf/out-of-[0,1] point, or `line.view` absent from `views`) is rejected as `PipelineFailure` code `INVALID_PROVIDER_RESULT` / status 502 — not an unhandled 500 (PIPE-03, SC3). | ✓ VERIFIED | Guarded construction `pipeline.py:671-678` wraps `OverlayGeometry(**overlay_dict)` in try/except catching `pydantic.ValidationError`/`ValueError`, re-raising `PipelineFailure(..., "INVALID_PROVIDER_RESULT", 502)`, placed OUTSIDE the processing try/except (which would otherwise 500). Behavioral test `test_malformed_rejected_is_clean_502` asserts `code=="INVALID_PROVIDER_RESULT"` and `status_code==502`. |

**Score:** 7/7 truths verified (0 present, behavior-unverified). All behavior-dependent truths (view-swap invariant, omission behavior, single-resolve/CPU invariant, clean-rejection path, endpoint math) are backed by passing behavioral tests — no VERIFIED rests on symbol presence alone.

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `ai-service/app/pipeline.py` | `_overlay_geometry()` + `_anny_targets` 3-tuple + guarded `OverlayGeometry` construction | ✓ VERIFIED | Helper `:333-445`; `_anny_targets` returns `(targets, target_metadata, resolved)` `:459-502`; `process()` unpacks `resolved` `:542` and attaches validated overlay `:707`. Wired & data-flowing. |
| `ai-service/app/schemas/api.py` | `OverlayView`/`OverlayLine`/`OverlayGeometry` + field on `ReconstructionMetadata` | ✓ VERIFIED | `:160-224`, field `:239`. Imported and used in `pipeline.py:24,672`. |
| `ai-service/tests/test_overlay_geometry.py` | Overlay invariant + schema + rejection tests | ✓ VERIFIED | 10 tests present, all green. |
| `ai-service/tests/test_silhouette_pipeline.py` | Two monkeypatched `_anny_targets` lambdas updated to 3-tuple arity | ✓ VERIFIED | Suite green under new arity (part of 77 passed). |

### Key Link Verification

| From | To | Via | Status |
| --- | --- | --- | --- |
| `_anny_targets` `resolved` | `process()` | 3-tuple unpack `pipeline.py:542` | ✓ WIRED |
| `resolved.front/side` | `_overlay_geometry(...)` | call `pipeline.py:660-665` | ✓ WIRED |
| `SilhouetteProfile.view` (swap-safe) | `OverlayLine.view` | `front.view` attribute reads | ✓ WIRED |
| `_overlay_geometry` dict | `OverlayGeometry(**dict)` | guarded construction `:672` | ✓ WIRED |
| `OverlayGeometry` instance | `ReconstructionMetadata.overlay_geometry` | ctor kwarg `:707` | ✓ WIRED |
| ValidationError | stable API 502 | `PipelineFailure(INVALID_PROVIDER_RESULT,502)` `:674-678` | ✓ WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Real Data | Status |
| --- | --- | --- | --- | --- |
| overlay lines | `points`, `width_px`, `height_px` | `SilhouetteProfile.width_at`/`bbox`/`image_*` derived from resolved silhouette | Yes | ✓ FLOWING |
| line fractions | `guide_fractions` | `fitted.guide_fractions` (CLAD), fixed anthropometric fallback | Yes | ✓ FLOWING |

No hardcoded/static overlay payload; when no line is anchorable the field is `None` (`pipeline.py:679`), not a fabricated value.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Full ai-service suite green | `python -m pytest -q` | 77 passed, 2 warnings, 13.5s | ✓ PASS |
| Single-resolve invariant | `test_cpu_only_no_reresolve` (in suite) | resolve count == 1, device cpu | ✓ PASS |
| Clean 502 rejection | `test_malformed_rejected_is_clean_502` | PipelineFailure 502 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| PIPE-01 | 01-01, 01-02 | Per-measurement normalized overlay endpoints keyed to view + per-view pixel dims | ✓ SATISFIED | Truths 1,2,3,6 |
| PIPE-02 | 01-01 | CPU-derived from existing data; no new model/GPU/cloud | ✓ SATISFIED | Truth 5 |
| PIPE-03 | 01-02 | Pydantic-validated finite/bounded overlay; clean rejection if malformed | ✓ SATISFIED | Truths 6,7 |

No orphaned requirements: REQUIREMENTS.md maps only PIPE-01/02/03 to Phase 1, all claimed across the two plans. (Per instruction, REQUIREMENTS.md tracks prose bullets with no checkbox surface — absence of checkboxes is not a defect.)

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| — | — | none | — | Scan of `ai-service/app` for TODO/FIXME/XXX/HACK/PLACEHOLDER/not-implemented returned no matches. |

Note (informational, not a gap): 01-02-SUMMARY records that feat commit `b96407f` bundled ~38 lines of pre-existing, unrelated milestone-pivot edits to `schemas/api.py` that could not be split non-interactively. Confined to that file; does not affect Phase 1 goal achievement.

### Human Verification Required

None. Every truth is exercised by a passing automated test; no visual/real-time/external-service behavior is in scope for this AI-service-only phase.

### Gaps Summary

No gaps. All 7 must-haves verified against source with passing behavioral tests; both plans' success criteria and all three ROADMAP success criteria hold in the codebase. Phase goal achieved.

---

_Verified: 2026-09-26_
_Verifier: Claude (gsd-verifier)_
