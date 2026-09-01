<!-- GSD:project-start source:PROJECT.md -->

## Project

**SukatAI**

SukatAI is an existing role-based body-measurement application for customers, tailors/dressmakers, and administrators. A customer provides front and side body views plus a real height reference. The system validates the views, produces calibrated body measurements and an interactive 3D body model, and makes the results available for tailor review and downstream order workflows.

This is a brownfield completion and migration effort. The repository already contains the React/Vite application, local Node/MariaDB and XAMPP adapters, Supabase Auth/Postgres/Storage/Edge Functions, a CPU-first Python reconstruction service, and a Three.js model viewer. The work must improve the active scanner without rebuilding the product or discarding working features.

**Core Value:** Customers and tailors receive a useful, clearly qualified set of body measurements from a small number of private photos, with a 3D model whose visual guides correspond to the measurements actually produced by the provider.

### Constraints

- Preserve existing UI/UX, routes, authentication, Supabase configuration, database data, storage privacy, role boundaries, dashboards, orders, invitations, uploads, and working APIs.
- Use migrations for schema changes; never reset Supabase or recreate the entire database.
- Keep Node/MariaDB and XAMPP compatibility while maintaining the hosted Supabase path.
- Optimize for the Lenovo ThinkPad L380 (Intel i5-8250U, 16 GB RAM, integrated graphics) on Windows 11 Pro. CPU-first operation is required; CUDA and large reconstruction models must not be required.
- Use at most four active specialist agents. Agents must have disjoint ownership and must not rewrite unrelated code.
- Keep body images and generated models private and authorized through the existing storage boundaries.
- Do not publish a customer-facing accuracy percentage without independent, consented tape-measurement ground truth. Provider quality and fitting error are not accuracy.

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Languages

- TypeScript (ES2022 target) - React browser application in `src/`, Supabase Edge Functions in `supabase/functions/`, and Vite configuration in `vite.config.ts`.
- JavaScript (ES modules) - Node.js API, MariaDB access, notifications, backups, and AI-service adapter in `server/*.mjs`.
- Python (3.11 target; 3.12 container image) - FastAPI body-scan/reconstruction service in `ai-service/app/`.
- SQL (PostgreSQL/Supabase and MySQL/MariaDB dialects) - hosted schema/migrations in `supabase/migrations/` and local/XAMPP schema in `xampp/database/sukatai.sql`.
- PHP - optional Apache/XAMPP API fallback in `xampp/api/index.php`.
- CSS - application styling in `src/styles.css`.

## Runtime

- Node.js - local installation reports `v24.20.0`; `package.json` does not declare an `engines` constraint.
- Python - `ai-service/pyproject.toml` targets Python 3.11; `ai-service/Dockerfile` packages the service on `python:3.12-slim`.
- PHP/Apache/MySQL - optional XAMPP runtime described in `xampp/README.md`.
- npm 11.19.0 - scripts and dependencies declared in `package.json`.
- Lockfile: present as `package-lock.json`.
- Python dependencies are pip requirement files: `ai-service/requirements.txt` and `ai-service/requirements-dev.txt`; no Python lockfile is present.

## Frameworks

- React 19.2.8 / React DOM 19.2.8 - single-page UI bootstrapped by `src/main.tsx` and implemented largely in `src/App.tsx`.
- Vite 8.2.2 with `@vitejs/plugin-react` 6.1.1 - browser build and local development configured in `vite.config.ts`.
- Express 5.2.1 - optional Node API/server in `server/index.mjs`.
- FastAPI `>=0.115,<1` with Uvicorn `>=0.34,<1` - isolated body-scan HTTP API in `ai-service/app/main.py`.
- Supabase Edge Functions (Deno) - hosted processing and invitation endpoints in `supabase/functions/`.
- Capacitor 8.5.0 - Android/iOS shell configuration in `capacitor.config.ts`; native projects are `android/` and `ios/`.
- Vitest 4.1.11 - frontend/unit test command in `package.json`; tests live in `tests/`.
- pytest `>=8.3,<9` with HTTPX `>=0.28,<1` - AI-service tests in `ai-service/tests/`.
- TypeScript 7.0.2 - strict no-emit type checking set by `tsconfig.json` and invoked by `package.json` scripts.
- Docker - AI service image definition in `ai-service/Dockerfile`.
- Capacitor CLI 8.5.0 - mobile syncing, APK build, run, and open scripts in `package.json`.

## Key Dependencies

- `@supabase/supabase-js` 2.112.4 - hosted authentication, Postgres data access, private storage, and Edge Function invocation from `src/lib/supabase.ts`, `src/lib/auth.ts`, `src/lib/data.ts`, and `src/lib/storage.ts`.
- `three` 0.185.1 - browser WebGL measurement/body-model rendering, dynamically loaded by `src/App.tsx`.
- `express` 5.2.1 and `mariadb` 3.5.3 - local Node API and relational persistence in `server/index.mjs` and `server/database.mjs`.
- `socket.io` / `socket.io-client` 4.8.3 - authenticated live scan status updates between `server/index.mjs` and `src/lib/nodeApi.ts`.
- `fastapi`, `numpy`, `Pillow`, `opencv-python-headless`, `trimesh`, and `rembg[cpu]` - image validation, segmentation, reconstruction, measurements, and GLB output in `ai-service/app/`.
- `bcryptjs` 3.0.3 - password hashing for the Node/XAMPP-local authentication path in `server/index.mjs`.
- `multer` 2.3.0 - in-memory multipart upload handling in `server/index.mjs`.
- `dotenv` 17.4.2 - loads only Node-specific environment configuration in `server/config.mjs`.
- `python-multipart` `>=0.0.20,<1` and Pydantic `>=2.10,<3` - FastAPI multipart parsing and API models in `ai-service/app/main.py` and `ai-service/app/schemas/api.py`.

## Configuration

- Browser builds select a backend through `VITE_BACKEND_MODE`, public app origin through `VITE_PUBLIC_APP_URL`, and browser-safe Supabase URL/anon-key variables in `src/lib/supabase.ts`; `vite.config.ts` injects the latter two into the build.
- Node mode reads `.env.node` and `.env.node.local` only in `server/config.mjs`; the files are present in the repository workspace and contain environment configuration.
- The AI service reads deployment variables through `ai-service/app/core/config.py`; only variable names and defaults are documented in source, not secret values.
- Supabase Edge Functions use runtime secrets and configuration accessed through `Deno.env` in `supabase/functions/process-scan/index.ts` and `supabase/functions/_shared/auth.ts`.
- Vite modes emit hosted Supabase output to `dist/`, Node output to `dist-node/`, mobile output to `dist-mobile/`, and XAMPP-compatible relative assets via `vite.config.ts`.
- Vercel builds `npm run build:supabase` and serves `dist/` according to `vercel.json`.
- Type checking includes `src/`, `tests/`, and `vite.config.ts`, excludes Edge Functions, and uses strict compiler options in `tsconfig.json`.
- The AI service Docker image exposes port 8000 and starts Uvicorn from `ai-service/Dockerfile`.

## Platform Requirements

- Node.js/npm for the React/Vite app and optional Node API (`package.json`).
- MariaDB/MySQL for the Node and XAMPP local persistence modes (`server/database.mjs`, `xampp/database/sukatai.sql`).
- Python 3.11+ and pip for `ai-service/`; optional CUDA/MPS/Torch and licensed PIXIE, SMPL-X, and SMPL-Anthropometry assets are detected by `ai-service/app/core/config.py` and documented in `ai-service/MODEL_SETUP.md`.
- Android SDK/Gradle or Xcode is required only when using the Capacitor commands in `package.json`.
- Default hosted frontend target: Vercel (`vercel.json`) with Supabase services and Edge Functions (`supabase/`).
- Alternative self-hosted target: Node API bound locally on port 3001 with MariaDB and local private storage (`server/index.mjs`, `server/config.mjs`).
- Optional containerized reconstruction service: FastAPI/Uvicorn on port 8000 (`ai-service/Dockerfile`).

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Naming Patterns

- Use lower camel case for TypeScript feature/helper modules, such as `src/lib/measurementMapping.ts`, `src/lib/invitationLifecycle.ts`, and `src/lib/reconstructionProvider.ts`.
- Use PascalCase only for React component files, currently `src/App.tsx`; use lower case names for entry points such as `src/main.tsx`.
- Use snake_case for Python modules and tests, such as `ai-service/app/validation/image_validator.py` and `ai-service/tests/test_image_validation.py`.
- Use `.mjs` for Node server modules, such as `server/aiService.mjs` and `server/database.mjs`.
- Use lower camel case in TypeScript and JavaScript (`normalizeProviderResponse`, `isRevocableInvitation`, `safeStoragePath`).
- Use snake_case in Python (`validate_views`, `calibrate_vertices`, `_measurement_values`), with a leading underscore for module-private helpers.
- Name boolean predicates with `is`, `has`, `can`, or `allowed` (`isHeightValid`, `hasAnyToken`, `allowedOrigin`).
- Use lower camel case in TypeScript/JavaScript and snake_case in Python.
- Prefer specific names that expose boundary intent: `expectedScanId`, `rawConfidence`, `validation_issues`, and `max_upload_bytes`.
- Use `const` by default in TypeScript/JavaScript; use `let` only for reassignment, as in `src/lib/measurementMapping.ts` and `server/aiService.mjs`.
- Export PascalCase TypeScript types and interfaces from `src/lib/types.ts` or the owning helper module (`InvitationState`, `ModelMeasurementMatchOptions`).
- Prefer string-literal unions for bounded TypeScript values, e.g. `"circumference" | "length" | "width"` in `src/lib/measurementMapping.ts`.
- Use PascalCase Python classes and Pydantic models (`BodyScanPipeline`, `MeasurementValue`), and enum members that mirror serialized API strings in `ai-service/app/schemas/api.py`.

## Code Style

- No Prettier, Biome, or JavaScript formatter configuration is detected. Preserve the surrounding file's existing formatting.
- TypeScript/JavaScript uses two-space indentation, semicolons, double-quoted strings, trailing commas in multiline literals, and a final newline. Follow `src/lib/scanFlow.ts` and `server/aiService.mjs`.
- Python follows four-space indentation, double-quoted strings, type annotations, and a 120-character Ruff line limit configured in `ai-service/pyproject.toml`.
- Keep long TypeScript imports and expressions on one line only when readable; otherwise use the hanging, comma-terminated multiline style in `src/lib/measurementMapping.ts`.
- Run `npm run typecheck` (alias `npm run lint`) for the frontend TypeScript check; `tsconfig.json` enables `strict`, `isolatedModules`, and `forceConsistentCasingInFileNames`.
- No ESLint configuration is detected. Do not assume JSX, import-order, or unused-variable rules beyond TypeScript checking.
- Python config declares Ruff settings in `ai-service/pyproject.toml`; add Python code that is compatible with its `py311` target and 120-character limit.

## Import Organization

- No TypeScript path aliases are configured in `tsconfig.json`; use relative paths from the importing file.
- The Python test suite places `ai-service/` on `sys.path` in `ai-service/tests/conftest.py`; import application code from the `app` package.

## Error Handling

- Validate untrusted data at boundaries and return/throw explicit, user-safe errors. `server/aiService.mjs` rejects invalid provider payloads and paths before using them.
- Return `null` for expected non-matches or invalid optional values in pure mapping helpers, as in `src/lib/measurementMapping.ts`; use thrown `Error` for invalid required provider responses.
- Define domain-specific Python exceptions carrying structured context (`PipelineFailure` in `ai-service/app/pipeline.py`, `ImageValidationError` in `ai-service/app/validation/image_validator.py`). Chain caught exceptions with `raise ... from error`.
- In FastAPI-facing code, translate lower-level failures into stable error codes and HTTP statuses rather than exposing implementation errors.
- In Node routes, propagate expected failures through `ApiError` and centralized response handling in `server/index.mjs`.

## Logging

- Use `console.log` for Node service lifecycle messages and `console.error` for top-level startup failures in `server/index.mjs`.
- Do not log raw scan images, credentials, session tokens, or complete provider payloads. Existing request paths report concise safe messages instead.
- Python application modules do not use a logging framework; preserve the current pattern of structured API errors unless a logging facility is introduced deliberately.

## Comments

- Comment non-obvious domain decisions, invariants, and security boundaries, not routine mechanics. Examples include the adapter compatibility explanation in `src/lib/measurementMapping.ts` and the `auto` backend rationale in `ai-service/app/pipeline.py`.
- Use concise line comments to explain deliberately conservative behavior, such as image-validation warnings in `ai-service/app/validation/image_validator.py`.
- Use short JSDoc for exported functions with non-obvious normalization or selection rules, as in `normalizeModelMeasurementKey` and `measurementGuideKey` in `src/lib/measurementMapping.ts`.
- Python uses class docstrings for public domain services and exceptions (`BodyScanPipeline`, `PipelineFailure`); add them when a class encapsulates a cross-step responsibility.

## Function Design

- Keep pure client-side rules in small exported helpers under `src/lib/`, enabling direct Vitest coverage. Split reusable predicates from orchestration, as `invitationState` and `isRevocableInvitation` do in `src/lib/invitationLifecycle.ts`.
- Server action dispatch and pipeline orchestration are necessarily larger; extract repeated validation, serialization, storage, and error conversion into named helpers before adding another branch to `server/index.mjs` or `ai-service/app/pipeline.py`.
- Accept explicit primitive values and typed records. Use `Pick<T, ...>` when a helper needs only a subset of a domain entity, as in `src/lib/invitationLifecycle.ts`.
- Supply optional behavior through a typed options object with a default (`ModelMeasurementMatchOptions = {}`), not a long positional argument list.
- In Python, accept injectable `Settings` objects and standard `Path` values so code remains testable without process-wide environment mutation.
- Return precise TypeScript annotations for exported functions and Python annotations for public functions.
- Use `undefined` for a missing TypeScript search result (`findModelMeasurement`), `null` for a deliberately unsupported mapping (`measurementGuideKey`), and explicit exceptions for invalid required input.
- Return Pydantic response models from Python pipeline work rather than unvalidated dictionaries; see `ai-service/app/pipeline.py`.

## Module Design

- Prefer named exports for reusable TypeScript/JavaScript functions. `src/lib/invitationLifecycle.ts`, `src/lib/scanFlow.ts`, and `server/aiService.mjs` are the model.
- Keep internal helpers unexported unless tests or another module need the boundary. `normalizeProviderResponse` is exported from `server/aiService.mjs` specifically for direct contract testing.
- Keep Python package boundaries explicit with `__init__.py`; expose API schemas and service objects from their owning modules.
- No TypeScript barrel files are used. Import directly from the owning `src/lib/*.ts` module to keep dependencies explicit.

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## System Overview

```text

```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| React bootstrap | Redirects legacy local invitation callbacks and mounts the SPA. | `src/main.tsx` |
| UI/workspace | Owns authentication screens, role-specific workspaces, scan capture/review, orders, and Three.js viewer. | `src/App.tsx` |
| Browser runtime boundary | Selects Node/XAMPP/Supabase mode and exposes the configured Supabase client. | `src/lib/supabase.ts` |
| Browser data boundary | Provides domain operations and delegates each operation to local API or Supabase. | `src/lib/data.ts` |
| Browser asset boundary | Validates, uploads, deletes, and signs private scan/model assets. | `src/lib/storage.ts` |
| Local Node API | Implements authentication, authorization, CRUD actions, asset serving, processing queue, delivery adapters, and Socket.IO. | `server/index.mjs` |
| Local database access | Creates the MariaDB database/pool, applies `xampp/database/sukatai.sql`, and provides query/transaction helpers. | `server/database.mjs` |
| Hosted backend | Defines schema/RLS and secure Deno Edge Functions for invites and scan processing. | `supabase/migrations/`, `supabase/functions/` |
| AI service | Validates multipart images, reconstructs/calibrates a mesh, derives measurements, and exports GLB. | `ai-service/app/main.py`, `ai-service/app/pipeline.py` |

## Pattern Overview

- Keep browser workflow code runtime-neutral: `src/lib/data.ts`, `src/lib/storage.ts`, and `src/lib/auth.ts` branch only at the persistence/auth boundary using `isLocalApiMode` from `src/lib/supabase.ts`.
- Treat scan images and generated body models as private assets; serve them through signed URLs in Supabase or the authorization-checked `asset` action in `server/index.mjs`.
- Keep privileged invitation and processing operations server-side in `supabase/functions/` or `server/index.mjs`; the browser invokes them through established adapters.
- Preserve the shared domain model in `src/lib/types.ts` across React, local APIs, and Supabase table records.

## Layers

- Purpose: Render the role-aware SPA and coordinate user interactions.
- Location: `src/App.tsx`, `src/main.tsx`, `src/styles.css`.
- Contains: Components, local React state, async loading hook, camera capture, scan navigation, and Three.js visualization.
- Depends on: Domain types and helpers in `src/lib/`.
- Used by: Vite web output and Capacitor mobile projects.
- Purpose: Centralize auth, CRUD, storage, scan-state validation, processing requests, and live updates.
- Location: `src/lib/`.
- Contains: `data.ts`, `auth.ts`, `storage.ts`, `reconstructionProvider.ts`, `nodeApi.ts`, `xampp.ts`, `supabase.ts`, and pure helpers such as `scanFlow.ts`.
- Depends on: Supabase JS or `fetch`/Socket.IO client, selected by `src/lib/supabase.ts`.
- Used by: `src/App.tsx` and tests in `tests/`.
- Purpose: Primary local full-stack runtime with API, session auth, scan queue, external notification delivery, and static SPA hosting.
- Location: `server/index.mjs`.
- Contains: A query-parameter action dispatcher, middleware, role checks, asset authorization, a serialized in-process queue, and Socket.IO rooms.
- Depends on: MariaDB helpers in `server/database.mjs`, configuration in `server/config.mjs`, optional AI client in `server/aiService.mjs`, and built assets in `dist-node/`.
- Used by: `src/lib/nodeApi.ts` and `src/lib/xampp.ts` when Node mode is selected.
- Purpose: Provide Auth, PostgreSQL data/RLS, private object storage, and privileged server-side functions.
- Location: `supabase/migrations/`, `supabase/functions/`.
- Contains: Tables, enum types, triggers, RLS/storage policies, and Deno handlers for invitation lifecycle and processing.
- Depends on: Supabase Auth and service-role client constructed in `supabase/functions/_shared/auth.ts`.
- Used by: Direct Supabase browser calls in `src/lib/` and function invokes from `src/lib/auth.ts`/`src/lib/reconstructionProvider.ts`.
- Purpose: Optional image-to-measurement service for the Node gateway and compatible Supabase processing endpoint.
- Location: `ai-service/app/`.
- Contains: FastAPI endpoints, request/response schemas, image validation, calibrated silhouette reconstruction, optional model adapters, calibration, tailoring measurement calculation, and GLB exporter.
- Depends on: Settings in `ai-service/app/core/config.py` and image/model libraries.
- Used by: `server/aiService.mjs` and the multipart request path in `supabase/functions/process-scan/index.ts`.

## Data Flow

### Primary Scan Request Path

### Invitation Path

- Persist authoritative business state in the active backend; React state only represents current page/workflow state in `src/App.tsx`.
- Model scan lifecycle as the `ScanStatus` union in `src/lib/types.ts` and enforce state/role transitions in server-side logic and Supabase triggers/policies.
- Node owns module-level process state only for the live Socket.IO server and in-process processing queue in `server/index.mjs`; the AI service separately keeps completed results in the in-memory `stored_scans` dictionary in `ai-service/app/main.py`.

## Key Abstractions

- Purpose: Allow one React codebase to run against Node, XAMPP, or Supabase.
- Examples: `src/lib/supabase.ts`, `src/lib/nodeApi.ts`, `src/lib/xampp.ts`.
- Pattern: Determine mode once from Vite build environment, then route local requests through `xamppRequest` (which delegates to Node when appropriate) or use `requireSupabase()`.
- Purpose: Aggregate a scan with its images, measurements, and optional body model for review.
- Examples: `src/lib/types.ts`, `src/lib/data.ts`.
- Pattern: Fetch independently persisted artifacts and return the `ScanBundle` interface to presentation code.
- Purpose: Isolate an optional reconstruction provider from persistent scan workflow.
- Examples: `server/aiService.mjs`, `supabase/functions/process-scan/index.ts`, `ai-service/app/pipeline.py`.
- Pattern: Validate provider output before persisting any measurements or model reference; retain a clearly labelled local deterministic fallback for local development.

## Entry Points

- Location: `src/main.tsx`.
- Triggers: Vite serves `index.html`, then React mounts into `#root`.
- Responsibilities: Redirect legacy local auth callbacks and render `App` under `StrictMode`.
- Location: `server/index.mjs`.
- Triggers: `npm run start:node`.
- Responsibilities: Initialize database, resume pending scans, start Express/Socket.IO, serve API/assets/dist output, and safely stop on process signals.
- Location: `supabase/functions/*/index.ts`.
- Triggers: Browser function invokes.
- Responsibilities: Authenticate bearer requests and perform privileged invitation or processing operations.
- Location: `ai-service/app/main.py`.
- Triggers: Uvicorn target `app.main:app`.
- Responsibilities: Serve health/status routes and authenticated multipart body-scan requests.

## Architectural Constraints

- **Threading:** React runs in the browser event loop; Node uses an event loop with a serialized Promise processing queue in `server/index.mjs`; FastAPI uses async request handlers while CPU image work runs inside its process.
- **Global state:** `server/index.mjs` holds `io`, `processingJobs`, and `processingQueue`; `ai-service/app/main.py` holds `settings`, `pipeline`, and `stored_scans`. Do not rely on either in-memory store for durable cross-process work.
- **Runtime compatibility:** New browser data operations must support the selected backend mode or explicitly be scoped to a named mode. Keep the typed local and Supabase result shapes aligned with `src/lib/types.ts`.
- **Asset access:** Do not expose raw private storage paths to unauthenticated callers. Use `src/lib/storage.ts`, the server asset handler, or authorized signed URLs.

## Anti-Patterns

### Bypassing the browser adapter boundary

### Treating local reconstruction as personalized production output

## Error Handling

- Browser adapters turn backend failures into `Error` objects using `readableError` in `src/lib/supabase.ts`.
- Node uses `ApiError` plus centralized `sendError` in `server/index.mjs`; production hides unanticipated internal error details.
- Supabase functions use status-specific JSON responses through `supabase/functions/_shared/cors.ts`.
- AI pipeline failures carry stable error codes, HTTP statuses, and validation issues through `PipelineFailure` in `ai-service/app/pipeline.py`.

## Cross-Cutting Concerns

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `$gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `$gsd-debug` for investigation and bug fixing
- `$gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `$gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
