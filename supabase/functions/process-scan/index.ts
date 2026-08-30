import { adminClient, AuthRequiredError, requireUser } from "../_shared/auth.ts";
import { jsonResponse, optionsResponse } from "../_shared/cors.ts";

type ProviderMeasurement = { key?: unknown; value?: unknown; unit?: unknown; confidence?: unknown };
type ProviderModel = { path?: unknown; url?: unknown; preview_path?: unknown; preview_data?: unknown };
type ScanForLocalProvider = { height_value: number | null; height_unit: string };

const localMeasurementTemplate = [
  { key: "ankle_left_circumference", value: 24.3, confidence: 62 },
  { key: "bicep_right_circumference", value: 33.3, confidence: 67 },
  { key: "calf_left_circumference", value: 36.4, confidence: 64 },
  { key: "chest", value: 100.1, confidence: 72 },
  { key: "forearm_circumference", value: 28.0, confidence: 65 },
  { key: "head_circumference", value: 59.7, confidence: 60 },
  { key: "hip", value: 94.8, confidence: 72 },
  { key: "neck", value: 37.6, confidence: 66 },
  { key: "thigh_left_circumference", value: 55.3, confidence: 68 },
  { key: "waist", value: 82.2, confidence: 72 },
  { key: "wrist_right_circumference", value: 17.5, confidence: 61 },
  { key: "arm", value: 57.3, confidence: 67 },
  { key: "back_to_shoulder", value: 21.2, confidence: 63 },
  { key: "inseam", value: 72.4, confidence: 68 },
  { key: "neck_to_pelvis", value: 68.6, confidence: 64 },
  { key: "foot_length", value: 26.2, confidence: 60 },
  { key: "foot_width", value: 9.7, confidence: 58 },
  { key: "shoulder", value: 52.5, confidence: 70 },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function localHeightInCm(scan: ScanForLocalProvider): number {
  const numericHeight = Number(scan.height_value);
  const hasHeight = scan.height_value !== null && scan.height_value !== undefined && Number.isFinite(numericHeight);
  const storedHeight = hasHeight ? numericHeight : 170;
  return scan.height_unit === "ftin" ? storedHeight * 2.54 : storedHeight;
}

function localProviderResult(scan: ScanForLocalProvider): { measurements: ProviderMeasurement[]; body_model: ProviderModel; processing_version: string } {
  const hasHeight = scan.height_value !== null && scan.height_value !== undefined && Number.isFinite(Number(scan.height_value));
  const scale = Math.min(1.14, Math.max(0.86, localHeightInCm(scan) / 170));
  const confidencePenalty = hasHeight ? 0 : 10;
  const roundToTenth = (value: number) => Math.round(value * 10) / 10;
  return {
    measurements: localMeasurementTemplate.map((measurement) => ({
      key: measurement.key,
      value: roundToTenth(measurement.value * scale),
      unit: "cm",
      confidence: Math.max(45, measurement.confidence - confidencePenalty),
    })),
    body_model: {
      path: "local-reference-3d-body-scan",
      preview_data: {
        kind: "local-reference-3d-body-scan",
        generated_image: "/media/3d-body-scan-reference-v2.png",
        poster: "/media/3d-body-scan-reference-v2.png",
        mobile_poster: "/media/3d-body-scan-reference-v2.png",
        source: "generated image reference",
      },
    },
    processing_version: "local-demo-v1",
  };
}

function validMeasurement(value: ProviderMeasurement): value is { key: string; value: number; unit: "cm" | "in"; confidence: number | null } {
  return typeof value.key === "string" && value.key.trim().length > 0 && typeof value.value === "number" && Number.isFinite(value.value) && value.value > 0 && (value.unit === "cm" || value.unit === "in") && (value.confidence === undefined || value.confidence === null || (typeof value.confidence === "number" && value.confidence >= 0 && value.confidence <= 100));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  const client = adminClient();
  let scanId = "";
  try {
    const user = await requireUser(request, client);
    let body: { scan_id?: string };
    try {
      body = await request.json() as { scan_id?: string };
    } catch {
      return jsonResponse({ error: "Request body must be valid JSON." }, 400);
    }
    scanId = body.scan_id?.trim() ?? "";
    if (!scanId) return jsonResponse({ error: "scan_id is required." }, 400);
    const [{ data: actor }, { data: scan, error: scanError }, { data: assets, error: assetsError }] = await Promise.all([
      client.from("profiles").select("role,organization_id").eq("id", user.id).single(),
      client.from("scans").select("*").eq("id", scanId).single(),
      client.from("scan_assets").select("asset_type,storage_path,metadata").eq("scan_id", scanId),
    ]);
    if (scanError || !scan) return jsonResponse({ error: "Scan not found." }, 404);
    const canAccess = scan.customer_id === user.id || (actor?.organization_id && actor.organization_id === scan.organization_id && (actor.role === "dressmaker" || actor.role === "admin"));
    if (!canAccess) return jsonResponse({ error: "You cannot process this scan." }, 403);
    if (assetsError) return jsonResponse({ error: assetsError.message }, 400);
    const required = ["front", "side", "back"];
    if (!required.every((type) => (assets ?? []).some((asset) => asset.asset_type === type))) {
      await client.from("scans").update({ status: "failed", failure_reason: "Front, side, and back views are required." }).eq("id", scanId);
      return jsonResponse({ status: "failed", message: "Front, side, and back views are required." }, 400);
    }

    const configuredProvider = Deno.env.get("RECONSTRUCTION_PROVIDER")?.trim();
    const providerUrl = Deno.env.get("RECONSTRUCTION_API_URL")?.trim();
    const providerKey = Deno.env.get("RECONSTRUCTION_API_KEY")?.trim();
    // Keep the hosted demo usable before an external reconstruction provider is
    // configured. The result is explicitly labeled local-demo-v1 in the UI and
    // must be reviewed by a dressmaker; a configured provider overrides it.
    const localMode = configuredProvider?.toLowerCase() === "local"
      || (!configuredProvider && !providerUrl && !providerKey);
    const provider = localMode ? "local" : configuredProvider ?? "";
    if (!localMode && (!provider || !providerUrl || !providerKey)) {
      const message = "No reconstruction provider is configured. Configure one in the Edge Function secrets, then retry this scan.";
      await client.from("scans").update({ status: "failed", processing_provider: null, failure_reason: message }).eq("id", scanId);
      return jsonResponse({ status: "failed", message }, 503);
    }

    const { data: claimedScan, error: claimError } = await client
      .from("scans")
      .update({ status: "processing", processing_provider: provider, failure_reason: null })
      .eq("id", scanId)
      .in("status", ["uploaded", "processing_queued", "failed"])
      .select("id")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimedScan) {
      return jsonResponse({ status: scan.status, message: "This scan is already being processed or is not ready to process." });
    }

    let result: { measurements?: ProviderMeasurement[]; body_model?: ProviderModel; processing_version?: string };
    if (localMode) {
      result = localProviderResult(scan);
    } else {
      const providerAssets = await Promise.all((assets ?? []).map(async (asset) => {
        const { data: signed, error: signedError } = await client.storage.from("scan-captures").createSignedUrl(asset.storage_path, 900);
        if (signedError || !signed?.signedUrl) throw new Error(`Could not authorize the ${asset.asset_type} scan view for processing.`);
        return { asset_type: asset.asset_type, url: signed.signedUrl, metadata: asset.metadata };
      }));
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      let providerResponse: Response;
      try {
        providerResponse = await fetch(providerUrl!, {
          method: "POST",
          headers: { "Authorization": `Bearer ${providerKey!}`, "Content-Type": "application/json" },
          body: JSON.stringify({ scan_id: scanId, height_value: scan.height_value, height_unit: scan.height_unit, assets: providerAssets }),
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw new Error("The reconstruction provider timed out after 30 seconds.");
        throw error;
      } finally {
        clearTimeout(timeout);
      }
      if (!providerResponse.ok) throw new Error(`Provider returned HTTP ${providerResponse.status}.`);
      result = await providerResponse.json() as { measurements?: ProviderMeasurement[]; body_model?: ProviderModel; processing_version?: string };
    }
    const measurements = result.measurements ?? [];
    if (measurements.length === 0 || !measurements.every(validMeasurement)) throw new Error("Provider response did not contain a valid measurement set.");
    const normalizedMeasurements = measurements.map((measurement) => ({ scan_id: scanId, key: measurement.key.trim(), value: measurement.value, ai_value: measurement.value, unit: measurement.unit, confidence: measurement.confidence ?? null }));
    if (new Set(normalizedMeasurements.map((measurement) => measurement.key.toLowerCase())).size !== normalizedMeasurements.length) throw new Error("Provider response contained duplicate measurement keys.");
    const { error: measurementError } = await client.from("measurements").upsert(normalizedMeasurements, { onConflict: "scan_id,key" });
    if (measurementError) throw measurementError;
    const modelPath = result.body_model && (typeof result.body_model.path === "string" ? result.body_model.path : typeof result.body_model.url === "string" ? result.body_model.url : null);
    if (result.body_model && modelPath) {
      const previewData = isRecord(result.body_model.preview_data)
        ? result.body_model.preview_data
        : result.body_model.preview_path
          ? { preview_path: result.body_model.preview_path }
          : {};
      const { error: modelError } = await client.from("body_models").upsert({ scan_id: scanId, provider, model_url_or_path: modelPath, preview_data: previewData, status: "ready" }, { onConflict: "scan_id" });
      if (modelError) throw modelError;
    }
    await client.from("scans").update({ status: "ready_for_review", processing_provider: provider, processing_version: result.processing_version ?? null, failure_reason: null }).eq("id", scanId);
    return jsonResponse({ status: "ready_for_review", message: localMode ? "Local demo result is ready for tailor review." : "A validated provider result is ready for tailor review." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The reconstruction provider failed.";
    if (scanId) await client.from("scans").update({ status: "failed", failure_reason: message }).eq("id", scanId);
    return jsonResponse({ status: "failed", message }, error instanceof AuthRequiredError ? 401 : 500);
  }
});
