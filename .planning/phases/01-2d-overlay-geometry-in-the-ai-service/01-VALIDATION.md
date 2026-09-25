---
phase: "1"
slug: "2d-overlay-geometry-in-the-ai-service"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-25"
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (configured in `ai-service/pyproject.toml`) |
| **Config file** | `ai-service/pyproject.toml` |
| **Quick run command** | `cd ai-service && python -m pytest tests/test_overlay_geometry.py -q` |
| **Full suite command** | `cd ai-service && python -m pytest -q` |
| **Estimated runtime** | ~30–60 seconds |

---

## Sampling Rate

- **After every task commit:** Run the quick run command
- **After every plan wave:** Run the full suite command
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {N}-01-01 | 01 | 1 | PIPE-01 | — | Overlay lines carry normalized endpoints, view, and view pixel dims | unit | `cd ai-service && python -m pytest tests/test_overlay_geometry.py -q` | ❌ W0 | ⬜ pending |

*Planner + Nyquist auditor populate this table per task. Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `ai-service/tests/test_overlay_geometry.py` — stubs for PIPE-01/02/03 invariants
- [ ] Update the two monkeypatched `_anny_targets` lambdas in `ai-service/tests/test_silhouette_pipeline.py` to the new return arity

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| — | — | — | — |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
