# Testing Patterns

**Analysis Date:** 2026-09-25

SukatAI has two independent test suites: **Vitest** for the SPA + Node gateway (JS/TS), and **pytest** for the Python AI service. The PHP/XAMPP runtime has no automated tests.

## Test Framework

**JS/TS Runner:**
- Vitest (`vitest` devDependency, `latest`). No dedicated `vitest.config.ts` — config comes from `vite.config.ts` plus `tsconfig.json` (`types: ["vitest/globals"]`, `include: ["tests", ...]`).
- Globals enabled, but tests still import `{ describe, expect, it }` from `vitest` explicitly.

**Python Runner:**
- pytest (`pytest>=8.3,<9` in `ai-service/requirements-dev.txt`).
- Config in `ai-service/pyproject.toml`: `pythonpath = ["."]`, `testpaths = ["tests"]`, `addopts = "-ra"`.
- `httpx` + FastAPI `TestClient` for API tests.

**Assertion Libraries:**
- JS/TS: Vitest `expect` (`toEqual`, `toBe`, `toMatchObject`, `toBeCloseTo`, `toBeNull`, `toThrow`).
- Python: plain `assert` + pytest fixtures.

**Run Commands:**
```bash
npm test                                   # Vitest run (SPA + Node): "vitest run"
npx vitest                                 # Watch mode (not scripted)
npx vitest run --coverage                  # Coverage (no threshold configured)

cd ai-service && pytest                     # Python AI service suite
cd ai-service && pytest -ra tests/test_api.py
```
Note: `npm run lint` / `npm run typecheck` both run `tsc --noEmit` — type checking is part of the quality gate.

## Test File Organization

**Location:**
- JS/TS: separate top-level `tests/` directory (NOT co-located with `src/`).
- Python: separate `ai-service/tests/` directory mirroring `app/` domains.

**Naming:**
- JS/TS: `<subject>.test.ts` for SPA lib, `<subject>.test.mjs` for Node gateway — e.g. `tests/scanFlow.test.ts`, `tests/aiService.test.mjs`, `tests/scanProcessingTracer.test.mjs`.
- Python: `test_<subject>.py` — `tests/test_api.py`, `tests/test_calibration.py`, `tests/test_silhouette_pipeline.py`.

**Structure:**
```
tests/                              # SPA + Node (Vitest)
├── adapters.contract.test.ts       # cross-runtime adapter contract
├── aiService.test.mjs              # Node AI provider boundary
├── scanFlow.test.ts                # SPA scan guardrails
├── measurementMapping.test.ts
├── orderWorkflow.test.ts
├── scanResultTruth.test.ts
└── scanProcessingTracer.test.mjs   # Node durable-attempt contract

ai-service/tests/                   # Python (pytest)
├── conftest.py                     # injects service root into sys.path
├── helpers.py                      # image fixtures
├── test_api.py
├── test_calibration.py
├── test_silhouette_pipeline.py     # exports build_settings / fitted_body_fixture reused elsewhere
├── test_measurement_normalization.py
├── test_resource_bounds.py
└── test_mesh_morpher.py
```

## Test Structure

**Suite organization (Vitest):** one `describe` per behavior area, `it` clauses phrased as truthful behavioral guarantees.
```typescript
import { describe, expect, it } from "vitest";
import { customerScanJourney, isHeightValid, validateUpload } from "../src/lib/scanFlow";

describe("scan flow guardrails", () => {
  it("only accepts supported, reasonably sized uploads", () => {
    expect(validateUpload({ type: "image/jpeg", size: 1024 }).valid).toBe(true);
    expect(validateUpload({ type: "image/gif", size: 1024 }).valid).toBe(false);
  });
});
```

**Suite organization (pytest):** function-per-scenario, `tmp_path` + `monkeypatch` fixtures, FastAPI `TestClient` in a `with` block.
```python
def test_api_processes_multipart_scan_and_exposes_result_endpoints(tmp_path, monkeypatch):
    settings = build_settings(tmp_path)
    monkeypatch.setattr(main_module, "settings", settings)
    ...
    with TestClient(app) as client:
        response = client.post("/api/v1/body-scan", files=files, data={"height_cm": "170"})
```

## Mocking

**JS/TS:** Minimal — tests favor pure functions fed literal inputs over mocks. No `vi.mock` in current suites; boundary functions (`normalizeProviderResponse`) are tested directly with hand-built payloads.

**Python:** `pytest`'s `monkeypatch.setattr` swaps module-level singletons and heavy stages:
- Replace `main_module.settings` / `main_module.pipeline` with test builds.
- Stub expensive/ML steps: `pipeline_module.validate_pose`, `fit_anny_body`, `BodyScanPipeline._anny_targets` return fixed fixtures.

**What to mock:** external/expensive stages (pose model, mesh fitting, ML inference), settings, filesystem targets via `tmp_path`.
**What NOT to mock:** the domain logic under test — calibration math, measurement normalization, and response shaping run for real.

## Fixtures and Factories

**Python:** shared helpers generate deterministic synthetic input instead of loading binary assets:
```python
# ai-service/tests/helpers.py
def make_body_image(width=480, height=960) -> bytes:
    image = Image.new("RGB", (width, height), "white")
    ...  # draws a stylized silhouette with PIL
    return buffer.getvalue()
```
Reusable settings/body factories (`build_settings`, `fitted_body_fixture`) live in `test_silhouette_pipeline.py` and are imported by `test_api.py`. `conftest.py` only wires `sys.path`.

**JS/TS:** inline object literals built per assertion (e.g. staged-attempt records in `scanProcessingTracer.test.mjs`); no separate fixture files.

## Coverage

**Requirements:** None enforced — no coverage threshold in config, no coverage in the `test` script or CI gate observed.
```bash
npx vitest run --coverage         # ad hoc JS/TS
cd ai-service && pytest --cov=app # requires pytest-cov (not currently pinned)
```

## Test Types

**Unit tests:** dominant style — pure functions and math (`test_calibration.py`, `scanFlow.test.ts`, `measurementMapping.test.ts`).
**Contract tests:** cross-runtime boundary guarantees — `tests/adapters.contract.test.ts` and `tests/scanProcessingTracer.test.mjs` assert only safe fields cross the SPA/Node boundary; `aiService.test.mjs` locks the AI provider response contract.
**Integration tests:** `ai-service/tests/test_api.py` exercises the full FastAPI multipart pipeline via `TestClient` with heavy stages stubbed; `test_resource_bounds.py` covers concurrency/limit behavior.
**E2E tests:** Not used.

## Common Patterns

**Truthfulness-focused assertions:** tests explicitly guard against dishonest data (`null` confidence must not become `0%`; measurement-only output must never be reported as `completed`):
```typescript
expect(result.measurements[0].confidence).toBeNull();
expect(() => normalizeProviderResponse({ ...metadata, measurements: [] }, "scan-1"))
  .toThrow("no valid measurements");
```

**Error testing:**
```typescript
expect(() => normalizeProviderResponse(payloadWithDuplicates, "scan-1")).toThrow("duplicate");
```
```python
with pytest.raises(CalibrationError):
    calibrate_vertices(bad_vertices, height_cm=600)
```

**Numeric tolerance:** unit conversions use `toBeCloseTo` (JS) / `pytest.approx` (Python) — e.g. inches→cm `expect(...value).toBeCloseTo(81.28)`.

---

*Testing analysis: 2026-09-25*
