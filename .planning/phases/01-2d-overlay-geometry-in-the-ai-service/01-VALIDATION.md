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
| 1-01-01 | 01 | 1 | PIPE-01, PIPE-02 | T-01-01 | Waist overlay line carries normalized [0,1] endpoints, view, kind, per-view dims; clamped/rounded at derivation | tracer/unit | `cd ai-service && python -m pytest tests/test_overlay_geometry.py::test_overlay_present_with_dims tests/test_silhouette_pipeline.py -q` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | PIPE-01, PIPE-02 | T-01-01, T-01-02 | All anchorable lines truthful; upper_arm + zero-width omitted; view from profile.view; single resolve; device cpu | unit | `cd ai-service && python -m pytest tests/test_overlay_geometry.py -q` | ❌ W0 | ⬜ pending |
| 1-02-01 | 02 | 2 | PIPE-01, PIPE-03 | T-01-04, T-01-05 | Finite/[0,1]-bounded point validator; bounded sizes; extra=forbid; view-presence check | unit | `cd ai-service && python -m pytest tests/test_overlay_geometry.py -q` | ❌ W0 | ⬜ pending |
| 1-02-02 | 02 | 2 | PIPE-03 | T-01-06 | Malformed overlay -> PipelineFailure INVALID_PROVIDER_RESULT/502, not a 500 | unit | `cd ai-service && python -m pytest tests/test_overlay_geometry.py tests/test_silhouette_pipeline.py -q` | ❌ W0 | ⬜ pending |

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
