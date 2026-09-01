# Codebase Concerns

**Analysis Date:** 2026-09-01

## Tech Debt

**Three independently maintained backend implementations:**
- Issue: The same domain actions and access rules exist in Supabase Edge Functions/RLS, the Node/MariaDB API, and the XAMPP/PHP API. The frontend switches among them in `src/lib/data.ts`, `src/lib/auth.ts`, and `src/lib/storage.ts`.
- Files: `src/lib/data.ts`, `src/lib/auth.ts`, `src/lib/storage.ts`, `server/index.mjs`, `xampp/api/index.php`, `supabase/functions/process-scan/index.ts`, `supabase/migrations/20260829000000_sukatai_schema.sql`
- Impact: A feature or security correction can be implemented in one runtime and omitted from the others; review burden and behavior drift rise with every role, invitation, scan, and storage change.
- Fix approach: Select one production backend contract as authoritative. If local adapters remain required, define shared contract tests and keep backend-specific code behind a narrow adapter interface rather than duplicating business workflows.

**Monolithic UI and API dispatch modules:**
- Issue: `src/App.tsx` contains navigation, scan capture, camera lifecycle, 3D presentation, dashboards, forms, and role workflows in 2,676 lines. `server/index.mjs` combines HTTP middleware, authentication, authorization, data access, notifications, processing orchestration, Socket.IO, and all action dispatch in 1,487 lines. `xampp/api/index.php` repeats the same concentration in 1,271 lines.
- Files: `src/App.tsx`, `server/index.mjs`, `xampp/api/index.php`
- Impact: Small modifications have a broad regression surface, merge conflicts are likely, and unit testing internal workflows is difficult.
- Fix approach: Extract route/action handlers, domain services, and repository modules from `server/index.mjs`; split UI screens and hooks from `src/App.tsx`; avoid adding new actions to the PHP monolith.

**Schema is applied opportunistically on server startup:**
- Issue: The Node service executes the complete XAMPP SQL schema and imperative `ALTER TABLE`/`CREATE TABLE` statements at startup.
- Files: `server/database.mjs`, `xampp/database/sukatai.sql`, `server/setup-db.mjs`
- Impact: Deploy startup requires DDL permissions, schema changes are not versioned as a linear migration history, and a multi-instance deployment can race during initialization.
- Fix approach: Move MariaDB evolution to ordered, idempotent migration files executed by a deploy-time migration command. Keep `initializeDatabase()` limited to opening an already-migrated pool.

**Placeholder reconstruction is a product-critical fallback:**
- Issue: The default `auto` mode deliberately selects calibrated silhouettes, and the fallback shape incorporates fixed reference-body priors. The implementation labels the result, but it still produces measurement values and a GLB.
- Files: `ai-service/app/pipeline.py`, `ai-service/app/reconstruction/silhouette.py`, `ai-service/app/measurements/tailoring.py`, `docs/body-measurement-pipeline-plan.md`
- Impact: Measurements can be inaccurate for bodies, poses, lighting, or backgrounds that differ from the heuristic assumptions; result quality is not empirically calibrated in the codebase.
- Fix approach: Gate measurement publication on a validated learned provider or an explicit demo-only feature flag. Record validation evidence, provider/model versions, and calibration error bounds before treating output as production measurement data.

## Known Bugs

**AI-service result APIs lose completed scan metadata after a restart or across workers:**
- Symptoms: A scan may finish and write a GLB to disk, but `GET /api/v1/body-scan/{scan_id}`, `/status`, `/measurements`, and `/model-file` return 404 after the service restarts or requests reach a different worker.
- Files: `ai-service/app/main.py`
- Trigger: Process a scan, then restart the Python service or run it with multiple independent workers.
- Workaround: Keep a single process alive; no durable lookup exists in this service.

**Scan-asset deletion can leave the database and storage out of sync:**
- Symptoms: When object deletion succeeds but deleting the corresponding `scan_assets` row fails, the database continues to reference a non-existent object. The inverse failure leaves an undeleted object when storage removal fails.
- Files: `src/lib/storage.ts`
- Trigger: Delete an asset while the second network operation fails or authorization changes between the two operations.
- Workaround: Retry manually; there is no reconciliation job.

**Supabase processing failure deletes prior outputs before replacement is durable:**
- Symptoms: A transient provider, storage, or database failure removes existing measurements and body-model rows, then marks the scan failed.
- Files: `supabase/functions/process-scan/index.ts`
- Trigger: Reprocess an existing scan and cause an error after the deletes at `supabase/functions/process-scan/index.ts:364` and `supabase/functions/process-scan/index.ts:366` but before the final scan update.
- Workaround: Reprocess the scan; previously reviewed results are not retained as a versioned fallback.

## Security Considerations

**Python reconstruction service can be unintentionally unauthenticated:**
- Risk: `_authorized()` allows every protected endpoint whenever `AI_SERVICE_API_KEY` is unset. The service binds to all interfaces when launched directly, and processing endpoints accept image uploads and return personalized measurements/models.
- Files: `ai-service/app/main.py`, `ai-service/app/core/config.py`, `ai-service/README.md`
- Current mitigation: An API key is enforced when configured; scan IDs are constrained and uploads are size-limited.
- Recommendations: Fail closed outside an explicitly local development mode when the key is missing. Put the service behind private networking/authentication, and add a startup check that rejects public binding without an authentication configuration.

**Node cookie sessions have no explicit CSRF defense for cross-site cookie configurations:**
- Risk: Mutating Node endpoints authenticate only with the session cookie. The default `SameSite=Lax` reduces exposure, but `SUKATAI_COOKIE_SAMESITE=None` enables cross-site cookies without a CSRF token or strict Origin/Referer verification on state-changing requests.
- Files: `server/config.mjs`, `server/index.mjs`, `src/lib/nodeApi.ts`
- Current mitigation: An allowlist-based CORS response is set in `server/index.mjs`; cookies are `HttpOnly` and default to `Lax`.
- Recommendations: Keep `SameSite=Lax` unless cross-site deployment is required. For `None`, require a synchronizer/double-submit CSRF token and validate Origin on all mutating API actions, including multipart uploads.

**No request throttling on credential and expensive processing endpoints:**
- Risk: `sign_in`, `sign_up`, password-reset/update paths, invitation workflows, image upload, and scan processing have no rate limiter or quota. An attacker can exhaust bcrypt, storage, provider, and notification resources or enumerate operational behavior.
- Files: `server/index.mjs`, `xampp/api/index.php`, `ai-service/app/main.py`, `supabase/functions/invite-dressmaker/index.ts`, `supabase/functions/process-scan/index.ts`
- Current mitigation: Node upload size is capped at 10 MB in `server/index.mjs`; the AI service checks upload size and image dimensions in `ai-service/app/validation/image_validator.py`.
- Recommendations: Apply identity/IP-aware rate limits, per-user scan quotas, bounded concurrent jobs, and provider/notification circuit breakers at the edge and in each backend.

## Performance Bottlenecks

**Node scan processing is intentionally serialized in one in-process promise chain:**
- Problem: Every queued Node scan waits for all earlier scans, including provider calls and model downloads.
- Files: `server/index.mjs`, `server/aiService.mjs`
- Cause: `processingQueue` chains each job behind the previous one at `server/index.mjs:873`; a process restart loses queue state.
- Improvement path: Use a durable job queue with bounded worker concurrency and idempotent job records. Preserve the short database commit serialization separately if needed, rather than serializing network and CPU work.

**Browser scan lists fan out into one request group per historical scan:**
- Problem: Fetching all customer measurement sets issues one `getScanBundle()` request group per scan, each performing four Supabase queries.
- Files: `src/lib/data.ts`
- Cause: `listCustomerMeasurementSets()` calls `Promise.all(scans.map((scan) => getScanBundle(scan.id)))` at `src/lib/data.ts:121`.
- Improvement path: Add a paginated backend query/RPC that returns only the dashboard summary fields, then load a single bundle only when the user opens a scan.

**CPU-heavy reconstruction runs synchronously inside async request handlers:**
- Problem: The FastAPI request handler calls `pipeline.process()` directly, including image decoding, OpenCV/rembg work, mesh construction, and GLB export.
- Files: `ai-service/app/main.py`, `ai-service/app/pipeline.py`, `ai-service/app/reconstruction/silhouette.py`
- Cause: `create_body_scan()` calls the synchronous pipeline at `ai-service/app/main.py:168`; CPU-bound work blocks the worker handling the request.
- Improvement path: Submit work to a bounded background worker/queue, persist status durably, and return a job identifier. Enforce CPU/memory limits and isolate native image/model processing in worker processes.

## Fragile Areas

**Supabase scan-processing state transition spans non-transactional remote side effects:**
- Files: `supabase/functions/process-scan/index.ts`, `supabase/migrations/20260901000000_harden_scan_processing_and_storage.sql`
- Why fragile: The function transitions status, creates signed URLs, calls a provider, downloads/uploads a model, deletes old rows, upserts results, and updates final state through separate operations. Partial failure cleanup can itself fail, leaving a misleading state or losing prior results.
- Safe modification: Keep the compare-and-set scan status guards, add explicit processing attempt/version records, write new artifacts under an attempt ID, then atomically promote the attempt after all data is present.
- Test coverage: No automated tests execute Edge Functions against Supabase storage, RLS, provider timeouts, retries, or partial-failure cleanup.

**Local backend compatibility relies on frontend mode switches:**
- Files: `src/lib/supabase.ts`, `src/lib/nodeApi.ts`, `src/lib/xampp.ts`, `server/index.mjs`, `xampp/api/index.php`
- Why fragile: API shape and authorization semantics are manually kept compatible. Node additionally provides Socket.IO status updates, while the XAMPP implementation does not, so behavior is mode-dependent.
- Safe modification: Add a backend contract suite that runs the same auth, scan, invitation, asset, order, and processing scenarios against each supported mode. Deprecate modes that cannot meet the same privacy and lifecycle guarantees.
- Test coverage: Existing frontend tests only cover pure helpers and one Node provider-response normalizer; there are no Node/PHP HTTP integration tests.

**AI-service process-local state and disk artifacts are coupled:**
- Files: `ai-service/app/main.py`, `ai-service/app/pipeline.py`, `ai-service/app/reconstruction/mesh_exporter.py`
- Why fragile: `stored_scans` is memory-only while GLBs are written to local output storage. Result lookup requires both the in-memory entry and the file, so lifecycle, cleanup, and horizontal scaling are undefined.
- Safe modification: Persist scan metadata, artifact path, and lifecycle state in the system database/object store; load by scan ID rather than retaining an unbounded process dictionary.
- Test coverage: `ai-service/tests/test_api.py` tests one single-process happy path only.

## Scaling Limits

**Single-host local storage and local database assumptions:**
- Current capacity: Node writes scan images and body models under `xampp/storage`; the Python service writes GLBs under `ai-service/output`; MariaDB defaults to a local host and a 10-connection pool.
- Limit: Multiple Node/Python replicas cannot reliably share files, in-memory queues, or the Python result index; local disks and uploads have no retention/lifecycle enforcement.
- Scaling path: Move private assets to shared object storage, persist job/result state centrally, use a durable queue, and introduce retention/deletion jobs compatible with privacy requirements.

**Processing concurrency is effectively one Node scan per process:**
- Current capacity: `server/index.mjs` processes Node scan jobs through one serialized `processingQueue`.
- Limit: Queue latency grows linearly with slow providers and model downloads; restart recovery is limited to scanning pending database status without durable job attempts.
- Scaling path: Use a queue service with explicit concurrency, backoff, dead-letter handling, idempotency keys, and metrics for queue age and provider latency.

## Dependencies at Risk

**Floating frontend dependency versions:**
- Risk: Several runtime and development dependencies use the `latest` tag rather than a fixed version range.
- Impact: A fresh install can receive an unreviewed React, Vite, Supabase, TypeScript, or testing-tool release and fail builds or change behavior.
- Migration plan: Pin tested semver ranges in `package.json`, retain `package-lock.json`, and use automated dependency updates with CI validation.
- Files: `package.json`, `package-lock.json`

**Deprecated FastAPI TestClient dependency path:**
- Risk: The Python test run emits a Starlette deprecation warning for the installed `httpx`/`TestClient` combination.
- Impact: A future dependency update can break API tests or require migration under time pressure.
- Migration plan: Update the testing stack to the supported `httpx` integration and resolve the warning before relying on future FastAPI/Starlette upgrades.
- Files: `ai-service/tests/test_api.py`, `ai-service/requirements-dev.txt`, `ai-service/pyproject.toml`

## Missing Critical Features

**Durable scan-processing and artifact lifecycle management:**
- Problem: There is no shared job store, completion history, retry policy with attempt records, artifact retention schedule, or garbage collector for orphaned scan objects/models across `server/`, `ai-service/`, and Supabase storage.
- Blocks: Reliable restarts, horizontal scaling, auditability of personalized-model generation, and predictable data-deletion compliance.

**Production CI and deploy gates:**
- Problem: No repository CI pipeline or browser/mobile end-to-end suite is detected; `package.json` only provides local Vitest/typecheck scripts, and Python tests are run manually.
- Blocks: Consistent verification of the three backend modes, Supabase migrations/RLS policies, Capacitor builds, and security regressions before deployment.

## Test Coverage Gaps

**Backend authorization, persistence, and HTTP behavior:**
- What's not tested: Node session cookie handling, role boundaries, CORS/CSRF behavior, uploads, asset authorization, orders, invitation lifecycle endpoints, Socket.IO authorization, MariaDB schema initialization, and XAMPP/PHP endpoint behavior.
- Files: `server/index.mjs`, `server/database.mjs`, `xampp/api/index.php`, `tests/aiService.test.mjs`
- Risk: Backend modes can diverge or permit unintended actions without a failing test.
- Priority: High

**Supabase RLS, migrations, Edge Functions, and storage policies:**
- What's not tested: SQL migration application, RLS for every role, storage-path validation, signed URL access, invitation Edge Functions, processing transitions, and failure cleanup.
- Files: `supabase/migrations/20260829000000_sukatai_schema.sql`, `supabase/migrations/20260901000000_harden_scan_processing_and_storage.sql`, `supabase/functions/process-scan/index.ts`, `supabase/functions/invite-dressmaker/index.ts`
- Risk: The production persistence/security path can regress despite the frontend helper suite passing.
- Priority: High

**User journeys and mobile behavior:**
- What's not tested: Camera permissions/capture, upload retry/remove behavior, role dashboards, measurement review, invitation acceptance UI, native Android/iOS navigation, and accessibility of the large screen implementations.
- Files: `src/App.tsx`, `src/lib/storage.ts`, `android/app/src/main/java/com/sukatai/app/MainActivity.java`, `ios/App/App/AppDelegate.swift`
- Risk: Primary customer and staff workflows can break in a build that passes the 19 pure Vitest assertions.
- Priority: High

**AI reconstruction robustness and measurement validity:**
- What's not tested: Corrupt/decompression-bomb images, concurrent processing, service restart recovery, model-download failures, fallback segmentation behavior, body/pose diversity, accuracy/error bounds, and provider response integration.
- Files: `ai-service/app/main.py`, `ai-service/app/pipeline.py`, `ai-service/app/reconstruction/silhouette.py`, `ai-service/tests/test_api.py`
- Risk: The service can produce unavailable, inconsistent, or inaccurate outputs without operational detection.
- Priority: High

---

*Concerns audit: 2026-09-01*
