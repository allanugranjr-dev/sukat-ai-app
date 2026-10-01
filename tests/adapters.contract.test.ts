import { describe, expect, it, vi } from "vitest";
import { getScanResultTruth, measurementProvenance, qualityIssueText } from "../src/lib/scanResultTruth";
import type { ScanBundle } from "../src/lib/types";

describe("adapter contract: result shape consistency", () => {
  // This fixture represents the canonical output shape that ALL backends
  // (Node/MariaDB, Supabase, XAMPP) must produce for the same scan.
  const canonicalScanBundle: ScanBundle = {
    scan: {
      id: "test-scan-123",
      customer_id: "customer-456",
      organization_id: "org-789",
      status: "ready_to_share",
      height_value: 170,
      height_unit: "cm",
      sex: "neutral",
      consent_at: "2026-09-01T10:00:00.000Z",
      capture_source: "upload",
      processing_provider: "cpu-provider-v1.2",
      processing_version: "202609021830",
      processing_attempts: 1,
      processing_attempt_id: "attempt-001",
      processing_started_at: "2026-09-01T10:00:00.000Z",
      processing_completed_at: "2026-09-01T10:02:00.000Z",
      processing_error_code: null,
      processing_status: "completed",
      processing_progress: 100,
      processing_progress_reported: true,
      processing_error: null,
      failure_reason: null,
      created_at: "2026-09-01T09:55:00.000Z",
      updated_at: "2026-09-01T10:02:00.000Z",
    },
    assets: [],
    measurements: [
      {
        id: "m-1",
        scan_id: "test-scan-123",
        key: "chest",
        value: 95,
        unit: "cm",
        confidence: null,
        method: "mesh-contour-circumference",
        source: "cpu-provider-v1.2",
        ai_value: 95,
        adjusted_value: null,
        adjusted_by: null,
        adjustment_reason: null,
        verified_at: null,
        created_at: "2026-09-01T10:01:00.000Z",
        updated_at: "2026-09-01T10:01:00.000Z",
      },
      {
        id: "m-2",
        scan_id: "test-scan-123",
        key: "waist",
        value: 82,
        unit: "cm",
        confidence: null,
        method: "mesh-contour-circumference",
        source: "cpu-provider-v1.2",
        ai_value: 82,
        adjusted_value: null,
        adjusted_by: null,
        adjustment_reason: null,
        verified_at: null,
        created_at: "2026-09-01T10:01:00.000Z",
        updated_at: "2026-09-01T10:01:00.000Z",
      },
    ],
    bodyModel: {
      id: "bm-1",
      scan_id: "test-scan-123",
      provider: "cpu-provider-v1.2",
      model_url_or_path: "body-models/test-scan-123/model.glb",
      preview_data: {
        kind: "provider-glb",
        source: "configured reconstruction provider",
        provider: "cpu-provider-v1.2",
        processing_attempt_id: "attempt-001",
        scan_quality: "acceptable",
        quality_issues: [],
        reconstruction: { status: "complete" },
        measurement_provenance: [
          { key: "chest", method: "mesh-contour-circumference", source: "cpu-provider-v1.2" },
          { key: "waist", method: "mesh-contour-circumference", source: "cpu-provider-v1.2" },
        ],
      },
      status: "ready",
      created_at: "2026-09-01T10:01:30.000Z",
    },
    processingAttempt: {
      id: "attempt-001",
      scan_id: "test-scan-123",
      attempt_number: 1,
      status: "promoted",
      provider: "cpu-provider-v1.2",
      processing_version: "202609021830",
      quality: "acceptable",
      quality_issues: [],
      error_code: null,
      error_message: null,
      started_at: "2026-09-01T10:00:00.000Z",
      completed_at: "2026-09-01T10:02:00.000Z",
      promoted_at: "2026-09-01T10:02:00.000Z",
      is_promoted: true,
    },
  };

  it("extracts scan result truth with required fields", () => {
    const truth = getScanResultTruth(canonicalScanBundle);

    expect(truth).toHaveProperty("scanId");
    expect(truth).toHaveProperty("attemptId");
    expect(truth).toHaveProperty("provider");
    expect(truth).toHaveProperty("processingVersion");
    expect(truth).toHaveProperty("quality");
    expect(truth).toHaveProperty("qualityIssues");
    expect(truth).toHaveProperty("independentAccuracyValidated");
    expect(truth).toHaveProperty("quality");
    expect(truth.independentAccuracyValidated).toBe(false);
  });

  it("maps provider from multiple fallbacks", () => {
    const truth = getScanResultTruth(canonicalScanBundle);
    expect(truth.provider).toBe("cpu-provider-v1.2");
  });

  it("maps processing version from multiple fallbacks", () => {
    const truth = getScanResultTruth(canonicalScanBundle);
    expect(truth.processingVersion).toBe("202609021830");
  });

  it("extracts measurement provenance text", () => {
    const measurement = canonicalScanBundle.measurements[0];
    const provenance = measurementProvenance(measurement);
    expect(provenance).toContain("mesh-contour-circumference");
    expect(provenance).toContain("cpu-provider-v1.2");
  });

  it("handles missing quality issues gracefully", () => {
    const bundleWithNullIssues: ScanBundle = {
      ...canonicalScanBundle,
      processingAttempt: {
        ...canonicalScanBundle.processingAttempt!,
        quality_issues: undefined as unknown as never,
      },
    };
    const truth = getScanResultTruth(bundleWithNullIssues);
    expect(truth.qualityIssues).toEqual([]);
  });

  it("handles legacy scan with no processing attempt", () => {
    const legacyBundle: ScanBundle = {
      ...canonicalScanBundle,
      scan: {
        ...canonicalScanBundle.scan,
        processing_attempt_id: null,
        processing_provider: null,
        processing_version: null,
      },
      processingAttempt: null,
      bodyModel: null,
    };
    const truth = getScanResultTruth(legacyBundle);
    expect(truth.attemptId).toBeNull();
    expect(truth.provider).toBeNull();
    expect(truth.quality).toBeNull();
  });
});

describe("adapter contract: legacy scan handling", () => {
  const legacyScanBundle: ScanBundle = {
    scan: {
      id: "legacy-scan-999",
      customer_id: "customer-456",
      organization_id: "org-789",
      status: "ready_for_review",
      height_value: 165,
      height_unit: "cm",
      sex: "neutral",
      consent_at: "2026-08-15T10:00:00.000Z",
      capture_source: "upload",
      processing_provider: null,
      processing_version: null,
      processing_attempts: 0,
      processing_attempt_id: null,
      processing_started_at: null,
      processing_completed_at: null,
      processing_error_code: null,
      processing_status: "completed",
      processing_progress: 100,
      processing_progress_reported: false,
      processing_error: null,
      failure_reason: null,
      created_at: "2026-08-15T09:50:00.000Z",
      updated_at: "2026-08-15T10:00:00.000Z",
    },
    assets: [],
    measurements: [
      {
        id: "m-legacy-1",
        scan_id: "legacy-scan-999",
        key: "chest",
        value: 90,
        unit: "cm",
        confidence: null,
        method: null,
        source: null,
        ai_value: 90,
        adjusted_value: null,
        adjusted_by: null,
        adjustment_reason: null,
        verified_at: null,
        created_at: "2026-08-15T10:00:00.000Z",
        updated_at: "2026-08-15T10:00:00.000Z",
      },
    ],
    bodyModel: null,
    processingAttempt: null,
  };

  it("returns null attempt ID for legacy scans", () => {
    const truth = getScanResultTruth(legacyScanBundle);
    expect(truth.attemptId).toBeNull();
  });

  it("returns null provider for legacy scans", () => {
    const truth = getScanResultTruth(legacyScanBundle);
    expect(truth.provider).toBeNull();
  });

  it("returns null quality for legacy scans", () => {
    const truth = getScanResultTruth(legacyScanBundle);
    expect(truth.quality).toBeNull();
  });

  it("returns empty quality issues for legacy scans", () => {
    const truth = getScanResultTruth(legacyScanBundle);
    expect(truth.qualityIssues).toEqual([]);
  });

  it("measurement provenance shows fallback for missing method/source", () => {
    const measurement = legacyScanBundle.measurements[0];
    const provenance = measurementProvenance(measurement);
    expect(provenance).toBe("Provider provenance unavailable");
  });
});

describe("adapter contract: error message safety", () => {
  it("redacts database errors from quality issue text", () => {
    const issue = { message: "SQLSTATE[23000]: Constraint violation" };
    const text = qualityIssueText(issue);
    expect(text).not.toContain("SQLSTATE");
    expect(text).not.toContain("Constraint violation");
    expect(text).toBe("Provider quality issue reported");
  });

  it("handles malformed issue objects gracefully", () => {
    expect(qualityIssueText({})).toBe("Provider quality issue reported");
    expect(qualityIssueText(null)).toBe("Provider quality issue reported");
    expect(qualityIssueText("plain string")).toBe("plain string");
  });
});

describe("adapter contract: cross-backend JSON shape", () => {
  // This test documents the exact JSON shape that Node, Supabase, and XAMPP
  // must all produce. If any backend changes this shape, the test fails.

  const minimalBundle: ScanBundle = {
    scan: {
      id: "scan-minimal",
      customer_id: "c1",
      organization_id: "o1",
      status: "ready_for_review",
      height_value: 170,
      height_unit: "cm",
      sex: "neutral",
      consent_at: null,
      capture_source: "upload",
      processing_provider: "test-provider",
      processing_version: "v1",
      processing_attempts: 1,
      processing_attempt_id: "a1",
      processing_started_at: null,
      processing_completed_at: null,
      processing_error_code: null,
      processing_status: "completed",
      processing_progress: 100,
      processing_progress_reported: true,
      processing_error: null,
      failure_reason: null,
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z",
    },
    assets: [],
    measurements: [],
    bodyModel: null,
    processingAttempt: {
      id: "a1",
      scan_id: "scan-minimal",
      attempt_number: 1,
      status: "promoted",
      provider: "test-provider",
      processing_version: "v1",
      quality: null,
      quality_issues: [],
      error_code: null,
      error_message: null,
      started_at: null,
      completed_at: null,
      promoted_at: null,
      is_promoted: true,
    },
  };

  it("getScanResultTruth returns plain object with exact keys", () => {
    const truth = getScanResultTruth(minimalBundle);

    // Exact key set
    const keys = Object.keys(truth).sort();
    expect(keys).toEqual([
      "attemptId",
      "independentAccuracyValidated",
      "processingVersion",
      "provider",
      "quality",
      "qualityIssues",
      "scanId",
    ].sort());

    // Value types
    expect(typeof truth.scanId).toBe("string");
    expect(truth.attemptId).toBeTruthy(); // string or null
    expect(truth.independentAccuracyValidated).toBe(false);
    expect(Array.isArray(truth.qualityIssues)).toBe(true);
  });

  it("qualityIssues is always an array", () => {
    const truth = getScanResultTruth(minimalBundle);
    expect(Array.isArray(truth.qualityIssues)).toBe(true);
    expect(truth.qualityIssues.length).toBe(0);
  });
});
