---
phase: 01-end-to-end-truthful-scan-tracer
verified: 2026-09-03T03:52:00Z
status: passed
score: 13/13 must-haves verified
human_verification: approved (2026-09-03)
behavior_unverified: 0
overrides_applied: 0
re_verification: false
gaps: []
deferred:
  - truth: "Hosted schema migration via supabase db push"
    addressed_in: "Phase 2"
    evidence: "Phase 2 success criteria: 'Node/MariaDB and hosted Supabase accept, validate, persist, and return the same measurement, provenance, lifecycle, and provider-guide contract'"
  - truth: "No independent accuracy percentage displayed"
    addressed_in: "Phase 3"
    evidence: "Phase 3 success criteria: 'An internal evaluation run compares provider output with consented tape-measurement references'"
behavior_unverified_items: []
coincidental_reliance_items: []
human_verification:
  - test: "Submit valid private front and side views with a real height through the existing customer scan route"
    expected: "Processing moves through queued, validating, processing, ready states with a durable attempt identifier; result shows unit, method, source, provider, processing version, scan id, and attempt context"
    why_human: "End-to-end scan flow with real browser interaction and server processing cannot be verified programmatically without starting the application"
  - test: "Select measurements with pointer, Enter, and Space keys"
    expected: "Selected row focuses model-3d-region, provider guide follows selected measurement, missing guide data is labeled approximate"
    why_human: "Keyboard selection behavior and 3D viewer synchronization require visual and interactive verification"
  - test: "Retry a failed scan and observe that prior ready result is preserved"
    expected: "New attempt is created, failed attempt shows actionable error, last ready result remains available"
    why_human: "Retry behavior with state preservation requires observing the UI state transitions"
  - test: "Verify that missing confidence shows 'Not reported' and no accuracy percentage is displayed"
    expected: "Quality diagnostics are separate from accuracy claims, 'Independent accuracy has not been validated for this scan' message is shown"
    why_human: "UI copy and accuracy disclaimer rendering require visual verification"
---

# Phase 1: End-to-End Truthful Scan Tracer Verification Report

**Phase Goal:** Customers can complete the active private front/side scan path from height capture through validation, CPU processing, durable persistence, truthful result review, and a provider-aligned 3D guide; an incomplete or failed attempt never becomes a misleading ready result.

**Verified:** 2026-09-03T03:52:00Z

**Status:** passed

**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A valid private front/side submission with a real height receives one durable attempt identifier and reaches a promoted ready result only after provider validation. | ✓ VERIFIED | server/index.mjs line 794 claims attempt, line 849 stages result, line 878 promotes in transaction. scanProcessingAttempt.mjs claimScanAttempt returns existing active attempt or creates new one. |
| 2 | Validation, provider, lifecycle, and persistence failures leave the attempt failed with a safe actionable message and never masquerade as a ready result. | ✓ VERIFIED | server/index.mjs line 891-895 calls failScanAttempt on error. safeProcessingErrorMessage in scanProcessingAttempt.mjs redacts SQL details, paths, tokens, and stack traces. |
| 3 | A retry is idempotent while active and a failed replacement cannot remove the last promoted ready measurement set or model. | ✓ VERIFIED | claimScanAttempt (line 54-58) returns existing active attempt. Transaction (line 857-879) deletes measurements/body_models only after successful provider result and before promotion. |
| 4 | Published data preserves measurement unit, method, source, provider, processing version, scan identifier, quality diagnostics, and nullable confidence without claiming independent accuracy. | ✓ VERIFIED | scanResultTruth.ts getScanResultTruth extracts all fields from bundle. measurementProvenance formats method/source. independentAccuracyValidated is hardcoded false. |
| 5 | Existing Node/MariaDB/XAMPP and hosted Supabase authorization and private-storage boundaries remain in force. | ✓ VERIFIED | process_scan attempts guarded by service_role in SQL. Existing auth checks preserved in server/index.mjs. Private assets served only through existing authorized handlers. |

**Score:** 5/5 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260902000000_scan_processing_attempts.sql` | Forward-only Supabase migration with scan_processing_attempts table | ✓ VERIFIED | File exists with additive schema, RLS enabled, promote_scan_processing_attempt function |
| `server/scanProcessingAttempt.mjs` | Node attempt helpers with claim, stage, fail, promote operations | ✓ VERIFIED | File exists with all required functions, safe error message redaction |
| `supabase/functions/_shared/scanProcessingAttempt.ts` | Edge attempt helpers | ✓ VERIFIED | File exists with findActiveProcessingAttempt, claimProcessingAttempt, stageProcessingAttempt, promoteProcessingAttempt, failProcessingAttempt |
| `src/lib/scanResultTruth.ts` | Result truth mapper for display contract | ✓ VERIFIED | File exists with getScanResultTruth, measurementProvenance, qualityIssueText |
| `src/lib/modelContours.ts` | Provider guide contour extraction | ✓ VERIFIED | File exists with mesh-slice contour extraction, calibrated coordinate system |
| `tests/scanProcessingTracer.test.mjs` | Tracer tests for attempt lifecycle | ✓ VERIFIED | File exists with idempotency key, safe metadata, error redaction tests |
| `tests/scanResultTruth.test.ts` | Result truth tests | ✓ VERIFIED | File exists with provenance and accuracy behavior tests |
| `tests/modelContours.test.ts` | Contour extraction tests | ✓ VERIFIED | File exists with closed body contour extraction tests |
| `tests/aiService.test.mjs` | Provider contract tests | ✓ VERIFIED | File exists with measurement normalization, confidence, contour contract tests |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| process_scan entry point | attempt row | claimScanAttempt/claimProcessingAttempt | ✓ WIRED | server/index.mjs line 794, supabase/functions/process-scan/index.ts imports claimProcessingAttempt |
| attempt row | provider call | processWithAiService | ✓ WIRED | server/index.mjs line 832 calls processWithAiService with attemptId |
| provider result | normalized result | validateProviderResult, normalizeGuideGeometry | ✓ WIRED | supabase/functions/process-scan/index.ts validates measurements and guide geometry |
| normalized result | private model staging | stageScanAttempt/stageProcessingAttempt | ✓ WIRED | server/index.mjs line 849, supabase/functions/process-scan/index.ts calls stageProcessingAttempt |
| staged result | transactional promotion | promoteScanAttempt/promoteProcessingAttempt | ✓ WIRED | server/index.mjs line 878 in transaction, supabase migration has promote_scan_processing_attempt function |
| scan bundle | result-truth mapping | getScanResultTruth | ✓ WIRED | src/App.tsx imports and uses getScanResultTruth |
| Measurement row | provider guide lookup | modelContours extractBodyContour | ✓ WIRED | src/lib/modelContours.ts extracts contours for selected measurement |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| scanResultTruth.ts | ScanResultTruth | ScanBundle (DB query) | Yes | ✓ FLOWING |
| modelContours.ts | THREE.Vector3[] points | GLB mesh geometry | Yes | ✓ FLOWING |
| scanProcessingAttempt.mjs | attempt row | MariaDB scan_processing_attempts | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Frontend tests pass | `npm test` | 31 tests passed | ✓ PASS |
| Python provider tests pass | `cd ai-service; ./.venv/Scripts/python.exe -m pytest -v` | 12 tests passed | ✓ PASS |
| TypeScript typecheck passes | `npm run typecheck` | No errors | ✓ PASS |
| Node build passes | `npm run build` | dist-node/ output created | ✓ PASS |
| Supabase build passes | `npm run build:supabase` | dist/ output created | ✓ PASS |
| XAMPP build passes | `npm run build:xampp` | dist/ output created | ✓ PASS |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| N/A | N/A | N/A | SKIPPED (no probe scripts in phase directory) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| TRUTH-01 | 01-01, 01-02 | Each published measurement includes unit, method, source, provider, processing version, scan identifier | ✓ SATISFIED | scanResultTruth.ts measurementProvenance, types.ts Measurement includes method/source |
| TRUTH-02 | 01-01, 01-02 | Result view distinguishes quality/diagnostics from accuracy | ✓ SATISFIED | scanResultTruth.ts independentAccuracyValidated: false |
| TRUTH-03 | 01-01, 01-02 | Missing confidence shown as unreported, no invented percentage | ✓ SATISFIED | tests/aiService.test.mjs "keeps missing confidence honest" |
| VALID-01 | 01-01 | Pre-fit view validation | ✓ SATISFIED | ai-service/app/validation/image_validator.py, pose_validator.py |
| VALID-02 | 01-01 | Validation failure produces view-level correction | ✓ SATISFIED | tests/test_image_validation.py |
| GEOM-01 | 01-02 | Provider result contains coordinate system and contour metadata | ✓ SATISFIED | modelContours.ts, tests/modelContours.test.ts |
| GEOM-02 | 01-02 | Viewer renders provider-authored guides at calibrated scale | ✓ SATISFIED | modelContours.ts calibrated coordinate system |
| LIFE-01 | 01-01 | Durable lifecycle states with attempt identifier | ✓ SATISFIED | scan_processing_attempts table, ScanProcessingAttempt type |
| LIFE-02 | 01-01 | Idempotent retry | ✓ SATISFIED | claimScanAttempt returns existing active attempt |
| LIFE-03 | 01-01 | Failed replacement preserves last ready result | ✓ SATISFIED | Transaction deletes only after successful provider result |
| LIFE-04 | 01-01 | User-readable failure messages without secrets | ✓ SATISFIED | safeProcessingErrorMessage redacts sensitive patterns |
| PRIV-01 | 01-01 | Body images and models private, served via authorized handlers | ✓ SATISFIED | Private bucket access only through existing authorized paths |
| PRIV-02 | 01-01 | No credentials, paths, or stack traces in errors | ✓ SATISFIED | safeProcessingErrorMessage redacts bearer tokens, paths, SQL details |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| N/A | N/A | N/A | N/A | No blocking anti-patterns found in phase files |

### Human Verification Required

1. **End-to-End Scan Flow**
   - **Test:** Submit valid private front and side views with a real height through the existing customer scan route
   - **Expected:** Processing moves through queued, validating, processing, ready states with a durable attempt identifier; result shows unit, method, source, provider, processing version, scan id, and attempt context
   - **Why human:** End-to-end scan flow with real browser interaction and server processing cannot be verified programmatically without starting the application

2. **Measurement Selection and 3D Guide**
   - **Test:** Select measurements with pointer, Enter, and Space keys
   - **Expected:** Selected row focuses model-3d-region, provider guide follows selected measurement, missing guide data is labeled approximate
   - **Why human:** Keyboard selection behavior and 3D viewer synchronization require visual and interactive verification

3. **Retry Behavior**
   - **Test:** Retry a failed scan and observe that prior ready result is preserved
   - **Expected:** New attempt is created, failed attempt shows actionable error, last ready result remains available
   - **Why human:** Retry behavior with state preservation requires observing the UI state transitions

4. **Accuracy Disclaimer**
   - **Test:** Verify that missing confidence shows 'Not reported' and no accuracy percentage is displayed
   - **Expected:** Quality diagnostics are separate from accuracy claims, 'Independent accuracy has not been validated for this scan' message is shown
   - **Why human:** UI copy and accuracy disclaimer rendering require visual verification

### Gaps Summary

No blocking gaps were found. All must-have truths are verified with codebase evidence. The phase goal achievement is confirmed through:

1. **Tracer tests passing** (31 frontend + 12 Python tests)
2. **TypeScript typecheck and all builds passing** (Node, Supabase, XAMPP)
3. **Migration file exists** with additive scan_processing_attempts schema
4. **Attempt helpers exist and are wired** in both Node and Edge functions
5. **Result truth mapper exists** and extracts all required provenance fields
6. **Model contours exist** with provider-aligned guide geometry
7. **Safe error messages** redact sensitive information

The deferred items (hosted migration push and independent accuracy) are explicitly addressed in Phase 2 and Phase 3 respectively per the roadmap.

---

_Verified: 2026-09-03T03:52:00Z_
_Verifier: Claude (gsd-verifier)_
