# External Integrations

**Analysis Date:** 2026-09-25

## APIs & External Services

**AI Reconstruction (internal microservice):**
- SukatAI AI Service (FastAPI) - Body scan → mesh + measurements
  - SDK/Client: `server/aiService.mjs` posts to `POST /api/v1/body-scan` (default `http://127.0.0.1:8000`)
  - Auth: `RECONSTRUCTION_API_KEY` / `AI_SERVICE_API_KEY` sent as `Authorization: Bearer` + `X-API-Key`
  - Backend: Anny 0.3.1 + CLAD-Body 0.6.1 + MediaPipe, CPU-only (`ai-service/app/pipeline.py`, `fitting/anny_fitter.py`, `reconstruction/`)

**Email:**
- SMTP via Nodemailer - OTP / account verification (`server/index.mjs`, config in `server/config.mjs`)
  - Auth: `SUKATAI_SMTP_HOST/PORT/USER/PASS/SECURE`
- Resend - Alternate email provider
  - Auth: `RESEND_API_KEY`, sender `SUKATAI_EMAIL_FROM` (default `onboarding@resend.dev`)
  - Provider auto-select: SMTP if creds present, else Resend, else console no-op (surfaces dev OTP)

**SMS:**
- Twilio - SMS notifications
  - Auth: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
  - Auto-selected when SID+token present, else console no-op

## Data Storage

**Databases:**
- MariaDB (`sukatai` schema)
  - Connection: `SUKATAI_DB_HOST/PORT/NAME/USER/PASS` (default `127.0.0.1:3306`, pool limit 10)
  - Client: `mariadb` driver in `server/database.mjs`; PHP PDO mirror in `xampp/api/`
  - Schema: `xampp/database/sukatai.sql`; setup via `server/setup-db.mjs`

**File Storage:**
- Local filesystem only - scan assets under `SUKATAI_STORAGE_DIR` (default `xampp/storage/`), path-traversal guarded in `server/aiService.mjs`; AI output under `OUTPUT_DIR`

**Caching:**
- None (in-memory rate-limit buckets and job maps in `server/index.mjs` only)

## Authentication & Identity

**Auth Provider:**
- Custom, local - session-cookie auth (`sukatai_node`), bcryptjs password hashing, email OTP verification
  - Implementation: `server/index.mjs`, `src/lib/auth.ts`; sliding-window auth rate limiter
  - Legacy Supabase auth removed; `src/lib/supabase.ts` now only exports type shims and backend-mode flags (`VITE_BACKEND_MODE`)

## Monitoring & Observability

**Error Tracking:**
- None detected

**Logs:**
- Console logging; Socket.IO events for scan progress

## CI/CD & Deployment

**Hosting:**
- Self-hosted: Node gateway (`start:node`) or XAMPP/PHP (`xampp:deploy` via `install-xampp.ps1`); mobile via Capacitor
- Smoke/dev scripts: `scripts/live-smoke.mjs`, `scripts/live-roles.mjs`, `scripts/browser-check.mjs`

**CI Pipeline:**
- None detected

## Environment Configuration

**Required env vars:**
- DB: `SUKATAI_DB_HOST/PORT/NAME/USER/PASS` (`SUKATAI_DB_PASS` mandatory in production)
- AI: `RECONSTRUCTION_API_URL`/`AI_SERVICE_URL`, `RECONSTRUCTION_API_KEY`/`AI_SERVICE_API_KEY`, `RECONSTRUCTION_BACKEND`
- Web/security: `SUKATAI_WEB_ORIGINS`, `SUKATAI_COOKIE_SECURE`, `SUKATAI_TRUST_PROXY`, `SUKATAI_ENV`/`APP_ENV`
- Notifications: `SUKATAI_SMTP_*`, `RESEND_API_KEY`, `TWILIO_*`

**Secrets location:**
- `.env.node` / `.env.node.local` (Node), `.env.xampp` (PHP), `.env.mobile` (Capacitor); contents not read

## Webhooks & Callbacks

**Incoming:**
- None detected

**Outgoing:**
- Node gateway → AI service `POST /api/v1/body-scan` (internal, timeout 600s, max model 25MB)

---

*Integration audit: 2026-09-25*
