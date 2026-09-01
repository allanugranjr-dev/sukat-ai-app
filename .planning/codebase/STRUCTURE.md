# Codebase Structure

**Analysis Date:** 2026-09-01

## Directory Layout

```text
[project-root]/
├── src/                    # React SPA and browser-side runtime adapters
│   └── lib/                # Domain operations, providers, types, and pure helpers
├── server/                 # Node/Express/MariaDB/Socket.IO local runtime
├── supabase/               # Hosted schema, RLS migrations, Edge Functions, email template
│   ├── migrations/         # Ordered PostgreSQL schema/security changes
│   └── functions/          # Privileged Deno endpoint handlers
├── ai-service/             # Independent Python FastAPI reconstruction package
│   ├── app/                # API, pipeline, validation, reconstruction, measurements
│   └── tests/              # Pytest coverage for AI service
├── xampp/                  # PHP/MySQL fallback runtime and deployment script
├── tests/                  # Vitest tests for browser-pure workflow helpers
├── android/                # Generated/configured Capacitor Android shell
├── ios/                    # Generated/configured Capacitor iOS shell
├── public/                 # Web assets copied into normal Vite builds
├── docs/                   # Design and validation documentation
├── artifacts/              # Captured visual validation output
├── dist*/                  # Generated Vite build outputs
└── .planning/codebase/     # GSD codebase maps
```

## Directory Purposes

**`src/`:**

- Purpose: Web/mobile UI entrypoint and application workflow.
- Contains: `main.tsx`, monolithic `App.tsx`, `styles.css`, and `lib/`.
- Key files: `src/main.tsx`, `src/App.tsx`, `src/styles.css`.

**`src/lib/`:**

- Purpose: Keep React components separate from backend/runtime details and reusable workflow calculations.
- Contains: Auth/data/storage adapters, backend selection, Socket.IO API client, domain interfaces, and pure validation/mapping helpers.
- Key files: `src/lib/supabase.ts`, `src/lib/data.ts`, `src/lib/auth.ts`, `src/lib/storage.ts`, `src/lib/nodeApi.ts`, `src/lib/types.ts`, `src/lib/scanFlow.ts`.

**`server/`:**

- Purpose: Primary local Node runtime.
- Contains: Express application, MariaDB bootstrap/query helpers, optional AI gateway, config, database setup, and backup utility.
- Key files: `server/index.mjs`, `server/database.mjs`, `server/aiService.mjs`, `server/config.mjs`, `server/setup-db.mjs`, `server/backup.mjs`.

**`supabase/`:**

- Purpose: Hosted backend source of truth.
- Contains: CLI configuration, ordered database migrations, Edge Functions, seed data, and invitation email template.
- Key files: `supabase/migrations/20260829000000_sukatai_schema.sql`, `supabase/functions/process-scan/index.ts`, `supabase/functions/_shared/auth.ts`.

**`ai-service/`:**

- Purpose: Isolated Python service for image validation, reconstruction, measurements, and GLB output.
- Contains: FastAPI application package, scripts, pytest suite, dependency manifests, and architecture/model setup docs.
- Key files: `ai-service/app/main.py`, `ai-service/app/pipeline.py`, `ai-service/app/core/config.py`, `ai-service/pyproject.toml`.

**`xampp/`:**

- Purpose: Apache/PHP/MySQL fallback deployment.
- Contains: PHP action API, MySQL schema, Apache asset rules, and PowerShell deployment script.
- Key files: `xampp/api/index.php`, `xampp/database/sukatai.sql`, `xampp/install-xampp.ps1`, `xampp/README.md`.

**`tests/`:**

- Purpose: Fast frontend domain tests independent of browser rendering and backend services.
- Contains: Vitest files for scan navigation/validation, measurement mapping, invitation lifecycle, and AI gateway response handling.
- Key files: `tests/scanFlow.test.ts`, `tests/measurementMapping.test.ts`, `tests/invitationLifecycle.test.ts`, `tests/aiService.test.mjs`.

**`android/` and `ios/`:**

- Purpose: Capacitor native shells around the built web app.
- Contains: platform build configuration, app manifests/delegates, assets, and generated project files.
- Key files: `android/app/src/main/java/com/sukatai/app/MainActivity.java`, `ios/App/App/AppDelegate.swift`, `capacitor.config.ts`.

## Key File Locations

**Entry Points:**

- `index.html`: Vite HTML host and React mount target.
- `src/main.tsx`: Web SPA bootstrap.
- `server/index.mjs`: Node HTTP/Socket.IO entrypoint.
- `ai-service/app/main.py`: FastAPI/Uvicorn entrypoint.
- `xampp/api/index.php`: PHP local API entrypoint.
- `supabase/functions/*/index.ts`: Deployed Supabase Edge Function entrypoints.

**Configuration:**

- `package.json`: JavaScript scripts and dependencies for web, Node, mobile, and tests.
- `vite.config.ts`: Mode-specific Vite output/base behavior and mobile asset copying.
- `capacitor.config.ts`: Shared Capacitor application configuration.
- `vercel.json`: Hosted Vercel build/runtime selection.
- `tsconfig.json`: TypeScript compiler settings.
- `server/config.mjs`: Server-only Node runtime configuration.
- `ai-service/pyproject.toml`: Python pytest and Ruff configuration.
- `supabase/config.toml`: Supabase CLI configuration.

**Core Logic:**

- `src/App.tsx`: Role-aware UI, scan flow orchestration, and model viewer.
- `src/lib/data.ts`: Domain CRUD and bundle retrieval.
- `src/lib/auth.ts`: User session/profile/invitation operations.
- `src/lib/storage.ts`: Private scan/body asset operations.
- `server/index.mjs`: Local authorization, action routing, persistence orchestration, processing queue, and notifications.
- `supabase/functions/process-scan/index.ts`: Hosted scan-processing transaction and provider integration.
- `ai-service/app/pipeline.py`: AI service processing composition.

**Testing:**

- `tests/*.test.ts`: Vitest coverage for TypeScript pure helper modules.
- `tests/aiService.test.mjs`: Node AI gateway tests.
- `ai-service/tests/`: Pytest coverage for AI endpoints, calibration, validation, and silhouette pipeline.

## Naming Conventions

**Files:**

- Use camelCase TypeScript module filenames in `src/lib/`: `scanFlow.ts`, `measurementMapping.ts`, `reconstructionProvider.ts`.
- Use PascalCase only for the React root component file: `src/App.tsx`.
- Use `.mjs` for Node runtime modules: `server/database.mjs`.
- Use snake_case Python filenames: `ai-service/app/validation/image_validator.py`.
- Use timestamp-prefixed snake_case SQL migration filenames: `supabase/migrations/20260901010000_measurement_provenance.sql`.

**Directories:**

- Group the Python service by responsibility beneath `ai-service/app/`: `core/`, `schemas/`, `validation/`, `reconstruction/`, and `measurements/`.
- Place each Supabase endpoint in its own kebab-case function directory: `supabase/functions/invite-dressmaker/`.
- Keep mobile platform output/configuration inside Capacitor-standard `android/` and `ios/` trees; do not add shared business code there.

## Where to Add New Code

**New Feature:**

- Primary UI/workflow code: add a focused component/function in `src/App.tsx` while the UI remains consolidated there.
- Runtime-neutral data operation: `src/lib/data.ts`, `src/lib/auth.ts`, or `src/lib/storage.ts`, according to domain.
- Local Node implementation: add the corresponding action/authorization path in `server/index.mjs`; keep SQL pooling/transactions in `server/database.mjs`.
- Hosted implementation: add/modify a migration in `supabase/migrations/` and add a dedicated Edge Function in `supabase/functions/` only for privileged server-side behavior.
- Tests: add a co-located concern-level test in `tests/<module>.test.ts`; use `ai-service/tests/test_<area>.py` for Python pipeline behavior.

**New Component/Module:**

- React component: place within `src/App.tsx` and use the established function-component pattern until the UI is deliberately decomposed.
- Pure browser helper: create `src/lib/<camelCaseName>.ts`, export it directly, and cover it in `tests/<camelCaseName>.test.ts`.
- Node backend helper: create `server/<camelCaseName>.mjs` when it isolates a cohesive concern such as `server/aiService.mjs`; import it from `server/index.mjs`.
- AI capability: add the interface/adapter in the existing relevant `ai-service/app/` subpackage, then compose it from `ai-service/app/pipeline.py`.

**Utilities:**

- Shared frontend helper: `src/lib/`.
- Shared Supabase function helper: `supabase/functions/_shared/`.
- Shared AI service helper: the appropriate domain subdirectory in `ai-service/app/`.
- Avoid putting reusable application logic in `android/`, `ios/`, `dist*/`, `artifacts/`, or `public/`.

## Special Directories

**`dist/`, `dist-node/`, and `dist-mobile/`:**

- Purpose: Vite build output for Supabase/Vercel, Node, and Capacitor modes.
- Generated: Yes.
- Committed: Present in the working tree; regenerate with the mode-specific build scripts in `package.json` rather than editing files directly.

**`public/`:**

- Purpose: Static assets including scan-reference media, favicon, and web manifest.
- Generated: No.
- Committed: Yes.

**`artifacts/`:**

- Purpose: Screenshots and platform visual-validation outputs.
- Generated: Yes, by validation/build workflows.
- Committed: Present in the working tree.

**`.planning/codebase/`:**

- Purpose: GSD-generated architecture, stack, convention, test, and concern maps.
- Generated: Yes, by codebase mapping tasks.
- Committed: Repository-dependent; update only the assigned mapping documents.

**`.env*` files:**

- Purpose: Runtime environment configuration.
- Generated: No.
- Committed: Some examples are present; local variants are environment-specific.
- Treat all as secret-bearing configuration and do not read or place values in source or mapping documents.

---

*Structure analysis: 2026-09-01*
