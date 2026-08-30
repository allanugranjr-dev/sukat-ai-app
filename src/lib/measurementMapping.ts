import type { Measurement } from "./types";

/** Normalize provider keys so aliases such as `shoulder breadth` remain usable. */
export function normalizeModelMeasurementKey(value: string): string {
  return value
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function findModelMeasurement(measurements: Measurement[], aliases: string[]): Measurement | undefined {
  const normalizedAliases = aliases.map(normalizeModelMeasurementKey);
  let best: { measurement: Measurement; score: number } | undefined;
  measurements.forEach((measurement) => {
    const key = normalizeModelMeasurementKey(measurement.key);
    const keyTokens = key.split("_");
    normalizedAliases.forEach((alias, aliasIndex) => {
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
      if (score > (best?.score ?? 0)) best = { measurement, score };
    });
  });
  return best?.measurement;
}

export function modelMeasurementCm(measurements: Measurement[], aliases: string[], fallback: number): number {
  const measurement = findModelMeasurement(measurements, aliases);
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
