# SukatAI

SukatAI is a measurement workspace for customers, dressmakers, and administrators. Customers create private scans from front, side, and back photos. The primary local runtime is Node.js + MariaDB + Socket.IO; Supabase remains an optional hosted runtime.

## Requirements

- Node.js 20 or newer
- XAMPP MariaDB, when using the Node.js local runtime
- A Supabase project and CLI only when using the optional Supabase runtime
- A reconstruction provider is optional for local development; the local deterministic simulator is used by default

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

`draft` → `uploaded` → `processing_queued` → `processing` → `ready_for_review` → `verified`

The review workflow can move a result to `needs_recapture`, and provider failures use `failed`. The browser only advances after a database write. It never invents measurement values, confidence, photos, or model assets.

Each upload is validated as JPG, PNG, or WebP and must be under 10 MB. The file is written to the private `scan-captures` bucket, then its path and metadata are recorded in `scan_assets`. Camera frames use the same Storage path as file uploads.

`process-scan` requires all three view types. An explicit `RECONSTRUCTION_PROVIDER=local` setting—or an otherwise unconfigured request—uses a deterministic simulator. It writes clearly labeled demo measurements derived from the height reference and attaches the local reference visual (`public/media/3d-body-scan-reference-v3.png`) for the interactive 3D viewer, then moves the scan to `ready_for_review`. The procedural model and reference image are not a personalized scan or reconstruction; values must be checked by a dressmaker before tailoring.

The results viewer uses a lightweight Three.js scene rather than a 3D video. Users can drag to rotate the mannequin, scroll or pinch to zoom, reset the camera, pause auto-rotation, and show or hide measurement guides. The local reference image is also shown as the WebGL fallback/reference thumbnail for devices that cannot render the scene.

For production-quality personalized results, configure a real provider. Until then, the hosted function uses the clearly labeled local demo fallback so scans can complete without getting stuck in the queue. When a provider is configured, the function creates short-lived signed URLs for the private views, sends the scan metadata and URLs, validates the response, writes measurements and an optional body-model asset, and sets the scan to `ready_for_review`. Invalid or failed provider responses set `failed` with a reason.

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

It must return at least one valid measurement:

```json
{
  "processing_version": "provider-version",
  "measurements": [
    { "key": "chest", "value": 92.4, "unit": "cm", "confidence": 91.2 }
  ],
  "body_model": {
    "path": "organization/customer/scan/model.glb",
    "preview_path": "organization/customer/scan/preview.webp"
  }
}
```

The body-model path should point to the private `body-models` bucket. Measurement keys, positive values, units, and confidence ranges are validated before persistence.

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

If the provider values are left as `console`, the app still stores the invitation/order notification and shows it in the app, but it reports external delivery as `not_configured` instead of pretending a message was sent. Restart `npm run start:node` after changing the server environment.

Create a versioned local backup of the MariaDB database and scan storage with:

    npm run node:backup

Backups are written to backups/ by default. Set SUKATAI_BACKUP_DIR to place them on a separate drive. The backup command uses C:\xampp\mysql\bin\mysqldump.exe on Windows and can be pointed at another dump binary with SUKATAI_DB_DUMP_BIN.

The Node local processor uses the same clearly labeled deterministic demo reconstruction as the other local runtimes. It does not call Imagen or an external reconstruction provider.

## XAMPP runtime

The project also includes an opt-in PHP/MySQL runtime for Apache and XAMPP. Start Apache and MySQL, import `xampp/database/sukatai.sql` in phpMyAdmin, then run:

```powershell
npm run build:xampp
npm run xampp:deploy
```

Open `http://localhost/bsit-sukat-ai/`. The deployment target is intentionally separate from any existing `C:\xampp\htdocs\sukatai` site. See `xampp/README.md` for admin-role setup and development mode.

## Android mobile app (APK)

The Android app is a Capacitor shell around the same React screens and API contracts. It keeps the camera/upload flow, responsive measurement viewer, Supabase Auth, private Storage, and role-based workrooms in one codebase.

Before building for a phone, create `.env.mobile.local` from `.env.mobile.example` and provide the public Supabase URL and anon key. The mobile build uses the hosted Supabase runtime and the production invitation redirect; it must not point to `127.0.0.1` or `localhost`, because those addresses refer to the phone itself.

```powershell
Copy-Item .env.mobile.example .env.mobile.local
# Edit .env.mobile.local with your public Supabase values.
npm run mobile:apk
```

The debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. Install it on a connected Android phone with Android Studio, or with `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`. Use `npm run mobile:run` when an emulator or USB-debugging device is available.

The Android package id is `com.sukatai.app`. Before distributing it publicly, configure a release signing key, verify Supabase redirect URLs for the hosted app, deploy the required Edge Functions, and test camera permissions on a real device.

## iOS mobile app

The same Capacitor web app is also prepared for iOS with bundle id `com.sukatai.app`, light system bars, safe-area-aware layout, and camera/photo-library usage descriptions in `ios/App/App/Info.plist`. iOS packaging and signing require macOS with Xcode.

```bash
npm run mobile:sync:ios
npm run mobile:open:ios
```

Run those commands on macOS, select an Apple development team in Xcode, and test the camera permission flow on a physical iPhone. The Windows checkout can typecheck and generate the iOS project, but cannot build or sign an iOS app without Xcode.

## Useful commands

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The tests cover scan navigation, upload/height guardrails, and measurement-to-model mapping. The production boundary is enforced by Supabase RLS, private Storage policies, and server-side Edge Function secrets. Before a release, run `npm run typecheck`, `npm test`, and the build command for the selected runtime (`npm run build:node`, `npm run build:supabase`, or `npm run build:xampp`).

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
