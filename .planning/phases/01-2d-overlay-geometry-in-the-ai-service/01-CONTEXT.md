# Phase 1: 2D overlay geometry in the AI service - Context

**Gathered:** 2026-09-25
**Status:** Ready for planning

<domain>
## Phase Boundary

The AI service returns, per measurement, image-space guide-line endpoints keyed to
the source view (front/side), plus each view's pixel dimensions — computed on the
CPU from data already produced (CLAD `guide_fractions` + `SilhouetteProfile`). No
new model, no GPU/cloud. Delivering this payload through the API, persisting it, and
rendering it on the photo are later phases (2–4). Requirements: PIPE-01, PIPE-02, PIPE-03.

</domain>

<decisions>
## Implementation Decisions

### Measurement coverage
- **D-01:** Emit an overlay line for each of the 8 returned mesh measurements — `height`, `chest_circumference`, `waist_circumference`, `hip_circumference`, `thigh_left_circumference`, `upper_arm`, `shoulder`, `inseam`.
- **D-02:** If a measurement has no reliable silhouette anchor (missing body-level fraction, or arms-against-torso making `upper_arm` unresolvable), OMIT that line rather than guessing. The value still appears in the measurement list (Phase 3 / PAR-02 fallback). Every DRAWN line must be truthful.
- **D-03:** Overlay geometry is optional per-measurement — the schema and downstream code must tolerate fewer overlay entries than measurements.

### Line semantics
- **D-04:** Each overlay entry carries a semantic `kind` — `circumference` | `length` | `width` — alongside its endpoints and view.
- **D-05:** A circumference is drawn as a horizontal band (line span = body width at that level; the LABEL carries the wrap-around value, e.g. "Waist 78 cm"). The `kind` lets Phase 3 render/label a band differently from a straight length so the customer never reads the line's pixel length as the number.

### View selection
- **D-06:** Each measurement is emitted on its single clearest view only (one entry per measurement). Front for widths/circumferences; side reserved for depth-only measurements.
- **D-07:** The `view` tag is the SUBMITTED slot the client displays. Because `resolve_front_side_profiles` may swap front/side vs the submitted slots, the overlay must key to the submitted view, not the internally-assigned analysis view. (Correctness gate for planning.)

### Endpoint anchoring
- **D-08:** Horizontal guide-line endpoints are spanned by the actual silhouette body extent at that level via `SilhouetteProfile.width_at(fraction, center=True)` — the exact pixels the value was derived from. The line visually equals the measurement's basis (strongest trust story). Pose landmarks are NOT used for spanning in v1.
- **D-09:** Vertical placement (image row) comes from the CLAD `guide_fractions` for consistency with the returned values and the existing 3D guides: `Y_px = bottom_px - fraction * height_px`.
- **D-10:** Coordinates are NORMALIZED to [0,1] against the RESIZED (aspect-preserved, ≤720px) image dimensions carried on `SilhouetteProfile` (`image_width`/`image_height`), so they map onto the original photo at any display size.

### Claude's Discretion
- Exact field/type names of the new Pydantic schema (mirroring `GuideGeometry` conventions), provided it is finite/bounded-validated (PIPE-03).
- How SilhouetteProfiles are retained from `_anny_targets` into `process()` (return-tuple refactor vs re-resolve) — planner/researcher to choose the least-invasive path.
- Which non-circumference measurements map to `length` vs `width` kind (e.g. `shoulder`=width, `inseam`/`height`=length).
- Numeric clamping/epsilon strategy for out-of-range fractions.

</decisions>

<specifics>
## Specific Ideas

- Trust is the product: a drawn line must equal the pixels the number came from — hence silhouette-width spanning over anatomically-named pose spans.
- "Waist 78 cm" style label on a wrap-around band; never let the visible line length be misread as the value.
- Prefer omission over a plausible-but-wrong line.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase requirements & scope
- `.planning/REQUIREMENTS.md` §PIPE-01/02/03 — overlay geometry contract, CPU-only derivation, Pydantic validation.
- `.planning/ROADMAP.md` "Phase 1" — goal, success criteria, plans 01-01/01-02.
- `.planning/PROJECT.md` §Constraints — CPU-only hard-lock, dual-runtime parity, reversed gender macro.

### Code that defines the data & shape
- `ai-service/app/schemas/api.py` — `GuideGeometry`/`GuideLine`/`GuideContour` (mirror these conventions for the 2D schema), `ReconstructionMetadata` (extra="allow"; where overlay attaches), `BodyScanResponse`.
- `ai-service/app/reconstruction/silhouette.py` — `SilhouetteProfile` (image dims, top/bottom/left/right, `width_at`, `height_px`), `resolve_front_side_profiles` (front/side swap → D-07), `_resize_image` (≤720 aspect-preserved → D-10).
- `ai-service/app/pipeline.py` — `BodyScanPipeline.process`, `guide_fractions` source, `_anny_targets` (retains profiles → discretion item), existing `_guide_geometry`/`_guide_lines`.
- `ai-service/app/measurements/tailoring.py` — fixed body-level fractions per measurement (chest 0.70, waist 0.65, hip 0.64, thigh 0.42, shoulder@0.75 center=False, inseam=crotch_fraction, arm@0.67/0.59/0.51).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- CLAD `guide_fractions` (dict[str,float]): authoritative body-level vertical fractions per measurement — reuse directly for D-09, no recompute.
- `SilhouetteProfile.width_at()` / `_row_for_fraction()`: give horizontal extent and image row for a fraction — the core of D-08/D-09.
- Existing 3D `GuideGeometry` schema: pattern/precedent for a finite/bounded, view-keyed 2D schema (PIPE-03).

### Established Patterns
- CPU-only, aspect-preserved thumbnailing already normalizes image space (D-10 relies on it).
- Fractions are bottom-origin (0=feet, 1=head), shared by CLAD guides and silhouette rows — no unit mismatch.

### Integration Points
- New 2D overlay attaches to `ReconstructionMetadata` (extra="allow") on `BodyScanResponse`, parallel to `guide_geometry`.
- **Wiring gap:** SilhouetteProfiles are currently local to `_anny_targets` and discarded; Phase 1 must retain them into `process()` to build the overlay. (First planner task.)

</code_context>

<deferred>
## Deferred Ideas

- Both-view emission (front AND side for the same measurement) — considered, deferred; v1 is single best view (D-06).
- Pose-landmark-anchored endpoints — considered, deferred; v1 spans by silhouette width (D-08).
- Draggable/adjustable line positions, all-measurements-on-all-views, back-view overlay, annotated-image export — v2 (per REQUIREMENTS.md §v2).

</deferred>

---

*Phase: 01-2d-overlay-geometry-in-the-ai-service*
*Context gathered: 2026-09-25*
