# Roadmap: SukatAI — Real-photo measurement overlay

## Overview

The pipeline already computes everything needed to draw measurements on the real
photo — it just throws the 2D data away and exports a 3D mannequin instead. This
milestone surfaces that data end to end: emit 2D overlay geometry from the AI
service, carry it through both API runtimes and persist it, then render the
customer's real photo with labeled measurement lines as the default result view —
keeping the existing 3D mannequin behind a toggle.

## Phases

- [x] **Phase 1: 2D overlay geometry in the AI service** - Emit per-measurement image-space guide lines from data already computed (completed 2026-09-26)
- [ ] **Phase 2: Carry overlay through the contract** - Deliver + persist overlay geometry across Node/PHP runtimes; serve photos to client
- [ ] **Phase 3: Real-photo overlay result view** - Render photo with labeled lines, best-view-per-measurement, responsive scaling
- [ ] **Phase 4: 3D mannequin toggle + fallback** - Keep the mannequin as an option; graceful fallback when overlay is absent

## Phase Details

### Phase 1: 2D overlay geometry in the AI service

**Goal**: The AI service returns, per measurement, image-space guide-line endpoints keyed to the source view, computed on the CPU from existing silhouette fractions/widths and pose landmarks.
**Depends on**: Nothing (first phase)
**Requirements**: PIPE-01, PIPE-02, PIPE-03
**Success Criteria** (what must be TRUE):

  1. A processed scan response includes 2D overlay geometry for each measurement, with normalized endpoints, a `view` (front/side), and each view's pixel dimensions.
  2. Overlay coordinates are produced with no new model and no GPU/cloud dependency (CPU-only path unchanged).
  3. The overlay payload is schema-validated (finite, bounded) and rejected cleanly if malformed.

**Plans**: 2/2 plans executed

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Derive per-measurement image-space overlay lines in the pipeline (`_overlay_geometry` + `_anny_targets` 3-tuple), CPU-only, view-swap-safe, omission-truthful

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Add the OverlayGeometry/OverlayLine/OverlayView Pydantic schema + declared field; guard construction with clean INVALID_PROVIDER_RESULT/502 rejection

### Phase 2: Carry overlay through the contract

**Goal**: Overlay geometry travels from the AI service to the client on the Node runtime and persists with the scan; the PHP runtime matches the response shape; the client can fetch the photos to draw on.
**Depends on**: Phase 1
**Requirements**: API-01, API-02, API-03, PAR-01
**Success Criteria** (what must be TRUE):

  1. A completed scan's result payload includes overlay geometry over the Node runtime.
  2. Re-opening a completed scan returns the same overlay geometry without reprocessing (persisted).
  3. The PHP/XAMPP runtime returns the same response shape (overlay may be empty).
  4. The client can retrieve the customer's front/side photos for display.

**Plans**: TBD

Plans:

- [ ] 02-01: Normalize + forward overlay geometry in `server/aiService.mjs` / `server/index.mjs`; add client types
- [ ] 02-02: Persist overlay geometry with the scan result (schema + read/write)
- [ ] 02-03: Mirror the response shape in `xampp/api/index.php` (empty overlay allowed)

### Phase 3: Real-photo overlay result view

**Goal**: The results screen defaults to the customer's real photo with each measurement drawn as a labeled guide line at its position, each on its best view, scaling correctly on desktop and mobile.
**Depends on**: Phase 2
**Requirements**: OVL-01, OVL-02, OVL-03, OVL-04, OVL-05, PAR-02
**Success Criteria** (what must be TRUE):

  1. Opening a completed scan shows the real photo (not the mannequin) by default.
  2. Each measurement appears as a guide line at its correct body position, labeled with name + value + unit in the user's unit preference.
  3. Each measurement is shown on whichever view (front/side) reads clearest.
  4. Lines stay aligned to the body as the photo scales on desktop (centered ~480px) and mobile.
  5. If overlay geometry is missing, the view falls back to photo + measurement list without crashing.

**Plans**: TBD

Plans:

- [ ] 03-01: Photo + overlay component (SVG/canvas) mapping normalized coords to displayed pixels with responsive scaling
- [ ] 03-02: Best-view-per-measurement selection + labels + unit formatting + graceful fallback

### Phase 4: 3D mannequin toggle + fallback

**Goal**: The existing 3D mannequin is preserved as a toggleable alternate view; photo overlay stays the default.
**Depends on**: Phase 3
**Requirements**: OVL-06
**Success Criteria** (what must be TRUE):

  1. A toggle switches between the photo overlay view and the existing 3D mannequin view.
  2. The 3D mannequin (with its existing measured guide lines) still renders when selected.
  3. Photo overlay remains the default on load.

**Plans**: TBD

Plans:

- [ ] 04-01: Add view toggle; gate the Three.js mannequin behind it; default to photo overlay

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. 2D overlay geometry in the AI service | 2/2 | Complete    | 2026-09-26 |
| 2. Carry overlay through the contract | 0/3 | Not started | - |
| 3. Real-photo overlay result view | 0/2 | Not started | - |
| 4. 3D mannequin toggle + fallback | 0/1 | Not started | - |
