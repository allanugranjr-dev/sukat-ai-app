# SukatAI AI service architecture

```text
multipart request
      |
      v
FastAPI boundary (auth, CORS, bounded uploads, safe scan id)
      |
      v
validation -> reconstruction adapter -> height calibration
                                  |
                                  v
                  tailoring measurements + GLB export
                                  |
                                  v
        result with method/source/quality/reconstruction metadata
```

## Boundary

The service owns image validation, reconstruction orchestration, calibration, measurement provenance, and model artifact export. It does not own SukatAI authentication, Supabase RLS, customer records, invitation state, or order state. The existing web/Node/Supabase layers remain responsible for those concerns and should call this service over a private authenticated server-to-server connection.

## Processing contract

The endpoint returns `202 Accepted` with `queued`, a scan id, and a same-origin
status URL. A bounded background task then moves through `validating` and
`processing` before returning `completed` or `failed`. Progress is reported by
the validation and Anny evaluation work; it is not timer-generated. A
completed response is not possible without successful pose validation,
silhouette extraction, Anny fitting, CLAD measurement, and GLB reopening.

Every measurement includes a unit, method, and source. Confidence is optional
and remains null when the provider cannot justify it. Height calibration records
the submitted height, pre-calibration mesh height, and scale factor. The
active pipeline has no template or silhouette-only success fallback; failures
remain failed rather than being presented as personalized measurements.

## Adapter boundaries

- `PixieAdapter` — image-to-parameter reconstruction boundary.
- `SMPLXAdapter` — licensed body-model decoding boundary.
- `AnthropometryAdapter` — mesh-to-measurement boundary.
- `calibrate_vertices` — explicit height calibration.
- `tailoring_measurements` — transparent front/side target extraction used to
  constrain Anny; it is not the published measurement source.
- `export_glb` — browser-compatible artifact boundary.

Adapters raise explicit missing-asset or runner errors. This keeps health, validation, and contract tests runnable on CPU-only developer machines without pretending that optional model assets are installed.

## Security and operations

- Uploads are bounded by `MAX_UPLOAD_BYTES` and decoded through Pillow before processing.
- Scan IDs are allowlisted and are also checked before model-file lookup to prevent path traversal.
- Private API routes support a server-side API key; the key must never be sent from browser code.
- CORS is allowlisted through `ALLOWED_ORIGINS`; production should set exact HTTPS origins.
- Generated GLBs are written only below `OUTPUT_DIR`.
- The in-memory result store is intentionally limited to the local provider
  boundary. The Node gateway and Supabase rows own durable scan state and
  private model storage; a production deployment must keep this service behind
  the authenticated gateway or add equivalent durable job storage.
- Health exposes device, dependency, and asset state without exposing secret values.
