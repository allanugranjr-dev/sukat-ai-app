# External Integrations

**Analysis Date:** 2026-09-01

## APIs & External Services

**Backend-as-a-service:**
- Supabase - default hosted application backend: Auth, Postgres, Storage, and Edge Functions are called from `src/lib/supabase.ts`, `src/lib/auth.ts`, `src/lib/data.ts`, `src/lib/storage.ts`, and `src/lib/reconstructionProvider.ts`.
  - SDK/Client: `@supabase/supabase-js` in `src/lib/supabase.ts` and Edge Function CDN import in `supabase/functions/_shared/auth.ts`.
  - Auth: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for browser access in `src/lib/supabase.ts`; service-side Supabase credentials are obtained via Deno runtime configuration in `supabase/functions/_shared/auth.ts`.

**Body-scan reconstruction:**
- Configured reconstruction provider / local FastAPI AI service - receives scan images and height, returns measurements and a GLB body model. The Node adapter is `server/aiService.mjs`; hosted Supabase invocation and validation is `supabase/functions/process-scan/index.ts`; the built-in provider API is `ai-service/app/main.py`.
  - SDK/Client: native `fetch`, multipart `FormData`, and `Blob` in `server/aiService.mjs` and `supabase/functions/process-scan/index.ts`.
  - Auth: `RECONSTRUCTION_API_KEY` or `AI_SERVICE_API_KEY`; the FastAPI service accepts Bearer or `X-API-Key` in `ai-service/app/main.py`.
  - Endpoint: `POST /api/v1/body-scan` on `ai-service/app/main.py`; Node defaults to a local provider at port 8000 when `ai-service` is selected in `server/aiService.mjs`.

**Email delivery (optional Node runtime):**
- Resend - sends invitation and notification email from `server/index.mjs` to `https://api.resend.com/emails`.
  - SDK/Client: native `fetch` in `server/index.mjs`.
  - Auth: `RESEND_API_KEY`; provider/from-address selection is in `server/config.mjs`.

**SMS delivery (optional Node runtime):**
- Twilio - sends order-ready SMS from `server/index.mjs` through the Twilio Messages REST API.
  - SDK/Client: native `fetch` and `URLSearchParams` in `server/index.mjs`.
  - Auth: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` in `server/config.mjs`.

**Native mobile:**
- Capacitor - packages the browser app for Android and iOS from `capacitor.config.ts` and the `android/`/`ios/` native projects.
  - SDK/Client: `@capacitor/core`, `@capacitor/android`, and `@capacitor/ios` in `package.json`.
  - Auth: inherits the selected browser backend; no native-specific credential integration is detected in `capacitor.config.ts`.

## Data Storage

**Databases:**
- Supabase Postgres - hosted schema, RLS policies, and migrations in `supabase/migrations/`; client access is mediated by `src/lib/data.ts` and `src/lib/auth.ts`.
  - Connection: public Supabase URL configured in `src/lib/supabase.ts`.
  - Client: `@supabase/supabase-js` in `src/lib/supabase.ts`.
- MariaDB/MySQL - optional Node and XAMPP local storage using `server/database.mjs` and `xampp/database/sukatai.sql`.
  - Connection: `SUKATAI_DB_HOST`, `SUKATAI_DB_PORT`, `SUKATAI_DB_NAME`, `SUKATAI_DB_USER`, and `SUKATAI_DB_PASS` in `server/config.mjs`.
  - Client: `mariadb` package in `server/database.mjs`; PHP PDO-style access in `xampp/api/index.php`.

**File Storage:**
- Supabase Storage - private `scan-captures` and `body-models` buckets are used by `src/lib/storage.ts` and `supabase/functions/process-scan/index.ts`; browser access uses short-lived signed URLs.
- Local filesystem - Node/XAMPP storage defaults under `xampp/storage` via `server/config.mjs`; Node stores downloaded model artifacts there in `server/aiService.mjs`.
- AI-service filesystem - generated GLB artifacts are written to `OUTPUT_DIR`, while uploaded photos are only processed in memory, per `ai-service/app/main.py` and `ai-service/README.md`.

**Caching:**
- No shared cache service is detected. Supabase Storage upload calls set `cacheControl: "3600"` in `src/lib/storage.ts` and `supabase/functions/process-scan/index.ts`.

## Authentication & Identity

**Auth Provider:**
- Supabase Auth - email/password sessions, confirmation, password reset, invitation, and role-aware profile workflows in `src/lib/auth.ts`; Edge Functions validate request Bearer tokens in `supabase/functions/_shared/auth.ts`.
  - Implementation: browser session persistence/autorefresh is set in `src/lib/supabase.ts`; database policy enforcement lives in `supabase/migrations/`.
- Custom local sessions - Node mode hashes passwords with `bcryptjs`, persists hashed session tokens in MariaDB, and authenticates Socket.IO connections through cookies in `server/index.mjs` and `server/database.mjs`.
- XAMPP fallback authentication - PHP API implementation in `xampp/api/index.php`.

## Monitoring & Observability

**Error Tracking:**
- None detected in `package.json`, `server/`, `src/`, or `ai-service/`.

**Logs:**
- Node runtime writes startup/runtime information to stdout in `server/index.mjs`.
- FastAPI/Uvicorn provides service-process logging from `ai-service/Dockerfile` and `ai-service/app/main.py`; public health diagnostics are exposed at `GET /health`.

## CI/CD & Deployment

**Hosting:**
- Vercel hosts the default static frontend build, configured in `vercel.json`.
- Supabase hosts the database, storage, Auth, and Edge Functions defined in `supabase/`.
- Docker can host the AI service defined by `ai-service/Dockerfile`.
- Node/MariaDB and Apache/XAMPP are alternate local/self-hosted runtimes described in `README.md` and `xampp/README.md`.

**CI Pipeline:**
- Not detected; no repository-owned workflow configuration is present outside installed dependency directories.

## Environment Configuration

**Required env vars:**
- Hosted browser/Supabase mode: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and optional `VITE_BACKEND_MODE`/`VITE_PUBLIC_APP_URL`, referenced by `src/lib/supabase.ts` and `vite.config.ts`.
- Node/MariaDB mode: `PORT`, `SUKATAI_DB_HOST`, `SUKATAI_DB_PORT`, `SUKATAI_DB_NAME`, `SUKATAI_DB_USER`, `SUKATAI_DB_PASS`, `SUKATAI_STORAGE_DIR`, `SUKATAI_WEB_ORIGINS`, `SUKATAI_COOKIE_SECURE`, and `SUKATAI_COOKIE_SAMESITE`, read in `server/config.mjs`.
- Node reconstruction integration: `RECONSTRUCTION_PROVIDER`, `RECONSTRUCTION_API_URL` or `AI_SERVICE_URL`, `RECONSTRUCTION_API_KEY` or `AI_SERVICE_API_KEY`, `RECONSTRUCTION_TIMEOUT_MS`, and `RECONSTRUCTION_MAX_MODEL_BYTES`, read in `server/config.mjs`.
- Node messaging: `SUKATAI_EMAIL_PROVIDER`, `RESEND_API_KEY`, `SUKATAI_EMAIL_FROM`, `SUKATAI_SMS_PROVIDER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, and `SUKATAI_PUBLIC_APP_URL`, read in `server/config.mjs`.
- AI service: `DEVICE`, `RECONSTRUCTION_BACKEND`, `SMPLX_MODEL_DIR`, `PIXIE_MODEL_DIR`, `ANTHROPOMETRY_DIR`, `OUTPUT_DIR`, `MAX_UPLOAD_BYTES`, `AI_SERVICE_API_KEY`, and `ALLOWED_ORIGINS`, read in `ai-service/app/core/config.py`.
- Hosted processing: `RECONSTRUCTION_PROVIDER`, `RECONSTRUCTION_API_URL`, `RECONSTRUCTION_API_KEY`, `RECONSTRUCTION_ALLOW_DEMO`, `RECONSTRUCTION_API_FORMAT`, `RECONSTRUCTION_TIMEOUT_MS`, and `RECONSTRUCTION_MAX_MODEL_BYTES`, read in `supabase/functions/process-scan/index.ts`.

**Secrets location:**
- Local Node settings are loaded server-side from `.env.node` and `.env.node.local` by `server/config.mjs`; these environment files exist and are not inspected.
- Browser-safe Supabase configuration is injected by Vite from environment settings in `vite.config.ts`.
- Supabase Edge Function secrets are read at runtime with `Deno.env` in `supabase/functions/_shared/auth.ts` and `supabase/functions/process-scan/index.ts`.
- AI-service secrets are deployment environment variables read in `ai-service/app/core/config.py`; licensed model files are external to Git according to `ai-service/MODEL_SETUP.md`.

## Webhooks & Callbacks

**Incoming:**
- Supabase Edge Function requests: `process-scan`, `invite-dressmaker`, `accept-dressmaker-invitation`, and `revoke-dressmaker-invitation` in `supabase/functions/`.
- Node REST API plus Socket.IO connection endpoint are served from `server/index.mjs`; client requests and subscriptions originate in `src/lib/nodeApi.ts`.
- FastAPI body-scan endpoints are in `ai-service/app/main.py`, including `POST /api/v1/body-scan` and authenticated result/model routes.
- XAMPP HTTP API fallback is `xampp/api/index.php`.

**Outgoing:**
- Reconstruction POST requests and same-origin GLB downloads originate in `server/aiService.mjs` and `supabase/functions/process-scan/index.ts`.
- Resend email calls and Twilio SMS calls originate in `server/index.mjs`.
- No inbound third-party webhooks are detected in `server/`, `supabase/functions/`, or `ai-service/app/`.

---

*Integration audit: 2026-09-01*
