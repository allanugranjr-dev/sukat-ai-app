# SukatAI

SukatAI is a measurement workspace for customers, dressmakers, and administrators. Customers create private scans from front and side photos, with an optional back reference. The primary local runtime is Node.js + MariaDB + Socket.IO; Supabase remains an optional hosted runtime.

## Requirements

- Node.js 20 or newer
- XAMPP MariaDB, when using the Node.js local runtime
- A Supabase project and CLI only when using the optional Supabase runtime
- The CPU-only `ai-service` provider for local body-scan processing

## Run the application

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start MariaDB in XAMPP, then initialize the Node schema and start the API:

   ```bash
   npm run node:setup
   npm run build:node
   npm run start:node
   ```

3. In a second terminal, start the Vite frontend:

   ```bash
   npm run dev
   ```

   The default `dev` and `build` scripts use Node mode, so the app does not show the Supabase setup screen. Use `npm run dev:supabase` or `npm run build:supabase` only for the optional Supabase runtime.

For the optional Supabase runtime, copy `.env.example` to `.env.local` and fill in the two public Supabase values. The service-role and reconstruction values are server-side secrets and must not be exposed to Vite. `VITE_BACKEND_MODE`, `VITE_NODE_API_URL`, and `VITE_XAMPP_API_URL` are optional browser-side overrides; do not put credentials in them.

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   SUPABASE_SERVICE_ROLE_KEY=
   RECONSTRUCTION_PROVIDER=
   RECONSTRUCTION_API_URL=
   RECONSTRUCTION_API_KEY=
   ```

## Supabase setup

Link the project, apply the migration, and deploy the three Edge Functions:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy invite-dressmaker
supabase functions deploy accept-dressmaker-invitation
supabase functions deploy process-scan
```

Configure the Edge Function secrets in the Supabase dashboard or CLI. The browser must never receive these values:

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
supabase secrets set RECONSTRUCTION_PROVIDER=YOUR_PROVIDER_NAME
supabase secrets set RECONSTRUCTION_API_URL=https://provider.example/v1/reconstruct
supabase secrets set RECONSTRUCTION_API_KEY=YOUR_PROVIDER_KEY
supabase secrets set INVITATION_ALLOWED_ORIGINS=https://your-frontend.example.com
```

`INVITATION_ALLOWED_ORIGINS` is required by the invitation function and accepts a comma-separated list of exact frontend origins. Keep it server-side; it prevents invitation links from redirecting to an untrusted site.

For a hosted Supabase project, also open **Authentication → URL Configuration** and set the **Site URL** to `https://sukat-ai-app.vercel.app`. Add `https://sukat-ai-app.vercel.app/**` to the redirect allow list. If the hosted **Invite user** email template was customized, make its button link `{{ .ConfirmationURL }}`; do not hard-code `{{ .SiteURL }}` or a localhost URL. The template in `supabase/templates/invite.html` is the reference version. These hosted settings are separate from the local `supabase/config.toml` file.

Invitation emails already sent cannot be repaired because their redirect is embedded in the existing message. Create a new invitation after changing the hosted settings.

The migration creates:

- `profiles`, `organizations`, and `dressmaker_invitations`
- `scans` and `scan_assets`
- `body_models`, `measurements`, and `measurement_review_events`
- `orders`, `fittings`, and `notifications`
- `notification_deliveries` for idempotent email/SMS delivery attempts
- private `scan-captures` and `body-models` Storage buckets
- Auth profile creation, timestamp, and privilege-protection triggers
- RLS policies for customer ownership, organization-scoped dressmaker access, and administrator access

Keep the Storage buckets private. The application reads photos through short-lived signed URLs after the database and Storage policies authorize the request.

## Authentication and roles

Customer registration is public and always creates the `customer` role through the `handle_new_user` trigger. Email verification is handled by Supabase Auth. Sign-in, sign-out, session persistence, password reset, and recovery-password updates use the Supabase browser client.

Dressmaker registration is not public. An administrator selects an organization and invokes `invite-dressmaker`. The function hashes a cryptographically random token, records it in `dressmaker_invitations`, and sends a Supabase Auth invitation. The recipient follows the invitation, sets a password, and the acceptance function assigns the `dressmaker` role and organization. The function verifies the email, token, expiry, and one-time acceptance server-side.

Administrators can create organizations, invite dressmakers, and inspect records permitted by the RLS policies. No client-controlled role selector is used.

## Scan lifecycle

Scans move through these persisted states:

`draft` → `uploaded` → `processing_queued` → `processing` → `ready_to_share` → `ready_for_review` → `verified`

The review workflow can move a result to `needs_recapture`, and provider failures use `failed`. The browser only advances after a database write. It never invents measurement values, confidence, photos, or model assets.

Each upload is validated as JPG, PNG, or WebP and must be under 10 MB. The file is written to the private `scan-captures` bucket, then its path and metadata are recorded in `scan_assets`. Camera frames use the same Storage path as file uploads.

`process-scan` requires the front and side view types; the back view remains optional diagnostic context. The Node and Supabase runtimes require an explicitly configured reconstruction provider and fail truthfully when one is missing. The old XAMPP reference-result path is retained only as a compatibility path and is not the active personalized scanner. No sample values are published as a provider result.

The results viewer uses a lightweight Three.js scene rather than a 3D video. Users can drag to rotate the mannequin, scroll or pinch to zoom, reset the camera, pause auto-rotation, and show or hide measurement guides. The local reference image is also shown as the WebGL fallback/reference thumbnail for devices that cannot render the scene.

For production-quality personalized results, configure a real provider. The hosted function marks a scan as failed with an actionable provider-not-configured reason until a provider is configured (or explicit demo mode is enabled for a local/test project), so it does not silently publish sample values. When a provider is configured, the function creates short-lived signed URLs for the private views, sends the scan metadata and URLs, validates the response, writes measurements and an optional body-model asset, and sets the scan to `ready_to_share`. The customer can then review the result and explicitly share it, moving it to `ready_for_review`; invalid or failed provider responses set `failed` with a reason.

### Provider response contract

The configured endpoint receives JSON like:

```json
{
  "scan_id": "uuid",
  "height_value": 170,
  "height_unit": "cm",
  "assets": [
    { "asset_type": "front", "url": "signed-url", "metadata": {} },
    { "asset_type": "side", "url": "signed-url", "metadata": {} },
    { "asset_type": "back", "url": "signed-url", "metadata": {} }
  ]
}
```

It must return a valid measurement set and a readable GLB model:

```json
{
  "processing_version": "provider-version",
  "measurements": [
    { "key": "chest", "value": 92.4, "unit": "cm", "method": "mesh", "source": "provider-name", "confidence": null }
  ],
  "body_model": {
    "path": "organization/customer/scan/model.glb",
    "preview_path": "organization/customer/scan/preview.webp"
  }
}
```

The body-model path should point to the private `body-models` bucket. A
measurement-only response is rejected and cannot become a completed scan.
Measurement keys, positive values, units, method/source provenance, and
confidence ranges are validated before persistence. A missing confidence stays
unreported rather than becoming a zero or accuracy percentage.

## Node.js + MariaDB + Socket.IO runtime

The primary local full-stack runtime is now Node.js for the API, MariaDB for persistent data, and Socket.IO for live scan-processing updates. XAMPP is still useful for its bundled MariaDB server; Apache is not required when running the Node server.

Start MySQL in the XAMPP Control Panel, then run the following from the project root:

    npm run node:setup
    npm run build:node
    npm run start:node

Open http://127.0.0.1:3001/. The Node server serves the built React app, the /api routes, private scan assets, and Socket.IO from one process.

For frontend development with hot reload, use two terminals:

    npm run start:node
    npm run dev:node

The Vite development app runs at http://127.0.0.1:5173/ and connects to the Node API on port 3001. The Node server automatically applies the local schema from xampp/database/sukatai.sql and creates the persistent sessions table.

### Email invitations and order-ready text messages

Administrators can send dressmaker invitations by email from the Invitations screen. Customers can add an international-format mobile number and opt in to email or SMS order-ready updates from their Profile screen. When an order changes to `ready_for_pickup`, SukatAI creates one in-app notification and makes at most one delivery attempt per channel.

The Node runtime uses Resend for email and Twilio for SMS. Keep these values in the server-only `.env.node.local` file; never put provider keys in Vite variables or commit them:

    SUKATAI_EMAIL_PROVIDER=resend
    RESEND_API_KEY=re_...
    SUKATAI_EMAIL_FROM=SukatAI <noreply@your-domain.com>
    SUKATAI_SMS_PROVIDER=twilio
    TWILIO_ACCOUNT_SID=AC...
    TWILIO_AUTH_TOKEN=...
    TWILIO_FROM_NUMBER=+1...
    SUKATAI_PUBLIC_APP_URL=https://your-frontend.example.com

Alternatively, the Node runtime can send email through any SMTP server (for example a Gmail account with an App Password) instead of Resend. Set the SMTP values in the same server-only `.env.node.local` file; when `SUKATAI_SMTP_HOST`, `SUKATAI_SMTP_USER`, and `SUKATAI_SMTP_PASS` are all present the provider auto-selects `smtp` without needing `SUKATAI_EMAIL_PROVIDER`:

    SUKATAI_SMTP_HOST=smtp.gmail.com
    SUKATAI_SMTP_PORT=587
    SUKATAI_SMTP_USER=you@gmail.com
    SUKATAI_SMTP_PASS=your-16-char-app-password
    SUKATAI_EMAIL_FROM=SukatAI <you@gmail.com>

Port 587 uses STARTTLS and port 465 uses implicit TLS automatically; set `SUKATAI_SMTP_SECURE=true|false` only to override. Gmail rejects a `From` that is not the authenticated mailbox, so if `SUKATAI_EMAIL_FROM` is omitted the sender defaults to `SUKATAI_SMTP_USER`. To create the App Password: enable 2-Step Verification on the Google account, open Google Account → Security → App passwords, generate one for "Mail", and paste the 16-character value (spaces removed) as `SUKATAI_SMTP_PASS`. Never commit `.env.node.local`; it is git-ignored.

The per-IP throttle on auth endpoints keys on the real socket address by default. Only set `SUKATAI_TRUST_PROXY=true` when a reverse proxy that overwrites `X-Forwarded-For` sits in front of the Node server; leaving it off (the default) prevents a directly-exposed server from trusting a client-spoofed header. When marking a deployment production, set either `NODE_ENV=production` or `SUKATAI_ENV=production` — both put the Node runtime in production mode (which stops the OTP dev code from ever being returned in an API response).

New customers must confirm a 6-digit code emailed to them before their account is usable. When no email provider is configured (`console`), the confirmation screen still works: the code is returned in the API response and shown on screen, but only outside production — so signups remain testable with zero email setup. Once SMTP or Resend is configured the code is emailed and never revealed on screen.

If the provider values are left as `console`, the app still stores the invitation/order notification and shows it in the app, but it reports external delivery as `not_configured` instead of pretending a message was sent. Restart `npm run start:node` after changing the server environment.

Create a versioned local backup of the MariaDB database and scan storage with:

    npm run node:backup

Backups are written to backups/ by default. Set SUKATAI_BACKUP_DIR to place them on a separate drive. The backup command uses C:\xampp\mysql\bin\mysqldump.exe on Windows and can be pointed at another dump binary with SUKATAI_DB_DUMP_BIN.

The Node local processor calls the configured CPU-only `ai-service` provider. Set `RECONSTRUCTION_PROVIDER=ai-service`, `RECONSTRUCTION_API_URL=http://127.0.0.1:8000`, and the matching server-only API key before starting Node. If the provider is absent or fails, the scan is marked failed and no sample measurements are saved.

## XAMPP runtime

The project also includes an opt-in PHP/MySQL runtime for Apache and XAMPP. Start Apache and MySQL, import `xampp/database/sukatai.sql` in phpMyAdmin, then run:

```powershell
npm run build:xampp
npm run xampp:deploy
```

Open `http://localhost/bsit-sukat-ai/`. The deployment target is intentionally separate from any existing `C:\xampp\htdocs\sukatai` site. See `xampp/README.md` for admin-role setup and development mode.

## Useful commands

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The tests cover scan navigation, upload/height guardrails, and measurement-to-model mapping. Before a release, run `npm run typecheck`, `npm test`, and the build command for the selected runtime (`npm run build:node` or `npm run build:xampp`).

## Image-based AI measurement service

The isolated `ai-service/` package provides the active FastAPI contract for MediaPipe Lite validation, height calibration, bounded CPU Anny fitting, CLAD-Body measurements, and GLB export. The existing Node gateway connects to it with server-only values in `.env.node.local`:

```dotenv
RECONSTRUCTION_PROVIDER=ai-service
RECONSTRUCTION_API_URL=http://127.0.0.1:8000
RECONSTRUCTION_TIMEOUT_MS=600000
AI_SERVICE_API_KEY=local-only
```

Download the small pose asset once, then start it from the repository root in a second terminal:

```powershell
if (-not (Test-Path ai-service/.venv/Scripts/python.exe)) { python -m venv ai-service/.venv }
& ai-service/.venv/Scripts/python.exe -m pip install -r ai-service/requirements-dev.txt
& ai-service/.venv/Scripts/python.exe ai-service/scripts/download_pose_model.py
& ai-service/.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir ai-service --host 127.0.0.1 --port 8000
```

Run `& ai-service/.venv/Scripts/python.exe -m pytest ai-service/tests -q` and `& ai-service/.venv/Scripts/python.exe ai-service/scripts/system_check.py` before using it. Licensed PIXIE/SMPL-X model files and a compatible runner are intentionally not bundled; see [ai-service/MODEL_SETUP.md](ai-service/MODEL_SETUP.md) and [ai-service/ARCHITECTURE.md](ai-service/ARCHITECTURE.md).

## Project layout

```text
src/App.tsx                         Role-aware UI and guided scan workflow
src/lib/auth.ts                     Supabase Auth, invitations, profiles, notifications
src/lib/data.ts                     Supabase queries and mutations
src/lib/storage.ts                  Private scan upload and signed asset access
src/lib/reconstructionProvider.ts   Processing request boundary and statuses
src/lib/scanFlow.ts                 Pure scan-flow validation helpers
src/lib/types.ts                    Application data types and status labels
src/lib/supabase.ts                 Public client configuration guard
src/lib/nodeApi.ts                  Node API and Socket.IO browser adapter
server/index.mjs                    Node.js API, MariaDB actions, and Socket.IO server
server/database.mjs                 MariaDB pool, schema bootstrap, and transactions
server/backup.mjs                    Local database and scan-storage backup
supabase/migrations/                Schema, triggers, RLS, and private buckets
supabase/functions/                 Server-side invitation and provider functions
tests/                              Pure workflow tests
```
