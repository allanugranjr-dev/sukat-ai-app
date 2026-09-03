---
phase: 03
phase_name: CPU Release Verification and Evaluation
created: 2026-09-03
status: draft
requirements: [TRUTH-04, PERF-01, QA-01, QA-02]
---

# Phase 03 Context: CPU Release Verification and Evaluation

## Phase Goal

The completed migration is demonstrably practical on the target Lenovo ThinkPad L380 CPU and reproducible across supported environments, with an honest internal measurement-evaluation capability that cannot alter production customer values.

## Requirements

**TRUTH-04**: An internal evaluation path can compare a provider result with consented tape-measurement references and report per-measurement error WITHOUT changing production customer values.

**PERF-01**: The active provider bounds decoded image dimensions, memory use, and processing concurrency so the two-view scan is practical on the target Lenovo ThinkPad L380 without CUDA; provider configuration, local startup, and resource expectations are documented for the supported path.

**QA-01**: Automated tests cover provider normalization, nullable confidence/accuracy behavior, validation failures, guide geometry/calibration, attempt promotion/retry, and backend contract compatibility.

**QA-02**: The repository documents reproducible local provider/backend startup and provides passing typecheck, unit (Vitest) tests, Python tests, and production builds for the supported paths.

## Prior Phase Learnings

**Phase 1 delivered (complete):**
- Durable `scan_processing_attempts` lifecycle (claim/stage/fail/promote) shared across Node/MariaDB, Supabase, XAMPP.
- Shared result-truth mapper (`src/lib/scanResultTruth.ts`) and backend contract tests.
- Calibrated GLB + provider-authored mesh-plane contours versioned for the viewer.
- Safe error redaction; privacy boundaries preserved.

**Phase 2 delivered (complete):**
- All three backends (Node/MariaDB, Supabase, XAMPP) return the same versioned scan contract.
- Legacy scans load safely and render visibly version-qualified.
- Adapter contract + legacy-scan tests pass (72 Vitest total).

**Active CPU provider already bounds resources (verified during planning):**
- `device="cpu"` is hard-coded — never auto-selects CUDA (`ai-service/app/core/config.py`).
- `max_image_long_edge=1280` downsample + `MAX_DIMENSION=8000`/min-dimension guards in `image_validator.py`.
- `max_concurrent_scans=1` with an `asyncio.Semaphore` single-job queue (`main.py`).
- Uploads bounded at 10 MB and processed in memory (photos not retained).

## Phase 3 Gaps Identified

1. **No internal evaluation path exists** (TRUTH-04). There is no tape-reference ingestion, per-measurement error computation, or read-only harness that can never mutate production values.
2. **CPU/resource expectations are implied by code but not written down** (PERF-01 doc half). Configuration defaults exist but the target-laptop resource contract is not documented as a release statement.
3. **QA-01 is broad but thin in two spots**: no dedicated provider-normalization (measurement rounding/finite/unit/nullable-confidence) test, and no explicit config-bounds test that stops the CPU/concurrency/dimension defaults from regressing.
4. **QA-02 reproducible gate**: typecheck, Vitest, and Pytest pass today; production builds and a single reproducible-startup document are not yet verified/recorded as one gate.

## Locked Decisions

### Internal Evaluation Path (TRUTH-04)

**Decision: Evaluation lives in the isolated Python provider as a pure, read-only module + CLI harness. It never writes production customer values.**

**Rationale:** TRUTH-04 requires comparing provider output to consented tape references and reporting error without changing production. Keeping it in the provider where results are produced, as pure functions over in-memory data, makes the "cannot change production" property structurally explicit rather than enforced by convention.

**Implementation:**
- New `app/evaluation/` module: parse/validate a tape-reference dataset; compute per-measurement signed delta, absolute error, relative error % over matching keys; report matches only (a measurement with no reference is excluded, never given a fabricated error).
- New `scripts/evaluate_scan.py` CLI harness: reads a provider result JSON + a references JSON, prints a per-measurement report. Read-only: no DB, no writes.
- Every report is tagged `internal_evaluation: true` and is deliberately not a customer-facing accuracy claim.
- Tests prove: correct math, alias matching, missing-reference exclusion, empty-reference behavior, and that the evaluation function is immutable over its inputs.

### CPU Resource Contract (PERF-01)

**Decision: The target release contract is `device=cpu`, no CUDA, long-edge ≤ 1280 px, single-job concurrency, in-memory bounded uploads — documented as a release statement and protected by a config-bounds test.**

**Implementation:**
- Document the resource expectations in `docs/cpu-release.md` (and cross-link from `ai-service/README.md`).
- Extend `scripts/system_check.py` to also report the configured CPU/resource bounds.
- Add `test_resource_bounds.py` asserting the defaults (cpu device, 1280 long edge, concurrency 1) and the image downsampling behavior, so they cannot silently regress.

### QA / Reproducible Gate (QA-01, QA-02)

**Decision: QA-01 gaps (provider normalization, config bounds) are closed with dedicated tests; QA-02 is closed by running every gate in one verification run and recording a single reproducible-startup document.**

**Implementation:**
- Add `test_measurement_normalization.py` (rounding, finite, unit literal, nullable confidence, method/source presence) and `test_resource_bounds.py` (config defaults + image downsampling).
- Run and record the full gate: `tsc --noEmit`, Vitest run, Pytest, and the three frontend production builds (`node`, `supabase`, `xampp`).
- Write `docs/reproducible-startup.md` with exact commands for Node, ai-service, Supabase, XAMPP, and the verification gate.

## Non-Goals (carried from ROADMAP Phase 3 / v2)

- No agreed reference dataset yet → evaluation remains internal-only, never published (EVAL-01 deferred to v2).
- No fabrication of an unqualified customer accuracy percentage.
- No CUDA path, no distributed queue (SCALE-01 deferred), no new model families (MODEL-01 deferred).

## Success Criteria

Phase 3 is complete when:

1. An internal evaluation run can compare a provider result with tape-measurement references and report per-measurement error, and the code path provably cannot change production customer values (verified by immutability tests).
2. The CPU provider's image-dimension, memory, and concurrency bounds are documented for the Lenovo ThinkPad L380 and are protected from regression by automated tests.
3. Automated coverage includes provider normalization, nullable confidence/accuracy, validation failures, guide geometry/calibration, attempt promotion/retry, backend contract, and the evaluation path.
4. A clean checkout can reproduce the documented typecheck, Vitest tests, Python tests, and supported production builds for the local and hosted paths.

## Canonical References

- `ai-service/app/core/config.py`, `ai-service/app/main.py`, `ai-service/app/pipeline.py`
- `ai-service/app/validation/image_validator.py`
- `ai-service/app/schemas/api.py` (MeasurementValue, BodyScanResponse)
- `ai-service/app/measurements/tailoring.py`, `ai-service/app/measurements/calibration.py`
- `ai-service/tests/*`
- `src/lib/scanResultTruth.ts` (shared result truth; evaluation intentionally separate)
- `docs/`, `ai-service/README.md`

---
*Created: 2026-09-03*
*Decisions locked for Phase 3 planner and executor*
