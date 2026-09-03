import { describe, expect, it } from "vitest";
import { getScanResultTruth, measurementProvenance, qualityIssueText } from "../src/lib/scanResultTruth";
import type { Measurement, ScanBundle } from "../src/lib/types";

function bundle(overrides: Record<string, unknown> = {}): ScanBundle {
  return {
    scan: {
      id: "scan-truth-1",
      customer_id: "customer-1",
      organization_id: null,
      status: "ready_for_review",
      height_value: 170,
      height_unit: "cm",
      consent_at: "2026-09-02T00:00:00.000Z",
      capture_source: "upload",
      processing_provider: "live-measurements-api",
      processing_version: "provider-v2",
      processing_attempts: 2,
      processing_attempt_id: "attempt-2",
      processing_started_at: null,
      processing_completed_at: "2026-09-02T00:01:00.000Z",
      processing_error_code: null,
      processing_status: "completed",
      processing_progress: 100,
      processing_progress_reported: true,
      processing_error: null,
      failure_reason: null,
      created_at: "2026-09-02T00:00:00.000Z",
      updated_at: "2026-09-02T00:01:00.000Z",
    },
    assets: [],
    measurements: [],
    bodyModel: {
      id: "model-1",
      scan_id: "scan-truth-1",
      provider: "live-measurements-api",
      model_url_or_path: "model.glb",
      preview_data: {
        provider: "live-measurements-api",
        processing_version: "provider-v2",
        scan_quality: "good",
        quality_issues: [{ view: "side", message: "slight background clutter" }],
        reconstruction: { processing_version: "reconstruction-v2" },
      },
      status: "ready",
      created_at: "2026-09-02T00:01:00.000Z",
    },
    ...overrides,
  } as ScanBundle;
}

describe("scan result truth", () => {
  it("uses persisted provider metadata and never invents accuracy", () => {
    const truth = getScanResultTruth(bundle());
    expect(truth.provider).toBe("live-measurements-api");
    expect(truth.processingVersion).toBe("provider-v2");
    expect(truth.attemptId).toBe("attempt-2");
    expect(truth.quality).toBe("good");
    expect(truth.qualityIssues).toHaveLength(1);
    expect(truth.independentAccuracyValidated).toBe(false);
    expect(JSON.stringify(truth)).not.toMatch(/accuracy.?\d/i);
  });

  it("falls back to reconstruction metadata without treating it as a score", () => {
    const truth = getScanResultTruth(bundle({
      scan: { ...bundle().scan, processing_provider: null, processing_version: null, processing_attempt_id: null },
      processingAttempt: {
        id: "attempt-from-row",
        scan_id: "scan-truth-1",
        attempt_number: 1,
        status: "promoted",
        provider: "python-provider",
        processing_version: "attempt-v1",
        quality: "acceptable",
        quality_issues: [],
        error_code: null,
        error_message: null,
        started_at: null,
        completed_at: null,
        promoted_at: null,
        is_promoted: true,
      },
    }));
    expect(truth.provider).toBe("live-measurements-api");
    expect(truth.processingVersion).toBe("attempt-v1");
    expect(truth.attemptId).toBe("attempt-from-row");
    expect(truth.quality).toBe("acceptable");
  });

  it("labels missing measurement provenance and formats view-specific issues safely", () => {
    const measurement = { method: null, source: null } as Measurement;
    expect(measurementProvenance(measurement)).toBe("Provider details not reported");
    expect(qualityIssueText({ view: "front", message: "stand naturally" })).toBe("front: stand naturally");
    expect(qualityIssueText({ error: "provider rejected the view" })).toBe("provider rejected the view");
  });
});
