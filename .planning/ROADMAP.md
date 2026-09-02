# Roadmap: SukatAI

## Overview

SukatAI will be migrated in place through three coarse, end-to-end phases. Phase 1 delivers the production-quality tracer slice: private front/side capture and height are validated before fitting, a durable attempt produces a truthful persisted result, and the existing model viewer shows provider-aligned guides. Phase 2 carries that contract across the retained Node/MariaDB, hosted Supabase, and XAMPP paths while protecting existing authentication, roles, routes, orders, invitations, uploads, and older scans. Phase 3 proves CPU practicality and reproducibility and adds an evaluation-only path for independent tape references. The roadmap preserves the existing product and never turns process quality or fitting loss into a fabricated accuracy percentage.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 1: End-to-End Truthful Scan Tracer** - Validate, process, persist, and review one truthful provider-aligned scan through the existing product flow. *(Local implementation complete; hosted migration push pending.)* (completed 2026-09-03)
- [ ] **Phase 2: Cross-Runtime and Legacy Review Continuity** - Preserve backend, role, route, asset, and older-scan compatibility across supported runtimes.
- [ ] **Phase 3: CPU Release Verification and Evaluation** - Prove target-laptop operation, automated coverage, reproducible builds, and honest reference-measurement evaluation.

## Phase Details

### Phase 1: End-to-End Truthful Scan Tracer

**Goal**: Customers can complete the active private front/side scan path from height capture through validation, CPU processing, durable persistence, truthful result review, and a provider-aligned 3D guide; an incomplete or failed attempt never becomes a misleading ready result.
**Depends on**: Nothing (first phase)
**Requirements**: TRUTH-01, TRUTH-02, TRUTH-03, VALID-01, VALID-02, GEOM-01, GEOM-02, LIFE-01, LIFE-02, LIFE-03, LIFE-04, PRIV-01, PRIV-02
**Success Criteria** (what must be TRUE):

  1. A customer can submit private front and side assets plus a real height, and each view is checked for decodeability, configured limits, full-body measurability, and required pose before expensive fitting; an invalid scan stays unpublished and shows a specific view-level correction message.
  2. A valid scan moves through durable validated, processing, ready, failed, and retrying states with an attempt identifier and provider/version metadata; retrying is idempotent, and a failed replacement attempt leaves the last durable ready result available when one exists.
  3. Ready measurement rows show their unit, method, source/provider, processing version, and scan identifier; input/process quality and provider diagnostics are separate from independently measured accuracy, and absent calibrated confidence or reference ground truth is shown as explicitly unreported/not independently validated with no invented percentage.
  4. The existing interactive viewer renders each selected measurement's provider-authored level/contour in the same calibrated model coordinate system used to derive the value and keeps guide selection synchronized with the measurement row; any geometry mismatch or fallback is visibly approximate/version-qualified and never presented as measurement-exact.
  5. Provider, storage, timeout, and persistence failures resolve to actionable user-readable states without stack traces or secrets, while body images and generated model assets remain private through the existing authorization-checked local or time-limited hosted access paths.

**Plans**: 2/2 local implementation plans complete; hosted migration push pending
**UI hint**: yes

### Phase 2: Cross-Runtime and Legacy Review Continuity

**Goal**: Existing customers, tailors/dressmakers, and administrators continue using the preserved authentication, role, route, invitation, order, upload, and result workflows while every supported backend returns the same versioned scan contract and older scans remain safely reviewable.
**Depends on**: Phase 1
**Requirements**: GEOM-03, BACK-01, BACK-02
**Success Criteria** (what must be TRUE):

  1. Node/MariaDB and hosted Supabase accept, validate, persist, and return the same measurement, provenance, lifecycle, and provider-guide contract for the updated scan flow, and the existing customer, tailor, and administrator routes consume it through the established adapters.
  2. The retained XAMPP path continues authentication, role authorization, uploads, results, invitations, orders, and private local asset access without breaking the existing workflows or exposing a new public asset path.
  3. Older scans with missing or outdated guide metadata remain loadable and visibly version-qualified; a fallback guide is clearly labeled approximate and is never presented as measurement-exact.

**Plans**: TBD
**UI hint**: yes

### Phase 3: CPU Release Verification and Evaluation

**Goal**: The completed migration is demonstrably practical on the target Lenovo ThinkPad L380 CPU and reproducible across supported environments, with honest internal measurement evaluation that cannot alter production customer values.
**Depends on**: Phase 2
**Requirements**: TRUTH-04, PERF-01, QA-01, QA-02
**Success Criteria** (what must be TRUE):

  1. An internal evaluation run compares provider output with consented tape-measurement references and reports per-measurement error without changing production customer measurements or turning the evaluation into an unqualified customer accuracy claim.
  2. Two-view processing bounds decoded image dimensions, memory use, and concurrency and runs on the target Lenovo ThinkPad L380 without CUDA; provider configuration, local startup, and resource expectations are documented for the supported path.
  3. Automated checks cover measurement normalization, nullable confidence and accuracy behavior, validation failures, guide geometry and calibration, persistence and retry promotion, backend boundaries, privacy, and the accuracy-validation limitation.
  4. A clean checkout can reproduce the documented typecheck, unit/Vitest tests, Python tests, and supported production builds for the local and hosted paths.

**Plans**: TBD

## Requirement Coverage

Every v1 requirement is assigned to exactly one phase.

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

**Coverage**: 20/20 v1 requirements mapped; no orphaned or duplicate assignments.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. End-to-End Truthful Scan Tracer | 2/2 | Complete    | 2026-09-02 |
| 2. Cross-Runtime and Legacy Review Continuity | 0/TBD | Not started | - |
| 3. CPU Release Verification and Evaluation | 0/TBD | Not started | - |
