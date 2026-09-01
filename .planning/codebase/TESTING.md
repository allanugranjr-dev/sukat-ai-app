# Testing Patterns

**Analysis Date:** 2026-09-01

## Test Framework

**Runner:**
- Vitest `4.1.11` is used for root JavaScript/TypeScript tests. No dedicated Vitest config file is present; Vite defaults provide the test configuration.
- pytest `8.4.2` is used for the Python AI service. Configuration is in `ai-service/pyproject.toml` with `testpaths = ["tests"]` and `addopts = "-ra"`.

**Assertion Library:**
- Use Vitest's `expect` assertions imported from `vitest` in `tests/*.test.ts` and `tests/aiService.test.mjs`.
- Use plain `assert`, `pytest.raises`, and `pytest.approx` in `ai-service/tests/*.py`.

**Run Commands:**
```bash
npm test                                      # Run the four Vitest files at repository root
npx vitest --watch                            # Watch Vitest tests (no package script is defined)
npm run typecheck                             # Strict TypeScript validation for src/, tests/, and vite.config.ts
cd ai-service && .\\.venv\\Scripts\\python.exe -m pytest  # Run the pytest suite on Windows
cd ai-service && .\\.venv\\Scripts\\python.exe -m pytest -q # Compact pytest output
```

`npm test` currently passes 4 files / 19 tests. The Python suite contains 7 tests under `ai-service/tests/`; its isolated calibration, image-validation, and silhouette tests pass through the documented pytest command.

## Test File Organization

**Location:**
- Put frontend and Node boundary tests in the repository-level `tests/` directory, separate from production `src/` and `server/` files.
- Put Python service tests in `ai-service/tests/`, separate from application code in `ai-service/app/`.
- Exclude generated dependency tests under `ai-service/.venv/`; they are third-party packages, not project tests.

**Naming:**
- Use `<subject>.test.ts` for TypeScript tests: `tests/scanFlow.test.ts`, `tests/measurementMapping.test.ts`, and `tests/invitationLifecycle.test.ts`.
- Use `<subject>.test.mjs` when testing an ESM Node module: `tests/aiService.test.mjs`.
- Use `test_<subject>.py` and `test_<behavior>` functions for pytest: `ai-service/tests/test_image_validation.py` and `test_validation_requires_front_and_side_and_height`.

**Structure:**
```
tests/
├── aiService.test.mjs                 # Node provider-response boundary
├── invitationLifecycle.test.ts         # Pure invitation-state rules
├── measurementMapping.test.ts          # Pure measurement mapping and conversion rules
└── scanFlow.test.ts                    # Pure scan-flow guardrails

ai-service/tests/
├── conftest.py                         # Adds ai-service root to Python import path
├── helpers.py                          # Reusable in-memory body-image fixture generator
├── test_api.py                         # FastAPI endpoint integration
├── test_calibration.py                 # Mesh-calibration unit tests
├── test_image_validation.py            # Image validation unit tests
└── test_silhouette_pipeline.py         # Pipeline/filesystem integration
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, expect, it } from "vitest";
import { previousScanPosition } from "../src/lib/scanFlow";

describe("scan flow guardrails", () => {
  it("keeps Back inside the current scan journey", () => {
    expect(previousScanPosition("capture", 2)).toEqual({ step: "capture", captureIndex: 1 });
  });
});
```

Use a behavior-focused `describe` title and a complete sentence in each `it` title. The current examples in `tests/scanFlow.test.ts` and `tests/invitationLifecycle.test.ts` cover accepted behavior plus important invalid/edge conditions within the same suite.

**Patterns:**
- Construct minimal data inline when it is short. `tests/invitationLifecycle.test.ts` uses literal invitation records and an explicit fixed timestamp.
- Define a local typed factory when many cases share domain data. `tests/measurementMapping.test.ts` uses `measurement(...)` to produce `Measurement` records.
- Make time deterministic by passing `now` as an argument rather than mocking `Date.now()`.
- Test pure helpers directly through their public exports; do not mount `src/App.tsx` for logic in `src/lib/`.
- In pytest, use individual `test_` functions and explicit local setup. Use `tmp_path` for output files and `monkeypatch` only for module-level runtime dependencies, as in `ai-service/tests/test_api.py`.

## Mocking

**Framework:**
- Vitest's mocking APIs are available but not used by the current root tests.
- pytest's built-in `monkeypatch` fixture is used for FastAPI module globals in `ai-service/tests/test_api.py`.

**Patterns:**
```python
settings = Settings(..., output_dir=tmp_path / "output", api_key=None, allowed_origins=())
monkeypatch.setattr(main_module, "settings", settings)
monkeypatch.setattr(main_module, "pipeline", BodyScanPipeline(settings))
main_module.stored_scans.clear()
```

Use real lightweight domain implementations when possible: `ai-service/tests/test_silhouette_pipeline.py` runs the silhouette pipeline with generated images, while root tests call real deterministic helpers. Restore or isolate any mutable module state when using `monkeypatch`.

**What to Mock:**
- Mock or inject external process/configuration boundaries: environment-derived settings, temporary output locations, remote providers, and process-wide FastAPI state.
- Use a fixed `Settings` instance with CPU/silhouette configuration for Python tests, rather than requiring model assets or a GPU.

**What NOT to Mock:**
- Do not mock pure validation, mapping, unit conversion, or lifecycle functions in `src/lib/`; assert their results directly.
- Do not replace image bytes with opaque mocks when `ai-service/tests/helpers.py` can generate a small valid in-memory PNG.

## Fixtures and Factories

**Test Data:**
```typescript
function measurement(key: string, value: number, unit: "cm" | "in" = "cm", adjusted_value: number | null = null): Measurement {
  return {
    id: key,
    scan_id: "scan-1",
    key,
    value,
    unit,
    confidence: 90,
    ai_value: value,
    adjusted_value,
    adjusted_by: null,
    adjustment_reason: null,
    verified_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}
```

Use the factory pattern from `tests/measurementMapping.test.ts` for typed records with many irrelevant required fields. Override only the values relevant to the assertion.

```python
def make_body_image(width: int = 480, height: int = 960) -> bytes:
    image = Image.new("RGB", (width, height), "white")
    # Draw a simple full-body silhouette, then serialize it as PNG bytes.
    ...
    return buffer.getvalue()
```

Use `make_body_image` from `ai-service/tests/helpers.py` for valid scan uploads, pipeline inputs, and FastAPI multipart files.

**Location:**
- Keep a fixture/factory local to one TypeScript test file unless another test uses it.
- Put reusable Python test helpers in `ai-service/tests/helpers.py`; put suite-wide pytest setup in `ai-service/tests/conftest.py`.

## Coverage

**Requirements:** No coverage threshold, reporter, or coverage command is configured in `package.json` or `ai-service/pyproject.toml`.

**View Coverage:**
```bash
# Not configured. Add a coverage provider and script before relying on coverage reports.
```

## Test Types

**Unit Tests:**
- Vitest unit tests cover pure business logic and contract normalization in `tests/invitationLifecycle.test.ts`, `tests/measurementMapping.test.ts`, `tests/scanFlow.test.ts`, and `tests/aiService.test.mjs`.
- pytest unit tests cover mesh calibration and input validation in `ai-service/tests/test_calibration.py` and `ai-service/tests/test_image_validation.py`.

**Integration Tests:**
- `ai-service/tests/test_silhouette_pipeline.py` exercises validation, reconstruction, calibration, measurement generation, GLB export, and filesystem output with `tmp_path`.
- `ai-service/tests/test_api.py` uses FastAPI `TestClient` to send multipart data and validate response, status, measurement, and model-file endpoints.

**E2E Tests:**
- Not used for the web/mobile application. Android has generated Capacitor example tests in `android/app/src/test/java/com/getcapacitor/myapp/ExampleUnitTest.java` and `android/app/src/androidTest/java/com/getcapacitor/myapp/ExampleInstrumentedTest.java`; they are not application E2E coverage.

## Common Patterns

**Async Testing:**
```typescript
// Keep deterministic async boundary tests focused on the returned promise.
await expect(asyncOperation()).resolves.toEqual(expected);
await expect(asyncOperation()).rejects.toThrow("expected message");
```

No current Vitest test is asynchronous. When adding one, use Vitest's `await expect(...).resolves/rejects` pattern and avoid timers or live network calls. For Python API behavior, use synchronous `TestClient` calls as in `ai-service/tests/test_api.py` unless the code under test requires async execution.

**Error Testing:**
```typescript
expect(() => normalizeProviderResponse({ measurements: [] }, "scan-1"))
  .toThrow("no valid measurements");
```

```python
with pytest.raises(ImageValidationError) as error:
    validate_views({"front": make_body_image()}, None, 10 * 1024 * 1024)
codes = {issue.code for issue in error.value.issues}
assert {"HEIGHT_REQUIRED", "IMAGE_REQUIRED"}.issubset(codes)
```

Assert observable error messages for stable Node boundaries and structured error codes for Python validation. This matches `tests/aiService.test.mjs` and `ai-service/tests/test_image_validation.py`.

---

*Testing analysis: 2026-09-01*
