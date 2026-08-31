import { describe, expect, it } from "vitest";
import { ellipseCircumferenceFromRadii, ellipseRadiiForCircumference, findModelMeasurement, measurementGuideKey, modelHeightCm, modelMeasurementCm, normalizeModelMeasurementKey } from "../src/lib/measurementMapping";
import { parseHeightInches } from "../src/lib/scanFlow";
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

  it("resolves measurement labels to interactive guide keys", () => {
    expect(measurementGuideKey("Chest Circumference")).toBe("chest");
    expect(measurementGuideKey("Thigh Left Circumference")).toBe("thigh_left");
    expect(measurementGuideKey("Right Foot Width")).toBe("foot_width_right");
    expect(measurementGuideKey("body_mass")).toBeNull();
  });

  it("maps every customer-facing measurement label to its matching model guide", () => {
    const expectedGuides = {
      "Ankle Left Circumference": "ankle_left",
      "Upper arm": "upper_arm",
      "Back To Shoulder": "back_to_shoulder",
      "Bicep Right Circumference": "upper_arm_right",
      "Calf Left Circumference": "calf_left",
      Chest: "chest",
      "Foot Length": "foot_length",
      "Foot Width": "foot_width",
      "Forearm Circumference": "forearm",
      "Head Circumference": "head",
      Hip: "hip",
      Inseam: "inseam",
      Neck: "neck",
      "Neck To Pelvis": "neck_to_pelvis",
      Shoulder: "shoulder",
      "Thigh Left Circumference": "thigh_left",
      Waist: "waist",
      "Wrist Right Circumference": "wrist_right",
    } as const;

    Object.entries(expectedGuides).forEach(([label, guideKey]) => {
      expect(measurementGuideKey(label)).toBe(guideKey);
    });
  });

  it("prefers an exact measurement over a descriptive suffix", () => {
    const descriptive = measurement("back_to_shoulder", 21.2);
    const shoulder = measurement("shoulder", 52.5);
    expect(findModelMeasurement([descriptive, shoulder], ["shoulder"])).toBe(shoulder);
  });

  it("prefers a tailor adjustment and converts inches to centimetres", () => {
    expect(modelMeasurementCm([measurement("waist", 32, "in", 31)], ["waist"], 82)).toBeCloseTo(78.74);
  });

  it("keeps dimensions and sides from being mixed during model calibration", () => {
    expect(modelMeasurementCm([measurement("chest_width", 40)], ["chest"], 100.1, { dimension: "circumference" })).toBe(100.1);
    expect(modelMeasurementCm([measurement("foot_length", 26.2)], ["foot_length"], 0, { dimension: "circumference" })).toBe(0);
    expect(modelMeasurementCm([measurement("upper_arm", 33.3)], ["arm"], 57.3, { dimension: "length" })).toBe(57.3);
    const left = measurement("bicep_left_circumference", 31.4);
    const right = measurement("bicep_right_circumference", 33.3);
    expect(modelMeasurementCm([left, right], ["bicep"], 30, { dimension: "circumference", side: "left" })).toBe(31.4);
    expect(modelMeasurementCm([left, right], ["bicep"], 30, { dimension: "circumference", side: "right" })).toBe(33.3);
  });

  it("round-trips ellipse radii to the requested circumference", () => {
    const modelUnitsPerCm = 4.3 / 170;
    const radii = ellipseRadiiForCircumference(100.1, 0.72, modelUnitsPerCm);
    expect(ellipseCircumferenceFromRadii(radii[0], radii[1], modelUnitsPerCm)).toBeCloseTo(100.1, 4);
  });

  it("strictly parses feet and inches without truncating malformed input", () => {
    expect(parseHeightInches("5'7\"")).toBe(67);
    expect(parseHeightInches("5 ft 7 in")).toBe(67);
    expect(parseHeightInches("5'7.5")).toBeNull();
    expect(parseHeightInches("5'7xyz")).toBeNull();
    expect(parseHeightInches("5'7 99")).toBeNull();
  });

  it("uses safe fallbacks for missing or invalid values", () => {
    expect(modelMeasurementCm([measurement("waist", 0)], ["waist"], 82)).toBe(82);
    expect(modelMeasurementCm([measurement("waist", 82, "cm", 0)], ["waist"], 70)).toBe(82);
    expect(modelMeasurementCm([], ["waist"], 82)).toBe(82);
    expect(modelHeightCm(null, "cm")).toBe(170);
    expect(modelHeightCm(67, "ftin")).toBeCloseTo(170.18);
  });
});
