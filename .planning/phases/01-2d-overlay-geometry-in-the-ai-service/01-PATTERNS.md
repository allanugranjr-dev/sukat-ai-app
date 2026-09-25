# Phase 1: 2d-overlay-geometry-in-the-ai-service - Pattern Map

**Mapped:** 2026-09-25
**Files analyzed:** 4
**Analogs found:** 4 / 4

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `ai-service/app/schemas/api.py` (NEW `OverlayView`/`OverlayLine`/`OverlayGeometry` + field on `ReconstructionMetadata`) | model (schema) | transform (validation) | `GuideContour`/`GuideLine`/`GuideGeometry` in the same file | exact |
| `ai-service/app/pipeline.py` (NEW `_overlay_geometry()`; MODIFY `_anny_targets` return tuple; MODIFY `process()` attach) | service (helper + orchestration) | transform / request-response | `_guide_geometry()` + `_anny_targets()` + `process()` in the same file | exact |
| `ai-service/app/reconstruction/silhouette.py` | model (dataclass) | transform | `SilhouetteProfile` / `resolve_front_side_profiles` (READ-ONLY reuse, no edit) | exact (read-only) |
| `ai-service/tests/test_overlay_geometry.py` (NEW) + MODIFY `tests/test_silhouette_pipeline.py` | test | request-response | `tests/test_silhouette_pipeline.py` | exact |

All analog paths verified git-tracked via `git ls-files` (tracked-source gate #3645 satisfied — no mirror paths).

## Pattern Assignments

### `ai-service/app/schemas/api.py` — NEW `OverlayGeometry`/`OverlayLine`/`OverlayView` (model, transform)

**Analog:** `GuideLine` / `GuideGeometry` in the same file.

**Imports pattern** (`schemas/api.py:1-8`) — reuse verbatim; `Literal`, `np`, `field_validator` already present:
```python
from typing import Any, Literal
import numpy as np
from pydantic import BaseModel, ConfigDict, Field, field_validator
```

**Finite/bounded point validator** — mirror `GuideLine.finite_points` (`schemas/api.py:121-129`), but bound to `[0,1]` (image-normalized) instead of `abs(coordinate) > 100` (meters):
```python
    @field_validator("points")
    @classmethod
    def finite_points(cls, value: list[tuple[float, float, float]]) -> list[tuple[float, float, float]]:
        rounded: list[tuple[float, float, float]] = []
        for point in value:
            if any(not np.isfinite(coordinate) or abs(coordinate) > 100 for coordinate in point):
                raise ValueError("guide points must be finite and bounded")
            rounded.append(tuple(round(float(coordinate), 5) for coordinate in point))
        return rounded
```
Note the `round(..., 5)` convention — new overlay validator rounds to 5 dp identically.

**dict-keyed container + key validator pattern** — mirror `GuideGeometry` (`schemas/api.py:135-157`); use `dict[str, OverlayLine]` and `dict[str, OverlayView]` with `Field(default_factory=dict)`:
```python
    model_config = ConfigDict(extra="forbid")
    coordinate_system: Literal["glb-y-up-right-handed"]
    ...
    contours: dict[str, GuideContour] = Field(default_factory=dict)
    lines: dict[str, GuideLine] = Field(default_factory=dict)

    @field_validator("contours", "lines")
    @classmethod
    def valid_guide_keys(cls, value: dict[str, object]) -> dict[str, object]:
        for key in value:
            if not key or not key.replace("_", "").isalnum() or not key[0].islower():
                raise ValueError("guide keys must be named body levels")
        return value
```

**Bounded scalar field pattern** — mirror `GuideLine.level_fraction` (`schemas/api.py:109`) for the retained `level_fraction`:
```python
    level_fraction: float = Field(ge=0, le=1.5)
```

**Attach point** — mirror `guide_geometry` field on `ReconstructionMetadata` (`schemas/api.py:160-171`). Add a declared sibling `overlay_geometry: OverlayGeometry | None = None`. Model is `extra="allow"` so this does not disturb the top-level `extra="forbid"` `BodyScanResponse`:
```python
class ReconstructionMetadata(BaseModel):
    model_config = ConfigDict(extra="allow")
    ...
    guide_fractions: dict[str, float] = Field(default_factory=dict)
    guide_geometry: GuideGeometry | None = None
    # + overlay_geometry: OverlayGeometry | None = None
```

---

### `ai-service/app/pipeline.py` — NEW `_overlay_geometry()` + MODIFY `_anny_targets` + `process()` (service)

**Analog for the helper:** `_guide_geometry()` (`pipeline.py:281-308`) — module-level function returning a plain dict shaped like the schema, iterating `guide_fractions`, `np.isfinite`-guarding each fraction, `round(..., 5)` on emitted coords, and skipping (`continue`) unanchorable entries. This is the exact omission (D-02) precedent:
```python
def _guide_geometry(vertices, faces, guide_fractions, height_cm, measurements=None) -> dict[str, Any]:
    contours: dict[str, Any] = {}
    for key, raw_fraction in guide_fractions.items():
        fraction = float(raw_fraction)
        if not np.isfinite(fraction) or not 0.05 < fraction < 0.99:
            continue
        contour = _mesh_plane_contour(...)
        if contour is None:
            continue
        points = [(round(float(point[0]), 5), ...) for point in contour]
        contours[key] = {"level_fraction": round(fraction, 5), ..., "source": "..."}
    return {"coordinate_system": ..., "contours": contours, "lines": _guide_lines(...)}
```
`_overlay_geometry(front, side, guide_fractions, height_cm)` follows this shape: build a dict, `continue`/omit when `width_at(fraction) <= 0` or fraction absent (D-02), tag each line with `profile.view` (D-07), normalize by `profile.image_width`/`image_height` (D-10).

**Return-tuple refactor of `_anny_targets`** — current signature (`pipeline.py:317-322`) returns a 2-tuple; `resolved` is already bound locally at `pipeline.py:328`:
```python
    @staticmethod
    def _anny_targets(images, height_cm, pose_observations=None) -> tuple[dict[str, float], dict[str, Any]]:
        resolved = resolve_front_side_profiles(images, pose_observations)
        front, side = resolved.front, resolved.side
        ...
        return targets, {"view_height_difference": ..., "silhouette_sources": ..., "coverage": ...}
```
Change the annotation to a 3-tuple and append `resolved` as the third element. Do NOT re-call `resolve_front_side_profiles` (CPU cost / PIPE-02).

**Call site + attach in `process()`** — call site at `pipeline.py:405-409` unpacks the 2-tuple; add `resolved` there. `guide_fractions` is built at `pipeline.py:521` and `_guide_geometry` called on `:522`; add the parallel `_overlay_geometry(...)` call right after. Attach in the `ReconstructionMetadata(...)` constructor (`pipeline.py:536-551`) as a sibling of `guide_geometry=guide_geometry` (`:549`):
```python
        guide_fractions = dict(fitted.guide_fractions)
        guide_geometry = _guide_geometry(calibrated_vertices, fitted.faces, guide_fractions, float(height_cm), calibrated_measurements)
        # + overlay_geometry = _overlay_geometry(resolved.front, resolved.side, guide_fractions, float(height_cm))
        ...
        reconstruction_metadata = ReconstructionMetadata(
            ...
            guide_geometry=guide_geometry,
            # + overlay_geometry=overlay_geometry,
            **target_metadata,
        )
```

**Clean-rejection pattern (PIPE-03):** `ReconstructionMetadata(...)` is constructed OUTSIDE the guarded `try/except`, so a raw `ValidationError` would surface as a 500. Wrap `OverlayGeometry(**overlay)` construction and raise `PipelineFailure(msg, "INVALID_PROVIDER_RESULT", 502)` — same `PipelineFailure(msg, CODE, status)` shape already used throughout `_anny_targets` (`pipeline.py:331-335`, `:343-347`) and `process()` (`:533-534`).

---

### `ai-service/app/reconstruction/silhouette.py` — READ-ONLY reuse (model)

No edit required for the v1 centered-span approach. Consume verbatim (verified field names / signatures per RESEARCH.md):
- `SilhouetteProfile.view` (submitted-slot label, swap-safe → D-07)
- `SilhouetteProfile.width_at(fraction, center=True)` (`silhouette.py:50-63`; returns 0.0 for empty rows → D-02 omission trigger; resized pixels)
- `SilhouetteProfile._row_for_fraction` / `height_px` / `image_width` / `image_height` (`silhouette.py:23-63`)
- `SilhouetteProfile.crotch_fraction()` (`silhouette.py:65-77`) for the `inseam` anchor
- `resolve_front_side_profiles` → `ResolvedSilhouetteProfiles(submitted_front, submitted_side, front, side, view_assignment)` (`silhouette.py:554-594`); swap rebinds `front`/`side` but never rebuilds the frozen dataclass, so `.view` keeps the submitted slot.

---

### `ai-service/tests/test_overlay_geometry.py` (NEW) + MODIFY `tests/test_silhouette_pipeline.py` (test)

**Analog:** `tests/test_silhouette_pipeline.py`.

**Harness/fixtures to reuse** — `build_settings(tmp_path)` (CPU `Settings`, `test_silhouette_pipeline.py:20-28`), `fitted_body_fixture()` (`:31-39`), and the monkeypatch isolation pattern (`:44-48`):
```python
    monkeypatch.setattr(pipeline_module, "validate_pose", lambda *args, **kwargs: None)
    monkeypatch.setattr(BodyScanPipeline, "_anny_targets", staticmethod(
        lambda *args, **kwargs: ({"height_cm": 170.0, "bust_cm": 100.0, "waist_cm": 82.0}, {"view_height_difference": 0.01})
    ))
    monkeypatch.setattr(pipeline_module, "fit_anny_body", lambda *args, **kwargs: fitted_body_fixture())
```
Real PNG inputs via `make_body_image()` / `make_half_body_image()` from `helpers` (`:17`).

**MANDATORY arity fix (Pitfall 2)** — two monkeypatched `_anny_targets` lambdas currently return a **2-tuple** and WILL break on the 3-tuple change. Append a 3rd element (recommend `None`; make `_overlay_geometry` skip when `resolved is None`):
- `test_silhouette_pipeline.py:45-47` — `({"height_cm": 170.0, "bust_cm": 100.0, "waist_cm": 82.0}, {"view_height_difference": 0.01})` → append `, None`
- `test_silhouette_pipeline.py:204-208` — `({...}, {"view_height_difference": 0.02, "coverage": "half_body"})` → append `, None`

**Swap test construction** — build two `SilhouetteProfile` frozen dataclasses directly with controlled `width_px` and feed a fake `ResolvedSilhouetteProfiles` as the 3rd return element of a monkeypatched `_anny_targets`, then assert `line.view == resolved.front.view`.

## Shared Patterns

### Finite / bounded validation (PIPE-03, ASVS V5)
**Source:** `GuideLine.finite_points` (`schemas/api.py:121-129`)
**Apply to:** `OverlayLine.points` validator (bound `[0,1]` instead of `abs > 100`, `round(..., 5)`).

### Clean error rejection
**Source:** `PipelineFailure(message, code, status)` usage (`pipeline.py:331-335`, `:343-347`, `:533-534`)
**Apply to:** guarded `OverlayGeometry(**overlay)` construction → `PipelineFailure(..., "INVALID_PROVIDER_RESULT", 502)`.

### dict-keyed geometry container + key validator
**Source:** `GuideGeometry.contours`/`lines` + `valid_guide_keys` (`schemas/api.py:141-157`)
**Apply to:** `OverlayGeometry.views` / `OverlayGeometry.lines`.

### `extra="forbid"` model config on every schema class
**Source:** every model in `schemas/api.py` (e.g. `:35`, `:74`, `:107`, `:135`)
**Apply to:** `OverlayView`, `OverlayLine`, `OverlayGeometry`. (`ReconstructionMetadata` stays `extra="allow"`.)

### Test isolation via monkeypatch
**Source:** `test_silhouette_pipeline.py:44-48`
**Apply to:** all new overlay tests.

## No Analog Found

None — every file has a strong in-repo analog.

## Metadata

**Analog search scope:** `ai-service/app/schemas/`, `ai-service/app/pipeline.py`, `ai-service/app/reconstruction/`, `ai-service/tests/`
**Files scanned:** 4 (all read this session; line references cross-checked against RESEARCH.md verified citations)
**Pattern extraction date:** 2026-09-25
