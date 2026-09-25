<!-- refreshed: 2026-09-25 -->
# Architecture

**Analysis Date:** 2026-09-25

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                    Client (React SPA)                        │
├──────────────────┬──────────────────┬───────────────────────┤
│   App.tsx (UI)   │  lib/*.ts (domain│   three.js 3D viewer  │
│  `src/App.tsx`   │  + API clients)  │   (model preview)     │
│                  │  `src/lib/`      │                       │
└────────┬─────────┴────────┬─────────┴──────────┬────────────┘
         │  HTTP/Socket.IO   │  fetch (PHP)       │
         ▼                   ▼                    ▼
┌───────────────────────────┐   ┌───────────────────────────┐
│  Node backend (Express)   │   │  XAMPP backend (PHP/PDO)   │
│  `server/index.mjs`       │   │  `xampp/api/index.php`     │
│  auth, scans, orders,     │   │  parallel action-router    │
│  Socket.IO status stream  │   │  mirror of Node API        │
└────────────┬──────────────┘   └─────────────┬─────────────┘
             │  MariaDB                        │  MariaDB
             ▼                                 ▼
┌─────────────────────────────────────────────────────────────┐
│                       MariaDB database                       │
│         `server/database.mjs` / `xampp/database/`            │
└─────────────────────────────────────────────────────────────┘
             │  HTTP (multipart body-scan)
             ▼
┌─────────────────────────────────────────────────────────────┐
│           AI service (FastAPI, Python 3.11)                  │
│  `ai-service/app/main.py` → `app/pipeline.py`                │
│  validation → reconstruction → measurement → GLB export      │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| React SPA | Full UI: auth, dashboards, scan flow, 3D viewer | `src/App.tsx` |
| Backend adapters | Runtime-agnostic API clients (Node/XAMPP/Supabase) | `src/lib/nodeApi.ts`, `src/lib/xampp.ts`, `src/lib/supabase.ts` |
| Domain logic (client) | Scan flow state, order workflow, measurement mapping, truth resolution | `src/lib/scanFlow.ts`, `src/lib/orderWorkflow.ts`, `src/lib/measurementMapping.ts`, `src/lib/scanResultTruth.ts` |
| Node backend | Express action-router API, auth, sessions, scan processing queue, Socket.IO | `server/index.mjs` |
| Node DB layer | MariaDB pool, transactions, schema init | `server/database.mjs`, `server/setup-db.mjs` |
| Node AI bridge | Forwards scan assets to FastAPI, normalizes results | `server/aiService.mjs` |
| PHP backend | Parallel XAMPP-hosted API mirroring the Node contract | `xampp/api/index.php` |
| AI service API | FastAPI endpoints for body-scan submit/status/model | `ai-service/app/main.py` |
| AI pipeline | Orchestrates validation → reconstruction → measurement → export | `ai-service/app/pipeline.py` |

## Pattern Overview

**Overall:** Multi-runtime action-router backend + client-side domain layer + dedicated Python AI microservice.

**Key Characteristics:**
- Single-action dispatch API: clients POST an `action` name with a payload; both Node and PHP backends route it. Runtime chosen at build time via Vite `--mode` (`node`/`xampp`) and adapter selection in `src/lib/`.
- The Python AI service is an isolated, replaceable reconstruction provider behind a stable `/api/v1/body-scan` HTTP contract.
- Reconstruction providers are pluggable (`ai-service/app/reconstruction/` has silhouette/mesh-morpher/pixie/smplx adapters selected by config).

## Layers

**Presentation:**
- Purpose: All UI and view state
- Location: `src/App.tsx`, `src/styles.css`
- Depends on: `src/lib/` domain + API modules

**Client domain / adapters:**
- Purpose: API access + business rules, abstracted over the active backend
- Location: `src/lib/`
- Used by: `src/App.tsx`

**Backend (dual runtime):**
- Purpose: Persistence, auth, scan orchestration
- Location: `server/` (Node) and `xampp/api/` (PHP) — parallel implementations of one contract

**AI microservice:**
- Purpose: Image validation, 3D reconstruction, anthropometric measurement, GLB export
- Location: `ai-service/app/`

## Data Flow

### Primary Scan Path

1. Customer completes scan steps in UI (`src/lib/scanFlow.ts` step machine, `src/App.tsx`)
2. Assets + height uploaded via active adapter (`src/lib/nodeApi.ts` or `src/lib/xampp.ts`)
3. Backend stages a processing attempt and forwards to AI (`server/index.mjs`, `server/scanProcessingAttempt.mjs`, `server/aiService.mjs`)
4. AI service runs the pipeline (`ai-service/app/pipeline.py:367` `process()`): validate views → pose → reconstruct mesh → tailoring measurements → `export_glb`
5. Status streamed back to client via Socket.IO (`server/index.mjs`) or polled (`src/lib/reconstructionProvider.ts`)
6. Client resolves the truthful scan state (`src/lib/scanResultTruth.ts`) and renders measurements + 3D model

**State Management:**
- Server-authoritative scan status; client polls/subscribes. Node keeps an in-memory processing queue and periodic recovery timer (`server/index.mjs`).

### Auth Flow

1. Sign-in/up action to backend (`src/lib/auth.ts` → `server/index.mjs`)
2. Rate-limited (`rateLimitedActions` in `server/index.mjs`), bcrypt password hashing
3. Session cookie `sukatai_node`; email OTP via nodemailer (Node) / PHPMailer (`xampp/api/mailer.php`)

## Key Abstractions

**Backend adapter:**
- Purpose: Decouple UI from the active runtime
- Examples: `src/lib/nodeApi.ts`, `src/lib/xampp.ts`, `src/lib/supabase.ts`
- Pattern: Uniform `request(action, options)` returning typed results

**Reconstruction provider:**
- Purpose: Swappable 3D reconstruction backend
- Examples: `ai-service/app/reconstruction/silhouette.py`, `mesh_morpher.py`, `pixie_adapter.py`, `smplx_adapter.py`, base `reconstruction/base.py`
- Pattern: Common interface selected by `ai-service/app/core/config.py`

**Scan truth resolver:**
- Purpose: Derive one truthful UI state from ambiguous backend payloads
- Examples: `src/lib/scanResultTruth.ts`, `src/lib/reconstructionProvider.ts`

## Entry Points

**Web SPA:**
- Location: `src/main.tsx` → `src/App.tsx`; HTML shell `index.html`; bundler `vite.config.ts`
- Triggers: Browser load

**Node API server:**
- Location: `server/index.mjs` (`npm run start:node`)
- Triggers: HTTP requests + Socket.IO connections on port 3001

**AI service:**
- Location: `ai-service/app/main.py` (`npm run start:ai`, uvicorn port 8000)
- Triggers: HTTP `/api/v1/body-scan` calls from backends

**PHP API:**
- Location: `xampp/api/index.php`
- Triggers: HTTP requests under XAMPP deployment

## Architectural Constraints

- **Threading:** Node single-threaded event loop with a serialized `processingQueue`; AI service uses async FastAPI with `asyncio.Semaphore(max_concurrent_scans)` (`ai-service/app/main.py`).
- **Dual-runtime parity:** Any API contract change must be mirrored in both `server/index.mjs` and `xampp/api/index.php`, and env-mode flags kept aligned (`server/config.mjs` honors `SUKATAI_ENV`/`APP_ENV` like the PHP side).
- **Global state:** In-memory maps in `server/index.mjs` (`processingJobs`, `rateLimitBuckets`) — single-instance only; multi-instance needs a shared store.
- **Scan id safety:** IDs constrained by `SAFE_SCAN_ID` regex in `ai-service/app/pipeline.py` and path-traversal guards in `server/aiService.mjs`.

## Anti-Patterns

### Monolithic UI file
**What happens:** `src/App.tsx` is ~3,294 lines holding nearly all views and state.
**Why it's wrong:** Hard to navigate, test, and modify safely; high merge-conflict risk.
**Do this instead:** Extract feature views/hooks into `src/` component modules; keep `App.tsx` as a router/shell.

### Duplicated backend contract
**What happens:** Node (`server/index.mjs`) and PHP (`xampp/api/index.php`) reimplement the same action API.
**Why it's wrong:** Behavior can drift between runtimes.
**Do this instead:** Keep a shared contract test + document actions; change both in lockstep.

## Error Handling

**Strategy:** Typed error classes with stable codes/status. `ApiError` in `server/index.mjs`, `PipelineFailure` in `ai-service/app/pipeline.py`, `SukatApiException` in `xampp/api/index.php`.

**Patterns:**
- User-safe messages surfaced; internal detail suppressed in production
- Pipeline returns structured `ValidationIssue[]` for image/pose problems

## Cross-Cutting Concerns

**Logging:** Diagnostic outputs written under `ai-service/output/diagnostic/`; console-based server logging.
**Validation:** Image + pose validators (`ai-service/app/validation/`), Pydantic schemas (`ai-service/app/schemas/api.py`), input coercion helpers in both backends.
**Authentication:** Cookie sessions + bcrypt + email OTP, rate-limited in both runtimes.

---

*Architecture analysis: 2026-09-25*
