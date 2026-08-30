import { describe, expect, it } from "vitest";
import { findModelMeasurement, modelHeightCm, modelMeasurementCm, normalizeModelMeasurementKey } from "../src/lib/measurementMapping";
import type { Measurement } from "../src/lib/types";

function measurement(key: string, value: number, unit: "cm" | "in" = "cm", adjusted_value: number | null = null): Measurement {
  return {
    id: key,
    scan_id: "scan-1",
    key,
    value,
    unit,
    confidence: 90,
    ai_value: value,
    adjusted_value,
    adjusted_by: null,
    adjustment_reason: null,
    verified_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("measurement mapping for the 3D model", () => {
  it("normalizes provider keys and matches aliases by token", () => {
    const shoulder = measurement("Shoulder breadth", 52.5);
    expect(normalizeModelMeasurementKey("Shoulder breadth")).toBe("shoulder_breadth");
    expect(normalizeModelMeasurementKey("headCircumference")).toBe("head_circumference");
    expect(findModelMeasurement([shoulder], ["shoulder"])).toBe(shoulder);
  });

  it("prefers an exact measurement over a descriptive suffix", () => {
    const descriptive = measurement("back_to_shoulder", 21.2);
    const shoulder = measurement("shoulder", 52.5);
    expect(findModelMeasurement([descriptive, shoulder], ["shoulder"])).toBe(shoulder);
  });

  it("prefers a tailor adjustment and converts inches to centimetres", () => {
    expect(modelMeasurementCm([measurement("waist", 32, "in", 31)], ["waist"], 82)).toBeCloseTo(78.74);
  });

  it("uses safe fallbacks for missing or invalid values", () => {
    expect(modelMeasurementCm([measurement("waist", 0)], ["waist"], 82)).toBe(82);
    expect(modelMeasurementCm([measurement("waist", 82, "cm", 0)], ["waist"], 70)).toBe(82);
    expect(modelMeasurementCm([], ["waist"], 82)).toBe(82);
    expect(modelHeightCm(null, "cm")).toBe(170);
    expect(modelHeightCm(67, "ftin")).toBeCloseTo(170.18);
  });
});
