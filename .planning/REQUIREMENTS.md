# Requirements: SukatAI

**Core Value:** Customers and tailors receive a useful, clearly qualified set of body measurements from private front/side photos, with a 3D model whose guides correspond to the provider measurements actually shown.

## v1 Requirements

### Measurement Truth and Provenance

- [ ] **TRUTH-01**: Each published measurement includes its unit, measurement method, source/provider, processing version, and scan identifier.
- [ ] **TRUTH-02**: The result view distinguishes input/process quality and provider diagnostics from independently measured real-world accuracy.
- [ ] **TRUTH-03**: When no calibrated provider confidence or independent reference measurement exists, the customer-facing result shows an explicit unreported/ not independently validated state instead of an invented percentage.
- [ ] **TRUTH-04**: An internal evaluation path can compare a provider result with consented tape-measurement references and report per-measurement error without changing production customer values.

### Input Validation

- [ ] **VALID-01**: Before expensive fitting begins, the system validates that front and side assets are decodable, within configured size limits, contain a measurable full body, and satisfy the required pose rules.
- [ ] **VALID-02**: When validation fails, the customer sees a specific view-level correction message and the scan is not published as ready with measurements.

### Provider-Aligned 3D Guides

- [ ] **GEOM-01**: The provider result contains the coordinate system and exact level/contour metadata used to derive each displayed circumference guide.
- [ ] **GEOM-02**: The existing interactive viewer renders provider-authored guides at the same calibrated model scale and keeps guide selection synchronized with measurement rows.
- [ ] **GEOM-03**: Older scans with missing or older guide metadata remain loadable, are visibly version-qualified, and never present a fallback guide as measurement-exact.

### Processing Lifecycle and Retry

- [ ] **LIFE-01**: A scan has durable validated, processing, ready, failed, and retrying states with an attempt identifier and provider/version information.
- [ ] **LIFE-02**: Retrying a scan is idempotent and does not create duplicate published measurements or models.
- [ ] **LIFE-03**: A failed replacement attempt preserves the last durable ready result when one exists, while showing the failed attempt and an actionable retry state.
- [ ] **LIFE-04**: Provider, storage, timeout, and persistence failures resolve to user-readable status messages without exposing secrets or internal stack traces.

### Backend and Privacy Compatibility

- [ ] **BACK-01**: Node/MariaDB and hosted Supabase paths accept, validate, persist, and return the same measurement/provenance/guide contract for the updated scan flow.
- [ ] **BACK-02**: The retained XAMPP compatibility path does not break existing authentication, role authorization, uploads, results, invitations, orders, or private local asset access.
- [ ] **PRIV-01**: Body images and generated models remain private and are only served through existing authorization-checked local handlers or time-limited hosted access.
- [ ] **PRIV-02**: Processing logs and customer-facing errors do not expose credentials, private object paths, signed URLs, or unrelated user data.

### CPU Operation and Verification

- [ ] **PERF-01**: The active provider bounds decoded image dimensions, memory use, and processing concurrency so the two-view scan is practical on the target Lenovo ThinkPad L380 without CUDA.
- [ ] **QA-01**: Automated tests cover provider normalization, nullable confidence/accuracy behavior, validation failures, guide geometry/calibration, attempt promotion/retry, and backend contract compatibility.
- [ ] **QA-02**: The repository documents reproducible local provider/backend startup and provides passing typecheck, unit tests, Python tests, and production builds for the supported paths.

## v2 Requirements

Deferred until the v1 contract and validation foundation are stable:

- **EVAL-01**: Publish aggregate accuracy/error summaries to customers or staff after a consented, representative reference dataset and protocol are approved.
- **SCALE-01**: Replace the local serialized queue with a shared distributed job queue and horizontally scalable CPU workers.
- **MOBILE-01**: Add a dedicated automated native Android journey suite covering camera permissions, upload retries, offline transitions, and deep-link behavior.
- **MODEL-01**: Add new body-model families or high-fidelity reconstruction modes beyond the current bounded CPU provider after benchmark evidence justifies the cost.

## Out of Scope

- Rebuilding or broadly redesigning the existing SukatAI UI, navigation, role dashboards, authentication, orders, invitations, or forms.
- Resetting Supabase, recreating the database, deleting user data, or making private body assets public.
- Claiming a universal or customer-specific accuracy percentage from image quality, fitting loss, or a synthetic model comparison.
- Requiring CUDA, a discrete GPU, or a large reconstruction model for the target local workflow.
- Introducing a second competing active scanner implementation or bypassing the established browser/backend adapter boundaries.

## Definition of Done

- All v1 requirements mapped to exactly one roadmap phase.
- Existing authentication, storage privacy, roles, database data, routes, and supported backend modes remain functional.
- A known front/side fixture produces a durable result whose displayed guide contract matches the provider method and calibrated model coordinates.
- Invalid pose/input and provider/storage failures are actionable and retryable without destructive loss of prior ready output.
- No unsupported accuracy percentage is displayed.
- Typecheck, Vitest, Python tests, and available production builds pass; targeted manual verification is documented.

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| TRUTH-01 | Phase 1 | Implemented locally; hosted gate pending |
| TRUTH-02 | Phase 1 | Implemented locally |
| TRUTH-03 | Phase 1 | Implemented locally |
| TRUTH-04 | Phase 3 | Pending |
| VALID-01 | Phase 1 | Implemented locally |
| VALID-02 | Phase 1 | Implemented locally |
| GEOM-01 | Phase 1 | Implemented locally |
| GEOM-02 | Phase 1 | Implemented locally |
| GEOM-03 | Phase 2 | Pending |
| LIFE-01 | Phase 1 | Implemented locally; hosted gate pending |
| LIFE-02 | Phase 1 | Implemented locally |
| LIFE-03 | Phase 1 | Implemented locally |
| LIFE-04 | Phase 1 | Implemented locally |
| BACK-01 | Phase 2 | Pending |
| BACK-02 | Phase 2 | Pending |
| PRIV-01 | Phase 1 | Implemented locally |
| PRIV-02 | Phase 1 | Implemented locally |
| PERF-01 | Phase 3 | Pending |
| QA-01 | Phase 3 | Pending |
| QA-02 | Phase 3 | Pending |

---
*Requirements defined: 2026-09-02*
