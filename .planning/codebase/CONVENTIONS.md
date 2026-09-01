# Coding Conventions

**Analysis Date:** 2026-09-01

## Naming Patterns

**Files:**
- Use lower camel case for TypeScript feature/helper modules, such as `src/lib/measurementMapping.ts`, `src/lib/invitationLifecycle.ts`, and `src/lib/reconstructionProvider.ts`.
- Use PascalCase only for React component files, currently `src/App.tsx`; use lower case names for entry points such as `src/main.tsx`.
- Use snake_case for Python modules and tests, such as `ai-service/app/validation/image_validator.py` and `ai-service/tests/test_image_validation.py`.
- Use `.mjs` for Node server modules, such as `server/aiService.mjs` and `server/database.mjs`.

**Functions:**
- Use lower camel case in TypeScript and JavaScript (`normalizeProviderResponse`, `isRevocableInvitation`, `safeStoragePath`).
- Use snake_case in Python (`validate_views`, `calibrate_vertices`, `_measurement_values`), with a leading underscore for module-private helpers.
- Name boolean predicates with `is`, `has`, `can`, or `allowed` (`isHeightValid`, `hasAnyToken`, `allowedOrigin`).

**Variables:**
- Use lower camel case in TypeScript/JavaScript and snake_case in Python.
- Prefer specific names that expose boundary intent: `expectedScanId`, `rawConfidence`, `validation_issues`, and `max_upload_bytes`.
- Use `const` by default in TypeScript/JavaScript; use `let` only for reassignment, as in `src/lib/measurementMapping.ts` and `server/aiService.mjs`.

**Types:**
- Export PascalCase TypeScript types and interfaces from `src/lib/types.ts` or the owning helper module (`InvitationState`, `ModelMeasurementMatchOptions`).
- Prefer string-literal unions for bounded TypeScript values, e.g. `"circumference" | "length" | "width"` in `src/lib/measurementMapping.ts`.
- Use PascalCase Python classes and Pydantic models (`BodyScanPipeline`, `MeasurementValue`), and enum members that mirror serialized API strings in `ai-service/app/schemas/api.py`.

## Code Style

**Formatting:**
- No Prettier, Biome, or JavaScript formatter configuration is detected. Preserve the surrounding file's existing formatting.
- TypeScript/JavaScript uses two-space indentation, semicolons, double-quoted strings, trailing commas in multiline literals, and a final newline. Follow `src/lib/scanFlow.ts` and `server/aiService.mjs`.
- Python follows four-space indentation, double-quoted strings, type annotations, and a 120-character Ruff line limit configured in `ai-service/pyproject.toml`.
- Keep long TypeScript imports and expressions on one line only when readable; otherwise use the hanging, comma-terminated multiline style in `src/lib/measurementMapping.ts`.

**Linting:**
- Run `npm run typecheck` (alias `npm run lint`) for the frontend TypeScript check; `tsconfig.json` enables `strict`, `isolatedModules`, and `forceConsistentCasingInFileNames`.
- No ESLint configuration is detected. Do not assume JSX, import-order, or unused-variable rules beyond TypeScript checking.
- Python config declares Ruff settings in `ai-service/pyproject.toml`; add Python code that is compatible with its `py311` target and 120-character limit.

## Import Organization

**Order:**
1. Platform/runtime imports (`node:fs/promises`, `path`, `dataclasses`, `typing`)
2. Third-party imports (`vitest`, `numpy`, `fastapi`, `PIL`)
3. Application modules (`./config.mjs`, `app.schemas.api`, `../src/lib/...`)
4. Type-only imports in TypeScript, using `import type`, normally adjacent to related local imports

Leave a blank line between groups, as shown in `server/aiService.mjs`, `vite.config.ts`, and `ai-service/app/pipeline.py`.

**Path Aliases:**
- No TypeScript path aliases are configured in `tsconfig.json`; use relative paths from the importing file.
- The Python test suite places `ai-service/` on `sys.path` in `ai-service/tests/conftest.py`; import application code from the `app` package.

## Error Handling

**Patterns:**
- Validate untrusted data at boundaries and return/throw explicit, user-safe errors. `server/aiService.mjs` rejects invalid provider payloads and paths before using them.
- Return `null` for expected non-matches or invalid optional values in pure mapping helpers, as in `src/lib/measurementMapping.ts`; use thrown `Error` for invalid required provider responses.
- Define domain-specific Python exceptions carrying structured context (`PipelineFailure` in `ai-service/app/pipeline.py`, `ImageValidationError` in `ai-service/app/validation/image_validator.py`). Chain caught exceptions with `raise ... from error`.
- In FastAPI-facing code, translate lower-level failures into stable error codes and HTTP statuses rather than exposing implementation errors.
- In Node routes, propagate expected failures through `ApiError` and centralized response handling in `server/index.mjs`.

## Logging

**Framework:** console

**Patterns:**
- Use `console.log` for Node service lifecycle messages and `console.error` for top-level startup failures in `server/index.mjs`.
- Do not log raw scan images, credentials, session tokens, or complete provider payloads. Existing request paths report concise safe messages instead.
- Python application modules do not use a logging framework; preserve the current pattern of structured API errors unless a logging facility is introduced deliberately.

## Comments

**When to Comment:**
- Comment non-obvious domain decisions, invariants, and security boundaries, not routine mechanics. Examples include the adapter compatibility explanation in `src/lib/measurementMapping.ts` and the `auto` backend rationale in `ai-service/app/pipeline.py`.
- Use concise line comments to explain deliberately conservative behavior, such as image-validation warnings in `ai-service/app/validation/image_validator.py`.

**JSDoc/TSDoc:**
- Use short JSDoc for exported functions with non-obvious normalization or selection rules, as in `normalizeModelMeasurementKey` and `measurementGuideKey` in `src/lib/measurementMapping.ts`.
- Python uses class docstrings for public domain services and exceptions (`BodyScanPipeline`, `PipelineFailure`); add them when a class encapsulates a cross-step responsibility.

## Function Design

**Size:**
- Keep pure client-side rules in small exported helpers under `src/lib/`, enabling direct Vitest coverage. Split reusable predicates from orchestration, as `invitationState` and `isRevocableInvitation` do in `src/lib/invitationLifecycle.ts`.
- Server action dispatch and pipeline orchestration are necessarily larger; extract repeated validation, serialization, storage, and error conversion into named helpers before adding another branch to `server/index.mjs` or `ai-service/app/pipeline.py`.

**Parameters:**
- Accept explicit primitive values and typed records. Use `Pick<T, ...>` when a helper needs only a subset of a domain entity, as in `src/lib/invitationLifecycle.ts`.
- Supply optional behavior through a typed options object with a default (`ModelMeasurementMatchOptions = {}`), not a long positional argument list.
- In Python, accept injectable `Settings` objects and standard `Path` values so code remains testable without process-wide environment mutation.

**Return Values:**
- Return precise TypeScript annotations for exported functions and Python annotations for public functions.
- Use `undefined` for a missing TypeScript search result (`findModelMeasurement`), `null` for a deliberately unsupported mapping (`measurementGuideKey`), and explicit exceptions for invalid required input.
- Return Pydantic response models from Python pipeline work rather than unvalidated dictionaries; see `ai-service/app/pipeline.py`.

## Module Design

**Exports:**
- Prefer named exports for reusable TypeScript/JavaScript functions. `src/lib/invitationLifecycle.ts`, `src/lib/scanFlow.ts`, and `server/aiService.mjs` are the model.
- Keep internal helpers unexported unless tests or another module need the boundary. `normalizeProviderResponse` is exported from `server/aiService.mjs` specifically for direct contract testing.
- Keep Python package boundaries explicit with `__init__.py`; expose API schemas and service objects from their owning modules.

**Barrel Files:**
- No TypeScript barrel files are used. Import directly from the owning `src/lib/*.ts` module to keep dependencies explicit.

---

*Convention analysis: 2026-09-01*
