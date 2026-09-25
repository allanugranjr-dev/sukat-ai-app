# Phase 1 Discussion Log — 2D overlay geometry in the AI service

**Date:** 2026-09-25
**Mode:** discuss (guided autonomy)

## Areas selected by user

Measurement coverage · How circumference lines read · One view or both · Line placement source.

## Decisions reached

### 1. Measurement coverage
**Q:** Which measurements get a guide line?
**A:** All 8 returned mesh measurements, but OMIT any line that can't be confidently anchored (rather than estimate). Omitted measurements still show in the list.
→ D-01, D-02, D-03.

### 2. How circumference lines read
**Q:** Should Phase 1 carry a semantic `kind` so a circumference band reads truthfully?
**A:** Yes — tag each entry with `kind` (circumference/length/width) now, so Phase 3 renders/labels a wrap-around band distinctly from a straight length.
→ D-04, D-05.

### 3. One view or both
**Q:** Emit each line on one view, or both?
**A:** Single best view per measurement (front for widths/circumferences, side for depth-only). Keyed to the submitted slot the client displays.
→ D-06, D-07.

### 4. Line placement source
**Q:** What anchors the guide-line endpoints on the photo?
**A:** Silhouette body width at that level (`SilhouetteProfile.width_at`) — the exact pixels the value was derived from. Not pose landmarks in v1.
→ D-08, D-09, D-10.

## Notes / correctness gates surfaced

- View-swap: `resolve_front_side_profiles` may swap front/side vs submitted slots — overlay `view` must reflect the SUBMITTED slot (D-07).
- Wiring gap: SilhouetteProfiles are local to `_anny_targets` and discarded; must be retained into `process()`.
- Normalization against resized (≤720, aspect-preserved) image dims maps coords onto the original photo (D-10).

## Scope discipline

Both-view emission and pose-landmark anchoring were raised and explicitly deferred. v2 items (draggable lines, all-views, back view, image export) remain out of scope.
