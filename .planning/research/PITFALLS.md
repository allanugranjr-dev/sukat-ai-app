# Domain Pitfalls

**Domain:** CPU-first two-view body measurement and tailor review
**Researched:** 2026-09-02
**Research method:** Existing failure evidence, codebase concerns, governing migration brief, and primary platform documentation.

## Critical Pitfalls

### Pitfall 1: Calling process quality accuracy

**What goes wrong:** A quality score, fitting loss, or nullable provider confidence is shown as a percentage of real measurement accuracy.

**Why it happens:** The UI needs a simple signal, but the repository has no independent tape-measurement ground truth.

**Consequences:** Users and tailors are misled; later validation cannot reproduce the claim.

**Prevention:** Keep `confidence: null` when no calibrated confidence is produced. Display quality/provenance separately. Add an evaluation-only metric based on reference tapes.

**Detection:** Search for `accuracy`, `confidence`, and average calculations; test null and numeric paths separately.

**Phase:** Measurement truth contract.

### Pitfall 2: Provider/viewer geometry disagreement

**What goes wrong:** The stored value is measured by a CLAD/convex contour at one level, while the viewer draws a raw mesh loop or fallback ellipse at another level/method.

**Why it happens:** The frontend can inspect the GLB but does not have the provider's exact contour definition.

**Consequences:** Rings float, cut through the body, or disagree with the displayed chest/waist/hip values.

**Prevention:** Export provider-authored contours or an explicit, tested level/method contract. Include coordinate-system and processing-version metadata. Test chest, waist, and hip on a known GLB.

**Detection:** Compare provider circumference to the viewer's rendered contour using the same model scale; reject unexplained discrepancies.

**Phase:** Geometry alignment.

### Pitfall 3: Publishing partial retry results

**What goes wrong:** A retry deletes the previous result and fails before the replacement model or measurements are durable.

**Why it happens:** Storage, provider, database, and status operations are separate side effects.

**Consequences:** A previously reviewable scan becomes empty or permanently failed after a transient error.

**Prevention:** Create attempt-scoped artifacts, validate them, then promote atomically. Retain the last ready result and record the failed attempt.

**Detection:** Inject provider timeout, model upload failure, and database failure at each stage; verify old output remains available.

**Phase:** Lifecycle/retry hardening.

### Pitfall 4: Treating in-memory service state as durable

**What goes wrong:** A service restart or second worker cannot find a completed result even though a GLB exists on disk.

**Why it happens:** Python `stored_scans` and Node's in-process queue are convenient local implementations.

**Consequences:** Stuck processing, false 404s, duplicate jobs, and unrecoverable support cases.

**Prevention:** Persist job/result metadata and attempt state in the active database; use a durable queue or clearly bounded single-worker local mode.

**Detection:** Process, restart, query status/model, and repeat with two workers.

**Phase:** Lifecycle/retry hardening and deployment verification.

### Pitfall 5: Letting poor pose contaminate measurements

**What goes wrong:** Arms touching the torso, bent posture, cropped feet, occlusion, or inconsistent front/side framing produces plausible-looking but wrong values.

**Why it happens:** Silhouette extraction can still return a mask even when the pose is not measurable.

**Consequences:** Bad body proportions and misleading 3D geometry reach tailor review.

**Prevention:** Validate landmark visibility and view-specific pose rules before fitting; return actionable per-view correction guidance.

**Detection:** Keep fixtures for arms-away front, true side, cropped body, occluded body, and inconsistent height/scale.

**Phase:** Validation and provider contract.

## Moderate Pitfalls

### Pitfall 1: Coordinate-system and calibration drift

**What goes wrong:** Anny/GLB/browser axes, units, or height scaling differ between export and display.

**Prevention:** Store coordinate system, source height, exported height, and scale factor; test feet-on-ground and known model height after every export.

### Pitfall 2: Stale persisted metadata

**What goes wrong:** New viewer code runs against old scans that only have older guide fractions or a different processing version.

**Prevention:** Version metadata, support safe fallback, and provide a controlled reprocess/backfill path; never silently claim new geometry for old results.

### Pitfall 3: Backend-mode drift

**What goes wrong:** Node works while Supabase or XAMPP omits quality, guide metadata, retry behavior, or access checks.

**Prevention:** Maintain one domain contract and run equivalent adapter tests for each supported mode.

### Pitfall 4: Private asset leakage through the viewer

**What goes wrong:** A signed URL is replaced with a public URL, or model loading bypasses authorization.

**Prevention:** Keep buckets private and use authorized signed/local asset routes; never log or persist long-lived URLs unnecessarily.

### Pitfall 5: CPU and memory overload

**What goes wrong:** Original phone images, rembg model downloads, parallel fitting, or too many Uvicorn workers exhaust the target laptop.

**Prevention:** Bound upload dimensions/bytes, resize before fitting, cache optional models, limit concurrency, and measure stage timings on the ThinkPad.

### Pitfall 6: Edge Function timeout assumptions

**What goes wrong:** A hosted Edge Function performs heavy reconstruction or assumes a background task is durable.

**Prevention:** Keep Edge Functions short and idempotent; use them for authenticated orchestration and status updates while the CPU provider performs heavy work behind a durable job contract.

## Minor Pitfalls

### Pitfall 1: Overlapping rings obscure selection

**What goes wrong:** Multiple guides or duplicate fallback rings make pointer selection ambiguous.

**Prevention:** Use one authoritative guide per returned measurement, clear hit targets, keyboard selection, and a legend tied to measurement rows.

### Pitfall 2: Error messages expose internal provider details

**What goes wrong:** Stack traces, private paths, or provider keys appear in customer-facing errors.

**Prevention:** Keep stable user messages in the browser and detailed diagnostics in protected logs/metadata.

### Pitfall 3: Tests prove only pure helpers

**What goes wrong:** Unit tests pass while camera permissions, private assets, status transitions, and mobile navigation fail.

**Prevention:** Add one end-to-end scan fixture and one failure/retry scenario per backend mode where feasible.

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Measurement truth | Fake percentage from quality/loss | Null confidence and reference-data gate |
| Provider contract | Missing guide coordinate/method metadata | Versioned result schema and boundary validation |
| 3D viewer | Ring level/contour mismatch | Provider-authored contour fixtures and GLB scale tests |
| Processing lifecycle | Stuck status or destructive retry | Attempt records, compare-and-set transitions, safe promotion |
| Hosted deployment | Edge timeout/private URL leak | External worker, signed URLs, idempotent function |
| Local deployment | CPU/RAM exhaustion | Bounded inputs, one worker baseline, measured performance |
| Release | Backend-mode drift | Contract suite across Node/Supabase/XAMPP |

## Sources

- Existing codebase map: `.planning/codebase/CONCERNS.md`, `ARCHITECTURE.md`, and `TESTING.md`.
- Governing migration brief: `C:/Users/grana/.codex/attachments/6c498372-80e5-4118-9a5f-95c6fc1002d1/pasted-text.txt`.
- [FastAPI background task guidance](https://fastapi.tiangolo.com/tutorial/background-tasks/).
- [Supabase Edge Function limits](https://supabase.com/docs/guides/functions/limits).
- [Supabase private Storage access](https://supabase.com/docs/guides/storage/buckets/fundamentals).
