# Codebase Concerns

**Analysis Date:** 2026-09-25

## Tech Debt

**Monolithic frontend component (`src/App.tsx`):**
- Issue: The entire React app lives in a single 3,294-line file — auth screens, profile, scan flow, order/dressmaker views, and many inline sub-components (`Field`, reset/OTP forms) are all co-located.
- Files: `src/App.tsx`
- Impact: Hard to navigate, review, and test in isolation; merge-conflict prone; no component-level reuse boundaries.
- Fix approach: Split into `src/features/{auth,scan,orders,profile}/` and `src/components/` modules; extract shared inputs (`Field`, verification-code input) into reusable components.

**Monolithic Node API (`server/index.mjs`):**
- Issue: A single 1,939-line / 102 KB file implements the entire action-dispatch API (auth, sessions, scans, orders, fittings, admin, assets) plus the rate limiter and route table.
- Files: `server/index.mjs` (action sets defined at lines ~72, ~116)
- Impact: Difficult to reason about authorization per action; high blast radius for any change; no per-domain module boundaries.
- Fix approach: Extract handlers into `server/handlers/*.mjs` grouped by domain, keep `index.mjs` as thin dispatcher.

**Dual backend duplication (Node + PHP):**
- Issue: The same API surface is implemented twice — `server/index.mjs` and `xampp/api/index.php` (see duplicated fittings query at `server/index.mjs:1516` vs `xampp/api/index.php:1221`).
- Files: `server/index.mjs`, `xampp/api/index.php`
- Impact: Every feature/bugfix must be applied in two languages; high risk of behavioral drift between runtimes.
- Fix approach: Treat one runtime as canonical and generate/mirror the other, or consolidate on a single deployment target; add cross-runtime contract tests (partially covered by `tests/adapters.contract.test.ts`).

**Large silhouette module (`ai-service/app/reconstruction/silhouette.py`):**
- Issue: 728-line module carrying image segmentation, profile extraction, and geometric heuristics together.
- Files: `ai-service/app/reconstruction/silhouette.py`, `ai-service/app/pipeline.py` (567 lines)
- Impact: Hard to unit-test individual heuristics; changes to one stage risk others.
- Fix approach: Separate segmentation, profile geometry, and measurement extraction into distinct modules.

## Known Bugs

None confirmed by static inspection. Behavior is guarded by an extensive test suite (see Test Coverage Gaps). Runtime bugs were not reproduced during this analysis.

## Security Considerations

**Tracked mobile env file:**
- Risk: `.env.mobile` is intentionally un-ignored (`!.env.mobile` in `.gitignore`) and committed. If it ever gains a real endpoint/secret it would be exposed in git history.
- Files: `.gitignore`, `.env.mobile`
- Current mitigation: Real secret env files (`.env`, `.env.local`, `.env.node.local`, `.env.xampp.local`) are correctly gitignored; only `.env.example`, `ai-service/.env.example`, and `.env.mobile` are tracked.
- Recommendations: Confirm `.env.mobile` contains only non-secret public config; add a CI check that fails if tracked env files contain secret-like keys.

**In-memory authentication rate limiter:**
- Risk: `authRateLimit` uses a process-local `Map` (`server/index.mjs:47-70`). It resets on restart and is not shared across processes/instances, so horizontal scaling or a restart loop defeats brute-force protection.
- Files: `server/index.mjs:41-116`
- Current mitigation: 10 attempts / 15 min window on `sign_in`, `sign_up`, OTP, and password-reset actions; trusted-proxy handling documented in `server/config.mjs`.
- Recommendations: Back the limiter with a shared store (DB/Redis) for multi-instance deployments; verify `SUKATAI_TRUST_PROXY` is set correctly so limits key on the real client IP, not a rotatable header.

**CORS allowlist must be constrained in production:**
- Risk: Credentialed CORS allowlist configuration warns it must be limited in production (`server/config.mjs:34`); a misconfigured wildcard with credentials would be exploitable.
- Files: `server/config.mjs`
- Current mitigation: Cookie `Secure`/`SameSite` and session-hours config are env-driven (`server/config.mjs:76,109-118`).
- Recommendations: Enforce a non-empty explicit allowlist in production mode; fail startup if credentials are enabled with a wildcard origin.

**No secret leakage in scan attempt logs:**
- Note (positive): `server/scanProcessingAttempt.mjs:16-17` redacts bearer tokens and `api_key/secret/password/token` patterns from stored attempt data. Keep this filter in sync with new fields.

**SQL access uses parameterized queries:**
- Note (positive): PHP uses PDO prepared statements with `ATTR_EMULATE_PREPARES => false` (`xampp/api/index.php:134`); Node builds `IN (...)` clauses with bound placeholders (`server/index.mjs:1516`). No string-interpolated SQL observed.

## Performance Bottlenecks

**CPU-only heuristic reconstruction pipeline:**
- Problem: Segmentation (rembg `u2net_human_seg`) plus per-row silhouette scanning runs on CPU; the pipeline is process-bound and synchronous per scan.
- Files: `ai-service/app/reconstruction/silhouette.py`, `ai-service/app/pipeline.py`
- Cause: No GPU path enabled by default; neural reconstruction assets (PIXIE/SMPL-X) are not installed, so the heuristic path is the production path.
- Improvement path: Confirm resource bounds (there is `ai-service/tests/test_resource_bounds.py`), consider batching/queueing scans and caching the rembg session (already lazy-loaded with a lock at `silhouette.py:18-19`).

## Fragile Areas

**Measurement accuracy depends on hand-tuned anatomical fractions:**
- Files: `ai-service/app/measurements/tailoring.py` (e.g. `head_circumference` factor 0.94 at line 114; `neck_to_pelvis = (0.835 - 0.432) * height_cm` at line 146; foot ratios at lines 153-154), `ai-service/app/measurements/calibration.py`
- Why fragile: Comment at `tailoring.py:116` states fractions are "tuned to match SnapMeasureAI anatomy benchmarks." These are empirical constants, not derived from the reconstructed geometry; small changes shift every downstream measurement, and results are calibrated to a reference target (see memory note on calibration annealing making the 170 cm demo match SnapMeasureAI).
- Safe modification: Change one fraction at a time and re-run `ai-service/tests/test_measurement_normalization.py` and `test_silhouette_pipeline.py`; document the empirical basis of any new constant.
- Test coverage: Covered by calibration/normalization tests, but tests likely lock in the tuned constants rather than validate real-world accuracy.

**Reconstruction backend is heuristic, not the advertised neural model:**
- Files: `ai-service/app/reconstruction/pixie_adapter.py`, `smplx_adapter.py`, `silhouette.py` (`source = "heuristic"` at line 36)
- Why fragile: `PixieAdapter.reconstruct` raises `ModelAssetError`/`ReconstructionError` unless checkpoints AND a configured runner exist (lines 36-42); `SmplxAdapter.mesh_from_parameters` requires `torch`+`smplx` and model assets (lines 24-30). With assets absent, the system falls back to the 2D silhouette heuristic. Accuracy claims implicitly depend on assets that are not committed (`ai-service/models/*` is gitignored).
- Safe modification: Keep the adapter boundary intact; do not remove the `readiness()` guards. Document clearly which backend is active per deployment.
- Test coverage: Adapter contract behavior is tested (`tests/adapters.contract.test.ts`), but end-to-end neural accuracy cannot be tested without assets.

**Gender macro semantics are inverted vs. upstream:**
- Files: `ai-service/app/fitting/anny_fitter.py`, `ai-service/app/reconstruction/mesh_morpher.py`
- Why fragile: Per memory note, Anny's gender macro is reversed (`gender=0.0` is MALE, `1.0` is FEMALE — opposite of MakeHuman). Any refactor that "corrects" this to match MakeHuman conventions will silently swap results.
- Safe modification: Preserve and comment the inversion explicitly at the mapping site; add a regression test asserting male/female mesh outputs.

## Scaling Limits

**Single-process Node server state:**
- Current capacity: Rate-limit buckets and any in-memory state live in one process (`server/index.mjs`).
- Limit: Breaks correctness under multiple instances / load balancing.
- Scaling path: Externalize rate limiting and ensure sessions (already DB-backed via `sessions` table, `server/database.mjs:176`) remain the only shared state.

**Local filesystem scan storage:**
- Current capacity: Scan captures and body models are stored under `xampp/storage/` on local disk (gitignored except `.htaccess`).
- Limit: Not shareable across hosts; grows unbounded with scans.
- Scaling path: Move to object storage (S3-compatible) with lifecycle/retention policy.

## Dependencies at Risk

**Floating `latest` versions in `package.json`:**
- Risk: `react`, `react-dom`, `@vitejs/plugin-react`, `typescript`, `vite`, `vitest`, `@types/react`, `@types/react-dom` are pinned to `"latest"` (`package.json:27,34-35,42-46`).
- Impact: Non-reproducible installs; a breaking upstream release can break builds without a code change. Contradicts the project convention of pinned dependency versions.
- Migration plan: Pin to exact versions matching `package-lock.json`; rely on the lockfile and Dependabot/renovate for controlled upgrades.

**Uninstalled neural model dependencies (PIXIE / SMPL-X / torch):**
- Risk: The neural reconstruction path depends on packages and licensed checkpoints that are not vendored (`ai-service/models/*` gitignored; `smplx`/`torch` imported lazily).
- Impact: Neural backend is unavailable out-of-the-box; deployments silently run the heuristic path.
- Migration plan: Document required assets in `ai-service/MODEL_SETUP.md` (referenced by adapters) and add a startup readiness check that surfaces which backend is active.

## Missing Critical Features

**Active reconstruction backend not surfaced to users/operators:**
- Problem: There is no obvious runtime signal distinguishing "neural reconstruction" from "heuristic fallback"; measurements are labeled `calibrated`/`heuristic` internally but the distinction may not reach the UI.
- Blocks: Operators can't tell whether accuracy claims hold for a given deployment; users may over-trust heuristic results.

## Test Coverage Gaps

**Frontend UI has no component/interaction tests:**
- What's not tested: `src/App.tsx` (3,294 lines) — auth flows, OTP, scan UI, order/dressmaker interactions. Vitest suite covers only `src/lib/*` logic (`tests/*.test.ts`).
- Files: `src/App.tsx`
- Risk: UI regressions (form validation, state transitions, sharing flow) ship undetected.
- Priority: High

**PHP backend has no automated tests:**
- What's not tested: `xampp/api/index.php` (~1,200+ lines) — the entire PHP runtime path lacks a test harness, while the Node path has `tests/` and Python has `ai-service/tests/`.
- Files: `xampp/api/index.php`, `xampp/api/mailer.php`
- Risk: Behavioral drift from the Node backend goes unnoticed; auth/OTP/order logic untested in PHP.
- Priority: High

**No end-to-end accuracy validation for measurements:**
- What's not tested: Real-world measurement accuracy of the heuristic pipeline against ground truth; existing Python tests validate normalization/calibration mechanics, not correctness against measured humans.
- Files: `ai-service/app/measurements/tailoring.py`, `ai-service/app/reconstruction/silhouette.py`
- Risk: Tuned constants can pass tests while diverging from real measurements.
- Priority: Medium

---

*Concerns audit: 2026-09-25*
