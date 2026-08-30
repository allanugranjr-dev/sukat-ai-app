import type { Measurement } from "./types";

/** Normalize provider keys so aliases such as `shoulder breadth` remain usable. */
export function normalizeModelMeasurementKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function findModelMeasurement(measurements: Measurement[], aliases: string[]): Measurement | undefined {
  const normalizedAliases = aliases.map(normalizeModelMeasurementKey);
  return measurements.find((measurement) => {
    const key = normalizeModelMeasurementKey(measurement.key);
    const keyTokens = key.split("_");
    return normalizedAliases.some((alias) => {
      const aliasTokens = alias.split("_");
      return key === alias
        || key.startsWith(`${alias}_`)
        || key.endsWith(`_${alias}`)
        || aliasTokens.every((token) => keyTokens.includes(token));
    });
  });
}

export function modelMeasurementCm(measurements: Measurement[], aliases: string[], fallback: number): number {
  const measurement = findModelMeasurement(measurements, aliases);
  const value = Number(measurement?.adjusted_value ?? measurement?.value);
  if (!measurement || !Number.isFinite(value) || value <= 0) return fallback;
  return measurement.unit === "in" ? value * 2.54 : value;
}

export function modelHeightCm(heightValue: number | null | undefined, heightUnit: "cm" | "ftin"): number {
  const value = Number(heightValue);
  if (heightValue === null || heightValue === undefined || !Number.isFinite(value) || value <= 0) return 170;
  return heightUnit === "ftin" ? value * 2.54 : value;
}
