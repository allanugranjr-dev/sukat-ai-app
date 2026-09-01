---
phase: "1"
slug: "end-to-end-truthful-scan-tracer"
status: recovered-draft
shadcn_initialized: false
preset: none
created: "2026-09-02"
---

# Phase 1 — UI Design Contract

> Preservation-focused contract for the existing SukatAI scan flow. This artifact documents the
> minimum UI behavior needed to make validation, processing, results, provenance, and guide
> selection truthful and usable. It does not authorize a broad visual redesign.

## Design System

| Property | Value |
|----------|-------|
| Tool | none |
| Preset | not applicable |
| Component library | none |
| Icon library | local `Icon` component in `src/App.tsx` |
| Font | DM Sans for interface text; Playfair Display for major headings |

Existing primitives to preserve: `Button`, `Badge`, `StatusBadge`, `Panel`, `DataState`, `LoadingState`,
`ErrorState`, `InlineError`, `Field`, `MeasurementTable`, and the responsive workspace navigation.
The Phase 1 work should extend these primitives only when a missing state or interaction cannot be
represented by the existing contract.

## Component Inventory

Enumerated by `rg -n "function (Button|Badge|Panel|DataState|LoadingState|ErrorState|InlineError|Field|MeasurementTable|ModelViewer)" src/App.tsx` — local React primitives; no third-party component package is installed.

| Component | Import path | Notes |
|-----------|-------------|-------|
| Button | `src/App.tsx` | Use for primary, secondary, ghost, gold, and danger actions. |
| Badge / StatusBadge | `src/App.tsx` | Use for durable scan/provider states; do not encode unsupported accuracy. |
| Panel | `src/App.tsx` | Existing surface container for capture, processing, and results. |
| DataState / LoadingState / ErrorState | `src/App.tsx` | Required for empty, loading, and recoverable data states. |
| InlineError | `src/App.tsx` | User-readable form and service errors; never expose secrets or stack traces. |
| MeasurementTable | `src/App.tsx` | Keyboard and pointer selection source for model guide focus. |
| ModelViewer | `src/App.tsx` | Existing interactive viewer; guide selection must stay synchronized with rows. |

## Spacing Scale

Declared values for new or touched Phase 1 layout rules (multiples of 4):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon-to-label and focus-ring breathing room |
| sm | 8px | Compact control gaps and badge padding |
| md | 16px | Default row/card spacing |
| lg | 24px | Panel interior and state grouping |
| xl | 32px | Viewer/result column gaps |
| 2xl | 48px | Major section separation |
| 3xl | 64px | Page-level separation where already present |

Exceptions: the existing stylesheet uses 3px, 5px, 7px, 9px, 10px, 11px, 12px, 13px, 15px,
17px, 18px, 22px, 23px, 25px, 28px, 29px, 30px, 35px, 37px, 38px, 39px, 41px, 45px, 53px,
54px, 57px, 60px, 65px, 67px, 68px, 74px, 75px, 78px, 83px, 86px, 90px, 100px, 106px,
107px, 110px, 115px, 120px, 126px, 140px, 145px, 175px, 193px, 195px, 220px, 230px, 233px,
235px, 245px, 255px, 290px, 300px, 310px, 325px, 335px, 390px, 410px, 420px, 450px, 480px,
530px, and 720px for existing typography, icon sizes, model geometry, and responsive dimensions.
Do not perform a global spacing rewrite in this phase.

## Typography

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Body | 12px | 400 | 1.6 |
| Label | 10–11px | 600 | 1.4 |
| Heading | 22–30px | 600–700 | 1.1–1.25 |
| Display | 37–54px | 600–700 | 1.05–1.15 |

Keep body copy direct and readable on the existing mobile layout. Error, status, and provenance
copy must not be reduced below the current readable size merely to fit a card.

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#f7f8f7` / `#fffdfa` | App background and primary surfaces |
| Secondary (30%) | `#182640` / `#101a2e` | Headings, dark viewer/capture surfaces, navigation |
| Accent (10%) | `#227472` / `#1b5c5b` | Primary focus, trusted/provider state, guide selection, links |
| Destructive | `#d84b4b` / `#fff0f0` | Failed processing, validation errors, destructive actions only |

Accent reserved for: primary actions, selected measurement rows, focus indicators, provider/trust
labels, progress state, and model guide strokes. Gold `#8a5a00` / `#fff5dd` is reserved for
warnings and sample/approximate states. Green is reserved for successful completion, never for
accuracy.

## Interaction Contract

- Capture: front and side are required; optional back remains visibly optional. Validation feedback
  names the affected view and the exact correction, and remains adjacent to the relevant upload.
- Processing: durable `queued`, `validating`, `processing`, `ready`, `failed`, and `retrying`
  states are rendered as states, not as an animated promise. A progress value is shown only when
  returned by the backend; otherwise use the stage label and a determinate-free status surface.
- Retry: `Try processing again` is disabled while the request is active. Returning from a failed
  replacement attempt must not hide a previous ready result.
- Results: clicking or keyboard-activating a measurement name selects it, applies `aria-pressed`
  or `aria-selected` consistently, scrolls/focuses `#model-3d-region`, and shows the matching guide.
  Enter and Space on a selectable row must produce the same result as pointer activation.
- Viewer: drag/pointer rotation, auto rotate, reset view, zoom, and guide visibility controls remain
  touch-friendly. Model controls must not prevent keyboard focus from reaching result rows or tabs.
- Provider guide: the viewer uses provider-authored contour/level metadata when available. A
  fallback/procedural guide is visibly labeled approximate and is never described as exact or as a
  measured tape line.
- Focus: every interactive control has a visible `:focus-visible` state with at least a 2px accent
  outline and sufficient contrast against its surface. Do not rely on color alone for selected or
  failed states.
- Reduced motion: `prefers-reduced-motion: reduce` disables auto-rotation and non-essential
  processing/model transitions while preserving direct state changes and control feedback.

## Responsive Contract

- Preserve the current desktop two-column capture/processing/results layouts and the existing
  responsive collapse to one column at the mobile breakpoint.
- Preserve the mobile bottom navigation and horizontally scrollable navigation behavior.
- The model viewer must fit within the mobile viewport without clipping its selected guide or status
  label; controls may wrap into a two-column grid but each control remains at least 44px high.
- Measurement rows may stack or scroll horizontally, but measurement name, value, unit, and truthful
  confidence/provenance state must remain readable without hover.
- Long validation/provider messages wrap inside the panel and do not create horizontal scrolling.

## Accessibility

- Keep semantic headings, `role="status"`/`role="alert"`, tablist/tab/tabpanel relationships,
  table headers, and `aria-controls`/`aria-labelledby` wiring already present in `src/App.tsx`.
- A selected guide has a non-color indicator (selected row state and accessible label) and the
  focused measurement is announced without dumping the entire model state into the live region.
- Progress uses `role="progressbar"` only for a real numeric backend progress value and includes a
  stage-aware `aria-valuetext`.
- Error copy identifies the user action required; internal provider names, credentials, private
  object paths, signed URLs, and stack traces never reach visible copy or live regions.
- Touch targets are at least 44×44px for model controls, bottom navigation, upload/remove actions,
  and retry/check-status controls.

## Copywriting Contract

| Element | Copy |
|---------|------|
| Primary CTA | `Submit photos` |
| Empty state heading | `Your model will appear here` |
| Empty state body | `Measurements will show after processing returns a valid result.` |
| Error state | State the specific problem, then the next action: `The uploaded front view could not be checked. Stand naturally with your arms slightly away from your body, then try again.` |
| Processing queued | `Your photos are stored securely while processing starts.` |
| Processing unavailable | `The processing service is unavailable. Your photos are safe. Try again or return to your uploads.` |
| Approximate guide | `Approximate guide — provider contour data was not returned for this measurement.` |
| Unreported confidence | `Not reported` |
| Accuracy limitation | `Independent accuracy has not been validated for this scan.` |
| Destructive confirmation | `Remove view`: `Remove this uploaded view? You can add it again before submitting.` |

## UI Considerations

Applicable state considerations resolved: 8 covered, 2 backstop, 0 unresolved

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| empty | `ModelViewer` / result model | ✅ covered | No valid measurements render the documented `Your model will appear here` empty state. |
| loading | processing panel | ✅ covered | Queued, validating, and processing states show the current durable stage and do not invent progress. |
| error | validation and processing panels | ✅ covered | View-level validation and provider failures render actionable copy and a retry/back-to-upload path. |
| populated | `MeasurementTable` and `ModelViewer` | ✅ covered | A returned measurement row and its provider guide share the same selected key and accessible label. |
| partial | provider guide metadata | ✅ covered | Missing guide metadata renders an explicit approximate/fallback qualifier rather than a false exact line. |
| overflow | long provider/validation message | 🧪 backstop | At narrow mobile widths, long error and provenance copy wraps without horizontal overflow or clipped retry controls. |
| zero-one-many | measurement rows | ✅ covered | Zero, one, and many rows retain readable headings, values, units, selection, and status semantics. |
| reduced-motion | viewer/processing animation | 🧪 backstop | With `prefers-reduced-motion: reduce`, auto-rotation and non-essential transitions stop while state and guide selection remain usable. |
| long-text | status/live region | ✅ covered | User-facing errors are sanitized and readable; secrets, signed URLs, and stack traces are excluded. |
| touch | viewer controls and mobile nav | ✅ covered | Interactive controls remain keyboard reachable and at least 44px high on mobile. |

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| local React primitives | `Button`, `Badge`, `Panel`, `DataState`, `ModelViewer`, `MeasurementTable` | no external registry; preserve existing components |

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS
- [ ] Dimension 7 Inventory Provenance: PASS

**Approval:** recovered draft; automated UI researcher/checker workers stalled before producing a result. The contract is grounded in the current source and is a planning prerequisite, not an application change.
