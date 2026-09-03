import type { Measurement, ScanBundle } from "./types";

export type ScanResultTruth = {
  scanId: string;
  attemptId: string | null;
  provider: string | null;
  processingVersion: string | null;
  quality: string | null;
  qualityIssues: Array<Record<string, unknown>>;
  independentAccuracyValidated: false;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown, maximum = 120): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function qualityIssues(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (isRecord(item)) return item;
      return typeof item === "string" && item.trim() ? { message: item.trim().slice(0, 300) } : null;
    })
    .filter((item): item is Record<string, unknown> => item !== null)
    .slice(0, 20);
}

/**
 * Combine only persisted provider metadata for the result screen. This
 * deliberately has no accuracy calculation: fitting loss and image quality
 * are not independent real-world accuracy measurements.
 */
export function getScanResultTruth(bundle: ScanBundle): ScanResultTruth {
  const preview = isRecord(bundle.bodyModel?.preview_data) ? bundle.bodyModel.preview_data : {};
  const reconstruction = isRecord(preview.reconstruction) ? preview.reconstruction : {};
  const attempt = bundle.processingAttempt;
  const provider = optionalText(bundle.scan.processing_provider)
    ?? optionalText(bundle.bodyModel?.provider)
    ?? optionalText(preview.provider);
  const processingVersion = optionalText(bundle.scan.processing_version, 80)
    ?? optionalText(attempt?.processing_version, 80)
    ?? optionalText(preview.processing_version, 80)
    ?? optionalText(reconstruction.processing_version, 80);
  const quality = optionalText(attempt?.quality)
    ?? optionalText(preview.scan_quality);
  const rawIssues = attempt?.quality_issues?.length ? attempt.quality_issues : preview.quality_issues;

  return {
    scanId: bundle.scan.id,
    attemptId: optionalText(bundle.scan.processing_attempt_id, 80) ?? optionalText(attempt?.id, 80),
    provider,
    processingVersion,
    quality,
    qualityIssues: qualityIssues(rawIssues),
    independentAccuracyValidated: false,
  };
}

export function measurementProvenance(measurement: Measurement): string {
  const method = optionalText(measurement.method, 40);
  const source = optionalText(measurement.source, 120);
  return [method, source].filter((value): value is string => value !== null).join(" · ") || "Provider details not reported";
}

export function qualityIssueText(issue: Record<string, unknown>): string {
  const message = optionalText(issue.message, 300) ?? optionalText(issue.error, 300) ?? "Provider quality issue reported";
  const view = optionalText(issue.view, 30);
  return view ? `${view}: ${message}` : message;
}
