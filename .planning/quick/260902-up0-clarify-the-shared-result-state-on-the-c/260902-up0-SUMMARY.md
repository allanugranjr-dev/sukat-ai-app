---
quick_id: 260902-up0
description: Clarify the shared result state on the customer results screen
status: complete
completed: 2026-09-02
---

# Quick Task Summary

Updated the customer scan-results action area to make the existing organization-scoped sharing state explicit. Results in `ready_for_review` or `verified` state now show a check-marked message explaining that the result is shared with the dressmaker and directing the recipient to the Reviews workspace. Results that are not shared retain the existing send action and pre-share guidance.

## Files changed

- `src/App.tsx`
- `src/styles.css`

## Verification

- `npm run typecheck` — passed
- `npm test` — passed (7 files, 31 tests)
- `npm run build` — passed
- `git diff --check` — passed

No authentication, organization scope, scan status, or backend route was changed. The local Node API and MariaDB health check also returned successfully during verification.
