import { isLocalApiMode, requireSupabase, readableError } from "./supabase";
import { xamppRequest } from "./xampp";
import type { ScanStatus } from "./types";

export type ProcessingRequestResult =
  | { status: "queued"; message: string }
  | { status: "ready"; message: string }
  | { status: "unavailable"; message: string }
  | { status: "failed"; message: string };

export async function requestScanProcessing(scanId: string): Promise<ProcessingRequestResult> {
  let data: { status?: ScanStatus; message?: string } | null;
  let error: unknown = null;
  if (isLocalApiMode) {
    try {
      data = await xamppRequest<{ status?: ScanStatus; message?: string }>("process_scan", { body: { scan_id: scanId } });
    } catch (reason: unknown) {
      data = null;
      error = reason;
    }
  } else {
    const response = await requireSupabase().functions.invoke("process-scan", {
      body: { scan_id: scanId },
    });
    data = response.data as { status?: ScanStatus; message?: string } | null;
    error = response.error;
  }
  if (error) {
    return {
      status: "unavailable",
      message: `The processing service is unavailable. Your uploaded views are safe and can be retried without starting over. ${readableError(error)}`,
    };
  }
  const payload = data as { status?: ScanStatus; message?: string } | null;
  if (payload?.status === "failed") {
    return { status: "failed", message: payload.message ?? "The processing service rejected this scan." };
  }
  if (payload?.status === "ready_for_review") {
    return { status: "ready", message: payload.message ?? "Your local scan result is ready for review." };
  }
  if (payload?.status === "processing") {
    return { status: "queued", message: payload.message ?? "Processing has started." };
  }
  return {
    status: "queued",
    message: payload?.message ?? "Your scan is queued for the configured reconstruction provider.",
  };
}

export function processingCopy(status: ScanStatus): { title: string; body: string } {
  if (status === "processing") {
    return {
      title: "Processing",
      body: "The configured reconstruction provider is validating your uploaded views. This page will update when a result is available.",
    };
  }
  if (status === "failed") {
    return {
      title: "Processing unavailable",
      body: "No measurement result was saved. Review the error and try again after the processing service is available.",
    };
  }
  return {
    title: "Processing queued",
    body: "Your uploaded views are stored securely and waiting for the configured reconstruction provider. No measurements are shown until a valid result is returned. We will check automatically; use Check status if the provider takes longer than expected.",
  };
}
