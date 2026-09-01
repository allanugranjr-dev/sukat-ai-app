<!-- refreshed: 2026-09-01 -->
# Architecture

**Analysis Date:** 2026-09-01

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│ React single-page application                                         │
│ `src/main.tsx` → `src/App.tsx`                                       │
├──────────────────┬─────────────────────┬────────────────────────────┤
│ UI/workflows     │ Runtime adapters    │ optional mobile shells      │
│ `src/App.tsx`    │ `src/lib/`          │ `android/`, `ios/`          │
└────────┬─────────┴──────────┬──────────┴────────────────────────────┘
         │                    │
         │                    ├──────────────────┐
         ▼                    ▼                  ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────────────┐
│ Node local stack │ │ Supabase hosted  │ │ XAMPP fallback           │
│ `server/`        │ │ `supabase/`      │ │ `xampp/api/index.php`    │
│ Express+Socket.IO│ │ Auth+Postgres+   │ │ PHP+MySQL                │
│ MariaDB          │ │ Storage+Functions│ │                          │
└───────┬──────────┘ └────────┬─────────┘ └────────────┬─────────────┘
        │                     │                          │
        ▼                     ▼                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Persistent scans, assets, body models, measurements, orders, etc.   │
│ `xampp/database/sukatai.sql` / `supabase/migrations/`               │
└───────────────────────┬─────────────────────────────────────────────┘
                        │ optional provider request
                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Image measurement service: FastAPI → pipeline → GLB/measurements    │
│ `ai-service/app/main.py` → `ai-service/app/pipeline.py`             │
└─────────────────────────────────────────────────────────────────────┘
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

**Overall:** Single-page frontend with a runtime-selectable backend adapter and parallel local/hosted persistence implementations.

**Key Characteristics:**

- Keep browser workflow code runtime-neutral: `src/lib/data.ts`, `src/lib/storage.ts`, and `src/lib/auth.ts` branch only at the persistence/auth boundary using `isLocalApiMode` from `src/lib/supabase.ts`.
- Treat scan images and generated body models as private assets; serve them through signed URLs in Supabase or the authorization-checked `asset` action in `server/index.mjs`.
- Keep privileged invitation and processing operations server-side in `supabase/functions/` or `server/index.mjs`; the browser invokes them through established adapters.
- Preserve the shared domain model in `src/lib/types.ts` across React, local APIs, and Supabase table records.

## Layers

**Presentation and workflow layer:**

- Purpose: Render the role-aware SPA and coordinate user interactions.
- Location: `src/App.tsx`, `src/main.tsx`, `src/styles.css`.
- Contains: Components, local React state, async loading hook, camera capture, scan navigation, and Three.js visualization.
- Depends on: Domain types and helpers in `src/lib/`.
- Used by: Vite web output and Capacitor mobile projects.

**Browser domain adapter layer:**

- Purpose: Centralize auth, CRUD, storage, scan-state validation, processing requests, and live updates.
- Location: `src/lib/`.
- Contains: `data.ts`, `auth.ts`, `storage.ts`, `reconstructionProvider.ts`, `nodeApi.ts`, `xampp.ts`, `supabase.ts`, and pure helpers such as `scanFlow.ts`.
- Depends on: Supabase JS or `fetch`/Socket.IO client, selected by `src/lib/supabase.ts`.
- Used by: `src/App.tsx` and tests in `tests/`.

**Local Node application layer:**

- Purpose: Primary local full-stack runtime with API, session auth, scan queue, external notification delivery, and static SPA hosting.
- Location: `server/index.mjs`.
- Contains: A query-parameter action dispatcher, middleware, role checks, asset authorization, a serialized in-process queue, and Socket.IO rooms.
- Depends on: MariaDB helpers in `server/database.mjs`, configuration in `server/config.mjs`, optional AI client in `server/aiService.mjs`, and built assets in `dist-node/`.
- Used by: `src/lib/nodeApi.ts` and `src/lib/xampp.ts` when Node mode is selected.

**Hosted Supabase layer:**

- Purpose: Provide Auth, PostgreSQL data/RLS, private object storage, and privileged server-side functions.
- Location: `supabase/migrations/`, `supabase/functions/`.
- Contains: Tables, enum types, triggers, RLS/storage policies, and Deno handlers for invitation lifecycle and processing.
- Depends on: Supabase Auth and service-role client constructed in `supabase/functions/_shared/auth.ts`.
- Used by: Direct Supabase browser calls in `src/lib/` and function invokes from `src/lib/auth.ts`/`src/lib/reconstructionProvider.ts`.

**AI reconstruction layer:**

- Purpose: Optional image-to-measurement service for the Node gateway and compatible Supabase processing endpoint.
- Location: `ai-service/app/`.
- Contains: FastAPI endpoints, request/response schemas, image validation, calibrated silhouette reconstruction, optional model adapters, calibration, tailoring measurement calculation, and GLB exporter.
- Depends on: Settings in `ai-service/app/core/config.py` and image/model libraries.
- Used by: `server/aiService.mjs` and the multipart request path in `supabase/functions/process-scan/index.ts`.

## Data Flow

### Primary Scan Request Path

1. `CustomerScan` creates/updates a scan and uploads front, side, and back assets through `src/App.tsx:995`, `src/lib/data.ts`, and `src/lib/storage.ts`.
2. The selected backend persists the scan/asset records: `server/index.mjs:899` with MariaDB, or the tables/storage policies defined in `supabase/migrations/20260829000000_sukatai_schema.sql`.
3. `requestScanProcessing` invokes `process_scan` locally or `process-scan` remotely through `src/lib/reconstructionProvider.ts`.
4. Node serializes work in `processScanJob` and `queueScanProcessing` (`server/index.mjs:755`, `server/index.mjs:873`); Supabase performs the equivalent authenticated transaction in `supabase/functions/process-scan/index.ts`.
5. When configured, `server/aiService.mjs:187` posts multipart views to `ai-service/app/main.py:137`; `BodyScanPipeline.process` validates, reconstructs, calibrates, measures, and exports at `ai-service/app/pipeline.py:99`.
6. The backend writes measurements/body model and updates the scan to `ready_for_review`; Node emits a room-scoped `scan:status` event from `server/index.mjs` and `ScanProcessing` subscribes via `src/lib/nodeApi.ts`.
7. `ScanResults` loads the bundle and uses private signed/authorized asset URLs for photos and body-model display in `src/App.tsx:1364`.

### Invitation Path

1. An administrator submits an invitation through `src/lib/auth.ts`.
2. In Supabase mode, `supabase/functions/invite-dressmaker/index.ts` checks the bearer user, administrator role, allowed redirect origin, and creates a hashed one-time invitation before invoking Supabase Auth.
3. `supabase/functions/accept-dressmaker-invitation/index.ts` validates the token or server-owned metadata, atomically claims it, and upserts the dressmaker profile/organization assignment.
4. In Node/XAMPP modes, the same UI calls their local action through `src/lib/xampp.ts`; Node dispatches optional email via `server/index.mjs`.

**State Management:**

- Persist authoritative business state in the active backend; React state only represents current page/workflow state in `src/App.tsx`.
- Model scan lifecycle as the `ScanStatus` union in `src/lib/types.ts` and enforce state/role transitions in server-side logic and Supabase triggers/policies.
- Node owns module-level process state only for the live Socket.IO server and in-process processing queue in `server/index.mjs`; the AI service separately keeps completed results in the in-memory `stored_scans` dictionary in `ai-service/app/main.py`.

## Key Abstractions

**Runtime mode selection:**

- Purpose: Allow one React codebase to run against Node, XAMPP, or Supabase.
- Examples: `src/lib/supabase.ts`, `src/lib/nodeApi.ts`, `src/lib/xampp.ts`.
- Pattern: Determine mode once from Vite build environment, then route local requests through `xamppRequest` (which delegates to Node when appropriate) or use `requireSupabase()`.

**Scan bundle:**

- Purpose: Aggregate a scan with its images, measurements, and optional body model for review.
- Examples: `src/lib/types.ts`, `src/lib/data.ts`.
- Pattern: Fetch independently persisted artifacts and return the `ScanBundle` interface to presentation code.

**Processing provider boundary:**

- Purpose: Isolate an optional reconstruction provider from persistent scan workflow.
- Examples: `server/aiService.mjs`, `supabase/functions/process-scan/index.ts`, `ai-service/app/pipeline.py`.
- Pattern: Validate provider output before persisting any measurements or model reference; retain a clearly labelled local deterministic fallback for local development.

## Entry Points

**Web application:**

- Location: `src/main.tsx`.
- Triggers: Vite serves `index.html`, then React mounts into `#root`.
- Responsibilities: Redirect legacy local auth callbacks and render `App` under `StrictMode`.

**Node server:**

- Location: `server/index.mjs`.
- Triggers: `npm run start:node`.
- Responsibilities: Initialize database, resume pending scans, start Express/Socket.IO, serve API/assets/dist output, and safely stop on process signals.

**Supabase functions:**

- Location: `supabase/functions/*/index.ts`.
- Triggers: Browser function invokes.
- Responsibilities: Authenticate bearer requests and perform privileged invitation or processing operations.

**AI service:**

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

**What happens:** A component calls `fetch`, Supabase tables, or storage directly instead of using `src/lib/data.ts`, `src/lib/storage.ts`, or `src/lib/auth.ts`.
**Why it's wrong:** It silently excludes one or more supported runtimes and duplicates mode/error behavior.
**Do this instead:** Add the domain operation to the relevant `src/lib/` adapter with a local mode branch and Supabase implementation, then call that function from `src/App.tsx`.

### Treating local reconstruction as personalized production output

**What happens:** A consumer interprets the local deterministic result as a real reconstruction.
**Why it's wrong:** The local processor is deliberately a simulation/reference path and does not produce personalized provider confidence.
**Do this instead:** Preserve the provider-status and review workflow implemented in `server/index.mjs`, `supabase/functions/process-scan/index.ts`, and `src/lib/reconstructionProvider.ts`; only publish validated provider outputs as production measurements.

## Error Handling

**Strategy:** Validate at boundaries, propagate user-readable errors to React, and keep privileged/internal failures server-side.

**Patterns:**

- Browser adapters turn backend failures into `Error` objects using `readableError` in `src/lib/supabase.ts`.
- Node uses `ApiError` plus centralized `sendError` in `server/index.mjs`; production hides unanticipated internal error details.
- Supabase functions use status-specific JSON responses through `supabase/functions/_shared/cors.ts`.
- AI pipeline failures carry stable error codes, HTTP statuses, and validation issues through `PipelineFailure` in `ai-service/app/pipeline.py`.

## Cross-Cutting Concerns

**Logging:** Node logs unexpected server errors through `sendError` in `server/index.mjs`; the AI service exposes health/status diagnostics in `ai-service/app/main.py`.

**Validation:** Browser preflight guards live in `src/lib/scanFlow.ts`; server checks include image signatures and role/state checks in `server/index.mjs`; hosted processing validates provider payloads in `supabase/functions/process-scan/index.ts`; AI validation is in `ai-service/app/validation/image_validator.py`.

**Authentication:** Supabase mode uses `@supabase/supabase-js` session auth in `src/lib/auth.ts` and RLS policies in `supabase/migrations/`; Node uses database-backed cookie sessions in `server/index.mjs`; XAMPP supplies its own PHP session implementation in `xampp/api/index.php`.

---

*Architecture analysis: 2026-09-01*
