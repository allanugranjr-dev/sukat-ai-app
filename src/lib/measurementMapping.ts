import type { Measurement } from "./types";

export type ModelMeasurementDimension = "circumference" | "length" | "width";
export type ModelMeasurementSide = "left" | "right";
export type ModelMeasurementMatchOptions = {
  dimension?: ModelMeasurementDimension;
  side?: ModelMeasurementSide | "none";
};

/** Normalize provider keys so aliases such as `shoulder breadth` remain usable. */
export function normalizeModelMeasurementKey(value: string): string {
  return value
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function hasAnyToken(tokens: string[], values: string[]): boolean {
  return values.some((value) => tokens.includes(value));
}

function matchesMeasurementShape(key: string, options: ModelMeasurementMatchOptions): boolean {
  const tokens = key.split("_");
  const hasLeft = tokens.includes("left");
  const hasRight = tokens.includes("right");
  if (options.side === "left" && hasRight) return false;
  if (options.side === "right" && hasLeft) return false;
  if (options.side === "none" && (hasLeft || hasRight)) return false;
  if (!options.dimension) return true;

  const circumferenceTokens = ["circumference", "girth", "around"];
  const widthTokens = ["width", "breadth"];
  const lengthTokens = ["length", "height", "depth", "inseam", "outseam", "rise", "to"];
  const hasCircumference = hasAnyToken(tokens, circumferenceTokens);
  const hasWidth = hasAnyToken(tokens, widthTokens);
  const hasLength = hasAnyToken(tokens, lengthTokens);
  if (options.dimension === "circumference") return !hasWidth && !hasLength;
  if (hasCircumference) return false;
  if (options.dimension === "width") return hasWidth || (!hasLength && !hasWidth);
  return !hasWidth && !hasLength ? true : hasLength;
}

export function findModelMeasurement(measurements: Measurement[], aliases: string[], options: ModelMeasurementMatchOptions = {}): Measurement | undefined {
  const normalizedAliases = aliases.map(normalizeModelMeasurementKey);
  let best: { measurement: Measurement; score: number } | undefined;
  measurements.forEach((measurement) => {
    const key = normalizeModelMeasurementKey(measurement.key);
    if (!matchesMeasurementShape(key, options)) return;
    const keyTokens = key.split("_");
    normalizedAliases.forEach((alias, aliasIndex) => {
      if (options.dimension === "length" && alias === "arm" && key !== "arm" && !keyTokens.includes("length") && !keyTokens.includes("sleeve")) return;
      const aliasTokens = alias.split("_");
      const score = key === alias
        ? 1000 - aliasIndex
        : key.startsWith(`${alias}_`)
          ? 700 - aliasIndex
          : key.endsWith(`_${alias}`)
            ? 500 - aliasIndex
            : aliasTokens.every((token) => keyTokens.includes(token))
              ? 300 - aliasIndex
              : 0;
      const sideBonus = options.side && options.side !== "none" && keyTokens.includes(options.side) ? 80 : 0;
      if (score + sideBonus > (best?.score ?? 0)) best = { measurement, score: score + sideBonus };
    });
  });
  return best?.measurement;
}

export function modelMeasurementCm(measurements: Measurement[], aliases: string[], fallback: number, options: ModelMeasurementMatchOptions = {}): number {
  let measurement: Measurement | undefined;
  if (options.side && options.side !== "none") {
    const sideAliases = aliases.flatMap((alias) => [`${alias}_${options.side}`, `${options.side}_${alias}`]);
    measurement = findModelMeasurement(measurements, sideAliases, options) ?? findModelMeasurement(measurements, aliases, { ...options, side: "none" });
  } else {
    measurement = findModelMeasurement(measurements, aliases, options);
  }
  if (!measurement) return fallback;
  const adjusted = Number(measurement.adjusted_value);
  const providerValue = Number(measurement.value);
  const value = Number.isFinite(adjusted) && adjusted > 0 ? adjusted : providerValue;
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return measurement.unit === "in" ? value * 2.54 : value;
}

export function modelHeightCm(heightValue: number | null | undefined, heightUnit: "cm" | "ftin"): number {
  const value = Number(heightValue);
  if (heightValue === null || heightValue === undefined || !Number.isFinite(value) || value <= 0) return 170;
  return heightUnit === "ftin" ? value * 2.54 : value;
}

/** Return ellipse radii in model units for a target circumference in centimetres. */
export function ellipseRadiiForCircumference(circumferenceCm: number, depthRatio: number, modelUnitsPerCm: number): [number, number] {
  if (![circumferenceCm, depthRatio, modelUnitsPerCm].every(Number.isFinite) || circumferenceCm <= 0 || depthRatio <= 0 || modelUnitsPerCm <= 0) return [0, 0];
  const perimeterForUnitWidth = Math.PI * (3 * (1 + depthRatio) - Math.sqrt((3 + depthRatio) * (1 + 3 * depthRatio)));
  const widthRadiusCm = circumferenceCm / perimeterForUnitWidth;
  return [widthRadiusCm * modelUnitsPerCm, widthRadiusCm * depthRatio * modelUnitsPerCm];
}

/** Reconstruct the circumference represented by model-space ellipse radii. */
export function ellipseCircumferenceFromRadii(widthRadius: number, depthRadius: number, modelUnitsPerCm: number): number {
  if (![widthRadius, depthRadius, modelUnitsPerCm].every(Number.isFinite) || widthRadius <= 0 || depthRadius <= 0 || modelUnitsPerCm <= 0) return 0;
  const widthRadiusCm = widthRadius / modelUnitsPerCm;
  const depthRadiusCm = depthRadius / modelUnitsPerCm;
  return Math.PI * (3 * (widthRadiusCm + depthRadiusCm) - Math.sqrt((3 * widthRadiusCm + depthRadiusCm) * (widthRadiusCm + 3 * depthRadiusCm)));
}
