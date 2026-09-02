---
phase: 02
phase_name: Cross-Runtime and Legacy Review Continuity
created: 2026-09-03
status: draft
requirements: [GEOM-03, BACK-01, BACK-02]
---

# Phase 02 Context: Cross-Runtime and Legacy Review Continuity

## Phase Goal

Existing customers, tailors/dressmakers, and administrators continue using the preserved authentication, role, route, invitation, order, upload, and result workflows while every supported backend returns the same versioned scan contract and older scans remain safely reviewable.

## Requirements

**GEOM-03**: Older scans with missing or older guide metadata remain loadable, are visibly version-qualified, and never present a fallback guide as measurement-exact.

**BACK-01**: Node/MariaDB and hosted Supabase paths accept, validate, persist, and return the same measurement/provenance/guide contract for the updated scan flow.

**BACK-02**: The retained XAMPP compatibility path does not break existing authentication, role authorization, uploads, results, invitations, orders, or private local asset access.

## Prior Phase Learnings

**Phase 1 delivered (committed locally, hosted gate pending):**
- Forward-only `scan_processing_attempts` lifecycle with claim/stage/fail/promote operations
- Provider-to-viewer guide contract with calibrated GLB coordinates and 7 mesh-plane contours
- Result truth mapper (`scanResultTruth.ts`) extracting unit, method, source, provider, version, scan id, attempt context
- Safe error messages redacting SQL, paths, tokens, stack traces
- Privacy boundaries preserved (body images and models only via authorized handlers)

**Phase 1 blockers (deferred to Phase 2):**
- Hosted migration push blocked by unavailable Supabase CLI (Phase 2 gate: run `supabase db push`)
- XAMPP path was statically reviewed but not PHP-linted (tooling unavailable)

**Phase 1 dependencies for Phase 2:**
- All implementations depend on `scan_processing_attempts` schema and attempt helpers being available in all three backends
- Result display depends on `scanResultTruth.ts` result truth mapper being callable from all adapters
- Guide rendering depends on provider contour metadata being persisted and versioned

## Locked Decisions

### Schema & Migration Strategy

**Decision: Additive migrations for all three backends; no schema reset or data loss.**

**Rationale:** Preserve existing data and customer workflows. Phase 1 prepared additive Supabase migration. Phase 2 will mirror it in Node/MariaDB and XAMPP.

**Implementation:**
- **Supabase:** Run prepared migration `20260902000000_scan_processing_attempts.sql` via `supabase db push` (hosted gate — Phase 2 task 1)
- **Node/MariaDB:** Write equivalent `scan_processing_attempts`, `measurement_provenance`, and `body_model_versions` tables (CREATE TABLE, no ALTER to existing tables)
- **XAMPP:** PHP schema setup script (manual or via `sukatai.sql` update) — same structure, same column names for adapter compatibility

**Canonical table structure across all backends:**
- `scan_processing_attempts` — durable lifecycle (attempt_id, scan_id, status, created_at, promoted_at, error_code, provider_metadata)
- `measurement_provenance` — tracer fields for each measurement (unit, method, source, provider, processing_version, quality_flags)
- `body_model_versions` — guide metadata (contour_data, calibrated_coordinates, axis/up convention, coordinate_system_version)

**Contract: All three backends report the same measurement/provenance/guide shape when queried via adapters.**

---

### Backward Compatibility Strategy

**Decision: Legacy scans (pre-Phase-2, no `scan_processing_attempts` entry) load safely and render as "version-qualified" until a fresh attempt is created.**

**Rationale:** Existing customer data must remain accessible. Older scans won't have attempt identifiers or guide metadata versions — we show that explicitly instead of failing or fabricating.

**Implementation:**
- On first load of a legacy scan: check if `scan_processing_attempts` row exists
  - **If yes:** use normal path (promoted result + guide metadata)
  - **If no (legacy):** create a synthetic READ-ONLY view:
    - attempt_id = null (or a synthetic "legacy-<scan_id>" marker)
    - status = "legacy_ready" (visibly different from "ready")
    - quality_flags = ["guide_version_unverified", "contour_data_missing_or_old"]
    - guide rendering labels contour data as "Approximate — measurement method may differ"

- **UI rendering:** Display badge "Legacy scan — guide is approximate" when `status == "legacy_ready"`

- **No auto-promotion:** Do not write synthetic `scan_processing_attempts` to the database for legacy scans (avoid creating misleading durability semantics). Readonly-view only.

- **Re-scan option:** UI shows "Re-scan" button for legacy scans → creates a fresh `scan_processing_attempts` entry and processes normally

---

### Result Bundle Adaptation

**Decision: Reuse `scanResultTruth.ts` as a shared library callable from Node, Supabase, and XAMPP adapters.**

**Rationale:** Avoid duplicating result-mapping logic per backend. The mapper is pure (input: bundle → output: display contract) and dependency-light.

**Implementation:**
- `src/lib/scanResultTruth.ts` remains JavaScript (callable from both frontend React and Node backend)
- Node backend: import and call `getScanResultTruth(bundle)` to build response before sending to client
- Supabase Edge Function (`process-scan/index.ts`): already calling it; continue as-is
- XAMPP adapter: PHP wrapper that calls Node's scan-result endpoint or re-implements the mapper in PHP (decision: call Node adapter via HTTP for now; Phase 3 can optimize if needed)

**Result shape consistency:** All adapters return identical JSON:
```json
{
  "scanId": "...",
  "attemptId": "...",
  "measurements": [
    {
      "label": "Chest",
      "valueCm": 95.0,
      "unit": "cm",
      "method": "mesh-contour-circumference",
      "source": "provider-name",
      "provider": "cpu-provider-v1.2",
      "processingVersion": "202609021830",
      "confidence": null,
      "qualityFlags": [...],
      "contourData": {...} or null
    }
  ],
  "qualityIssues": [...],
  "independentAccuracyValidated": false,
  "accuracy_disclaimer": "Independent accuracy has not been validated for this scan."
}
```

---

### Guide Serialization & Versioning

**Decision: Store provider contour metadata in a versioned `body_model_versions` table (or equivalent per backend); include coordinate_system_version to identify schema mismatches.**

**Rationale:** Guides must serialize, persist, and load correctly across backends. Version tagging handles old scans gracefully.

**Implementation:**
- On provider result → normalize contours → store as JSON in `body_model_versions.contour_data`
  - Include: coordinate_system_version (e.g., "provider-v1.2-202609021830"), axis convention, calibrated scale, named levels
- On load: check `coordinate_system_version` matches current viewer version
  - **Match:** use exact contour rendering
  - **Mismatch (old):** label as "Approximate" and use fallback mesh-slice with disclaimer
- Schema: `body_model_versions(model_id, scan_id, attempt_id, contour_data JSON, coordinate_system_version, created_at)`

---

### Retry & Promotion Flow

**Decision: Keep Phase 1's attempt lifecycle (claim → stage → promote) atomic per backend; backends coordinate via the shared `scan_processing_attempts` schema.**

**Rationale:** Durable retry without losing prior ready results is the Phase 1 contract. Phase 2 extends it to all backends without changing the sequence.

**Implementation:**
- **Node:** `claimScanAttempt` (idempotent, returns existing active) → `stageScanAttempt` (stage result before promotion) → `promoteScanAttempt` in transaction (delete prev staging, insert into published measurements)
- **Supabase:** RLS policy on `scan_processing_attempts` scoped to auth.uid (customer) + scanned scan (via `scans` RLS)
  - Edge Function calls `promote_scan_processing_attempt()` RPC (Postgres function, already in Phase 1 migration) with (scan_id, attempt_id)
- **XAMPP:** PHP transaction: begin → verify claim still active → stage result → promote in single COMMIT

**Failure mode:** If promotion fails on one backend, the scan remains in "processing" state on that backend but may be ready on others. Phase 2 includes backend-coordination logic to detect and report sync failures.

---

### Private Asset Access

**Decision: Preserve existing authorization boundaries per backend; do not create cross-backend asset leakage.**

**Rationale:** Existing scans and models are already protected. Phase 2 extends the same logic to new attempt records.

**Implementation:**
- **Node:** Existing `/scans/:scan_id/model` and `/scans/:scan_id/photos` are already RLS'd via session auth. New attempts inherit same scan ownership.
- **Supabase:** Storage bucket `body-models/<scan_id>/` and `body-scans/<scan_id>/` already have RLS checking `auth.uid == owner_id`. New attempt model uploads go to same bucket with same RLS.
- **XAMPP:** PHP session auth on `$_SESSION['user_id']` checks scan ownership before serving. New attempts inherit the check.

**No cross-backend asset serving:** A Supabase-authenticated user cannot fetch a Node-stored model without explicit backend bridging (out of scope for Phase 2).

---

### Testing & Verification

**Decision: Adapter contract tests — one test suite run against Node, Supabase, and XAMPP to verify all three return the same result shape.**

**Rationale:** Ensures backends don't drift. More efficient than duplicate per-backend suites.

**Implementation:**
- **Adapter tests:** `tests/adapters.test.ts` — parameterized test that runs identical input (scan id, fixture data) against each adapter endpoint and compares JSON shape, fields, data types
  - Mock or use local fixtures to avoid backend startup cost
  - Check: measurement array structure, provenance fields, guide versioning, error message safety
- **Backend-specific integration tests:** Node, Supabase, XAMPP have their own integration test suites (already exist) — Phase 2 adds contract-assertion steps to those
- **Cross-backend E2E (optional, Phase 3):** Full end-to-end flow (upload photos → validate → process → promote → query result) run against each backend sequentially

---

### Support for Older Guide Metadata (GEOM-03)

**Decision: Old scans that lack guide metadata are loadable but render with "Approximate" labels; new scans always include guide metadata via Phase 1 provider contract.**

**Rationale:** Respect existing data; make version differences explicit to users and UI.

**Implementation:**
- On model viewer load: check `contourData` presence and `coordinate_system_version`
  - **Present & matching:** render exact contours per Phase 1
  - **Missing or old version:** fall back to mesh-slice with disclaimer "Measurement guide is approximate — contour data not available for this scan"
- UI shows a version badge or info icon explaining why the guide is approximate
- Never silently infer an exact contour from a displayed number

---

## Deferred Questions

**What if Supabase CLI remains unavailable?**
- Mitigation: Provide migration SQL as a file to be run manually via Supabase Dashboard UI (alternative to `supabase db push`)

**How do we detect backend sync failures?**
- Phase 2 scope: log and report mismatches. Phase 3 can implement automated retry/reconciliation.

**Should XAMPP backends auto-create synthetic `scan_processing_attempts` for very old scans (pre-Phase-1)?**
- Decision deferred to Phase 2 planning: depends on how many pre-Phase-1 scans exist and how often they're accessed. For now: readonly-view + "Re-scan" button.

---

## Canonical References

All relative to the repository root:

- `.planning/REQUIREMENTS.md` — GEOM-03, BACK-01, BACK-02 full definitions
- `.planning/phases/01-end-to-end-truthful-scan-tracer/01-VERIFICATION.md` — Phase 1 verification report (what was built locally)
- `src/lib/reconstructionProvider.ts` — backend abstraction patterns
- `src/lib/scanResultTruth.ts` — result truth mapper (must be callable from all backends)
- `src/lib/data.ts` — existing data adapter patterns
- `server/index.mjs` — Node/Express patterns, current result endpoint
- `server/scanProcessingAttempt.mjs` — Phase 1 attempt helpers (Node)
- `supabase/functions/process-scan/index.ts` — Phase 1 Edge Function (Supabase)
- `supabase/migrations/20260902000000_scan_processing_attempts.sql` — Phase 1 Supabase migration (use as template for Node/XAMPP)
- `supabase/functions/_shared/scanProcessingAttempt.ts` — Phase 1 attempt helpers (Edge)
- `xampp/api/index.php` — XAMPP adapter patterns (need to extend with scan_processing_attempts schema and result mapping)
- `tests/scanResultTruth.test.ts` — Phase 1 result truth tests (Phase 2 will add adapter contract tests)

---

## Success Criteria

Phase 2 is complete when:

1. ✓ `scan_processing_attempts` schema exists and is populated in all three backends (Node/MariaDB, Supabase, XAMPP)
2. ✓ All three adapters return identical result JSON shape for the same scan (verified via adapter contract tests)
3. ✓ Legacy scans (pre-Phase-2) load without error and render guides as "Approximate" with version disclaimers
4. ✓ Retry & promotion flow remains durable and idempotent per Phase 1 contract
5. ✓ Private asset access is preserved — no cross-backend leakage, existing RLS/auth still applied
6. ✓ Hosted migration pushed (`supabase db push` executed successfully) — Phase 1's hosted gate resolved
7. ✓ Adapter contract tests pass for all three backends (same input → same output shape)
8. ✓ No existing customer data is lost or corrupted; all workflows (orders, invitations, uploads, auth, roles) continue to work

---

*Created: 2026-09-03*
*Decisions locked for Phase 2 planner and researcher*
