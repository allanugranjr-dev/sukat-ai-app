import type * as THREE from "three";

export type ThreeModule = typeof import("three");

type PlaneSegment = {
  start: THREE.Vector3;
  end: THREE.Vector3;
};

type ContourNode = {
  point: THREE.Vector3;
  neighbors: Set<string>;
};

const PLANE_EPSILON = 0.00001;
const NODE_EPSILON = 0.00025;

function addUniquePoint(points: THREE.Vector3[], point: THREE.Vector3): void {
  if (points.some((candidate) => candidate.distanceToSquared(point) <= PLANE_EPSILON * PLANE_EPSILON)) return;
  points.push(point.clone());
}

function addEdgeIntersections(points: THREE.Vector3[], start: THREE.Vector3, end: THREE.Vector3, planeOrigin: THREE.Vector3, planeNormal: THREE.Vector3): void {
  const startDistance = start.clone().sub(planeOrigin).dot(planeNormal);
  const endDistance = end.clone().sub(planeOrigin).dot(planeNormal);
  const startOnPlane = Math.abs(startDistance) <= PLANE_EPSILON;
  const endOnPlane = Math.abs(endDistance) <= PLANE_EPSILON;
  if (startOnPlane && endOnPlane) {
    addUniquePoint(points, start);
    addUniquePoint(points, end);
    return;
  }
  if (startOnPlane) {
    addUniquePoint(points, start);
    return;
  }
  if (endOnPlane) {
    addUniquePoint(points, end);
    return;
  }
  if ((startDistance < 0) === (endDistance < 0)) return;
  const blend = startDistance / (startDistance - endDistance);
  addUniquePoint(points, start.clone().lerp(end, blend));
}

function worldPlaneSegments(three: ThreeModule, model: THREE.Object3D, planeOrigin: THREE.Vector3, planeNormal: THREE.Vector3): PlaneSegment[] {
  const segments: PlaneSegment[] = [];
  const localStart = new three.Vector3();
  const localMiddle = new three.Vector3();
  const localEnd = new three.Vector3();
  model.updateMatrixWorld(true);
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const position = mesh.geometry.getAttribute("position");
    if (!position || position.itemSize < 3) return;
    const index = mesh.geometry.getIndex();
    const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
    const vertexIndex = (triangle: number, corner: number) => index ? index.getX(triangle * 3 + corner) : triangle * 3 + corner;
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      localStart.fromBufferAttribute(position, vertexIndex(triangle, 0)).applyMatrix4(mesh.matrixWorld);
      localMiddle.fromBufferAttribute(position, vertexIndex(triangle, 1)).applyMatrix4(mesh.matrixWorld);
      localEnd.fromBufferAttribute(position, vertexIndex(triangle, 2)).applyMatrix4(mesh.matrixWorld);
      const intersections: THREE.Vector3[] = [];
      addEdgeIntersections(intersections, localStart, localMiddle, planeOrigin, planeNormal);
      addEdgeIntersections(intersections, localMiddle, localEnd, planeOrigin, planeNormal);
      addEdgeIntersections(intersections, localEnd, localStart, planeOrigin, planeNormal);
      if (intersections.length < 2) continue;
      for (let index = 1; index < intersections.length; index += 1) {
        segments.push({ start: intersections[0], end: intersections[index] });
      }
    }
  });
  return segments;
}

function pointKey(point: THREE.Vector3): string {
  return `${Math.round(point.x / NODE_EPSILON)},${Math.round(point.y / NODE_EPSILON)},${Math.round(point.z / NODE_EPSILON)}`;
}

function edgeKey(start: string, end: string): string {
  return start < end ? `${start}|${end}` : `${end}|${start}`;
}

function polygonArea(points: THREE.Vector3[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.z - next.x * current.z;
  }
  return Math.abs(area) / 2;
}

function polygonContains(points: THREE.Vector3[], x: number, z: number): boolean {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const current = points[index];
    const prior = points[previous];
    const crosses = (current.z > z) !== (prior.z > z);
    if (crosses && x < ((prior.x - current.x) * (z - current.z)) / (prior.z - current.z) + current.x) inside = !inside;
  }
  return inside;
}

function contourCenter(three: ThreeModule, points: THREE.Vector3[]): THREE.Vector3 {
  const center = new three.Vector3();
  points.forEach((point) => center.add(point));
  return center.multiplyScalar(1 / Math.max(points.length, 1));
}

function contourCandidates(three: ThreeModule, segments: PlaneSegment[], target: THREE.Vector3): THREE.Vector3[][] {
  const nodes = new Map<string, ContourNode>();
  const edges = new Set<string>();
  segments.forEach((segment) => {
    const startKey = pointKey(segment.start);
    const endKey = pointKey(segment.end);
    if (startKey === endKey) return;
    if (!nodes.has(startKey)) nodes.set(startKey, { point: segment.start.clone(), neighbors: new Set() });
    if (!nodes.has(endKey)) nodes.set(endKey, { point: segment.end.clone(), neighbors: new Set() });
    const key = edgeKey(startKey, endKey);
    if (edges.has(key)) return;
    edges.add(key);
    nodes.get(startKey)?.neighbors.add(endKey);
    nodes.get(endKey)?.neighbors.add(startKey);
  });

  const visited = new Set<string>();
  const contours: THREE.Vector3[][] = [];
  const walk = (startKey: string, firstNextKey: string): void => {
    const firstEdge = edgeKey(startKey, firstNextKey);
    if (visited.has(firstEdge)) return;
    visited.add(firstEdge);
    const points: THREE.Vector3[] = [nodes.get(startKey)!.point.clone()];
    let previousKey = startKey;
    let currentKey = firstNextKey;
    for (let step = 0; step < nodes.size + 2; step += 1) {
      const current = nodes.get(currentKey);
      if (!current) return;
      points.push(current.point.clone());
      if (currentKey === startKey) {
        points.pop();
        if (points.length >= 8 && polygonArea(points) > 0.00005) contours.push(points);
        return;
      }
      const nextKeys = [...current.neighbors].filter((candidate) => candidate !== previousKey);
      if (nextKeys.length === 0) return;
      const nextKey = nextKeys.find((candidate) => !visited.has(edgeKey(currentKey, candidate))) ?? nextKeys[0];
      visited.add(edgeKey(currentKey, nextKey));
      previousKey = currentKey;
      currentKey = nextKey;
    }
  };

  nodes.forEach((node, startKey) => {
    node.neighbors.forEach((nextKey) => walk(startKey, nextKey));
  });
  return contours;
}

/**
 * Return the closed mesh contour nearest the requested point on an arbitrary
 * plane. The returned points are in world coordinates, so they can be added
 * directly to a guide group that shares the model's scene parent.
 */
export function extractModelPlaneContour(three: ThreeModule, model: THREE.Object3D, planeOrigin: THREE.Vector3, planeNormal: THREE.Vector3, target: THREE.Vector3 = planeOrigin): THREE.Vector3[] | null {
  const normal = planeNormal.clone().normalize();
  if (normal.lengthSq() === 0) return null;
  const segments = worldPlaneSegments(three, model, planeOrigin, normal);
  if (segments.length === 0) return null;
  const candidates = contourCandidates(three, segments, target);
  if (candidates.length === 0) return null;
  const containing = candidates.filter((candidate) => polygonContains(candidate, target.x, target.z));
  const pool = containing.length > 0 ? containing : candidates;
  return pool.sort((left, right) => {
    const leftCenter = contourCenter(three, left);
    const rightCenter = contourCenter(three, right);
    const leftScore = leftCenter.distanceToSquared(target) + 0.00001 / Math.max(polygonArea(left), 0.00005);
    const rightScore = rightCenter.distanceToSquared(target) + 0.00001 / Math.max(polygonArea(right), 0.00005);
    return leftScore - rightScore;
  })[0] ?? null;
}
