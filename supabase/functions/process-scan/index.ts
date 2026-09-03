import { adminClient, AuthRequiredError, requireUser } from "../_shared/auth.ts";
import { jsonResponse, optionsResponse } from "../_shared/cors.ts";
import {
  claimProcessingAttempt,
  failProcessingAttempt,
  stageProcessingAttempt,
} from "../_shared/scanProcessingAttempt.ts";

type ProviderMeasurement = { key?: unknown; value?: unknown; unit?: unknown; confidence?: unknown; method?: unknown; source?: unknown };
type ValidProviderMeasurement = {
  key: string;
  value: number;
  unit: "cm" | "in";
  confidence: number | null;
  method: string;
  source: string;
};
type ProviderModel = { path?: unknown; url?: unknown; format?: unknown; size_bytes?: unknown; preview_path?: unknown; preview_data?: unknown };
type ScanForLocalProvider = { height_value: number | null; height_unit: string };
type ProcessingErrorCode = "invalid_request" | "missing_assets" | "provider_not_configured" | "provider_unavailable" | "provider_invalid_result" | "processing_failed";
type NormalizedProviderResult = {
  measurements: ValidProviderMeasurement[];
  body_model?: ProviderModel;
  processing_version: string | null;
  scan_quality?: unknown;
  quality_issues?: unknown;
  reconstruction?: unknown;
};
class ProcessingError extends Error {
  constructor(public readonly code: ProcessingErrorCode, public readonly status: number, message: string) {
    super(message);
    this.name = "ProcessingError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function heightInCm(scan: ScanForLocalProvider): number {
  const numericHeight = Number(scan.height_value);
  if (scan.height_value === null || scan.height_value === undefined || !Number.isFinite(numericHeight) || numericHeight <= 0) {
    throw new ProcessingError("invalid_request", 422, "A valid height is required for the reconstruction provider.");
  }
  return scan.height_unit === "ftin" ? numericHeight * 2.54 : numericHeight;
}

function validMeasurement(value: ProviderMeasurement): value is ValidProviderMeasurement {
  const numericValue = typeof value.value === "number" && Number.isFinite(value.value)
    ? value.unit === "in" ? value.value * 2.54 : value.value
    : Number.NaN;
  return typeof value.key === "string"
    && /^[A-Za-z0-9][A-Za-z0-9_:-]{0,79}$/.test(value.key.trim())
    && Number.isFinite(numericValue)
    && numericValue > 0
    && numericValue < 500
    && (value.unit === "cm" || value.unit === "in")
    && (value.confidence === undefined || value.confidence === null || (typeof value.confidence === "number" && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 100))
    && typeof value.method === "string"
    && value.method.trim().length > 0
    && value.method.length <= 40
    && typeof value.source === "string"
    && value.source.trim().length > 0
    && value.source.length <= 120;
}

function validModelReference(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 500 || /[\u0000-\u001f]/.test(value) || value.includes("..")) return false;
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }
  return !/^[a-z][a-z0-9+.-]*:/i.test(value);
}

function normalizeGuideGeometry(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || value.coordinate_system !== "glb-y-up-right-handed" || value.units !== "m" || value.up_axis !== "y") {
    throw new ProcessingError("provider_invalid_result", 502, "The reconstruction provider returned an unsupported guide coordinate system.");
  }
  const calibratedHeight = Number(value.calibrated_height_cm);
  if (!Number.isFinite(calibratedHeight) || calibratedHeight <= 0 || calibratedHeight > 500 || !isRecord(value.contours)) {
    throw new ProcessingError("provider_invalid_result", 502, "The reconstruction provider returned invalid guide geometry.");
  }
  const contours: Record<string, unknown> = {};
  for (const [key, rawContour] of Object.entries(value.contours)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || !isRecord(rawContour)) {
      throw new ProcessingError("provider_invalid_result", 502, "The reconstruction provider returned an invalid guide contour.");
    }
    const levelFraction = Number(rawContour.level_fraction);
    const levelHeight = Number(rawContour.level_height_cm);
    const points = rawContour.points;
    const source = typeof rawContour.source === "string" ? rawContour.source.trim() : "";
    if (!Number.isFinite(levelFraction) || levelFraction <= 0.05 || levelFraction >= 0.99 || !Number.isFinite(levelHeight) || levelHeight <= 0 || levelHeight > calibratedHeight || Math.abs(levelHeight - levelFraction * calibratedHeight) > Math.max(0.25, calibratedHeight * 0.01) || !Array.isArray(points) || points.length < 8 || points.length > 2048 || !source || source.length > 120) {
      throw new ProcessingError("provider_invalid_result", 502, `The reconstruction provider returned an invalid ${key} guide contour.`);
    }
    const normalizedPoints = points.map((point) => {
      if (!Array.isArray(point) || point.length !== 3 || point.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate) || Math.abs(coordinate) > 100)) {
        throw new ProcessingError("provider_invalid_result", 502, `The reconstruction provider returned invalid points for the ${key} guide contour.`);
      }
      return point.map((coordinate) => Math.round(coordinate * 100000) / 100000);
    });
    contours[key] = {
      level_fraction: Math.round(levelFraction * 100000) / 100000,
      level_height_cm: Math.round(levelHeight * 100000) / 100000,
      points: normalizedPoints,
      source,
    };
  }
  return {
    coordinate_system: "glb-y-up-right-handed",
    units: "m",
    up_axis: "y",
    calibrated_height_cm: Math.round(calibratedHeight * 100000) / 100000,
    contours,
  };
}

function normalizeReconstruction(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new ProcessingError("provider_invalid_result", 502, "The reconstruction provider returned invalid reconstruction metadata.");
  const reconstruction = { ...value };
  if (Object.prototype.hasOwnProperty.call(reconstruction, "guide_geometry")) {
    reconstruction.guide_geometry = normalizeGuideGeometry(reconstruction.guide_geometry);
  }
  return reconstruction;
}

function providerResult(value: unknown, expectedScanId: string): NormalizedProviderResult {
  const source = isRecord(value) && isRecord(value.data) ? value.data : value;
  if (!isRecord(source) || String(source.scan_id ?? "") !== expectedScanId || !Array.isArray(source.measurements) || source.measurements.length === 0 || source.measurements.length > 100 || !source.measurements.every((measurement) => isRecord(measurement) && validMeasurement(measurement))) {
    if (isRecord(source) && String(source.scan_id ?? "") !== expectedScanId) {
      throw new ProcessingError("provider_invalid_result", 502, "The reconstruction provider returned the wrong scan id.");
    }
    throw new ProcessingError("provider_invalid_result", 502, "The reconstruction provider returned an invalid measurement result.");
  }
  const bodyModel = source.body_model ?? source.model;
  if (!isRecord(bodyModel)) {
    throw new ProcessingError("provider_invalid_result", 502, "The reconstruction provider returned measurements without a GLB body model.");
  }
  const modelReference = typeof bodyModel.path === "string" ? bodyModel.path : typeof bodyModel.url === "string" ? bodyModel.url : "";
  if (!modelReference || !validModelReference(modelReference)) {
    throw new ProcessingError("provider_invalid_result", 502, "The reconstruction provider returned an invalid body model reference.");
  }
  if (bodyModel.preview_path !== undefined && bodyModel.preview_path !== null && !validModelReference(bodyModel.preview_path)) {
    throw new ProcessingError("provider_invalid_result", 502, "The reconstruction provider returned an invalid preview reference.");
  }
  if (bodyModel.preview_data !== undefined && !isRecord(bodyModel.preview_data)) {
    throw new ProcessingError("provider_invalid_result", 502, "The reconstruction provider returned invalid preview metadata.");
  }
  const version = source.processing_version;
  if (typeof version !== "string" || !version.trim() || version.length > 80) {
    throw new ProcessingError("provider_invalid_result", 502, "The reconstruction provider returned an invalid processing version.");
  }
  if (!isRecord(source.reconstruction)) {
    throw new ProcessingError("provider_invalid_result", 502, "The reconstruction provider did not return reconstruction metadata.");
  }
  const quality = source.scan_quality === undefined || source.scan_quality === null
    ? null
    : typeof source.scan_quality === "string" && source.scan_quality.trim()
      ? source.scan_quality.trim().slice(0, 40)
      : (() => { throw new ProcessingError("provider_invalid_result", 502, "The reconstruction provider returned invalid quality metadata."); })();
  return {
    measurements: source.measurements as ValidProviderMeasurement[],
    body_model: isRecord(bodyModel) ? bodyModel as ProviderModel : undefined,
    processing_version: version.trim(),
    scan_quality: quality,
    quality_issues: source.quality_issues,
    reconstruction: normalizeReconstruction(source.reconstruction),
  };
}

function isMultipartProvider(providerUrl: string): boolean {
  return /\/api\/v1\/body-scan\/?$/i.test(providerUrl)
    || Deno.env.get("RECONSTRUCTION_API_FORMAT")?.trim().toLowerCase() === "multipart";
}

function providerResponseBody(value: unknown): Record<string, unknown> {
  return isRecord(value) && isRecord(value.data) ? value.data : isRecord(value) ? value : {};
}

function providerPending(value: unknown): boolean {
  const status = typeof providerResponseBody(value).status === "string"
    ? String(providerResponseBody(value).status).trim().toLowerCase()
    : "";
  return status === "queued" || status === "validating" || status === "processing";
}

function providerProgress(value: unknown): { status: "queued" | "validating" | "processing"; progress: number | null; message: string | null } | null {
  const body = providerResponseBody(value);
  const status = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
  if (status !== "queued" && status !== "validating" && status !== "processing") return null;
  const rawProgress = Number(body.progress);
  return {
    status,
    progress: Number.isFinite(rawProgress) ? Math.min(99, Math.max(0, Math.round(rawProgress))) : null,
    message: typeof body.status_message === "string"
      ? body.status_message.trim().slice(0, 240)
      : typeof body.message === "string"
        ? body.message.trim().slice(0, 240)
        : null,
  };
}

async function pollProviderResponse(
  initialResponse: Response,
  providerUrl: string,
  providerKey: string,
  signal: AbortSignal,
  deadline: number,
  onProgress?: (progress: { status: "queued" | "validating" | "processing"; progress: number | null; message: string | null }) => Promise<void>,
): Promise<Response> {
  let response = initialResponse;
  const endpoint = new URL(providerUrl);
  while (true) {
    if (!response.ok && response.status !== 202) return response;
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return new Response(JSON.stringify({ error: "The reconstruction provider returned invalid JSON." }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    const progress = providerProgress(payload);
    if (progress) await onProgress?.(progress);
    if (!providerPending(payload)) {
      return new Response(JSON.stringify(payload), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    const body = providerResponseBody(payload);
    const reference = typeof body.status_url === "string" ? body.status_url.trim() : "";
    if (!reference) {
      return new Response(JSON.stringify({ error: "The reconstruction provider accepted the scan without a status URL." }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    let statusUrl: URL;
    try {
      statusUrl = new URL(reference, endpoint);
    } catch {
      return new Response(JSON.stringify({ error: "The reconstruction provider returned an invalid status URL." }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (statusUrl.protocol !== "https:" || statusUrl.username || statusUrl.password || statusUrl.origin !== endpoint.origin) {
      return new Response(JSON.stringify({ error: "The reconstruction provider returned an unsafe status URL." }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    const retryAfter = Number(body.retry_after_ms);
    const delayMs = Number.isFinite(retryAfter) ? Math.min(10_000, Math.max(250, retryAfter)) : 750;
    if (Date.now() + delayMs >= deadline) {
      return new Response(JSON.stringify({ error: "The reconstruction provider timed out while processing the scan." }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    response = await fetch(statusUrl, {
      headers: { "Authorization": `Bearer ${providerKey}` },
      signal,
    });
  }
}

function imageContentType(metadata: unknown): string {
  const value = isRecord(metadata) && typeof metadata.content_type === "string" ? metadata.content_type : "image/jpeg";
  return ["image/jpeg", "image/png", "image/webp"].includes(value) ? value : "image/jpeg";
}

function imageExtension(contentType: string): string {
  return contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
}

async function callReconstructionProvider(
  providerUrl: string,
  providerKey: string,
  scanId: string,
  scan: ScanForLocalProvider,
  providerAssets: Array<{ asset_type: string; url: string; metadata: unknown }>,
  onProgress?: (progress: { status: "queued" | "validating" | "processing"; progress: number | null; message: string | null }) => Promise<void>,
): Promise<Response> {
  const controller = new AbortController();
  const configuredTimeout = Number(Deno.env.get("RECONSTRUCTION_TIMEOUT_MS") ?? "120000");
  const timeoutMs = Number.isFinite(configuredTimeout) ? Math.min(300_000, Math.max(10_000, configuredTimeout)) : 120_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    if (isMultipartProvider(providerUrl)) {
      if (scan.height_value === null || !Number.isFinite(Number(scan.height_value))) {
        throw new ProcessingError("invalid_request", 422, "A height is required for the multipart reconstruction provider.");
      }
      const form = new FormData();
      for (const asset of providerAssets) {
        const imageResponse = await fetch(asset.url, { signal: controller.signal });
        if (!imageResponse.ok) throw new ProcessingError("provider_unavailable", 503, "Could not download a private scan view for processing.");
        const contentType = imageContentType(asset.metadata);
        const bytes = new Uint8Array(await imageResponse.arrayBuffer());
        form.append(`${asset.asset_type}_image`, new Blob([bytes], { type: contentType }), `${asset.asset_type}.${imageExtension(contentType)}`);
      }
      form.append("scan_id", scanId);
      form.append("height_cm", String(heightInCm(scan)));
      response = await fetch(providerUrl, {
        method: "POST",
        headers: { "Authorization": `Bearer ${providerKey}` },
        body: form,
        signal: controller.signal,
      });
    } else {
      response = await fetch(providerUrl, {
        method: "POST",
        headers: { "Authorization": `Bearer ${providerKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ scan_id: scanId, height_value: scan.height_value, height_unit: scan.height_unit, assets: providerAssets }),
        signal: controller.signal,
      });
    }
    return await pollProviderResponse(response, providerUrl, providerKey, controller.signal, Date.now() + timeoutMs, onProgress);
  } catch (error) {
    if (error instanceof ProcessingError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new ProcessingError("provider_unavailable", 503, "The reconstruction provider timed out.");
    throw new ProcessingError("provider_unavailable", 503, "The reconstruction provider could not be reached.");
  } finally {
    clearTimeout(timeout);
  }
}

async function persistProviderModel(
  client: ReturnType<typeof adminClient>,
  model: ProviderModel | undefined,
  scanId: string,
  organizationId: string | null,
  customerId: string,
  providerUrl: string,
  providerKey: string,
  attemptId: string | null,
): Promise<{ path: string | null; preview_data: Record<string, unknown> }> {
  if (!model) return { path: null, preview_data: {} };
  const modelReference = typeof model.path === "string" ? model.path : typeof model.url === "string" ? model.url : null;
  if (!modelReference) return { path: null, preview_data: isRecord(model.preview_data) ? model.preview_data : {} };
  const previewData = isRecord(model.preview_data) ? model.preview_data : {};
  // A configured provider must store its downloaded model in the private
  // body-models bucket. The no-provider path exits before this helper.
  if (!providerUrl) return { path: modelReference, preview_data: previewData };
  let modelUrl: URL;
  let providerEndpoint: URL;
  try {
    providerEndpoint = new URL(providerUrl);
    modelUrl = new URL(modelReference, providerEndpoint);
  } catch {
    throw new ProcessingError("provider_invalid_result", 502, "The reconstruction provider returned an invalid model URL.");
  }
  if (modelUrl.username || modelUrl.password || modelUrl.origin !== providerEndpoint.origin || modelUrl.protocol !== "https:") {
    throw new ProcessingError("provider_invalid_result", 502, "The reconstruction provider returned an invalid model URL.");
  }
  const response = await fetch(modelUrl, {
    headers: { "Authorization": `Bearer ${providerKey}` },
  });
  if (!response.ok) throw new ProcessingError("provider_unavailable", 503, "The provider model could not be downloaded.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const maxBytes = Number(Deno.env.get("RECONSTRUCTION_MAX_MODEL_BYTES") ?? `${25 * 1024 * 1024}`);
  if (!Number.isFinite(maxBytes) || bytes.length === 0 || bytes.length > maxBytes) throw new ProcessingError("provider_invalid_result", 502, "The provider model file is empty or too large.");
  const storagePath = `${organizationId ?? "unassigned"}/${customerId}/${scanId}/model-${attemptId ?? "latest"}.glb`;
  const { error } = await client.storage.from("body-models").upload(storagePath, bytes, { contentType: "model/gltf-binary", cacheControl: "3600", upsert: true });
  if (error) throw new ProcessingError("processing_failed", 500, "The personalized body model could not be saved to private storage.");
  return { path: storagePath, preview_data: { ...previewData, downloaded_from_provider: true, provider_model_url: modelUrl.origin } };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  const client = adminClient();
  if (request.method === "GET") {
    try {
      const user = await requireUser(request, client);
      const scanId = new URL(request.url).searchParams.get("scan_id")?.trim() ?? "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scanId)) {
        return jsonResponse({ error: "A valid scan_id is required." }, 400, request);
      }
      const [{ data: actor }, { data: scan, error: scanError }] = await Promise.all([
        client.from("profiles").select("role,organization_id").eq("id", user.id).single(),
        client.from("scans").select("id,customer_id,organization_id,status,processing_status,processing_progress,processing_progress_reported,processing_attempt_id,processing_error_code,processing_error,updated_at").eq("id", scanId).single(),
      ]);
      if (scanError || !scan) return jsonResponse({ error: "Scan not found." }, 404, request);
      const canAccess = scan.customer_id === user.id || (actor?.organization_id && actor.organization_id === scan.organization_id && (actor.role === "admin" || (actor.role === "dressmaker" && ["ready_for_review", "verified", "needs_recapture"].includes(scan.status))));
      if (!canAccess) return jsonResponse({ error: "You cannot view this scan." }, 403, request);
      const status = scan.processing_status ?? (scan.status === "failed" ? "failed" : ["ready_to_share", "ready_for_review", "verified"].includes(scan.status) ? "completed" : scan.status === "processing" ? "processing" : "queued");
      return jsonResponse({ scan_id: scan.id, status, progress: Number(scan.processing_progress ?? 0), progress_reported: scan.processing_progress_reported === true, processing_attempt_id: scan.processing_attempt_id ?? null, error_code: scan.processing_error_code ?? null, error: scan.processing_error ?? null, updated_at: scan.updated_at }, 200, request);
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : "Unable to load scan processing status." }, error instanceof AuthRequiredError ? 401 : 500, request);
    }
  }
  if (request.method !== "POST") return jsonResponse({ error: "Use POST to queue processing or GET to read processing status." }, 405, request);
  let scanId = "";
  let processingStarted = false;
  let attemptId: string | null = null;
  try {
    const user = await requireUser(request, client);
    let body: { scan_id?: string };
    try {
      const parsed = await request.json() as unknown;
      if (!isRecord(parsed)) throw new Error();
      body = parsed as { scan_id?: string };
    } catch {
      return jsonResponse({ error: "Request body must be valid JSON." }, 400, request);
    }
    scanId = typeof body.scan_id === "string" ? body.scan_id.trim() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scanId)) {
      throw new ProcessingError("invalid_request", 400, "A valid scan_id is required.");
    }
    const [{ data: actor }, { data: scan, error: scanError }, { data: assets, error: assetsError }] = await Promise.all([
      client.from("profiles").select("role,organization_id").eq("id", user.id).single(),
      client.from("scans").select("*").eq("id", scanId).single(),
      client.from("scan_assets").select("asset_type,storage_path,metadata").eq("scan_id", scanId),
    ]);
    if (scanError || !scan) return jsonResponse({ error: "Scan not found." }, 404, request);
    const canAccess = scan.customer_id === user.id || (actor?.organization_id && actor.organization_id === scan.organization_id && (actor.role === "admin" || (actor.role === "dressmaker" && ["ready_for_review", "verified", "needs_recapture"].includes(scan.status))));
    if (!canAccess) return jsonResponse({ error: "You cannot process this scan." }, 403, request);
    if (assetsError) throw new ProcessingError("processing_failed", 500, "The scan assets could not be loaded.");
    await client.from("scans").update({ processing_status: "validating", processing_progress: 0, processing_progress_reported: false, processing_error_code: null, processing_error: null }).eq("id", scanId).not("status", "in", "(ready_to_share,ready_for_review,verified)");
    const required = ["front", "side"];
    if (!required.every((type) => (assets ?? []).some((asset) => asset.asset_type === type))) {
      await client.from("scans").update({ status: "failed", processing_status: "failed", processing_progress: 0, processing_progress_reported: false, processing_error_code: "missing_assets", processing_error: "Front and side views are required.", failure_reason: "Front and side views are required." }).eq("id", scanId).not("status", "in", "(ready_to_share,ready_for_review,verified)");
      return jsonResponse({ status: "failed", progress: 0, progress_reported: false, error_code: "missing_assets", message: "Front and side views are required." }, 400, request);
    }
    const heightCm = Number(scan.height_value) * (scan.height_unit === "ftin" ? 2.54 : 1);
    if (!Number.isFinite(heightCm) || heightCm <= 0) {
      const message = "A valid height is required before processing a scan.";
      await client.from("scans").update({ status: "failed", processing_status: "failed", processing_progress: 0, processing_progress_reported: false, processing_error_code: "invalid_height", processing_error: message, failure_reason: message }).eq("id", scanId).not("status", "in", "(ready_to_share,ready_for_review,verified)");
      return jsonResponse({ status: "failed", progress: 0, progress_reported: false, error_code: "invalid_height", message }, 400, request);
    }

    const configuredProvider = Deno.env.get("RECONSTRUCTION_PROVIDER")?.trim();
    const providerUrl = Deno.env.get("RECONSTRUCTION_API_URL")?.trim();
    const providerKey = Deno.env.get("RECONSTRUCTION_API_KEY")?.trim();
    const provider = configuredProvider?.toLowerCase() === "local" ? "" : configuredProvider ?? "";
    if (!provider || !providerUrl || !providerKey) {
      const message = "No reconstruction provider is configured. Configure one in the Edge Function secrets, then retry this scan.";
      await client.from("scans").update({ status: "failed", processing_status: "failed", processing_progress: 0, processing_progress_reported: false, processing_provider: null, processing_error_code: "provider_not_configured", processing_error: message, failure_reason: message }).eq("id", scanId).not("status", "in", "(ready_to_share,ready_for_review,verified)");
      return jsonResponse({ status: "failed", progress: 0, progress_reported: false, error_code: "provider_not_configured", message }, 503, request);
    }
    try {
      const url = new URL(providerUrl);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    } catch {
      const message = "The reconstruction provider URL must use HTTPS.";
      await client.from("scans").update({ status: "failed", processing_status: "failed", processing_progress: 0, processing_progress_reported: false, processing_provider: null, processing_error_code: "provider_unavailable", processing_error: message, failure_reason: message }).eq("id", scanId).not("status", "in", "(ready_to_share,ready_for_review,verified)");
      return jsonResponse({ status: "failed", progress: 0, progress_reported: false, error_code: "provider_unavailable", message }, 503, request);
    }

    const staleProcessing = scan.status === "processing"
      && Number.isFinite(new Date(scan.updated_at).getTime())
      && new Date(scan.updated_at).getTime() < Date.now() - 10 * 60 * 1000;
    const claimStatuses = staleProcessing
      ? ["uploaded", "processing_queued", "failed", "draft", "processing"]
      : ["uploaded", "processing_queued", "failed", "draft"];
    const { data: claimedScan, error: claimError } = await client
      .from("scans")
      .update({ status: "processing", processing_status: "processing", processing_progress: 0, processing_progress_reported: false, processing_provider: provider, processing_attempts: Number(scan.processing_attempts ?? 0) + 1, processing_started_at: new Date().toISOString(), processing_completed_at: null, processing_error_code: null, processing_error: null, failure_reason: null })
      .eq("id", scanId)
      .in("status", claimStatuses)
      .select("id")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimedScan) {
      return jsonResponse({ status: scan.status, progress: null, progress_reported: false, processing_attempt_id: scan.processing_attempt_id ?? null, message: "This scan is already being processed or is not ready to process." }, 200, request);
    }
    processingStarted = true;
    const attempt = await claimProcessingAttempt(
      client,
      scanId,
      Math.max(1, Number(scan.processing_attempts ?? 0) + 1),
      provider,
    );
    attemptId = attempt.id;

    let lastProviderProgress: number | null = null;
    let lastProviderProgressReported = false;
    let lastProviderStatus: "queued" | "validating" | "processing" = "processing";
    let lastProviderMessage = "";
    const reportProviderProgress = async ({ status, progress, message }: { status: "queued" | "validating" | "processing"; progress: number | null; message: string | null }) => {
      const hasProgress = progress !== null && Number.isFinite(progress);
      const receivedProgress = hasProgress ? Math.min(99, Math.max(0, progress)) : null;
      const regressed = receivedProgress !== null && lastProviderProgress !== null && receivedProgress < lastProviderProgress;
      const nextProgress = receivedProgress === null ? lastProviderProgress : Math.max(lastProviderProgress ?? 0, receivedProgress);
      const nextProgressReported = lastProviderProgressReported || receivedProgress !== null;
      const nextStatus = regressed ? lastProviderStatus : status;
      const nextMessage = regressed ? "" : (message ?? "");
      if (nextProgress === lastProviderProgress && nextProgressReported === lastProviderProgressReported && nextStatus === lastProviderStatus && nextMessage === lastProviderMessage) return;
      lastProviderProgress = nextProgress;
      lastProviderProgressReported = nextProgressReported;
      lastProviderStatus = nextStatus;
      lastProviderMessage = nextMessage;
      const { error } = await client
        .from("scans")
        .update({ processing_status: nextStatus, ...(nextProgress === null ? {} : { processing_progress: nextProgress }), processing_progress_reported: nextProgressReported, processing_error: null })
        .eq("id", scanId)
        .eq("status", "processing");
      if (error) console.error(`Could not persist provider progress for ${scanId}:`, error.message);
    };

    const providerAssets = await Promise.all((assets ?? []).filter((asset) => asset.asset_type === "front" || asset.asset_type === "side").map(async (asset) => {
        const { data: signed, error: signedError } = await client.storage.from("scan-captures").createSignedUrl(asset.storage_path, 900);
        if (signedError || !signed?.signedUrl) throw new ProcessingError("provider_unavailable", 503, "Could not authorize a scan view for processing.");
        return { asset_type: asset.asset_type, url: signed.signedUrl, metadata: asset.metadata };
    }));
    const providerResponse = await callReconstructionProvider(providerUrl, providerKey, scanId, scan, providerAssets, reportProviderProgress);
    if (!providerResponse.ok) throw new ProcessingError("provider_unavailable", 503, "The reconstruction provider rejected the scan.");
    let decoded: unknown;
    try {
      decoded = await providerResponse.json();
    } catch {
      throw new ProcessingError("provider_invalid_result", 502, "The reconstruction provider returned invalid JSON.");
    }
    const validated = providerResult(decoded, scanId);
    const measurements = validated.measurements;
    await reportProviderProgress({ status: "processing", progress: 98, message: "Saving measurements and the private body model." });
    const normalizedMeasurements = measurements.map((measurement) => {
      const valueInCm = measurement.unit === "in" ? measurement.value * 2.54 : measurement.value;
      return {
        scan_id: scanId,
        key: measurement.key.trim(),
        value: valueInCm,
        ai_value: valueInCm,
        unit: "cm",
        confidence: measurement.confidence ?? null,
        measurement_method: typeof measurement.method === "string" ? measurement.method.trim().slice(0, 40) : null,
        measurement_source: typeof measurement.source === "string" ? measurement.source.trim().slice(0, 120) : null,
      };
    });
    if (new Set(normalizedMeasurements.map((measurement) => measurement.key.toLowerCase())).size !== normalizedMeasurements.length) throw new ProcessingError("provider_invalid_result", 502, "The reconstruction provider returned duplicate measurement keys.");
    // Download the new private model before replacing the old promoted row.
    // A failed provider/model attempt therefore leaves the previous result
    // available for review and retry.
    const persistedModel = await persistProviderModel(client, validated.body_model, scanId, scan.organization_id ?? null, scan.customer_id, providerUrl ?? "", providerKey ?? "", attemptId);
    if (!persistedModel.path) throw new ProcessingError("provider_invalid_result", 502, "The reconstruction provider returned no usable body model.");
    const providerMetadata = {
        scan_quality: validated.scan_quality,
        quality_issues: validated.quality_issues,
        reconstruction: validated.reconstruction,
        processing_attempt_id: attemptId,
        measurement_provenance: measurements.map((measurement) => ({ key: measurement.key, method: measurement.method, source: measurement.source })),
      };
    const previewData = { ...persistedModel.preview_data, ...providerMetadata };
    await stageProcessingAttempt(client, attemptId, {
      processingVersion: validated.processing_version,
      quality: validated.scan_quality,
      qualityIssues: validated.quality_issues,
      reconstruction: validated.reconstruction,
      measurements: normalizedMeasurements,
      modelPath: persistedModel.path,
    });
    if (!attemptId) throw new ProcessingError("processing_failed", 500, "The scan processing attempt could not be identified.");
    const { error: promotionError } = await client.rpc("promote_scan_processing_attempt", {
      p_scan_id: scanId,
      p_attempt_id: attemptId,
      p_provider: provider,
      p_processing_version: validated.processing_version,
      p_model_path: persistedModel.path,
      p_preview_data: previewData,
      p_measurements: normalizedMeasurements,
    });
    if (promotionError) throw new ProcessingError("processing_failed", 500, "The validated scan result could not be promoted.");
    return jsonResponse({ status: "completed", progress: 100, progress_reported: true, processing_attempt_id: attemptId, message: "A validated provider result is ready. Review it before sharing it with your dressmaker." }, 200, request);
  } catch (error) {
    const processingError = error instanceof ProcessingError ? error : null;
    const message = error instanceof AuthRequiredError
      ? error.message
      : processingError?.message ?? "The reconstruction provider failed. Please try again later.";
    if (scanId && processingStarted) {
      await failProcessingAttempt(client, attemptId, processingError?.code ?? "processing_failed", message);
      const { data: currentScan } = await client.from("scans").select("processing_progress").eq("id", scanId).maybeSingle();
      const failureProgress = Math.min(99, Math.max(0, Number(currentScan?.processing_progress ?? 25)));
      await client.from("scans").update({ status: "failed", processing_status: "failed", processing_progress: failureProgress, processing_error_code: processingError?.code ?? "processing_failed", processing_error: message, failure_reason: message }).eq("id", scanId).eq("status", "processing");
    }
    return jsonResponse({ status: "failed", progress: null, progress_reported: false, processing_attempt_id: attemptId, error_code: processingError?.code ?? "processing_failed", message }, error instanceof AuthRequiredError ? 401 : processingError?.status ?? 500, request);
  }
});
