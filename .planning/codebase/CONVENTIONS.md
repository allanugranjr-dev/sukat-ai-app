# Coding Conventions

**Analysis Date:** 2026-09-25

SukatAI spans four runtimes with distinct-but-related conventions. Match the runtime you are editing:
- **React/TS SPA** — root `src/`, ESM, TypeScript strict
- **Node/Express gateway** — `server/`, ESM `.mjs`, plain JS
- **Python FastAPI AI service** — `ai-service/app/`, Python 3.12, ruff
- **PHP/XAMPP API** — `xampp/api/`, PHP 8 `declare(strict_types=1)`

## Naming Patterns

**Files:**
- SPA library: camelCase `.ts` — `src/lib/scanFlow.ts`, `src/lib/nodeApi.ts`, `src/lib/orderWorkflow.ts`. React components/entry are `.tsx` (`src/App.tsx`, `src/main.tsx`).
- Node gateway: camelCase `.mjs` — `server/index.mjs`, `server/aiService.mjs`, `server/scanProcessingAttempt.mjs`.
- Python: snake_case modules — `ai-service/app/measurements/calibration.py`, `anthropometry_adapter.py`. Tests `test_*.py`.
- PHP: lowercase — `xampp/api/index.php`, `config.php`, `mailer.php`.
- TS/MJS tests: `<name>.test.ts` / `<name>.test.mjs` under `tests/`.

**Functions:**
- TS/JS: `camelCase`, verb-led and intention-revealing — `customerScanJourney`, `validateUpload`, `normalizeProviderResponse`, `resolveNodeApiUrl`, `rateLimitHit`.
- Python: `snake_case`, module-private helpers prefixed `_` — `_authorized`, `_error_response`, `_validate_scan_id`, `calibrate_vertices`, `mesh_height`.
- PHP: `camelCase` — `jsonResponse()`.

**Variables:**
- TS/JS: `camelCase`; module constants `camelCase` too (`scanSteps`, `authRateLimit`, `sessionCookieName`). Numeric separators used for readability — `15 * 60 * 1000`, `60_000`, `15_000`.
- Python: `snake_case`; module-level singletons lowercase (`settings`, `pipeline`, `stored_scans`).

**Types:**
- TS: `PascalCase` type aliases and unions, exported alongside code — `CustomerScanJourney`, `ScanStep`, `NodeRequestOptions`, `NodeScanStatusEvent`. String-literal unions preferred over enums (`"success" | "warning" | "danger"`).
- Python: `PascalCase` classes / dataclasses / Pydantic models — `CalibrationResult`, `CalibrationError`, `BodyScanResponse`, `Settings`. `@dataclass(frozen=True)` for value objects.
- PHP: `PascalCase` classes — `SukatApiException`.

## Code Style

**Formatting:**
- No Prettier/ESLint config present. TS/JS style: 2-space indent, double quotes, semicolons, trailing commas in multiline literals.
- Python: `ruff` configured in `ai-service/pyproject.toml` — `line-length = 120`, `target-version = "py312"`.
- PHP: 4-space indent, `declare(strict_types=1)` at top of every entry file.

**Linting / type checking:**
- `npm run lint` and `npm run typecheck` both run `tsc --noEmit` (no separate linter). `tsconfig.json` is `strict: true`, `forceConsistentCasingInFileNames`, `isolatedModules`, `moduleResolution: "Bundler"`, JSX `react-jsx`, `types: ["vitest/globals"]`.
- Python: `ruff` (invoke `ruff check ai-service`). No mypy config detected.

## Import Organization

**TS/MJS order** (blank-line separated groups):
1. Third-party / node builtins (`node:fs/promises`, `express`, `socket.io`, `bcryptjs`)
2. Local modules (`./config.mjs`, `./database.mjs`, `../src/lib/...`)

Example from `server/index.mjs`: node builtins first, then npm packages, then local `.mjs`.

**Python order** (`from __future__ import annotations` always first):
1. `from __future__ import annotations`
2. stdlib (`asyncio`, `pathlib`, `uuid`)
3. third-party (`fastapi`, `numpy`)
4. local `app.*`

**Path Aliases:**
- None. SPA uses relative imports; Python uses absolute `app.*` (pythonpath `.` set in `pyproject.toml` and `conftest.py`).

## Error Handling

**TS SPA:** Throw `Error` with user-facing, honest messages; catch at boundary. `nodeRequest` distinguishes abort/timeout (`"...did not respond in time..."`) from API errors, uses `AbortController` + `finally` cleanup (`src/lib/nodeApi.ts`).

**Node gateway:** Custom `class ApiError extends Error` carrying a `status` (default 400) — `server/index.mjs:25`. Sanitize errors before returning to clients (`safeProcessingErrorMessage`).

**Python:** Domain-specific exception subclasses — `CalibrationError(ValueError)`, `PipelineFailure`. Validate inputs early and raise with precise messages (`calibrate_vertices` rejects non-finite / out-of-range heights). API layer converts failures to structured `ErrorResponse` via `_error_response` → `JSONResponse` with proper status code.

**PHP:** `class SukatApiException extends RuntimeException` with a `$status` field; `jsonResponse()` / error path emit `{ ok, data }` / `{ ok, message }` JSON envelopes.

## Response Envelope Convention

All backends return a consistent envelope so the SPA can treat them interchangeably:
- Node & PHP: `{ ok: boolean, data?, message? }` (`payload?.ok` checked in `nodeRequest`).
- Python AI service: typed Pydantic response models (`BodyScanResponse`, `ErrorResponse`).

## Logging

- No shared logging framework. Node/PHP keep responses quiet and avoid leaking internals to clients. Python relies on FastAPI/uvicorn logging plus explicit failure objects.

## Comments

**When to Comment:** Explain *why* / security reasoning, not *what*. Strong examples in `server/index.mjs` (rate-limiter rationale, `X-Forwarded-For` trust model) and `ai-service/app/main.py` (`_with_model_url` explains same-origin relative paths).

**JSDoc/Docstrings:** Sparse. TS uses `/** ... */` on exported behavior functions (`customerScanJourney` in `src/lib/scanFlow.ts`). Python uses inline comments over formal docstrings.

## Function Design

- Small, pure, single-purpose functions favored (`isHeightValid`, `previousScanPosition`, `mesh_height`).
- Options passed as a single typed object in TS (`NodeRequestOptions`) rather than long positional lists.
- Python uses keyword/`Annotated` FastAPI dependency injection (`Depends`, `Header()`), frozen dataclasses for results.
- Validate-and-narrow at boundaries; return normalized shapes.

## Module Design

**Exports:** Named exports throughout (no default exports in `src/lib` or `server/`). Types exported next to the functions that use them.

**Barrel Files:** Not used in SPA/Node. Python packages use `__init__.py` per directory (`app/measurements/__init__.py`, etc.) but as package markers, not re-export barrels.

---

*Convention analysis: 2026-09-25*
