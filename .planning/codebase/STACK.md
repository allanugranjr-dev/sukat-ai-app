# Technology Stack

**Analysis Date:** 2026-09-01

## Languages

**Primary:**
- TypeScript (ES2022 target) - React browser application in `src/`, Supabase Edge Functions in `supabase/functions/`, and Vite configuration in `vite.config.ts`.
- JavaScript (ES modules) - Node.js API, MariaDB access, notifications, backups, and AI-service adapter in `server/*.mjs`.
- Python (3.11 target; 3.12 container image) - FastAPI body-scan/reconstruction service in `ai-service/app/`.

**Secondary:**
- SQL (PostgreSQL/Supabase and MySQL/MariaDB dialects) - hosted schema/migrations in `supabase/migrations/` and local/XAMPP schema in `xampp/database/sukatai.sql`.
- PHP - optional Apache/XAMPP API fallback in `xampp/api/index.php`.
- CSS - application styling in `src/styles.css`.

## Runtime

**Environment:**
- Node.js - local installation reports `v24.20.0`; `package.json` does not declare an `engines` constraint.
- Python - `ai-service/pyproject.toml` targets Python 3.11; `ai-service/Dockerfile` packages the service on `python:3.12-slim`.
- PHP/Apache/MySQL - optional XAMPP runtime described in `xampp/README.md`.

**Package Manager:**
- npm 11.19.0 - scripts and dependencies declared in `package.json`.
- Lockfile: present as `package-lock.json`.
- Python dependencies are pip requirement files: `ai-service/requirements.txt` and `ai-service/requirements-dev.txt`; no Python lockfile is present.

## Frameworks

**Core:**
- React 19.2.8 / React DOM 19.2.8 - single-page UI bootstrapped by `src/main.tsx` and implemented largely in `src/App.tsx`.
- Vite 8.2.2 with `@vitejs/plugin-react` 6.1.1 - browser build and local development configured in `vite.config.ts`.
- Express 5.2.1 - optional Node API/server in `server/index.mjs`.
- FastAPI `>=0.115,<1` with Uvicorn `>=0.34,<1` - isolated body-scan HTTP API in `ai-service/app/main.py`.
- Supabase Edge Functions (Deno) - hosted processing and invitation endpoints in `supabase/functions/`.
- Capacitor 8.5.0 - Android/iOS shell configuration in `capacitor.config.ts`; native projects are `android/` and `ios/`.

**Testing:**
- Vitest 4.1.11 - frontend/unit test command in `package.json`; tests live in `tests/`.
- pytest `>=8.3,<9` with HTTPX `>=0.28,<1` - AI-service tests in `ai-service/tests/`.

**Build/Dev:**
- TypeScript 7.0.2 - strict no-emit type checking set by `tsconfig.json` and invoked by `package.json` scripts.
- Docker - AI service image definition in `ai-service/Dockerfile`.
- Capacitor CLI 8.5.0 - mobile syncing, APK build, run, and open scripts in `package.json`.

## Key Dependencies

**Critical:**
- `@supabase/supabase-js` 2.112.4 - hosted authentication, Postgres data access, private storage, and Edge Function invocation from `src/lib/supabase.ts`, `src/lib/auth.ts`, `src/lib/data.ts`, and `src/lib/storage.ts`.
- `three` 0.185.1 - browser WebGL measurement/body-model rendering, dynamically loaded by `src/App.tsx`.
- `express` 5.2.1 and `mariadb` 3.5.3 - local Node API and relational persistence in `server/index.mjs` and `server/database.mjs`.
- `socket.io` / `socket.io-client` 4.8.3 - authenticated live scan status updates between `server/index.mjs` and `src/lib/nodeApi.ts`.
- `fastapi`, `numpy`, `Pillow`, `opencv-python-headless`, `trimesh`, and `rembg[cpu]` - image validation, segmentation, reconstruction, measurements, and GLB output in `ai-service/app/`.

**Infrastructure:**
- `bcryptjs` 3.0.3 - password hashing for the Node/XAMPP-local authentication path in `server/index.mjs`.
- `multer` 2.3.0 - in-memory multipart upload handling in `server/index.mjs`.
- `dotenv` 17.4.2 - loads only Node-specific environment configuration in `server/config.mjs`.
- `python-multipart` `>=0.0.20,<1` and Pydantic `>=2.10,<3` - FastAPI multipart parsing and API models in `ai-service/app/main.py` and `ai-service/app/schemas/api.py`.

## Configuration

**Environment:**
- Browser builds select a backend through `VITE_BACKEND_MODE`, public app origin through `VITE_PUBLIC_APP_URL`, and browser-safe Supabase URL/anon-key variables in `src/lib/supabase.ts`; `vite.config.ts` injects the latter two into the build.
- Node mode reads `.env.node` and `.env.node.local` only in `server/config.mjs`; the files are present in the repository workspace and contain environment configuration.
- The AI service reads deployment variables through `ai-service/app/core/config.py`; only variable names and defaults are documented in source, not secret values.
- Supabase Edge Functions use runtime secrets and configuration accessed through `Deno.env` in `supabase/functions/process-scan/index.ts` and `supabase/functions/_shared/auth.ts`.

**Build:**
- Vite modes emit hosted Supabase output to `dist/`, Node output to `dist-node/`, mobile output to `dist-mobile/`, and XAMPP-compatible relative assets via `vite.config.ts`.
- Vercel builds `npm run build:supabase` and serves `dist/` according to `vercel.json`.
- Type checking includes `src/`, `tests/`, and `vite.config.ts`, excludes Edge Functions, and uses strict compiler options in `tsconfig.json`.
- The AI service Docker image exposes port 8000 and starts Uvicorn from `ai-service/Dockerfile`.

## Platform Requirements

**Development:**
- Node.js/npm for the React/Vite app and optional Node API (`package.json`).
- MariaDB/MySQL for the Node and XAMPP local persistence modes (`server/database.mjs`, `xampp/database/sukatai.sql`).
- Python 3.11+ and pip for `ai-service/`; optional CUDA/MPS/Torch and licensed PIXIE, SMPL-X, and SMPL-Anthropometry assets are detected by `ai-service/app/core/config.py` and documented in `ai-service/MODEL_SETUP.md`.
- Android SDK/Gradle or Xcode is required only when using the Capacitor commands in `package.json`.

**Production:**
- Default hosted frontend target: Vercel (`vercel.json`) with Supabase services and Edge Functions (`supabase/`).
- Alternative self-hosted target: Node API bound locally on port 3001 with MariaDB and local private storage (`server/index.mjs`, `server/config.mjs`).
- Optional containerized reconstruction service: FastAPI/Uvicorn on port 8000 (`ai-service/Dockerfile`).

---

*Stack analysis: 2026-09-01*
