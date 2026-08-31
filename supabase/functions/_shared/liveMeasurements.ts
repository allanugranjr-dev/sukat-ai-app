export type NormalizedLiveMeasurement = {
  key: string;
  value: number;
  unit: "cm" | "in";
  confidence: number | null;
};

export type NormalizedLiveResult = {
  measurements: NormalizedLiveMeasurement[];
  processing_version: string;
};

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeKey(value: string): string {
  return value
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function validConfidence(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100);
}

function parseMeasurement(key: unknown, raw: unknown, confidenceOverride?: unknown): NormalizedLiveMeasurement {
  if (typeof key !== "string") throw new Error("The measurement provider returned a measurement without a key.");
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey || normalizedKey.length > 80) throw new Error("The measurement provider returned an invalid measurement key.");

  const record = isRecord(raw) ? raw : null;
  const value = record ? record.value : raw;
  const unit = record?.unit ?? "cm";
  const confidence = record?.confidence ?? confidenceOverride;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`The measurement provider returned an invalid value for ${normalizedKey}.`);
  if (unit !== "cm" && unit !== "in") throw new Error(`The measurement provider returned an invalid unit for ${normalizedKey}.`);
  if (!validConfidence(confidence)) throw new Error(`The measurement provider returned an invalid confidence for ${normalizedKey}.`);
  return { key: normalizedKey, value, unit, confidence: confidence ?? null };
}

/**
 * Convert the response emitted by JavTahir/Live-Measurements-Api into the
 * result shape persisted by SukatAI. The upstream service returns a map such
 * as { chest_circumference: 100.1 }, not SukatAI's array contract.
 */
export function normalizeLiveMeasurementsResponse(payload: unknown): NormalizedLiveResult {
  if (!isRecord(payload)) throw new Error("The live measurement provider returned a non-object response.");
  const source = payload.measurements;
  if (!Array.isArray(source) && !isRecord(source)) throw new Error("The live measurement provider did not return measurements.");

  const measurements: NormalizedLiveMeasurement[] = [];
  if (Array.isArray(source)) {
    source.forEach((item) => {
      if (!isRecord(item)) throw new Error("The live measurement provider returned an invalid measurement entry.");
      measurements.push(parseMeasurement(item.key, item.value, item.confidence));
    });
  } else {
    const confidenceMap = isRecord(payload.confidence) ? payload.confidence : null;
    Object.entries(source).forEach(([key, value]) => {
      measurements.push(parseMeasurement(key, value, confidenceMap?.[key]));
    });
  }

  if (measurements.length === 0) throw new Error("The live measurement provider returned no measurements.");
  const keys = measurements.map((measurement) => measurement.key);
  if (new Set(keys).size !== keys.length) throw new Error("The live measurement provider returned duplicate measurement keys.");
  const processingVersion = typeof payload.processing_version === "string" && payload.processing_version.trim()
    ? payload.processing_version.trim().slice(0, 120)
    : "live-measurements-api";
  return { measurements, processing_version: processingVersion };
}
