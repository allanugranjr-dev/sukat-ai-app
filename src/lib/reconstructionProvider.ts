import { readableError } from "./supabase";
import { xamppRequest } from "./xampp";
import type { ProcessingStage, ScanStatus } from "./types";

type ProcessingPayload = {
  status?: string;
  progress?: number | null;
  progress_reported?: boolean;
  message?: string;
  status_message?: string;
  error?: string | null;
  error_code?: string | null;
};

export type ProcessingRequestResult =
  | { status: "processing"; processingStatus: Extract<ProcessingStage, "queued" | "validating" | "processing">; progress: number | null; message: string; errorCode: string | null }
  | { status: "ready"; processingStatus: "completed"; progress: 100; message: string; errorCode: null }
  | { status: "unavailable"; processingStatus: null; progress: null; message: string; errorCode: string | null }
  | { status: "failed"; processingStatus: "failed"; progress: number | null; message: string; errorCode: string | null };

function payloadStatus(payload: ProcessingPayload | null): ProcessingStage | null {
  const status = payload?.status?.trim().toLowerCase();
  if (status === "ready_to_share" || status === "ready_for_review") return "completed";
  return status === "queued" || status === "validating" || status === "processing" || status === "completed" || status === "failed"
    ? status
    : null;
}

function payloadProgress(payload: ProcessingPayload | null): number | null {
  if (payload?.progress_reported === false) return null;
  const value = Number(payload?.progress);
  return Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : null;
}

export async function requestScanProcessing(scanId: string): Promise<ProcessingRequestResult> {
  let data: ProcessingPayload | null;
  let error: unknown = null;
  try {
    data = await xamppRequest<ProcessingPayload>("process_scan", { body: { scan_id: scanId } });
  } catch (reason: unknown) {
    data = null;
    error = reason;
  }
  if (error) {
    return {
      status: "unavailable",
      processingStatus: null,
      progress: null,
      message: `The processing service is unavailable. Your uploaded views are safe and can be retried without starting over. ${readableError(error)}`,
      errorCode: null,
    };
  }
  const payload = data as ProcessingPayload | null;
  const processingStatus = payloadStatus(payload);
  const message = payload?.message ?? payload?.status_message ?? payload?.error ?? undefined;
  if (processingStatus === "failed") {
    return { status: "failed", processingStatus, progress: payloadProgress(payload), message: message ?? "The processing service rejected this scan.", errorCode: payload?.error_code ?? null };
  }
  if (processingStatus === "completed") {
      return { status: "ready", processingStatus: "completed", progress: 100, message: message ?? "A validated scan result is ready to review and share.", errorCode: null };
  }
  if (processingStatus === "queued" || processingStatus === "validating" || processingStatus === "processing") {
    return { status: "processing", processingStatus, progress: payloadProgress(payload), message: message ?? "Your scan has been accepted for processing.", errorCode: null };
  }
  return {
    status: "processing",
    processingStatus: "queued",
    progress: payloadProgress(payload),
    message: payload?.message ?? "Your scan has been accepted for processing.",
    errorCode: null,
  };
}

export function processingCopy(status: ScanStatus | ProcessingStage): { title: string; body: string } {
  if (status === "validating") {
    return {
      title: "Checking your photos",
      body: "We are checking that the front and side views show a clear full-body or upper-body scan at a usable scale.",
    };
  }
  if (status === "processing") {
    return {
      title: "Processing",
      body: "The configured reconstruction provider is validating your uploaded views. This page will update when a result is available.",
    };
  }
  if (status === "failed") {
    return {
      title: "Processing stopped",
      body: "No measurement result was saved from this attempt. Review the message and try again when the issue is resolved.",
    };
  }
  if (status === "completed" || status === "ready_to_share" || status === "ready_for_review" || status === "verified") {
    return {
      title: status === "ready_to_share" ? "Ready to share" : "Ready for review",
      body: status === "ready_to_share" ? "The validated provider result is ready for you to check. Share it with your dressmaker when you are ready." : "The validated provider result is ready for you and your dressmaker to check.",
    };
  }
  return {
    title: "Preparing your scan",
    body: "Your uploaded views are stored securely. Processing starts automatically and this page refreshes until a validated result is ready.",
  };
}
