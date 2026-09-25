# Codebase Structure

**Analysis Date:** 2026-09-25

## Directory Layout

```
bsit sukat ai app/
├── src/                    # React SPA (TypeScript)
│   ├── App.tsx             # Root UI (all views, ~3.3k lines)
│   ├── main.tsx            # Entry point / bootstrap
│   ├── styles.css          # Global styles
│   └── lib/                # Domain logic + backend adapters
├── server/                 # Node.js Express backend (.mjs)
├── xampp/                  # PHP/XAMPP backend + storage + DB scripts
│   ├── api/                # PHP action-router API + PHPMailer
│   ├── database/           # SQL schema/migrations
│   └── storage/            # Uploaded scan-captures & body-models (runtime data)
├── ai-service/             # FastAPI Python AI microservice
│   ├── app/                # API, pipeline, reconstruction, measurements
│   ├── models/             # Model assets
│   ├── output/             # Generated output + diagnostics
│   ├── scripts/            # AI utility scripts
│   └── tests/              # Python (pytest) tests
├── tests/                  # Frontend/Node tests (vitest / node)
├── scripts/                # Dev/smoke scripts (.mjs)
├── public/                 # Static assets (+ media)
├── docs/                   # Documentation
├── index.html              # SPA HTML shell
├── vite.config.ts          # Bundler config
├── tsconfig.json           # TypeScript config
└── package.json            # Scripts + dependencies
```

## Directory Purposes

**`src/lib/`:**
- Purpose: All client-side domain logic and backend access
- Key files: `nodeApi.ts`, `xampp.ts`, `supabase.ts` (adapters); `auth.ts`, `data.ts`, `scanFlow.ts`, `orderWorkflow.ts`, `invitationLifecycle.ts`, `measurementMapping.ts`, `modelContours.ts`, `reconstructionProvider.ts`, `scanResultTruth.ts`, `storage.ts`, `types.ts`

**`server/`:**
- Purpose: Node Express backend
- Key files: `index.mjs` (API + Socket.IO), `database.mjs`, `config.mjs`, `aiService.mjs`, `scanProcessingAttempt.mjs`, `setup-db.mjs`, `backup.mjs`

**`ai-service/app/`:**
- Purpose: FastAPI service
- Key files: `main.py`, `pipeline.py`; subpackages `reconstruction/`, `measurements/`, `validation/`, `fitting/`, `evaluation/`, `schemas/`, `core/`

**`xampp/`:**
- Purpose: PHP backend mirror + persisted runtime storage
- Note: `xampp/storage/` holds real uploaded scan data (UUID-nested dirs); treat as data, not code

## Key File Locations

**Entry Points:**
- `src/main.tsx`: SPA bootstrap
- `server/index.mjs`: Node API server
- `ai-service/app/main.py`: FastAPI app
- `xampp/api/index.php`: PHP API

**Configuration:**
- `vite.config.ts`, `tsconfig.json`: build/types
- `server/config.mjs`, `ai-service/app/core/config.py`, `xampp/api/config.php`: backend config
- `.env.node`, `.env.xampp`, `.env.mobile`, `.env.local` (+ `.example` variants): env per runtime

**Core Logic:**
- `src/App.tsx`, `src/lib/*`: client
- `ai-service/app/pipeline.py`: AI orchestration

**Testing:**
- `tests/*.test.ts` / `*.test.mjs`: frontend + Node
- `ai-service/tests/test_*.py`: Python

## Naming Conventions

**Files:**
- Client TS: camelCase modules (`scanFlow.ts`, `nodeApi.ts`); React root PascalCase (`App.tsx`)
- Node backend: `.mjs`, camelCase (`aiService.mjs`, `scanProcessingAttempt.mjs`)
- Python: snake_case (`anny_fitter.py`, `image_validator.py`)
- PHP: lowercase (`index.php`, `mailer.php`)
- Tests: `*.test.ts` / `*.test.mjs` (JS), `test_*.py` (Python)

**Directories:**
- lowercase, hyphenated for services (`ai-service`), single-word for source (`src`, `server`, `xampp`)

## Where to Add New Code

**New UI feature:**
- View/logic: extract into `src/` module (avoid growing `src/App.tsx`); shared logic in `src/lib/`
- Tests: `tests/<name>.test.ts`

**New backend action:**
- Node: add handler in `server/index.mjs`; DB access via `server/database.mjs`
- PHP mirror: add matching action in `xampp/api/index.php`
- Tests: `tests/<name>.test.mjs`

**New AI reconstruction/measurement logic:**
- Provider: `ai-service/app/reconstruction/`; measurement: `ai-service/app/measurements/`; wire into `ai-service/app/pipeline.py`
- Schemas: `ai-service/app/schemas/api.py`
- Tests: `ai-service/tests/test_*.py`

**Utilities/scripts:**
- Dev scripts: `scripts/`; AI scripts: `ai-service/scripts/`

## Special Directories

**`xampp/storage/`:**
- Purpose: Uploaded scan-captures and generated body-models (UUID-nested)
- Generated: Yes (runtime) — Committed: sample data present, should generally be gitignored

**`ai-service/output/`:**
- Purpose: Generated GLB/diagnostic output
- Generated: Yes — Committed: No (runtime artifacts)

**`public/`:**
- Purpose: Static assets served as-is — Committed: Yes

---

*Structure analysis: 2026-09-25*
