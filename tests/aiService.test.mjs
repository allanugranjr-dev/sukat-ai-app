import { describe, expect, it } from "vitest";

import { normalizeProviderResponse } from "../server/aiService.mjs";

describe("AI provider response boundary", () => {
  it("normalizes measurements and keeps missing confidence honest", () => {
    const result = normalizeProviderResponse({
      scan_id: "scan-1",
      processing_version: "provider-v1",
      measurements: [{ key: "chest", value: 100.12, unit: "cm", method: "circumference", source: "test" }],
      model: { format: "glb", url: "https://provider.example/model.glb" },
      reconstruction: { backend: "test-provider" },
    }, "scan-1");
    expect(result.measurements[0]).toMatchObject({ key: "chest", value: 100.12, confidence: null, method: "circumference" });
    expect(result.modelUrl).toBe("https://provider.example/model.glb");
  });

  it("does not turn an explicit null confidence into zero percent", () => {
    const result = normalizeProviderResponse({
      scan_id: "scan-1",
      processing_version: "provider-v1",
      measurements: [{ key: "ankle", value: 24, unit: "cm", confidence: null, method: "circumference", source: "test" }],
      model: { path: "scan-1.glb" },
      reconstruction: { backend: "test-provider" },
    }, "scan-1");
    expect(result.measurements[0].confidence).toBeNull();
  });

  it("converts inches and rejects empty or duplicate results", () => {
    const metadata = { scan_id: "scan-1", processing_version: "provider-v1", reconstruction: { backend: "test-provider" }, model: { path: "scan-1.glb" } };
    expect(normalizeProviderResponse({ ...metadata, measurements: [{ key: "waist", value: 32, unit: "in", method: "circumference", source: "test" }] }, "scan-1").measurements[0].value).toBeCloseTo(81.28);
    expect(() => normalizeProviderResponse({ ...metadata, measurements: [] }, "scan-1")).toThrow("no valid measurements");
    expect(() => normalizeProviderResponse({ ...metadata, measurements: [{ key: "chest", value: 90, method: "circumference", source: "test" }, { key: "chest", value: 91, method: "circumference", source: "test" }] }, "scan-1")).toThrow("duplicate");
  });

  it("never treats measurement-only output as a completed scan", () => {
    expect(() => normalizeProviderResponse({
      status: "completed",
      scan_id: "scan-1",
      processing_version: "provider-v1",
      measurements: [{ key: "chest", value: 100, unit: "cm", method: "circumference", source: "test" }],
    }, "scan-1")).toThrow("without a GLB model");
  });

  it("requires provider identity and processing metadata", () => {
    expect(() => normalizeProviderResponse({
      measurements: [{ key: "chest", value: 100, method: "circumference", source: "test" }],
      model: { path: "scan-1.glb" },
      reconstruction: {},
      processing_version: "provider-v1",
    }, "scan-1")).toThrow("wrong scan id");
    expect(() => normalizeProviderResponse({
      scan_id: "scan-1",
      measurements: [{ key: "chest", value: 100, method: "circumference", source: "test" }],
      model: { path: "scan-1.glb" },
      reconstruction: {},
    }, "scan-1")).toThrow("processing version");
    expect(() => normalizeProviderResponse({
      scan_id: "scan-1",
      processing_version: "provider-v1",
      measurements: [{ key: "chest", value: 100, method: "circumference", source: "test" }],
      model: { path: "scan-1.glb" },
    }, "scan-1")).toThrow("reconstruction metadata");
  });

  it("accepts only a calibrated provider contour contract", () => {
    const points = Array.from({ length: 8 }, (_, index) => [Math.cos(index * Math.PI / 4), 0.7, Math.sin(index * Math.PI / 4)]);
    const result = normalizeProviderResponse({
      scan_id: "scan-1",
      processing_version: "provider-v1",
      scan_quality: "good",
      measurements: [{ key: "chest", value: 100, method: "mesh", source: "provider-mesh" }],
      model: { path: "scan-1.glb" },
      reconstruction: {
        guide_geometry: {
          coordinate_system: "glb-y-up-right-handed",
          units: "m",
          up_axis: "y",
          calibrated_height_cm: 170,
          contours: { chest: { level_fraction: 0.7, level_height_cm: 119, points, source: "provider-mesh-plane-intersection" } },
        },
      },
    }, "scan-1");
    expect(result.reconstruction.guide_geometry.contours.chest.level_height_cm).toBe(119);
    expect(() => normalizeProviderResponse({
      scan_id: "scan-1",
      processing_version: "provider-v1",
      measurements: [{ key: "chest", value: 100, method: "mesh", source: "provider-mesh" }],
      model: { path: "scan-1.glb" },
      reconstruction: {
        guide_geometry: {
          coordinate_system: "z-up",
          units: "m",
          up_axis: "z",
          calibrated_height_cm: 170,
          contours: {},
        },
      },
    }, "scan-1")).toThrow("coordinate system");
  });

  it("surfaces provider validation guidance instead of a generic failure", () => {
    expect(() => normalizeProviderResponse({
      status: "failed",
      scan_id: "scan-1",
      status_message: "The uploaded scan views did not pass pose validation.",
      quality_issues: [{ view: "front", message: "Stand naturally with arms slightly away from the body." }],
    }, "scan-1")).toThrow("front: Stand naturally with arms slightly away from the body.");
  });
});
