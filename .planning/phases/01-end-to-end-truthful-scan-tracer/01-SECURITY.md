---
phase: "01"
slug: "end-to-end-truthful-scan-tracer"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-09-03
---

# Phase 01 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Customer browser to Node API or Supabase Edge Function | Untrusted scan identifiers, height values, status requests, and retry submissions cross into privileged processing. | scan ids, heights, status/retry requests |
| Node/Edge gateway to reconstruction provider | Provider responses, status URLs, model references, validation issues, and measurements are untrusted external data. | provider results, model references, measurements |
| Gateway to MariaDB/Postgres and private storage | Processing code writes durable lifecycle/result state and private model references. | durable attempt rows, private model refs |
| Reconstruction provider worker | Uploaded front/side images and height reference are sensitive customer data processed by a CPU-first service. | front/side images, height |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01-01 | Spoofing | process_scan and status entry points | high | mitigate | Retain bearer/session authentication, scan ownership, organization checks, and attempt claims under the existing Node/Edge authorization boundary. | closed |
| T-01-02 | Tampering | provider result normalizer and attempt promotion | high | mitigate | Require scan-id match, bounded unique measurements, method/source/version, valid model, quality metadata, and atomic promotion only after complete staging. | closed |
| T-01-03 | Repudiation | scan_processing_attempts lifecycle | medium | mitigate | Persist attempt id, attempt number, provider/version, status transitions, timestamps, safe error code, and promotion marker for an auditable history. | closed |
| T-01-04 | Information disclosure | provider requests, logs, status/error payloads | high | mitigate | Use private signed access only at the storage boundary, redact provider secrets and raw paths, and return stable user-safe messages instead of raw exceptions. | closed |
| T-01-05 | Denial of service | image validation and CPU provider queue | medium | mitigate | Enforce byte/dimension/decode/pose limits before fitting, preserve configured timeouts, and avoid duplicate active work through durable claims. | closed |
| T-01-06 | Elevation of privilege | lifecycle writes and promotion RPC/transaction | high | mitigate | Keep lifecycle fields server-owned, preserve RLS/role checks, and authorize promotion by the claimed scan and attempt rather than browser-supplied state. | closed |
| T-01-07 | Tampering | provider guide metadata and contour transform | high | mitigate | Validate finite points, named keys, units, axis, calibrated scale, and level association; use exact rendering only for a validated contract and label the existing fallback approximate. | closed |
| T-01-08 | Information disclosure | result bundle, model loader, and error copy | high | mitigate | Keep storage access through existing authorization/signed URLs, render errors as text, and omit raw provider URLs, storage paths, credentials, and stack details. | closed |
| T-01-09 | Spoofing | result selection and scan status display | medium | mitigate | Bind displayed provenance and selection to the authorized scan bundle and promoted attempt returned by the backend, not browser-created identifiers. | closed |
| T-01-10 | Denial of service | GLB/contour rendering | medium | mitigate | Reuse gateway model-size limits, reject malformed contour arrays before Three.js work, dispose viewer resources, and retain bounded fallback behavior. | closed |
| T-01-11 | Elevation of privilege | customer result and private photos tabs | high | mitigate | Preserve existing scan ownership and storage authorization adapters; no UI path may construct an unauthenticated asset URL or bypass role checks. | closed |

*Status: open · closed · open — below {block_on} threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|

No accepted risks.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-03 | 11 | 11 | 0 | Claude (gsd-secure-phase, ASVS L1 grep pass) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-03
