---
quick_id: 260902-uv6
description: Make customer result sharing manual
status: complete
completed: 2026-09-02
---

# Quick Task Summary

Changed provider completion to stop at a private `ready_to_share` state. The customer results screen now opens for that state with an enabled “Send to dressmaker for review” action; the existing click moves the scan to `ready_for_review`. Node, XAMPP, and Supabase organization access now expose scan data, private assets, measurement updates, and review events to dressmakers only after that explicit share transition. Existing `ready_for_review` and `verified` records remain shared.

## Files changed

- `src/App.tsx`
- `src/lib/types.ts`
- `src/lib/reconstructionProvider.ts`
- `server/index.mjs`
- `xampp/api/index.php`
- `supabase/functions/process-scan/index.ts`
- `supabase/migrations/20260902010000_add_ready_to_share_status.sql`
- `supabase/migrations/20260902020000_manual_scan_sharing.sql`
- `README.md`
- `docs/body-measurement-pipeline-plan.md`

## Verification

- `npm run typecheck` — passed
- `npm test -- --run` — passed (7 files, 31 tests)
- `npm run build` — passed
- `git diff --check` — passed
- Node API health — passed (`backend: node`, `database: mariadb`, `realtime: socket.io`)
- PHP lint — skipped because PHP is not installed in this environment

The open local browser is pointed at `http://127.0.0.1:5173/`. Existing local records were not rewritten; the screenshot’s older `ready_for_review` record therefore remains correctly marked as already sent.
