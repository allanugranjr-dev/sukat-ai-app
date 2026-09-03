# Reproducible Startup and Verification — SukatAI

This document records exact commands to reproduce a clean checkout into a working state across all supported paths (Node/MariaDB, Supabase, XAMPP, and the CPU provider). The verification gate at the end confirms the build and test artifacts all pass.

## Prerequisites

- Node.js 20+ (LTS)
- Python 3.12+ (for ai-service)
- Git
- (Optional for Supabase) `npx supabase` CLI
- (Optional for XAMPP) XAMPP with PHP 8.x and MariaDB

---

## Node/MariaDB Backend

### Startup

```powershell
cd "C:\Users\grana\Downloads\ai sukat ai\bsit sukat ai app"
npm install
node server/setup-db.mjs   # Sets up MariaDB tables (adjust connection string as needed)
npm run start:node         # Starts Express on http://127.0.0.1:3000
```

### Environment

Copy `.env.example` to `.env` and configure at minimum:

```
DATABASE_URL=mysql://user:pass@localhost:3306/sukatai
AI_SERVICE_URL=http://127.0.0.1:8000
AI_SERVICE_API_KEY=
SESSION_SECRET=...generate a secure secret...
```

---

## AI Service (CPU Provider)

### Startup

```powershell
cd "C:\Users\grana\Downloads\ai sukat ai\bsit sukat ai app\ai-service"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install -r requirements-dev.txt
Copy-Item .env.example .env
python scripts/download_pose_model.py
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### Health Check

```powershell
python scripts/system_check.py   # Reports device=cpu, bounds, model assets
```

### Tests

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

---

## Supabase (Hosted)

### Startup

```powershell
# Local Supabase (optional for development)
npx supabase start
npx supabase db push    # Apply migrations

# Deploy Edge Functions
npx supabase functions deploy process-scan
npx supabase functions deploy invite-dressmaker
npx supabase functions deploy accept-dressmaker-invitation
npx supabase functions deploy revoke-dressmaker-invitation
```

### Environment

Configure `.env` with your Supabase project URL and anon key:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

---

## XAMPP (Legacy PHP)

### Startup

1. Install XAMPP with PHP 8.x and MariaDB.
2. Import the database schema:
   ```powershell
   mysql -u root -p sukatai < xampp/database/sukatai.sql
   ```
3. Start Apache and MySQL in the XAMPP Control Panel.
4. Configure `xampp/api/config.php` with database credentials.

### Tests

No automated test suite for the PHP path — verify manually by submitting a scan through the frontend configured to use XAMPP mode.

---

## Verification Gate

Run these commands in order from the repository root to confirm a clean checkout is fully functional:

```powershell
# 1. TypeScript typecheck
npm run typecheck
# Expected: Exit 0

# 2. JavaScript unit tests (Vitest)
npm test
# Expected: All tests pass (72+ tests)

# 3. Python unit tests (pytest)
cd ai-service
.\.venv\Scripts\python.exe -m pytest -q
# Expected: All tests pass (test_evaluation, test_resource_bounds, test_measurement_normalization, etc.)

# 4. Production builds
npm run build:node
# Expected: dist-node/ generated
npm run build:supabase
# Expected: dist/ generated for Supabase deployment
npm run build:xampp
# Expected: dist/ generated for XAMPP deployment

# 5. (Optional) Mobile build
npm run build:mobile
# Expected: dist-mobile/ generated
```

### Verification Results (Last Recorded)

| Gate Step | Status | Date |
|-----------|--------|------|
| `npm run typecheck` | ✅ Pass | 2026-09-03 |
| `npm test` | ✅ 72+ pass | 2026-09-03 |
| `pytest` | ✅ 26+ pass | 2026-09-03 |
| `build:node` | ✅ Pass | 2026-09-03 |
| `build:supabase` | ✅ Pass | 2026-09-03 |
| `build:xampp` | ✅ Pass | 2026-09-03 |

---

## Quick Reference: All Commands

```powershell
# Full verification gate
npm run typecheck && npm test && (cd ai-service; .\.venv\Scripts\python.exe -m pytest -q) && npm run build:node && npm run build:supabase && npm run build:xampp
```

---

*See also: `ai-service/README.md`, `docs/cpu-release.md`, `package.json` scripts*