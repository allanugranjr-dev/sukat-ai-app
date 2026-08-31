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

const measuredGuideKeys = new Set([
  "height", "inseam", "foot_length", "foot_length_left", "foot_length_right", "foot_width", "foot_width_left", "foot_width_right",
  "back_to_shoulder", "neck_to_pelvis", "ankle", "ankle_left", "ankle_right", "wrist", "wrist_left", "wrist_right",
  "forearm", "forearm_left", "forearm_right", "arm_length", "arm_length_left", "arm_length_right", "upper_arm", "upper_arm_left", "upper_arm_right",
  "shoulder", "head", "neck", "chest", "waist", "hip", "thigh", "thigh_left", "thigh_right", "calf", "calf_left", "calf_right",
]);

function measurementSideSuffix(tokens: string[]): "_left" | "_right" | "" {
  if (tokens.includes("left") && !tokens.includes("right")) return "_left";
  if (tokens.includes("right") && !tokens.includes("left")) return "_right";
  return "";
}

function hasAnyToken(tokens: string[], values: string[]): boolean {
  return values.some((value) => tokens.includes(value));
}

/** Resolve a provider measurement label to the guide rendered by the 3D viewer. */
export function measurementGuideKey(key: string): string | null {
  const normalized = normalizeModelMeasurementKey(key);
  if (!normalized) return null;
  const tokens = normalized.split("_");
  const sideSuffix = measurementSideSuffix(tokens);
  const hasLengthToken = hasAnyToken(tokens, ["length", "height", "depth", "inseam", "outseam", "rise"]);
  const hasFootToken = hasAnyToken(tokens, ["foot", "feet"]);
  const hasArmToken = hasAnyToken(tokens, ["arm", "arms"]);
  const hasUpperArmToken = tokens.includes("upper") && hasArmToken;
  const hasShoulderToken = hasAnyToken(tokens, ["shoulder", "shoulders"]);

  let resolved: string;
  if (tokens.includes("inseam") || (tokens.includes("inside") && tokens.includes("leg"))) {
    resolved = "inseam";
  } else if (hasAnyToken(tokens, ["height", "stature"]) && !hasFootToken && !hasArmToken) {
    resolved = "height";
  } else if (hasFootToken && tokens.includes("length")) {
    resolved = `foot_length${sideSuffix}`;
  } else if (hasFootToken && hasAnyToken(tokens, ["width", "breadth"])) {
    resolved = `foot_width${sideSuffix}`;
  } else if (normalized.includes("back_to_shoulder") || (tokens.includes("back") && hasShoulderToken && tokens.includes("to"))) {
    resolved = "back_to_shoulder";
  } else if (normalized.includes("neck_to_pelvis") || (tokens.includes("neck") && tokens.includes("pelvis") && tokens.includes("to"))) {
    resolved = "neck_to_pelvis";
  } else if (hasAnyToken(tokens, ["ankle", "ankles"])) {
    resolved = `ankle${sideSuffix}`;
  } else if (hasAnyToken(tokens, ["wrist", "wrists"])) {
    resolved = `wrist${sideSuffix}`;
  } else if (hasAnyToken(tokens, ["forearm", "forearms"])) {
    resolved = `forearm${sideSuffix}`;
  } else if ((hasUpperArmToken || hasAnyToken(tokens, ["bicep", "biceps"])) && !hasLengthToken) {
    resolved = `upper_arm${sideSuffix}`;
  } else if (normalized === "arm" || normalized === "arms" || tokens.includes("sleeve") || (hasArmToken && (hasLengthToken || (Boolean(sideSuffix) && !hasUpperArmToken)))) {
    resolved = `arm_length${sideSuffix}`;
  } else if (hasShoulderToken) {
    resolved = "shoulder";
  } else if (tokens.includes("head")) {
    resolved = "head";
  } else if (tokens.includes("neck")) {
    resolved = "neck";
  } else if (hasAnyToken(tokens, ["bust", "chest"])) {
    resolved = "chest";
  } else if (tokens.includes("waist")) {
    resolved = "waist";
  } else if (hasAnyToken(tokens, ["hip", "hips"])) {
    resolved = "hip";
  } else if (hasAnyToken(tokens, ["thigh", "thighs"])) {
    resolved = `thigh${sideSuffix}`;
  } else if (hasAnyToken(tokens, ["calf", "calves"])) {
    resolved = `calf${sideSuffix}`;
  } else {
    resolved = normalized;
  }
  return measuredGuideKeys.has(resolved) ? resolved : null;
}

/**
 * Match a selected provider key to one rendered guide and keep generic
 * measurements (for example `forearm`) linked to both side-specific guides.
 * A side-specific selection never falls back to the opposite side.
 */
export function measurementGuideMatches(measurementKey: string, guideKeys: readonly string[]): boolean {
  const target = measurementGuideKey(measurementKey);
  if (!target) return false;
  const targetHasSide = /_(left|right)$/.test(target);
  const targetBase = target.replace(/_(left|right)$/, "");
  return guideKeys.some((guideKey) => {
    const normalizedGuideKey = normalizeModelMeasurementKey(guideKey);
    if (normalizedGuideKey === target) return true;
    const resolvedGuideKey = measurementGuideKey(guideKey);
    if (resolvedGuideKey === target) return true;
    if (!resolvedGuideKey) return false;
    if (targetHasSide) return false;
    return resolvedGuideKey.replace(/_(left|right)$/, "") === targetBase;
  });
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
