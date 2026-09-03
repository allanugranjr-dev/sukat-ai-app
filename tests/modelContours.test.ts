import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { extractModelPlaneContour } from "../src/lib/modelContours";

describe("model measurement contours", () => {
  it("extracts the closed body contour nearest the requested level", () => {
    const model = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 2, 32), new THREE.MeshBasicMaterial());
    model.add(body);

    const contour = extractModelPlaneContour(THREE, model, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0));

    expect(contour).not.toBeNull();
    expect(contour!.length).toBeGreaterThan(8);
    const width = Math.max(...contour!.map((point) => point.x)) - Math.min(...contour!.map((point) => point.x));
    const depth = Math.max(...contour!.map((point) => point.z)) - Math.min(...contour!.map((point) => point.z));
    expect(width).toBeCloseTo(2, 1);
    expect(depth).toBeCloseTo(2, 1);
  });
});
