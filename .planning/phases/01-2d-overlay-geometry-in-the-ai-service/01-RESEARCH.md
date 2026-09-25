# Phase 1: 2D overlay geometry in the AI service - Research

**Researched:** 2026-09-25
**Domain:** CPU image-space geometry derivation + Pydantic schema design (FastAPI/Python AI service)
**Confidence:** HIGH (all findings verified against source read this session)

<user_constraints>
## User Constraints (from 01-CONTEXT.md)

### Locked Decisions
- **D-01:** Emit an overlay line for each of the 8 returned mesh measurements — `height`, `chest_circumference`, `waist_circumference`, `hip_circumference`, `thigh_left_circumference`, `upper_arm`, `shoulder`, `inseam`.
- **D-02:** If a measurement has no reliable silhouette anchor (missing body-level fraction, or arms-against-torso making `upper_arm` unresolvable), OMIT that line rather than guessing. The value still appears in the measurement list. Every DRAWN line must be truthful.
- **D-03:** Overlay geometry is optional per-measurement — schema and downstream code must tolerate fewer overlay entries than measurements.
- **D-04:** Each overlay entry carries a semantic `kind` — `circumference` | `length` | `width` — alongside its endpoints and view.
- **D-05:** A circumference is drawn as a horizontal band (span = body width at that level; the LABEL carries the wrap-around value). `kind` lets Phase 3 render/label a band differently from a straight length.
- **D-06:** Each measurement is emitted on its single clearest view only (one entry per measurement). Front for widths/circumferences; side reserved for depth-only.
- **D-07:** The `view` tag is the SUBMITTED slot the client displays. `resolve_front_side_profiles` may swap front/side vs submitted slots, so the overlay must key to the submitted view, not the internally-assigned analysis view. (Correctness gate.)
- **D-08:** Horizontal endpoints spanned by `SilhouetteProfile.width_at(fraction, center=True)` — the exact pixels the value was derived from. Pose landmarks NOT used for spanning in v1.
- **D-09:** Vertical placement from CLAD `guide_fractions`: `Y_px = bottom_px - fraction * height_px`.
- **D-10:** Coordinates NORMALIZED to [0,1] against the RESIZED (aspect-preserved, ≤720px) image dimensions on `SilhouetteProfile` (`image_width`/`image_height`).

### Claude's Discretion
- Exact field/type names of the new Pydantic schema (mirror `GuideGeometry`), provided it is finite/bounded-validated (PIPE-03).
- How SilhouetteProfiles are retained from `_anny_targets` into `process()` (return-tuple refactor vs re-resolve) — choose least-invasive.
- Which non-circumference measurements map to `length` vs `width` (`shoulder`=width, `inseam`/`height`=length).
- Numeric clamping/epsilon strategy for out-of-range fractions.

### Deferred Ideas (OUT OF SCOPE)
- Both-view emission (front AND side for same measurement) — v1 is single best view (D-06).
- Pose-landmark-anchored endpoints — v1 spans by silhouette width (D-08).
- Draggable line positions, all-measurements-on-all-views, back-view overlay, annotated-image export — v2.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PIPE-01 | Emit, per measurement, 2D overlay geometry (guide-line endpoints) in normalized image coords, keyed to source view (front/side), plus each source view's pixel dimensions. | § Endpoint Derivation, § View-Swap Correctness, § Pydantic Schema (carries per-view `width_px`/`height_px`). |
| PIPE-02 | Overlay coords derived on CPU from data already computed (silhouette fractions/widths + pose landmarks). No new heavy models, no cloud, no CUDA. | § CPU-Only Preservation — overlay reads existing `SilhouetteProfile` numpy arrays + `guide_fractions`; zero new torch/GPU calls. |
| PIPE-03 | Overlay payload validated by a Pydantic schema (mirroring `GuideGeometry`) with finite/bounded coordinate checks. | § Pydantic Schema (field_validators mirror `GuideLine.finite_points`, bounded to [0,1]). |
</phase_requirements>

## Summary

Everything Phase 1 needs already exists in the pipeline and is thrown away. `resolve_front_side_profiles` produces two `SilhouetteProfile` objects that carry resized-image pixel dimensions, per-row body widths, and a bounding box. `guide_fractions` (bottom-origin body-level fractions from CLAD, or a hardcoded fallback map) is already computed and returned. The single missing wire is that the profiles are local to `BodyScanPipeline._anny_targets` and discarded; Phase 1 must return them into `process()` and build a normalized image-space overlay from them.

The derivation is arithmetic, not modeling: for each measurement, take a bottom-origin fraction, compute the image row `Y_px = bottom - fraction*height_px`, take the body-width span `width_at(fraction)` centered on the silhouette bounding-box center, and normalize both endpoints by `image_width`/`image_height`. This runs on the CPU using existing numpy arrays — no torch, no new model, so PIPE-02's CPU-only lock holds trivially. The `view` tag comes for free from `SilhouetteProfile.view`, which is set at extraction time to the submitted slot and is NOT rewritten when `resolve_front_side_profiles` swaps the analysis assignment — so tagging with the retained profile's `.view` automatically satisfies D-07.

The schema mirrors `GuideGeometry`/`GuideLine` (a `dict[str, OverlayLine]` keyed by measurement key, plus a `dict[str, OverlayView]` of pixel dims) with `field_validator`s that reject non-finite / out-of-[0,1] points, and attaches as a new declared `overlay_geometry` field on `ReconstructionMetadata` (which is `extra="allow"`). Because it nests inside `reconstruction`, it does NOT touch `BodyScanResponse`'s `extra="forbid"` top level or its `measurements` unique-key validator.

**Primary recommendation:** Extend `_anny_targets` to return a 3-tuple `(targets, target_metadata, resolved)` (least-invasive; re-resolving would double the most expensive CPU step). Add an `_overlay_geometry(front, side, guide_fractions, ...)` helper mirroring `_guide_geometry`. Draw only lines that anchor truthfully; OMIT `upper_arm` in v1 (per-row run x-positions are not retained, so an arm segment cannot be placed truthfully — this is exactly the D-02 omission case).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Silhouette extraction / view resolution | API/Backend (ai-service) | — | Already owned by `reconstruction/silhouette.py`; overlay reuses its outputs. |
| Overlay geometry derivation | API/Backend (ai-service) | — | CPU arithmetic over existing profiles; must live beside `_guide_geometry` in `pipeline.py`. |
| Overlay payload validation | API/Backend (schema tier) | — | Pydantic model in `schemas/api.py`, same tier as `GuideGeometry`. |
| Coordinate normalization | API/Backend | — | Normalized [0,1] in service so the client (Phase 3) is tier-agnostic to display size. |
| Rendering the overlay on the photo | Browser/Client | — | OUT OF SCOPE for Phase 1 (Phase 3). Service emits normalized coords only. |

Every capability in Phase 1 belongs to the AI-service backend tier. No client/frontend/DB work is in scope. This is consistent with the dual-runtime parity constraint being deferred to Phase 2 (Phase 1 is AI-service-only).

## Standard Stack

No new packages. Phase 1 uses only libraries already present in `ai-service/requirements.txt` and imported in the touched files.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pydantic | (installed) | Schema + finite/bounded validation (PIPE-03) | Already the response-contract layer (`schemas/api.py`). `[VERIFIED: ai-service/app/schemas/api.py:8 imports BaseModel, ConfigDict, Field, field_validator]` |
| numpy | (installed) | Finite checks (`np.isfinite`), clamping (`np.clip`), median widths | Already used throughout silhouette + schema validators. `[VERIFIED: ai-service/app/schemas/api.py:6 import numpy as np]` |
| Pillow (PIL) | (installed) | Only indirectly — image already resized upstream (`_resize_image`) | No new use; overlay reads dims off the profile. `[VERIFIED: ai-service/app/reconstruction/silhouette.py:11 from PIL import Image]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Re-running `resolve_front_side_profiles` in `process()` | Return-tuple refactor of `_anny_targets` | Re-resolving doubles the most expensive CPU step (rembg/grabcut segmentation). REJECT. |
| Storing pixel endpoints | Normalized [0,1] endpoints | D-10 locks normalized; enables display-size independence in Phase 3. |

**Installation:** None — no new dependencies. Verified by inspection: overlay derivation imports nothing beyond `numpy`/`SilhouetteProfile` already in scope.

## Package Legitimacy Audit

**Not applicable — this phase installs no external packages.** All code reuses `numpy` and `pydantic` already declared in `ai-service/requirements.txt`. No registry lookups required.

## Architecture Patterns

### System Architecture Diagram

```
BodyScanPipeline.process(scan_id, images, height_cm, sex)
        │
        ├─ validate_views / validate_pose            (unchanged)
        │
        ├─ _anny_targets(scan_images, height, poses)  ◄── WIRING CHANGE
        │     │  resolve_front_side_profiles(images, poses)
        │     │     → ResolvedSilhouetteProfiles(submitted_front, submitted_side,
        │     │                                   front, side, view_assignment)
        │     │  tailoring_measurements(front, side, height) → fitting targets
        │     └─ RETURN (targets, target_metadata, resolved)   ← add 3rd element
        │
        ├─ fit_anny_body(...) → FittedAnnyBody(.guide_fractions, .measurements, ...)
        │
        ├─ guide_fractions = dict(fitted.guide_fractions)     (existing)
        ├─ _guide_geometry(...) → 3D GLB guides               (existing, untouched)
        │
        ├─ _overlay_geometry(resolved.front, resolved.side,   ◄── NEW HELPER
        │        guide_fractions, height_cm) → dict
        │     for each of the 8 measurement keys:
        │        fraction  = guide_fractions[k]  OR fixed body-level fraction
        │        Y_px      = front.bottom - fraction*front.height_px
        │        width_px  = front.width_at(fraction, center=...)
        │        cx        = (front.left + front.right)/2
        │        endpoints = normalize([cx±width/2 , Y_px]) by (image_width,image_height)
        │        view      = front.view          # submitted slot (swap-safe)
        │        → omit if unanchorable (D-02)
        │
        └─ ReconstructionMetadata(..., guide_geometry=..., overlay_geometry=OVERLAY)  ◄── attach
              → BodyScanResponse.reconstruction   (top-level shape unchanged)
```

The overlay is a sibling of `guide_geometry` on `ReconstructionMetadata`. The only pipeline flow change is that `_anny_targets` hands the resolved profiles back instead of discarding them.

### Recommended Structure (files touched)
```
ai-service/app/
├── schemas/api.py         # + OverlayView, OverlayLine, OverlayGeometry; + field on ReconstructionMetadata
├── pipeline.py            # _anny_targets return 3-tuple; + _overlay_geometry(); attach in process()
└── (silhouette.py)        # NO change required for the recommended v1 (centered-span) approach
ai-service/tests/
└── test_silhouette_pipeline.py  # UPDATE 2 monkeypatched _anny_targets lambdas (2-tuple → 3-tuple); + new overlay tests
```

### Pattern 1: Return-tuple refactor of `_anny_targets` (RECOMMENDED)
**What:** Change the return from `(targets, target_metadata)` to `(targets, target_metadata, resolved)` where `resolved` is the existing `ResolvedSilhouetteProfiles`.
**Why least-invasive:** `resolve_front_side_profiles` is already called once inside `_anny_targets` `[VERIFIED: ai-service/app/pipeline.py:328 resolved = resolve_front_side_profiles(images, pose_observations)]`; it already binds `resolved` locally. Only the return statement and the single call site in `process()` change.
**Current signature:** `[VERIFIED: ai-service/app/pipeline.py:317-322]`
```python
    @staticmethod
    def _anny_targets(
        images: dict[str, bytes],
        height_cm: float,
        pose_observations: dict[str, PoseObservation] | None = None,
    ) -> tuple[dict[str, float], dict[str, Any]]:
```
**Current return:** `[VERIFIED: ai-service/app/pipeline.py:361-365]`
```python
        return targets, {
            "view_height_difference": round(scale_difference, 4),
            "silhouette_sources": [front.source, side.source],
            "coverage": "half_body" if is_half_body else "full_body",
        }
```
**Current call site:** `[VERIFIED: ai-service/app/pipeline.py:405-409]`
```python
            targets, target_metadata = self._anny_targets(
                scan_images,
                float(height_cm),
                {"front": front_pose, "side": side_pose},
            )
```
Change to `targets, target_metadata, resolved = self._anny_targets(...)` and return `resolved` as the 3rd element.

**Critical test impact:** Two existing tests monkeypatch `_anny_targets` to return a **2-tuple** and WILL break on the arity change:
- `[VERIFIED: ai-service/tests/test_silhouette_pipeline.py:45-47]` returns `({...}, {"view_height_difference": 0.01})`
- `[VERIFIED: ai-service/tests/test_silhouette_pipeline.py:204-208]` returns `({...}, {"view_height_difference": 0.02, "coverage": "half_body"})`

Both must be updated to append a 3rd element. Recommend returning `None` there and making `_overlay_geometry` skip when `resolved is None`, so these existing (non-overlay) tests stay green with a one-token change (`, None`). A dedicated overlay test then passes a real/fake `ResolvedSilhouetteProfiles`.

### Pattern 2: `_overlay_geometry` helper mirroring `_guide_geometry`
**What:** A pure function taking `(front, side, guide_fractions, height_cm)` returning the overlay dict, placed beside `_guide_geometry` `[VERIFIED: ai-service/app/pipeline.py:281-308]`.
**When:** Called in `process()` right after `guide_fractions = dict(fitted.guide_fractions)` `[VERIFIED: ai-service/app/pipeline.py:521]`, parallel to the `_guide_geometry(...)` call on the next line `[VERIFIED: ai-service/app/pipeline.py:522]`.

### Anti-Patterns to Avoid
- **Recomputing measurement values in the overlay.** The overlay VISUALIZES; the number comes from `calibrated_measurements` (CLAD). Do not derive a new value from `width_at`. (PROJECT constraint: measurements are source-of-truth.)
- **Tagging `view` from the analysis assignment.** Using `resolved.front`'s conceptual role ("front") instead of its `.view` attribute would mis-key swapped scans. Use `profile.view`. (D-07 correctness gate — see § View-Swap Correctness.)
- **Re-running segmentation.** Never call `resolve_front_side_profiles` a second time — it re-runs rembg/grabcut.
- **Adding overlay as a top-level `BodyScanResponse` field.** That model is `extra="forbid"`; overlay belongs inside `reconstruction`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Body-width at a level | Custom mask column-scan | `SilhouetteProfile.width_at(fraction, center=True)` | Already computed, windowed-median, handles empty rows (returns 0.0). `[VERIFIED: ai-service/app/reconstruction/silhouette.py:50-63]` |
| Image row for a fraction | New math | `bottom - fraction*height_px` (matches `_row_for_fraction`) | Bottom-origin convention already shared by CLAD guides. `[VERIFIED: ai-service/app/reconstruction/silhouette.py:46-48]` |
| Inseam anchor | Custom leg-gap detector | `SilhouetteProfile.crotch_fraction()` | Already estimates crotch fraction from the leg gap. `[VERIFIED: ai-service/app/reconstruction/silhouette.py:65-77]` |
| Finite/bounded validation | Manual checks scattered in pipeline | `field_validator` on the schema (mirror `GuideLine.finite_points`) | Single choke-point; rejects malformed cleanly (PIPE-03). `[VERIFIED: ai-service/app/schemas/api.py:121-129]` |
| Front/side swap decision | Re-derive which view is wider | `resolved.front` / `profile.view` | Decision already made once in `resolve_front_side_profiles`. `[VERIFIED: ai-service/app/reconstruction/silhouette.py:563-594]` |

**Key insight:** Phase 1 is a wiring + normalization task. Nearly every primitive already exists; the risk is re-deriving (and thus contradicting) values the pipeline already produced.

## Endpoint Derivation (Focus #1 — exact formula, verified field names)

### SilhouetteProfile fields (verbatim) `[VERIFIED: ai-service/app/reconstruction/silhouette.py:23-63]`
```python
@dataclass(frozen=True)
class SilhouetteProfile:
    view: str
    row_full_width: np.ndarray
    row_center_width: np.ndarray
    top: int
    bottom: int
    left: int
    right: int
    image_width: int
    image_height: int
    source: str = "heuristic"

    @property
    def height_px(self) -> float:
        return float(max(1, self.bottom - self.top))
    @property
    def width_px(self) -> float:
        return float(max(1, self.right - self.left + 1))
    def _row_for_fraction(self, fraction_from_bottom: float) -> int:
        fraction = float(np.clip(fraction_from_bottom, 0.0, 1.0))
        return int(round(self.bottom - fraction * self.height_px))
    def width_at(self, fraction_from_bottom: float, *, center: bool = True) -> float:
        ...
        return float(np.median(valid))   # returns 0.0 if no silhouette data at that row
```

**Units:** `width_at` and `row_*_width` are in **resized-image pixels** (the extraction loop stores `row_xs[-1] - row_xs[0] + 1` per row `[VERIFIED: ai-service/app/reconstruction/silhouette.py:479]`). `image_width`/`image_height` are the **resized** dims — set from `image.width`/`image.height` after `_resize_image` runs `image.thumbnail((720, 720), Image.Resampling.LANCZOS)` `[VERIFIED: ai-service/app/reconstruction/silhouette.py:80-86, 543-544]`. This is exactly the ≤720 aspect-preserved space D-10 requires. No cm conversion is needed for the overlay (unlike `tailoring._width`, which multiplies by `height_cm / height_px`).

### The exact mapping (guide_fraction + SilhouetteProfile → normalized endpoints)

For a **horizontal** line (circumference / width) at bottom-origin `fraction f` on the drawing profile `p` (the analysis `front`):
```
row_px   = p.bottom - f * p.height_px          # image row, 0 = top of resized image (D-09)
width_px = p.width_at(f, center=<True|False>)  # resized pixels; 0.0 ⇒ OMIT (no data)
cx_px    = (p.left + p.right) / 2.0            # bounding-box horizontal center
x0_px    = cx_px - width_px / 2.0
x1_px    = cx_px + width_px / 2.0
points   = [ (x0_px / p.image_width, row_px / p.image_height),
             (x1_px / p.image_width, row_px / p.image_height) ]   # normalized [0,1]
```
For a **vertical** line (length — `height`, `inseam`): x fixed at `cx_px / image_width`, y spans two rows.

**Origin convention:** image coordinates, **top-left origin, y-down** (row 0 = top). `_row_for_fraction` returns an image row measured from the top, so `row_px / image_height` puts 0 at the top — directly consumable by the Phase-3 client drawing over the displayed `<img>`. Document `origin: "top-left"` in the schema so the client never guesses.

**Clamping/epsilon (Claude's discretion D):** `width_at` and `_row_for_fraction` already `np.clip` the fraction to `[0,1]` `[VERIFIED: ai-service/app/reconstruction/silhouette.py:47, 51-54]`, so `row_px ∈ [top, bottom]` ⇒ normalized y ∈ [0,1]. Normalized **x** can fall slightly outside [0,1] if `width_px` is large near a bbox edge; `np.clip(x, 0.0, 1.0)` then `round(..., 5)` (mirroring `GuideLine`'s 5-dp rounding `[VERIFIED: ai-service/app/schemas/api.py:128]`). If `width_px <= 0` ⇒ OMIT the line (D-02).

## Measurement → kind / fraction / view Mapping (Focus #2)

The 8 returned measurement keys come from `measurement_names` `[VERIFIED: ai-service/app/pipeline.py:502-511]`:
```python
        measurement_names = {
            "height_cm": "height",
            "bust_cm": "chest_circumference",
            "waist_cm": "waist_circumference",
            "hip_cm": "hip_circumference",
            "thigh_cm": "thigh_left_circumference",
            "upperarm_cm": "upper_arm",
            "shoulder_width_cm": "shoulder",
            "inseam_cm": "inseam",
        }
```
`guide_fractions` keys are SHORT names, not the measurement keys. Real CLAD path emits keys from `{chest, waist, hip, thigh, calf, upper_arm, wrist}` `[VERIFIED: ai-service/app/fitting/anny_fitter.py:184-192]`; the morph fallback hardcodes `{"chest": 0.70, "waist": 0.62, "hip": 0.54, "thigh": 0.40, "upper_arm": 0.68}` `[VERIFIED: ai-service/app/fitting/anny_fitter.py:285]`. **No path ever emits `shoulder`, `inseam`, or `height` in `guide_fractions`** — those need the fixed body-level fractions from `tailoring.py`.

| Measurement key | `kind` | Vertical fraction source | `center=` for width | Anchorable? |
|-----------------|--------|--------------------------|---------------------|-------------|
| `chest_circumference` | `circumference` | `guide_fractions["chest"]` (fallback fixed `0.70` from tailoring `[VERIFIED: ai-service/app/measurements/tailoring.py:118]`) | `True` | Usually — omit if key absent AND fallback width 0 |
| `waist_circumference` | `circumference` | `guide_fractions["waist"]` (tailoring fixed `0.65` `[VERIFIED: tailoring.py:120]`) | `True` | Usually |
| `hip_circumference` | `circumference` | `guide_fractions["hip"]` (tailoring fixed `0.64` `[VERIFIED: tailoring.py:122]`) | `True` | Usually |
| `thigh_left_circumference` | `circumference` | `guide_fractions["thigh"]` (tailoring fixed `0.42` `[VERIFIED: tailoring.py:124]`) | `True` | Usually |
| `shoulder` | `width` | fixed `0.75` (`center=False`) `[VERIFIED: tailoring.py:134-138 _width(front, 0.75, ..., center=False)]` | `False` | Usually — full span at shoulder level |
| `height` | `length` | full span: `f=0` (feet=`bottom`) → `f=1.0` (head=`top`) | n/a (vertical) | Always (bbox top/bottom exist) |
| `inseam` | `length` | `front.crotch_fraction()` (crotch) → `f=0` (feet) `[VERIFIED: tailoring.py:143 front.crotch_fraction() * height_cm]` | n/a (vertical) | Usually — `crotch_fraction` returns 0.48 default if gap not found |
| `upper_arm` | `circumference` | `guide_fractions["upper_arm"]` / fixed `0.67` `[VERIFIED: tailoring.py:163 _arm_diameter(front, side, 0.67, ...)]` | see note | **OFTEN OMIT** — see below |

**`kind` assignments** (Claude's discretion, per CONTEXT note "shoulder=width, inseam/height=length"): 4 circumferences + `upper_arm` = `circumference`; `shoulder` = `width`; `height` + `inseam` = `length`.

**Fraction-source recommendation:** prefer `guide_fractions[short_key]` when present (D-09: consistency with returned values + 3D guides); else fall back to the tailoring fixed fraction; else OMIT. A mapping dict is required:
```python
_OVERLAY_FRACTION_KEYS = {   # measurement key -> guide_fractions short key
    "chest_circumference": "chest", "waist_circumference": "waist",
    "hip_circumference": "hip", "thigh_left_circumference": "thigh",
    "upper_arm": "upper_arm",
}
_OVERLAY_FIXED_FRACTIONS = {  # fallback + shoulder/inseam which are never in guide_fractions
    "chest_circumference": 0.70, "waist_circumference": 0.65, "hip_circumference": 0.64,
    "thigh_left_circumference": 0.42, "shoulder": 0.75,   # inseam uses front.crotch_fraction()
}
```

**`upper_arm` — the D-02 omission case (IMPORTANT open question):** The arm circumference is derived from a *residual* `(full_width − body_width)/2` and only when arms are visibly separated (`front_residual < 0.5 or side_residual < 0.3` ⇒ `return None`) `[VERIFIED: ai-service/app/measurements/tailoring.py:77-95]`. Critically, `SilhouetteProfile` stores only per-row *width scalars* (`row_full_width`, `row_center_width`) — **NOT the x-positions of the runs**. So even when the arm is separable, the overlay cannot know WHERE (left/right, which side) the arm sits to place a truthful segment. **Recommendation: OMIT `upper_arm` overlay in v1** (the number still appears in the measurement list — D-02). To support it later, `extract_silhouette_profile` would need to also retain per-row run extents (see § Open Questions).

## View-Swap Correctness (Focus #4)

`resolve_front_side_profiles` returns `[VERIFIED: ai-service/app/reconstruction/silhouette.py:554-594]`:
```python
@dataclass(frozen=True)
class ResolvedSilhouetteProfiles:
    submitted_front: SilhouetteProfile
    submitted_side: SilhouetteProfile
    front: SilhouetteProfile
    side: SilhouetteProfile
    view_assignment: str
```
The swap: `submitted_front`/`submitted_side` are extracted with `view="front"`/`view="side"` at lines `[VERIFIED: silhouette.py:577-578]`. Then `[VERIFIED: silhouette.py:579-587]`:
```python
    front = submitted_front
    side = submitted_side
    view_assignment = "submitted"
    if front.width_px < side.width_px * 0.98:
        front, side = side, front
        view_assignment = "width-based front-side swap"
```
The swap only rebinds the `front`/`side` variables; it **never rebuilds the frozen dataclass**, so each profile's `.view` attribute keeps its ORIGINAL submitted-slot label. Therefore after a swap, `resolved.front.view == "side"`.

**The correctness handle (satisfies D-07 for free):** tag the overlay with the drawing profile's `.view`, and use that same profile's `image_width`/`image_height` for the per-view dims. Because the overlay is drawn on `resolved.front`, `resolved.front.view` IS the submitted slot the client displays, and its dims match that slot's photo. No comparison against `view_assignment` string needed — the `.view` field carries the truth. This is the single most important correctness detail in the phase; a plan that tags `view="front"` literally (instead of `profile.view`) is WRONG on swapped scans.

## CPU-Only Preservation (Focus #3 / PIPE-02)

Overlay derivation touches only: `SilhouetteProfile` numpy arrays (already in RAM), `guide_fractions` (a `dict[str, float]`), and arithmetic. It imports **no** torch, invokes **no** model, and calls **no** GPU/cloud path. `device` remains `self.settings.resolved_device()` (`"cpu"` in tests) `[VERIFIED: ai-service/app/pipeline.py:538]`. The recommended return-tuple refactor does NOT add a second `resolve_front_side_profiles` call, so segmentation cost is unchanged. CPU-only hard-lock is preserved by construction.

## Pydantic Schema (Focus #5)

### Attach point — no conflict with `extra="forbid"`
`ReconstructionMetadata` is `model_config = ConfigDict(extra="allow")` `[VERIFIED: ai-service/app/schemas/api.py:160-161]` and already declares `guide_geometry: GuideGeometry | None = None` `[VERIFIED: ai-service/app/schemas/api.py:171]`. Add a **declared** sibling `overlay_geometry: OverlayGeometry | None = None` (declaring, not relying on `extra="allow"`, gives validation). Attach in `process()` alongside `guide_geometry=guide_geometry` `[VERIFIED: ai-service/app/pipeline.py:548-549]`.

`BodyScanResponse` is `extra="forbid"` `[VERIFIED: ai-service/app/schemas/api.py:174-175]`, and its `unique_keys` validator is on the `measurements` list only `[VERIFIED: ai-service/app/schemas/api.py:190-196]`. Because the overlay nests inside `reconstruction` (not a new top-level field, not in `measurements`), **neither constraint is affected** — the top-level response shape is unchanged.

### Recommended schema (mirrors GuideGeometry/GuideLine conventions)
```python
class OverlayView(BaseModel):
    model_config = ConfigDict(extra="forbid")
    width_px: int = Field(gt=0, le=4096)
    height_px: int = Field(gt=0, le=4096)

class OverlayLine(BaseModel):
    model_config = ConfigDict(extra="forbid")
    view: Literal["front", "side"]
    kind: Literal["circumference", "length", "width"]
    points: list[tuple[float, float]] = Field(min_length=2, max_length=8)
    level_fraction: float | None = Field(default=None, ge=0, le=1.5)
    source: str = Field(min_length=2, max_length=120)

    @field_validator("points")
    @classmethod
    def finite_bounded(cls, value):
        rounded = []
        for point in value:
            if len(point) != 2 or any(not np.isfinite(c) or c < 0.0 or c > 1.0 for c in point):
                raise ValueError("overlay points must be finite and within [0,1]")
            rounded.append(tuple(round(float(c), 5) for c in point))
        return rounded

class OverlayGeometry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    coordinate_system: Literal["image-normalized"]
    origin: Literal["top-left"]
    views: dict[str, OverlayView] = Field(default_factory=dict)   # keyed "front"/"side"
    lines: dict[str, OverlayLine] = Field(default_factory=dict)   # keyed by measurement key
```
Mirrors `GuideLine.finite_points` `[VERIFIED: ai-service/app/schemas/api.py:121-129]` but bounds coords to `[0,1]` (image-normalized) instead of `abs(coordinate) > 100` (meters). Keep `dict[str, ...]` keyed containers like `GuideGeometry.contours`/`lines` `[VERIFIED: ai-service/app/schemas/api.py:141-142]`. `level_fraction` retained (bottom-origin) for Phase-3 labeling/debug, matching `GuideLine.level_fraction: float = Field(ge=0, le=1.5)` `[VERIFIED: ai-service/app/schemas/api.py:109]`. `views` MUST include an entry for every `view` referenced by a line (a cross-field validator can enforce this).

### "Rejected cleanly if malformed" (PIPE-03, Success Criterion 3)
`ReconstructionMetadata(...)` is constructed at `[VERIFIED: ai-service/app/pipeline.py:536-551]`, which is **outside** the `try/except` that ends at line 467. A `ValidationError` there would surface as an unhandled 500. Mirror `_measurement_values`'s pattern `[VERIFIED: ai-service/app/pipeline.py:55-59]` — validate the overlay explicitly and raise `PipelineFailure(..., "INVALID_PROVIDER_RESULT", 502)` so a malformed payload is rejected cleanly rather than crashing. Building the dict then instantiating `OverlayGeometry(**overlay)` inside a guarded block is the clean-rejection mechanism.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (`[tool.pytest.ini_options]`, `pythonpath=["."]`, `testpaths=["tests"]`, `addopts="-ra"`) `[VERIFIED: ai-service/pyproject.toml:1-4]` |
| Config file | `ai-service/pyproject.toml` |
| Quick run command | `cd ai-service && python -m pytest tests/test_silhouette_pipeline.py -x` |
| Full suite command | `cd ai-service && python -m pytest` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| PIPE-01 | Response `reconstruction.overlay_geometry` present with normalized endpoints + `view` + per-view `width_px`/`height_px` | unit | `pytest tests/test_overlay_geometry.py::test_overlay_present_with_dims -x` | ❌ Wave 0 |
| PIPE-01/D-08 | Horizontal span == `width_at(fraction)` centered on bbox; y == `bottom - f*height_px` | unit | `pytest tests/test_overlay_geometry.py::test_endpoints_match_silhouette -x` | ❌ Wave 0 |
| D-07 | On a swapped scan, `line.view == resolved.front.view` (submitted slot) | unit | `pytest tests/test_overlay_geometry.py::test_view_tag_follows_submitted_slot -x` | ❌ Wave 0 |
| D-02 | `upper_arm` omitted when arms unresolvable; value still in `measurements` | unit | `pytest tests/test_overlay_geometry.py::test_unanchorable_line_omitted -x` | ❌ Wave 0 |
| PIPE-03 | Non-finite / out-of-[0,1] point raises `ValidationError`; malformed overlay → clean 502 | unit | `pytest tests/test_overlay_geometry.py::test_malformed_rejected -x` | ❌ Wave 0 |
| PIPE-02 | Overlay path adds no torch/GPU; `device` stays `"cpu"`; segmentation not re-run | unit | `pytest tests/test_overlay_geometry.py::test_cpu_only_no_reresolve -x` | ❌ Wave 0 |
| D-10 | All coords ∈ [0,1]; endpoints normalized by the tagged view's dims | unit | (covered by `test_endpoints_match_silhouette`) | ❌ Wave 0 |

### Testable Invariants (Focus #6)
1. **Finite & bounded:** every point in every `OverlayLine.points` satisfies `np.isfinite` and `0.0 <= c <= 1.0`.
2. **Endpoints on the tagged view's dims:** each line's coords, multiplied by `views[line.view].width_px/height_px`, land within that view's pixel box and reproduce `width_at(fraction)` (± rounding) for horizontal lines.
3. **Swap-safe view:** with a forced swap (front narrower than side), the emitted `view` equals the submitted slot, not the analysis role.
4. **Omission truthfulness:** unanchorable measurements (arms-against-torso → `upper_arm`; `width_at`==0) produce NO line, while the measurement still appears in `response.measurements`.
5. **Clean rejection:** constructing `OverlayGeometry` with a NaN/inf/out-of-range point raises; the pipeline converts it to a stable API error (`INVALID_PROVIDER_RESULT`/502), not a 500 traceback.
6. **CPU-only unchanged:** overlay computation imports no torch and does not call `resolve_front_side_profiles` a second time; `reconstruction.device == "cpu"`.

### Existing test-harness patterns to reuse `[VERIFIED: ai-service/tests/test_silhouette_pipeline.py]`
- `build_settings(tmp_path)` for a CPU `Settings` (lines 20-28).
- `monkeypatch.setattr(pipeline_module, "validate_pose", lambda *a, **k: None)` and `monkeypatch.setattr(pipeline_module, "fit_anny_body", lambda *a, **k: fitted_body_fixture())` to isolate the pipeline (lines 44-48).
- `make_body_image()` / `make_half_body_image()` from `tests/helpers.py` for real PNG inputs `[VERIFIED: ai-service/tests/helpers.py:8-33]`.
- For a swap test, construct two `SilhouetteProfile` instances directly (frozen dataclass) with controlled `width_px` and feed a fake `ResolvedSilhouetteProfiles` via the monkeypatched `_anny_targets` 3rd return element.

### Wave 0 Gaps
- [ ] `ai-service/tests/test_overlay_geometry.py` — covers PIPE-01/02/03, D-02, D-07, D-10 (new file).
- [ ] UPDATE `ai-service/tests/test_silhouette_pipeline.py:45-47` and `:204-208` — `_anny_targets` lambdas return a 3-tuple (append `, None`).
- Framework already installed (pytest present; `requirements-dev.txt` exists). No install needed.

## Common Pitfalls

### Pitfall 1: Tagging `view` literally instead of from `profile.view`
**What goes wrong:** Swapped scans draw the overlay on the wrong submitted photo in Phase 3.
**Why:** `resolve_front_side_profiles` rebinds `front`/`side` but keeps each profile's original `.view`.
**How to avoid:** `view = resolved.front.view`; dims from the same profile.
**Warning signs:** `view_assignment == "width-based front-side swap"` in metadata but overlay `view == "front"`.

### Pitfall 2: Breaking the two monkeypatched `_anny_targets` tests
**What goes wrong:** Arity change makes existing tests unpack a 2-tuple into 3 targets (or vice versa).
**How to avoid:** Update both lambdas to return a 3rd element (`None`), and make `_overlay_geometry` skip when profiles are `None`.

### Pitfall 3: ValidationError escaping as a 500
**What goes wrong:** `ReconstructionMetadata(...)` at line 536 is outside the guarded `try`; a bad point crashes with a traceback.
**How to avoid:** Guard overlay construction and raise `PipelineFailure(..., "INVALID_PROVIDER_RESULT", 502)`.

### Pitfall 4: Assuming `guide_fractions` has `shoulder`/`inseam`/`height`
**What goes wrong:** `KeyError` or silently dropped lines.
**Why:** Those keys are never emitted (verified in both CLAD and fallback paths). Use fixed tailoring fractions / `crotch_fraction()` / full span.

### Pitfall 5: Treating `width_at` as centimeters
**What goes wrong:** Endpoints scaled by height_cm land off-image.
**Why:** `tailoring._width` multiplies by `height_cm/height_px`; the raw `width_at` is already pixels. For the overlay, use raw pixels then normalize by `image_width`.

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Export a 3D GLB mannequin as the primary result; discard 2D silhouette data | Surface the already-computed 2D silhouette geometry as normalized overlay | Phase 1 emits the data the pipeline already had; no new modeling. |

**Deprecated/outdated:** None relevant. `_guide_geometry`/`_guide_lines` (3D GLB) remain unchanged and coexist with the new 2D overlay.

## Environment Availability

No NEW external dependencies. Phase 1 is pure Python within the existing `ai-service` venv.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| pytest | Validation | ✓ (configured) | per `requirements-dev.txt` | — |
| numpy / pydantic / Pillow | Overlay + schema | ✓ (imported in touched files) | per `requirements.txt` | — |

**Missing dependencies with no fallback:** None.

## Security Domain

`security_enforcement` is not set in `.planning/config.json` `[VERIFIED: .planning/config.json:1-12]` (only `cpu_only` and `dual_runtime_parity` constraints) → treat as enabled. Phase 1 handles no auth/session/network endpoint; the sole applicable control is input/output validation.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | Not in scope (internal pipeline) |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input/Output Validation | **yes** | Pydantic `field_validator` rejecting non-finite / out-of-[0,1] overlay points (PIPE-03) |
| V6 Cryptography | no | — |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed/NaN geometry propagating to client | Tampering / DoS (bad render) | Schema validation + clean `INVALID_PROVIDER_RESULT` rejection |
| Unbounded array sizes in `points` | DoS | `Field(min_length=2, max_length=8)` mirrors `GuideLine` |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Centering the horizontal band on the bbox center `(left+right)/2` is an acceptable horizontal position (D-08 fixes the SPAN via `width_at`, not the exact per-row x-offset). | Endpoint Derivation | Band could be a few px off-center on asymmetric poses; span (the trust-critical part) stays exact. |
| A2 | `upper_arm` should be OMITTED in v1 because per-row run x-positions aren't retained. | Mapping / Open Questions | If stakeholders require an `upper_arm` line, silhouette extraction must be extended (larger change). |
| A3 | `guide_fractions[short_key]` is preferred over the tailoring fixed fraction when both exist. | Mapping | Minor vertical placement difference (e.g. waist 0.62 vs 0.65); both are body-truthful, D-09 prefers CLAD. |

## Open Questions

1. **`upper_arm` overlay — omit or invest?**
   - What we know: arm circumference uses a residual; profile stores widths, not run x-positions; separability check exists (`_arm_diameter`).
   - What's unclear: whether a truthful arm segment is required in v1.
   - Recommendation: OMIT in v1 (D-02). If required later, add per-row run-extent arrays (nearest-run `start`/`end`, and full-span `left`/`right`) to `SilhouetteProfile` inside the extraction loop that already computes `nearest_start`/`nearest_end` `[VERIFIED: ai-service/app/reconstruction/silhouette.py:480-490]` — a contained addition that would also make ALL bands exactly positioned.

2. **Exact horizontal endpoints vs centered span.**
   - Recommendation: centered span for v1 (zero change to `silhouette.py`, least-invasive). Note the run-extent upgrade (Q1) as the path to pixel-exact endpoints if the trust story demands it.

## Sources

### Primary (HIGH confidence)
- `ai-service/app/schemas/api.py` (read in full) — `GuideLine`/`GuideGeometry`/`ReconstructionMetadata`/`BodyScanResponse` conventions and validators.
- `ai-service/app/reconstruction/silhouette.py` (read in full) — `SilhouetteProfile`, `width_at`, `_row_for_fraction`, `crotch_fraction`, `_resize_image`, `resolve_front_side_profiles`, `ResolvedSilhouetteProfiles`.
- `ai-service/app/pipeline.py` (read in full) — `_anny_targets`, `process`, `_guide_geometry`, `guide_fractions` wiring.
- `ai-service/app/measurements/tailoring.py` (read in full) — fixed body-level fractions, `_arm_diameter` residual thresholds.
- `ai-service/app/fitting/anny_fitter.py` (read in full) — `guide_fractions` key emission (CLAD + fallback), `FittedAnnyBody`.
- `ai-service/tests/test_silhouette_pipeline.py`, `tests/helpers.py`, `pyproject.toml` — test harness + config.

### Secondary / Tertiary
- None. All findings verified against source read this session; no web/training-only claims.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all imports verified present.
- Architecture / wiring: HIGH — `_anny_targets`, `process`, `resolve_front_side_profiles` read verbatim; call sites located.
- Endpoint math: HIGH — formula derived directly from `_row_for_fraction`/`width_at`/`_resize_image`.
- Pitfalls: HIGH — test-arity break and 500-vs-clean-rejection confirmed against line numbers.
- `upper_arm` omission: MEDIUM — technically forced by stored-field limitation; product acceptability is the open question.

**Research date:** 2026-09-25
**Valid until:** ~2026-10-25 (stable; internal code, no fast-moving external deps)
