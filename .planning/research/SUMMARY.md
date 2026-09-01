# Research Summary: SukatAI

**Domain:** CPU-first two-view body measurement and tailor review
**Researched:** 2026-09-02
**Overall confidence:** MEDIUM

**Research note:** Four parallel GSD project-researcher workers were launched with disjoint output paths but stalled before materializing files. The orchestrator stopped them after bounded retries and recovered this research from the existing codebase, cached GSD research questions, and primary official documentation. No application files were changed.

## Executive Summary

SukatAI already has the correct high-level shape for the target: a React/Vite application with runtime adapters, local Node/MariaDB and XAMPP paths, hosted Supabase services, an isolated FastAPI provider, and a Three.js GLB viewer. The safest migration is to strengthen the contracts between those parts rather than introduce a new UI, backend, or model stack.

The reported accuracy display and ring mismatch are different problems. The repository has no independent tape-measurement dataset, so a customer-facing accuracy percentage would be fabricated. The UI should keep unreported confidence null and show input/process quality and provider provenance separately. The rings can be improved, but only by making the provider's contour/level/method authoritative or explicitly labeling a visual guide as approximate.

The most important reliability improvement is attempt-based processing. A scan should move through validated, processing, ready, and failed states with durable attempt metadata. New artifacts should be written and validated before promotion, preserving the last ready result during retry failures. Hosted Edge Functions should orchestrate short authenticated operations while the CPU-heavy provider runs outside the edge limits.

The recommended roadmap is a small number of vertical, end-to-end phases: first lock truthful result and lifecycle contracts, then align provider geometry with the viewer, then harden cross-runtime verification and target-laptop operations. Existing authentication, private storage, role workflows, database data, and UI should remain intact.

## Key Findings

**Stack:** Retain React/Vite, Three.js/GLTFLoader, MediaPipe Pose Landmarker, OpenCV, FastAPI, Node/MariaDB, Supabase, and Capacitor; no new dependency is required for the initial fixes.

**Architecture:** Use a versioned provider result contract with quality/issues, nullable confidence, calibration metadata, and provider-authored guide contours/levels; promote attempt artifacts atomically.

**Critical pitfall:** The provider's CLAD/convex-hull circumference and the browser's raw mesh contour are not necessarily the same measurement. Without a shared geometry contract, rings cannot be called exact.

## Implications for Roadmap

Based on research, suggested phase structure:

1. **Truthful scan result and processing lifecycle** — Define result provenance, quality versus accuracy, nullable confidence, durable attempts, and safe retry behavior.
   - Addresses: lifecycle, validation, honest results, private asset safety.
   - Avoids: fabricated percentages, stuck scans, destructive retries.

2. **Provider-aligned 3D measurement guides** — Export or persist the exact contour/level data used by the provider and render it in the existing viewer.
   - Addresses: chest/waist/hip ring mismatch, stale metadata, selectable guides.
   - Avoids: fallback ellipses and coordinate/calibration drift.

3. **Cross-runtime verification and CPU release hardening** — Exercise Node, Supabase, and retained XAMPP contracts; verify restart/retry, privacy, performance, and held-out measurement fixtures.
   - Addresses: backend drift, mobile/local reliability, operational confidence.
   - Avoids: “works in one mode” releases and unsupported accuracy claims.

**Phase ordering rationale:** The lifecycle/result contract must be stable before geometry can be persisted; geometry must be stable before UI and cross-runtime tests can assert it; release hardening depends on both.

**Research flags for phases:** Phase 1 needs careful schema/state review. Phase 2 needs deeper geometry validation against provider and GLB fixtures. Phase 3 needs environment-specific testing and, if accuracy reporting is desired later, a separate reference-data study.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Existing dependency files and official framework/platform docs agree; no new stack is needed. |
| Features | MEDIUM | User needs are clear from the product and browser evidence, but no external user research dataset was supplied. |
| Architecture | HIGH | Current codebase map and existing adapters show clear boundaries; attempt promotion is a direct response to observed concerns. |
| Pitfalls | HIGH | Failure modes are evidenced in current code/docs and are consistent with official platform limits. |

## Gaps to Address

- No consented tape-measurement reference dataset exists; accuracy must remain unreported until one is created and evaluated.
- The exact provider-to-viewer contour serialization format still needs an implementation decision in Phase 2.
- Existing scans may need a safe reprocess/backfill policy for older processing versions.
- XAMPP lacks the same realtime behavior as Node/Supabase and needs an explicit compatibility decision.
- The four requested research agents did not return documents; this recovered research should be rechecked during phase-specific planning if the GSD runtime can dispatch them reliably.

## Sources

- [MediaPipe Pose Landmarker Python API](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/PoseLandmarker)
- [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html)
- [Khronos glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)
- [FastAPI background tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions) and [limits](https://supabase.com/docs/guides/functions/limits)
- [Supabase private Storage](https://supabase.com/docs/guides/storage/serving/downloads)
