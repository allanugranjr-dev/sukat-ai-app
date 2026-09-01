# Architecture Patterns

**Domain:** CPU-first two-view body measurement and tailor review
**Researched:** 2026-09-02
**Research method:** Existing architecture map, active source contracts, cached GSD questions, and primary platform documentation.

## Recommended Architecture

```text
React/Capacitor UI
  → browser domain adapters
      ├─ Node/MariaDB + Socket.IO (local)
      ├─ Supabase Auth/Postgres/Storage/Edge Functions (hosted)
      └─ XAMPP compatibility adapter
  → durable scan attempt/state contract
  → authenticated provider request
      → FastAPI CPU worker
          validate → landmarks/silhouettes → calibration
          → Anny/CLAD fit → measurements + guide contours → GLB
  → validate provider result
  → atomically promote measurements/model metadata
  → review UI + tailor/admin workflows
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|----------------|-------------------|
| `src/App.tsx` and extracted viewer/workflow components | Render screens, capture user actions, show lifecycle and results | `src/lib/*` adapters; Three.js viewer |
| `src/lib/data.ts`, `auth.ts`, `storage.ts`, `reconstructionProvider.ts` | Runtime-neutral domain operations and result normalization | Node/XAMPP or Supabase implementations |
| Node API | Local auth/authorization, CRUD, queue orchestration, assets, Socket.IO updates | MariaDB, local storage, Python provider |
| Supabase functions/RLS | Hosted auth checks, private asset access, durable state transitions, provider orchestration | Supabase Auth/Postgres/Storage, external Python provider |
| XAMPP PHP API | Retained compatibility path | MySQL/MariaDB and local storage |
| FastAPI provider | Input validation, CPU reconstruction, measurement computation, GLB export | Uploaded/signed images; no browser state |
| Measurement contract module | Shared validation of provider version, units, provenance, nullable confidence, quality, and guide metadata | Node, Edge Function, frontend tests |
| Evaluation harness | Compares provider output with independent tape references | Versioned test fixtures; never production customer state |

### Data Flow

1. Customer records front/side assets and height; the active backend creates a scan and private asset records.
2. Validation checks dimensions, decodeability, full-body framing, and pose before fitting.
3. Backend creates a processing attempt with an idempotency key and transitions the scan using compare-and-set semantics.
4. Provider receives authorized image bytes/URLs and returns a versioned result containing measurements, quality/issues, diagnostics, and model guide metadata.
5. Backend validates units, ranges, supported keys, asset references, and guide coordinate metadata. Invalid provider output becomes a clear failure, not a partial ready result.
6. New model/measurement rows are written under the attempt. Only after all artifacts are durable does the backend promote the attempt and mark the scan ready.
7. Browser loads the result bundle through authorized asset access and renders guides using the provider-authored contour/level contract.
8. Tailor/admin views consume the same result bundle with existing role policies.

## Patterns to Follow

### Pattern 1: Versioned provider result contract

**What:** Treat the provider response as a compatibility boundary, including `processing_version`, provider version, quality, issues, measurements, and guide geometry metadata.

**When:** Any provider or viewer change could alter values or coordinate systems.

**Example shape:**

```typescript
type ProviderResult = {
  processingVersion: string;
  scanQuality: "good" | "acceptable" | "poor";
  qualityIssues: string[];
  measurements: Array<{
    key: string;
    value: number;
    unit: "cm";
    method: string;
    source: string;
    confidence: number | null;
  }>;
  guides: { coordinateSystem: string; levels: Record<string, number>; contours?: unknown };
  model: { path: string; heightCm: number };
};
```

### Pattern 2: Attempt-based promotion

**What:** Write a new attempt's artifacts first, then promote them in one durable state transition. Retain the previous ready result until the new attempt is complete.

**When:** Retrying, reprocessing, provider upgrades, or partial network failures.

### Pattern 3: Provider-authored geometry

**What:** The provider either exports exact contour samples or exports the exact level/method metadata used to calculate each circumference. The viewer transforms those points into its known display coordinate system without selecting a different anatomical slice.

**When:** A displayed ring must claim to represent a stored circumference.

### Pattern 4: Contract tests over every runtime adapter

**What:** Run the same normalization, role, lifecycle, private asset, and result-shape scenarios against Node and the hosted adapter; keep XAMPP fixtures where the PHP runtime can be exercised.

**When:** A feature touches `src/lib` plus Node, Supabase, or XAMPP.

## Anti-Patterns to Avoid

### Different circumference algorithms in provider and viewer

**What:** Provider uses CLAD/convex-hull measurements while the viewer uses a raw surface loop or fallback ellipse.

**Why bad:** The ring can be visibly plausible but mathematically disagree with the number shown.

**Instead:** Persist provider contours/levels or explicitly label the visual guide as illustrative rather than measurement-exact.

### In-process memory as the result database

**What:** Rely on Python `stored_scans` or a Node promise chain as the only job state.

**Why bad:** Restart, multiple workers, or deployment replacement loses status/result lookup.

**Instead:** Persist attempt/status/artifact metadata in the active database and use the provider as a stateless worker as far as practical.

### Browser bypass of adapters

**What:** Add direct fetch/Supabase/Storage calls from a new UI component.

**Why bad:** One runtime works while another silently diverges in auth, privacy, and errors.

**Instead:** Extend the established `src/lib` boundary and test both runtime paths.

## Scalability Considerations

| Concern | At 100 users | At 10K users | At 1M users |
|---------|--------------|--------------|-------------|
| Scan jobs | Durable DB attempts and one bounded local worker | Shared queue and bounded provider workers | Regional queue, autoscaled workers, quotas, and observability |
| Assets | Private local/Supabase storage with retention checks | Shared object storage and signed URL caching | Lifecycle policies, encryption, audit logs, and deletion workflows |
| Result reads | Bundle query per opened scan | Paginated summaries and lazy model/asset loading | Read models/aggregates and CDN-backed signed assets |
| Evaluation | Curated consented fixtures | Held-out validation set by provider version | Continuous monitoring with drift and regression alerts |

## Build Order

1. Lock the provider result/measurement/guide contract and truthfulness rules.
2. Add attempt/promotion and retry safeguards without changing the existing user flow.
3. Make provider and viewer share exact guide geometry; reprocess or safely backfill stale scans.
4. Surface quality/provenance in results and add adapter/geometry tests.
5. Add performance, restart, privacy, and held-out evaluation checks.

## Sources

- Existing codebase map: `.planning/codebase/ARCHITECTURE.md` and `.planning/codebase/CONCERNS.md`.
- [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html).
- [Khronos glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html).
- [FastAPI background tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/).
- [Supabase Edge Functions architecture](https://supabase.com/docs/guides/functions) and [private Storage downloads](https://supabase.com/docs/guides/storage/serving/downloads).
