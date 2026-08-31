const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeKey(value) {
  return String(value)
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function validConfidence(value) {
  return value === undefined || value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100);
}

function parseMeasurement(key, raw, confidenceOverride) {
  if (typeof key !== "string") throw new Error("The live measurement provider returned a measurement without a key.");
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey || normalizedKey.length > 80) throw new Error("The live measurement provider returned an invalid measurement key.");
  const record = isRecord(raw) ? raw : null;
  const value = record ? record.value : raw;
  const unit = record?.unit ?? "cm";
  const confidence = record?.confidence ?? confidenceOverride;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`The live measurement provider returned an invalid value for ${normalizedKey}.`);
  if (unit !== "cm" && unit !== "in") throw new Error(`The live measurement provider returned an invalid unit for ${normalizedKey}.`);
  if (!validConfidence(confidence)) throw new Error(`The live measurement provider returned an invalid confidence for ${normalizedKey}.`);
  return { key: normalizedKey, value, unit, confidence: confidence ?? null };
}

export function isLiveMeasurementsProvider(provider) {
  return ["live-measurements-api", "live-measurements", "javtahir-live-measurements", "javtahir"].includes(String(provider ?? "").toLowerCase());
}

export function normalizeLiveMeasurementsResponse(payload) {
  if (!isRecord(payload)) throw new Error("The live measurement provider returned a non-object response.");
  const source = payload.measurements;
  if (!Array.isArray(source) && !isRecord(source)) throw new Error("The live measurement provider did not return measurements.");
  const measurements = [];
  if (Array.isArray(source)) {
    source.forEach((item) => {
      if (!isRecord(item)) throw new Error("The live measurement provider returned an invalid measurement entry.");
      measurements.push(parseMeasurement(item.key, item.value, item.confidence));
    });
  } else {
    const confidenceMap = isRecord(payload.confidence) ? payload.confidence : null;
    Object.entries(source).forEach(([key, value]) => measurements.push(parseMeasurement(key, value, confidenceMap?.[key])));
  }
  if (measurements.length === 0) throw new Error("The live measurement provider returned no measurements.");
  const keys = measurements.map((measurement) => measurement.key);
  if (new Set(keys).size !== keys.length) throw new Error("The live measurement provider returned duplicate measurement keys.");
  const processingVersion = typeof payload.processing_version === "string" && payload.processing_version.trim()
    ? payload.processing_version.trim().slice(0, 120)
    : "live-measurements-api";
  return { measurements, processing_version: processingVersion };
}

export function liveMeasurementsEndpoint(providerUrl) {
  const url = new URL(providerUrl);
  const pathname = url.pathname.replace(/\/+$/, "");
  if (!pathname || pathname === "/measurements") url.pathname = "/upload_images";
  return url.toString();
}

function contentTypeForAsset(asset) {
  const metadata = isRecord(asset?.metadata) ? asset.metadata : {};
  const metadataType = typeof metadata.content_type === "string" ? metadata.content_type.split(";", 1)[0].trim().toLowerCase() : "";
  if (["image/jpeg", "image/png", "image/webp"].includes(metadataType)) return metadataType;
  const path = String(asset?.storage_path ?? "").toLowerCase();
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function extensionForContentType(contentType) {
  return contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
}

function heightInCm(scan) {
  const value = Number(scan?.height_value);
  if (scan?.height_value === null || scan?.height_value === undefined || !Number.isFinite(value) || value <= 0) return null;
  const centimeters = scan.height_unit === "ftin" ? value * 2.54 : value;
  return Number.isFinite(centimeters) && centimeters >= 120 && centimeters <= 230 ? centimeters : null;
}

/**
 * Call the actual Flask contract from JavTahir/Live-Measurements-Api.
 * The caller supplies a private file reader so this module never exposes a
 * scan asset through a public URL.
 */
export async function callLiveMeasurementsProvider({ apiUrl, apiKey, scan, assets, readAsset, timeoutMs = 120_000 }) {
  const heightCm = heightInCm(scan);
  if (heightCm === null) throw new Error("Enter a valid height before processing this scan. The live measurement provider needs it for scale calibration.");
  const front = assets.find((asset) => asset.asset_type === "front");
  const side = assets.find((asset) => asset.asset_type === "side");
  if (!front || !side) throw new Error("Front and side views are required by the live measurement provider.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const [frontBuffer, sideBuffer] = await Promise.all([readAsset(front), readAsset(side)]);
    if (!frontBuffer || frontBuffer.byteLength === 0 || frontBuffer.byteLength > MAX_IMAGE_BYTES) throw new Error("The front scan view is outside the supported size range.");
    if (!sideBuffer || sideBuffer.byteLength === 0 || sideBuffer.byteLength > MAX_IMAGE_BYTES) throw new Error("The side scan view is outside the supported size range.");
    const frontType = contentTypeForAsset(front);
    const sideType = contentTypeForAsset(side);
    const form = new FormData();
    form.append("front", new Blob([frontBuffer], { type: frontType }), `front.${extensionForContentType(frontType)}`);
    form.append("left_side", new Blob([sideBuffer], { type: sideType }), `side.${extensionForContentType(sideType)}`);
    form.append("height_cm", heightCm.toFixed(2));
    let response;
    try {
      response = await fetch(liveMeasurementsEndpoint(apiUrl), {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error(`The live measurement provider timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`);
      throw error;
    }
    if (!response.ok) throw new Error(`Live measurement provider returned HTTP ${response.status}.`);
    return normalizeLiveMeasurementsResponse(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}
