---
quick_id: 260902-uv6
status: human_needed
score: 5/5
---

# Verification

## Automated checks

- Must-have: provider completion no longer auto-shares — verified by `ready_to_share` writes in Node, XAMPP, and the Supabase promotion function.
- Must-have: customer explicitly initiates sharing — verified by the existing results button continuing to call `updateScan(..., { status: "ready_for_review" })`, with the backend transition guarded from other customer states.
- Must-have: dressmakers cannot read pre-share results — verified in Node/XAMPP `requireScan` and organization queries, Supabase `can_access_scan`/RLS policies, and the Supabase processing endpoint access check.
- Must-have: existing shared results remain usable — verified by retaining `ready_for_review`, `verified`, and `needs_recapture` in shared read scopes and by preserving the existing UI success state.
- Must-have: frontend remains buildable — verified by typecheck, tests, production build, and diff check.

## Human check remaining

Start or process a fresh scan, confirm the customer results screen shows `Ready to share` with an enabled `Send to dressmaker for review` button, click it, then refresh the dressmaker workspace and confirm the scan appears in Reviews. The existing screenshot is an already-shared record and is not a valid pre-share test fixture.
