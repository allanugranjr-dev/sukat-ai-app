# Technology Stack

**Analysis Date:** 2026-09-25

## Languages

**Primary:**
- TypeScript (ES2022, strict) - Frontend SPA in `src/` and `tsconfig.json`
- JavaScript (ESM `.mjs`) - Node.js API gateway in `server/`
- Python 3.11+ (3.12+ for CLAD) - AI reconstruction service in `ai-service/app/`

**Secondary:**
- PHP - Alternate XAMPP API runtime in `xampp/api/` (`index.php`, `config.php`, `mailer.php`)
- SQL (MariaDB) - Schema in `xampp/database/sukatai.sql`
- PowerShell - XAMPP deploy script `xampp/install-xampp.ps1`

## Runtime

**Environment:**
- Node.js (ESM, `"type": "module"`) - API gateway `server/index.mjs`, raw `node:http` + Express
- Python/uvicorn - FastAPI AI service (`py -3.11 -m uvicorn app.main:app --port 8000`)
- Browser - Vite-built React SPA
- Capacitor 8.5.0 - Native Android/iOS wrapper (`@capacitor/android`, `@capacitor/ios`)

**Package Manager:**
- npm - Lockfile: `package-lock.json` present (v0.1.0, `sukatai`)
- pip - `ai-service/requirements.txt`, `ai-service/requirements-dev.txt`

## Frameworks

**Core:**
- React (latest) + react-dom - SPA UI (`src/App.tsx`, `src/main.tsx`)
- Express 5.2.1 - Node HTTP API and static serving
- FastAPI (>=0.115,<1) - Python AI service (`ai-service/app/main.py`)
- Three.js 0.185.1 - 3D body mesh rendering

**Testing:**
- Vitest (latest) - Frontend/Node tests (`npm test` → `vitest run`, config in `tsconfig.json` types)
- pytest (>=8.3,<9) + httpx - Python service tests (`requirements-dev.txt`)

**Build/Dev:**
- Vite (latest) + `@vitejs/plugin-react` - Bundler with multi-mode builds (`vite.config.ts`: node/xampp/mobile)
- TypeScript compiler (`tsc --noEmit`) - Type-check / lint step

## Key Dependencies

**Critical:**
- `mediapipe` 1.0.1 - Pose landmark detection (CPU-only body scan)
- `clad-body` 0.6.1 - CLAD-Body fitted-body reconstruction (pinned; requires Python 3.12+)
- `anny` 0.3.1 - Parametric human body model (pinned; later releases dropped pose params). Note: gender=0.0 is MALE, 1.0 FEMALE
- `trimesh` (>=4.6,<5) - Mesh processing/export
- `opencv-python-headless`, `numpy`, `scipy`, `Pillow`, `pydantic` - Imaging/math/validation
- `three` 0.185.1 - Client 3D mesh viewer

**Infrastructure:**
- `mariadb` 3.5.3 - Node DB driver (`server/database.mjs`)
- `bcryptjs` 3.0.3 - Password hashing
- `nodemailer` 10.0.10 - SMTP email (OTP verification)
- `multer` 2.3.0 - Multipart upload handling
- `socket.io` / `socket.io-client` 4.8.3 - Real-time scan progress
- `dotenv` 17.4.2 - Env loading (`.env.node`, `.env.node.local`)

## Configuration

**Environment:**
- Multiple env files present (contents not read): `.env.example`, `.env.local`, `.env.mobile(.example)`, `.env.node`, `.env.node.local`, `.env.xampp`
- Node config: `server/config.mjs` — `SUKATAI_DB_*`, `SUKATAI_WEB_ORIGINS`, `SUKATAI_SMTP_*`, `RESEND_API_KEY`, `TWILIO_*`, `RECONSTRUCTION_*`, cookie/proxy flags; fails fast in production without `SUKATAI_DB_PASS`
- AI config: `ai-service/app/core/config.py` — `SUKATAI_AI_MODE`, `RECONSTRUCTION_BACKEND` (default `anny_clad`), `AI_SERVICE_API_KEY`, `ALLOWED_ORIGINS`, model dirs, `MEASUREMENT_CALIBRATION_JSON`; device hard-locked to `cpu`

**Build:**
- `vite.config.ts` - Modes: node (`dist-node`), xampp (`./` base, `dist`), mobile (`dist-mobile` + asset copy plugin)
- `tsconfig.json` - ES2022, bundler resolution, react-jsx, vitest globals, excludes `supabase/functions`

## Platform Requirements

**Development:**
- Node.js (ESM), Python 3.11/3.12, npm, optional XAMPP (MariaDB + PHP)
- Windows-oriented tooling (PowerShell deploy, `py -3.11` launcher)

**Production:**
- Supported target: Intel integrated-GPU laptop, CPU-only inference (never auto-select CUDA)
- Two interchangeable API runtimes: Node.js gateway or XAMPP/PHP; MariaDB backing store; native mobile via Capacitor

---

*Stack analysis: 2026-09-25*
