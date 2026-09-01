# Feature Landscape

**Domain:** CPU-first two-view body measurement and tailor review
**Researched:** 2026-09-02
**Research method:** Existing product audit plus primary documentation; no competitor feature was allowed to override the governing migration brief.

## Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Guided front/side capture or upload | Users need to know how to stand and what to submit | Medium | Preserve existing upload/camera flow and improve only actionable guidance. |
| Real height input and unit handling | Two photos need a scale reference | Low | Store the calibrated height with the scan and show the chosen unit clearly. |
| Pose and image-quality validation | Bad framing or pose invalidates downstream measurements | High | Fail before expensive fitting and name the exact view/problem. |
| Private asset handling | Body images and models are sensitive | High | Keep private buckets/authorized asset endpoints and time-limited access. |
| Honest lifecycle states | Processing cannot appear queued forever | Medium | Persist validated, processing, ready, failed, retrying, and attempt information. |
| Retry without duplicate or destructive writes | Providers and networks fail | High | Use idempotent attempts and preserve the last durable result until replacement is ready. |
| Measurement result with units and provenance | Tailors need to know what was measured and how | Medium | Include provider/version/method; keep confidence nullable. |
| Interactive model with selectable guides | Users need to connect a value to the body | High | Guide must use the same contour/level definition as the provider. |
| Tailor/admin review permissions | The product has role-specific workflows | High | Preserve Supabase RLS, Node authorization, and current invitation/access flows. |
| Local and hosted parity | Development and deployment both matter | High | Contract-test the browser adapters and key backend transitions. |

## Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Provider-authored guide contours | The visible ring corresponds to the displayed value instead of an arbitrary ellipse | High | Recommended first differentiator because it addresses the reported mismatch directly. |
| Transparent measurement qualification | Separates input/process quality from real-world validation | Medium | Say “accuracy not independently validated” until a reference dataset exists. |
| Reference-measurement evaluation mode | Lets the team measure error honestly on consented test subjects | High | Internal/admin tool first; do not expose aggregate accuracy until protocol and sample size are defined. |
| Scan attempt history | Makes failures, retries, and provider changes auditable | Medium | Useful for support and protects reviewed outputs. |
| CPU performance diagnostics | Makes the app practical on the ThinkPad target | Medium | Record elapsed stages and memory-safe image dimensions without exposing internals to customers. |
| Provider/version comparison | Detects regressions between reconstruction releases | Medium | Internal reporting, not a customer-facing confidence substitute. |

## Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Random confidence or accuracy percentages | They imply evidence the system does not have | Render “Not reported” and expose quality/provenance separately. |
| Public scan-image/model storage | Body scans are sensitive and public URLs bypass access control | Use private storage, signed URLs, or authorized local asset handlers. |
| Heavy GPU-only reconstruction | Excludes the target laptop and complicates deployment | Keep bounded CPU fitting and document optional accelerators only. |
| Rebuilding the entire UI or backend | Creates regressions and violates the migration brief | Modify established adapters and components in place. |
| Silent fallback measurements after provider failure | Users may mistake demo values for personalized output | Mark the scan failed or clearly demo-only; never publish an unvalidated result as ready. |
| Treating fitting loss as body-measurement accuracy | Loss is against image-derived targets, not tape truth | Use independent reference measurements in a separate evaluation harness. |
| Front-width-only circumferences | It systematically misses depth and can mislead tailoring | Use front and side silhouettes plus provider mesh/contour measurements. |

## Feature Dependencies

```text
Private upload + real height
  → image/pose validation
  → durable scan attempt
  → provider measurement + guide contract
  → persisted result + authorized model asset
  → interactive review and tailor workflow

Independent tape dataset
  → offline evaluation harness
  → documented error metric
  → optional accuracy reporting
```

## MVP Recommendation

Prioritize:

1. A reliable validated → processing → ready/failed lifecycle with safe retry.
2. Provider measurements and guide contours sharing one versioned coordinate/method contract.
3. Honest result qualification: quality/provenance visible, accuracy withheld without ground truth.
4. Contract tests across the local Node and hosted Supabase paths for the updated scan result.

Defer a public accuracy percentage until the team has a consented reference dataset and a documented evaluation protocol. Defer broad UI redesign and new model families.

## Sources

- Existing codebase map: `.planning/codebase/ARCHITECTURE.md`, `CONCERNS.md`, and `TESTING.md`.
- Governing migration brief: `C:/Users/grana/.codex/attachments/6c498372-80e5-4118-9a5f-95c6fc1002d1/pasted-text.txt`.
- [Supabase private bucket fundamentals](https://supabase.com/docs/guides/storage/buckets/fundamentals).
- [Supabase Edge Function limits](https://supabase.com/docs/guides/functions/limits).
