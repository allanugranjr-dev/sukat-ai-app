import { describe, expect, it } from "vitest";
import { normalizeLiveMeasurementsResponse } from "../supabase/functions/_shared/liveMeasurements";

describe("live measurement provider adapter", () => {
  it("normalizes the upstream measurement map without inventing confidence", () => {
    const result = normalizeLiveMeasurementsResponse({
      measurements: {
        shoulder_width: 52.5,
        chest_circumference: 100.1,
        waist: 82.2,
        hip_circumference: 94.8,
        armLength: 57.3,
      },
      debug_info: { user_height_cm: 170 },
    });

    expect(result.processing_version).toBe("live-measurements-api");
    expect(result.measurements).toEqual([
      { key: "shoulder_width", value: 52.5, unit: "cm", confidence: null },
      { key: "chest_circumference", value: 100.1, unit: "cm", confidence: null },
      { key: "waist", value: 82.2, unit: "cm", confidence: null },
      { key: "hip_circumference", value: 94.8, unit: "cm", confidence: null },
      { key: "arm_length", value: 57.3, unit: "cm", confidence: null },
    ]);
  });

  it("accepts the array contract when a secured provider supplies confidence", () => {
    const result = normalizeLiveMeasurementsResponse({
      processing_version: "provider-build-4",
      measurements: [
        { key: "chest", value: 100.1, unit: "cm", confidence: 81 },
        { key: "waist", value: 82.2, unit: "cm", confidence: null },
      ],
    });

    expect(result.processing_version).toBe("provider-build-4");
    expect(result.measurements[0].confidence).toBe(81);
    expect(result.measurements[1].confidence).toBeNull();
  });

  it("rejects invalid, duplicate, and empty provider results", () => {
    expect(() => normalizeLiveMeasurementsResponse({ measurements: {} })).toThrow("no measurements");
    expect(() => normalizeLiveMeasurementsResponse({ measurements: { chest: 0 } })).toThrow("invalid value");
    expect(() => normalizeLiveMeasurementsResponse({ measurements: { chest: 100, Chest: 101 } })).toThrow("duplicate");
    expect(() => normalizeLiveMeasurementsResponse({ measurements: [{ key: "chest", value: 100, confidence: 140 }] })).toThrow("invalid confidence");
  });
});
