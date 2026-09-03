import { describe, expect, it } from "vitest";

import { safeProcessingErrorMessage, scanAttemptIdempotencyKey, scanAttemptResponse } from "../server/scanProcessingAttempt.mjs";

describe("durable scan processing tracer contract", () => {
  it("uses one stable idempotency key for an active retry", () => {
    expect(scanAttemptIdempotencyKey("scan-1", 2)).toBe("scan-1:2");
    expect(scanAttemptIdempotencyKey("scan-1", 0)).toBe("scan-1:1");
    expect(scanAttemptIdempotencyKey("scan-1", "2")).toBe("scan-1:2");
  });

  it("returns only safe promoted-attempt metadata", () => {
    const response = scanAttemptResponse({
      id: "attempt-2",
      scan_id: "scan-1",
      attempt_number: 2,
      status: "promoted",
      provider: "ai-service",
      processing_version: "sukatai-anny-clad-v1",
      quality: "acceptable",
      quality_issues: JSON.stringify([{ view: "front", message: "Minor background contrast" }]),
      staged_measurements: [{ key: "private-measurement" }],
      staged_model_path: "body-models/private/model.glb",
      claim_token: "private-claim-token",
      error_code: null,
      error_message: null,
      started_at: "2026-09-02T00:00:00.000Z",
      completed_at: "2026-09-02T00:01:00.000Z",
      promoted_at: "2026-09-02T00:01:00.000Z",
      is_promoted: 1,
    });

    expect(response).toMatchObject({
      id: "attempt-2",
      scan_id: "scan-1",
      attempt_number: 2,
      status: "promoted",
      provider: "ai-service",
      processing_version: "sukatai-anny-clad-v1",
      quality: "acceptable",
      quality_issues: [{ view: "front", message: "Minor background contrast" }],
      is_promoted: true,
    });
    expect(response).not.toHaveProperty("staged_measurements");
    expect(response).not.toHaveProperty("staged_model_path");
    expect(response).not.toHaveProperty("claim_token");
  });

  it("does not expose malformed quality JSON or internal error details", () => {
    const response = scanAttemptResponse({
      id: "attempt-3",
      scan_id: "scan-1",
      attempt_number: 3,
      status: "failed",
      provider: "ai-service",
      processing_version: null,
      quality: null,
      quality_issues: "not-json",
      error_code: "provider_failed",
      error_message: "Try again",
      started_at: null,
      completed_at: null,
      promoted_at: null,
      is_promoted: 0,
    });
    expect(response.quality_issues).toEqual([]);
    expect(response.error_code).toBe("provider_failed");
    expect(response.error_message).toBe("Try again");
  });

  it("redacts database details from processing errors", () => {
    const raw = "(conn:68, no: 4025, SQLState: 23000) CONSTRAINT scan_processing_attempts.quality_issues failed";
    const safe = safeProcessingErrorMessage(raw);
    expect(safe).toBe("The processing service could not complete this scan. Your uploaded views are safe; please try again.");
    expect(scanAttemptResponse({
      id: "attempt-4",
      scan_id: "scan-1",
      attempt_number: 4,
      status: "failed",
      error_message: raw,
      quality_issues: "[]",
      is_promoted: 0,
    }).error_message).toBe(safe);
  });
});
