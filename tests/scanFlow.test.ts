import { describe, expect, it } from "vitest";
import { isHeightValid, previousScanPosition, validateUpload } from "../src/lib/scanFlow";
import { processingCopy } from "../src/lib/reconstructionProvider";

describe("scan flow guardrails", () => {
  it("keeps Back inside the current scan journey", () => {
    expect(previousScanPosition("capture", 2)).toEqual({ step: "capture", captureIndex: 1 });
    expect(previousScanPosition("capture", 0)).toEqual({ step: "height", captureIndex: 0 });
    expect(previousScanPosition("height", 0)).toEqual({ step: "prep", captureIndex: 0 });
  });

  it("validates a calibrated height without body judgments", () => {
    expect(isHeightValid("170", "cm", false)).toBe(true);
    expect(isHeightValid("90", "cm", false)).toBe(false);
    expect(isHeightValid("", "cm", true)).toBe(true);
    expect(isHeightValid("5'7", "ftin", false)).toBe(true);
  });

  it("only accepts supported, reasonably sized uploads", () => {
    expect(validateUpload({ type: "image/jpeg", size: 1024 }).valid).toBe(true);
    expect(validateUpload({ type: "image/gif", size: 1024 }).valid).toBe(false);
    expect(validateUpload({ type: "image/png", size: 11 * 1024 * 1024 }).valid).toBe(false);
  });

  it("keeps provider-backed processing honest while queued", () => {
    expect(processingCopy("processing_queued").title).toBe("Processing queued");
    expect(processingCopy("processing_queued").body).toContain("No measurements are shown");
    expect(processingCopy("processing_queued").body).toContain("Check status");
    expect(processingCopy("failed").title).toBe("Processing unavailable");
  });
});
