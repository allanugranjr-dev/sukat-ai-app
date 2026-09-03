---
phase: 02-cross-runtime-and-legacy-review-continuity
plan: 04
status: implementation-complete
completed: 2026-09-03
---

# Phase 2 Plan 04 Summary — Adapter Contract Tests

## Delivered

- Created `tests/adapters.contract.test.ts` — parameterized adapter contract tests covering:
  - Result shape consistency (exact key set of the versioned scan contract).
  - Provider and processing-version fallback mapping.
  - Measurement provenance text extraction.
  - Cross-backend JSON shape parity for the canonical bundle.
  - Legacy scan handling (null attempt ID / provider / quality, no accuracy invented).
  - Safe error redaction for database, injection, path, and token patterns.
- Extended `src/lib/scanResultTruth.ts`:
  - `qualityIssueText` now accepts `unknown`, tolerates null/malformed input, and redacts internal error markers (SQL, queries, paths, URLs, credentials) behind a safe default message.
- Documented the adapter contract as the shape every backend (Node/MariaDB, Supabase, XAMPP) must produce for the same scan.

## Verification

- Full Vitest suite: **72 tests across 14 files pass**.
- Node typecheck passes.
- Adapter contract tests run and pass for the canonical result shape, legacy scan handling, and safe redaction.

## Coverage

GEOM-03 (older scans load, visibly version-qualified), BACK-01 (Node/MariaDB and Supabase return the same contract), and BACK-02 (XAMPP path parity) are exercised by the contract and legacy-scan tests.
