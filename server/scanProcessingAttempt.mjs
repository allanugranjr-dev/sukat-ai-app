import { randomUUID } from "node:crypto";

import { execute, row } from "./database.mjs";

const ACTIVE_STATUSES = ["queued", "validating", "processing", "retrying"];
const INTERNAL_ERROR_MARKERS = [
  /sqlstate/i,
  /constraint/i,
  /insert\s+into/i,
  /update\s+.+\s+set/i,
  /select\s+.+\s+from/i,
 /parameters?:/i,
  /node_modules/i,
  /(?:[A-Za-z]:\\|\\\\)[^\s]+/i,
  /https?:\/\//i,
  /bearer\s+/i,
  /(?:api[_-]?key|secret|password|token)\s*[:=]/i,
  /(?:body-models|scan-captures)\//i,
];

const DEFAULT_PROCESSING_ERROR = "The processing service could not complete this scan. Your uploaded views are safe; please try again.";

export function safeProcessingErrorMessage(value) {
  const message = String(value ?? "").trim();
  if (!message || message.length > 420 || INTERNAL_ERROR_MARKERS.some((marker) => marker.test(message))) {
    return DEFAULT_PROCESSING_ERROR;
  }
  return message;
}

export function scanAttemptIdempotencyKey(scanId, attemptNumber) {
  return `${String(scanId)}:${Math.max(1, Math.floor(Number(attemptNumber) || 1))}`;
}

function jsonParameter(value, fallback) {
  return JSON.stringify(value && typeof value === "object" ? value : fallback);
}

export async function findActiveScanAttempt(scanId) {
  const placeholders = ACTIVE_STATUSES.map(() => "?").join(",");
  return row(
    `SELECT * FROM scan_processing_attempts WHERE scan_id = ? AND status IN (${placeholders}) ORDER BY attempt_number DESC LIMIT 1`,
    [scanId, ...ACTIVE_STATUSES],
  );
}

/**
 * Claim one durable attempt for a processing run. The scan job queue remains
 * the concurrency boundary, while this row makes retries and provider work
 * observable after a process restart.
 */
export async function claimScanAttempt({ scanId, attemptNumber, provider, processingVersion }) {
  const active = await findActiveScanAttempt(scanId);
  if (active) {
    // A process restart can leave the durable attempt alive after the scan
    // link write was interrupted. Repair only that scoped link before reuse.
    await execute("UPDATE scans SET processing_attempt_id = ? WHERE id = ? AND processing_attempt_id IS NULL", [active.id, scanId]);
    return active;
  }
  const id = randomUUID();
  const idempotencyKey = scanAttemptIdempotencyKey(scanId, attemptNumber);
  try {
    await execute(
      `INSERT INTO scan_processing_attempts
        (id, scan_id, attempt_number, status, provider, processing_version, idempotency_key, claim_token, quality_issues, reconstruction, staged_measurements, started_at)
       VALUES (?, ?, ?, 'processing', ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [id, scanId, attemptNumber, provider, processingVersion ?? null, idempotencyKey, randomUUID(), "[]", "{}", "[]"],
    );
  } catch (error) {
    // A second request can arrive between the active lookup and insert. It
    // must reuse the existing attempt rather than create duplicate work.
    const existing = await row("SELECT * FROM scan_processing_attempts WHERE scan_id = ? AND idempotency_key = ? LIMIT 1", [scanId, idempotencyKey]);
    if (existing) return existing;
    throw error;
  }
  await execute("UPDATE scans SET processing_attempt_id = ? WHERE id = ?", [id, scanId]);
  return row("SELECT * FROM scan_processing_attempts WHERE id = ? LIMIT 1", [id]);
}

export async function stageScanAttempt(attemptId, { measurements, modelPath, quality, qualityIssues, reconstruction, processingVersion }) {
  if (!attemptId) return;
  const result = await execute(
    `UPDATE scan_processing_attempts
        SET status = 'processing',
            processing_version = COALESCE(?, processing_version),
            staged_measurements = ?,
            staged_model_path = ?,
            quality = ?,
            quality_issues = ?,
            reconstruction = ?,
            updated_at = UTC_TIMESTAMP()
      WHERE id = ?`,
    [
      processingVersion ?? null,
      jsonParameter(measurements, []),
      modelPath ?? null,
      quality ?? null,
      jsonParameter(qualityIssues, []),
      jsonParameter(reconstruction, {}),
      attemptId,
    ],
  );
  if (result.affectedRows !== 1) throw new Error("The provider result could not be staged for promotion.");
}

export async function failScanAttempt(attemptId, errorCode, errorMessage) {
  if (!attemptId) return;
  await execute(
    `UPDATE scan_processing_attempts
        SET status = 'failed', error_code = ?, error_message = ?, completed_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
      WHERE id = ? AND is_promoted = 0`,
    [String(errorCode ?? "processing_failed").slice(0, 80), String(errorMessage ?? "The scan could not be completed.").slice(0, 1000), attemptId],
  );
}

export async function promoteScanAttempt(connection, attemptId) {
  if (!attemptId) return;
  const result = await connection.query(
    `UPDATE scan_processing_attempts
        SET status = 'promoted', is_promoted = 1, promoted_at = UTC_TIMESTAMP(), completed_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
      WHERE id = ? AND status = 'processing' AND is_promoted = 0`,
    [attemptId],
  );
  if (result.affectedRows !== 1) throw new Error("The scan attempt could not be promoted.");
}

export function scanAttemptResponse(attempt) {
  if (!attempt) return null;
  let qualityIssues = attempt.quality_issues;
  if (typeof qualityIssues === "string") {
    try {
      qualityIssues = JSON.parse(qualityIssues || "[]");
    } catch {
      qualityIssues = [];
    }
  }
  return {
    id: attempt.id,
    scan_id: attempt.scan_id,
    attempt_number: Number(attempt.attempt_number),
    status: attempt.status,
    provider: attempt.provider ?? null,
    processing_version: attempt.processing_version ?? null,
    quality: attempt.quality ?? null,
    quality_issues: Array.isArray(qualityIssues) ? qualityIssues : [],
    error_code: attempt.error_code ?? null,
    error_message: attempt.error_message ? safeProcessingErrorMessage(attempt.error_message) : null,
    started_at: attempt.started_at ? new Date(attempt.started_at).toISOString() : null,
    completed_at: attempt.completed_at ? new Date(attempt.completed_at).toISOString() : null,
    promoted_at: attempt.promoted_at ? new Date(attempt.promoted_at).toISOString() : null,
    is_promoted: Boolean(attempt.is_promoted),
  };
}
