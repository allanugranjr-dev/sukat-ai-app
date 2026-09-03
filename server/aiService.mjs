import fs from "node:fs/promises";
import path from "node:path";

import { config } from "./config.mjs";

const AI_PROVIDERS = new Set(["ai-service"]);
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,100}$/;

function providerEnabled() {
  const provider = config.reconstruction.provider;
  return provider !== "local" && (AI_PROVIDERS.has(provider) || Boolean(config.reconstruction.apiUrl));
}

function endpointUrl() {
  const configured = config.reconstruction.apiUrl || "http://127.0.0.1:8000";
  if (/\/api\/v1\/body-scan$/i.test(configured)) return configured;
  return `${configured}/api/v1/body-scan`;
}

function authorizationHeaders() {
  if (!config.reconstruction.apiKey) return {};
  return {
    Authorization: `Bearer ${config.reconstruction.apiKey}`,
    "X-API-Key": config.reconstruction.apiKey,
  };
}

function safeSegment(value, fallback) {
  const normalized = String(value ?? "").trim();
  return SAFE_SEGMENT.test(normalized) ? normalized : fallback;
}

function safeStoragePath(storageDirectory, relativePath) {
  const relative = String(relativePath ?? "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!relative || relative.split("/").some((part) => !part || part === "." || part === ".." || /[\u0000-\u001f\u007f]/.test(part))) {
    throw new Error("The scan asset path is invalid.");
  }
  const root = path.resolve(storageDirectory);
  const file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) throw new Error("The scan asset path escaped storage.");
  return file;
}

function jsonValue(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function contentType(asset) {
  const metadata = jsonValue(asset.metadata);
  const value = typeof metadata.content_type === "string" ? metadata.content_type : "image/jpeg";
  return ["image/jpeg", "image/png", "image/webp"].includes(value) ? value : "application/octet-stream";
}

function extensionFor(asset) {
  const original = String(jsonValue(asset.metadata).original_name ?? "");
  const extension = path.extname(original).toLowerCase().replace(/[^a-z0-9.]/g, "");
  return [".jpg", ".jpeg", ".png", ".webp"].includes(extension) ? extension : ".jpg";
}

function normalizeProviderError(payload, fallback) {
  const body = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  if (!body || typeof body !== "object") return fallback;
  const message = [body.error, body.message, body.detail, body.status_message]
    .find((value) => typeof value === "string" && value.trim());
  const guidance = Array.isArray(body.quality_issues)
    ? body.quality_issues
      .map((issue) => {
        if (typeof issue === "string") return issue.trim();
        if (!issue || typeof issue !== "object") return "";
        const issueMessage = typeof issue.message === "string" ? issue.message.trim() : "";
        const view = typeof issue.view === "string" ? issue.view.trim() : "";
        return issueMessage && view ? `${view}: ${issueMessage}` : issueMessage;
      })
      .filter(Boolean)
    : [];
  const base = typeof message === "string" && message.trim() ? message.trim() : fallback;
  const extra = guidance.filter((item) => !base.toLowerCase().includes(item.toLowerCase()));
  return `${base}${extra.length ? ` ${extra.join(" ")}` : ""}`.slice(0, 1000);
}

function normalizeMeasurement(measurement) {
  const key = typeof measurement?.key === "string" ? measurement.key.trim() : "";
  const method = typeof measurement?.method === "string" ? measurement.method.trim() : "";
  const source = typeof measurement?.source === "string" ? measurement.source.trim() : "";
  const rawValue = Number(measurement?.value);
  const unit = measurement?.unit === "in" ? "in" : "cm";
  const value = unit === "in" ? rawValue * 2.54 : rawValue;
  if (!key || !method || !source || method.length > 40 || source.length > 120 || !Number.isFinite(value) || value <= 0 || value >= 500) return null;
  const rawConfidence = measurement?.confidence;
  const confidence = rawConfidence === null || rawConfidence === undefined || rawConfidence === ""
    ? null
    : Number(rawConfidence);
  return {
    key,
    value: Math.round(value * 100) / 100,
    unit: "cm",
    confidence: confidence !== null && Number.isFinite(confidence) && confidence >= 0 && confidence <= 100 ? confidence : null,
    ai_value: Math.round(value * 100) / 100,
    adjusted_value: null,
    adjusted_by: null,
    adjustment_reason: null,
    verified_at: null,
    method,
    source,
  };
}

function roundGuideNumber(value) {
  return Math.round(value * 100000) / 100000;
}

/**
 * Validate the provider-authored contour contract before any guide reaches
 * the browser. Points are in the same local coordinates as the exported GLB.
 */
export function normalizeProviderGuideGeometry(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The reconstruction provider returned invalid guide geometry.");
  if (value.coordinate_system !== "glb-y-up-right-handed" || value.units !== "m" || value.up_axis !== "y") {
    throw new Error("The reconstruction provider returned an unsupported guide coordinate system.");
  }
  const calibratedHeight = Number(value.calibrated_height_cm);
  if (!Number.isFinite(calibratedHeight) || calibratedHeight <= 0 || calibratedHeight > 500) {
    throw new Error("The reconstruction provider returned an invalid guide height.");
  }
  if (!value.contours || typeof value.contours !== "object" || Array.isArray(value.contours)) {
    throw new Error("The reconstruction provider returned invalid guide contours.");
  }
  const contours = {};
  for (const [key, rawContour] of Object.entries(value.contours)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || !rawContour || typeof rawContour !== "object" || Array.isArray(rawContour)) {
      throw new Error("The reconstruction provider returned an invalid guide contour key.");
    }
    const levelFraction = Number(rawContour.level_fraction);
    const levelHeight = Number(rawContour.level_height_cm);
    const points = rawContour.points;
    if (!Number.isFinite(levelFraction) || levelFraction <= 0.05 || levelFraction >= 0.99 || !Number.isFinite(levelHeight) || levelHeight <= 0 || levelHeight > calibratedHeight || Math.abs(levelHeight - levelFraction * calibratedHeight) > Math.max(0.25, calibratedHeight * 0.01) || !Array.isArray(points) || points.length < 8 || points.length > 2048) {
      throw new Error(`The reconstruction provider returned an invalid ${key} guide contour.`);
    }
    const normalizedPoints = points.map((point) => {
      if (!Array.isArray(point) || point.length !== 3 || point.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate) || Math.abs(coordinate) > 100)) {
        throw new Error(`The reconstruction provider returned invalid points for the ${key} guide contour.`);
      }
      return point.map(roundGuideNumber);
    });
    const source = typeof rawContour.source === "string" ? rawContour.source.trim() : "";
    if (!source || source.length > 120) throw new Error(`The reconstruction provider returned no contour source for ${key}.`);
    contours[key] = {
      level_fraction: roundGuideNumber(levelFraction),
      level_height_cm: roundGuideNumber(levelHeight),
      points: normalizedPoints,
      source,
    };
  }
  return {
    coordinate_system: "glb-y-up-right-handed",
    units: "m",
    up_axis: "y",
    calibrated_height_cm: roundGuideNumber(calibratedHeight),
    contours,
  };
}

function normalizeReconstruction(value) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The reconstruction provider returned invalid reconstruction metadata.");
  const reconstruction = { ...value };
  if (Object.prototype.hasOwnProperty.call(reconstruction, "guide_geometry")) {
    reconstruction.guide_geometry = normalizeProviderGuideGeometry(reconstruction.guide_geometry);
  }
  return reconstruction;
}

export function normalizeProviderResponse(payload, expectedScanId) {
  const result = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  if (!result || typeof result !== "object") throw new Error("The reconstruction provider returned an empty response.");
  if (String(result.scan_id ?? "") !== String(expectedScanId)) throw new Error("The reconstruction provider returned the wrong scan id.");
  if (String(result.status ?? "").toLowerCase() === "failed") {
    throw new Error(normalizeProviderError(result, "The reconstruction provider failed this scan."));
  }
  const measurements = Array.isArray(result.measurements) ? result.measurements.map(normalizeMeasurement).filter(Boolean) : [];
  if (measurements.length === 0) throw new Error("The reconstruction provider returned no valid measurements.");
  const keys = new Set();
  for (const measurement of measurements) {
    const normalized = measurement.key.toLowerCase();
    if (keys.has(normalized)) throw new Error("The reconstruction provider returned duplicate measurement keys.");
    keys.add(normalized);
  }
  const model = result.model && typeof result.model === "object" ? result.model : null;
  const modelUrl = typeof model?.url === "string"
    ? model.url
    : typeof model?.path === "string"
      ? model.path
      : typeof model?.model_url_or_path === "string"
        ? model.model_url_or_path
        : "";
  if (!modelUrl) throw new Error("The reconstruction provider returned measurements without a GLB model.");
  const processingVersion = typeof result.processing_version === "string" && result.processing_version.trim()
    ? result.processing_version.trim().slice(0, 80)
    : null;
  if (!processingVersion) throw new Error("The reconstruction provider did not report a processing version.");
  if (!result.reconstruction || typeof result.reconstruction !== "object" || Array.isArray(result.reconstruction)) {
    throw new Error("The reconstruction provider did not return reconstruction metadata.");
  }
  const quality = typeof result.scan_quality === "string" && result.scan_quality.trim()
    ? result.scan_quality.trim().slice(0, 40)
    : null;
  return {
    scanId: String(result.scan_id ?? expectedScanId),
    measurements,
    modelUrl,
    modelFormat: model?.format === "gltf" ? "gltf" : "glb",
    quality,
    qualityIssues: Array.isArray(result.quality_issues) ? result.quality_issues : [],
    reconstruction: normalizeReconstruction(result.reconstruction),
    processingVersion,
  };
}

async function readProviderJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 1000) };
  }
}

function providerStatusUrl(payload, endpoint) {
  const body = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const reference = typeof body?.status_url === "string" ? body.status_url.trim() : "";
  if (!reference) throw new Error("The reconstruction provider accepted the scan without a status URL.");
  let providerEndpoint;
  let statusUrl;
  try {
    providerEndpoint = new URL(endpoint);
    statusUrl = new URL(reference, providerEndpoint);
  } catch {
    throw new Error("The reconstruction provider returned an invalid status URL.");
  }
  if (statusUrl.username || statusUrl.password || statusUrl.origin !== providerEndpoint.origin) {
    throw new Error("The reconstruction provider returned a status URL outside its configured endpoint.");
  }
  return statusUrl.toString();
}

function pendingProviderResult(payload) {
  const body = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const status = typeof body?.status === "string" ? body.status.trim().toLowerCase() : "";
  return status === "queued" || status === "validating" || status === "processing";
}

function providerProgress(payload) {
  const body = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const status = typeof body?.status === "string" ? body.status.trim().toLowerCase() : "";
  if (!["queued", "validating", "processing"].includes(status)) return null;
  const rawProgress = Number(body?.progress);
  return {
    status,
    progress: Number.isFinite(rawProgress) ? Math.min(99, Math.max(0, Math.round(rawProgress))) : null,
    message: typeof body?.status_message === "string"
      ? body.status_message.trim().slice(0, 240)
      : typeof body?.message === "string"
        ? body.message.trim().slice(0, 240)
        : null,
  };
}

async function awaitProviderPayload(initialResponse, endpoint, onProgress) {
  let response = initialResponse;
  let statusUrl = "";
  const deadline = Date.now() + config.reconstruction.timeoutMs;
  while (true) {
    const payload = await readProviderJson(response);
    if (!response.ok && response.status !== 202) {
      throw new Error(`The reconstruction provider returned ${response.status}: ${normalizeProviderError(payload, "unknown error")}`);
    }
    const progress = providerProgress(payload);
    if (progress) await onProgress?.(progress);
    // A provider may use 202 for both an accepted job and a result that was
    // completed immediately. The payload status is authoritative, so only
    // poll when it explicitly says that work is still pending.
    if (!pendingProviderResult(payload)) return payload;
    statusUrl ||= providerStatusUrl(payload, endpoint);
    const retryAfter = Number(payload?.retry_after_ms ?? payload?.data?.retry_after_ms);
    const delayMs = Number.isFinite(retryAfter) ? Math.min(10_000, Math.max(250, retryAfter)) : 1_000;
    if (Date.now() + delayMs >= deadline) throw new Error("The reconstruction provider timed out while processing the scan.");
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      response = await fetch(statusUrl, {
        headers: authorizationHeaders(),
        signal: AbortSignal.timeout(Math.max(1_000, deadline - Date.now())),
      });
    } catch (error) {
      throw new Error(`The reconstruction provider status request failed: ${error instanceof Error ? error.message : "network error"}`);
    }
  }
}

async function downloadModel(modelUrl, endpoint, scan, attemptId = null) {
  let url;
  let providerEndpoint;
  try {
    providerEndpoint = new URL(endpoint);
  } catch {
    throw new Error("The reconstruction provider endpoint is invalid.");
  }
  if (providerEndpoint.username || providerEndpoint.password) throw new Error("The reconstruction provider endpoint must not contain credentials.");
  const modelReference = String(modelUrl ?? "").trim();
  if (!modelReference || modelReference.startsWith("//")) throw new Error("The reconstruction provider returned an invalid model URL.");
  try {
    url = new URL(modelReference, providerEndpoint).toString();
  } catch {
    throw new Error("The reconstruction provider returned an invalid model URL.");
  }
  const resolved = new URL(url);
  const localDevelopment = config.nodeEnv === "development";
  const httpAllowed = resolved.protocol === "http:" && localDevelopment && ["localhost", "127.0.0.1", "::1"].includes(resolved.hostname);
  if (resolved.protocol !== "https:" && !httpAllowed) throw new Error("The reconstruction provider returned an unsupported model URL.");
  if (resolved.username || resolved.password || resolved.origin !== providerEndpoint.origin) {
    throw new Error("The reconstruction provider returned a model URL outside its configured endpoint.");
  }
  const response = await fetch(url, {
    headers: authorizationHeaders(),
    signal: AbortSignal.timeout(config.reconstruction.timeoutMs),
  });
  if (!response.ok) {
    const payload = await readProviderJson(response);
    throw new Error(`The provider model download failed (${response.status}): ${normalizeProviderError(payload, "unknown error")}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 16) throw new Error("The provider returned an empty model file.");
  if (buffer.length > config.reconstruction.maxModelBytes) throw new Error("The provider model is larger than the configured limit.");
  const organization = safeSegment(scan.organization_id, "unassigned");
  const customer = safeSegment(scan.customer_id, "customer");
  const scanId = safeSegment(scan.id, "scan");
  const safeAttempt = safeSegment(attemptId, "latest");
  const relativePath = `body-models/${organization}/${customer}/${scanId}/model-${safeAttempt}.glb`;
  const destination = safeStoragePath(config.storageDirectory, relativePath);
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await fs.writeFile(destination, buffer, { mode: 0o600 });
  return { relativePath, bytes: buffer.length };
}

export async function processWithAiService(scan, assets, options = {}) {
  if (!providerEnabled()) return null;
  if (!config.reconstruction.apiUrl && config.reconstruction.provider !== "ai-service") {
    throw new Error("A reconstruction provider URL is required. Set RECONSTRUCTION_API_URL or AI_SERVICE_URL.");
  }
  const endpoint = endpointUrl();
  const form = new FormData();
  for (const assetType of ["front", "side"]) {
    const asset = assets.find((candidate) => candidate.asset_type === assetType);
    if (!asset) throw new Error(`The ${assetType} scan view is missing.`);
    const filePath = safeStoragePath(config.storageDirectory, asset.storage_path);
    const bytes = await fs.readFile(filePath);
    form.append(`${assetType}_image`, new Blob([bytes], { type: contentType(asset) }), `${assetType}${extensionFor(asset)}`);
  }
  const height = Number(scan.height_value) * (scan.height_unit === "ftin" ? 2.54 : 1);
  if (!Number.isFinite(height) || height <= 0) throw new Error("Enter a valid height before using the reconstruction provider.");
  form.append("height_cm", String(height));
  form.append("scan_id", String(scan.id));

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: authorizationHeaders(),
      body: form,
      signal: AbortSignal.timeout(config.reconstruction.timeoutMs),
    });
  } catch (error) {
    throw new Error(`The reconstruction provider could not be reached: ${error instanceof Error ? error.message : "network error"}`);
  }
  const payload = await awaitProviderPayload(response, endpoint, options.onProgress);
  const result = normalizeProviderResponse(payload, scan.id);
  const model = await downloadModel(result.modelUrl, endpoint, scan, options.attemptId);
  return { ...result, modelPath: model.relativePath, modelSizeBytes: model.bytes };
}

export function isAiProviderEnabled() {
  return providerEnabled();
}
